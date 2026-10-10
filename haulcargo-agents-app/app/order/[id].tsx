import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { CommissionLock } from '@/components/commission-lock';
import { OfferCountdown } from '@/components/offer-countdown';
import { Card, Header, Muted, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { theme } from '@/constants/theme';
import {
  acceptOffer,
  advanceTrackStep,
  applyManifestMark,
  markCashCollected,
  rejectOffer,
  requestReconciliation,
  setPickupMode,
} from '@/lib/carrier-actions';
import { STATUS_LABEL, TRACK } from '@/lib/carrier-types';
import {
  dropOffLabel,
  formatWhen,
  isIncomingOffer,
  manifestNextAction,
  money,
  offerStillValid,
  shipmentCode,
  trackIndex,
} from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments, carrier, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const item = useMemo(() => shipments.find((s) => s.id === id), [shipments, id]);

  if (!item) {
    return (
      <Screen>
        <Header title="Oda" back />
        <Muted>Mzigo haupatikani au bado unapakia…</Muted>
      </Screen>
    );
  }

  const email = user?.email || '';

  return (
    <Screen scroll padBottom={40}>
      <Header title={shipmentCode(item)} back />
      {isIncomingOffer(item, carrierId) && offerStillValid(item) ? <OfferCountdown shipment={item} /> : null}

      <Card>
        <Text style={styles.status}>{STATUS_LABEL[item.shipmentStatus] || item.shipmentStatus}</Text>
        <Fact label="Marudio" value={dropOffLabel(item)} />
        <Fact label="Uzito" value={`${item.weightKg || 0} kg`} />
        <Fact label="Mtumaji" value={item.customerName || '—'} />
        <Fact label="Mpokeaji" value={item.recipientName || '—'} />
        <Fact label="Simu mtumaji" value={item.customerPhone || '—'} />
        <Fact label="Simu mpokeaji" value={item.recipientPhone || '—'} />
        <Fact label="Safari" value={[item.routeLabel, item.departureTime ? `kuondoka ${item.departureTime}` : ''].filter(Boolean).join(' · ') || '—'} />
      </Card>

      <SectionTitle>Malipo & kamisheni</SectionTitle>
      <Card>
        <CommissionLock
          cashExpected={item.cashExpected}
          haulFee={item.haulFee}
          carrierNet={item.carrierNet}
          cashStatus={item.cashStatus}
        />
      </Card>

      {item.statusHistory?.length ? (
        <>
          <SectionTitle>Historia</SectionTitle>
          <Card>
            {[...item.statusHistory].reverse().slice(0, 12).map((entry, i) => (
              <Text key={`${entry.at}-${i}`} style={styles.historyLine}>
                {entry.label || entry.status} · {formatWhen(entry.at)}
              </Text>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Vitendo</SectionTitle>
      {isIncomingOffer(item, carrierId) && offerStillValid(item) ? (
        <View style={styles.gap}>
          <PrimaryButton label="Kubali" onPress={() => void acceptOffer(item.id, carrierId, email)} />
          <PrimaryButton label="Kataa" variant="outline" onPress={() => void rejectOffer(item.id, carrierId, email)} />
        </View>
      ) : null}

      {!item.pickupMode && item.carrierId === carrierId && ['accepted', 'contacted'].includes(item.shipmentStatus) ? (
        <View style={styles.gap}>
          <PrimaryButton label="Nitafuata kwa mteja" onPress={() => void setPickupMode(item.id, carrierId, 'agent_collects', email).then(() => router.push(`/directions/${item.id}`))} />
          <PrimaryButton label="Leteni ofisini" variant="outline" onPress={() => void setPickupMode(item.id, carrierId, 'haul_delivers_to_office', email)} />
        </View>
      ) : null}

      {item.pickupMode === 'agent_collects' ? (
        <PrimaryButton label="Ramani — eneo la oda" onPress={() => router.push(`/directions/${item.id}`)} />
      ) : null}

      {item.carrierId === carrierId && item.pickupMode ? (() => {
        const idx = trackIndex(item);
        const next = idx >= 0 ? TRACK[idx + 1] : null;
        if (next) {
          return (
            <PrimaryButton
              label={`Hatua: ${next.label}`}
              onPress={() => void advanceTrackStep(item.id, carrierId, next.key, email)}
            />
          );
        }
        const manifest = manifestNextAction(item);
        if (manifest) {
          return (
            <PrimaryButton
              label={manifest.label}
              onPress={() => void applyManifestMark(item.id, carrierId, manifest.act, email)}
            />
          );
        }
        return null;
      })() : null}

      <View style={styles.gap}>
        {item.customerPhone ? (
          <PrimaryButton
            label="Piga simu mtumaji"
            variant="outline"
            onPress={() => void Linking.openURL(`tel:${String(item.customerPhone).replace(/\D/g, '')}`)}
          />
        ) : null}
        <PrimaryButton label="Risiti / stika" variant="outline" onPress={() => router.push(`/receipt/${item.id}`)} />
        {item.cashStatus === 'unpaid' ? (
          <PrimaryButton label="Cash imekusanywa" onPress={() => void markCashCollected(item.id)} />
        ) : null}
        {item.cashStatus === 'collected' ? (
          <PrimaryButton label="Omba ulinganifu" variant="outline" onPress={() => void requestReconciliation(item.id)} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 16, fontWeight: '800', color: theme.green, marginBottom: 12 },
  fact: { marginBottom: 10 },
  factLabel: { fontSize: 12, color: theme.muted, fontWeight: '600' },
  factValue: { fontSize: 15, color: theme.charcoal, marginTop: 2 },
  historyLine: { fontSize: 13, color: theme.muted, marginBottom: 6 },
  gap: { gap: 10, marginBottom: 10 },
});
