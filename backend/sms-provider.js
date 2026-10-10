/**
 * Shared outbound SMS. Supports Mambo SMS, Africa's Talking, Twilio, generic SMS_API_*, or webhook.
 * Never logs full phone numbers — use maskPhone.
 */

const MAMBO_DEFAULT_BASE_URL = 'https://mambosms.co.tz/api/v1';

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/** Internal E.164-ish form used across OTP sessions (+255…). */
function normalizeSmsPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 9) return '';
  if (digits.startsWith('0') && digits.length === 10) return `+255${digits.slice(1)}`;
  if (digits.startsWith('255') || digits.startsWith('254') || digits.startsWith('256') || digits.startsWith('250')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/**
 * Mambo docs show 0713XXXXXX; many TZ gateways also accept 2557XXXXXXXX.
 * Default: 255… (no +) per product requirement; override with MAMBO_SMS_MOBILE_FORMAT=local|255.
 */
function toMamboMobile(phone) {
  const normalized = normalizeSmsPhone(phone);
  const digits = digitsOnly(normalized);
  if (!digits) return '';
  const format = String(process.env.MAMBO_SMS_MOBILE_FORMAT || '255').trim().toLowerCase();
  if (digits.startsWith('255') && digits.length >= 12) {
    if (format === 'local' || format === '0' || format === '07') {
      return `0${digits.slice(3)}`;
    }
    return digits.slice(0, 12);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    if (format === 'local' || format === '0' || format === '07') return digits;
    return `255${digits.slice(1)}`;
  }
  return digits;
}

function mamboToken() {
  return String(process.env.MAMBO_SMS_API_TOKEN || process.env.SMS_API_KEY || '').trim();
}

function mamboSenderId() {
  return String(process.env.MAMBO_SMS_SENDER_ID || process.env.SMS_SENDER_ID || '').trim();
}

function mamboBaseUrl() {
  return String(process.env.MAMBO_SMS_BASE_URL || MAMBO_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function smsConfigured() {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (provider === 'mambo' || provider === 'mambosms') {
    return Boolean(mamboToken() && mamboSenderId());
  }
  if (provider === 'africastalking') {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_API_USERNAME);
  }
  if (provider === 'twilio') {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_API_SECRET && process.env.SMS_SENDER_ID);
  }
  if (provider === 'http' || provider === 'api') {
    return Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY);
  }
  // Auto-detect Mambo when dedicated env is present and no other provider is named.
  if (!provider && mamboToken() && mamboSenderId()) return true;
  if (String(process.env.SMS_WEBHOOK_URL || '').trim()) return true;
  if (String(process.env.SMS_API_URL || '').trim() && String(process.env.SMS_API_KEY || '').trim()) return true;
  return false;
}

function resolveProvider() {
  const named = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (named) return named === 'mambosms' ? 'mambo' : named;
  if (mamboToken() && mamboSenderId()) return 'mambo';
  if (String(process.env.SMS_WEBHOOK_URL || '').trim()) return 'http';
  if (String(process.env.SMS_API_URL || '').trim() && String(process.env.SMS_API_KEY || '').trim()) return 'http';
  return '';
}

async function sendViaMambo(to, body) {
  const token = mamboToken();
  const senderId = mamboSenderId();
  if (!token || !senderId) {
    throw new Error('mambo_credentials_missing');
  }
  const mobile = toMamboMobile(to);
  if (!mobile) {
    const error = new Error('Invalid phone number.');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(`${mamboBaseUrl()}/sms/single`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender_id: senderId,
      message: body,
      mobile,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => ({}));
  const ok =
    response.ok &&
    (payload?.status === 'success' ||
      payload?.success === true ||
      Boolean(payload?.message_id) ||
      response.status === 200);

  if (!ok) {
    const detail = String(payload?.message || payload?.error?.message || payload?.error || '').slice(0, 160);
    const lower = detail.toLowerCase();
    const senderInvalid =
      response.status === 403 ||
      /sender\s*id/i.test(detail) ||
      lower.includes('invalid sender') ||
      lower.includes('sender id invalid');
    if (senderInvalid) {
      const error = new Error(
        'Sender ID ya Mambo haijaidhinishwa. Ingia kwenye Mambo SMS → Sender ID, omba jina (mf. HAUL), subiri idhini, kisha weka MAMBO_SMS_SENDER_ID sawa na jina lililoidhinishwa.'
      );
      error.statusCode = 503;
      error.code = 'mambo_sender_id_invalid';
      error.causeDetail = `mambo_${response.status}${detail ? `:${detail}` : ''}`;
      throw error;
    }
    if (response.status === 401 || /unauthenticated|invalid.?api.?key|unauthorized/i.test(detail)) {
      const error = new Error('Uthibitisho wa Mambo SMS umeshindwa. Angalia MAMBO_SMS_API_TOKEN.');
      error.statusCode = 503;
      error.code = 'mambo_unauthorized';
      throw error;
    }
    if (/insufficient|balance/i.test(detail) || response.status === 402) {
      const error = new Error('Salio la SMS limeisha. Ongeza salio kwenye Mambo SMS.');
      error.statusCode = 503;
      error.code = 'mambo_insufficient_balance';
      throw error;
    }
    const error = new Error('Imeshindwa kutuma SMS. Jaribu tena baadaye.');
    error.statusCode = 503;
    error.code = 'mambo_send_failed';
    error.causeDetail = `mambo_${response.status}${detail ? `:${detail}` : ''}`;
    throw error;
  }
  return { provider: 'mambo', messageId: payload?.message_id || null, mobileFormat: mobile };
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

  const provider = resolveProvider();
  try {
    if (provider === 'mambo') {
      return { ...(await sendViaMambo(to, body)), to, toMasked: maskPhone(to) };
    }
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

async function checkMamboBalance() {
  const token = mamboToken();
  if (!token) {
    const error = new Error('mambo_credentials_missing');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch(`${mamboBaseUrl()}/sms/balance`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`mambo_balance_${response.status}`);
  }
  return payload;
}

module.exports = {
  checkMamboBalance,
  maskPhone,
  normalizeSmsPhone,
  sendSms,
  smsConfigured,
  toMamboMobile,
};
