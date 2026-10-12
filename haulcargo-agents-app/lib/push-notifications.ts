import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { doc, setDoc } from 'firebase/firestore';
import { Platform, Vibration } from 'react-native';

import { db } from '@/lib/firebase';

/** Expo Go (SDK 53+) throws on Android if expo-notifications is imported. */
function isExpoGo() {
  return Constants.appOwnership === 'expo';
}

type NotificationsModule = typeof import('expo-notifications');

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web' || isExpoGo()) return null;
  try {
    // Lazy require so Expo Go never evaluates the native module at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function ensureAndroidOfferChannel() {
  if (!Notifications || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('carrier_offers', {
    name: 'Oda mpya',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 420, 140, 420, 140, 520, 160, 640],
    lightColor: '#FFE500',
    sound: 'default',
    enableVibrate: true,
    enableLights: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });
}

export async function registerCarrierPushToken(opts: {
  uid: string;
  carrierId: string;
}): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[HAUL_AGENTS_PUSH] not a physical device');
    return null;
  }
  if (!Notifications) {
    console.warn('[HAUL_AGENTS_PUSH] skipped — Expo Go cannot register remote push tokens');
    return null;
  }

  await ensureAndroidOfferChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') {
    console.warn('[HAUL_AGENTS_PUSH] notification permission denied');
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
        '[HAUL_AGENTS_PUSH] expo token failed',
        error instanceof Error ? error.message : 'error'
      );
    }
  } else {
    console.info('[HAUL_AGENTS_PUSH] no EAS projectId — using FCM device token only');
  }

  let fcmToken = '';
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    fcmToken = String(device?.data || '').trim();
  } catch (error) {
    console.warn(
      '[HAUL_AGENTS_PUSH] FCM token failed',
      error instanceof Error ? error.message : 'error'
    );
  }

  if (!expoToken && !fcmToken) {
    console.warn('[HAUL_AGENTS_PUSH] no tokens obtained');
    return null;
  }
  const latestPushToken = fcmToken || expoToken;

  const tokenFields = {
    ...(expoToken ? { expoPushToken: expoToken } : {}),
    ...(fcmToken ? { fcmToken } : {}),
    latestPushToken,
    pushPlatform: Platform.OS,
    pushTokenUpdatedAt: new Date().toISOString(),
  };

  await setDoc(doc(db, 'carrierMembers', opts.uid), { ...tokenFields, carrierId: opts.carrierId }, { merge: true });

  if (opts.carrierId) {
    await setDoc(doc(db, 'carriers', opts.carrierId), tokenFields, { merge: true });
  }

  console.info('[HAUL_AGENTS_PUSH] registered', {
    carrierId: opts.carrierId,
    hasExpo: Boolean(expoToken),
    hasFcm: Boolean(fcmToken),
  });
  return latestPushToken;
}

const HANDLED_TAP_KEY = 'haul.agents.lastOfferTap';

type OfferTap = {
  notification?: {
    request?: {
      identifier?: string;
      content?: { data?: Record<string, unknown> };
    };
  };
};

function orderIdFromTap(response: OfferTap | null) {
  const data = response?.notification?.request?.content?.data;
  return String(data?.orderId || '').trim();
}

/** Notification tap opens the order. Expired offers are handled by the order screen. */
export function listenForOfferTaps(onOrder: (orderId: string) => void) {
  const Notifications = loadNotifications();
  if (!Notifications) return () => undefined;

  const handle = async (response: OfferTap | null) => {
    const orderId = orderIdFromTap(response);
    if (!orderId || !response) return;
    const token = `${response.notification?.request?.identifier || ''}:${orderId}`;
    const seen = await AsyncStorage.getItem(HANDLED_TAP_KEY);
    if (seen === token) return;
    await AsyncStorage.setItem(HANDLED_TAP_KEY, token);
    onOrder(orderId);
  };

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    void handle(response as OfferTap);
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => handle(response as OfferTap | null));
  return () => sub.remove();
}

/** Stronger pattern so agents notice offers even with phone in pocket. */
export function vibrateForNewOffer() {
  try {
    Vibration.vibrate([0, 420, 140, 420, 140, 520, 160, 640]);
  } catch {
    // ignore
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  // Device verification breadcrumb (read by smoke tests / logcat).
  console.info('[HAUL_AGENTS_VIBRATE]', new Date().toISOString());
}

/** Always vibrate hard; show an OS notification in the shade when Notifications is available. */
export async function alertForNewOffer(opts: {
  title: string;
  body: string;
  orderId: string;
}) {
  vibrateForNewOffer();

  const Notifications = loadNotifications();
  if (!Notifications) {
    // Expo Go: remote + local notifications unavailable — vibration only.
    console.warn('[HAUL_AGENTS_ALERT] notifications module unavailable (Expo Go?)');
    return;
  }

  try {
    await ensureAndroidOfferChannel();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title || 'Oda mpya ya HAUL',
        body: opts.body,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: false,
        data: { orderId: opts.orderId, type: 'carrier_offer' },
        ...(Platform.OS === 'android'
          ? {
              channelId: 'carrier_offers',
              vibrate: [0, 420, 140, 420, 140, 520, 160, 640],
            }
          : {}),
      },
      trigger: null,
    });
    console.info('[HAUL_AGENTS_NOTIFY]', id, opts.orderId);
  } catch (error) {
    console.warn(
      '[HAUL_AGENTS_ALERT] schedule failed',
      error instanceof Error ? error.message : 'error'
    );
  }
}
