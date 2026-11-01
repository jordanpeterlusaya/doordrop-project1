import { Platform } from 'react-native';

/** Versioned channel — Android locks sound/importance after first create. */
export const ORDER_ALERT_CHANNEL_ID = 'haul_new_orders_v1';
export const ORDER_ALERT_SOUND_FILE = 'order_alert.wav';
export const LEGACY_ORDER_CHANNELS = [
  'incoming_order_alarm',
  'haul_order_chime',
  'haul_new_orders',
] as const;

type NotificationsModule = typeof import('expo-notifications');

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

export async function ensureAndroidOrderAlertChannel() {
  const Notifications = loadNotifications();
  if (!Notifications || Platform.OS !== 'android') {
    return;
  }

  try {
    const existing = await Notifications.getNotificationChannelAsync(ORDER_ALERT_CHANNEL_ID).catch(
      () => null
    );
    const soundOk =
      existing &&
      (existing.sound === ORDER_ALERT_SOUND_FILE ||
        existing.sound === 'custom' ||
        String(existing.sound || '').includes('order_alert'));
    if (existing && !soundOk) {
      await Notifications.deleteNotificationChannelAsync(ORDER_ALERT_CHANNEL_ID).catch(() => undefined);
    }
  } catch {
    // Channel inspection is best-effort.
  }

  await Notifications.setNotificationChannelAsync(ORDER_ALERT_CHANNEL_ID, {
    name: 'New Order Alerts',
    description: 'Loud heads-up alerts when a cargo order is assigned to you.',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 220, 100, 220, 100, 320],
    lightColor: '#FFE500',
    sound: ORDER_ALERT_SOUND_FILE,
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
    bypassDnd: false,
  });
}
