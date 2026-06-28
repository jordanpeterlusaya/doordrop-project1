import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoHeader, CargoScreen, SectionHeader } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import {
  formatDeliveryDateTime,
  getDeliveryOrderStatusLabel,
  hasDeliveryOrderRating,
  subscribeToUserOrders,
  type DeliveryOrder,
} from '@/lib/delivery-data';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const filters = ['All', 'Parcel', 'Cargo'] as const;

function HistoryScreenContent() {
  const router = useRouter();
  const { user } = useAuthSession();
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>('All');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        setError('We could not load your order history right now.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (activeFilter === 'All') return true;
      if (activeFilter === 'Parcel') return order.flow === 'parcel';
      return order.flow === 'cargo';
    });
  }, [activeFilter, orders]);

  const deliveredOrders = orders.filter((order) => order.status === 'delivered').length;
  const activeOrders = orders.filter((order) => ['driver_assigned', 'driver_at_pickup', 'in_transit'].includes(order.status)).length;

  return (
    <CargoScreen contentContainerStyle={styles.content} footer={<BottomNav activeTab="history" />}>
      <CargoHeader
        title="History"
        subtitle="Review previous bookings, recent dispatch activity and live order outcomes."
        leftAction="menu"
        onLeftPress={() => router.push('/menu')}
        rightIcon="map-marker-path"
        onRightPress={() => router.push('/track-order')}
      />

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{orders.length}</Text>
          <Text style={styles.statLabel}>Orders created</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{deliveredOrders}</Text>
          <Text style={styles.statLabel}>Delivered orders</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{activeOrders}</Text>
          <Text style={styles.statLabel}>Active with drivers</Text>
        </View>
      </View>

      <SectionHeader title="Filter orders" />
      <View style={styles.filterRow}>
        {filters.map((filter) => {
          const isActive = filter === activeFilter;
          return (
            <TouchableOpacity
              key={filter}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter)}>
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{filter}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionHeader title="Recent orders" />
      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={cargoTheme.colors.primary} />
          <Text style={styles.emptyTitle}>Loading orders</Text>
          <Text style={styles.emptyText}>We are reading your Firestore order history now.</Text>
        </View>
      ) : null}

      {!loading && !user ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="account-lock-outline" size={30} color="#94A3B8" />
          <Text style={styles.emptyTitle}>Sign in to view history</Text>
          <Text style={styles.emptyText}>Your previous parcel and cargo orders appear here after you log in.</Text>
        </View>
      ) : null}

      {!loading && !!error ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="cloud-alert-outline" size={30} color="#94A3B8" />
          <Text style={styles.emptyTitle}>History is unavailable</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : null}

      {!loading && user && !error && !filteredOrders.length ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="history" size={30} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>Create your first parcel or cargo request and it will appear here automatically.</Text>
        </View>
      ) : null}

      {filteredOrders.map((order) => (
        <TouchableOpacity
          key={order.id}
          style={styles.orderCard}
          activeOpacity={0.88}
          onPress={() =>
            router.push({
              pathname: '/track-order',
              params: { orderId: order.id },
            })
          }>
          <View style={styles.orderLeading}>
            <View style={styles.orderIconWrap}>
              <MaterialCommunityIcons
                name={order.flow === 'parcel' ? 'package-variant-closed' : 'truck-fast-outline'}
                size={20}
                color={cargoTheme.colors.text}
              />
            </View>
            <View style={styles.orderCopy}>
              <Text style={styles.orderTitle}>{order.serviceLabel}</Text>
              <Text style={styles.orderRoute}>{order.pickupLabel} to {order.dropoffLabel}</Text>
              <Text style={styles.orderMeta}>
                {order.orderNumber} • {formatDeliveryDateTime(order.createdAt)}
              </Text>
              {order.status === 'delivered' ? (
                <View style={styles.orderRatingRow}>
                  <MaterialCommunityIcons
                    name={hasDeliveryOrderRating(order) ? 'star' : 'star-outline'}
                    size={14}
                    color="#F59E0B"
                  />
                  <Text style={styles.orderRatingText}>
                    {hasDeliveryOrderRating(order) ? `${order.customerRating}/5 customer rating saved` : 'Tap to rate this completed delivery'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.orderTrailing}>
            <Text style={styles.orderAmount}>{order.totalLabel}</Text>
            <Text
              style={[
                styles.orderStatus,
                order.status === 'cancelled' && styles.orderStatusCanceled,
                order.status === 'delivered' && styles.orderStatusDelivered,
              ]}>
              {getDeliveryOrderStatusLabel(order.status)}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </CargoScreen>
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
    paddingBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 24,
    padding: 18,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 12,
    lineHeight: 18,
    color: '#D7E1EA',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
  },
  filterChipActive: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '700',
    color: cargoTheme.colors.text,
  },
  filterTextActive: {
    color: cargoTheme.colors.primaryDark,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
    paddingHorizontal: 18,
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
  orderCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  orderLeading: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 12,
  },
  orderIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  orderCopy: {
    flex: 1,
  },
  orderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  orderRoute: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginBottom: 4,
  },
  orderMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  orderRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  orderRatingText: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
    fontWeight: '700',
  },
  orderTrailing: {
    alignItems: 'flex-end',
    maxWidth: 120,
  },
  orderAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 6,
  },
  orderStatus: {
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: cargoTheme.colors.info,
  },
  orderStatusCanceled: {
    color: cargoTheme.colors.warning,
  },
  orderStatusDelivered: {
    color: cargoTheme.colors.primaryDark,
  },
});
