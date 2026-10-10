import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { OrderInboxCard } from '@/components/order-inbox-card';
import { Card, Muted, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  darTodayKey,
  darTodayLabel,
  fireTimeMs,
  inboxShipments,
  isIncomingOffer,
} from '@/lib/carrier-helpers';
import { images } from '@/lib/images';
import { useCarrierSession } from '@/providers/carrier-session';

type FilterKey = 'all' | 'offers' | 'active' | 'today';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Zote' },
  { key: 'offers', label: 'Mpya' },
  { key: 'active', label: 'Hai' },
  { key: 'today', label: 'Leo' },
];

export default function HomeScreen() {
  const { carrier, shipments } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [filter, setFilter] = useState<FilterKey>('all');

  const inbox = useMemo(() => inboxShipments(shipments, carrierId), [shipments, carrierId]);

  const rows = useMemo(() => {
    const today = darTodayKey();
    return inbox.filter((item) => {
      if (filter === 'offers') return isIncomingOffer(item, carrierId);
      if (filter === 'active') return item.carrierId === carrierId && !isIncomingOffer(item, carrierId);
      if (filter === 'today') {
        const ms = fireTimeMs(item.offeredAt) || fireTimeMs(item.acceptedAt) || fireTimeMs(item.createdAt);
        if (!ms) return isIncomingOffer(item, carrierId);
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(ms));
        return day === today;
      }
      return true;
    });
  }, [inbox, filter, carrierId]);

  const offerCount = inbox.filter((item) => isIncomingOffer(item, carrierId)).length;

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.eyebrow}>HAUL Cargo Desk</Text>
          <Text style={styles.company} numberOfLines={2}>
            {carrier?.companyName || 'Kampuni yako'}
          </Text>
          <Muted>{darTodayLabel()}</Muted>
          <Text style={styles.lead}>
            {offerCount > 0
              ? `${offerCount} oda mpya zinazosubiri kukubaliwa`
              : 'Oda kutoka HAUL zitaonekana hapa'}
          </Text>
        </View>
        <Image source={images.deskCargoTruck} style={styles.heroArt} resizeMode="contain" />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const selected = filter === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setFilter(item.key)}
              style={[styles.filterChip, selected && styles.filterChipOn]}>
              <Text style={[styles.filterText, selected && styles.filterTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.quickRow}>
        <Pressable style={styles.quick} onPress={() => router.push('/history')}>
          <Ionicons name="time-outline" size={16} color={theme.ink} />
          <Text style={styles.quickText}>Historia</Text>
        </Pressable>
        <Pressable style={styles.quick} onPress={() => router.push('/(main)/fedha')}>
          <Ionicons name="wallet-outline" size={16} color={theme.ink} />
          <Text style={styles.quickText}>Fedha</Text>
        </Pressable>
        <Pressable style={styles.quick} onPress={() => router.push('/schedule')}>
          <Ionicons name="bus-outline" size={16} color={theme.ink} />
          <Text style={styles.quickText}>Ratiba</Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <Card style={styles.empty}>
          <Image source={images.deskPackingBox} style={styles.emptyArt} resizeMode="contain" />
          <Text style={styles.emptyTitle}>Hakuna oda kwenye inbox</Text>
          <Muted style={styles.emptyBody}>
            Mtuma mzigo kwenye HAUL anapoweka oda ya parcel, itaonekana hapa ikiwa coverage na njia yenu
            inalingana.
          </Muted>
        </Card>
      ) : (
        rows.map((item) => <OrderInboxCard key={item.id} item={item} carrierId={carrierId} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    backgroundColor: theme.primarySoft,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#F3E7A3',
  },
  heroText: { flex: 1 },
  eyebrow: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.muted,
    marginBottom: 2,
  },
  company: {
    fontFamily: typography.bold,
    fontSize: 22,
    lineHeight: 28,
    color: theme.ink,
    letterSpacing: -0.4,
  },
  lead: {
    marginTop: 8,
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.ink,
  },
  heroArt: { width: 88, height: 72 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: theme.tile,
  },
  filterChipOn: { backgroundColor: theme.ink },
  filterText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  filterTextOn: { color: theme.primary },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingVertical: 10,
  },
  quickText: { fontFamily: typography.semibold, fontSize: 12, color: theme.ink },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyArt: { width: 120, height: 96, marginBottom: 12 },
  emptyTitle: {
    fontFamily: typography.bold,
    fontSize: 17,
    color: theme.ink,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyBody: { textAlign: 'center', lineHeight: 20 },
});
