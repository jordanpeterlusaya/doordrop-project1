import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, advanceDeskStep } from '@/lib/carrier-actions';
import {
  agentStatusError,
  deskStatusLabel,
  isIncomingOffer,
  nextDeskStep,
  offerStillValid,
  shipmentCode,
} from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

type Props = {
  item: CarrierShipment;
  carrierId: string;
};

function routeLine(item: CarrierShipment) {
  const from = String(item.pickupLabel || item.origin || '').trim();
  const to = String(item.destination || '').trim();
  if (from && to) return `${from} → ${to}`;
  return to || from || '—';
}

export function OrderInboxCard({ item, carrierId }: Props) {
  const { user } = useCarrierSession();
  const [busy, setBusy] = useState(false);
  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);
  const next = !offer && item.carrierId === carrierId ? nextDeskStep(item) : null;
  const actionLabel = liveOffer ? 'Kubali' : next?.label || '';
  const weight = Number(item.weightKg) || 0;

  const runAction = () => {
    if (!actionLabel || busy) return;
    const email = user?.email || '';
    setBusy(true);
    const work = liveOffer
      ? acceptOffer(item.id, carrierId, email)
      : next
        ? advanceDeskStep(item.id, carrierId, next.key, email)
        : Promise.resolve();
    void work
      .catch((error) => {
        const message = agentStatusError(error instanceof Error ? error.message : 'Imeshindwa.');
        if (message) Alert.alert('Imeshindwa', message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Pressable
      onPress={() => router.push(`/order/${item.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <Text style={styles.code} numberOfLines={1}>
          {shipmentCode(item)}
        </Text>
        <Text style={styles.status}>{liveOffer ? 'Mpya' : deskStatusLabel(item)}</Text>
      </View>
      <Text style={styles.route} numberOfLines={1}>
        {routeLine(item)}
      </Text>
      <View style={styles.bottom}>
        <Text style={styles.weight}>{weight ? `${weight} kg` : '—'}</Text>
        {liveOffer ? <OfferCountdown shipment={item} compact /> : <View />}
        {actionLabel ? (
          <Pressable
            onPress={runAction}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed, busy && styles.actionBusy]}>
            <Text style={styles.actionText}>{busy ? '…' : actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.white,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pressed: { opacity: 0.92 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  code: {
    flex: 1,
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  status: { fontFamily: typography.semibold, fontSize: 12, color: theme.muted },
  route: {
    marginTop: 4,
    fontFamily: typography.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: theme.ink,
  },
  bottom: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  weight: { fontFamily: typography.body, fontSize: 13, color: theme.muted },
  action: {
    marginLeft: 'auto',
    backgroundColor: theme.cta.backgroundColor,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: 'center',
  },
  actionPressed: { backgroundColor: theme.cta.pressedBackgroundColor },
  actionBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  actionText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.cta.labelColor,
  },
});
