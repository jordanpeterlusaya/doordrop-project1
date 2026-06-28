import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, InteractionManager, Platform } from 'react-native';

import {
  getDoorDropPushNotificationAvailability,
  logPushNotificationSetup,
  readNotificationNavigationData,
  registerDoorDropPushNotifications,
} from '@/lib/push-notifications';
import {
  deleteAllUserNotifications,
  deleteUserNotification,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  subscribeToUserNotifications,
  type UserNotification,
} from '@/lib/user-notifications';
import { useAuthSession } from '@/providers/auth-provider';

type NotificationContextValue = {
  notifications: UserNotification[];
  loading: boolean;
  pushPermissionStatus: PushPermissionStatus;
  unreadCount: number;
  markAllRead: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  refreshPushPermissionStatus: () => Promise<PushPermissionStatus>;
  requestNotificationPermission: () => Promise<PushPermissionStatus>;
  removeAllNotifications: () => Promise<void>;
  removeNotification: (notificationId: string) => Promise<void>;
};

type PushPermissionStatus = 'unavailable' | 'undetermined' | 'granted' | 'denied';

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

function getInitialPushPermissionStatus(): PushPermissionStatus {
  return getDoorDropPushNotificationAvailability().available ? 'undetermined' : 'unavailable';
}

function shouldAlertForNotification(
  notification: UserNotification,
  preferences: {
    orderUpdates?: boolean;
    promotions?: boolean;
  } | null | undefined
) {
  if (notification.type === 'promotion') {
    return preferences?.promotions !== false;
  }

  return preferences?.orderUpdates !== false;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, user } = useAuthSession();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushPermissionStatus, setPushPermissionStatus] = useState<PushPermissionStatus>(getInitialPushPermissionStatus);
  const knownNotificationIdsRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  useEffect(() => {
    logPushNotificationSetup();
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setPushPermissionStatus(getInitialPushPermissionStatus());
      return;
    }

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        void (async () => {
          const token = await registerDoorDropPushNotifications(user.uid);
          if (!active) {
            return;
          }

          if (token) {
            setPushPermissionStatus('granted');
            return;
          }

          if (!getDoorDropPushNotificationAvailability().available) {
            setPushPermissionStatus('unavailable');
            return;
          }

          const permissions = await Notifications.getPermissionsAsync();
          if (active) {
            setPushPermissionStatus(permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined');
          }
        })();
      }, 1500);
    });

    return () => {
      active = false;
      interactionTask.cancel();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [user?.uid]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = readNotificationNavigationData(response);

      if (data.orderId) {
        router.push({
          pathname: '/track-order',
          params: { orderId: data.orderId },
        });
        return;
      }

      router.push('/notifications');
    });

    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      knownNotificationIdsRef.current = new Set();
      hydratedRef.current = false;
      return;
    }

    setLoading(true);
    knownNotificationIdsRef.current = new Set();
    hydratedRef.current = false;

    const unsubscribe = subscribeToUserNotifications(
      user.uid,
      (nextNotifications) => {
        setNotifications(nextNotifications);
        setLoading(false);

        if (!hydratedRef.current) {
          knownNotificationIdsRef.current = new Set(nextNotifications.map((item) => item.id));
          hydratedRef.current = true;
          return;
        }

        const freshNotifications = nextNotifications
          .filter((item) => !knownNotificationIdsRef.current.has(item.id))
          .sort((left, right) => {
            const leftTime =
              typeof left.createdAt === 'object' &&
              left.createdAt !== null &&
              'toMillis' in left.createdAt &&
              typeof left.createdAt.toMillis === 'function'
                ? left.createdAt.toMillis()
                : 0;
            const rightTime =
              typeof right.createdAt === 'object' &&
              right.createdAt !== null &&
              'toMillis' in right.createdAt &&
              typeof right.createdAt.toMillis === 'function'
                ? right.createdAt.toMillis()
                : 0;
            return leftTime - rightTime;
          });

        freshNotifications.forEach((item) => {
          knownNotificationIdsRef.current.add(item.id);
        });

        const newestNotification = freshNotifications[freshNotifications.length - 1];
        if (newestNotification && shouldAlertForNotification(newestNotification, profile?.notificationPreferences)) {
          Alert.alert(newestNotification.title, newestNotification.message);
        }
      },
      () => {
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [profile?.notificationPreferences, user]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);

  const value = useMemo(
    () => ({
      notifications,
      loading,
      pushPermissionStatus,
      unreadCount,
      markAllRead: async () => {
        if (!user) {
          return;
        }

        await markAllUserNotificationsRead(user.uid);
      },
      markRead: async (notificationId: string) => {
        await markUserNotificationRead(notificationId);
      },
      refreshPushPermissionStatus: async () => {
        if (!getDoorDropPushNotificationAvailability().available) {
          setPushPermissionStatus('unavailable');
          return 'unavailable' as PushPermissionStatus;
        }

        const permissions = await Notifications.getPermissionsAsync();
        const nextStatus =
          permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined';
        setPushPermissionStatus(nextStatus);
        return nextStatus;
      },
      requestNotificationPermission: async () => {
        if (!user?.uid) {
          setPushPermissionStatus(getInitialPushPermissionStatus());
          return getInitialPushPermissionStatus();
        }

        if (!getDoorDropPushNotificationAvailability().available) {
          setPushPermissionStatus('unavailable');
          return 'unavailable';
        }

        const token = await registerDoorDropPushNotifications(user.uid);
        if (token) {
          setPushPermissionStatus('granted');
          return 'granted';
        }

        const permissions = await Notifications.getPermissionsAsync();
        const nextStatus =
          permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined';
        setPushPermissionStatus(nextStatus);
        return nextStatus;
      },
      removeAllNotifications: async () => {
        if (!user) {
          return;
        }

        await deleteAllUserNotifications(user.uid);
      },
      removeNotification: async (notificationId: string) => {
        await deleteUserNotification(notificationId);
      },
    }),
    [loading, notifications, pushPermissionStatus, unreadCount, user]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error('useNotifications must be used inside NotificationProvider');
  }

  return context;
}
