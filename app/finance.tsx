import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { typography } from '@/constants/typography';
import { isCargoNegotiationOpen } from '@/lib/active-order-display';
import { subscribeToUserOrders, type DeliveryOrder } from '@/lib/delivery-data';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

const MONTHS = 6;
const CHART_HEIGHT = 168;

const shortMonths = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};

const longMonths = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
};

function orderMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return 0;
}

function orderAmount(order: DeliveryOrder) {
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (match) return Math.round(Number(match[1]));
  return Math.round(order.customerOffer || order.driverOffer || 0);
}

function countsAsSpend(order: DeliveryOrder) {
  if (order.status === 'cancelled') return false;
  if (isCargoNegotiationOpen(order)) return false;
  return orderAmount(order) > 0;
}

function money(amount: number) {
  return `TZS ${Math.round(amount).toLocaleString('en-US')}`;
}

function compactMoney(amount: number) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

function FinanceScreenContent() {
  const router = useRouter();
  const { user } = useAuthSession();
  const { language } = useLanguage();
  const isSw = language === 'sw';
  const locale = isSw ? 'sw' : 'en';
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToUserOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, [user]);

  const months = useMemo(() => {
    const now = new Date();
    const buckets = Array.from({ length: MONTHS }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - index), 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: shortMonths[locale][date.getMonth()],
        name: longMonths[locale][date.getMonth()],
        year: date.getFullYear(),
        month: date.getMonth(),
        amount: 0,
      };
    });
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

    orders.forEach((order) => {
      if (!countsAsSpend(order)) return;
      const millis = orderMillis(order.createdAt);
      if (!millis) return;
      const date = new Date(millis);
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (!bucket) return;
      bucket.amount += orderAmount(order);
    });

    return buckets;
  }, [locale, orders]);

  const total = months.reduce((sum, month) => sum + month.amount, 0);
  const peak = Math.max(...months.map((month) => month.amount), 0);
  const activeKey = selectedKey || months[months.length - 1]?.key || '';
  const active = months.find((month) => month.key === activeKey) || months[months.length - 1];

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title="Finance" onLeftPress={() => router.back()} />

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color="#111827" />
        </View>
      ) : !user ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{isSw ? 'Ingia kuona matumizi' : 'Sign in to see spending'}</Text>
          <PrimaryButton label={isSw ? 'Ingia' : 'Login'} onPress={() => router.push('/login')} />
        </View>
      ) : (
        <>
          <Text style={styles.kicker}>{isSw ? 'Miezi 6 iliyopita' : 'Last 6 months'}</Text>
          <Text style={styles.total}>{money(total)}</Text>
          <Text style={styles.hint}>
            {active ? `${active.name} · ${money(active.amount)}` : ''}
          </Text>

          <View style={styles.chart}>
            {months.map((month) => {
              const height = peak > 0 && month.amount > 0 ? Math.max(10, (month.amount / peak) * CHART_HEIGHT) : 6;
              const selected = month.key === activeKey;
              return (
                <Pressable key={month.key} style={styles.barCol} onPress={() => setSelectedKey(month.key)}>
                  <Text style={styles.barValue}>{month.amount > 0 ? compactMoney(month.amount) : ''}</Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height,
                          backgroundColor: selected ? '#111827' : '#FFE500',
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barLabel, selected && styles.barLabelOn]}>{month.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.list}>
            {months
              .slice()
              .reverse()
              .map((month) => (
                <Pressable key={month.key} style={styles.listRow} onPress={() => setSelectedKey(month.key)}>
                  <Text style={styles.listName}>{month.name}</Text>
                  <Text style={styles.listAmount}>{money(month.amount)}</Text>
                </Pressable>
              ))}
          </View>
        </>
      )}
    </CargoScreen>
  );
}

export default function FinanceScreen() {
  return (
    <AuthSessionBoundary>
      <FinanceScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 36,
  },
  kicker: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: '#6B7280',
  },
  total: {
    marginTop: 4,
    fontFamily: typography.ident,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: '#111827',
  },
  hint: {
    marginTop: 4,
    marginBottom: 18,
    fontFamily: typography.body,
    fontSize: 14,
    color: '#6B7280',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    minHeight: CHART_HEIGHT + 48,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barValue: {
    minHeight: 16,
    marginBottom: 6,
    fontFamily: typography.semibold,
    fontSize: 11,
    color: '#6B7280',
  },
  barTrack: {
    height: CHART_HEIGHT,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '70%',
    borderRadius: 8,
  },
  barLabel: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 12,
    color: '#9CA3AF',
  },
  barLabelOn: {
    color: '#111827',
  },
  list: {
    marginTop: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  listName: {
    fontFamily: typography.semibold,
    fontSize: 16,
    color: '#111827',
  },
  listAmount: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: '#111827',
  },
  empty: {
    paddingVertical: 40,
    gap: 12,
  },
  emptyTitle: {
    textAlign: 'center',
    fontFamily: typography.ident,
    fontSize: 18,
    color: '#111827',
  },
});
