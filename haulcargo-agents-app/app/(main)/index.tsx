import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { OrderInboxCard } from '@/components/order-inbox-card';
import { EmptyState, FilterChip, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  carrierDisplayName,
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
  const { carrier, shipments, offerBanner, dismissOfferBanner } = useCarrierSession();
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
  const company = carrierDisplayName(carrier);

  return (
    <Screen scroll edges="top">
      <Text style={styles.greeting} numberOfLines={2} accessibilityRole="header">
        {company}
      </Text>
      <Text style={styles.dateLine}>{darTodayLabel()}</Text>
      <Text style={styles.lead}>
        {offerCount > 0
          ? `${offerCount} oda mpya zinazosubiri kukubaliwa`
          : 'Oda kutoka HAUL zitaonekana hapa'}
      </Text>

      <View style={styles.utilityBar}>
        <Pressable style={styles.utilityAction} onPress={() => router.push('/history')}>
          <View style={styles.utilityIcon}>
            <Ionicons name="time-outline" size={16} color={theme.ink} />
          </View>
          <Text style={styles.utilityLabel}>Historia</Text>
        </Pressable>
        <View style={styles.utilityDivider} />
        <Pressable style={styles.utilityAction} onPress={() => router.push('/safari')}>
          <View style={styles.utilityIcon}>
            <Ionicons name="bus-outline" size={16} color={theme.ink} />
          </View>
          <Text style={styles.utilityLabel}>Safari</Text>
        </Pressable>
      </View>

      {offerBanner ? (
        <Pressable
          style={styles.banner}
          onPress={() => {
            const shipmentId = offerBanner.shipmentId;
            dismissOfferBanner();
            router.push(`/order/${shipmentId}`);
          }}>
          <Text style={styles.bannerKicker}>ODA MPYA</Text>
          <Text style={styles.bannerBody} numberOfLines={2}>
            {offerBanner.code}
            {offerBanner.destination ? ` · ${offerBanner.destination}` : ''}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <FilterChip
            key={item.key}
            label={item.label}
            selected={filter === item.key}
            onPress={() => setFilter(item.key)}
          />
        ))}
      </View>

      {rows.length === 0 ? (
        <EmptyState
          title="Hakuna oda kwenye inbox"
          body="Mtuma mzigo kwenye HAUL anapoweka oda inayotoka mkoa wenu na kwenda kwenye coverage yenu, itaonekana hapa.">
          <Image source={images.deskPackingBox} style={styles.emptyArt} resizeMode="contain" />
        </EmptyState>
      ) : (
        <View style={styles.list}>
          {rows.map((item) => (
            <OrderInboxCard
              key={item.id}
              item={item}
              carrierId={carrierId}
              carrier={carrier}
              shipments={shipments}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  dateLine: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
    marginBottom: 8,
  },
  lead: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: theme.ink,
    marginBottom: 14,
  },
  utilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: theme.tile,
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
  },
  utilityAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 8,
  },
  utilityIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
  utilityDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: '#D1D5DB',
  },
  banner: {
    backgroundColor: theme.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  bannerKicker: {
    fontFamily: typography.bold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: theme.white,
    marginBottom: 2,
  },
  bannerBody: {
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: theme.white,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  list: { gap: 0 },
  emptyArt: { width: 120, height: 96, marginTop: 14 },
});
