const { FieldValue } = require('firebase-admin/firestore');

const { ensureFirebaseAdmin, readJsonBodyLimited, requireAuthenticatedUser } = require('./media-upload');
const {
  MIN_COLLECTION_TZS,
  REQUEST_NETWORKS,
  commissionWebhookUrl,
  createCollection,
  eventName,
  fetchCollection,
  rawBodyString,
  requestNetwork,
  signatureHeader,
  verifyWebhookSignature,
  webhookSecret,
} = require('./trivapesa-payments');

const PAYMENT_COLLECTION = 'carrierCommissionPayments';
const FRESH_PUSH_MS = 2 * 60 * 1000;
const WAIT_MESSAGE = 'Subiri uthibitisho kwenye simu.';

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('255') && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith('0') && digits.length >= 10) return `255${digits.slice(1, 10)}`;
  if (digits.length === 9 && /^[67]/.test(digits)) return `255${digits}`;
  return digits;
}

function isValidTzMobile(phone) {
  return /^255[67]\d{8}$/.test(String(phone || ''));
}

function normalizePaymentStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCESSFUL', 'PAID'].includes(normalized)) return 'completed';
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(normalized)) return 'failed';
  if (['CREATING', 'CREATED', 'INITIATED', 'PROCESSING', 'PENDING'].includes(normalized)) return 'pending';
  return normalized ? 'pending' : 'pending';
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

function publicPayError(error) {
  const text = String(error?.publicMessage || error?.message || '').replace(/\s+/g, ' ').trim();
  if (
    text === 'Malipo hayajasanidiwa.' ||
    text === 'Weka namba sahihi ya simu.' ||
    text === 'Weka kiasi.' ||
    text === 'Kiasi kisizidi deni.' ||
    text === 'Kiasi cha chini ni TSh 100.' ||
    text === 'Mtandao huu haupo.' ||
    text === 'Hakuna deni.' ||
    text === 'Akaunti haina kampuni.' ||
    text === WAIT_MESSAGE
  ) {
    return text;
  }
  if (/salio/i.test(text)) return 'USSD haijatumwa. Jaribu tena.';
  return 'USSD haijatumwa. Jaribu tena.';
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

function paidTowardFee(shipment) {
  const fee = haulFeeOf(shipment);
  if (fee <= 0) return 0;
  if (isReconciled(shipment)) return fee;
  const paid = Math.max(0, Math.round(Number(shipment?.commissionPaidTzs) || 0));
  return Math.min(fee, paid);
}

function outstandingFee(shipment) {
  if (!isCompletedShipment(shipment)) return 0;
  return Math.max(0, haulFeeOf(shipment) - paidTowardFee(shipment));
}

function timeMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis() || 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function finishedMs(shipment) {
  return timeMs(shipment?.arrivedAt) || timeMs(shipment?.deliveredAt) || timeMs(shipment?.updatedAt) || 0;
}

/** Oldest finished unpaid fee first. Fully covered rows become reconciled. */
function planAllocation(shipments, amount) {
  const budget = Math.max(0, Math.round(Number(amount) || 0));
  const ordered = [...(shipments || [])].sort((left, right) => {
    const delta = finishedMs(left) - finishedMs(right);
    if (delta) return delta;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
  let remaining = budget;
  const updates = [];
  for (const shipment of ordered) {
    if (remaining <= 0) break;
    const due = outstandingFee(shipment);
    if (due <= 0) continue;
    const take = Math.min(due, remaining);
    remaining -= take;
    const fee = haulFeeOf(shipment);
    const paid = paidTowardFee(shipment) + take;
    updates.push({
      id: String(shipment.id || ''),
      take,
      commissionPaidTzs: paid,
      cashStatus: paid >= fee ? 'reconciled' : 'unpaid',
    });
  }
  return {
    updates,
    allocated: budget - remaining,
    unallocated: remaining,
  };
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

function openOrderIds(carrier) {
  const listed = Array.isArray(carrier?.commissionOpenOrderIds) ? carrier.commissionOpenOrderIds : [];
  const ids = [];
  for (const value of [...listed, carrier?.commissionPayment?.orderId]) {
    const id = String(value || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(-8);
}

function summarize(rows) {
  const open = rows.filter((item) => outstandingFee(item) > 0);
  const unpaidTzs = open.reduce((total, item) => total + outstandingFee(item), 0);
  return {
    ok: true,
    unpaidTzs,
    canPay: unpaidTzs >= 1,
    completedOrders: rows.filter(isCompletedShipment).length,
    currency: 'TZS',
    provider: 'trivapesa',
  };
}

async function readCarrier(db, carrierId) {
  const snap = await db.collection('carriers').doc(carrierId).get();
  if (!snap.exists) throw notFound('Kampuni haipo.');
  return { id: snap.id, ...snap.data() };
}

async function commitChunked(db, writes) {
  const size = 400;
  for (let index = 0; index < writes.length; index += size) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + size)) write(batch);
    await batch.commit();
  }
}

async function markIntentFailed(db, payment, reason) {
  const orderId = String(payment.orderId || payment.id || '');
  const carrierId = String(payment.carrierId || '');
  const carrierSnap = carrierId ? await db.collection('carriers').doc(carrierId).get() : null;
  const carrier = carrierSnap?.exists ? carrierSnap.data() : {};
  const openIds = openOrderIds(carrier).filter((id) => id !== orderId);
  const nowIso = new Date().toISOString();
  const writes = [
    (batch) =>
      batch.set(
        paymentRef(db, orderId),
        {
          status: 'failed',
          failureReason: 'Malipo hayajakamilika.',
          providerStatus: reason || 'FAILED',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
  ];
  if (carrierId) {
    writes.push((batch) =>
      batch.set(
        db.collection('carriers').doc(carrierId),
        {
          commissionOpenOrderIds: openIds,
          commissionPayment: {
            orderId,
            status: 'failed',
            amount: Math.round(Number(payment.amount) || 0),
            failureReason: 'Malipo hayajakamilika.',
            updatedAt: nowIso,
          },
        },
        { merge: true }
      )
    );
  }
  await commitChunked(db, writes);
  return { orderId, status: 'failed' };
}

async function allocateConfirmedPayment(db, payment, remote) {
  const orderId = String(payment.orderId || payment.id || '');
  const carrierId = String(payment.carrierId || '');
  const reported = Number(remote.amount);
  const confirmed = Number.isFinite(reported) && reported > 0
    ? Math.round(reported)
    : Math.round(Number(payment.amount) || 0);
  if (!orderId || !carrierId || !Number.isFinite(confirmed) || confirmed <= 0) {
    return { orderId, status: 'pending' };
  }
  const rows = await loadShipments(db, carrierId);
  const carrierRef = db.collection('carriers').doc(carrierId);
  const ref = paymentRef(db, orderId);
  const shipmentRefs = rows
    .filter((item) => outstandingFee(item) > 0)
    .map((item) => db.collection('carrierShipments').doc(item.id));

  return db.runTransaction(async (transaction) => {
    const paySnap = await transaction.get(ref);
    if (!paySnap.exists) return { ignored: true, orderId };
    const current = paySnap.data() || {};
    if (String(current.status || '') === 'completed') {
      return { idempotent: true, orderId, status: 'completed', settled: true };
    }
    const shipSnaps = [];
    for (const shipmentRef of shipmentRefs) {
      shipSnaps.push(await transaction.get(shipmentRef));
    }
    const carrierSnap = await transaction.get(carrierRef);
    const liveRows = shipSnaps.filter((snap) => snap.exists).map((snap) => ({ id: snap.id, ...snap.data() }));
    const plan = planAllocation(liveRows, confirmed);
    const nowIso = new Date().toISOString();
    for (const update of plan.updates) {
      const shipmentRef = db.collection('carrierShipments').doc(update.id);
      const patch = {
        commissionPaidTzs: update.commissionPaidTzs,
        cashStatus: update.cashStatus,
        commissionPaymentId: orderId,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (update.cashStatus === 'reconciled') {
        patch.commissionReconciledAt = FieldValue.serverTimestamp();
      }
      transaction.set(shipmentRef, patch, { merge: true });
    }
    transaction.set(
      ref,
      {
        status: 'completed',
        providerStatus: remote.status || 'SUCCESS',
        trivapesaReference: remote.reference || current.trivapesaReference || '',
        providerNetwork: remote.network || current.providerNetwork || '',
        confirmedAmount: confirmed,
        allocatedTzs: plan.allocated,
        unallocatedTzs: plan.unallocated,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const openIds = openOrderIds(carrierSnap.data()).filter((id) => id !== orderId);
    transaction.set(
      carrierRef,
      {
        commissionOpenOrderIds: openIds,
        commissionPayerPhone: current.payerPhone || '',
        commissionPayment: {
          orderId,
          status: 'completed',
          amount: confirmed,
          allocatedTzs: plan.allocated,
          completedAt: nowIso,
          updatedAt: nowIso,
        },
      },
      { merge: true }
    );
    return { orderId, status: 'completed', settled: true, allocatedTzs: plan.allocated };
  });
}

async function syncPayment(db, orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  const snap = await paymentRef(db, id).get();
  if (!snap.exists) return { ignored: true, orderId: id };
  const payment = { id: snap.id, ...snap.data() };
  if (String(payment.status || '') === 'completed') {
    return { idempotent: true, orderId: id, status: 'completed', settled: true };
  }
  const locallyFailed = String(payment.status || '') === 'failed';
  let remote = null;
  try {
    remote = await fetchCollection({
      reference: payment.trivapesaReference,
      externalId: payment.orderId || id,
    });
  } catch (error) {
    console.warn('trivapesa status skipped', error?.providerCode || error?.statusCode || 'error');
    if (locallyFailed) return { orderId: id, status: 'failed' };
    return { orderId: id, status: 'pending', unknown: true };
  }
  if (!remote) {
    const age = Date.now() - Number(payment.createdAtMs || 0);
    const pushed = Boolean(payment.trivapesaReference);
    const abandoned = !locallyFailed && age > (pushed ? 24 * 60 * 60 * 1000 : FRESH_PUSH_MS);
    if (abandoned) {
      await markIntentFailed(db, payment, 'FAILED');
      return { orderId: id, status: 'failed' };
    }
    return locallyFailed
      ? { orderId: id, status: 'failed' }
      : { orderId: id, status: 'pending' };
  }
  const next = normalizePaymentStatus(remote.status);
  if (next === 'completed') {
    return allocateConfirmedPayment(db, payment, remote);
  }
  if (next === 'failed') {
    if (!locallyFailed) await markIntentFailed(db, payment, remote.status);
    return { orderId: id, status: 'failed' };
  }
  if (locallyFailed) return { orderId: id, status: 'failed' };
  return { orderId: id, status: 'pending' };
}

async function settleOpenPayments(db, carrier) {
  const results = [];
  for (const orderId of openOrderIds(carrier)) {
    results.push(await syncPayment(db, orderId));
  }
  return results;
}

function freshPending(carrier) {
  const current = carrier?.commissionPayment || {};
  if (normalizePaymentStatus(current.status) !== 'pending') return null;
  const orderId = String(current.orderId || '').trim();
  if (!orderId) return null;
  const createdAt = Number(current.createdAtMs || 0);
  if (!createdAt || Date.now() - createdAt > FRESH_PUSH_MS) return null;
  return current;
}

async function initiateCarrierCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const db = dbHandle();
  const carrierId = await resolveCarrierId(db, decoded.uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');

  let carrier = await readCarrier(db, carrierId);
  await settleOpenPayments(db, carrier);
  carrier = await readCarrier(db, carrierId);

  const rows = await loadShipments(db, carrierId);
  const base = summarize(rows);
  if (base.unpaidTzs <= 0) throw badRequest('Hakuna deni.');

  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1) throw badRequest('Weka kiasi.');
  if (amount > base.unpaidTzs) throw badRequest('Kiasi kisizidi deni.');
  if (amount < MIN_COLLECTION_TZS) throw badRequest('Kiasi cha chini ni TSh 100.');

  const phone = normalizePhoneNumber(
    body.phoneNumber || body.buyerPhone || carrier.commissionPayerPhone || carrier.phone || decoded.phone_number
  );
  if (!isValidTzMobile(phone)) throw badRequest('Weka namba sahihi ya simu.');

  const selectedNetwork = String(body.network || '').trim().toLowerCase();
  if (!requestNetwork(selectedNetwork)) throw badRequest('Mtandao huu haupo.');

  const fresh = freshPending(carrier);
  if (fresh) {
    return {
      ...base,
      status: 'pending',
      duplicate: true,
      orderId: String(fresh.orderId || ''),
      amount: Number(fresh.amount || amount),
      message: WAIT_MESSAGE,
    };
  }

  const orderId = generateOrderId(carrierId);
  const companyName = String(carrier.tradingName || carrier.companyName || carrier.name || 'HAUL carrier').trim();
  const createdAtMs = Date.now();
  await paymentRef(db, orderId).set({
    orderId,
    carrierId,
    amount,
    currency: 'TZS',
    status: 'creating',
    provider: 'trivapesa',
    network: selectedNetwork,
    payerPhone: phone,
    buyerName: companyName,
    callbackUrl: commissionWebhookUrl(),
    createdAtMs,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    const created = await createCollection({
      amount,
      phone,
      customerName: companyName,
      externalId: orderId,
      network: selectedNetwork,
    });
    const providerStatus = normalizePaymentStatus(created.status);
    if (providerStatus === 'failed') {
      await markIntentFailed(db, { orderId, carrierId, amount }, created.status);
      throw badRequest('USSD haijatumwa. Jaribu tena.');
    }
    const openIds = [...openOrderIds(carrier), orderId].slice(-8);
    const nowIso = new Date().toISOString();
    await paymentRef(db, orderId).set(
      {
        status: 'pending',
        trivapesaReference: created.reference,
        providerStatus: created.status || 'PENDING',
        providerNetwork: created.network || REQUEST_NETWORKS[selectedNetwork] || '',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('carriers').doc(carrierId).set(
      {
        commissionPayerPhone: phone,
        commissionOpenOrderIds: openIds,
        commissionPayment: {
          orderId,
          status: 'pending',
          amount,
          network: selectedNetwork,
          payerPhone: phone,
          createdAtMs,
          updatedAt: nowIso,
        },
      },
      { merge: true }
    );
    if (providerStatus === 'completed') {
      const settled = await syncPayment(db, orderId);
      const after = await loadShipments(db, carrierId);
      return {
        ...summarize(after),
        status: settled?.status || 'completed',
        settled: settled?.settled === true,
        orderId,
        amount,
        message: settled?.settled ? '' : WAIT_MESSAGE,
      };
    }
    return {
      ...base,
      status: 'pending',
      duplicate: false,
      orderId,
      amount,
      message: WAIT_MESSAGE,
    };
  } catch (error) {
    const snap = await paymentRef(db, orderId).get().catch(() => null);
    const status = String(snap?.data()?.status || '');
    if (status === 'creating') {
      let remote = null;
      try {
        remote = await fetchCollection({ externalId: orderId });
      } catch {
        remote = null;
      }
      if (remote && normalizePaymentStatus(remote.status) !== 'failed') {
        await paymentRef(db, orderId).set(
          {
            status: 'pending',
            trivapesaReference: remote.reference || '',
            providerStatus: remote.status || 'PENDING',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return {
          ...base,
          status: 'pending',
          orderId,
          amount,
          message: WAIT_MESSAGE,
        };
      }
      await markIntentFailed(db, { orderId, carrierId, amount }, 'FAILED').catch(() => undefined);
    }
    if (error?.statusCode === 400 && publicPayError(error) === String(error.message || '')) throw error;
    throw badRequest(publicPayError(error));
  }
}

async function verifyCarrierCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 8 * 1024).catch(() => ({}));
  const db = dbHandle();
  const carrierId = await resolveCarrierId(db, decoded.uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');
  let carrier = await readCarrier(db, carrierId);
  const requested = String(body?.orderId || '').trim();
  if (requested && !openOrderIds(carrier).includes(requested)) {
    const snap = await paymentRef(db, requested).get();
    if (snap.exists && String(snap.data()?.carrierId || '') === carrierId) {
      await syncPayment(db, requested);
    }
  }
  const results = await settleOpenPayments(db, carrier);
  carrier = await readCarrier(db, carrierId);
  const rows = await loadShipments(db, carrierId);
  const summary = summarize(rows);
  const latest = results.filter(Boolean).reverse().find((item) => item.orderId) || {};
  const pending = normalizePaymentStatus(carrier.commissionPayment?.status) === 'pending';
  const watched = results.find((item) => requested && item?.orderId === requested);
  const watchedFailed = watched?.status === 'failed';
  return {
    ...summary,
    status: pending ? 'pending' : watchedFailed ? 'failed' : watched?.status === 'completed' ? 'completed' : summary.unpaidTzs > 0 ? 'due' : 'clear',
    settled: results.some((item) => item?.settled === true || item?.status === 'completed'),
    orderId: pending ? String(carrier.commissionPayment?.orderId || '') : requested || latest.orderId || '',
    message: pending ? WAIT_MESSAGE : watchedFailed ? 'Malipo hayajakamilika.' : '',
  };
}

async function handleCarrierCommissionWebhook(req) {
  const raw = rawBodyString(req);
  const header = signatureHeader(req);
  if (!verifyWebhookSignature(webhookSecret(), raw, header)) {
    const error = new Error('Invalid payment webhook signature.');
    error.statusCode = 401;
    throw error;
  }
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error('Invalid payment webhook signature.');
    error.statusCode = 400;
    throw error;
  }
  const name = eventName(req, payload).toLowerCase();
  if (name && !name.startsWith('collection.')) {
    return { ignored: true, event: name };
  }
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const orderId = String(data?.external_id || payload?.external_id || '').trim();
  if (!orderId) return { ignored: true };
  const db = dbHandle();
  const snap = await paymentRef(db, orderId).get();
  if (!snap.exists) return { ignored: true, orderId };
  const result = await syncPayment(db, orderId);
  if (result?.unknown || (name === 'collection.success' && result?.status === 'pending')) {
    const error = new Error('Payment status could not be verified.');
    error.statusCode = 502;
    throw error;
  }
  return result || { ok: true, orderId };
}

module.exports = {
  WAIT_MESSAGE,
  allocateConfirmedPayment,
  handleCarrierCommissionWebhook,
  initiateCarrierCommissionPayment,
  normalizePaymentStatus,
  outstandingFee,
  paidTowardFee,
  planAllocation,
  publicPayError,
  verifyCarrierCommissionPayment,
  verifyWebhookSignature,
};
