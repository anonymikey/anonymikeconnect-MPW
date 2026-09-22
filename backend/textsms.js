const DEFAULT_ENDPOINT = 'https://sms.textsms.co.ke/api/services/sendsms/';
const KENYAN_PHONE = /^(?:254|0)(7|1)\d{8}$/;

function normalizeKenyanPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!KENYAN_PHONE.test(digits)) {
    throw new Error('Use a valid Kenyan mobile number, for example 0712345678.');
  }
  return digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
}

function getConfig() {
  const config = {
    apiKey: process.env.TEXTSMS_API_KEY,
    partnerId: process.env.TEXTSMS_PARTNER_ID,
    senderId: process.env.TEXTSMS_SENDER_ID,
    endpoint: process.env.TEXTSMS_ENDPOINT || DEFAULT_ENDPOINT
  };
  if (!config.apiKey || !config.partnerId || !config.senderId) {
    throw new Error('TextSMS is not configured on the server.');
  }
  return config;
}

async function sendTextSms({ phone, message }) {
  const config = getConfig();
  const normalizedPhone = normalizeKenyanPhone(phone);
  const text = String(message ?? '').trim();
  if (!text || text.length > 480) {
    throw new Error('Message must contain between 1 and 480 characters.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        apikey: config.apiKey,
        partnerID: config.partnerId,
        message: text,
        shortcode: config.senderId,
        mobile: normalizedPhone
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 200) }; }
    if (!response.ok) throw new Error(`TextSMS request failed with HTTP ${response.status}.`);
    const responseCode = payload.response_code ?? payload['response-code'] ?? payload.responseCode;
    const status = String(payload.status ?? '').toLowerCase();
    const success = payload.success === true || String(responseCode) === '200' || status === 'success' || status === 'accepted';
    if (!success) {
      const providerCode = responseCode ? ` (code ${responseCode})` : '';
      const providerMessage = payload.message || payload.error || payload.description || payload.raw;
      throw new Error(`TextSMS rejected the message${providerCode}${providerMessage ? `: ${String(providerMessage).slice(0, 240)}` : '.'}`);
    }
    return { phone: normalizedPhone, messageId: payload.message_id || payload.messageId || payload.request_id || payload.requestId || null, providerResponse: payload };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { normalizeKenyanPhone, sendTextSms };
