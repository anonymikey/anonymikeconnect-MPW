const DEFAULT_ENDPOINT = 'https://sms.textsms.co.ke/api/services/sendsms/';
const KENYAN_PHONE = /^(?:254|0)(7|1)\d{8}$/;

function normalizeKenyanPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!KENYAN_PHONE.test(digits)) {
    throw new Error('Use a valid Kenyan mobile number, for example 0712345678.');
  }
  return digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
}

function maskPhone(phone) {
  const value = String(phone || '');
  return value.length > 5 ? `${value.slice(0, 6)}****${value.slice(-3)}` : '***';
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

  console.info('[SMS_PROVIDER_REQUEST]', JSON.stringify({ endpoint: config.endpoint, method: 'POST', contentType: 'application/json', senderId: config.senderId, partnerIdPresent: true, apiKeyPresent: true, mobileMasked: maskPhone(normalizedPhone), messageLength: text.length, messageEncoding: 'JSON UTF-8' }));
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
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 500) }; }
    if (!response.ok) throw new Error(`TextSMS request failed with HTTP ${response.status}.`);
    const providerResponse = Array.isArray(payload?.responses) ? payload.responses[0] || {} : (Array.isArray(payload) ? payload[0] || {} : payload);
    const responseCode = providerResponse['response-code'] ?? providerResponse['respose-code'] ?? providerResponse.response_code ?? providerResponse.responseCode ?? providerResponse.code;
    const responseDescription = providerResponse['response-description'] ?? providerResponse.response_description ?? providerResponse.responseDescription ?? providerResponse.message ?? providerResponse.error ?? providerResponse.description;
    const status = String(providerResponse.status ?? payload.status ?? '').toLowerCase();
    const description = String(responseDescription ?? '').trim().toLowerCase();
    const acceptedDescription = ['success', 'sent', 'accepted', 'processed'].some((value) => description === value || description.startsWith(`${value} `));
    const rejectedDescription = ['reject', 'failed', 'error', 'invalid', 'insufficient'].some((value) => description.includes(value));
    const success = !rejectedDescription && (acceptedDescription || providerResponse.success === true || status === 'success' || status === 'accepted');
    console.info('[SMS_PROVIDER_RESPONSE]', JSON.stringify({ httpStatus: providerResponse.statusCode || providerResponse.status || 200, providerCode: responseCode ?? null, providerDescription: responseDescription || null, mobile: maskPhone(normalizedPhone), networkId: providerResponse.networkid ?? providerResponse.networkId ?? null }));
    if (!success) {
      const providerCode = responseCode !== undefined && responseCode !== null ? ` (code ${responseCode})` : '';
      throw new Error(`TextSMS rejected the message${providerCode}: ${String(responseDescription || 'Unknown provider response').slice(0, 400)}`);
    }
    return { phone: normalizedPhone, messageId: providerResponse.messageid || providerResponse.message_id || providerResponse.messageId || providerResponse.request_id || providerResponse.requestId || null, providerResponse: payload };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { normalizeKenyanPhone, sendTextSms };
