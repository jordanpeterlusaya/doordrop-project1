import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  capacitySnapshot,
  deskStatusLabel,
  dropOffLabel,
  isIncomingOffer,
  money,
  offerStillValid,
  shipmentCode,
} from '@/lib/carrier-helpers';
import type { Carrier, CarrierShipment } from '@/lib/carrier-types';

type Props = {
  item: CarrierShipment;
  carrierId: string;
  carrier?: Carrier | null;
  shipments?: CarrierShipment[];
};

export function OrderInboxCard({ item, carrierId, carrier, shipments }: Props) {
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
            <Text style={styles.badgeText}>{deskStatusLabel(item)}</Text>
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
          Mtumaji: {item.customerName || '—'} · {item.senderPhone || item.customerPhone || '—'}
        </Text>
        <Text style={styles.person} numberOfLines={1}>
          Mpokeaji: {item.recipientName || '—'} · {item.recipientPhone || '—'}
        </Text>
      </View>

      {liveOffer ? (
        <View style={styles.countdown}>
          <OfferCountdown shipment={item} />
          <WeightHint item={item} carrierId={carrierId} carrier={carrier} shipments={shipments} />
        </View>
      ) : null}
    </Pressable>
  );
}

function WeightHint({
  item,
  carrierId,
  carrier,
  shipments,
}: {
  item: CarrierShipment;
  carrierId: string;
  carrier?: Carrier | null;
  shipments?: CarrierShipment[];
}) {
  const weight = Number(item.weightKg) || 0;
  const snap = capacitySnapshot(carrier, shipments || [], carrierId, item.id);
  const over = snap.open != null && weight > snap.open;
  const openLabel = snap.open == null ? 'uwezo haujawekwa' : `uwezo wazi ${Math.max(0, Math.round(snap.open))} kg`;
  return (
    <Text style={[styles.hint, over && styles.hintOver]}>
      {weight ? `${weight} kg · ${openLabel}` : `Uzito wazi · ${openLabel}`}
      {over ? '. Bado unaweza kukubali.' : ''}
    </Text>
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
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    padding: 14,
    marginBottom: 10,
  },
  offerCard: {
    backgroundColor: theme.primarySoft,
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
  badgeOfferText: { fontFamily: typography.bold, fontSize: 11, color: theme.accent },
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
  countdown: { marginTop: 12, gap: 8 },
  hint: { fontFamily: typography.body, fontSize: 12, lineHeight: 16, color: theme.muted },
  hintOver: { color: theme.warning },
});
