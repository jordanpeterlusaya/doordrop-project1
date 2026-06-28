import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import { recordUserPushToken } from '@/lib/user-profile';

const pushScope = 'DoorDropPushNotifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getExpoProjectId() {
  return (
    Constants.easConfig?.projectId ||
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ||
    ''
  );
}

type PushNotificationRuntimeConfig = {
  androidNativeFcmConfigured?: boolean;
  androidPackage?: string;
  androidGoogleServicesPackage?: string | null;
};

type PushNotificationAvailability = {
  available: boolean;
  reason?: 'web' | 'android-fcm-not-configured';
  androidPackage?: string;
  androidGoogleServicesPackage?: string | null;
};

function getPushNotificationRuntimeConfig() {
  return (Constants.expoConfig?.extra?.pushNotifications ?? {}) as PushNotificationRuntimeConfig;
}

export function getDoorDropPushNotificationAvailability(): PushNotificationAvailability {
  if (Platform.OS === 'web') {
    return { available: false, reason: 'web' };
  }

  const runtimeConfig = getPushNotificationRuntimeConfig();
  if (Platform.OS === 'android' && runtimeConfig.androidNativeFcmConfigured !== true) {
    return {
      available: false,
      reason: 'android-fcm-not-configured',
      androidPackage: runtimeConfig.androidPackage,
      androidGoogleServicesPackage: runtimeConfig.androidGoogleServicesPackage,
    };
  }

  return { available: true };
}

function isNativeFcmInitializationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Default FirebaseApp is not initialized') ||
    message.includes('fcm-credentials') ||
    message.includes('FirebaseApp.initializeApp')
  );
}

export async function registerDoorDropPushNotifications(uid: string) {
  if (Platform.OS === 'web') {
    return null;
  }

  const availability = getDoorDropPushNotificationAvailability();
  if (!availability.available) {
    logWarning(pushScope, 'push-registration-unavailable', {
      uid,
      platform: Platform.OS,
      reason: availability.reason,
      androidPackage: availability.androidPackage,
      androidGoogleServicesPackage: availability.androidGoogleServicesPackage,
    });
    return null;
  }

  logAsyncStart(pushScope, 'registerDoorDropPushNotifications', { uid, platform: Platform.OS });

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'DoorDrop alerts',
        description: 'Order updates, driver messages, dispatch alerts, and offers.',
        importance: Notifications.AndroidImportance.MAX,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        lightColor: '#12B981',
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existingPermissions = await Notifications.getPermissionsAsync();
    const finalPermissions =
      existingPermissions.status === 'granted'
        ? existingPermissions
        : await Notifications.requestPermissionsAsync();

    if (finalPermissions.status !== 'granted') {
      logWarning(pushScope, 'push-permission-not-granted', {
        uid,
        status: finalPermissions.status,
      });
      return null;
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
      logWarning(pushScope, 'missing-expo-project-id', { uid });
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) {
      logWarning(pushScope, 'missing-push-token', { uid });
      return null;
    }

    await recordUserPushToken({
      uid,
      token,
      platform: Platform.OS,
    });

    logAsyncSuccess(pushScope, 'registerDoorDropPushNotifications', {
      uid,
      platform: Platform.OS,
    });

    return token;
  } catch (error) {
    if (isNativeFcmInitializationError(error)) {
      logWarning(pushScope, 'native-fcm-not-configured', {
        uid,
        platform: Platform.OS,
        message: error instanceof Error ? error.message : String(error ?? ''),
      });
      return null;
    }

    logAsyncFailure(pushScope, 'registerDoorDropPushNotifications', error, { uid });
    return null;
  }
}

export function readNotificationNavigationData(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data ?? {};

  return {
    notificationId: typeof data.notificationId === 'string' ? data.notificationId : '',
    orderId: typeof data.orderId === 'string' ? data.orderId : '',
    type: typeof data.type === 'string' ? data.type : '',
  };
}

export function logPushNotificationSetup() {
  logInfo(pushScope, 'push-notification-config', {
    projectId: getExpoProjectId() || 'missing',
    platform: Platform.OS,
    availability: getDoorDropPushNotificationAvailability(),
  });
}
