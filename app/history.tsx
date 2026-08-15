import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import {
  getDeliveryOrderStatusLabel,
  hasDeliveryOrderRating,
  subscribeToUserOrders,
  type DeliveryOrder,
  type DeliveryOrderStatus,
} from '@/lib/delivery-data';
import { getRepeatOrderHref } from '@/lib/repeat-order';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const filters = ['All', 'Parcel', 'Cargo'] as const;
const ACTIVE_STATUSES = new Set<DeliveryOrderStatus>([
  'pending_assignment',
  'driver_assigned',
  'driver_at_pickup',
  'in_transit',
]);

function orderMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return 0;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function HistoryScreenContent() {
  const router = useRouter();
  const { user } = useAuthSession();
  const { language } = useLanguage();
  const appCopy = useAppCopy();
  const isSw = language === 'sw';
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>('All');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const copy = {
    title: isSw ? 'Historia' : 'History',
    all: isSw ? 'Zote' : 'All',
    parcel: isSw ? 'Parcel' : 'Parcel',
    cargo: isSw ? 'Cargo' : 'Cargo',
    active: isSw ? 'Inaendelea' : 'Active',
    past: isSw ? 'Zilizopita' : 'Past',
    today: isSw ? 'Leo' : 'Today',
    yesterday: isSw ? 'Jana' : 'Yesterday',
    loading: isSw ? 'Inapakia...' : 'Loading...',
    signInTitle: isSw ? 'Ingia kuona historia' : 'Sign in to view history',
    signInText: isSw ? 'Oda zako za parcel na cargo zitaonekana hapa.' : 'Your parcel and cargo orders appear here.',
    login: isSw ? 'Ingia' : 'Login',
    errorTitle: isSw ? 'Historia haipatikani' : 'History unavailable',
    emptyTitle: isSw ? 'Bado huna oda' : 'No orders yet',
    emptyText: isSw ? 'Tuma parcel au book cargo, kisha itaonekana hapa.' : 'Send a parcel or book cargo and it will show up here.',
    emptyFilterTitle: isSw ? 'Hakuna oda katika kundi hili' : 'No orders in this filter',
    sendParcel: isSw ? 'Tuma parcel' : 'Send parcel',
    bookCargo: isSw ? 'Book cargo' : 'Book cargo',
    rate: isSw ? 'Gusa kupima' : 'Tap to rate',
    statuses: {
      pending_assignment: isSw ? 'Inatafuta dereva' : 'Waiting for driver',
      driver_assigned: isSw ? 'Dereva amepangiwa' : 'Driver assigned',
      driver_at_pickup: isSw ? 'Dereva yuko pickup' : 'Driver at pickup',
      in_transit: isSw ? 'Njiani' : 'In transit',
      delivered: isSw ? 'Imefika' : 'Delivered',
      cancelled: isSw ? 'Imefutwa' : 'Cancelled',
    } satisfies Record<DeliveryOrderStatus, string>,
  };

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const unsubscribe = subscribeToUserOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setLoading(false);
      },
      () => {
        setError(isSw ? 'Hatukuweza kupakia oda sasa.' : 'Could not load your orders right now.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [isSw, user]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (activeFilter === 'All') return true;
      if (activeFilter === 'Parcel') return order.flow === 'parcel';
      return order.flow === 'cargo';
    });
  }, [activeFilter, orders]);

  const activeOrders = useMemo(
    () => filteredOrders.filter((order) => ACTIVE_STATUSES.has(order.status)),
    [filteredOrders]
  );
  const pastOrders = useMemo(
    () => filteredOrders.filter((order) => !ACTIVE_STATUSES.has(order.status)),
    [filteredOrders]
  );

  const pastGroups = useMemo(() => {
    const today = startOfDay(new Date());
    const yesterday = today - 86_400_000;
    const groups: { label: string; items: DeliveryOrder[] }[] = [];

    pastOrders.forEach((order) => {
      const millis = orderMillis(order.createdAt);
      let label = copy.past;
      if (millis >= today) {
        label = copy.today;
      } else if (millis >= yesterday) {
        label = copy.yesterday;
      } else if (millis) {
        label = new Date(millis).toLocaleDateString(isSw ? 'sw-TZ' : 'en-US', {
          month: 'short',
          day: 'numeric',
        });
      }

      const existing = groups.find((group) => group.label === label);
      if (existing) {
        existing.items.push(order);
        return;
      }
      groups.push({ label, items: [order] });
    });

    return groups;
  }, [copy.past, copy.today, copy.yesterday, isSw, pastOrders]);

  const openOrder = (orderId: string) => {
    router.push({
      pathname: '/track-order',
      params: { orderId },
    });
  };

  const statusLabel = (status: DeliveryOrderStatus) => copy.statuses[status] || getDeliveryOrderStatusLabel(status);

  const formatTime = (value: unknown) => {
    const millis = orderMillis(value);
    if (!millis) {
      return isSw ? 'Sasa hivi' : 'Just now';
    }

    const today = startOfDay(new Date());
    const date = new Date(millis);
    const time = date.toLocaleTimeString(isSw ? 'sw-TZ' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    if (millis >= today) {
      return time;
    }

    return `${date.toLocaleDateString(isSw ? 'sw-TZ' : 'en-US', { month: 'short', day: 'numeric' })} · ${time}`;
  };

  const filterLabels: Record<(typeof filters)[number], string> = {
    All: copy.all,
    Parcel: copy.parcel,
    Cargo: copy.cargo,
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content} footer={<BottomNav activeTab="history" />}>
      <CargoHeader title={copy.title} leftAction="menu" onLeftPress={() => router.push('/menu')} />

      <View style={styles.segment}>
        {filters.map((filter) => {
          const isActive = filter === activeFilter;
          return (
            <TouchableOpacity
              key={filter}
              activeOpacity={0.88}
              style={[styles.segmentItem, isActive && styles.segmentItemActive]}
              onPress={() => setActiveFilter(filter)}>
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>{filterLabels[filter]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={cargoTheme.colors.primary} />
          <Text style={styles.emptyText}>{copy.loading}</Text>
        </View>
      ) : null}

      {!loading && !user ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name="account-lock-outline" size={26} color={cargoTheme.colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>{copy.signInTitle}</Text>
          <Text style={styles.emptyText}>{copy.signInText}</Text>
          <PrimaryButton label={copy.login} onPress={() => router.push('/login')} style={styles.emptyAction} />
        </View>
      ) : null}

      {!loading && !!error ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconMuted}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={26} color="#94A3B8" />
          </View>
          <Text style={styles.emptyTitle}>{copy.errorTitle}</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : null}

      {!loading && user && !error && !filteredOrders.length ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name="package-variant-closed" size={26} color={cargoTheme.colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>{orders.length ? copy.emptyFilterTitle : copy.emptyTitle}</Text>
          <Text style={styles.emptyText}>{copy.emptyText}</Text>
          <PrimaryButton label={copy.sendParcel} onPress={() => router.push('/send-parcel')} style={styles.emptyAction} />
          <PrimaryButton
            label={copy.bookCargo}
            variant="secondary"
            onPress={() => router.push('/book-cargo')}
            style={styles.emptySecondary}
          />
        </View>
      ) : null}

      {!loading && user && !error && activeOrders.length ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.liveDot} />
            <Text style={styles.sectionHeadLabel}>{copy.active}</Text>
            <Text style={styles.sectionCount}>{activeOrders.length}</Text>
          </View>
          {activeOrders.map((order) => (
            <OrderCard
              key={order.id}
              active
              order={order}
              rateLabel={copy.rate}
              sendAgainLabel={appCopy.history.sendAgain}
              statusLabel={statusLabel(order.status)}
              timeLabel={formatTime(order.createdAt)}
              onPress={() => openOrder(order.id)}
              onRepeat={() => router.push(getRepeatOrderHref(order))}
            />
          ))}
        </View>
      ) : null}

      {!loading && user && !error && pastGroups.map((group) => (
        <View key={group.label} style={styles.section}>
          <Text style={styles.sectionLabel}>{group.label}</Text>
          {group.items.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              rateLabel={copy.rate}
              sendAgainLabel={appCopy.history.sendAgain}
              statusLabel={statusLabel(order.status)}
              timeLabel={formatTime(order.createdAt)}
              onPress={() => openOrder(order.id)}
              onRepeat={() => router.push(getRepeatOrderHref(order))}
            />
          ))}
        </View>
      ))}
    </CargoScreen>
  );
}

function OrderCard({
  active = false,
  onPress,
  onRepeat,
  order,
  rateLabel,
  sendAgainLabel,
  statusLabel,
  timeLabel,
}: {
  active?: boolean;
  onPress: () => void;
  onRepeat: () => void;
  order: DeliveryOrder;
  rateLabel: string;
  sendAgainLabel: string;
  statusLabel: string;
  timeLabel: string;
}) {
  const isParcel = order.flow === 'parcel';
  const isDelivered = order.status === 'delivered';
  const isCancelled = order.status === 'cancelled';
  const rated = hasDeliveryOrderRating(order);

  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <TouchableOpacity activeOpacity={0.88} onPress={onPress}>
        <View style={styles.cardTop}>
          <View style={[styles.serviceIcon, isParcel ? styles.serviceIconParcel : styles.serviceIconCargo]}>
            <MaterialCommunityIcons
              name={isParcel ? 'package-variant-closed' : 'truck-fast-outline'}
              size={18}
              color={isParcel ? '#166534' : '#2563EB'}
            />
          </View>
          <Text numberOfLines={1} style={styles.serviceLabel}>
            {order.serviceLabel}
          </Text>
          <Text style={styles.amount}>{order.totalLabel}</Text>
        </View>

        <View style={styles.routeBlock}>
          <View style={styles.routeRail}>
            <View style={styles.pickupDot} />
            <View style={styles.routeLine} />
            <View style={styles.dropDot} />
          </View>
          <View style={styles.routeCopy}>
            <Text numberOfLines={1} style={styles.routeText}>
              {order.pickupLabel}
            </Text>
            <Text numberOfLines={1} style={styles.routeText}>
              {order.dropoffLabel}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View
            style={[
              styles.statusPill,
              active && styles.statusPillActive,
              isDelivered && styles.statusPillDelivered,
              isCancelled && styles.statusPillCancelled,
            ]}>
            <Text
              style={[
                styles.statusText,
                active && styles.statusTextActive,
                isDelivered && styles.statusTextDelivered,
                isCancelled && styles.statusTextCancelled,
              ]}>
              {statusLabel}
            </Text>
          </View>
          <Text style={styles.timeText}>{timeLabel}</Text>
          {isDelivered ? (
            <View style={styles.ratingWrap}>
              <MaterialCommunityIcons name={rated ? 'star' : 'star-outline'} size={13} color="#F59E0B" />
              <Text style={styles.ratingText}>{rated ? `${order.customerRating}/5` : rateLabel}</Text>
            </View>
          ) : (
            <MaterialCommunityIcons name="chevron-right" size={18} color="#CBD5E1" />
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.88} style={styles.repeatButton} onPress={onRepeat}>
        <MaterialCommunityIcons name="refresh" size={16} color={cargoTheme.colors.primaryDark} />
        <Text style={styles.repeatText}>{sendAgainLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function HistoryScreen() {
  return (
    <AuthSessionBoundary>
      <HistoryScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 28,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  segmentTextActive: {
    color: cargoTheme.colors.text,
    fontFamily: typography.bold,
  },
  section: {
    marginBottom: 18,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionHeadLabel: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionCount: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    padding: 14,
    marginBottom: 10,
  },
  cardActive: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  serviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconParcel: {
    backgroundColor: '#ECFDF3',
  },
  serviceIconCargo: {
    backgroundColor: '#EFF6FF',
  },
  serviceLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  amount: {
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  routeBlock: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    marginBottom: 12,
    paddingLeft: 2,
  },
  routeRail: {
    width: 10,
    alignItems: 'center',
    paddingVertical: 3,
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  routeLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#D1FAE5',
    marginVertical: 3,
  },
  dropDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.ink,
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
    gap: 10,
  },
  routeText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F1F5F9',
  },
  statusPillActive: {
    backgroundColor: '#DCFCE7',
  },
  statusPillDelivered: {
    backgroundColor: '#ECFDF3',
  },
  statusPillCancelled: {
    backgroundColor: '#FEF2F2',
  },
  statusText: {
    fontSize: 11,
    fontFamily: typography.bold,
    color: '#64748B',
  },
  statusTextActive: {
    color: '#166534',
  },
  statusTextDelivered: {
    color: '#166534',
  },
  statusTextCancelled: {
    color: '#DC2626',
  },
  timeText: {
    flex: 1,
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#94A3B8',
  },
  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  repeatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EEF4',
  },
  repeatText: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyIconMuted: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 8,
  },
  emptyAction: {
    alignSelf: 'stretch',
    marginTop: 8,
  },
  emptySecondary: {
    alignSelf: 'stretch',
    marginTop: 0,
  },
});
