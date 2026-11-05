/**
 * HAUL Pilots commission — TrivaPesa USSD, Agents-style accumulate-then-pay.
 * Lock when unpaid >= tier payCeiling (Bronze 25k → Silver 30k → Gold 40k → Platinum 50k).
 * Not a weekly subscription.
 */

const { FieldValue } = require('firebase-admin/firestore');

const { ensureFirebaseAdmin, readJsonBodyLimited, requireAuthenticatedUser } = require('./media-upload');
const {
  MIN_COLLECTION_TZS,
  REQUEST_NETWORKS,
  createCollection,
  driverCommissionWebhookUrl,
  eventName,
  fetchCollection,
  rawBodyString,
  requestNetwork,
  signatureHeader,
  verifyWebhookSignature,
  webhookSecret,
} = require('./trivapesa-payments');

const PAYMENT_COLLECTION = 'driverCommissionPayments';
const FRESH_PUSH_MS = 2 * 60 * 1000;
const WAIT_MESSAGE = 'Subiri uthibitisho kwenye simu.';
const INITIATING_MESSAGE = 'Inaanzisha USSD…';
const PUSHED_MESSAGE = 'Angalia simu — USSD push imetumwa';
const NETWORK_MISMATCH_MESSAGE = 'Namba hii si ya mtandao uliochagua. Chagua mtandao sahihi.';
const DEFAULT_FEE_RATE = 0.2;
const TIER_RULES = [
  { id: 'bronze', minStreak: 0, feeRate: 0.2, payCeilingTzs: 25_000 },
  { id: 'silver', minStreak: 100, feeRate: 0.18, payCeilingTzs: 30_000 },
  { id: 'gold', minStreak: 250, feeRate: 0.17, payCeilingTzs: 40_000 },
  { id: 'platinum', minStreak: 500, feeRate: 0.15, payCeilingTzs: 50_000 },
];
const HIGH_COMMISSION_RATE = 0.25;
const HIGH_COMMISSION_MIN_DECISIONS = 8;

function tierForDriver(driver) {
  const completed = Math.max(0, Math.floor(Number(driver?.completedOrderCount) || 0));
  const rejects = Math.max(
    0,
    Math.floor(Number(driver?.rejectionCount || driver?.cancellationCount) || 0)
  );
  const streak = Math.max(0, Math.floor(Number(driver?.completionStreak) || completed));
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  const highCommission = cancelRate > HIGH_COMMISSION_RATE && decisions >= HIGH_COMMISSION_MIN_DECISIONS;
  let tier = TIER_RULES[0];
  for (const rule of TIER_RULES) {
    if (streak >= rule.minStreak) tier = rule;
  }
  if (highCommission) {
    return { ...TIER_RULES[0], highCommission: true };
  }
  return { ...tier, highCommission: false };
}

function commissionPayCeilingTzs(driver) {
  return tierForDriver(driver).payCeilingTzs;
}

function commissionFeeRate(driver) {
  return tierForDriver(driver).feeRate || DEFAULT_FEE_RATE;
}

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

/** Detect M-Pesa / Mixx / Airtel from TZ MSISDN prefix when unambiguous. */
function detectNetworkFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('255')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  const prefix = local.slice(0, 2);
  if (['74', '75', '76'].includes(prefix)) return 'mpesa';
  if (['65', '67', '71', '77'].includes(prefix)) return 'mixx';
  if (['68', '69', '78'].includes(prefix)) return 'airtel';
  return '';
}

function assertPhoneMatchesNetwork(phone, network) {
  const detected = detectNetworkFromPhone(phone);
  const selected = String(network || '').trim().toLowerCase();
  if (detected && selected && detected !== selected) {
    throw badRequest(NETWORK_MISMATCH_MESSAGE);
  }
}

function pendingResponse(
  base,
  { orderId, amount, reference, duplicate = false, status = 'pending', message, pushed = false } = {}
) {
  const ref = String(reference || '').trim();
  // Gate: never claim pushed without an explicit flag AND a provider reference.
  const confirmedPush = pushed === true && Boolean(ref) && status !== 'creating';
  return {
    ...base,
    status,
    duplicate: Boolean(duplicate),
    pushed: confirmedPush,
    orderId: String(orderId || ''),
    amount: Math.round(Number(amount) || 0),
    reference: confirmedPush ? ref : undefined,
    trivapesaReference: confirmedPush ? ref : undefined,
    message:
      message ||
      (confirmedPush ? PUSHED_MESSAGE : status === 'creating' ? INITIATING_MESSAGE : WAIT_MESSAGE),
  };
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
    [
      'Malipo hayajasanidiwa.',
      'Weka namba sahihi ya simu.',
      'Weka kiasi.',
      'Kiasi kisizidi deni.',
      'Kiasi cha chini ni TSh 100.',
      'Mtandao huu haupo.',
      'Hakuna deni.',
      WAIT_MESSAGE,
      INITIATING_MESSAGE,
      PUSHED_MESSAGE,
      NETWORK_MISMATCH_MESSAGE,
      'Haijatumwa — jaribu tena',
      'USSD haijatumwa. Jaribu tena.',
    ].includes(text)
  ) {
    return text;
  }
  if (text && text.length <= 90 && !/salio|api.?key|secret|unauthorized|forbidden|internal/i.test(text)) {
    return text;
  }
  if (/salio/i.test(text)) return 'Haijatumwa — jaribu tena';
  return 'Haijatumwa — jaribu tena';
}

function parseFareTzs(order) {
  const direct = Number(order?.driverGrossEarnings || order?.agreedFareTzs || order?.fareTzs || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const label = String(order?.totalLabel || order?.fareLabel || '').replace(/[^\d]/g, '');
  const parsed = Number(label);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function isCompletedOrder(order) {
  const status = String(order?.status || '').toLowerCase();
  return status === 'delivered' || status === 'at_hub';
}

function isReconciled(order) {
  return String(order?.cashStatus || '').toLowerCase() === 'reconciled';
}

function haulFeeOf(order) {
  const explicit = Math.max(0, Math.round(Number(order?.haulFee) || 0));
  if (explicit > 0) return explicit;
  if (!isCompletedOrder(order)) return 0;
  const fare = parseFareTzs(order);
  return fare > 0 ? Math.round(fare * DEFAULT_FEE_RATE) : 0;
}

function paidTowardFee(order) {
  const fee = haulFeeOf(order);
  if (fee <= 0) return 0;
  if (isReconciled(order)) return fee;
  const paid = Math.max(0, Math.round(Number(order?.commissionPaidTzs) || 0));
  return Math.min(fee, paid);
}

function outstandingFee(order) {
  if (!isCompletedOrder(order)) return 0;
  return Math.max(0, haulFeeOf(order) - paidTowardFee(order));
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

function finishedMs(order) {
  return timeMs(order?.deliveredAt) || timeMs(order?.updatedAt) || 0;
}

function planAllocation(orders, amount) {
  const budget = Math.max(0, Math.round(Number(amount) || 0));
  const ordered = [...(orders || [])].sort((left, right) => {
    const delta = finishedMs(left) - finishedMs(right);
    if (delta) return delta;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
  let remaining = budget;
  const updates = [];
  for (const order of ordered) {
    if (remaining <= 0) break;
    const due = outstandingFee(order);
    if (due <= 0) continue;
    const take = Math.min(due, remaining);
    remaining -= take;
    const fee = haulFeeOf(order);
    const paid = paidTowardFee(order) + take;
    updates.push({
      id: String(order.id || ''),
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

async function loadDriverOrders(db, driverId) {
  const snap = await db.collection('orders').where('driverId', '==', driverId).limit(400).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function generateOrderId(driverId) {
  const dateKey = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HDP-${dateKey}-${String(driverId || '').slice(0, 8).toUpperCase()}-${randomPart}`;
}

function paymentRef(db, orderId) {
  return db.collection(PAYMENT_COLLECTION).doc(orderId);
}

function openOrderIds(driver) {
  const listed = Array.isArray(driver?.commissionOpenOrderIds) ? driver.commissionOpenOrderIds : [];
  const ids = [];
  for (const value of [...listed, driver?.commissionPayment?.orderId]) {
    const id = String(value || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(-8);
}

function summarize(rows, driver) {
  const open = rows.filter((item) => outstandingFee(item) > 0);
  const unpaidTzs = open.reduce((total, item) => total + outstandingFee(item), 0);
  const ceiling = commissionPayCeilingTzs(driver);
  const tier = tierForDriver(driver);
  return {
    ok: true,
    unpaidTzs,
    payCeilingTzs: ceiling,
    locked: unpaidTzs >= ceiling,
    canPay: unpaidTzs >= 1,
    completedOrders: rows.filter(isCompletedOrder).length,
    feeRate: commissionFeeRate(driver),
    tierId: tier.id,
    currency: 'TZS',
    provider: 'trivapesa',
  };
}

function isDriverCommissionLocked(driver, unpaidOverride) {
  const unpaid =
    unpaidOverride != null
      ? Math.max(0, Math.round(Number(unpaidOverride) || 0))
      : Math.max(0, Math.round(Number(driver?.unpaidCommissionTzs) || 0));
  return unpaid >= commissionPayCeilingTzs(driver);
}

async function readDriver(db, driverId) {
  const snap = await db.collection('drivers').doc(driverId).get();
  if (!snap.exists) throw notFound('Dereva hapana.');
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

async function syncDriverUnpaidMirror(db, driverId, unpaidTzs, driver) {
  const profile = driver || { id: driverId };
  const ceiling = commissionPayCeilingTzs(profile);
  const unpaid = Math.max(0, Math.round(Number(unpaidTzs) || 0));
  const locked = unpaid >= ceiling;
  await db.collection('drivers').doc(driverId).set(
    {
      unpaidCommissionTzs: unpaid,
      commissionPayCeilingTzs: ceiling,
      commissionLocked: locked,
      commissionFeeRate: commissionFeeRate(profile),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { unpaidTzs: unpaid, locked, payCeilingTzs: ceiling };
}

async function markIntentFailed(db, payment, reason) {
  const orderId = String(payment.orderId || payment.id || '');
  const driverId = String(payment.driverId || '');
  const driverSnap = driverId ? await db.collection('drivers').doc(driverId).get() : null;
  const driver = driverSnap?.exists ? driverSnap.data() : {};
  const openIds = openOrderIds(driver).filter((id) => id !== orderId);
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
  if (driverId) {
    writes.push((batch) =>
      batch.set(
        db.collection('drivers').doc(driverId),
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
  const driverId = String(payment.driverId || '');
  const reported = Number(remote.amount);
  const confirmed =
    Number.isFinite(reported) && reported > 0
      ? Math.round(reported)
      : Math.round(Number(payment.amount) || 0);
  if (!orderId || !driverId || !Number.isFinite(confirmed) || confirmed <= 0) {
    return { orderId, status: 'pending' };
  }
  const rows = await loadDriverOrders(db, driverId);
  const driverRef = db.collection('drivers').doc(driverId);
  const ref = paymentRef(db, orderId);
  const orderRefs = rows
    .filter((item) => outstandingFee(item) > 0)
    .map((item) => db.collection('orders').doc(item.id));

  const result = await db.runTransaction(async (transaction) => {
    const paySnap = await transaction.get(ref);
    if (!paySnap.exists) return { ignored: true, orderId };
    const current = paySnap.data() || {};
    if (String(current.status || '') === 'completed') {
      return { idempotent: true, orderId, status: 'completed', settled: true };
    }
    const orderSnaps = [];
    for (const orderDocRef of orderRefs) {
      orderSnaps.push(await transaction.get(orderDocRef));
    }
    const liveRows = orderSnaps.filter((snap) => snap.exists).map((snap) => ({ id: snap.id, ...snap.data() }));
    const plan = planAllocation(liveRows, confirmed);
    const nowIso = new Date().toISOString();
    for (const update of plan.updates) {
      const patch = {
        commissionPaidTzs: update.commissionPaidTzs,
        cashStatus: update.cashStatus,
        commissionPaymentId: orderId,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (update.cashStatus === 'reconciled') {
        patch.commissionReconciledAt = FieldValue.serverTimestamp();
      }
      transaction.set(db.collection('orders').doc(update.id), patch, { merge: true });
    }
    const remainingRows = liveRows.map((row) => {
      const hit = plan.updates.find((item) => item.id === row.id);
      if (!hit) return row;
      return { ...row, commissionPaidTzs: hit.commissionPaidTzs, cashStatus: hit.cashStatus };
    });
    const unpaidAfter = remainingRows.reduce((sum, row) => sum + outstandingFee(row), 0);
    const driverSnap = await transaction.get(driverRef);
    const driverLive = driverSnap.exists ? { id: driverSnap.id, ...driverSnap.data() } : { id: driverId };
    const ceiling = commissionPayCeilingTzs(driverLive);
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
    const openIds = openOrderIds(current).filter((id) => id !== orderId);
    transaction.set(
      driverRef,
      {
        commissionOpenOrderIds: openIds,
        unpaidCommissionTzs: unpaidAfter,
        commissionPayCeilingTzs: ceiling,
        commissionLocked: unpaidAfter >= ceiling,
        commissionPayment: {
          orderId,
          status: 'completed',
          amount: confirmed,
          allocatedTzs: plan.allocated,
          updatedAt: nowIso,
        },
        commissionStatus: unpaidAfter > 0 ? 'due' : 'clear',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { orderId, status: 'completed', settled: true, unpaidTzs: unpaidAfter };
  });
  return result;
}

async function syncPayment(db, orderId) {
  const snap = await paymentRef(db, orderId).get();
  if (!snap.exists) return { unknown: true, orderId };
  const payment = { id: snap.id, ...snap.data() };
  if (String(payment.status || '') === 'completed') {
    return { orderId, status: 'completed', settled: true, idempotent: true };
  }
  let remote = null;
  try {
    remote = await fetchCollection({
      reference: payment.trivapesaReference,
      externalId: orderId,
    });
  } catch {
    remote = null;
  }
  if (!remote) return { orderId, status: 'pending' };
  const status = normalizePaymentStatus(remote.status);
  if (status === 'failed') {
    return markIntentFailed(db, payment, remote.status);
  }
  if (status === 'completed') {
    return allocateConfirmedPayment(db, payment, remote);
  }
  return { orderId, status: 'pending' };
}

async function settleOpenPayments(db, driver) {
  const ids = openOrderIds(driver);
  const results = [];
  for (const orderId of ids) {
    results.push(await syncPayment(db, orderId));
  }
  return results;
}

function freshPending(driver) {
  const current = driver?.commissionPayment || {};
  const status = String(current.status || '').toLowerCase();
  if (status !== 'pending' && status !== 'creating') return null;
  const orderId = String(current.orderId || '').trim();
  if (!orderId) return null;
  const createdAt = Number(current.createdAtMs || 0);
  if (!createdAt || Date.now() - createdAt > FRESH_PUSH_MS) return null;
  return current;
}

async function initiateDriverCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const db = dbHandle();
  const driverId = decoded.uid;

  let driver = await readDriver(db, driverId);
  await settleOpenPayments(db, driver);
  driver = await readDriver(db, driverId);

  const rows = await loadDriverOrders(db, driverId);
  const base = summarize(rows, driver);
  await syncDriverUnpaidMirror(db, driverId, base.unpaidTzs, driver);
  if (base.unpaidTzs <= 0) throw badRequest('Hakuna deni.');

  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1) throw badRequest('Weka kiasi.');
  if (amount > base.unpaidTzs) throw badRequest('Kiasi kisizidi deni.');
  if (amount < MIN_COLLECTION_TZS) throw badRequest('Kiasi cha chini ni TSh 100.');

  const phone = normalizePhoneNumber(
    body.phoneNumber || body.buyerPhone || driver.commissionPayerPhone || driver.phoneNumber || decoded.phone_number
  );
  if (!isValidTzMobile(phone)) throw badRequest('Weka namba sahihi ya simu.');

  const selectedNetwork = String(body.network || body.method || '').trim().toLowerCase();
  if (!requestNetwork(selectedNetwork)) throw badRequest('Mtandao huu haupo.');
  assertPhoneMatchesNetwork(phone, selectedNetwork);

  const fresh = freshPending(driver);
  if (fresh) {
    const freshStatus = String(fresh.status || '').toLowerCase();
    const freshRef = String(fresh.trivapesaReference || fresh.reference || '').trim();
    // Only echo a prior push when that order is pending WITH a provider reference.
    if (freshStatus === 'pending' && freshRef) {
      return pendingResponse(base, {
        orderId: String(fresh.orderId || ''),
        amount: Number(fresh.amount || amount),
        reference: freshRef,
        duplicate: true,
        pushed: true,
        message: PUSHED_MESSAGE,
      });
    }
    // Creating / no reference yet — honest initiating state, never invent "sent".
    return pendingResponse(base, {
      orderId: String(fresh.orderId || ''),
      amount: Number(fresh.amount || amount),
      reference: '',
      duplicate: true,
      status: 'creating',
      pushed: false,
      message: INITIATING_MESSAGE,
    });
  }

  const orderId = generateOrderId(driverId);
  const driverName = String(driver.fullName || driver.displayName || driver.name || 'HAUL Pilot').trim();
  const createdAtMs = Date.now();
  const callbackUrl = driverCommissionWebhookUrl();

  // Reserve the in-flight slot before TrivaPesa so a second tap cannot start another push.
  // Clear any stale provider reference from a prior merge so we never echo a fake "pushed".
  await paymentRef(db, orderId).set({
    orderId,
    driverId,
    amount,
    currency: 'TZS',
    status: 'creating',
    provider: 'trivapesa',
    network: selectedNetwork,
    payerPhone: phone,
    buyerName: driverName,
    callbackUrl,
    trivapesaReference: '',
    providerStatus: '',
    createdAtMs,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const nowIso = new Date().toISOString();
  await db.collection('drivers').doc(driverId).set(
    {
      commissionPayerPhone: phone,
      commissionPayment: {
        orderId,
        status: 'creating',
        amount,
        network: selectedNetwork,
        payerPhone: phone,
        trivapesaReference: '',
        reference: '',
        createdAtMs,
        updatedAt: nowIso,
      },
      commissionStatus: 'pending',
    },
    { merge: true }
  );

  try {
    console.log('[ussd] driver create', driverId.slice(0, 8), orderId, selectedNetwork, amount);
    const created = await createCollection({
      amount,
      phone,
      customerName: driverName,
      externalId: orderId,
      network: selectedNetwork,
      callbackUrl,
      idempotencyKey: orderId,
    });
    const providerStatus = normalizePaymentStatus(created.status);
    const createdRef = String(created.reference || '').trim();
    if (providerStatus === 'failed') {
      await markIntentFailed(db, { orderId, driverId, amount }, created.status);
      throw badRequest('Haijatumwa — jaribu tena');
    }
    if (!createdRef) {
      console.warn('[ussd] driver initiate missing reference', orderId, created.status || 'no_status');
      throw badRequest('Haijatumwa — jaribu tena');
    }
    const openIds = [...openOrderIds(driver), orderId].slice(-8);
    await paymentRef(db, orderId).set(
      {
        status: 'pending',
        trivapesaReference: createdRef,
        providerStatus: created.status || 'PENDING',
        providerNetwork: created.network || REQUEST_NETWORKS[selectedNetwork] || '',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('drivers').doc(driverId).set(
      {
        commissionPayerPhone: phone,
        commissionOpenOrderIds: openIds,
        commissionPayment: {
          orderId,
          status: 'pending',
          amount,
          network: selectedNetwork,
          payerPhone: phone,
          trivapesaReference: createdRef,
          createdAtMs,
          updatedAt: new Date().toISOString(),
        },
        commissionStatus: 'pending',
      },
      { merge: true }
    );
    console.log(
      '[ussd] driver pushed',
      orderId,
      created.idempotentReplay ? 'replay' : 'new',
      'status=' + String(created.status || 'PENDING'),
      'ref=' + createdRef.slice(0, 18)
    );
    if (providerStatus === 'completed') {
      const settled = await syncPayment(db, orderId);
      const after = await loadDriverOrders(db, driverId);
      return {
        ...summarize(after, driver),
        status: settled?.status || 'completed',
        settled: settled?.settled === true,
        pushed: true,
        orderId,
        amount,
        reference: createdRef,
        trivapesaReference: createdRef,
        message: settled?.settled ? '' : PUSHED_MESSAGE,
      };
    }
    return pendingResponse(base, {
      orderId,
      amount,
      reference: createdRef,
      duplicate: Boolean(created.idempotentReplay),
      pushed: true,
      message: PUSHED_MESSAGE,
    });
  } catch (error) {
    const snap = await paymentRef(db, orderId).get().catch(() => null);
    const status = String(snap?.data()?.status || '');
    if (status === 'creating' || status === 'pending') {
      let remote = null;
      try {
        remote = await fetchCollection({
          reference: snap?.data()?.trivapesaReference,
          externalId: orderId,
        });
      } catch {
        remote = null;
      }
      if (remote && normalizePaymentStatus(remote.status) !== 'failed' && String(remote.reference || '').trim()) {
        const remoteRef = String(remote.reference || '').trim();
        const openIds = [...openOrderIds(driver), orderId].slice(-8);
        await paymentRef(db, orderId).set(
          {
            status: 'pending',
            trivapesaReference: remoteRef,
            providerStatus: remote.status || 'PENDING',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await db.collection('drivers').doc(driverId).set(
          {
            commissionOpenOrderIds: openIds,
            commissionPayment: {
              orderId,
              status: 'pending',
              amount,
              network: selectedNetwork,
              payerPhone: phone,
              trivapesaReference: remoteRef,
              createdAtMs,
              updatedAt: new Date().toISOString(),
            },
            commissionStatus: 'pending',
          },
          { merge: true }
        );
        return pendingResponse(base, {
          orderId,
          amount,
          reference: remoteRef,
          duplicate: true,
          pushed: true,
          message: PUSHED_MESSAGE,
        });
      }
      if (status === 'creating') {
        await markIntentFailed(db, { orderId, driverId, amount }, 'FAILED').catch(() => undefined);
      }
    }
    const message = publicPayError(error);
    console.warn('[ussd] driver init failed', orderId, error?.providerCode || error?.statusCode || 'error', message);
    const statusCode = Number(error?.statusCode);
    if (statusCode === 503) {
      const unavailable = badRequest(message);
      unavailable.statusCode = 503;
      throw unavailable;
    }
    if ((statusCode === 502 || statusCode === 429) && error?.retryable) {
      const retryable = badRequest(message);
      retryable.statusCode = statusCode;
      throw retryable;
    }
    if (error?.statusCode === 400 && message === String(error.message || '')) throw error;
    throw badRequest(message);
  }
}

async function verifyDriverCommissionPayment(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 8 * 1024).catch(() => ({}));
  const db = dbHandle();
  const driverId = decoded.uid;
  let driver = await readDriver(db, driverId);
  const requested = String(body?.orderId || '').trim();
  if (requested && !openOrderIds(driver).includes(requested)) {
    const snap = await paymentRef(db, requested).get();
    if (snap.exists && String(snap.data()?.driverId || '') === driverId) {
      await syncPayment(db, requested);
    }
  }
  const results = await settleOpenPayments(db, driver);
  driver = await readDriver(db, driverId);
  const rows = await loadDriverOrders(db, driverId);
  const summary = summarize(rows, driver);
  await syncDriverUnpaidMirror(db, driverId, summary.unpaidTzs, driver);
  const latest = results.filter(Boolean).reverse().find((item) => item.orderId) || {};
  const payStatus = String(driver.commissionPayment?.status || '').toLowerCase();
  const pending = payStatus === 'pending' || payStatus === 'creating';
  const reference = String(
    driver.commissionPayment?.trivapesaReference || driver.commissionPayment?.reference || ''
  ).trim();
  const watched = results.find((item) => requested && item?.orderId === requested);
  const watchedFailed = watched?.status === 'failed';
  let message = '';
  if (pending) {
    message = reference ? 'Angalia simu yako' : INITIATING_MESSAGE;
  } else if (watchedFailed) {
    message = 'Malipo hayajakamilika.';
  }
  return {
    ...summary,
    status: pending
      ? payStatus === 'creating'
        ? 'creating'
        : 'pending'
      : watchedFailed
        ? 'failed'
        : watched?.status === 'completed'
          ? 'completed'
          : summary.unpaidTzs > 0
            ? 'due'
            : 'clear',
    settled: results.some((item) => item?.settled === true || item?.status === 'completed'),
    orderId: pending ? String(driver.commissionPayment?.orderId || '') : requested || latest.orderId || '',
    pushed: pending ? Boolean(reference) : undefined,
    reference: reference || undefined,
    trivapesaReference: reference || undefined,
    message,
  };
}

async function handleDriverCommissionWebhook(req) {
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

async function getDriverCommissionStatus(req) {
  const decoded = await requireAuthenticatedUser(req);
  const db = dbHandle();
  const driverId = decoded.uid;
  let driver = await readDriver(db, driverId);
  await settleOpenPayments(db, driver).catch(() => []);
  driver = await readDriver(db, driverId);
  const rows = await loadDriverOrders(db, driverId);
  const summary = summarize(rows, driver);
  await syncDriverUnpaidMirror(db, driverId, summary.unpaidTzs, driver);
  return {
    ...summary,
    networks: [
      { key: 'mpesa', label: 'M-Pesa', provider: 'Vodacom', color: '#00A651', enabled: true },
      { key: 'mixx', label: 'Mixx by Yas', provider: 'Tigo / Yas', color: '#E6007E', enabled: true },
      { key: 'airtel', label: 'Airtel Money', provider: 'Airtel', color: '#ED1C24', enabled: true },
    ],
    latestPayment: driver.commissionPayment || null,
    status: summary.locked ? 'locked' : summary.unpaidTzs > 0 ? 'due' : 'clear',
  };
}

module.exports = {
  WAIT_MESSAGE,
  INITIATING_MESSAGE,
  PUSHED_MESSAGE,
  allocateConfirmedPayment,
  commissionFeeRate,
  commissionPayCeilingTzs,
  getDriverCommissionStatus,
  handleDriverCommissionWebhook,
  haulFeeOf,
  initiateDriverCommissionPayment,
  isDriverCommissionLocked,
  outstandingFee,
  planAllocation,
  summarize,
  verifyDriverCommissionPayment,
};
