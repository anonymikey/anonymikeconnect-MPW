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

function adminMessage(client) {
  const expiry = new Date(client.expected_expiry_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  return `SUPA LAN ADMIN ALERT\nOutdoor Wi-Fi client expired.\nCustomer: ${client.customer_name || 'Not provided'}\nPhone: ${client.phone}\nPackage: ${client.package_name}\nMAC: ${client.mac_address}\nExpired: ${expiry}\nACTION: Enable blacklist for this MAC on the Airtel router.\nRouter: http://192.168.1.1`;
}

function clientExpiryMessage(client, kind) {
  const expiry = new Date(client.expected_expiry_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  if (kind === 'EXPIRED') return `SUPA LAN: Your ${client.package_name} package expired at ${expiry}. Service may be disconnected until you renew.`;
  return `SUPA LAN: Reminder: your ${client.package_name} package expires in about 1 hour at ${expiry}. Renew now to avoid disconnection.`;
}

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

function clientCreatedMessage(client) {
  const expiry = new Date(client.expected_expiry_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  return `SUPA LAN: ${client.package_name} is active. MAC: ${client.mac_address}. Expires: ${expiry}. Wi-Fi access has been recorded for your number.`;
}

async function processOutdoorWifiExpiry(db) {
  const clients = await db.query(`select * from outdoor_wifi_clients where status not in ('CANCELLED','BLACKLISTED') and expected_expiry_at <= now() + interval '60 minutes' order by expected_expiry_at asc limit 100`);
  const adminPhone = await smsSetting(db);
  for (const client of clients.rows) {
    const remaining = new Date(client.expected_expiry_at).getTime() - Date.now();
    if (remaining > 0 && remaining <= 60 * 60 * 1000) await sendOutdoorSms(db, client, 'OUTDOOR_WIFI_EXPIRY_REMINDER', client.phone, clientExpiryMessage(client, 'REMINDER'));
    if (remaining <= 0) await sendOutdoorSms(db, client, 'OUTDOOR_WIFI_EXPIRY_CLIENT', client.phone, clientExpiryMessage(client, 'EXPIRED'));
  }
  const expiredClients = await db.query(`select * from outdoor_wifi_clients where status not in ('CANCELLED','BLACKLISTED') and expected_expiry_at <= now() order by expected_expiry_at asc limit 100`);
  for (const client of expiredClients.rows) {
    const event = await db.query(`insert into outdoor_wifi_action_events (client_id, event_type, status, sms_recipient, sms_message) values ($1,'ACTION_REQUIRED',$2,$3,$4) on conflict (client_id,event_type) do nothing returning id`, [client.id, adminPhone ? 'PENDING' : 'FAILED', adminPhone, adminMessage(client)]);
    await db.query(`update outdoor_wifi_clients set status='ACTION_REQUIRED', action_required_at=coalesce(action_required_at, now()), updated_at=now() where id=$1 and status not in ('BLACKLISTED','CANCELLED')`, [client.id]);
    if (event.rowCount && adminPhone) {
      try {
        const sent = await sendTextSms({ phone: adminPhone, message: adminMessage(client) });
        await db.query(`update outdoor_wifi_action_events set status='SENT',provider_message_id=$2,sent_at=now() where id=$1`, [event.rows[0].id, sent.messageId]);
        await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,provider_message_id,network,created_by,source,sent_at) values ($1,$2,'OUTDOOR_WIFI_ACTION','SENT','TextSMS',$3,'Safaricom','system','outdoor-wifi',now())`, [sent.phone, adminMessage(client), sent.messageId]);
      } catch (error) {
        await db.query(`update outdoor_wifi_action_events set status='FAILED',error_message=$2 where id=$1`, [event.rows[0].id, error.message]);
        await db.query(`insert into sms_messages (recipient,message,message_type,status,provider,network,error_message,created_by,source,failed_at) values ($1,$2,'OUTDOOR_WIFI_ACTION','FAILED','TextSMS','Safaricom',$3,'system','outdoor-wifi',now())`, [adminPhone, adminMessage(client), error.message]).catch(() => {});
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

module.exports = { normalizeMac, normalizeKenyanPhone, deriveStatus, adminMessage, clientCreatedMessage, sendOutdoorSms, processOutdoorWifiExpiry, logOutdoorWifiSmsConfig, STATUSES };
