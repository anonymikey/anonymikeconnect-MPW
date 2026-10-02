const { normalizeKenyanPhone, sendTextSms } = require('./textsms');

const STATUSES = new Set(['ACTIVE', 'EXPIRING_SOON', 'ACTION_REQUIRED', 'BLACKLISTED', 'CANCELLED']);

function normalizeMac(value) {
  const compact = String(value || '').replace(/[^a-f\d]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(compact)) throw new Error('Enter a valid MAC address, for example 72:28:F1:E8:D3:B0.');
  return compact.match(/.{2}/g).join(':');
}

function deriveStatus(row, now = new Date()) {
  if (row.status === 'CANCELLED') return 'CANCELLED';
  if (row.blacklist_enabled) return 'BLACKLISTED';
  const expiry = new Date(row.expected_expiry_at);
  if (expiry <= now) return 'ACTION_REQUIRED';
  if (expiry <= new Date(now.getTime() + 60 * 60 * 1000)) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

const OUTDOOR_TEMPLATES = {
  OUTDOOR_WIFI_CLIENT_CREATED: 'SUPA LAN 📶 Welcome! Your {{package}} Wi-Fi access is active ✅\nExpires: {{expiry}}\n\nWi-Fi: MONTHLY-450/- (UNLTD)-0113313240\nPassword: t.s@20202027\nPlease do not share the password.\n\nMonthly offers: 400/- | 2 devices: 750/-\nSupport: 0113313240\nOffers: supalan.anonymiketech.space',
  OUTDOOR_WIFI_CLIENT_UPDATED: 'SUPA LAN 📶 Your {{package}} access was updated ✅\nNew expiry: {{expiry}}\n\nNeed help or a renewal? Support: 0113313240\nOffers: supalan.anonymiketech.space',
  OUTDOOR_WIFI_EXPIRY_REMINDER: 'SUPA LAN ⏰ Your {{package}} access expires in about 1 hour.\nExpiry: {{expiry}}\n\nRenewal support: 0113313240\nOffers: supalan.anonymiketech.space',
  OUTDOOR_WIFI_EXPIRY_CLIENT: 'SUPA LAN ⚠️ Your {{package}} access has expired.\nExpired: {{expiry}}\n\nPlease contact support to renew: 0113313240\nOffers: supalan.anonymiketech.space',
  OUTDOOR_WIFI_ACTION: 'SUPA LAN ROUTER ALERT 🚨\nCustomer: {{customer}}\nPhone: {{phone}}\nPackage: {{package}}\nMAC address: {{mac}}\nExpired: {{expiry}}\n\nACTION REQUIRED: Add this MAC to the Airtel blacklist.\nRouter: http://192.168.1.1\nSupport: 0113313240'
};
const OUTDOOR_PLACEHOLDERS = /\{\{(package|mac|expiry|customer|phone)\}\}/g;

function renderOutdoorTemplate(template, client) {
  const expiry = new Date(client.expected_expiry_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  return String(template).replace(OUTDOOR_PLACEHOLDERS, (_, key) => ({ package: client.package_name || '', mac: client.mac_address || '', expiry, customer: client.customer_name || 'Not provided', phone: client.phone || '' }[key] || ''));
}

async function getOutdoorMessage(db, eventType, client) {
  const result = await db.query('select template from sms_message_templates where message_type=$1 limit 1', [eventType]).catch(() => ({ rows: [] }));
  return renderOutdoorTemplate(result.rows[0]?.template || OUTDOOR_TEMPLATES[eventType] || '', client);
}

function adminMessage(client) { return renderOutdoorTemplate(OUTDOOR_TEMPLATES.OUTDOOR_WIFI_ACTION, client); }
function clientCreatedMessage(client) { return renderOutdoorTemplate(OUTDOOR_TEMPLATES.OUTDOOR_WIFI_CLIENT_CREATED, client); }
function clientExpiryMessage(client, kind) { return renderOutdoorTemplate(OUTDOOR_TEMPLATES[kind === 'EXPIRED' ? 'OUTDOOR_WIFI_EXPIRY_CLIENT' : 'OUTDOOR_WIFI_EXPIRY_REMINDER'], client); }

function maskPhone(phone) {
  const value = String(phone || '');
  return value.length > 5 ? `${value.slice(0, 6)}******${value.slice(-2)}` : '***';
}

async function smsSetting(db) {
  const result = await db.query('select admin_phone from sms_admin_settings where id = true limit 1').catch(() => ({ rows: [] }));
  const configured = result.rows[0]?.admin_phone || process.env.OUTDOOR_WIFI_ADMIN_PHONE || process.env.ADMIN_PHONE || null;
  if (!configured) return null;
  try { return normalizeKenyanPhone(configured); } catch (error) { console.error('[OUTDOOR_WIFI_SMS_CONFIG] Admin alert number is invalid; SMS disabled for admin alerts.'); return null; }
}

async function logOutdoorWifiSmsConfig(db) {
  const raw = await db.query('select admin_phone from sms_admin_settings where id = true limit 1').catch(() => ({ rows: [] }));
  const configured = raw.rows[0]?.admin_phone || process.env.OUTDOOR_WIFI_ADMIN_PHONE || process.env.ADMIN_PHONE || null;
  let normalized = null;
  try { normalized = configured ? normalizeKenyanPhone(configured) : null; } catch (_) {}
  console.info('[OUTDOOR_WIFI_SMS_CONFIG]', JSON.stringify({ adminAlertNumberConfigured: configured ? 'YES' : 'NO', normalizedMaskedNumber: normalized ? maskPhone(normalized) : null, outdoorWifiAdminSmsTargetConfigured: normalized ? 'YES' : 'NO' }));
}

async function sendOutdoorSms(db, client, eventType, recipient, message) {
  const event = await db.query(`insert into outdoor_wifi_action_events (client_id,event_type,status,sms_recipient,sms_message) values ($1,$2,'PENDING',$3,$4) on conflict (client_id,event_type) do nothing returning id`, [client.id, eventType, recipient, message]);
  if (!event.rowCount) return { attempted: false, status: 'DUPLICATE' };
  if (!recipient) return { attempted: false, status: 'FAILED', error: 'Client phone number is not configured.' };
  try {
    const sent = await sendTextSms({ phone: recipient, message });
    await db.query(`update outdoor_wifi_action_events set status='SENT',provider_message_id=$2,sent_at=now() where id=$1`, [event.rows[0].id, sent.messageId]);
    await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,provider_message_id,network,created_by,source,sent_at) values ($1,$2,$3,'SENT','TextSMS',$4,'Safaricom','system','outdoor-wifi',now())`, [sent.phone, message, eventType, sent.messageId]);
    return { attempted: true, status: 'SENT', messageId: sent.messageId };
  } catch (error) {
    await db.query(`update outdoor_wifi_action_events set status='FAILED',error_message=$2 where id=$1`, [event.rows[0].id, error.message]);
    await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,network,error_message,created_by,source,failed_at) values ($1,$2,$3,'FAILED','TextSMS','Safaricom',$4,'system','outdoor-wifi',now()) on conflict do nothing`, [recipient, message, eventType, error.message]).catch(() => {});
    return { attempted: true, status: 'FAILED', error: error.message };
  }
}

async function processOutdoorWifiExpiry(db) {
  const clients = await db.query(`select * from outdoor_wifi_clients where status not in ('CANCELLED','BLACKLISTED') and expected_expiry_at <= now() + interval '60 minutes' order by expected_expiry_at asc limit 100`);
  const adminPhone = await smsSetting(db);
  for (const client of clients.rows) {
    const remaining = new Date(client.expected_expiry_at).getTime() - Date.now();
if (remaining > 0 && remaining <= 60 * 60 * 1000) await sendOutdoorSms(db, client, 'OUTDOOR_WIFI_EXPIRY_REMINDER', client.phone, await getOutdoorMessage(db, 'OUTDOOR_WIFI_EXPIRY_REMINDER', client));
  if (remaining <= 0) await sendOutdoorSms(db, client, 'OUTDOOR_WIFI_EXPIRY_CLIENT', client.phone, await getOutdoorMessage(db, 'OUTDOOR_WIFI_EXPIRY_CLIENT', client));
  }
  const expiredClients = await db.query(`select * from outdoor_wifi_clients where status not in ('CANCELLED','BLACKLISTED') and expected_expiry_at <= now() order by expected_expiry_at asc limit 100`);
  for (const client of expiredClients.rows) {
    const adminAlert = await getOutdoorMessage(db, 'OUTDOOR_WIFI_ACTION', client);
    const event = await db.query(`insert into outdoor_wifi_action_events (client_id, event_type, status, sms_recipient, sms_message) values ($1,'ACTION_REQUIRED',$2,$3,$4) on conflict (client_id,event_type) do nothing returning id`, [client.id, adminPhone ? 'PENDING' : 'FAILED', adminPhone, adminAlert]);
    await db.query(`update outdoor_wifi_clients set status='ACTION_REQUIRED', action_required_at=coalesce(action_required_at, now()), updated_at=now() where id=$1 and status not in ('BLACKLISTED','CANCELLED')`, [client.id]);
    if (event.rowCount && adminPhone) {
      try {
        const sent = await sendTextSms({ phone: adminPhone, message: adminAlert });
        await db.query(`update outdoor_wifi_action_events set status='SENT',provider_message_id=$2,sent_at=now() where id=$1`, [event.rows[0].id, sent.messageId]);
        await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,provider_message_id,network,created_by,source,sent_at) values ($1,$2,'OUTDOOR_WIFI_ACTION','SENT','TextSMS',$3,'Safaricom','system','outdoor-wifi',now())`, [sent.phone, adminAlert, sent.messageId]);
      } catch (error) {
        await db.query(`update outdoor_wifi_action_events set status='FAILED',error_message=$2 where id=$1`, [event.rows[0].id, error.message]);
        await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,network,error_message,created_by,source,failed_at) values ($1,$2,'OUTDOOR_WIFI_ACTION','FAILED','TextSMS','Safaricom',$3,'system','outdoor-wifi',now())`, [adminPhone, adminAlert, error.message]).catch(() => {});
      }
    }
  }
  return;
}

/* Legacy implementation retained below for compatibility with existing callers. */
async function processOutdoorWifiExpiryLegacy(db) {
  const clients = await db.query(`select * from outdoor_wifi_clients where status not in ('CANCELLED','BLACKLISTED') and expected_expiry_at <= now() order by expected_expiry_at asc limit 100`);
  for (const client of clients.rows) {
    const event = await db.query(`insert into outdoor_wifi_action_events (client_id, event_type, status, sms_recipient, sms_message) values ($1,'ACTION_REQUIRED','PENDING',$2,$3) on conflict (client_id,event_type) do nothing returning id`, [client.id, process.env.OUTDOOR_WIFI_ADMIN_PHONE || process.env.ADMIN_PHONE || null, adminMessage(client)]);
    await db.query(`update outdoor_wifi_clients set status='ACTION_REQUIRED', action_required_at=coalesce(action_required_at, now()), updated_at=now() where id=$1 and status not in ('BLACKLISTED','CANCELLED')`, [client.id]);
    if (!event.rowCount) continue;
    const recipient = process.env.OUTDOOR_WIFI_ADMIN_PHONE || process.env.ADMIN_PHONE;
    if (!recipient) {
      await db.query(`update outdoor_wifi_action_events set status='FAILED', error_message='Admin SMS recipient is not configured.' where id=$1`, [event.rows[0].id]);
      continue;
    }
    try {
      const sent = await sendTextSms({ phone: recipient, message: adminMessage(client) });
      await db.query(`update outdoor_wifi_action_events set status='SENT', provider_message_id=$2, sent_at=now() where id=$1`, [event.rows[0].id, sent.messageId]);
      await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,provider_message_id,network,created_by,source,sent_at) values ($1,$2,'OUTDOOR_WIFI_ACTION','SENT','TextSMS',$3,'Safaricom','admin','outdoor-wifi',now())`, [sent.phone, adminMessage(client), sent.messageId]);
    } catch (error) {
      await db.query(`update outdoor_wifi_action_events set status='FAILED', error_message=$2 where id=$1`, [event.rows[0].id, error.message]);
      await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,network,error_message,created_by,source) values ($1,$2,'OUTDOOR_WIFI_ACTION','FAILED','TextSMS','Safaricom',$3,'admin','outdoor-wifi')`, [recipient, adminMessage(client), error.message]).catch(() => {});
    }
  }
}

module.exports = { normalizeMac, normalizeKenyanPhone, deriveStatus, adminMessage, getOutdoorMessage, sendOutdoorSms, processOutdoorWifiExpiry, logOutdoorWifiSmsConfig, STATUSES, OUTDOOR_TEMPLATES };
