const { FieldValue } = require('firebase-admin/firestore');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoPushToken(token) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(token || '').trim());
}

async function collectCarrierPushTokens(db, carrierId) {
  const tokens = new Set();
  const carrierSnap = await db.collection('carriers').doc(carrierId).get();
  if (carrierSnap.exists) {
    const data = carrierSnap.data() || {};
    const direct = String(data.expoPushToken || data.latestPushToken || '').trim();
    if (isExpoPushToken(direct)) tokens.add(direct);
    if (Array.isArray(data.pushTokens)) {
      for (const token of data.pushTokens) {
        if (isExpoPushToken(token)) tokens.add(String(token).trim());
      }
    }
  }

  const membersSnap = await db.collection('carrierMembers').where('carrierId', '==', carrierId).limit(40).get();
  for (const doc of membersSnap.docs) {
    const data = doc.data() || {};
    const token = String(data.expoPushToken || data.latestPushToken || '').trim();
    if (isExpoPushToken(token)) tokens.add(token);
  }

  return [...tokens];
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
  if (!tokens.length) {
    console.info('carrier-push skip', { carrierId, orderId, reason: 'no-token' });
    return { queuedInbox: true, pushSent: 0 };
  }

  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    priority: 'high',
    channelId: 'carrier_offers',
    data: {
      type: 'carrier_offer',
      orderId: String(orderId),
      orderNumber: String(orderNumber || ''),
    },
  }));

  try {
    const result = await sendExpoMessages(messages);
    console.info('carrier-push sent', { carrierId, orderId, count: tokens.length, ok: result.ok });
    return { queuedInbox: true, pushSent: tokens.length, ok: result.ok };
  } catch (error) {
    console.warn('carrier-push failed', { carrierId, orderId, reason: error?.message || 'error' });
    return { queuedInbox: true, pushSent: 0, error: true };
  }
}

module.exports = {
  collectCarrierPushTokens,
  isExpoPushToken,
  notifyCarrierNewOffer,
};
