import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { doc, setDoc } from 'firebase/firestore';
import { Platform, Vibration } from 'react-native';

import { db } from '@/lib/firebase';
import {
  preloadIncomingOrderAlarm,
  startIncomingOrderAlarm,
  stopIncomingOrderAlarm,
} from '@/lib/incoming-order-sound';

export const OFFER_NOTIFICATION_CHANNEL_ID = 'carrier_offer_chime';
export const OFFER_CUSTOM_SOUND_FILE = 'incoming_order_chime.wav';

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

// Preload the custom incoming order alarm asset on module init
void preloadIncomingOrderAlarm();

export async function ensureAndroidOfferChannel() {
  if (!Notifications || Platform.OS !== 'android') return;

  try {
    const existing = await Notifications.getNotificationChannelAsync?.(
      OFFER_NOTIFICATION_CHANNEL_ID
    ).catch(() => null);
    if (existing && existing.sound !== 'custom') {
      await Notifications.deleteNotificationChannelAsync?.(
        OFFER_NOTIFICATION_CHANNEL_ID
      ).catch(() => undefined);
    }
  } catch {
    // ignore channel inspection error
  }

  const channelConfig = {
    name: 'Oda mpya',
    description: 'Sauti ya oda mpya ya mzigo',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 180, 90, 180],
    lightColor: '#FFE500',
    sound: OFFER_CUSTOM_SOUND_FILE,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      flags: {
        enforceAudibility: true,
        requestHardwareAudioVideoSynchronization: false,
      },
    },
    enableVibrate: true,
    enableLights: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  };

  await Notifications.setNotificationChannelAsync(
    OFFER_NOTIFICATION_CHANNEL_ID,
    channelConfig
  );
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

/** Notification tap opens the order and silences the ringing incoming-order alarm. */
export function listenForOfferTaps(onOrder: (orderId: string) => void) {
  const Notifications = loadNotifications();
  if (!Notifications) return () => undefined;

  const handle = async (response: OfferTap | null) => {
    const orderId = orderIdFromTap(response);
    if (!orderId || !response) return;
    stopIncomingOrderAlarm('notification-tap');
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
    Vibration.vibrate([0, 180, 90, 180]);
  } catch {
    // ignore
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  // Device verification breadcrumb (read by smoke tests / logcat).
  console.info('[HAUL_AGENTS_VIBRATE]', new Date().toISOString());
}

/**
 * Plays the incoming-order chime, vibrates, and posts an OS notification when available.
 */
export async function alertForNewOffer(opts: {
  title: string;
  body: string;
  orderId: string;
}) {
  vibrateForNewOffer();
  void startIncomingOrderAlarm(opts.orderId, { loop: true });

  console.info('[HAUL_AGENTS_CUSTOM_ALERT]', {
    orderId: opts.orderId,
    title: opts.title,
    body: opts.body,
    sound: OFFER_CUSTOM_SOUND_FILE,
    at: new Date().toISOString(),
  });

  const Notifications = loadNotifications();
  if (!Notifications) {
    // Expo Go: remote + local OS notifications unavailable — in-app custom banner + custom alarm sound + vibration active.
    console.warn('[HAUL_AGENTS_ALERT] notifications module unavailable (Expo Go — using custom in-app sound & banner)');
    return;
  }

  try {
    await ensureAndroidOfferChannel();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title || 'Oda mpya',
        subtitle: 'HAUL Cargo Dispatch',
        body: opts.body,
        sound: OFFER_CUSTOM_SOUND_FILE,
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: false,
        data: { orderId: opts.orderId, type: 'carrier_offer' },
        ...(Platform.OS === 'android'
          ? {
              channelId: OFFER_NOTIFICATION_CHANNEL_ID,
              vibrate: [0, 180, 90, 180],
              color: '#FFE500',
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
