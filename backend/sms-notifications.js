const { normalizeKenyanPhone, sendTextSms } = require('./textsms');

const ENV_AUTOMATION_ENABLED = process.env.SMS_AUTOMATION_ENABLED === 'true';
const EVENT_TYPE = 'PURCHASE_CONFIRMATION';
const REQUIRED_PLACEHOLDER = '{{voucher}}';
const SUPPORTED_PLACEHOLDERS = new Set(['{{voucher}}', '{{package}}', '{{duration}}', '{{portal_url}}', '{{support}}']);
const DEFAULT_TEMPLATE = 'SUPA LAN payment confirmed. Voucher: {{voucher}}. Package: {{package}}{{duration}}. Connect to SUPA LAN and enter your voucher.';

async function isAutomationEnabled(db) {
  if (!ENV_AUTOMATION_ENABLED) return false;
  const result = await db.query("select enabled from sms_automation_settings where key = 'master' limit 1");
  return result.rows[0]?.enabled === true;
}

function maskPhone(phone) {
  const value = String(phone || '');
  return value.length > 5 ? `${value.slice(0, 6)}***${value.slice(-3)}` : '***';
}

function validateTemplate(template) {
  const value = String(template || '').trim();
  if (!value) throw new Error('Template cannot be empty.');
  if (!value.includes(REQUIRED_PLACEHOLDER)) throw new Error('Template must include {{voucher}}.');
  const placeholders = value.match(/\{\{[^}]+\}\}/g) || [];
  const unsupported = [...new Set(placeholders.filter((placeholder) => !SUPPORTED_PLACEHOLDERS.has(placeholder)))];
  if (unsupported.length) throw new Error(`Unsupported placeholder: ${unsupported.join(', ')}`);
  if (value.length > 480) throw new Error('Template cannot exceed 480 characters.');
  return value;
}

function renderTemplate(template, values) {
  return validateTemplate(template).replace(/\{\{(voucher|package|duration|portal_url|support)\}\}/g, (_, key) => values[key] || '');
}

async function getPurchaseTemplate(db) {
  const result = await db.query("select template from sms_message_templates where message_type = $1 limit 1", [EVENT_TYPE]);
  return result.rows[0]?.template || DEFAULT_TEMPLATE;
}

async function sendPurchaseConfirmation({ db, order, voucherCode, packageName, duration }) {
  if (!(await isAutomationEnabled(db))) return { attempted: false, reason: 'SMS_AUTOMATION_DISABLED' };
  if (!order?.phone || !voucherCode) return { attempted: false, reason: 'MISSING_RECIPIENT_OR_VOUCHER' };

  const eventKey = `${EVENT_TYPE}:${order.id}`;
  const template = await getPurchaseTemplate(db);
  const message = renderTemplate(template, {
    voucher: voucherCode,
    package: packageName,
    duration: duration ? ` (${duration})` : '',
    portal_url: 'http://192.168.10.1/success',
    support: 'SUPA LAN support'
  });
  const existing = await db.query('select id, status, provider_message_id from sms_messages where event_key = $1 limit 1', [eventKey]);
  if (existing.rowCount) return { attempted: false, duplicate: true, status: existing.rows[0].status, messageId: existing.rows[0].provider_message_id };

  let phone;
  try {
    phone = normalizeKenyanPhone(order.phone);
    const result = await sendTextSms({ phone, message });
    await db.query(`insert into sms_messages (recipient, message, message_type, status, provider, provider_message_id, event_key, network, created_by, source, sent_at) values ($1, $2, $3, 'SENT', 'TextSMS', $4, $5, 'Safaricom', 'system', 'purchase-fulfillment', now())`, [phone, message, EVENT_TYPE, result.messageId, eventKey]);
    console.info('[SMS AUTOMATION]', JSON.stringify({ event: EVENT_TYPE, status: 'SENT', recipient: maskPhone(phone), order_id: order.id }));
    return { attempted: true, status: 'SENT', messageId: result.messageId };
  } catch (error) {
    await db.query(`insert into sms_messages (recipient, message, message_type, status, provider, event_key, network, error_message, created_by, source) values ($1, $2, $3, 'FAILED', 'TextSMS', $4, 'Safaricom', $5, 'system', 'purchase-fulfillment') on conflict (event_key) do nothing`, [phone || String(order.phone), message, EVENT_TYPE, eventKey, error.message]).catch(() => {});
    console.error('[SMS AUTOMATION]', JSON.stringify({ event: EVENT_TYPE, status: 'FAILED', recipient: maskPhone(phone || order.phone), order_id: order.id, error: error.message }));
    return { attempted: true, status: 'FAILED', error: error.message };
  }
}

const FREE_ACCESS_EVENT_TYPE = 'FREE_ACCESS';
const FREE_ACCESS_DEFAULT_TEMPLATE = 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. Support: {{support}}';
const FREE_ACCESS_SUPPORTED_PLACEHOLDERS = new Set(['{{voucher}}', '{{portal_url}}', '{{support}}']);

function validateFreeAccessTemplate(template) {
  const value = String(template || '').trim();
  if (!value || !value.includes(REQUIRED_PLACEHOLDER)) throw new Error('Template must include {{voucher}}.');
  const placeholders = value.match(/\{\{[^}]+\}\}/g) || [];
  const unsupported = [...new Set(placeholders.filter((placeholder) => !FREE_ACCESS_SUPPORTED_PLACEHOLDERS.has(placeholder)))];
  if (unsupported.length) throw new Error(`Unsupported placeholder: ${unsupported.join(', ')}`);
  if (value.length > 480) throw new Error('Template cannot exceed 480 characters.');
  return value;
}

async function renderFreeAccessMessage({ db, voucherCode }) {
  const templateResult = await db.query('select template from sms_message_templates where message_type = $1 limit 1', [FREE_ACCESS_EVENT_TYPE]);
  const template = validateFreeAccessTemplate(templateResult.rows[0]?.template || FREE_ACCESS_DEFAULT_TEMPLATE);
  return template.replace(/\{\{(voucher|portal_url|support)\}\}/g, (_, key) => ({ voucher: voucherCode, portal_url: 'http://192.168.10.1/', support: 'SUPA LAN support' }[key] || ''));
}

async function enqueueFreeAccessConfirmation({ db, phone, voucherCode, eventKey }) {
  if (!phone || !voucherCode || !eventKey) return { queued: false, reason: 'MISSING_FREE_ACCESS_FIELDS' };
  const normalizedPhone = normalizeKenyanPhone(phone);
  const message = await renderFreeAccessMessage({ db, voucherCode });
  const result = await db.query(`insert into sms_messages
    (recipient, message, message_type, status, provider, event_key, network, created_by, source, next_attempt_at)
    values ($1, $2, $3, 'QUEUED', 'TextSMS', $4, 'Safaricom', 'system', 'FREE_ACCESS_AUTOMATION', now())
    on conflict (event_key) do nothing
    returning id, status`, [normalizedPhone, message, FREE_ACCESS_EVENT_TYPE, eventKey]);
  return result.rowCount
    ? { queued: true, status: result.rows[0].status, messageId: result.rows[0].id }
    : { queued: false, duplicate: true, status: 'QUEUED' };
}

async function processFreeAccessSmsQueue({ db, now = new Date() }) {
  const client = await db.connect();
  let job;
  try {
    await client.query('begin');
    const claimed = await client.query(`with candidate as (
      select id from sms_messages
      where message_type = 'FREE_ACCESS'
        and status = 'QUEUED'
        and next_attempt_at <= $1
      order by created_at asc
      for update skip locked limit 1
    )
    update sms_messages s set status = 'SENDING', locked_at = $1,
      last_attempt_at = $1, attempt_count = s.attempt_count + 1
    from candidate where s.id = candidate.id
    returning s.id, s.recipient, s.message, s.attempt_count, s.event_key`, [now]);
    if (!claimed.rowCount) { await client.query('commit'); return { processed: false }; }
    job = claimed.rows[0];
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }

  try {
    const result = await sendTextSms({ phone: job.recipient, message: job.message });
    await db.query(`update sms_messages set status = 'SENT', sent_at = now(), provider_message_id = $2,
      locked_at = null, last_error = null, error_message = null where id = $1 and status = 'SENDING'`, [job.id, result.messageId || null]);
    return { processed: true, id: job.id, status: 'SENT' };
  } catch (error) {
    const ambiguous = error.code === 'TEXTSMS_TIMEOUT' || error.name === 'AbortError';
    const retryable = !ambiguous && job.attempt_count < 3 && /HTTP 429|HTTP 5\d\d|network|temporar/i.test(error.message);
    const delay = job.attempt_count === 1 ? 30 : job.attempt_count === 2 ? 120 : 300;
    const status = ambiguous ? 'UNKNOWN' : retryable ? 'QUEUED' : 'FAILED';
    await db.query(`update sms_messages set status = $2, next_attempt_at = case when $2 = 'QUEUED' then now() + ($3 * interval '1 second') else next_attempt_at end,
      locked_at = null, last_error = $4, error_message = $4 where id = $1 and status = 'SENDING'`, [job.id, status, delay, error.message]);
    return { processed: true, id: job.id, status, error: error.message };
  }
}

async function sendFreeAccessConfirmation(args) {
  return enqueueFreeAccessConfirmation(args);
}

module.exports = { sendPurchaseConfirmation, sendFreeAccessConfirmation, enqueueFreeAccessConfirmation, processFreeAccessSmsQueue, validateTemplate, validateFreeAccessTemplate, renderTemplate, DEFAULT_TEMPLATE, EVENT_TYPE, FREE_ACCESS_EVENT_TYPE, FREE_ACCESS_DEFAULT_TEMPLATE, SUPPORTED_PLACEHOLDERS };
