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

module.exports = { sendPurchaseConfirmation, validateTemplate, renderTemplate, DEFAULT_TEMPLATE, EVENT_TYPE, SUPPORTED_PLACEHOLDERS };
