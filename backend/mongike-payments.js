const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const { config } = require('./config');
const {
  buildAccessPlanState,
  canInitiateDriverAccessPayment,
  getAccessBillingPeriodKey,
  getAccessPeriodStartMillis,
  getCurrentAccessChargeTzs,
  getDriverAccessPlan,
  isDriverSubscriptionActive,
  isDriverSubscriptionPaid,
  isSameAccessBillingPeriod,
  resolveAccessPaymentDuePatch,
  resolveAccessPaidUntilMillis,
} = require('./driver-access');

const DRIVER_PAYMENTS_COLLECTION = 'driverPayments';
const DRIVER_SUBSCRIPTION_PAYMENTS_COLLECTION = 'subscriptionPayments';
const DEFAULT_MONGIKE_API_BASE_URL = 'https://mongike.com/api/v1';
const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const PAYMENT_CREATE_LOCK_MS = 75 * 1000;
const STALE_USSD_MS = 30 * 1000;

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('255') && digits.length >= 12) {
    return digits.slice(0, 12);
  }

  if (digits.startsWith('0') && digits.length >= 10) {
    return `255${digits.slice(1, 10)}`;
  }

  if (digits.length === 9 && /^[67]/.test(digits)) {
    return `255${digits}`;
  }

  return digits;
}

function isValidMongikePhone(phone) {
  return /^255[67]\d{8}$/.test(String(phone || ''));
}

const enabledPaymentNetworks = String(process.env.DRIVER_PAYMENT_ENABLED_NETWORKS || 'mpesa,mixx,airtel')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const driverPaymentRecipientPhone = String(process.env.DRIVER_PAYMENT_RECIPIENT_PHONE || '0750355402').trim();
const normalizedDriverPaymentRecipientPhone = normalizePhoneNumber(driverPaymentRecipientPhone);

function isPaymentNetworkEnabled(key) {
  return enabledPaymentNetworks.includes(key);
}

const mongikeNetworks = [
  {
    key: 'mpesa',
    label: 'M-Pesa',
    provider: 'Vodacom',
    color: '#00A651',
    enabled: isPaymentNetworkEnabled('mpesa'),
    comingSoon: !isPaymentNetworkEnabled('mpesa'),
  },
  {
    key: 'mixx',
    label: 'Mixx by Yas',
    provider: 'Tigo / Yas',
    color: '#E6007E',
    enabled: isPaymentNetworkEnabled('mixx'),
    comingSoon: !isPaymentNetworkEnabled('mixx'),
  },
  {
    key: 'airtel',
    label: 'Airtel Money',
    provider: 'Airtel',
    color: '#ED1C24',
    enabled: isPaymentNetworkEnabled('airtel'),
    comingSoon: !isPaymentNetworkEnabled('airtel'),
  },
];

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const parsedTestFeeTzs = parseNumber(process.env.DRIVER_ACCESS_TEST_FEE_TZS, 0);
const driverAccessFeeTzs = parsedTestFeeTzs > 0
  ? parsedTestFeeTzs
  : parseNumber(process.env.DRIVER_BODABODA_ACCESS_FEE_TZS || process.env.DRIVER_DAILY_ACCESS_FEE_TZS, 3500);
const driverAccessDurationHours = parseNumber(process.env.DRIVER_ACCESS_DURATION_HOURS, 24);

function ensureFirebaseAdmin() {
  if (!getApps().length) {
    const firebaseAdminOptions = {};
    if (config.firebaseServiceAccount) {
      firebaseAdminOptions.credential = cert(config.firebaseServiceAccount);
    }
    if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
      firebaseAdminOptions.projectId = config.firebaseProjectId || config.firebaseServiceAccount?.project_id;
    }
    initializeApp(firebaseAdminOptions);
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || req.headers.Authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function requireFirebaseUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Missing Firebase authorization token.');
    error.statusCode = 401;
    throw error;
  }

  try {
    const { auth } = ensureFirebaseAdmin();
    return auth.verifyIdToken(token);
  } catch {
    const error = new Error('Invalid or expired Firebase authorization token.');
    error.statusCode = 401;
    throw error;
  }
}

function getTanzaniaDateKey(value = Date.now()) {
  const date = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return date.toISOString().slice(0, 10);
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function serviceUnavailable(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function getMongikeApiKey() {
  return String(process.env.MONGIKE_API_KEY || '').trim();
}

function getMongikeApiBaseUrl() {
  return String(process.env.MONGIKE_API_BASE_URL || DEFAULT_MONGIKE_API_BASE_URL).trim().replace(/\/+$/, '');
}

function mongikeHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'DoorDrive/1.0',
    'x-api-key': getMongikeApiKey(),
    ...extra,
  };
}

async function callMongike(pathname, { method = 'GET', body } = {}) {
  const apiKey = getMongikeApiKey();
  if (!apiKey) {
    throw serviceUnavailable('Mobile money is not configured on the server.');
  }

  const response = await fetch(`${getMongikeApiBaseUrl()}${pathname}`, {
    method,
    headers: mongikeHeaders(),
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
    const message = parsed?.message || parsed?.error || responseText || `Payment provider failed with ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status >= 500 ? 502 : 400;
    error.mongikeResponse = parsed || responseText;
    throw error;
  }

  return parsed || {};
}

const WALLET_HISTORY_CACHE_TTL_MS = 20 * 1000;
let walletHistoryCache = {
  at: 0,
  transactions: [],
};

async function fetchMongikeWalletHistory() {
  const now = Date.now();
  if (now - walletHistoryCache.at < WALLET_HISTORY_CACHE_TTL_MS && walletHistoryCache.transactions.length) {
    return walletHistoryCache.transactions;
  }

  const payload = await callMongike('/wallet/history');
  const transactions = payload?.transactions || payload?.data || [];
  walletHistoryCache = {
    at: now,
    transactions: Array.isArray(transactions) ? transactions : [],
  };
  return walletHistoryCache.transactions;
}

function buildWebhookUrl(req) {
  const explicitWebhookUrl = String(process.env.MONGIKE_WEBHOOK_URL || '').trim();
  if (explicitWebhookUrl) {
    return explicitWebhookUrl;
  }

  const publicBaseUrl = String(
    process.env.PUBLIC_API_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    ''
  ).trim().replace(/\/+$/, '');

  if (publicBaseUrl) {
    return `${publicBaseUrl}/driver-payments/webhook/mongike`;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host;
  if (!host || host.includes('localhost') || host.includes('127.0.0.1')) {
    return '';
  }

  return `${forwardedProto || 'https'}://${host}/driver-payments/webhook/mongike`;
}

function getDriverPaymentRef(db, paymentId) {
  return db.collection(DRIVER_PAYMENTS_COLLECTION).doc(paymentId);
}

function getDriverPaymentMirrorRef(db, driverId, paymentId) {
  return db
    .collection('drivers')
    .doc(driverId)
    .collection(DRIVER_SUBSCRIPTION_PAYMENTS_COLLECTION)
    .doc(paymentId);
}

function getAdminPaymentReviewRef(db, paymentId) {
  return db.collection('commissionPaymentReviews').doc(paymentId);
}

function normalizePaymentStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCESSFUL', 'PAID'].includes(normalized)) {
    return 'completed';
  }
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(normalized)) {
    return normalized === 'EXPIRED' ? 'expired' : 'failed';
  }
  if (['CREATING', 'CREATED', 'INITIATED', 'PROCESSING', 'PENDING'].includes(normalized)) {
    return 'pending';
  }
  return normalized ? normalized.toLowerCase() : 'pending';
}

function extractMongikePaymentRecord(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const paymentStatus = data.status || data.payment_status || payload?.payment_status || 'PENDING';
  return {
    id: data.id || '',
    orderId: data.order_id || data.reference || payload?.order_id || '',
    gatewayRef: data.gateway_ref || data.merchantReference || data.reference || payload?.reference || '',
    amount: Number(data.amount || payload?.amount || 0),
    status: normalizePaymentStatus(paymentStatus),
    providerStatus: paymentStatus,
    expiresAt: data.expires_at || null,
    message: payload?.message || '',
  };
}

function isPendingPayment(payment) {
  const status = normalizePaymentStatus(payment?.status || payment?.localStatus);
  const expiresAt = toMillis(payment?.expiresAt || payment?.mongikeExpiresAt || payment?.localLockExpiresAt);
  return ['creating', 'pending'].includes(status) && (!expiresAt || expiresAt > Date.now());
}

function ussdAttemptAgeMs(payment, driver) {
  const created = toMillis(
    payment?.createdAt ||
    payment?.updatedAt ||
    driver?.lastSubscriptionPaymentSubmittedAt ||
    driver?.lastSubscriptionPaymentExpiresAt
  );
  return created ? Date.now() - created : Number.POSITIVE_INFINITY;
}

function isFreshUssdAttempt(payment, driver) {
  return ussdAttemptAgeMs(payment, driver) < STALE_USSD_MS;
}

function isDriverUssdLocked(driver) {
  const status = normalizePaymentStatus(driver?.lastSubscriptionPaymentStatus);
  const expiresAt = toMillis(driver?.lastSubscriptionPaymentExpiresAt);
  return ['creating', 'pending'].includes(status) && (!expiresAt || expiresAt > Date.now());
}

function buildSubscriptionState(driver, latestPayment = null, now = Date.now()) {
  const planState = buildAccessPlanState(driver, now);
  const paidUntilMillis = toMillis(driver?.subscriptionPaidUntil);
  const active = isDriverSubscriptionActive(driver, now);
  const latestStatus = normalizePaymentStatus(
    latestPayment?.status || driver?.lastSubscriptionPaymentStatus || driver?.subscriptionStatus
  );
  const pending = !active && ['creating', 'pending'].includes(latestStatus) && isPendingPayment(latestPayment || {
    status: latestStatus,
    expiresAt: driver?.lastSubscriptionPaymentExpiresAt,
  });

  let status = 'expired';
  if (planState.grace) {
    status = 'grace';
  } else if (active) {
    status = 'active';
  } else if (pending) {
    status = 'pending';
  } else if (!paidUntilMillis) {
    status = 'unpaid';
  }

  return {
    status,
    active,
    pending,
    paidUntil: paidUntilMillis ? new Date(paidUntilMillis).toISOString() : null,
    paidUntilMillis,
    now: new Date(now).toISOString(),
    dailyFee: planState.feeTzs,
    amount: planState.feeTzs,
    billingPeriodKey: planState.billingPeriodKey,
    arrearsTzs: 0,
    durationHours: planState.durationHours,
    durationDays: planState.durationDays,
    period: planState.period,
    periodLabel: planState.periodLabel,
    currency: 'TZS',
    vehicleType: planState.vehicleType,
    vehicleLabel: planState.label,
    minOrders: planState.minOrders,
    completedOrders: planState.completedOrders,
    remainingOrders: planState.remainingOrders,
    grace: planState.grace,
    canPay: planState.canPay,
    paymentRequired: planState.paymentRequired,
    message: planState.grace
      ? `Complete ${planState.remainingOrders} more ${planState.label} ${planState.remainingOrders === 1 ? 'order' : 'orders'} before access payment is required.`
      : active
        ? `${planState.label} access is active.`
        : pending
          ? 'Payment is pending. Approve the USSD prompt on your phone to activate access.'
          : `Pay TZS ${planState.feeTzs.toLocaleString()} for the current ${planState.periodLabel} only. Unused days are not billed.`,
  };
}

function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function toAdminPaymentReviewPatch(payment, extra = {}) {
  const amount = Number(extra.amount ?? payment.amount ?? 0);
  const status = extra.status || payment.status || payment.localStatus || 'pending';
  return compact({
    source: 'mongike_ussd',
    method: 'mobile_money_ussd',
    provider: payment.provider || 'mobile_money',
    paymentType: payment.paymentType,
    driverId: payment.driverId,
    driverName: payment.driverName,
    driverPhone: payment.driverPhone,
    driverEmail: payment.driverEmail,
    payerPhone: payment.payerPhone || payment.buyerPhone,
    amount,
    paymentAmount: amount,
    reviewedAmount: status === 'completed' ? amount : extra.reviewedAmount,
    subscriptionFee: amount,
    currency: payment.currency || 'TZS',
    network: payment.network,
    vehicleType: payment.vehicleType,
    vehicleLabel: payment.vehicleLabel,
    orderId: payment.orderId || payment.id,
    transactionReference:
      extra.transactionReference ||
      payment.receiptNumber ||
      payment.gatewayRef ||
      payment.reference ||
      payment.orderId ||
      payment.id,
    receiptNumber: extra.receiptNumber || payment.receiptNumber,
    dateKey: payment.dateKey,
    subscriptionPaidUntil: extra.subscriptionPaidUntil || payment.subscriptionPaidUntil,
    status,
    localStatus: extra.localStatus || status,
    gatewayRef: extra.gatewayRef || payment.gatewayRef,
    reference: extra.reference || payment.reference,
    failureReason: extra.failureReason,
    completedAt: extra.completedAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function serializePayment(payment) {
  if (!payment) {
    return null;
  }

  return {
    id: payment.id || payment.orderId || '',
    orderId: payment.orderId || payment.id || '',
    driverId: payment.driverId || '',
    amount: Number(payment.amount || 0),
    currency: payment.currency || 'TZS',
    status: normalizePaymentStatus(payment.status || payment.localStatus),
    providerStatus: payment.providerStatus || '',
    network: payment.network || '',
    recipientPhone: payment.recipientPhone || payment.merchantRecipientPhone || '',
    payerPhone: payment.payerPhone || payment.buyerPhone || '',
    buyerName: payment.buyerName || payment.driverName || '',
    gatewayRef: payment.gatewayRef || payment.reference || '',
    mongikePaymentId: payment.mongikePaymentId || '',
    receiptNumber: payment.receiptNumber || '',
    receiptUrl: payment.receiptUrl || '',
    subscriptionStartsAt: toMillis(payment.subscriptionStartsAt)
      ? new Date(toMillis(payment.subscriptionStartsAt)).toISOString()
      : null,
    subscriptionPaidUntil: toMillis(payment.subscriptionPaidUntil)
      ? new Date(toMillis(payment.subscriptionPaidUntil)).toISOString()
      : null,
    createdAt: toMillis(payment.createdAt) ? new Date(toMillis(payment.createdAt)).toISOString() : null,
    updatedAt: toMillis(payment.updatedAt) ? new Date(toMillis(payment.updatedAt)).toISOString() : null,
    completedAt: toMillis(payment.completedAt) ? new Date(toMillis(payment.completedAt)).toISOString() : null,
    expiresAt: toMillis(payment.expiresAt || payment.mongikeExpiresAt)
      ? new Date(toMillis(payment.expiresAt || payment.mongikeExpiresAt)).toISOString()
      : null,
  };
}

function buildReceiptNumber(orderId, reference) {
  const suffix = String(reference || orderId || '').replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase();
  return `DDR-${getTanzaniaDateKey().replace(/-/g, '')}-${suffix || Date.now().toString(36).toUpperCase()}`;
}

async function fetchLatestDriverPayments(db, driverId, limit = 20) {
  const snapshot = await db
    .collection('drivers')
    .doc(driverId)
    .collection(DRIVER_SUBSCRIPTION_PAYMENTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchDriverPaymentStatus(driverId, options = {}) {
  const includeHistory = options.includeHistory === true;
  const historyLimit = Number.isFinite(options.historyLimit) ? options.historyLimit : 10;
  const { db } = ensureFirebaseAdmin();
  const driverRef = db.collection('drivers').doc(driverId);
  const driverSnapshot = await driverRef.get();
  let driver = driverSnapshot.exists ? { id: driverSnapshot.id, ...driverSnapshot.data() } : null;

  if (driver) {
    const duePatch = resolveAccessPaymentDuePatch(driver);
    if (duePatch) {
      await driverRef.set({ ...duePatch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      driver = { ...driver, ...duePatch };
    }
  }

  const history = includeHistory && driver ? await fetchLatestDriverPayments(db, driverId, historyLimit) : [];
  const latestPayment =
    history[0] || (driver ? (await fetchLatestDriverPayments(db, driverId, 1))[0] || null : null);

  return {
    driverId,
    subscription: buildSubscriptionState(driver, latestPayment),
    latestPayment: serializePayment(latestPayment),
    history: includeHistory ? history.map(serializePayment) : [],
    networks: mongikeNetworks,
  };
}

function generateOrderId(driverId) {
  const dateKey = getTanzaniaDateKey().replace(/-/g, '');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DDR-${dateKey}-${String(driverId || '').slice(0, 8).toUpperCase()}-${randomPart}`;
}

async function callMongikeInitiatePayment(payload) {
  return callMongike('/payments/mobile-money/tanzania', { method: 'POST', body: payload });
}

async function fetchMongikeTransactionByOrderId(orderId, mongikePaymentId, gatewayRef) {
  const transactions = await fetchMongikeWalletHistory();
  const wantedOrder = String(orderId || '').trim();
  const wantedId = String(mongikePaymentId || '').trim();
  const wantedRef = String(gatewayRef || '').trim();

  return (
    transactions.find((item) => {
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

async function createPendingPaymentRecord(db, input) {
  const driverRef = db.collection('drivers').doc(input.driverId);
  const paymentRef = getDriverPaymentRef(db, input.orderId);
  const mirrorRef = getDriverPaymentMirrorRef(db, input.driverId, input.orderId);
  let existingPayment = null;
  let activeSubscription = null;

  await db.runTransaction(async (transaction) => {
    const driverSnapshot = await transaction.get(driverRef);

    if (!driverSnapshot.exists) {
      throw badRequest('Driver profile was not found.');
    }

    const driver = { id: driverSnapshot.id, ...driverSnapshot.data() };
    if (!canInitiateDriverAccessPayment(driver)) {
      throw badRequest(
        `Complete at least ${getDriverAccessPlan(driver).minOrders} delivered orders before paying for ${getDriverAccessPlan(driver).label} access.`
      );
    }
    if (isDriverSubscriptionPaid(driver)) {
      activeSubscription = buildSubscriptionState(driver);
      return;
    }
    const accessPlan = getDriverAccessPlan(driver);
    const now = Date.now();
    const billingPeriodKey = getAccessBillingPeriodKey(accessPlan, now);
    const chargeTzs = getCurrentAccessChargeTzs(accessPlan);

    const currentPaymentId = String(driver.lastSubscriptionPaymentId || '').trim();
    const currentPaymentSnapshot = currentPaymentId
      ? await transaction.get(getDriverPaymentRef(db, currentPaymentId))
      : null;
    const currentPayment = currentPaymentSnapshot?.exists
      ? { id: currentPaymentSnapshot.id, ...currentPaymentSnapshot.data() }
      : null;
    if (
      currentPayment &&
      isPendingPayment(currentPayment) &&
      isFreshUssdAttempt(currentPayment, driver) &&
      isSameAccessBillingPeriod(currentPayment, accessPlan, now)
    ) {
      existingPayment = currentPayment;
      return;
    }

    const paymentPayload = compact({
      id: input.orderId,
      orderId: input.orderId,
      driverId: input.driverId,
      driverName: input.driverName,
      driverEmail: input.driverEmail,
      driverPhone: input.driverPhone,
      buyerName: input.driverName,
      buyerEmail: input.driverEmail,
      buyerPhone: input.buyerPhone,
      payerPhone: input.buyerPhone,
      network: input.network,
      recipientPhone: input.recipientPhone,
      merchantRecipientPhone: input.recipientPhone,
      amount: chargeTzs,
      arrearsTzs: 0,
      billingPeriodKey,
      currency: 'TZS',
      feePayer: 'MERCHANT',
      paymentType: accessPlan.period === 'week' ? 'driver_weekly_access' : 'driver_daily_access',
      vehicleType: accessPlan.vehicleType,
      vehicleLabel: accessPlan.label,
      status: 'creating',
      localStatus: 'creating',
      provider: 'mobile_money',
      dateKey: getTanzaniaDateKey(now),
      durationHours: accessPlan.durationHours,
      durationDays: accessPlan.durationDays,
      localLockExpiresAt: new Date(now + PAYMENT_CREATE_LOCK_MS),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(paymentRef, paymentPayload);
    transaction.set(mirrorRef, paymentPayload);
    transaction.set(getAdminPaymentReviewRef(db, input.orderId), {
      ...paymentPayload,
      ...toAdminPaymentReviewPatch(paymentPayload, { status: 'pending' }),
      createdAt: paymentPayload.createdAt,
    });
    transaction.set(driverRef, {
      subscriptionStatus: 'pending',
      lastSubscriptionPaymentStatus: 'creating',
      lastSubscriptionPaymentId: input.orderId,
      lastSubscriptionPaymentSubmittedAt: FieldValue.serverTimestamp(),
      lastSubscriptionPaymentAmount: chargeTzs,
      lastSubscriptionPaymentExpiresAt: new Date(now + PAYMENT_CREATE_LOCK_MS),
      isAvailable: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return {
    existingPayment,
    activeSubscription,
  };
}

async function markPaymentInitiated(db, orderId, driverId, mongikeResponse, requestPayload) {
  const record = extractMongikePaymentRecord(mongikeResponse);
  const status = record.status === 'completed' ? 'pending' : record.status || 'pending';
  const expiresAt = record.expiresAt
    ? new Date(record.expiresAt)
    : new Date(Date.now() + 3 * 60 * 1000);
  const payload = compact({
    status: status === 'failed' || status === 'expired' ? status : 'pending',
    localStatus: status === 'failed' || status === 'expired' ? status : 'pending',
    providerStatus: record.providerStatus || 'PENDING',
    mongikePaymentId: record.id || '',
    gatewayRef: record.gatewayRef || '',
    reference: record.gatewayRef || '',
    amount: Number(record.amount || requestPayload.amount || 0),
    mongikeMessage: record.message || mongikeResponse?.message || '',
    mongikeResponse,
    mongikeRequest: requestPayload,
    expiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined,
    mongikeExpiresAt: Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await Promise.all([
    getDriverPaymentRef(db, orderId).set(payload, { merge: true }),
    getDriverPaymentMirrorRef(db, driverId, orderId).set(payload, { merge: true }),
    getAdminPaymentReviewRef(db, orderId).set(
      toAdminPaymentReviewPatch({ ...payload, orderId, driverId }, {
        status: payload.status,
        transactionReference: record.gatewayRef || orderId,
        gatewayRef: record.gatewayRef,
        amount: payload.amount,
      }),
      { merge: true }
    ),
    db.collection('drivers').doc(driverId).set(compact({
      subscriptionStatus: 'pending',
      lastSubscriptionPaymentStatus: status,
      lastSubscriptionPaymentId: orderId,
      lastSubscriptionPaymentGatewayRef: record.gatewayRef || undefined,
      lastSubscriptionPaymentExpiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined,
      updatedAt: FieldValue.serverTimestamp(),
    }), { merge: true }),
  ]);
}

async function markPaymentFailed(db, orderId, driverId, error) {
  const message = error instanceof Error ? error.message : 'Payment initiation failed.';
  const payload = {
    status: 'failed',
    localStatus: 'failed',
    failureReason: message,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    getDriverPaymentRef(db, orderId).set(payload, { merge: true }),
    getDriverPaymentMirrorRef(db, driverId, orderId).set(payload, { merge: true }),
    getAdminPaymentReviewRef(db, orderId).set(
      toAdminPaymentReviewPatch({ ...payload, orderId, driverId }, {
        status: 'failed',
        failureReason: message,
      }),
      { merge: true }
    ),
    db.collection('drivers').doc(driverId).set({
      subscriptionStatus: 'expired',
      lastSubscriptionPaymentStatus: 'failed',
      lastSubscriptionPaymentFailureReason: message,
      isAvailable: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

async function expireStuckDriverPayment(db, driverId, paymentId, reason) {
  const payload = compact({
    status: 'expired',
    localStatus: 'expired',
    failureReason: reason || 'USSD prompt expired before PIN was entered.',
    updatedAt: FieldValue.serverTimestamp(),
  });
  const writes = [
    db.collection('drivers').doc(driverId).set({
      subscriptionStatus: 'expired',
      lastSubscriptionPaymentStatus: 'expired',
      lastSubscriptionPaymentExpiresAt: new Date(0),
      isAvailable: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ];
  if (paymentId) {
    writes.push(
      getDriverPaymentRef(db, paymentId).set(payload, { merge: true }),
      getDriverPaymentMirrorRef(db, driverId, paymentId).set(payload, { merge: true }),
      getAdminPaymentReviewRef(db, paymentId).set(
        toAdminPaymentReviewPatch({ driverId, orderId: paymentId, status: 'expired' }, {
          status: 'expired',
          failureReason: payload.failureReason,
        }),
        { merge: true }
      )
    );
  }
  await Promise.all(writes);
}

async function initiateDriverPayment(req, body) {
  const decoded = await requireFirebaseUser(req);
  const { db } = ensureFirebaseAdmin();
  const driverId = decoded.uid;
  const driverSnapshot = await db.collection('drivers').doc(driverId).get();
  const driver = driverSnapshot.exists ? { id: driverSnapshot.id, ...driverSnapshot.data() } : null;
  if (!driver) {
    throw badRequest('Driver profile was not found.');
  }

  const buyerPhone = normalizePhoneNumber(body.phoneNumber || body.buyerPhone || driver.phoneNumber || decoded.phone_number);
  if (!isValidMongikePhone(buyerPhone)) {
    throw badRequest('Weka namba sahihi ya Tanzania, mfano 07XXXXXXXX au 2557XXXXXXXX.');
  }

  if (!canInitiateDriverAccessPayment(driver)) {
    const plan = getDriverAccessPlan(driver);
    throw badRequest(
      `Complete at least ${plan.minOrders} delivered ${plan.label} orders before paying. You have ${buildAccessPlanState(driver).completedOrders}.`
    );
  }

  if (isDriverSubscriptionPaid(driver)) {
    return {
      duplicate: true,
      subscription: buildSubscriptionState(driver),
      latestPayment: null,
      networks: mongikeNetworks,
    };
  }

  const accessPlan = getDriverAccessPlan(driver);
  const chargeTzs = getCurrentAccessChargeTzs(accessPlan);
  const billingPeriodKey = getAccessBillingPeriodKey(accessPlan);
  const selectedNetwork = String(body.network || '').trim().toLowerCase();
  const network = mongikeNetworks.some((item) => item.key === selectedNetwork) ? selectedNetwork : 'mpesa';
  const networkConfig = mongikeNetworks.find((item) => item.key === network);
  if (!networkConfig?.enabled) {
    throw badRequest(`${networkConfig?.label || 'This network'} is not available. Choose M-Pesa, Mixx by Yas, or Airtel Money.`);
  }

  const currentPaymentId = String(driver.lastSubscriptionPaymentId || '').trim();
  const currentPaymentSnapshot = currentPaymentId ? await getDriverPaymentRef(db, currentPaymentId).get() : null;
  const currentPayment = currentPaymentSnapshot?.exists
    ? { id: currentPaymentSnapshot.id, ...currentPaymentSnapshot.data() }
    : null;
  const previousPeriodPending = currentPayment
    && ['creating', 'pending'].includes(normalizePaymentStatus(currentPayment.status))
    && !isSameAccessBillingPeriod(currentPayment, accessPlan);

  if (previousPeriodPending) {
    await expireStuckDriverPayment(
      db,
      driverId,
      currentPaymentId,
      'Previous unused access period expired. Missed days are not billed as arrears.'
    );
  } else if (isDriverUssdLocked(driver)) {
    const currentPaymentId = String(driver.lastSubscriptionPaymentId || '').trim();
    const currentPaymentSnapshot = currentPaymentId ? await getDriverPaymentRef(db, currentPaymentId).get() : null;
    const currentPayment = currentPaymentSnapshot?.exists
      ? { id: currentPaymentSnapshot.id, ...currentPaymentSnapshot.data() }
      : null;
    const keepExistingPush = !body.retry
      && isFreshUssdAttempt(currentPayment, driver)
      && isSameAccessBillingPeriod(currentPayment, accessPlan);
    let remoteStatus = '';
    if (keepExistingPush) {
      try {
        const remote = await fetchMongikeTransactionByOrderId(
          currentPayment?.orderId || currentPaymentId,
          currentPayment?.mongikePaymentId,
          currentPayment?.gatewayRef || currentPayment?.reference
        );
        remoteStatus = normalizePaymentStatus(remote?.status);
      } catch {
        remoteStatus = '';
      }
    }

    if (keepExistingPush && remoteStatus === 'pending') {
      return {
        duplicate: true,
        subscription: buildSubscriptionState(driver, currentPayment),
        latestPayment: serializePayment(currentPayment),
        networks: mongikeNetworks,
      };
    }

    await expireStuckDriverPayment(
      db,
      driverId,
      currentPaymentId,
      body.retry
        ? 'Driver requested a new USSD push.'
        : remoteStatus
          ? `Previous USSD ended with ${remoteStatus}.`
          : 'Previous USSD went stale before PIN was entered.'
    );
  }

  const orderId = generateOrderId(driverId);
  const driverName = String(driver.fullName || decoded.name || 'DoorDrive driver').trim();
  const driverEmail = String(driver.email || decoded.email || '').trim().toLowerCase();

  const duplicateResult = await createPendingPaymentRecord(db, {
    orderId,
    driverId,
    driverName,
    driverEmail,
    driverPhone: driver.phoneNumber || '',
    buyerPhone,
    network,
    recipientPhone: driverPaymentRecipientPhone,
  });

  if (duplicateResult.activeSubscription) {
    return {
      duplicate: true,
      subscription: duplicateResult.activeSubscription,
      latestPayment: null,
      networks: mongikeNetworks,
    };
  }

  if (duplicateResult.existingPayment) {
    return {
      duplicate: true,
      subscription: buildSubscriptionState(driver, duplicateResult.existingPayment),
      latestPayment: serializePayment(duplicateResult.existingPayment),
      networks: mongikeNetworks,
    };
  }

  const mongikeRequest = compact({
    order_id: orderId,
    amount: chargeTzs,
    buyer_phone: buyerPhone,
    buyer_name: driverName,
    buyer_email: driverEmail || undefined,
    fee_payer: 'MERCHANT',
    metadata: compact({
      product: 'DoorDrive access',
      driverId,
      vehicleType: accessPlan.vehicleType,
      billingPeriodKey,
      network,
      app: 'doordropdrive',
    }),
  });

  try {
    const startedAt = Date.now();
    const mongikeResponse = await callMongikeInitiatePayment(mongikeRequest);
    console.log(`[ussd] mongike accepted ${orderId} in ${Date.now() - startedAt}ms`);
    await markPaymentInitiated(db, orderId, driverId, mongikeResponse, mongikeRequest);
    const paymentSnapshot = await getDriverPaymentRef(db, orderId).get();
    const payment = paymentSnapshot.exists ? { id: paymentSnapshot.id, ...paymentSnapshot.data() } : {
      id: orderId,
      orderId,
      driverId,
      amount: chargeTzs,
      status: 'pending',
      network,
      payerPhone: buyerPhone,
    };

    return {
      duplicate: false,
      subscription: buildSubscriptionState(driver, payment),
      latestPayment: serializePayment(payment),
      networks: mongikeNetworks,
    };
  } catch (error) {
    await markPaymentFailed(db, orderId, driverId, error);
    throw error;
  }
}

async function applyPaymentStatusUpdate(input) {
  const { db } = ensureFirebaseAdmin();
  const orderId = String(input.orderId || '').trim();
  if (!orderId) {
    throw badRequest('Webhook order_id is required.');
  }

  const paymentRef = getDriverPaymentRef(db, orderId);
  let result = null;

  await db.runTransaction(async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);
    if (!paymentSnapshot.exists) {
      throw badRequest('Payment record was not found.');
    }

    const payment = { id: paymentSnapshot.id, ...paymentSnapshot.data() };
    const driverRef = db.collection('drivers').doc(payment.driverId);
    const driverSnapshot = await transaction.get(driverRef);
    const driver = driverSnapshot.exists ? { id: driverSnapshot.id, ...driverSnapshot.data() } : null;
    const mirrorRef = getDriverPaymentMirrorRef(db, payment.driverId, orderId);
    const adminRef = getAdminPaymentReviewRef(db, orderId);
    const nextStatus = normalizePaymentStatus(input.status);
    const alreadyCompleted = normalizePaymentStatus(payment.status) === 'completed';

    if (alreadyCompleted) {
      transaction.set(adminRef, toAdminPaymentReviewPatch(payment, {
        status: 'completed',
        amount: Number(payment.amount || 0),
        transactionReference: payment.receiptNumber || payment.gatewayRef || payment.reference || orderId,
        receiptNumber: payment.receiptNumber,
        subscriptionPaidUntil: payment.subscriptionPaidUntil,
        completedAt: payment.completedAt || FieldValue.serverTimestamp(),
      }), { merge: true });
      result = {
        idempotent: true,
        payment: serializePayment(payment),
        subscription: buildSubscriptionState(driver, payment),
      };
      return;
    }

    if (nextStatus !== 'completed') {
      const failedPayload = compact({
        status: nextStatus,
        localStatus: nextStatus,
        providerStatus: input.providerStatus || input.status,
        gatewayRef: input.reference || payment.gatewayRef,
        reference: input.reference || payment.reference,
        webhookPayload: input.webhookPayload,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(paymentRef, failedPayload, { merge: true });
      transaction.set(mirrorRef, failedPayload, { merge: true });
      transaction.set(adminRef, toAdminPaymentReviewPatch({ ...payment, ...failedPayload }, {
        status: nextStatus,
        failureReason: input.webhookPayload?.description || payment.failureReason,
        transactionReference: failedPayload.gatewayRef || orderId,
      }), { merge: true });
      transaction.set(driverRef, {
        subscriptionStatus: 'expired',
        lastSubscriptionPaymentStatus: nextStatus,
        isAvailable: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = {
        idempotent: false,
        payment: serializePayment({ ...payment, ...failedPayload }),
        subscription: buildSubscriptionState(driver, { ...payment, ...failedPayload }),
      };
      return;
    }

    const accessPlan = getDriverAccessPlan(driver);
    const requiredAmount = getCurrentAccessChargeTzs(accessPlan);
    const paidAmount = Number(input.amount || payment.amount || requiredAmount || 0);
    if (paidAmount < requiredAmount) {
      const mismatchPayload = compact({
        status: 'failed',
        localStatus: 'failed',
        providerStatus: input.providerStatus || input.status,
        failureReason: `Paid amount ${paidAmount} is below required TZS ${requiredAmount}.`,
        webhookPayload: input.webhookPayload,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(paymentRef, mismatchPayload, { merge: true });
      transaction.set(mirrorRef, mismatchPayload, { merge: true });
      transaction.set(adminRef, toAdminPaymentReviewPatch({ ...payment, ...mismatchPayload }, {
        status: 'failed',
        failureReason: mismatchPayload.failureReason,
        amount: paidAmount,
      }), { merge: true });
      transaction.set(driverRef, {
        subscriptionStatus: 'expired',
        lastSubscriptionPaymentStatus: 'failed',
        isAvailable: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = {
        idempotent: false,
        payment: serializePayment({ ...payment, ...mismatchPayload }),
        subscription: buildSubscriptionState(driver, { ...payment, ...mismatchPayload }),
      };
      return;
    }

    const now = Date.now();
    const currentPaidUntil = toMillis(driver?.subscriptionPaidUntil);
    const subscriptionStartsAt = new Date(Math.max(now, getAccessPeriodStartMillis(accessPlan, now)));
    const subscriptionPaidUntil = new Date(resolveAccessPaidUntilMillis(accessPlan, now, currentPaidUntil));
    const receiptNumber = buildReceiptNumber(orderId, input.reference || payment.gatewayRef);
    const completedPayload = compact({
      status: 'completed',
      localStatus: 'completed',
      providerStatus: input.providerStatus || input.status || 'COMPLETED',
      gatewayRef: input.reference || payment.gatewayRef,
      reference: input.reference || payment.reference,
      amount: requiredAmount,
      arrearsTzs: 0,
      billingPeriodKey: getAccessBillingPeriodKey(accessPlan, now),
      receiptNumber,
      subscriptionStartsAt,
      subscriptionPaidUntil,
      completedAt: FieldValue.serverTimestamp(),
      webhookPayload: input.webhookPayload,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(paymentRef, completedPayload, { merge: true });
    transaction.set(mirrorRef, completedPayload, { merge: true });
    transaction.set(adminRef, toAdminPaymentReviewPatch({ ...payment, ...completedPayload }, {
      status: 'completed',
      amount: requiredAmount,
      receiptNumber,
      transactionReference: receiptNumber || completedPayload.gatewayRef || orderId,
      subscriptionPaidUntil,
      completedAt: completedPayload.completedAt,
    }), { merge: true });
    transaction.set(driverRef, {
      subscriptionStatus: 'active',
      subscriptionPaidUntil,
      accessPaymentDuePeriodKey: FieldValue.delete(),
      lastSubscriptionPaidAt: FieldValue.serverTimestamp(),
      lastSubscriptionPaymentStatus: 'completed',
      lastSubscriptionPaymentId: orderId,
      lastSubscriptionPaymentAmount: requiredAmount,
      lastSubscriptionPaymentGatewayRef: input.reference || payment.gatewayRef || '',
      lastSubscriptionPaymentReceiptNumber: receiptNumber,
      totalSubscriptionPaid: FieldValue.increment(paidAmount || requiredAmount),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    result = {
      idempotent: false,
      payment: serializePayment({ ...payment, ...completedPayload }),
      subscription: buildSubscriptionState({ ...driver, subscriptionPaidUntil }, { ...payment, ...completedPayload }),
    };
  });

  return result;
}

async function handleMongikeWebhook(req, body) {
  const apiKey = getMongikeApiKey();
  const webhookApiKey = String(req.headers['x-api-key'] || req.headers['X-Api-Key'] || '').trim();
  if (!apiKey || webhookApiKey !== apiKey) {
    const error = new Error('Invalid payment webhook signature.');
    error.statusCode = 401;
    throw error;
  }

  const payload = body && typeof body === 'object' ? body : {};
  return applyPaymentStatusUpdate({
    orderId: payload.order_id || payload.orderId || payload.reference,
    status: payload.payment_status || payload.status,
    providerStatus: payload.payment_status || payload.status,
    reference: payload.reference || payload.gateway_ref || payload.gatewayRef || payload.merchantReference,
    amount: payload.amount,
    webhookPayload: payload,
  });
}

async function verifyDriverPayment(req, body) {
  const decoded = await requireFirebaseUser(req);
  const { db } = ensureFirebaseAdmin();
  const paymentId = String(body.paymentId || body.orderId || '').trim();
  if (!paymentId) {
    const latest = (await fetchLatestDriverPayments(db, decoded.uid, 1))[0];
    if (!latest || normalizePaymentStatus(latest.status) !== 'pending') {
      return fetchDriverPaymentStatus(decoded.uid);
    }
    return verifyDriverPayment(req, { paymentId: latest.orderId || latest.id });
  }

  const paymentSnapshot = await getDriverPaymentRef(db, paymentId).get();
  if (!paymentSnapshot.exists) {
    throw badRequest('Payment record was not found.');
  }

  const payment = { id: paymentSnapshot.id, ...paymentSnapshot.data() };
  if (payment.driverId !== decoded.uid) {
    const error = new Error('You cannot verify another driver payment.');
    error.statusCode = 403;
    throw error;
  }

  if (normalizePaymentStatus(payment.status) === 'pending') {
    try {
      const remote = await fetchMongikeTransactionByOrderId(
        payment.orderId || paymentId,
        payment.mongikePaymentId,
        payment.gatewayRef || payment.reference
      );
      if (remote) {
        const remoteStatus = normalizePaymentStatus(remote.status);
        if (remoteStatus === 'completed' || remoteStatus === 'failed' || remoteStatus === 'expired') {
          await applyPaymentStatusUpdate({
            orderId: payment.orderId || paymentId,
            status: remote.status,
            providerStatus: remote.status,
            reference: remote.merchantReference || remote.gateway_ref || payment.gatewayRef,
            amount: remote.amount || payment.amount,
            webhookPayload: remote,
          });
          return fetchDriverPaymentStatus(decoded.uid);
        }
      }
    } catch (error) {
      if (error?.statusCode && error.statusCode < 500) {
        throw error;
      }
    }
  }

  if (normalizePaymentStatus(payment.status) === 'pending' && toMillis(payment.expiresAt) && toMillis(payment.expiresAt) <= Date.now()) {
    await Promise.all([
      getDriverPaymentRef(db, paymentId).set({ status: 'expired', localStatus: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      getDriverPaymentMirrorRef(db, decoded.uid, paymentId).set({ status: 'expired', localStatus: 'expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      db.collection('drivers').doc(decoded.uid).set({
        subscriptionStatus: 'expired',
        lastSubscriptionPaymentStatus: 'expired',
        isAvailable: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ]);
  }

  return fetchDriverPaymentStatus(decoded.uid);
}

async function handleDriverPaymentStatus(req, url) {
  const decoded = await requireFirebaseUser(req);
  const includeHistory = String(url?.searchParams?.get('includeHistory') || '').trim() === '1';
  return fetchDriverPaymentStatus(decoded.uid, { includeHistory, historyLimit: 10 });
}

async function handleDriverPaymentHistory(req) {
  const decoded = await requireFirebaseUser(req);
  const { db } = ensureFirebaseAdmin();
  const history = await fetchLatestDriverPayments(db, decoded.uid, 50);
  return {
    driverId: decoded.uid,
    history: history.map(serializePayment),
    networks: mongikeNetworks,
  };
}

module.exports = {
  applyPaymentStatusUpdate,
  buildSubscriptionState,
  driverAccessDurationHours,
  driverAccessFeeTzs,
  fetchDriverPaymentStatus,
  handleDriverPaymentHistory,
  handleDriverPaymentStatus,
  handleMongikeWebhook,
  initiateDriverPayment,
  isDriverSubscriptionActive,
  mongikeNetworks,
  verifyDriverPayment,
};
