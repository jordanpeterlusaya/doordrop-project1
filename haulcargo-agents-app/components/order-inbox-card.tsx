import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, advanceDeskStep, rejectOffer } from '@/lib/carrier-actions';
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

function partyLine(item: CarrierShipment) {
  const sender = [item.senderName || item.customerName, item.senderPhone || item.customerPhone]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  const recipient = [item.recipientName, item.recipientPhone]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  if (sender && recipient) return `Mtumaji ${sender} · Mpokeaji ${recipient}`;
  if (sender) return `Mtumaji ${sender}`;
  if (recipient) return `Mpokeaji ${recipient}`;
  return '';
}

export function OrderInboxCard({ item, carrierId }: Props) {
  const { user } = useCarrierSession();
  const [busy, setBusy] = useState(false);
  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);
  const next = !offer && item.carrierId === carrierId ? nextDeskStep(item) : null;
  const weight = Number(item.weightKg) || 0;
  const email = user?.email || '';

  const run = (work: Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void work
      .catch((error) => {
        const message = agentStatusError(error instanceof Error ? error.message : 'Imeshindwa.');
        if (message) Alert.alert('Imeshindwa', message);
      })
      .finally(() => setBusy(false));
  };

  const onAccept = () => {
    run(acceptOffer(item.id, carrierId, email));
  };

  const onReject = () => {
    Alert.alert('Kataa oda', 'Una uhakika unataka kukataa oda hii?', [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Kataa',
        style: 'destructive',
        onPress: () => run(rejectOffer(item.id, carrierId, email)),
      },
    ]);
  };

  const onAdvance = () => {
    if (!next) return;
    run(advanceDeskStep(item.id, carrierId, next.key, email));
  };

  return (
    <Pressable
      onPress={() => router.push(`/order/${item.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, liveOffer && styles.cardOffer, pressed && styles.pressed]}>
      {liveOffer ? <View style={styles.accent} /> : null}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.code} numberOfLines={1}>
            {shipmentCode(item)}
          </Text>
          <Text style={[styles.status, liveOffer && styles.statusNew]}>
            {liveOffer ? 'Mpya' : deskStatusLabel(item)}
          </Text>
        </View>

        <Text style={styles.route} numberOfLines={2}>
          {routeLine(item)}
        </Text>

        {partyLine(item) ? (
          <Text style={styles.parties} numberOfLines={2}>
            {partyLine(item)}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.weight}>{weight ? `${weight} kg` : '—'}</Text>
          {liveOffer ? <OfferCountdown shipment={item} compact /> : null}
        </View>

        {liveOffer ? (
          <View style={styles.actions}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onAccept();
              }}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.acceptBtn,
                pressed && styles.acceptPressed,
                busy && styles.actionBusy,
              ]}>
              <Text style={styles.acceptText}>{busy ? '…' : 'Kubali'}</Text>
            </Pressable>
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onReject();
              }}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.rejectBtn,
                pressed && styles.rejectPressed,
                busy && styles.actionBusyOutline,
              ]}>
              <Text style={styles.rejectText}>Kataa</Text>
            </Pressable>
          </View>
        ) : next ? (
          <View style={styles.actions}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onAdvance();
              }}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.acceptBtn,
                pressed && styles.acceptPressed,
                busy && styles.actionBusy,
              ]}>
              <Text style={styles.acceptText}>{busy ? '…' : next.label}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: theme.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardOffer: {
    borderColor: theme.border,
  },
  accent: {
    width: 3,
    backgroundColor: theme.brandYellow,
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.94 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  code: {
    flex: 1,
    fontFamily: typography.medium,
    fontSize: 12,
    color: theme.muted,
    letterSpacing: 0.2,
  },
  status: {
    fontFamily: typography.semibold,
    fontSize: 11,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statusNew: {
    color: theme.ink,
  },
  route: {
    marginTop: 6,
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 21,
    color: theme.ink,
    letterSpacing: -0.3,
  },
  parties: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 16,
    color: theme.muted,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  weight: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptPressed: { backgroundColor: '#1A1A1A' },
  actionBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  actionBusyOutline: { opacity: 0.55 },
  acceptText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: theme.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectPressed: { backgroundColor: theme.primarySoft },
  rejectText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
  },
});
