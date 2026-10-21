import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { WarningSheet } from '@/components/warning-sheet';
import { KATAA_CONFIRM } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, advanceDeskStep, rejectOffer } from '@/lib/carrier-actions';
import {
  agentStatusError,
  cargoValueLabel,
  deskStatusLabel,
  isIncomingOffer,
  money,
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
  const [confirming, setConfirming] = useState(false);
  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);
  const next = !offer && item.carrierId === carrierId ? nextDeskStep(item) : null;
  const weight = Number(item.weightKg) || 0;
  const payout = Number(item.carrierNet) || Number(item.cashExpected) || 0;
  const valueLabel = cargoValueLabel(item);
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
    if (busy) return;
    setConfirming(true);
  };

  const onAdvance = () => {
    if (!next) return;
    run(advanceDeskStep(item.id, carrierId, next.key, email));
  };

  return (
    <>
    <Pressable
      onPress={() => router.push(`/order/${item.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <Text style={styles.code} numberOfLines={1}>
          {shipmentCode(item)}
        </Text>
        {liveOffer ? (
          <OfferCountdown shipment={item} compact />
        ) : (
          <Text style={styles.status}>{deskStatusLabel(item)}</Text>
        )}
      </View>

      <Text style={styles.route} numberOfLines={2}>
        {routeLine(item)}
      </Text>

      {valueLabel ? (
        <Text style={styles.value} numberOfLines={1}>
          {valueLabel}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <Text style={styles.weight}>{weight ? `${weight} kg` : '—'}</Text>
        {payout > 0 ? <Text style={styles.payout}>{money(payout)}</Text> : null}
      </View>

      {liveOffer ? (
        <View style={styles.actions}>
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              onAccept();
            }}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.accept, pressed && styles.acceptPressed, busy && styles.acceptBusy]}>
            <Text style={styles.acceptText}>{busy ? '…' : 'Kubali'}</Text>
          </Pressable>
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              onReject();
            }}
            disabled={busy}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.reject}>
            <Text style={styles.rejectText}>Kataa</Text>
          </Pressable>
        </View>
      ) : next ? (
        <Pressable
          onPress={(event) => {
            event.stopPropagation?.();
            onAdvance();
          }}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.accept, styles.advance, pressed && styles.acceptPressed, busy && styles.acceptBusy]}>
          <Text style={styles.acceptText}>{busy ? '…' : next.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
    <WarningSheet
      visible={confirming}
      title={KATAA_CONFIRM.title}
      message={KATAA_CONFIRM.message}
      onDismiss={() => setConfirming(false)}
      primaryLabel={KATAA_CONFIRM.confirmLabel}
      onPrimary={() => {
        setConfirming(false);
        run(rejectOffer(item.id, carrierId, email));
      }}
      primaryBusy={busy}
      secondaryLabel={KATAA_CONFIRM.backLabel}
      onSecondary={() => setConfirming(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.white,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  pressed: { opacity: 0.94 },
  top: {
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
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.muted,
  },
  route: {
    marginTop: 6,
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: theme.ink,
  },
  value: {
    marginTop: 4,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  meta: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  weight: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  payout: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accept: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  advance: { marginTop: 12, flex: 0, alignSelf: 'stretch' },
  acceptPressed: { backgroundColor: '#1A1A1A' },
  acceptBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  acceptText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  reject: {
    minHeight: 40,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.muted,
  },
});
