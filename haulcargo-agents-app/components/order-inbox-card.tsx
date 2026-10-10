import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  dropOffLabel,
  isIncomingOffer,
  money,
  offerStillValid,
  shipmentCode,
} from '@/lib/carrier-helpers';
import { STATUS_LABEL, type CarrierShipment } from '@/lib/carrier-types';

type Props = {
  item: CarrierShipment;
  carrierId: string;
};

export function OrderInboxCard({ item, carrierId }: Props) {
  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);

  return (
    <Pressable
      onPress={() => router.push(`/order/${item.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, liveOffer && styles.offerCard, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <Text style={styles.code}>{shipmentCode(item)}</Text>
        {liveOffer ? (
          <View style={styles.badgeOffer}>
            <Text style={styles.badgeOfferText}>ODA MPYA</Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{STATUS_LABEL[item.shipmentStatus] || item.shipmentStatus}</Text>
          </View>
        )}
      </View>

      <Text style={styles.dest} numberOfLines={2}>
        {dropOffLabel(item)}
      </Text>

      <View style={styles.metaGrid}>
        <Meta icon="scale-outline" text={`${item.weightKg || 0} kg`} />
        <Meta icon="cash-outline" text={money(item.cashExpected)} />
        {item.declaredValueTzs ? (
          <Meta icon="diamond-outline" text={`Thamani ${money(item.declaredValueTzs)}`} />
        ) : null}
      </View>

      <View style={styles.people}>
        <Text style={styles.person} numberOfLines={1}>
          Mtumaji: {item.customerName || '—'} · {item.customerPhone || '—'}
        </Text>
        <Text style={styles.person} numberOfLines={1}>
          Mpokeaji: {item.recipientName || '—'} · {item.recipientPhone || '—'}
        </Text>
      </View>

      {liveOffer ? (
        <View style={styles.countdown}>
          <OfferCountdown shipment={item} />
        </View>
      ) : null}
    </Pressable>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={14} color={theme.muted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  offerCard: {
    backgroundColor: theme.primarySoft,
    borderWidth: 1.5,
    borderColor: theme.ink,
  },
  pressed: { opacity: 0.92 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  code: {
    fontFamily: typography.bold,
    fontSize: 17,
    color: theme.ink,
    letterSpacing: -0.3,
    flex: 1,
  },
  badge: {
    backgroundColor: theme.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontFamily: typography.semibold, fontSize: 11, color: theme.ink },
  badgeOffer: {
    backgroundColor: theme.ink,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeOfferText: { fontFamily: typography.bold, fontSize: 11, color: theme.primary },
  dest: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontFamily: typography.body, fontSize: 13, color: theme.muted },
  people: { marginTop: 10, gap: 4 },
  person: { fontFamily: typography.body, fontSize: 13, color: theme.ink },
  countdown: { marginTop: 12 },
});
