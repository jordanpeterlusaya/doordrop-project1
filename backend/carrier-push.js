const { FieldValue } = require('firebase-admin/firestore');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoPushToken(token) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(token || '').trim());
}

function isFcmToken(token) {
  const value = String(token || '').trim();
  if (!value || isExpoPushToken(value)) return false;
  return value.length >= 40 && !/\s/.test(value);
}

function rememberToken(bucket, token) {
  const value = String(token || '').trim();
  if (isExpoPushToken(value)) bucket.expo.add(value);
  else if (isFcmToken(value)) bucket.fcm.add(value);
}

function rememberRecord(bucket, data) {
  if (!data) return;
  rememberToken(bucket, data.expoPushToken);
  rememberToken(bucket, data.latestPushToken);
  rememberToken(bucket, data.fcmToken);
  if (Array.isArray(data.pushTokens)) {
    for (const token of data.pushTokens) rememberToken(bucket, token);
  }
}

async function collectCarrierPushTokens(db, carrierId) {
  const bucket = { expo: new Set(), fcm: new Set() };
  const carrierSnap = await db.collection('carriers').doc(carrierId).get();
  if (carrierSnap.exists) rememberRecord(bucket, carrierSnap.data());

  const membersSnap = await db.collection('carrierMembers').where('carrierId', '==', carrierId).limit(40).get();
  for (const doc of membersSnap.docs) rememberRecord(bucket, doc.data());

  return { expo: [...bucket.expo], fcm: [...bucket.fcm] };
}

async function sendExpoMessages(messages) {
  if (!messages.length) return { sent: 0, skipped: true };
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { sent: messages.length, ok: response.ok, payload };
}

async function sendFcmMessages(tokens, { title, body, data }) {
  if (!tokens.length) return { sent: 0 };
  const { getMessaging } = require('firebase-admin/messaging');
  const messaging = getMessaging();
  let sent = 0;
  for (const token of tokens) {
    try {
      await messaging.send({
        token,
        notification: { title, body },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'carrier_offers',
            sound: 'default',
          },
        },
      });
      sent += 1;
    } catch (error) {
      console.warn('carrier-push fcm failed', { reason: error?.message || 'error' });
    }
  }
  return { sent };
}

/**
 * Push + inbox notification when a carrier receives a new offer/assignment.
 */
async function notifyCarrierNewOffer(db, { carrierId, orderId, orderNumber, destination, score }) {
  if (!carrierId || !orderId) return { skipped: true, reason: 'missing-ids' };

  const title = 'Oda mpya ya HAUL';
  const body = `${orderNumber || orderId}${destination ? ` · ${destination}` : ''}${
    score ? ` · ${score}%` : ''
  }`;

  await db.collection('carriers').doc(carrierId).collection('notifications').doc().set({
    title,
    body,
    orderId,
    type: 'carrier_offer',
    createdAt: FieldValue.serverTimestamp(),
    read: false,
  });

  const tokens = await collectCarrierPushTokens(db, carrierId);
  if (!tokens.expo.length && !tokens.fcm.length) {
    console.info('carrier-push skip', { carrierId, orderId, reason: 'no-token' });
    return { queuedInbox: true, pushSent: 0 };
  }

  const data = {
    type: 'carrier_offer',
    orderId: String(orderId),
    orderNumber: String(orderNumber || ''),
  };
  const messages = tokens.expo.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    priority: 'high',
    channelId: 'carrier_offers',
    data,
  }));

  try {
    const expoResult = await sendExpoMessages(messages);
    const fcmResult = await sendFcmMessages(tokens.fcm, { title, body, data });
    const pushSent = (expoResult.sent || 0) + (fcmResult.sent || 0);
    console.info('carrier-push sent', {
      carrierId,
      orderId,
      expo: tokens.expo.length,
      fcm: tokens.fcm.length,
      pushSent,
      ok: expoResult.ok !== false,
    });
    return { queuedInbox: true, pushSent, ok: pushSent > 0 };
  } catch (error) {
    console.warn('carrier-push failed', { carrierId, orderId, reason: error?.message || 'error' });
    return { queuedInbox: true, pushSent: 0, error: true };
  }
}

module.exports = {
  collectCarrierPushTokens,
  isExpoPushToken,
  isFcmToken,
  notifyCarrierNewOffer,
};
