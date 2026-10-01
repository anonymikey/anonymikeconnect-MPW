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

async function processOutdoorWifiExpiry(db) {
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

module.exports = { normalizeMac, normalizeKenyanPhone, deriveStatus, adminMessage, processOutdoorWifiExpiry, STATUSES };
