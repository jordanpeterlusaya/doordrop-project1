/**
 * HAUL Pilots — remote push when an order is assigned to a driver.
 * Mirrors carrier-push.js: Expo Push API + FCM device tokens.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ORDER_ALERT_CHANNEL_ID = 'haul_new_orders_v1';
const ORDER_ALERT_SOUND_FILE = 'order_alert.wav';

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

function collectDriverPushTokens(driver) {
  const bucket = { expo: new Set(), fcm: new Set() };
  if (!driver) return { expo: [], fcm: [] };
  rememberToken(bucket, driver.expoPushToken);
  rememberToken(bucket, driver.latestPushToken);
  rememberToken(bucket, driver.fcmToken);
  if (Array.isArray(driver.pushTokens)) {
    for (const token of driver.pushTokens) rememberToken(bucket, token);
  }
  return { expo: [...bucket.expo], fcm: [...bucket.fcm] };
}

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getOrderNumber(order) {
  const id = safeText(order?.id || order?.orderId);
  const generated = id ? `DD-${id.slice(0, 6).toUpperCase()}` : 'New order';
  return safeText(order?.orderNumber || order?.orderId || order?.id, generated);
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
  if (!response.ok) {
    console.warn('driver-push expo http', { status: response.status, payload });
  }
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
            channelId: ORDER_ALERT_CHANNEL_ID,
            sound: ORDER_ALERT_SOUND_FILE,
            defaultVibrateTimings: true,
            notificationCount: 1,
            visibility: 'public',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'order_alert.caf',
              priority: 10,
            },
          },
        },
      });
      sent += 1;
    } catch (error) {
      console.warn('driver-push fcm failed', { reason: error?.message || 'error' });
    }
  }
  return { sent };
}

/**
 * Send heads-up order alert to the assigned driver (Expo + FCM).
 * Called from assignDriverToOrder and admin manual assign.
 */
async function sendDriverIncomingOrderPush(driver, order) {
  const tokens = collectDriverPushTokens(driver);
  if (!tokens.expo.length && !tokens.fcm.length) {
    console.info('driver-push skip', {
      driverId: driver?.id || driver?.uid || '',
      orderId: order?.id || '',
      reason: 'no-token',
    });
    return { pushSent: 0, skipped: true, reason: 'no-token' };
  }

  const orderId = String(order?.id || '').trim();
  const orderNumber = getOrderNumber(order);
  const title = 'Oda mpya';
  const body = `${orderNumber} inakungoja. Kubali au kataa sasa.`;
  const data = {
    type: 'incoming_order',
    orderId,
    orderNumber: String(orderNumber || ''),
  };

  const messages = tokens.expo.map((to) => ({
    to,
    title,
    body,
    sound: ORDER_ALERT_SOUND_FILE,
    priority: 'high',
    channelId: ORDER_ALERT_CHANNEL_ID,
    ttl: 120,
    data,
  }));

  try {
    const expoResult = await sendExpoMessages(messages);
    const fcmResult = await sendFcmMessages(tokens.fcm, { title, body, data });
    const pushSent = (expoResult.sent || 0) + (fcmResult.sent || 0);
    console.info('driver-push sent', {
      driverId: driver?.id || driver?.uid || '',
      orderId,
      expo: tokens.expo.length,
      fcm: tokens.fcm.length,
      pushSent,
      channel: ORDER_ALERT_CHANNEL_ID,
      ok: expoResult.ok !== false,
    });
    return { pushSent, ok: pushSent > 0, expoResult, fcmResult };
  } catch (error) {
    console.warn('driver-push failed', {
      orderId,
      reason: error?.message || 'error',
    });
    return { pushSent: 0, error: true };
  }
}

module.exports = {
  ORDER_ALERT_CHANNEL_ID,
  ORDER_ALERT_SOUND_FILE,
  collectDriverPushTokens,
  isExpoPushToken,
  isFcmToken,
  sendDriverIncomingOrderPush,
};
