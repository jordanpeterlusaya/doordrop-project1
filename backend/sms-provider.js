/**
 * Shared outbound SMS. Supports Africa's Talking, Twilio, generic SMS_API_*, or webhook.
 * Never logs full phone numbers — use maskPhone from carrier-sms.
 */

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeSmsPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 9) return '';
  if (digits.startsWith('0') && digits.length === 10) return `+255${digits.slice(1)}`;
  if (digits.startsWith('255') || digits.startsWith('254') || digits.startsWith('256') || digits.startsWith('250')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

function smsConfigured() {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (provider === 'africastalking') {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_API_USERNAME);
  }
  if (provider === 'twilio') {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_API_SECRET && process.env.SMS_SENDER_ID);
  }
  if (provider === 'http' || provider === 'api') {
    return Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY);
  }
  if (String(process.env.SMS_WEBHOOK_URL || '').trim()) return true;
  if (String(process.env.SMS_API_URL || '').trim() && String(process.env.SMS_API_KEY || '').trim()) return true;
  return false;
}

async function sendViaAfricasTalking(to, body) {
  const username = String(process.env.SMS_API_USERNAME || '').trim();
  const apiKey = String(process.env.SMS_API_KEY || '').trim();
  const from = String(process.env.SMS_SENDER_ID || '').trim();
  const params = new URLSearchParams();
  params.set('username', username);
  params.set('to', to);
  params.set('message', body);
  if (from) params.set('from', from);

  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      apiKey,
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`africastalking_${response.status}${text ? `:${text.slice(0, 120)}` : ''}`);
  }
  return { provider: 'africastalking' };
}

async function sendViaTwilio(to, body) {
  const accountSid = String(process.env.SMS_API_KEY || '').trim();
  const authToken = String(process.env.SMS_API_SECRET || '').trim();
  const from = String(process.env.SMS_SENDER_ID || '').trim();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', from);
  params.set('Body', body);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`twilio_${response.status}`);
  }
  return { provider: 'twilio' };
}

async function sendViaHttpApi(to, body, meta = {}) {
  const url = String(process.env.SMS_API_URL || process.env.SMS_WEBHOOK_URL || '').trim();
  if (!url) throw new Error('sms_api_url_missing');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const apiKey = String(process.env.SMS_API_KEY || process.env.SMS_WEBHOOK_TOKEN || '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to,
      body,
      message: body,
      text: body,
      ...meta,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`sms_http_${response.status}`);
  }
  return { provider: String(process.env.SMS_PROVIDER || 'http').toLowerCase() || 'http' };
}

/**
 * Send SMS via the configured provider. Throws if not configured or send fails.
 */
async function sendSms(toRaw, body, meta = {}) {
  const to = normalizeSmsPhone(toRaw);
  if (!to) {
    const error = new Error('Invalid phone number.');
    error.statusCode = 400;
    throw error;
  }
  if (!smsConfigured()) {
    const error = new Error('SMS provider is not configured.');
    error.statusCode = 503;
    error.code = 'sms_not_configured';
    throw error;
  }

  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  try {
    if (provider === 'africastalking') {
      return { ...(await sendViaAfricasTalking(to, body)), to, toMasked: maskPhone(to) };
    }
    if (provider === 'twilio') {
      return { ...(await sendViaTwilio(to, body)), to, toMasked: maskPhone(to) };
    }
    return { ...(await sendViaHttpApi(to, body, meta)), to, toMasked: maskPhone(to) };
  } catch (error) {
    console.warn('sms-provider send failed', { toMasked: maskPhone(to), reason: error?.message || 'error' });
    throw error;
  }
}

module.exports = {
  maskPhone,
  normalizeSmsPhone,
  sendSms,
  smsConfigured,
};
