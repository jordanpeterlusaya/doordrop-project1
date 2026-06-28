import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';

import { AuthNotificationBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { formatDeliveryDateTime, getDeliveryOrderStatusLabel, type DeliveryOrderStatus } from '@/lib/delivery-data';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess } from '@/lib/debug-logger';
import { useNotifications } from '@/providers/notification-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const screenScope = 'NotificationsScreen';

function getNotificationPresentation(input: {
  type: 'order_created' | 'order_status' | 'promotion' | 'message';
  orderStatus?: DeliveryOrderStatus;
}) {
  if (input.type === 'promotion') {
    return {
      icon: 'ticket-percent-outline' as const,
      tint: '#FFF7ED',
      iconColor: '#EA580C',
    };
  }

  if (input.type === 'order_created') {
    return {
      icon: 'clipboard-check-outline' as const,
      tint: '#ECFDF3',
      iconColor: '#166534',
    };
  }

  if (input.type === 'message') {
    return {
      icon: 'message-text-outline' as const,
      tint: '#EFF6FF',
      iconColor: '#2563EB',
    };
  }

  if (input.orderStatus === 'delivered') {
    return {
      icon: 'check-decagram-outline' as const,
      tint: '#EFF6FF',
      iconColor: '#2563EB',
    };
  }

  if (input.orderStatus === 'cancelled') {
    return {
      icon: 'close-circle-outline' as const,
      tint: '#FEF2F2',
      iconColor: '#DC2626',
    };
  }

  return {
    icon: 'truck-fast-outline' as const,
    tint: '#DCFCE7',
    iconColor: '#166534',
  };
}

function NotificationRow({
  index,
  isLast,
  item,
  onDelete,
  onPress,
}: {
  index: number;
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
        <View style={[styles.deleteActionWrap, index !== 0 && styles.deleteActionGapTop, isLast && styles.deleteActionRoundedBottom]}>
          <TouchableOpacity
            activeOpacity={0.88}
            style={styles.deleteActionButton}
            onPress={handleDelete}>
            <MaterialCommunityIcons name="trash-can-outline" size={20} color="#FFFFFF" />
            <Text style={styles.deleteActionText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}>
      <TouchableOpacity
        activeOpacity={0.88}
        style={[styles.itemRow, !isLast && styles.itemBorder, !item.readAt && styles.itemUnread]}
        onPress={onPress}>
        <View style={[styles.iconWrap, { backgroundColor: presentation.tint }]}>
          <MaterialCommunityIcons name={presentation.icon} size={20} color={presentation.iconColor} />
        </View>
        <View style={styles.itemCopy}>
          <View style={styles.itemTop}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemTime}>{formatDeliveryDateTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.itemMessage}>{item.message}</Text>
          {item.orderStatus ? (
            <Text style={styles.itemMeta}>
              {getDeliveryOrderStatusLabel(item.orderStatus)}
              {item.orderNumber ? ` • ${item.orderNumber}` : ''}
            </Text>
          ) : item.type === 'message' ? (
            <Text style={styles.itemMeta}>{item.orderNumber ? `Driver chat • ${item.orderNumber}` : 'Driver chat'}</Text>
          ) : item.orderNumber ? (
            <Text style={styles.itemMeta}>{item.orderNumber}</Text>
          ) : null}
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

  const permissionTitle =
    pushPermissionStatus === 'granted'
      ? 'Push alerts are on'
      : pushPermissionStatus === 'unavailable'
        ? 'Push alerts unavailable'
        : 'Allow push alerts';
  const permissionText =
    pushPermissionStatus === 'granted'
      ? 'This device can receive order, ETA and driver message alerts.'
      : pushPermissionStatus === 'unavailable'
        ? 'This build is missing Android FCM configuration. In-app notifications will still appear here.'
      : pushPermissionStatus === 'denied'
        ? 'Notifications are blocked in device settings. Enable them to receive live DoorDrop updates.'
        : 'Turn on notifications so DoorDrop can alert you when drivers and dispatch update an order.';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <CargoScreen contentContainerStyle={styles.content}>
        <CargoHeader
          title="Notifications"
          subtitle="Delivery updates, dispatch alerts and account activity."
          onLeftPress={() => router.back()}
        />

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{unreadCount > 0 ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}` : 'Stay in sync'}</Text>
          <Text style={styles.summaryText}>
            {unreadCount > 0
              ? 'Your latest order activity is ready below and will keep updating automatically.'
              : 'Important delivery activity, driver messages, ETA updates and support messages appear here.'}
          </Text>
          <Text style={styles.summaryHint}>Swipe right once to delete instantly.</Text>
          <View style={styles.permissionPanel}>
            <View style={styles.permissionCopy}>
              <MaterialCommunityIcons
                name={pushPermissionStatus === 'granted' ? 'bell-check-outline' : 'bell-alert-outline'}
                size={19}
                color="#FFFFFF"
              />
              <View style={styles.permissionTextWrap}>
                <Text style={styles.permissionTitle}>{permissionTitle}</Text>
                <Text style={styles.permissionText}>{permissionText}</Text>
              </View>
            </View>
            {pushPermissionStatus !== 'granted' && pushPermissionStatus !== 'unavailable' ? (
              <TouchableOpacity
                activeOpacity={0.88}
                disabled={permissionSubmitting}
                style={[styles.permissionButton, permissionSubmitting && styles.actionButtonDisabled]}
                onPress={() => {
                  void handleRequestPermission();
                }}>
                <Text style={styles.permissionButtonText}>{permissionSubmitting ? 'Opening...' : 'Allow'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={cargoTheme.colors.primary} />
            <Text style={styles.emptyTitle}>Loading notifications</Text>
            <Text style={styles.emptyText}>We are pulling your latest order alerts from Firestore.</Text>
          </View>
        ) : null}

        {!loading && !notifications.length ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bell-outline" size={30} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>When dispatch updates your order, it will appear here automatically.</Text>
          </View>
        ) : null}

        {!loading && notifications.length ? (
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>{notifications.length} notification{notifications.length === 1 ? '' : 's'}</Text>
            <TouchableOpacity
              activeOpacity={0.88}
              disabled={deleteAllSubmitting}
              style={[styles.deleteAllButton, deleteAllSubmitting && styles.actionButtonDisabled]}
              onPress={handleDeleteAll}>
              <MaterialCommunityIcons name="trash-can-outline" size={16} color="#DC2626" />
              <Text style={styles.deleteAllText}>{deleteAllSubmitting ? 'Deleting...' : 'Delete all'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && notifications.length ? (
          <View style={styles.listCard}>
            {notifications.map((item, index) => (
              <NotificationRow
                key={item.id}
                index={index}
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
    paddingBottom: 32,
  },
  summaryCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 20,
    marginBottom: 18,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  summaryText: {
    color: '#D6E0EA',
    fontSize: 14,
    lineHeight: 21,
  },
  summaryHint: {
    marginTop: 10,
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '700',
  },
  permissionPanel: {
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    gap: 12,
  },
  permissionCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  permissionTextWrap: {
    flex: 1,
    gap: 4,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  permissionText: {
    color: '#D6E0EA',
    fontSize: 12,
    lineHeight: 18,
  },
  permissionButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: cargoTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  listCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  listHeaderText: {
    color: cargoTheme.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionButtonDisabled: {
    opacity: 0.62,
  },
  deleteAllText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '800',
  },
  deleteActionWrap: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    backgroundColor: '#DC2626',
  },
  deleteActionGapTop: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  deleteActionRoundedBottom: {
    borderBottomLeftRadius: 24,
  },
  deleteActionButton: {
    minWidth: 112,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 16,
    backgroundColor: cargoTheme.colors.surface,
  },
  itemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  itemUnread: {
    backgroundColor: '#F8FAFC',
    marginHorizontal: -18,
    paddingHorizontal: 18,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: {
    flex: 1,
    gap: 5,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemTitle: {
    flex: 1,
    color: cargoTheme.colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemTime: {
    color: cargoTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '600',
  },
  itemMessage: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
  },
  itemMeta: {
    color: cargoTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
});
