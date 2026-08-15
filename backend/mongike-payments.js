const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const { config } = require('./config');

const DRIVER_PAYMENTS_COLLECTION = 'driverPayments';
const DRIVER_SUBSCRIPTION_PAYMENTS_COLLECTION = 'subscriptionPayments';
const DEFAULT_MONGIKE_API_BASE_URL = 'https://mongike.com/api/v1';
const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const PAYMENT_CREATE_LOCK_MS = 2 * 60 * 1000;

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

const activePaymentNetwork = String(process.env.DRIVER_PAYMENT_ACTIVE_NETWORK || 'mpesa').trim().toLowerCase();
const driverPaymentRecipientPhone = String(process.env.DRIVER_PAYMENT_RECIPIENT_PHONE || '0750355402').trim();
const normalizedDriverPaymentRecipientPhone = normalizePhoneNumber(driverPaymentRecipientPhone);

const mongikeNetworks = [
  {
    key: 'mpesa',
    label: 'M-Pesa',
    provider: 'Vodacom',
    color: '#16A34A',
    logoUrl: 'https://images.seeklogo.com/logo-png/62/2/m-pesa-logo-png_seeklogo-622552.png',
    enabled: activePaymentNetwork === 'mpesa',
    comingSoon: activePaymentNetwork !== 'mpesa',
    recipientPhone: activePaymentNetwork === 'mpesa' ? driverPaymentRecipientPhone : '',
  },
  {
    key: 'mixx',
    label: 'Mixx by Yas',
    provider: 'Yas / Tigo Pesa',
    color: '#155EEF',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Yas_Tanzania.svg/512px-Yas_Tanzania.svg.png',
    enabled: activePaymentNetwork === 'mixx',
    comingSoon: activePaymentNetwork !== 'mixx',
    recipientPhone: activePaymentNetwork === 'mixx' ? driverPaymentRecipientPhone : '',
  },
  {
    key: 'airtel',
    label: 'Airtel Money',
    provider: 'Airtel',
    color: '#DC2626',
    logoUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTweT0_EszZrApI-MHVpPBZueAISnt5GXJNnw&s',
    enabled: activePaymentNetwork === 'airtel',
    comingSoon: activePaymentNetwork !== 'airtel',
    recipientPhone: activePaymentNetwork === 'airtel' ? driverPaymentRecipientPhone : '',
  },
  {
    key: 'halopesa',
    label: 'HaloPesa',
    provider: 'Halotel',
    color: '#7C3AED',
    logoUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSbuLQMvrrg2lEeCHcKj_5qd7fTXGC3akQx0Q&s',
    enabled: activePaymentNetwork === 'halopesa',
    comingSoon: activePaymentNetwork !== 'halopesa',
    recipientPhone: activePaymentNetwork === 'halopesa' ? driverPaymentRecipientPhone : '',
  },
];

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const driverAccessFeeTzs = parseNumber(process.env.DRIVER_DAILY_ACCESS_FEE_TZS, 3000);
const driverAccessDurationHours = parseNumber(process.env.DRIVER_ACCESS_DURATION_HOURS, 24);
const driverAccessDurationMs = Math.max(1, driverAccessDurationHours) * 60 * 60 * 1000;

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

function isPendingPayment(payment) {
  const status = normalizePaymentStatus(payment?.status || payment?.localStatus);
  const expiresAt = toMillis(payment?.expiresAt || payment?.mongikeExpiresAt || payment?.localLockExpiresAt);
  return ['creating', 'pending'].includes(status) && (!expiresAt || expiresAt > Date.now());
}

function isDriverSubscriptionActive(_driver, _now = Date.now()) {
  return true;
}

function buildSubscriptionState(driver, latestPayment = null, now = Date.now()) {
  const paidUntilMillis = toMillis(driver?.subscriptionPaidUntil);
  const active = paidUntilMillis > now;
  const latestStatus = normalizePaymentStatus(
    latestPayment?.status || driver?.lastSubscriptionPaymentStatus || driver?.subscriptionStatus
  );
  const pending = !active && ['creating', 'pending'].includes(latestStatus) && isPendingPayment(latestPayment || {
    status: latestStatus,
    expiresAt: driver?.lastSubscriptionPaymentExpiresAt,
  });

  let status = 'expired';
  if (active) {
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
    dailyFee: driverAccessFeeTzs,
    durationHours: driverAccessDurationHours,
    currency: 'TZS',
    message: active
      ? 'Driver access is active.'
      : pending
        ? 'Payment is pending. Complete the mobile money prompt to activate access.'
        : 'Driver access has expired. Renew to continue receiving and managing orders.',
  };
}

function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
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

async function fetchDriverPaymentStatus(driverId) {
  const { db } = ensureFirebaseAdmin();
  const driverSnapshot = await db.collection('drivers').doc(driverId).get();
  const driver = driverSnapshot.exists ? { id: driverSnapshot.id, ...driverSnapshot.data() } : null;
  const history = driver ? await fetchLatestDriverPayments(db, driverId, 12) : [];
  const latestPayment = history[0] || null;

  return {
    driverId,
    subscription: buildSubscriptionState(driver, latestPayment),
    latestPayment: serializePayment(latestPayment),
    history: history.map(serializePayment),
    networks: mongikeNetworks,
  };
}

function generateOrderId(driverId) {
  const dateKey = getTanzaniaDateKey().replace(/-/g, '');
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DDR-${dateKey}-${String(driverId || '').slice(0, 8).toUpperCase()}-${randomPart}`;
}

async function callMongikeInitiatePayment(payload) {
  const apiKey = getMongikeApiKey();
  if (!apiKey) {
    throw serviceUnavailable('Mongike API key is not configured on the backend.');
  }

  const response = await fetch(`${getMongikeApiBaseUrl()}/payments/mobile-money/tanzania`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed?.message || responseText || `Mongike payment initiation failed with ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status >= 500 ? 502 : 400;
    error.mongikeResponse = parsed || responseText;
    throw error;
  }

  return parsed || {};
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
    if (isDriverSubscriptionActive(driver)) {
      activeSubscription = buildSubscriptionState(driver);
      return;
    }

    const currentPaymentId = String(driver.lastSubscriptionPaymentId || '').trim();
    const currentPaymentSnapshot = currentPaymentId
      ? await transaction.get(getDriverPaymentRef(db, currentPaymentId))
      : null;
    const currentPayment = currentPaymentSnapshot?.exists
      ? { id: currentPaymentSnapshot.id, ...currentPaymentSnapshot.data() }
      : null;
    if (currentPayment && isPendingPayment(currentPayment)) {
      existingPayment = currentPayment;
      return;
    }

    const now = Date.now();
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
      amount: driverAccessFeeTzs,
      currency: 'TZS',
      feePayer: 'MERCHANT',
      paymentType: 'driver_daily_access',
      status: 'creating',
      localStatus: 'creating',
      provider: 'mongike',
      dateKey: getTanzaniaDateKey(now),
      durationHours: driverAccessDurationHours,
      localLockExpiresAt: new Date(now + PAYMENT_CREATE_LOCK_MS),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(paymentRef, paymentPayload);
    transaction.set(mirrorRef, paymentPayload);
    transaction.set(driverRef, {
      subscriptionStatus: 'pending',
      lastSubscriptionPaymentStatus: 'creating',
      lastSubscriptionPaymentId: input.orderId,
      lastSubscriptionPaymentSubmittedAt: FieldValue.serverTimestamp(),
      lastSubscriptionPaymentAmount: driverAccessFeeTzs,
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
  const data = mongikeResponse?.data || {};
  const status = normalizePaymentStatus(data.status || mongikeResponse?.status || 'PENDING');
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const payload = compact({
    status,
    localStatus: status,
    providerStatus: data.status || mongikeResponse?.status || '',
    mongikePaymentId: data.id || '',
    gatewayRef: data.gateway_ref || '',
    reference: data.gateway_ref || '',
    amount: Number(data.amount || requestPayload.amount || driverAccessFeeTzs),
    mongikeMessage: mongikeResponse?.message || '',
    mongikeResponse,
    mongikeRequest: requestPayload,
    expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined,
    mongikeExpiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await Promise.all([
    getDriverPaymentRef(db, orderId).set(payload, { merge: true }),
    getDriverPaymentMirrorRef(db, driverId, orderId).set(payload, { merge: true }),
    db.collection('drivers').doc(driverId).set(compact({
      subscriptionStatus: 'pending',
      lastSubscriptionPaymentStatus: status,
      lastSubscriptionPaymentId: orderId,
      lastSubscriptionPaymentGatewayRef: data.gateway_ref || undefined,
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
    db.collection('drivers').doc(driverId).set({
      subscriptionStatus: 'expired',
      lastSubscriptionPaymentStatus: 'failed',
      lastSubscriptionPaymentFailureReason: message,
      isAvailable: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
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
  if (!buyerPhone || !buyerPhone.startsWith('255') || buyerPhone.length < 12) {
    throw badRequest('Enter a valid Tanzanian mobile money number.');
  }

  const selectedNetwork = String(body.network || '').trim().toLowerCase();
  const network = mongikeNetworks.some((item) => item.key === selectedNetwork) ? selectedNetwork : 'mpesa';
  const networkConfig = mongikeNetworks.find((item) => item.key === network);
  if (!networkConfig?.enabled) {
    throw badRequest(`${networkConfig?.label || 'This mobile money network'} is coming soon. Use Vodacom M-Pesa for now.`);
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

  const webhookUrl = buildWebhookUrl(req);
  const mongikeRequest = compact({
    order_id: orderId,
    amount: driverAccessFeeTzs,
    buyer_phone: buyerPhone,
    buyer_name: driverName,
    buyer_email: driverEmail || undefined,
    fee_payer: 'MERCHANT',
    webhook_url: webhookUrl || undefined,
    metadata: compact({
      product: 'DoorDrive daily driver access',
      driverId,
      network,
      recipientPhone: driverPaymentRecipientPhone,
      recipientPhoneInternational: normalizedDriverPaymentRecipientPhone,
      durationHours: driverAccessDurationHours,
      app: 'doordropdrive',
    }),
  });

  try {
    const mongikeResponse = await callMongikeInitiatePayment(mongikeRequest);
    await markPaymentInitiated(db, orderId, driverId, mongikeResponse, mongikeRequest);
    const paymentSnapshot = await getDriverPaymentRef(db, orderId).get();
    const payment = paymentSnapshot.exists ? { id: paymentSnapshot.id, ...paymentSnapshot.data() } : null;

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
    const nextStatus = normalizePaymentStatus(input.status);
    const alreadyCompleted = normalizePaymentStatus(payment.status) === 'completed';

    if (alreadyCompleted) {
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

    const paidAmount = Number(input.amount || payment.amount || 0);
    if (paidAmount < driverAccessFeeTzs) {
      const mismatchPayload = compact({
        status: 'failed',
        localStatus: 'failed',
        providerStatus: input.providerStatus || input.status,
        failureReason: `Paid amount ${paidAmount} is below required TZS ${driverAccessFeeTzs}.`,
        webhookPayload: input.webhookPayload,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(paymentRef, mismatchPayload, { merge: true });
      transaction.set(mirrorRef, mismatchPayload, { merge: true });
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
    const subscriptionStartsAt = new Date(Math.max(currentPaidUntil, now));
    const subscriptionPaidUntil = new Date(Math.max(currentPaidUntil, now) + driverAccessDurationMs);
    const receiptNumber = buildReceiptNumber(orderId, input.reference || payment.gatewayRef);
    const completedPayload = compact({
      status: 'completed',
      localStatus: 'completed',
      providerStatus: input.providerStatus || input.status || 'COMPLETED',
      gatewayRef: input.reference || payment.gatewayRef,
      reference: input.reference || payment.reference,
      amount: paidAmount || driverAccessFeeTzs,
      receiptNumber,
      subscriptionStartsAt,
      subscriptionPaidUntil,
      completedAt: FieldValue.serverTimestamp(),
      webhookPayload: input.webhookPayload,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(paymentRef, completedPayload, { merge: true });
    transaction.set(mirrorRef, completedPayload, { merge: true });
    transaction.set(driverRef, {
      subscriptionStatus: 'active',
      subscriptionPaidUntil,
      lastSubscriptionPaidAt: FieldValue.serverTimestamp(),
      lastSubscriptionPaymentStatus: 'completed',
      lastSubscriptionPaymentId: orderId,
      lastSubscriptionPaymentAmount: paidAmount || driverAccessFeeTzs,
      lastSubscriptionPaymentGatewayRef: input.reference || payment.gatewayRef || '',
      lastSubscriptionPaymentReceiptNumber: receiptNumber,
      totalSubscriptionPaid: FieldValue.increment(paidAmount || driverAccessFeeTzs),
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
    const error = new Error('Invalid Mongike webhook signature.');
    error.statusCode = 401;
    throw error;
  }

  return applyPaymentStatusUpdate({
    orderId: body.order_id || body.orderId,
    status: body.payment_status || body.status,
    providerStatus: body.payment_status || body.status,
    reference: body.reference || body.gateway_ref || body.gatewayRef,
    amount: body.amount,
    webhookPayload: body,
  });
}

async function verifyDriverPayment(req, body) {
  const decoded = await requireFirebaseUser(req);
  const { db } = ensureFirebaseAdmin();
  const paymentId = String(body.paymentId || body.orderId || '').trim();
  if (!paymentId) {
    return fetchDriverPaymentStatus(decoded.uid);
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

async function handleDriverPaymentStatus(req) {
  const decoded = await requireFirebaseUser(req);
  return fetchDriverPaymentStatus(decoded.uid);
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
