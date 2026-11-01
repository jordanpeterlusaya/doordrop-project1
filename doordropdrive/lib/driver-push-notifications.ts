import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Alert, AppState, Platform } from 'react-native';

import { saveDriverPushTokens } from './driver-data';
import { startIncomingOrderAlert, stopIncomingOrderAlert } from './order-alert';
import {
  ensureAndroidOrderAlertChannel,
  ORDER_ALERT_CHANNEL_ID,
  ORDER_ALERT_SOUND_FILE,
} from './order-alert-channel';

export { ensureAndroidOrderAlertChannel, ORDER_ALERT_CHANNEL_ID, ORDER_ALERT_SOUND_FILE };

const PERMISSION_ASKED_KEY = 'haul.pilots.notifPermissionAsked';
const HANDLED_TAP_KEY = 'haul.pilots.lastOrderTap';

type NotificationsModule = typeof import('expo-notifications');

function isExpoGo() {
  return Constants.appOwnership === 'expo';
}

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web' || isExpoGo()) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const foreground = AppState.currentState === 'active';
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // Foreground sound is owned by startIncomingOrderAlert (native/local once).
        shouldPlaySound: !foreground,
        shouldSetBadge: true,
      };
    },
  });
}

/**
 * Explain why notifications are needed, then request once (Android 13+ / iOS).
 * Does not re-prompt after the user has already been asked in this install.
 */
export async function requestOrderNotificationPermission(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (!Notifications) {
    return false;
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    return true;
  }

  if (!opts?.force) {
    const asked = await AsyncStorage.getItem(PERMISSION_ASKED_KEY);
    if (asked === '1' && existing.status !== 'undetermined') {
      return false;
    }
  }

  // One soft rationale before the system prompt (never loops).
  if (existing.status === 'undetermined' || opts?.force) {
    await new Promise<void>((resolve) => {
      Alert.alert(
        'Oda mpya',
        'Ruhusu arifa ili usikie sauti ya oda na uone notisi hata app ikiwa imefungwa.',
        [{ text: 'Endelea', onPress: () => resolve() }],
        { cancelable: false }
      );
    });
  }

  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowDisplayInCarPlay: false,
      allowCriticalAlerts: false,
    },
  });
  await AsyncStorage.setItem(PERMISSION_ASKED_KEY, '1');
  return Boolean(asked.granted);
}

export async function registerDriverPushToken(driverId: string): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[HAUL_PILOTS_PUSH] not a physical device');
    return null;
  }
  if (!Notifications) {
    console.warn('[HAUL_PILOTS_PUSH] skipped — Expo Go cannot register remote push');
    return null;
  }

  await ensureAndroidOrderAlertChannel();
  const granted = await requestOrderNotificationPermission();
  if (!granted) {
    console.warn('[HAUL_PILOTS_PUSH] notification permission denied');
    return null;
  }

  const projectId = String(
    Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || ''
  ).trim();

  let expoToken = '';
  if (projectId) {
    try {
      const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
      expoToken = String(tokenResult.data || '').trim();
    } catch (error) {
      console.warn(
        '[HAUL_PILOTS_PUSH] expo token failed',
        error instanceof Error ? error.message : 'error'
      );
    }
  } else {
    console.warn('[HAUL_PILOTS_PUSH] missing EAS projectId');
  }

  let fcmToken = '';
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    fcmToken = String(device?.data || '').trim();
  } catch (error) {
    console.warn(
      '[HAUL_PILOTS_PUSH] device token failed',
      error instanceof Error ? error.message : 'error'
    );
  }

  if (!expoToken && !fcmToken) {
    console.warn('[HAUL_PILOTS_PUSH] no tokens obtained');
    return null;
  }

  const latestPushToken = expoToken || fcmToken;
  await saveDriverPushTokens(driverId, {
    expoPushToken: expoToken || undefined,
    fcmToken: fcmToken || undefined,
    latestPushToken,
    platform: Platform.OS,
  });

  console.info('[HAUL_PILOTS_PUSH] registered', {
    driverId,
    hasExpo: Boolean(expoToken),
    hasFcm: Boolean(fcmToken),
    channel: ORDER_ALERT_CHANNEL_ID,
  });
  return latestPushToken;
}

type OrderTap = {
  notification?: {
    request?: {
      identifier?: string;
      content?: { data?: Record<string, unknown> };
    };
  };
};

function orderIdFromNotificationData(data?: Record<string, unknown> | null) {
  if (!data) {
    return '';
  }
  return String(data.orderId || data.order_id || '').trim();
}

function isIncomingOrderType(data?: Record<string, unknown> | null) {
  const type = String(data?.type || '').trim();
  return type === 'incoming_order' || type === 'driver_order' || type === 'new_order';
}

/**
 * Tap opens the assigned order and silences the ringing alert.
 * Cold-start taps are handled via getLastNotificationResponseAsync.
 */
export function listenForOrderNotificationTaps(onOrder: (orderId: string) => void) {
  if (!Notifications) {
    return () => undefined;
  }

  const handle = async (response: OrderTap | null) => {
    const data = response?.notification?.request?.content?.data;
    const orderId = orderIdFromNotificationData(data);
    if (!orderId || !response) {
      return;
    }
    stopIncomingOrderAlert();
    const token = `${response.notification?.request?.identifier || ''}:${orderId}`;
    const seen = await AsyncStorage.getItem(HANDLED_TAP_KEY);
    if (seen === token) {
      return;
    }
    await AsyncStorage.setItem(HANDLED_TAP_KEY, token);
    onOrder(orderId);
  };

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    void handle(response as OrderTap);
  });
  void Notifications.getLastNotificationResponseAsync().then((response) =>
    handle(response as OrderTap | null)
  );
  return () => sub.remove();
}

/** Foreground remote push: ring once if Firestore has not already started the alert. */
export function listenForForegroundOrderPushes() {
  if (!Notifications) {
    return () => undefined;
  }

  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    if (!isIncomingOrderType(data)) {
      return;
    }
    const orderId = orderIdFromNotificationData(data);
    if (!orderId) {
      return;
    }
    if (AppState.currentState === 'active') {
      startIncomingOrderAlert(orderId);
    }
  });
  return () => sub.remove();
}
