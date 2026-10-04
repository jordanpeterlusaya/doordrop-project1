const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString } = require('firebase-functions/params');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const { config } = require('./config');

const mongikeApiKey = defineString('MONGIKE_API_KEY');
const googleServerApiKey = defineString('GOOGLE_SERVER_API_KEY');

let firestore = null;
let cachedRequestListener = null;
let autoAssignmentModule = null;

function ensureFirebaseAdmin() {
  if (getApps().length) {
    return;
  }

  const firebaseAdminOptions = {};
  if (config.firebaseServiceAccount) {
    firebaseAdminOptions.credential = cert(config.firebaseServiceAccount);
  }
  if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
    firebaseAdminOptions.projectId = config.firebaseProjectId || config.firebaseServiceAccount?.project_id;
  }

  initializeApp(firebaseAdminOptions);
}

function getFirestoreDb() {
  ensureFirebaseAdmin();
  if (!firestore) {
    firestore = getFirestore();
  }
  return firestore;
}

function getAutoAssignment() {
  if (!autoAssignmentModule) {
    autoAssignmentModule = require('./auto-assignment');
  }
  return autoAssignmentModule;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoPushToken(token) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(token || '').trim());
}

function shouldSendPushNotification(notification, user) {
  const preferences = user?.notificationPreferences || {};

  if (notification.type === 'promotion') {
    return preferences.promotions !== false;
  }

  return preferences.orderUpdates !== false;
}

function buildPushData(notificationId, notification) {
  return {
    notificationId,
    type: notification.type || 'message',
    orderId: notification.orderId || '',
    orderNumber: notification.orderNumber || '',
    orderStatus: notification.orderStatus || '',
  };
}

async function markNotificationPushStatus(notificationId, payload) {
  await getFirestoreDb()
    .collection('userNotifications')
    .doc(notificationId)
    .set(
      {
        ...payload,
        pushUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function sendExpoPushNotification(notificationId, notification, user) {
  const token = String(user?.latestPushToken || '').trim();
  if (!isExpoPushToken(token)) {
    await markNotificationPushStatus(notificationId, {
      pushStatus: 'skipped',
      pushError: token ? 'Invalid Expo push token.' : 'User has no Expo push token yet.',
    });
    return;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-encoding': 'gzip, deflate',
    },
    body: JSON.stringify({
      to: token,
      sound: 'default',
      title: String(notification.title || 'DoorDrop').trim() || 'DoorDrop',
      body: String(notification.message || '').trim() || 'You have a new DoorDrop update.',
      priority: 'high',
      channelId: 'default',
      data: buildPushData(notificationId, notification),
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const payload = await response.json().catch(() => ({}));
  const ticket = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  const ticketStatus = ticket?.status || (response.ok ? 'ok' : 'error');
  const ticketError = ticket?.message || ticket?.details?.error || payload?.errors?.[0]?.message || '';

  await markNotificationPushStatus(notificationId, {
    pushStatus: ticketStatus,
    pushTicketId: ticket?.id || '',
    pushError: ticketStatus === 'ok' ? FieldValue.delete() : ticketError || `Expo push failed with ${response.status}.`,
    pushSentAt: ticketStatus === 'ok' ? FieldValue.serverTimestamp() : FieldValue.delete(),
  });
}

function applyRuntimeSecrets() {
  try {
    process.env.MONGIKE_API_KEY = mongikeApiKey.value();
  } catch {
    process.env.MONGIKE_API_KEY = process.env.MONGIKE_API_KEY || '';
  }

  try {
    process.env.GOOGLE_SERVER_API_KEY = googleServerApiKey.value();
  } catch {
    process.env.GOOGLE_SERVER_API_KEY = process.env.GOOGLE_SERVER_API_KEY || '';
  }

  const googleKey = String(process.env.GOOGLE_SERVER_API_KEY || '').trim();
  if (googleKey) {
    config.googlePlacesApiKey = googleKey;
    config.googleRoutesApiKey = googleKey;
  }
}

function getRequestListener() {
  if (!cachedRequestListener) {
    applyRuntimeSecrets();
    cachedRequestListener = require('./server').requestListener;
  }
  return cachedRequestListener;
}

function handleApiRequest(req, res) {
  applyRuntimeSecrets();
  return getRequestListener()(req, res);
}

exports.api = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '1GiB',
    cpu: 1,
    concurrency: 40,
    minInstances: 0,
    maxInstances: 40,
    cors: false,
  },
  handleApiRequest
);

exports.onOrderCreatedAutoAssign = onDocumentCreated(
  {
    document: 'orders/{orderId}',
    region: 'us-central1',
    retry: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 20,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const { autoAssignOrderById } = getAutoAssignment();
    await autoAssignOrderById(getFirestoreDb(), event.params.orderId);
  }
);

exports.onDriverAvailabilityAutoAssign = onDocumentUpdated(
  {
    document: 'drivers/{driverId}',
    region: 'us-central1',
    retry: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 10,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) {
      return;
    }

    const { maybeRunQueueForDriverChange } = getAutoAssignment();
    await maybeRunQueueForDriverChange(
      getFirestoreDb(),
      before ? { id: event.params.driverId, ...before } : null,
      { id: event.params.driverId, ...after }
    );
  }
);

exports.onParcelOrderMatchCarrier = onDocumentCreated(
  {
    document: 'orders/{orderId}',
    region: 'us-central1',
    retry: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 10,
  },
  async (event) => {
    if (!event.data) return;
    const { matchOrderById } = require('./carrier-matching');
    await matchOrderById(getFirestoreDb(), event.params.orderId);
  }
);

exports.advanceCarrierOffers = onSchedule(
  {
    schedule: 'every 2 minutes',
    region: 'us-central1',
    retryCount: 0,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const { advanceCarrierOffers } = require('./carrier-matching');
    await advanceCarrierOffers(getFirestoreDb());
  }
);

exports.onCarrierShipmentRematch = onDocumentUpdated(
  {
    document: 'carrierShipments/{orderId}',
    region: 'us-central1',
    retry: false,
    timeoutSeconds: 30,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 10,
  },
  async (event) => {
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;
    if (!after) return;
    const { syncCarrierShipment } = require('./carrier-matching');
    await syncCarrierShipment(getFirestoreDb(), event.params.orderId, before, after);
  }
);

exports.autoAssignPendingOrders = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'us-central1',
    retryCount: 0,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const { runAutoAssignmentQueue } = getAutoAssignment();
    await runAutoAssignmentQueue(getFirestoreDb());
  }
);

exports.onUserNotificationCreated = onDocumentCreated(
  {
    document: 'userNotifications/{notificationId}',
    region: 'us-central1',
    retry: false,
  },
  async (event) => {
    const snapshot = event.data;
    const notificationId = event.params.notificationId;
    const notification = snapshot?.data();
    const userId = String(notification?.userId || '').trim();

    if (!snapshot || !notification || !userId) {
      return;
    }

    const userSnapshot = await getFirestoreDb().collection('users').doc(userId).get();
    if (!userSnapshot.exists) {
      await markNotificationPushStatus(notificationId, {
        pushStatus: 'skipped',
        pushError: 'User profile was not found.',
      });
      return;
    }

    const user = userSnapshot.data();
    if (!shouldSendPushNotification(notification, user)) {
      await markNotificationPushStatus(notificationId, {
        pushStatus: 'skipped',
        pushError: 'User notification preferences disabled this push.',
      });
      return;
    }

    await sendExpoPushNotification(notificationId, notification, user);
  }
);
