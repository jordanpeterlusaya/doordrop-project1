const crypto = require('crypto');

/**
 * TrivaPesa merchant API, from the public docs at https://trivapesa.com/docs
 * (DocsPage) and checked against the live API. The dashboard page
 * https://trivapesa.com/app/webhooks is a login wall.
 *
 * Create: POST https://api.trivapesa.com/api/v1/payments/collections
 *   header x-api-key
 *   body amount, currency, customer_phone, customer_name, external_id, callback_url, network
 * Status: GET /api/v1/transactions/{reference}
 *         GET /api/v1/transactions?external_id=
 * Webhook: HMAC-SHA256 over "<timestamp>.<raw body>", header
 *   X-TrivaPesa-Signature: t=<unix>,v1=<hex> (X-TrivaPay-Signature is the same value)
 *
 * `network` is not in the docs field list. The live API requires it when it cannot
 * detect the handset, and accepts these codes (response network in parentheses):
 *   MPESA (VODACOM), TIGOPESA (TIGO), AIRTEL (AIRTEL).
 * HaloPesa is not offered in the agents pay sheet.
 */

const DEFAULT_API_BASE_URL = 'https://api.trivapesa.com';
const DEFAULT_WEBHOOK_URL =
  'https://us-central1-efootball-app-9d175.cloudfunctions.net/api/carrier/commission/webhook/trivapesa';
const MIN_COLLECTION_TZS = 100;
const SIGNATURE_TOLERANCE_SECONDS = 300;

const REQUEST_NETWORKS = {
  mpesa: 'MPESA',
  mixx: 'TIGOPESA',
  airtel: 'AIRTEL',
};

function apiKey() {
  return String(process.env.TRIVAPESA_API_KEY || process.env.TRIVAPESA_KEY || '').trim();
}

function webhookSecret() {
  return String(process.env.TRIVAPESA_WEBHOOK_SECRET || '').trim();
}

function apiBaseUrl() {
  return String(process.env.TRIVAPESA_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
}

function commissionWebhookUrl() {
  const explicit = String(process.env.TRIVAPESA_WEBHOOK_URL || '').trim();
  return explicit || DEFAULT_WEBHOOK_URL;
}

function trivapesaConfigured() {
  return Boolean(apiKey());
}

function requestNetwork(key) {
  return REQUEST_NETWORKS[String(key || '').trim().toLowerCase()] || '';
}

function rawBodyString(req) {
  if (req?.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length) {
    return req.rawBody.toString('utf8');
  }
  if (typeof req?.rawBody === 'string') return req.rawBody;
  return '';
}

function signatureHeader(req) {
  const headers = req?.headers || {};
  return String(
    headers['x-trivapesa-signature'] ||
      headers['x-trivapay-signature'] ||
      headers['X-TrivaPesa-Signature'] ||
      headers['X-TrivaPay-Signature'] ||
      ''
  ).trim();
}

function eventName(req, payload) {
  const headers = req?.headers || {};
  return String(
    headers['x-trivapesa-event'] ||
      headers['x-trivapay-event'] ||
      payload?.event ||
      ''
  ).trim();
}

function verifyWebhookSignature(secret, rawBody, header, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secretText = String(secret || '');
  const headerText = String(header || '').trim();
  const body = typeof rawBody === 'string' ? rawBody : '';
  if (!secretText || !headerText || !body) return false;
  const parts = {};
  for (const piece of headerText.split(',')) {
    const index = piece.indexOf('=');
    if (index <= 0) continue;
    parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  const timestamp = Number(parts.t);
  const given = String(parts.v1 || '');
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !given) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secretText).update(`${timestamp}.${body}`).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function pickTransaction(payload, reference) {
  const data = payload?.data;
  if (Array.isArray(data)) {
    const wanted = String(reference || '').trim();
    if (wanted) {
      const match = data.find((item) => String(item?.reference || '') === wanted);
      if (match) return match;
    }
    return data[0] || null;
  }
  if (data && typeof data === 'object') return data;
  if (payload?.reference || payload?.status) return payload;
  return null;
}

function publicProviderMessage(providerCode, providerMessage) {
  const code = String(providerCode || '').trim().toUpperCase();
  const detail = String(providerMessage || '').replace(/\s+/g, ' ').trim();
  const haystack = `${code} ${detail}`;
  if (/INVALID.?PHONE|PHONE.?NUMBER|MSISDN|customer_phone/i.test(haystack)) {
    return 'Weka namba sahihi ya simu.';
  }
  if (/INVALID.?NETWORK|UNSUPPORTED.?NETWORK|UNKNOWN.?NETWORK/i.test(haystack)) {
    return 'Mtandao huu haupo.';
  }
  if (/DUPLICATE|IDEMPOTEN/i.test(haystack)) {
    return 'Subiri uthibitisho kwenye simu.';
  }
  if (
    detail &&
    detail.length <= 90 &&
    !/salio|balance|api.?key|secret|unauthorized|forbidden|internal/i.test(detail)
  ) {
    return detail;
  }
  return 'USSD haijatumwa. Jaribu tena.';
}

async function trivapesaFetch(pathname, { method = 'GET', body, idempotencyKey } = {}) {
  const key = apiKey();
  if (!key) {
    const error = new Error('Malipo hayajasanidiwa.');
    error.statusCode = 503;
    error.publicMessage = 'Malipo hayajasanidiwa.';
    throw error;
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'HAUL-Agents/1.0',
    'x-api-key': key,
  };
  const idem = String(idempotencyKey || '').trim();
  if (idem) headers['Idempotency-Key'] = idem.slice(0, 128);
  const response = await fetch(`${apiBaseUrl()}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok || parsed?.success === false) {
    const providerCode = String(parsed?.error?.code || '').trim();
    const providerMessage = String(parsed?.error?.message || '').trim();
    console.warn(
      'trivapesa request failed',
      method,
      pathname.split('?')[0],
      response.status,
      providerCode || 'no_code',
      providerMessage ? providerMessage.slice(0, 80) : ''
    );
    const publicMessage = publicProviderMessage(providerCode, providerMessage);
    const error = new Error(publicMessage);
    error.statusCode = response.status >= 500 ? 502 : response.status === 429 ? 429 : 400;
    error.providerCode = providerCode;
    error.providerMessage = providerMessage;
    error.publicMessage = publicMessage;
    error.retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    throw error;
  }
  return parsed || {};
}

function driverCommissionWebhookUrl() {
  const explicit = String(process.env.TRIVAPESA_DRIVER_WEBHOOK_URL || '').trim();
  if (explicit) return explicit;
  const base = String(
    process.env.PUBLIC_API_BASE_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.EXPO_PUBLIC_API_BASE_URL ||
      'https://us-central1-efootball-app-9d175.cloudfunctions.net/api'
  )
    .trim()
    .replace(/\/+$/, '');
  return `${base}/driver/commission/webhook/trivapesa`;
}

async function createCollection(input) {
  const network = requestNetwork(input.network);
  const externalId = String(input.externalId || '').trim();
  const payload = {
    amount: Math.round(Number(input.amount)),
    currency: 'TZS',
    customer_phone: String(input.phone || ''),
    customer_name: String(input.customerName || 'HAUL carrier').slice(0, 80),
    external_id: externalId,
    callback_url: String(input.callbackUrl || '').trim() || commissionWebhookUrl(),
  };
  if (network) payload.network = network;
  const parsed = await trivapesaFetch('/api/v1/payments/collections', {
    method: 'POST',
    body: payload,
    idempotencyKey: String(input.idempotencyKey || externalId || '').trim(),
  });
  const record = pickTransaction(parsed, parsed?.reference) || {};
  const reference = String(parsed?.reference || record.reference || '').trim();
  if (!reference) {
    console.warn('trivapesa collection missing reference', externalId || 'no_external_id');
    const error = new Error('USSD haijatumwa. Jaribu tena.');
    error.statusCode = 502;
    error.publicMessage = 'USSD haijatumwa. Jaribu tena.';
    error.retryable = true;
    throw error;
  }
  return {
    reference,
    externalId: String(parsed?.external_id || record.external_id || externalId || ''),
    status: String(parsed?.status || record.status || 'PENDING'),
    amount: Number(record.charge_amount ?? record.amount ?? parsed?.data?.amount ?? input.amount),
    network: String(record.network || network || ''),
    idempotentReplay: parsed?.idempotent_replay === true,
  };
}

async function fetchCollection({ reference, externalId } = {}) {
  const ref = String(reference || '').trim();
  const external = String(externalId || '').trim();
  if (ref) {
    try {
      const parsed = await trivapesaFetch(`/api/v1/transactions/${encodeURIComponent(ref)}`);
      const record = pickTransaction(parsed, ref);
      if (record) return shapeRemote(record);
    } catch (error) {
      if (error?.providerCode !== 'NOT_FOUND' && error?.statusCode !== 404) throw error;
    }
  }
  if (!external) return null;
  const parsed = await trivapesaFetch(`/api/v1/transactions?external_id=${encodeURIComponent(external)}`);
  const record = pickTransaction(parsed, ref);
  return record ? shapeRemote(record) : null;
}

function shapeRemote(record) {
  return {
    reference: String(record.reference || ''),
    externalId: String(record.external_id || ''),
    status: String(record.status || ''),
    amount: Number(record.charge_amount ?? record.amount),
    network: String(record.network || ''),
    type: String(record.type || ''),
  };
}

module.exports = {
  MIN_COLLECTION_TZS,
  REQUEST_NETWORKS,
  apiKey,
  commissionWebhookUrl,
  driverCommissionWebhookUrl,
  createCollection,
  eventName,
  fetchCollection,
  rawBodyString,
  requestNetwork,
  signatureHeader,
  trivapesaConfigured,
  verifyWebhookSignature,
  webhookSecret,
};
