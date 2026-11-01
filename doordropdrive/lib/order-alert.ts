import { AppState, Platform, Vibration } from 'react-native';

import {
  ensureAndroidOrderAlertChannel,
  ORDER_ALERT_CHANNEL_ID,
  ORDER_ALERT_SOUND_FILE,
} from './order-alert-channel';

type NativeAlert = {
  start: () => void;
  stop: () => void;
  setOnline?: (enabled: boolean) => void;
};

let nativeAlert: NativeAlert | null = null;
let nativeLoadAttempted = false;
let activeOrderId: string | null = null;
let pulseTimer: ReturnType<typeof setInterval> | null = null;
let notificationRinging = false;

const incomingPattern = [0, 220, 100, 220, 100, 320];

function getNativeAlert(): NativeAlert | null {
  if (nativeLoadAttempted) {
    return nativeAlert;
  }
  nativeLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeAlert = require('../modules/incoming-alert').default as NativeAlert;
  } catch {
    nativeAlert = null;
  }
  return nativeAlert;
}

function buzzFallback() {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(incomingPattern, false);
      return;
    }
    Vibration.vibrate(incomingPattern);
  } catch {
    try {
      Vibration.vibrate(1000);
    } catch {
      // Ignore devices that block the vibrator.
    }
  }
}

async function ringWithNotification(orderId: string, playSound: boolean) {
  if (notificationRinging || Platform.OS === 'web') {
    return;
  }

  notificationRinging = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await ensureAndroidOrderAlertChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: `incoming-order-${orderId}`,
      content: {
        title: 'Oda mpya',
        body: 'Oda imepewa kwako. Fungua ili ukubali au ukatae.',
        sound: playSound ? ORDER_ALERT_SOUND_FILE : undefined,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: incomingPattern,
        ...(Platform.OS === 'android'
          ? {
              channelId: ORDER_ALERT_CHANNEL_ID,
              color: '#FFE500',
            }
          : {}),
        data: { type: 'incoming_order', orderId },
      },
      trigger: null,
    });
  } catch {
    // Notification sound is a backup layer for release APKs.
  }
}

async function clearNotificationRing() {
  if (!notificationRinging) {
    return;
  }
  notificationRinging = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    if (activeOrderId) {
      await Notifications.dismissNotificationAsync(`incoming-order-${activeOrderId}`).catch(
        () => undefined
      );
    }
  } catch {
    // Ignore.
  }
}

/**
 * Start a single order alert. Dedupes by orderId.
 * Prefer native looping alarm when available; otherwise one local notification with custom sound.
 * Avoids double sound when a remote push also arrives in the foreground.
 */
export function startIncomingOrderAlert(orderId: string) {
  if (!orderId) {
    return;
  }

  if (activeOrderId === orderId) {
    return;
  }
  activeOrderId = orderId;

  const native = getNativeAlert();
  let usedNative = false;
  if (native && Platform.OS === 'android') {
    try {
      native.start();
      usedNative = true;
    } catch {
      usedNative = false;
    }
  }

  // Heads-up banner always; play notification sound only when native alarm is unavailable.
  void ringWithNotification(orderId, !usedNative);
  buzzFallback();
}

export function stopIncomingOrderAlert() {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
  void clearNotificationRing();
  activeOrderId = null;
  try {
    getNativeAlert()?.stop();
  } catch {
    // Ignore.
  }
}

export function isIncomingOrderAlertActive(orderId?: string) {
  if (!activeOrderId) {
    return false;
  }
  if (orderId) {
    return activeOrderId === orderId;
  }
  return true;
}

/** Soft “online” presence notification — not the loud order alarm. */
export function setIncomingAlertOnline(enabled?: boolean) {
  try {
    const native = getNativeAlert();
    if (!native) {
      return;
    }
    if (enabled) {
      native.setOnline?.(true);
    } else if (!activeOrderId) {
      native.stop();
      native.setOnline?.(false);
    } else {
      native.setOnline?.(false);
    }
  } catch {
    // Optional native module.
  }
}

export function shouldDeferRemoteSound() {
  return AppState.currentState === 'active' && Boolean(activeOrderId);
}
