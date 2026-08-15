import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';

import { AuthNotificationBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { formatDeliveryDateTime, getDeliveryOrderStatusLabel } from '@/lib/delivery-data';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess } from '@/lib/debug-logger';
import { getNotificationPresentation } from '@/lib/notification-presentation';
import { useNotifications } from '@/providers/notification-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const screenScope = 'NotificationsScreen';

function NotificationRow({
  isLast,
  item,
  onDelete,
  onPress,
}: {
  isLast: boolean;
  item: ReturnType<typeof useNotifications>['notifications'][number];
  onDelete: (notificationId: string) => Promise<void>;
  onPress: () => void;
}) {
  const swipeableRef = useRef<Swipeable | null>(null);
  const deleteTriggeredRef = useRef(false);
  const presentation = getNotificationPresentation({
    type: item.type,
    orderStatus: item.orderStatus,
  });

  const handleDelete = () => {
    if (deleteTriggeredRef.current) {
      return;
    }

    deleteTriggeredRef.current = true;
    swipeableRef.current?.close();
    void onDelete(item.id).catch(() => {
      deleteTriggeredRef.current = false;
    });
  };

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2}
      leftThreshold={72}
      overshootLeft={false}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') {
          handleDelete();
        }
      }}
      renderLeftActions={() => (
        <View style={styles.deleteActionWrap}>
          <TouchableOpacity activeOpacity={0.88} style={styles.deleteActionButton} onPress={handleDelete}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}>
      <TouchableOpacity
        activeOpacity={0.88}
        style={[styles.itemRow, !isLast && styles.itemBorder]}
        onPress={onPress}>
        <View style={[styles.iconWrap, { backgroundColor: presentation.tint }]}>
          <MaterialCommunityIcons name={presentation.icon} size={18} color={presentation.iconColor} />
        </View>
        <View style={styles.itemCopy}>
          <View style={styles.itemTop}>
            <Text numberOfLines={1} style={styles.itemTitle}>
              {item.title}
            </Text>
            {!item.readAt ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text numberOfLines={2} style={styles.itemMessage}>
            {item.message}
          </Text>
          <Text style={styles.itemTime}>
            {formatDeliveryDateTime(item.createdAt)}
            {item.orderStatus
              ? ` · ${getDeliveryOrderStatusLabel(item.orderStatus)}`
              : item.type === 'message'
                ? ' · Chat'
                : ''}
            {item.orderNumber ? ` · ${item.orderNumber}` : ''}
          </Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

function NotificationsScreenContent() {
  const router = useRouter();
  const {
    loading,
    markAllRead,
    markRead,
    notifications,
    pushPermissionStatus,
    removeAllNotifications,
    removeNotification,
    requestNotificationPermission,
    unreadCount,
  } = useNotifications();
  const [permissionSubmitting, setPermissionSubmitting] = useState(false);
  const [deleteAllSubmitting, setDeleteAllSubmitting] = useState(false);
  const copy = useAppCopy();

  useEffect(() => {
    if (!loading && unreadCount > 0) {
      logAsyncStart(screenScope, 'markAllRead', { unreadCount });
      void markAllRead()
        .then(() => {
          logAsyncSuccess(screenScope, 'markAllRead', { unreadCount });
        })
        .catch((error) => {
          logAsyncFailure(screenScope, 'markAllRead', error, { unreadCount });
        });
    }
  }, [loading, markAllRead, unreadCount]);

  const handleRequestPermission = async () => {
    if (permissionSubmitting || pushPermissionStatus === 'granted') {
      return;
    }

    setPermissionSubmitting(true);
    try {
      const status = await requestNotificationPermission();
      if (status === 'granted') {
        Alert.alert('Notifications enabled', 'DoorDrop can now send order and driver updates to this device.');
      } else if (status === 'denied') {
        Alert.alert('Notifications blocked', 'Turn on notifications from your device settings to receive DoorDrop alerts.');
      } else if (status === 'unavailable') {
        Alert.alert('Push alerts unavailable', 'This build is missing Android FCM configuration. In-app notifications will still appear here.');
      } else {
        Alert.alert('Notifications pending', 'Permission was not enabled yet. You can try again anytime.');
      }
    } finally {
      setPermissionSubmitting(false);
    }
  };

  const handleDeleteAll = () => {
    if (!notifications.length || deleteAllSubmitting) {
      return;
    }

    Alert.alert('Delete all notifications?', 'This clears every notification in this list.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeleteAllSubmitting(true);
            try {
              logAsyncStart(screenScope, 'deleteAllNotifications', { count: notifications.length });
              await removeAllNotifications();
              logAsyncSuccess(screenScope, 'deleteAllNotifications', { count: notifications.length });
            } catch (error) {
              logAsyncFailure(screenScope, 'deleteAllNotifications', error, { count: notifications.length });
              Alert.alert('Delete failed', 'Please try clearing notifications again.');
            } finally {
              setDeleteAllSubmitting(false);
            }
          })();
        },
      },
    ]);
  };

  const showPermissionPrompt =
    pushPermissionStatus !== 'granted' && pushPermissionStatus !== 'unavailable';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
        <CargoHeader title={copy.notifications.title} onLeftPress={() => router.back()} />

        {showPermissionPrompt ? (
          <TouchableOpacity
            activeOpacity={0.88}
            disabled={permissionSubmitting}
            style={styles.permissionRow}
            onPress={() => void handleRequestPermission()}>
            <MaterialCommunityIcons name="bell-outline" size={18} color={cargoTheme.colors.primaryDark} />
            <Text style={styles.permissionText}>
              {permissionSubmitting ? copy.notifications.opening : copy.notifications.enable}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={cargoTheme.colors.primary} />
            <Text style={styles.emptyText}>{copy.common.loading}</Text>
          </View>
        ) : null}

        {!loading && !notifications.length ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bell-outline" size={28} color="#94A3B8" />
            <Text style={styles.emptyTitle}>{copy.notifications.emptyTitle}</Text>
            <Text style={styles.emptyText}>{copy.notifications.emptyText}</Text>
          </View>
        ) : null}

        {!loading && notifications.length ? (
          <>
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderText}>
                {notifications.length}{' '}
                {notifications.length === 1 ? copy.notifications.update : copy.notifications.updates}
              </Text>
              <TouchableOpacity
                activeOpacity={0.88}
                disabled={deleteAllSubmitting}
                onPress={handleDeleteAll}>
                <Text style={[styles.deleteAllText, deleteAllSubmitting && styles.actionDisabled]}>
                  {deleteAllSubmitting ? copy.notifications.deleting : copy.notifications.clearAll}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.listCard}>
              {notifications.map((item, index) => (
                <NotificationRow
                  key={item.id}
                  isLast={index === notifications.length - 1}
                  item={item}
                  onDelete={async (notificationId) => {
                    logAsyncStart(screenScope, 'deleteNotification', { notificationId });
                    try {
                      await removeNotification(notificationId);
                      logAsyncSuccess(screenScope, 'deleteNotification', { notificationId });
                    } catch (error) {
                      logAsyncFailure(screenScope, 'deleteNotification', error, { notificationId });
                      throw error;
                    }
                  }}
                  onPress={() => {
                    logAsyncStart(screenScope, 'markRead', { notificationId: item.id });
                    void markRead(item.id)
                      .then(() => {
                        logAsyncSuccess(screenScope, 'markRead', { notificationId: item.id });
                      })
                      .catch((error) => {
                        logAsyncFailure(screenScope, 'markRead', error, { notificationId: item.id });
                      });

                    if (item.orderId) {
                      router.push({
                        pathname: '/track-order',
                        params: { orderId: item.orderId },
                      });
                    }
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
      </CargoScreen>
    </GestureHandlerRootView>
  );
}

export default function NotificationsScreen() {
  return (
    <AuthNotificationBoundary>
      <NotificationsScreenContent />
    </AuthNotificationBoundary>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  listHeaderText: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deleteAllText: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: '#DC2626',
  },
  actionDisabled: {
    opacity: 0.55,
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    overflow: 'hidden',
  },
  deleteActionWrap: {
    justifyContent: 'center',
    alignItems: 'stretch',
    backgroundColor: '#DC2626',
  },
  deleteActionButton: {
    minWidth: 72,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEF4',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  itemMessage: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  itemTime: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#94A3B8',
  },
});
