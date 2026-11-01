import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { BottomNav, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { CITY_PARCELS_ENABLED } from '@/constants/parcel-features';
import { typography } from '@/constants/typography';
import { isCargoNegotiationOpen } from '@/lib/active-order-display';
import { isNinunulieOrder, subscribeToUserOrders, type DeliveryOrder } from '@/lib/delivery-data';
import { getOrderRouteDisplay } from '@/lib/order-route-display';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

const filters = ['All', 'Parcel', 'Cargo'] as const;

const arts = {
  toyo: require('@/assets/images/cargo-avatar-toyo-cut.png'),
  toyo_electric: require('@/assets/images/cargo-avatar-toyo-electric-cut.png'),
  kirikuu: require('@/assets/images/cargo-avatar-kirikuu-cut.png'),
  canter: require('@/assets/images/cargo-avatar-canter-cut.png'),
  parcel: require('@/assets/images/parcel-packing-box.png'),
  ninunulie: require('@/assets/images/ninunulie-avatar.png'),
};

const shortMonths = {
  en: ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Machi', 'Apr', 'Mei', 'Juni', 'Juli', 'Ago', 'Sept', 'Okt', 'Nov', 'Des'],
};

const longMonths = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
};

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

function moneyLabel(order: DeliveryOrder) {
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  const amount = match ? Math.round(Number(match[1])) : Math.round(order.customerOffer || order.driverOffer || 0);
  return `TZS ${amount.toLocaleString('en-US')}`;
}

function placeLabel(order: DeliveryOrder) {
  const route = getOrderRouteDisplay(order);
  const to = route.to.trim();
  if (to && !/^drop-?off$/i.test(to)) {
    return to;
  }
  return route.from.trim() || order.serviceLabel;
}

function orderArt(order: DeliveryOrder) {
  if (isNinunulieOrder(order)) {
    return arts.ninunulie;
  }
  if (order.flow === 'parcel') {
    return arts.parcel;
  }
  const key = String(order.cargoVehicleKey || '').trim().toLowerCase();
  if (key === 'kirikuu') return arts.kirikuu;
  if (key === 'canter' || key === 'center' || key === 'fuso') return arts.canter;
  if (key === 'toyo_electric' || key === 'toyo-electric' || key === 'toyoelectric') return arts.toyo_electric;
  return arts.toyo;
}

function HistoryScreenContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthSession();
  const { language } = useLanguage();
  const isSw = language === 'sw';
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const copy = {
    title: isSw ? 'Historia' : 'Activity',
    all: isSw ? 'Zote' : 'All',
    parcel: 'Parcel',
    cargo: 'Cargo',
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
    cancelled: isSw ? 'Imefutwa' : 'Cancelled',
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
    return orders
      .filter((order) => {
        if (isCargoNegotiationOpen(order)) return false;
        if (activeFilter === 'All') return true;
        if (activeFilter === 'Parcel') return order.flow === 'parcel' || isNinunulieOrder(order);
        if (activeFilter === 'Cargo') return order.flow === 'cargo';
        return false;
      })
      .slice()
      .sort((a, b) => orderMillis(b.createdAt) - orderMillis(a.createdAt));
  }, [activeFilter, orders]);

  const groups = useMemo(() => {
    const locale = isSw ? 'sw' : 'en';
    const grouped: { label: string; items: DeliveryOrder[] }[] = [];
    filteredOrders.forEach((order) => {
      const millis = orderMillis(order.createdAt);
      const label = millis ? longMonths[locale][new Date(millis).getMonth()] : '';
      const existing = grouped.find((group) => group.label === label);
      if (existing) {
        existing.items.push(order);
        return;
      }
      grouped.push({ label, items: [order] });
    });
    return grouped;
  }, [filteredOrders, isSw]);

  const openOrder = (order: DeliveryOrder) => {
    if (isNinunulieOrder(order)) {
      Alert.alert(
        'Ninunulie',
        isSw
          ? `Oda ${order.orderNumber} inashughulikiwa kupitia WhatsApp na ofisi. Haipo kwenye live tracking.`
          : `Order ${order.orderNumber} is handled via WhatsApp and the office. It is not on live tracking.`
      );
      return;
    }

    router.push({
      pathname: '/track-order',
      params: { orderId: order.id },
    });
  };

  const formatWhen = (order: DeliveryOrder) => {
    const millis = orderMillis(order.createdAt);
    if (!millis) {
      return order.status === 'cancelled' ? copy.cancelled : '';
    }
    const date = new Date(millis);
    const locale = isSw ? 'sw' : 'en';
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const when = `${date.getDate()} ${shortMonths[locale][date.getMonth()]}, ${time}`;
    return order.status === 'cancelled' ? `${when} · ${copy.cancelled}` : when;
  };

  const filterLabels: Record<(typeof filters)[number], string> = {
    All: copy.all,
    Parcel: copy.parcel,
    Cargo: copy.cargo,
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content} footer={<BottomNav activeTab="history" embedInSafeFooter />}>
      <View style={styles.top}>
        <Text style={styles.title}>{copy.title}</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={() => setFilterOpen(true)}
          style={styles.filterButton}>
          <MaterialCommunityIcons name="tune-variant" size={20} color="#111827" />
          {activeFilter !== 'All' ? <View style={styles.filterDot} /> : null}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#111827" />
          <Text style={styles.emptyText}>{copy.loading}</Text>
        </View>
      ) : null}

      {!loading && !user ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{copy.signInTitle}</Text>
          <Text style={styles.emptyText}>{copy.signInText}</Text>
          <PrimaryButton label={copy.login} onPress={() => router.push('/login')} style={styles.emptyAction} />
        </View>
      ) : null}

      {!loading && !!error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{copy.errorTitle}</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : null}

      {!loading && user && !error && !filteredOrders.length ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{orders.length ? copy.emptyFilterTitle : copy.emptyTitle}</Text>
          <Text style={styles.emptyText}>{copy.emptyText}</Text>
          <PrimaryButton
            label={copy.sendParcel}
            onPress={() =>
              router.push(CITY_PARCELS_ENABLED ? '/send-parcel' : { pathname: '/send-parcel', params: { scope: 'outside' } })
            }
            style={styles.emptyAction}
          />
          <PrimaryButton label={copy.bookCargo} variant="secondary" onPress={() => router.push('/book-cargo')} style={styles.emptySecondary} />
        </View>
      ) : null}

      {!loading && user && !error
        ? groups.map((group, index) => (
            <View key={group.label || 'recent'}>
              {index > 0 && group.label ? <Text style={styles.month}>{group.label}</Text> : null}
              {group.items.map((order) => (
                <TouchableOpacity key={order.id} activeOpacity={0.75} onPress={() => openOrder(order)} style={styles.row}>
                  <View style={styles.thumb}>
                    <Image source={orderArt(order)} style={styles.thumbImage} resizeMode="contain" />
                  </View>
                  <View style={styles.copy}>
                    <Text numberOfLines={2} style={styles.place}>
                      {placeLabel(order)}
                    </Text>
                    <Text numberOfLines={1} style={styles.when}>
                      {formatWhen(order)}
                    </Text>
                  </View>
                  <Text style={styles.price}>{moneyLabel(order)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))
        : null}

      <Modal transparent visible={filterOpen} animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setFilterOpen(false)}>
          <View style={[styles.menu, { top: insets.top + 58 }]}>
            {filters.map((filter) => {
              const selected = filter === activeFilter;
              return (
                <TouchableOpacity
                  key={filter}
                  activeOpacity={0.8}
                  style={styles.menuItem}
                  onPress={() => {
                    setActiveFilter(filter);
                    setFilterOpen(false);
                  }}>
                  <Text style={[styles.menuText, selected && styles.menuTextOn]}>{filterLabels[filter]}</Text>
                  {selected ? <MaterialCommunityIcons name="check" size={18} color="#111827" /> : null}
                </TouchableOpacity>
              );
            })}
            <View style={styles.menuDivider} />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.menuItem}
              onPress={() => {
                setFilterOpen(false);
                router.push('/finance');
              }}>
              <Text style={styles.menuTextOn}>Finance</Text>
              <MaterialCommunityIcons name="chart-bar" size={18} color="#111827" />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
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
    paddingBottom: 28,
    paddingTop: 8,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.6,
  },
  filterButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  month: {
    marginTop: 22,
    marginBottom: 6,
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 12,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: {
    width: 52,
    height: 52,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 6,
  },
  place: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    color: '#111827',
  },
  when: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#9CA3AF',
  },
  price: {
    paddingTop: 6,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.bold,
    color: '#111827',
  },
  scrim: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    right: 18,
    minWidth: 168,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 6,
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 12,
    marginVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: '#6B7280',
  },
  menuTextOn: {
    color: '#111827',
    fontFamily: typography.bold,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 12,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: typography.ident,
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
