const { FieldValue } = require('firebase-admin/firestore');

const { ensureFirebaseAdmin, readJsonBodyLimited, requireAuthenticatedUser } = require('./media-upload');

/**
 * Unpaid HAUL commission (the haulFee stored when the offer was created)
 * is pushed once the balance reaches this amount. Tier rates change that
 * stored fee for new offers only. Keep identical to
 * COMMISSION_PAY_THRESHOLD_TZS in haulcargo-agents-app/constants/carrier-desk.ts.
 *
 * Bronze 0–99, Silver 100–249, Gold 250–499, Platinum 500+ are an unbroken
 * streak of Imefika/delivered shipments. A company reject resets that streak.
 */
const COMMISSION_PAY_THRESHOLD_TZS = 30_000;
const PAYMENT_COLLECTION = 'carrierCommissionPayments';
const USSD_HOLD_MS = 3 * 60 * 1000;
const DEFAULT_MONGIKE_API_BASE_URL = 'https://mongike.com/api/v1';

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('255') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 10) return `255${digits.slice(1, 10)}`;
  if (digits.length === 9 && /^[67]/.test(digits)) return `255${digits}`;
  return digits;
}

function isValidMongikePhone(phone) {
  return /^255[67]\d{8}$/.test(String(phone || ''));
}

function normalizePaymentStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCESSFUL', 'PAID'].includes(normalized)) return 'completed';
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(normalized)) return 'failed';
  if (normalized === 'EXPIRED') return 'expired';
  if (['CREATING', 'CREATED', 'INITIATED', 'PROCESSING', 'PENDING'].includes(normalized)) return 'pending';
  return normalized ? normalized.toLowerCase() : 'pending';
}

function enabledNetworks() {
  const enabled = String(process.env.DRIVER_PAYMENT_ENABLED_NETWORKS || 'mpesa,mixx,airtel')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [
    { key: 'mpesa', label: 'M-Pesa', enabled: enabled.includes('mpesa') },
    { key: 'mixx', label: 'Mixx by Yas', enabled: enabled.includes('mixx') },
    { key: 'airtel', label: 'Airtel Money', enabled: enabled.includes('airtel') },
  ];
}

function getMongikeApiKey() {
  return String(process.env.MONGIKE_API_KEY || '').trim();
}

function getMongikeApiBaseUrl() {
  return String(process.env.MONGIKE_API_BASE_URL || DEFAULT_MONGIKE_API_BASE_URL).trim().replace(/\/+$/, '');
}

async function callMongike(pathname, body) {
  const apiKey = getMongikeApiKey();
  if (!apiKey) {
    const error = new Error('Malipo hayajasanidiwa.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch(`${getMongikeApiBaseUrl()}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HAUL-Agents/1.0',
      'x-api-key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message = parsed?.message || parsed?.error || 'USSD haijatumwa. Jaribu tena.';
    const error = new Error(message);
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return parsed || {};
}

function callMongikeInitiatePayment(payload) {
  return callMongike('/payments/mobile-money/tanzania', payload);
}

const WALLET_HISTORY_CACHE = { at: 0, transactions: [] };

async function fetchMongikeTransactionByOrderId(orderId, mongikePaymentId, gatewayRef) {
  const now = Date.now();
  if (now - WALLET_HISTORY_CACHE.at > 20_000 || !WALLET_HISTORY_CACHE.transactions.length) {
    const payload = await callMongike('/wallet/history');
    const transactions = payload?.transactions || payload?.data || [];
    WALLET_HISTORY_CACHE.at = now;
    WALLET_HISTORY_CACHE.transactions = Array.isArray(transactions) ? transactions : [];
  }
  const wantedOrder = String(orderId || '').trim();
  const wantedId = String(mongikePaymentId || '').trim();
  const wantedRef = String(gatewayRef || '').trim();
  return (
    WALLET_HISTORY_CACHE.transactions.find((item) => {
      const reference = String(item?.reference || item?.order_id || '').trim();
      const id = String(item?.id || '').trim();
      const merchantReference = String(item?.merchantReference || item?.gateway_ref || '').trim();
      return (
        (wantedOrder && reference === wantedOrder) ||
        (wantedId && id === wantedId) ||
        (wantedRef && merchantReference === wantedRef)
      );
    }) || null
  );
}

function extractMongikePaymentRecord(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const paymentStatus = data.status || data.payment_status || payload?.payment_status || 'PENDING';
  return {
    id: data.id || '',
    gatewayRef: data.gateway_ref || data.merchantReference || data.reference || payload?.reference || '',
    status: normalizePaymentStatus(paymentStatus),
    providerStatus: paymentStatus,
    message: payload?.message || '',
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function shortPayError(error) {
  let text = String(error?.message || 'USSD haijatumwa. Jaribu tena.').replace(/\s+/g, ' ').trim();
  if (/salio la sms|sms limeisha|mambo_insufficient|not configured|mobile money is not/i.test(text)) {
    text = /not configured|mobile money is not/i.test(text)
      ? 'Malipo hayajasanidiwa.'
      : 'USSD haijatumwa. Jaribu tena.';
  }
  if (!text || text.length > 90) return 'USSD haijatumwa. Jaribu tena.';
  return text;
}

function isCompletedShipment(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').toLowerCase();
  return status === 'arrived' || status === 'delivered' || step === 'arrived' || step === 'handed';
}

function isReconciled(shipment) {
  return String(shipment?.cashStatus || '').toLowerCase() === 'reconciled';
}

function haulFeeOf(shipment) {
  return Math.max(0, Math.round(Number(shipment?.haulFee) || 0));
}

function unpaidShipments(rows) {
  return rows.filter((item) => isCompletedShipment(item) && !isReconciled(item) && haulFeeOf(item) > 0);
}

function sumFees(rows) {
  return rows.reduce((total, item) => total + haulFeeOf(item), 0);
}

function dbHandle() {
  ensureFirebaseAdmin();
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore();
}

async function resolveCarrierId(db, uid) {
  const member = await db.collection('carrierMembers').doc(uid).get();
  if (member.exists) {
    const id = String(member.data()?.carrierId || '').trim();
    if (id) return id;
  }
  const owned = await db.collection('carriers').doc(uid).get();
  if (owned.exists) return owned.id;
  return '';
}

async function loadShipments(db, carrierId) {
  const snap = await db.collection('carrierShipments').where('carrierId', '==', carrierId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function generateOrderId(carrierId) {
  const dateKey = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HCC-${dateKey}-${String(carrierId || '').slice(0, 8).toUpperCase()}-${randomPart}`;
}

function paymentRef(db, orderId) {
  return db.collection(PAYMENT_COLLECTION).doc(orderId);
}

async function commitChunked(db, writes) {
  const size = 400;
  for (let index = 0; index < writes.length; index += size) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + size)) write(batch);
    await batch.commit();
  }
}

function summarize(rows, livePending) {
  const completed = rows.filter(isCompletedShipment);
  const open = unpaidShipments(rows);
  const unpaidTzs = sumFees(open);
  const held = open.some(
    (item) =>
      String(item.cashStatus || '').toLowerCase() === 'pending_reconciliation' &&
      String(item.commissionPaymentId || '').startsWith('HCC-')
  );
  const pending = Boolean(livePending || held);
  return {
    ok: true,
    status: pending ? 'pending' : unpaidTzs >= COMMISSION_PAY_THRESHOLD_TZS ? 'due' : 'below_threshold',
    unpaidTzs,
    threshold: COMMISSION_PAY_THRESHOLD_TZS,
    canPay: unpaidTzs >= COMMISSION_PAY_THRESHOLD_TZS && !pending,
    completedOrders: completed.length,
    currency: 'TZS',
  };
}

async function applyCarrierCommissionStatus(input) {
  const db = dbHandle();
  const orderId = String(input.orderId || '').trim();
  if (!orderId) throw badRequest('order_id inahitajika.');
  const ref = paymentRef(db, orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ignored: true, orderId };
  }

  const payment = { id: snap.id, ...snap.data() };
  const current = normalizePaymentStatus(payment.status);
  if (current === 'completed') {
    return { idempotent: true, orderId, status: 'completed' };
  }

  const nextStatus = normalizePaymentStatus(input.status);
  const carrierRef = db.collection('carriers').doc(String(payment.carrierId || ''));
  const shipmentIds = Array.isArray(payment.shipmentIds) ? payment.shipmentIds.map((id) => String(id)) : [];
  const previousCashStatus = payment.previousCashStatus || {};
  const expected = Math.round(Number(payment.amount) || 0);
  const reported = Number(input.amount);
  const shortPaid = Number.isFinite(reported) && reported > 0 && reported + 0.5 < expected;
  const failed = nextStatus !== 'completed' || shortPaid;
  const nowIso = new Date().toISOString();

  if (failed) {
    const reason = shortPaid
      ? 'Kiasi si kamili.'
      : shortPayError({ message: input.providerStatus || nextStatus || 'failed' });
    const writes = [
      (batch) =>
        batch.set(
          ref,
          {
            status: 'failed',
            providerStatus: input.providerStatus || input.status || '',
            failureReason: reason,
            gatewayRef: input.reference || payment.gatewayRef || '',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      (batch) =>
        batch.set(
          carrierRef,
          {
            commissionPayment: {
              orderId,
              status: 'failed',
              amount: expected,
              failureReason: reason,
              updatedAt: nowIso,
            },
          },
          { merge: true }
        ),
    ];
    for (const shipmentId of shipmentIds) {
      const cashStatus = String(previousCashStatus[shipmentId] || 'unpaid');
      writes.push((batch) =>
        batch.set(
          db.collection('carrierShipments').doc(shipmentId),
          {
            cashStatus,
            commissionPaymentId: FieldValue.delete(),
            commissionPreviousCashStatus: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      );
    }
    await commitChunked(db, writes);
    return { orderId, status: 'failed' };
  }

  const writes = [
    (batch) =>
      batch.set(
        ref,
        {
          status: 'completed',
          providerStatus: input.providerStatus || input.status || 'COMPLETED',
          gatewayRef: input.reference || payment.gatewayRef || '',
          reference: input.reference || payment.reference || '',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    (batch) =>
      batch.set(
        carrierRef,
        {
          commissionPayment: {
            orderId,
            status: 'completed',
            amount: expected,
            completedAt: nowIso,
            updatedAt: nowIso,
          },
          commissionPayerPhone: payment.payerPhone || '',
        },
        { merge: true }
      ),
  ];
  for (const shipmentId of shipmentIds) {
    writes.push((batch) =>
      batch.set(
        db.collection('carrierShipments').doc(shipmentId),
        {
          cashStatus: 'reconciled',
          commissionPaymentId: orderId,
          commissionReconciledAt: FieldValue.serverTimestamp(),
          commissionPreviousCashStatus: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    );
  }
  await commitChunked(db, writes);
  return { orderId, status: 'completed', settled: true };
}

async function readCarrier(db, carrierId) {
  const snap = await db.collection('carriers').doc(carrierId).get();
  if (!snap.exists) throw notFound('Kampuni haipo.');
  return { id: snap.id, ...snap.data() };
}

async function settleOpenPayment(db, carrier) {
  const current = carrier?.commissionPayment || {};
  const orderId = String(current.orderId || '').trim();
  const status = normalizePaymentStatus(current.status);
  if (!orderId || !['pending', 'creating'].includes(status)) return null;
  const snap = await paymentRef(db, orderId).get();
  if (!snap.exists) return null;
  const payment = { id: snap.id, ...snap.data() };
  if (normalizePaymentStatus(payment.status) === 'completed') return { status: 'completed', settled: true };
  if (normalizePaymentStatus(payment.status) === 'failed') return { status: 'failed' };

  let remote = null;
  try {
    remote = await fetchMongikeTransactionByOrderId(
      payment.orderId || orderId,
      payment.mongikePaymentId,
      payment.gatewayRef || payment.reference
    );
  } catch (error) {
    console.warn('carrier commission verify skipped', error?.message || 'error');
  }

  if (remote) {
    const remoteStatus = normalizePaymentStatus(remote.status);
    if (remoteStatus === 'completed' || remoteStatus === 'failed' || remoteStatus === 'expired') {
      return applyCarrierCommissionStatus({
        orderId,
        status: remote.status,
        providerStatus: remote.status,
        reference: remote.merchantReference || remote.gateway_ref || payment.gatewayRef,
        amount: remote.amount || payment.amount,
      });
    }
  }

  const expiresAt = Number(current.expiresAtMs || payment.expiresAtMs || 0);
  if (expiresAt && expiresAt <= Date.now()) {
    return applyCarrierCommissionStatus({
      orderId,
      status: 'expired',
      providerStatus: 'EXPIRED',
      reference: payment.gatewayRef || '',
      amount: payment.amount,
    });
  }
  return { status: 'pending', orderId };
}

async function claimLock(db, carrierId, amount, shipmentIds) {
  const ref = db.collection('carriers').doc(carrierId);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw notFound('Kampuni haipo.');
    const data = snap.data() || {};
    const current = data.commissionPayment || {};
    const status = normalizePaymentStatus(current.status);
    const expiresAt = Number(current.expiresAtMs || 0);
    const lockedUntil = Number(current.lockedUntilMs || 0);
    const stillHeld =
      (status === 'pending' && (!expiresAt || expiresAt > Date.now())) ||
      (status === 'creating' && lockedUntil > Date.now());
    if (stillHeld) {
      return { duplicate: true, payment: current };
    }
    transaction.set(
      ref,
      {
        commissionPayment: {
          status: 'creating',
          amount,
          shipmentIds,
          lockedUntilMs: Date.now() + 70_000,
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
    return { duplicate: false, carrier: { id: snap.id, ...data } };
  });
}

async function markPushPending(db, input) {
  const expiresAtMs = Date.now() + USSD_HOLD_MS;
  const nowIso = new Date().toISOString();
  const writes = [
    (batch) =>
      batch.set(
        paymentRef(db, input.orderId),
        {
          orderId: input.orderId,
          carrierId: input.carrierId,
          amount: input.amount,
          currency: 'TZS',
          status: 'pending',
          network: input.network,
          payerPhone: input.payerPhone,
          shipmentIds: input.shipmentIds,
          previousCashStatus: input.previousCashStatus,
          mongikePaymentId: input.record.id || '',
          gatewayRef: input.record.gatewayRef || '',
          providerStatus: input.record.providerStatus || 'PENDING',
          expiresAtMs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    (batch) =>
      batch.set(
        db.collection('carriers').doc(input.carrierId),
        {
          commissionPayerPhone: input.payerPhone,
          commissionPayment: {
            orderId: input.orderId,
            status: 'pending',
            amount: input.amount,
            shipmentIds: input.shipmentIds,
            payerPhone: input.payerPhone,
            network: input.network,
            expiresAtMs,
            updatedAt: nowIso,
          },
        },
        { merge: true }
      ),
  ];
  for (const shipment of input.shipments) {
    writes.push((batch) =>
      batch.set(
        db.collection('carrierShipments').doc(shipment.id),
        {
          cashStatus: 'pending_reconciliation',
          commissionPaymentId: input.orderId,
          commissionPreviousCashStatus: String(shipment.cashStatus || 'unpaid'),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    );
  }
  await commitChunked(db, writes);
  return expiresAtMs;
}

async function markPushFailed(db, carrierId, orderId, reason) {
  const nowIso = new Date().toISOString();
  await paymentRef(db, orderId).set(
    {
      status: 'failed',
      failureReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await db.collection('carriers').doc(carrierId).set(
    {
      commissionPayment: {
        orderId,
        status: 'failed',
        failureReason: reason,
        updatedAt: nowIso,
      },
    },
    { merge: true }
  );
}

async function initiateCarrierCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const db = dbHandle();
  const carrierId = await resolveCarrierId(db, decoded.uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');

  let carrier = await readCarrier(db, carrierId);
  const settled = await settleOpenPayment(db, carrier);
  if (settled?.status === 'completed' || settled?.status === 'failed' || settled?.status === 'expired') {
    carrier = await readCarrier(db, carrierId);
  }

  const rows = await loadShipments(db, carrierId);
  const open = unpaidShipments(rows);
  const unpaidTzs = sumFees(open);
  const base = summarize(rows, false);
  if (unpaidTzs < COMMISSION_PAY_THRESHOLD_TZS) {
    return { ...base, settled: settled?.settled === true || settled?.status === 'completed' };
  }

  const phone = normalizePhoneNumber(
    body.phoneNumber || body.buyerPhone || carrier.commissionPayerPhone || carrier.phone || decoded.phone_number
  );
  if (!isValidMongikePhone(phone)) throw badRequest('Weka namba sahihi ya simu.');

  const selectedNetwork = String(body.network || 'mpesa').trim().toLowerCase();
  const networks = enabledNetworks();
  const network = networks.some((item) => item.key === selectedNetwork) ? selectedNetwork : 'mpesa';
  const networkConfig = networks.find((item) => item.key === network);
  if (!networkConfig?.enabled) throw badRequest('Mtandao huu haupo.');

  const claim = await claimLock(
    db,
    carrierId,
    unpaidTzs,
    open.map((item) => item.id)
  );
  if (claim.duplicate) {
    return {
      ...summarize(rows, true),
      status: 'pending',
      duplicate: true,
      orderId: String(claim.payment.orderId || ''),
      amount: Number(claim.payment.amount || unpaidTzs),
      canPay: false,
    };
  }

  const orderId = generateOrderId(carrierId);
  const previousCashStatus = {};
  for (const shipment of open) previousCashStatus[shipment.id] = String(shipment.cashStatus || 'unpaid');
  const companyName = String(carrier.tradingName || carrier.companyName || carrier.name || 'HAUL carrier').trim();
  const email = String(carrier.email || decoded.email || '').trim().toLowerCase();

  await paymentRef(db, orderId).set({
    orderId,
    carrierId,
    amount: unpaidTzs,
    currency: 'TZS',
    status: 'creating',
    network,
    payerPhone: phone,
    buyerName: companyName,
    shipmentIds: open.map((item) => item.id),
    previousCashStatus,
    product: 'HAUL carrier commission',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const mongikeRequest = {
    order_id: orderId,
    amount: unpaidTzs,
    buyer_phone: phone,
    buyer_name: companyName,
    ...(email ? { buyer_email: email } : {}),
    fee_payer: 'MERCHANT',
    metadata: {
      product: 'HAUL carrier commission',
      carrierId,
      app: 'haulcargo-agents',
      shipmentCount: open.length,
    },
  };

  try {
    const mongikeResponse = await callMongikeInitiatePayment(mongikeRequest);
    const record = extractMongikePaymentRecord(mongikeResponse);
    if (record.status === 'failed' || record.status === 'expired') {
      const reason = shortPayError({ message: record.message || 'USSD haijatumwa. Jaribu tena.' });
      await markPushFailed(db, carrierId, orderId, reason);
      throw badRequest(reason);
    }
    try {
      await markPushPending(db, {
        orderId,
        carrierId,
        amount: unpaidTzs,
        network,
        payerPhone: phone,
        shipmentIds: open.map((item) => item.id),
        previousCashStatus,
        shipments: open,
        record,
      });
    } catch (error) {
      console.warn('carrier commission hold write failed', error?.message || 'error');
    }
    return {
      ...summarize(rows, true),
      status: 'pending',
      duplicate: false,
      orderId,
      amount: unpaidTzs,
      canPay: false,
    };
  } catch (error) {
    const reason = shortPayError(error);
    const snap = await paymentRef(db, orderId).get().catch(() => null);
    if (normalizePaymentStatus(snap?.data()?.status) === 'creating') {
      await markPushFailed(db, carrierId, orderId, reason).catch(() => undefined);
    }
    if (error?.statusCode === 400 && reason === String(error.message || '')) throw error;
    throw badRequest(reason);
  }
}

async function verifyCarrierCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const db = dbHandle();
  const carrierId = await resolveCarrierId(db, decoded.uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');
  const carrier = await readCarrier(db, carrierId);
  const settled = await settleOpenPayment(db, carrier);
  const rows = await loadShipments(db, carrierId);
  const pending = settled?.status === 'pending';
  return {
    ...summarize(rows, pending),
    settled: settled?.status === 'completed' || settled?.settled === true,
    orderId: settled?.orderId || carrier.commissionPayment?.orderId || '',
  };
}

async function handleCarrierCommissionWebhook(req, body) {
  const apiKey = getMongikeApiKey();
  const webhookApiKey = String(req.headers['x-api-key'] || req.headers['X-Api-Key'] || '').trim();
  if (!apiKey || webhookApiKey !== apiKey) {
    const error = new Error('Invalid payment webhook signature.');
    error.statusCode = 401;
    throw error;
  }
  const payload = body && typeof body === 'object' ? body : {};
  return applyCarrierCommissionStatus({
    orderId: payload.order_id || payload.orderId || payload.reference,
    status: payload.payment_status || payload.status,
    providerStatus: payload.payment_status || payload.status,
    reference: payload.reference || payload.gateway_ref || payload.gatewayRef || payload.merchantReference,
    amount: payload.amount,
  });
}

module.exports = {
  COMMISSION_PAY_THRESHOLD_TZS,
  applyCarrierCommissionStatus,
  handleCarrierCommissionWebhook,
  initiateCarrierCommissionPayment,
  verifyCarrierCommissionPayment,
};
