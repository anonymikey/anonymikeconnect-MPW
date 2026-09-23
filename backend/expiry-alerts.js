const { sendTextSms, normalizeKenyanPhone } = require('./textsms');

const TIME_ZONE = 'Africa/Nairobi';
const PORTAL_URL = process.env.MYPUBLICWIFI_PORTAL_URL || 'http://192.168.10.1/';
const SUPPORT = process.env.SMS_SUPPORT_PHONE || 'SUPA LAN support';

function parseDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|min|hour|hours|hr|day|days|week|weeks|month|months)/);
  if (!match) throw new Error(`Unsupported package duration: ${value}`);
  const number = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('minute')) return { value: Math.round(number), unit: 'minutes' };
  if (unit.startsWith('hour') || unit === 'hr') return { value: Math.round(number), unit: 'hours' };
  if (unit.startsWith('week')) return { value: Math.round(number * 7), unit: 'days' };
  if (unit.startsWith('month')) return { value: Math.round(number * 30), unit: 'days' };
  return { value: Math.round(number), unit: 'days' };
}

function expiryDate(start, duration) {
  const date = new Date(start);
  if (duration.unit === 'minutes') date.setUTCMinutes(date.getUTCMinutes() + duration.value);
  if (duration.unit === 'hours') date.setUTCHours(date.getUTCHours() + duration.value);
  if (duration.unit === 'days') date.setUTCDate(date.getUTCDate() + duration.value);
  return date;
}

function formatNairobi(date) {
  return new Intl.DateTimeFormat('en-KE', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

function maskPhone(value) { const text = String(value || ''); return text.length > 5 ? `${text.slice(0, 6)}***${text.slice(-3)}` : '***'; }
function remainingText(expiresAt, now = new Date()) {
  const minutes = Math.max(0, Math.round((new Date(expiresAt) - now) / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} day${Math.floor(minutes / 1440) === 1 ? '' : 's'}`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) === 1 ? '' : 's'} ${minutes % 60} minutes`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

const DEFAULT_EXPIRY_TEMPLATES = {
  EXPIRY_REMINDER: 'SUPA LAN: Your {{package}} package expires in {{remaining_time}} at {{expiry_time}}. Renew your package to continue browsing.',
  EXPIRY_FINAL_REMINDER: 'SUPA LAN: Your {{package}} package expires in {{remaining_time}} at {{expiry_time}}. Renew your package to continue browsing.',
  EXPIRY_EXPIRED: 'SUPA LAN: Your {{package}} package has expired. Purchase another package to continue using SUPA LAN.'
};
const EXPIRY_PLACEHOLDERS = new Set(['voucher','package','expiry_time','remaining_time','portal_url','support']);
function renderExpiryTemplate(template, event, record) {
  const values = { voucher: record.voucher_code, package: record.package_name, expiry_time: formatNairobi(record.expected_expires_at), remaining_time: remainingText(record.expected_expires_at), portal_url: PORTAL_URL, support: SUPPORT };
  return String(template).replace(/\{\{([a-z_]+)\}\}/g, (_, key) => values[key] ?? '');
}
function renderExpiryMessage(event, record, template = DEFAULT_EXPIRY_TEMPLATES[event.event_type]) { return renderExpiryTemplate(template, event, record); }
async function getExpiryTemplate(db, eventType) { const result = await db.query('select template_text from expiry_message_templates where event_type=$1 and enabled=true', [eventType]); return result.rows[0]?.template_text || DEFAULT_EXPIRY_TEMPLATES[eventType]; }

async function createExpiryRecord({ db, order, packageInfo, voucherCode }) {
  const purchasedAt = order.paid_at || new Date();
  const duration = parseDuration(packageInfo.duration);
  const expiresAt = expiryDate(purchasedAt, duration);
  const phone = normalizeKenyanPhone(order.phone);
  const inserted = await db.query(`insert into expiry_records (order_id, order_reference, voucher_code, customer_phone, package_name, package_price, duration_value, duration_unit, purchased_at, activation_reference_at, expected_expires_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) on conflict (order_reference) do nothing returning *`, [order.id, order.reference, voucherCode, phone, packageInfo.name, packageInfo.price, duration.value, duration.unit, purchasedAt, expiresAt]);
  if (!inserted.rowCount) return { created: false, duplicate: true };
  const record = inserted.rows[0];
  await db.query(`insert into expiry_audit_log (expiry_record_id, action, actor, details) values ($1, 'EXPIRY_CREATED', 'system', $2)`, [record.id, JSON.stringify({ expectedExpiresAt: expiresAt, duration })]);
  return { created: true, record };
}

async function scheduleEvents(db, recordId) {
  await db.query(`insert into expiry_events (expiry_record_id, order_reference, voucher_code, customer_phone, event_type, reminder_offset_minutes, scheduled_for, event_key)
    select r.id, r.order_reference, r.voucher_code, r.customer_phone, rule.event_type, rule.offset_minutes,
      r.expected_expires_at - make_interval(mins => rule.offset_minutes),
      rule.event_type || ':' || r.order_reference || ':' || rule.offset_minutes
    from expiry_records r cross join expiry_rules rule
    where r.id = $1 and rule.enabled = true
    on conflict (event_key) do nothing`, [recordId]);
}

async function createAndScheduleExpiry({ db, order, packageInfo, voucherCode }) {
  const result = await createExpiryRecord({ db, order, packageInfo, voucherCode });
  if (result.record) await scheduleEvents(db, result.record.id);
  return result;
}

async function runExpiryScheduler(db) {
  const client = await db.connect();
  try {
    await client.query('begin');
    const due = await client.query(`select e.*, r.package_name, r.expected_expires_at, r.status as expiry_status
      from expiry_events e join expiry_records r on r.id = e.expiry_record_id
      join expiry_rules rule on rule.event_type = e.event_type and rule.offset_minutes = e.reminder_offset_minutes and rule.enabled = true
      where e.status = 'SCHEDULED' and e.scheduled_for <= now() and e.scheduled_for > now() - interval '5 minutes' and r.status in ('ACTIVE','EXPIRING_SOON')
      order by e.scheduled_for asc limit 20 for update of e skip locked`);
    const events = [];
    for (const event of due.rows) {
      const claimed = await client.query(`update expiry_events set status = 'PROCESSING', updated_at = now() where id = $1 and status = 'SCHEDULED' returning *`, [event.id]);
      if (claimed.rowCount) events.push({ ...event, ...claimed.rows[0] });
    }
    await client.query('commit');
    for (const event of events) {
      const recordResult = await db.query('select * from expiry_records where id = $1', [event.expiry_record_id]);
      if (!recordResult.rowCount) continue;
      const record = recordResult.rows[0];
      const message = event.status === 'FAILED' && event.message ? event.message : renderExpiryMessage(event, record, await getExpiryTemplate(db, event.event_type));
      try {
        const sent = await sendTextSms({ phone: record.customer_phone, message });
        await db.query(`update expiry_events set status='SENT', message=$1, sent_at=now(), updated_at=now() where id=$2`, [message, event.id]);
        await db.query(`insert into sms_messages (recipient, message, message_type, status, provider, provider_message_id, event_key, network, created_by, source, order_reference, voucher_code, package_name, package_price, sent_at) values ($1,$2,$3,'SENT','TextSMS',$4,$5,'Safaricom','system','expiry-alerts',$6,$7,$8,$9,now()) on conflict (event_key) do nothing`, [record.customer_phone, message, event.event_type, sent.messageId, event.event_key, record.order_reference, record.voucher_code, record.package_name, record.package_price]);
        await db.query(`insert into expiry_audit_log (expiry_record_id,event_id,action,details) values ($1,$2,'EXPIRY_REMINDER_SENT',$3)`, [record.id, event.id, JSON.stringify({ recipient: maskPhone(record.customer_phone) })]);
      } catch (error) {
        await db.query(`update expiry_events set status='FAILED', message=$1, failure_reason=$2, failed_at=now(), updated_at=now() where id=$3`, [message, error.message, event.id]);
        await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,event_key,network,error_message,created_by,source,order_reference,voucher_code,package_name,package_price,failed_at) values ($1,$2,$3,'FAILED','TextSMS',$4,'Safaricom',$5,'system','expiry-alerts',$6,$7,$8,$9,now()) on conflict (event_key) do nothing`, [record.customer_phone, message, event.event_type, event.event_key, error.message, record.order_reference, record.voucher_code, record.package_name, record.package_price]).catch(() => {});
        await db.query(`insert into expiry_audit_log (expiry_record_id,event_id,action,details) values ($1,$2,'EXPIRY_REMINDER_FAILED',$3)`, [record.id, event.id, JSON.stringify({ reason: error.message })]);
      }
    }
    await db.query(`update expiry_records set status = case when expected_expires_at <= now() then 'EXPIRED' when expected_expires_at <= now() + interval '1 hour' then 'EXPIRING_SOON' else 'ACTIVE' end, updated_at=now() where status in ('ACTIVE','EXPIRING_SOON')`);
  } catch (error) { await client.query('rollback').catch(() => {}); console.error('[EXPIRY SCHEDULER]', error.message); } finally { client.release(); }
}
function startExpiryScheduler(db) { runExpiryScheduler(db); return setInterval(() => runExpiryScheduler(db), 60000); }
module.exports = { TIME_ZONE, parseDuration, expiryDate, formatNairobi, remainingText, renderExpiryMessage, createAndScheduleExpiry, scheduleEvents, runExpiryScheduler, startExpiryScheduler };
