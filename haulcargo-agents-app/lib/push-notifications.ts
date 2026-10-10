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
    vibrationPattern: [0, 250, 120, 250],
    lightColor: '#FFE500',
    sound: 'default',
  });
}

export async function registerCarrierPushToken(opts: {
  uid: string;
  carrierId: string;
}): Promise<string | null> {
  if (!Notifications || !Device.isDevice) return null;

  await ensureAndroidOfferChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return null;

  const tokenResult = await Notifications.getExpoPushTokenAsync();
  const token = String(tokenResult.data || '').trim();
  if (!token) return null;

  await setDoc(
    doc(db, 'carrierMembers', opts.uid),
    {
      expoPushToken: token,
      latestPushToken: token,
      pushTokenUpdatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  if (opts.carrierId) {
    await setDoc(
      doc(db, 'carriers', opts.carrierId),
      {
        expoPushToken: token,
        latestPushToken: token,
        pushTokenUpdatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  return token;
}

export function vibrateForNewOffer() {
  try {
    Vibration.vibrate([0, 280, 120, 280, 120, 360]);
  } catch {
    // ignore
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
