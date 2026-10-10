import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

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
  requestCommissionPayment,
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
  telHref,
  trackIndex,
} from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

function Fact({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const body = (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments, carrier, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const item = useMemo(() => shipments.find((s) => s.id === id), [shipments, id]);
  const [paying, setPaying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!item) {
    return (
      <Screen>
        <Header title="Oda" back />
        <Muted>Mzigo haupatikani au bado unapakia…</Muted>
      </Screen>
    );
  }

  const email = user?.email || '';
  const code = shipmentCode(item);
  const senderTel = telHref(item.customerPhone);
  const recipientTel = telHref(item.recipientPhone);
  const hasPickupCoords = Boolean(item.pickupLatitude && item.pickupLongitude);

  const copyCode = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const payCommission = () => {
    Alert.alert(
      'Lipa kamisheni',
      `Ombi la ${money(item.haulFee)} litatumwa kwa HAUL kwa ulinganifu (pending reconciliation). Hii si malipo ya mobile money moja kwa moja.`,
      [
        { text: 'Ghairi', style: 'cancel' },
        {
          text: 'Tuma ombi',
          onPress: () => {
            setPaying(true);
            void requestCommissionPayment(item.id, carrierId, email)
              .catch((error) => Alert.alert('Imeshindwa', error instanceof Error ? error.message : 'Jaribu tena'))
              .finally(() => setPaying(false));
          },
        },
      ]
    );
  };

  return (
    <Screen scroll padBottom={40}>
      <Header title={code} back />
      {isIncomingOffer(item, carrierId) && offerStillValid(item) ? <OfferCountdown shipment={item} /> : null}

      <Card>
        <Text style={styles.status}>{STATUS_LABEL[item.shipmentStatus] || item.shipmentStatus}</Text>
        <Fact label="Msimbo wa mzigo" value={copied ? 'Imenakiliwa ✓' : code} onPress={() => void copyCode()} />
        <Fact label="Marudio / eneo la mpokeaji" value={dropOffLabel(item)} />
        <Fact label="Mahali pa kuchukua" value={item.pickupLabel || item.origin || '—'} />
        <Fact label="Uzito" value={`${item.weightKg || 0} kg`} />
        <Fact label="Thamani iliyotangazwa" value={item.declaredValueTzs ? money(item.declaredValueTzs) : '—'} />
        <Fact label="Maelezo" value={item.parcelDescription || '—'} />
        <Fact label="Mtumaji" value={item.customerName || '—'} />
        <Fact label="Simu mtumaji" value={item.customerPhone || '—'} onPress={senderTel ? () => void Linking.openURL(senderTel) : undefined} />
        <Fact label="Mpokeaji" value={item.recipientName || '—'} />
        <Fact
          label="Simu mpokeaji"
          value={item.recipientPhone || '—'}
          onPress={recipientTel ? () => void Linking.openURL(recipientTel) : undefined}
        />
        <Fact
          label="Safari"
          value={[item.routeLabel, item.departureTime ? `kuondoka ${item.departureTime}` : ''].filter(Boolean).join(' · ') || '—'}
        />
      </Card>

      <SectionTitle>Malipo & kamisheni</SectionTitle>
      <Card>
        <CommissionLock
          cashExpected={item.cashExpected}
          haulFee={item.haulFee}
          carrierNet={item.carrierNet}
          cashStatus={item.cashStatus}
          paying={paying}
          onPayCommission={item.carrierId === carrierId ? payCommission : undefined}
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
          <PrimaryButton
            label="Nitafuata kwa mteja"
            onPress={() =>
              void setPickupMode(item.id, carrierId, 'agent_collects', email).then(() => router.push(`/directions/${item.id}`))
            }
          />
          <PrimaryButton
            label="Leteni ofisini"
            variant="outline"
            onPress={() => void setPickupMode(item.id, carrierId, 'haul_delivers_to_office', email)}
          />
        </View>
      ) : null}

      {hasPickupCoords ? (
        <PrimaryButton label="Fungua directions (pickup)" onPress={() => router.push(`/directions/${item.id}`)} />
      ) : null}

      {item.carrierId === carrierId && item.pickupMode
        ? (() => {
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
          })()
        : null}

      <View style={styles.gap}>
        {senderTel ? (
          <PrimaryButton label="Piga simu mtumaji" variant="outline" onPress={() => void Linking.openURL(senderTel)} />
        ) : null}
        {recipientTel ? (
          <PrimaryButton label="Piga simu mpokeaji" variant="outline" onPress={() => void Linking.openURL(recipientTel)} />
        ) : null}
        <PrimaryButton label="Nakili msimbo" variant="outline" onPress={() => void copyCode()} />
        <PrimaryButton label="Chapisha risiti / stika" variant="outline" onPress={() => router.push(`/receipt/${item.id}`)} />
        {item.cashStatus === 'unpaid' && item.carrierId === carrierId ? (
          <PrimaryButton label="Cash imekusanywa" onPress={() => void markCashCollected(item.id)} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 16, fontWeight: '800', color: theme.ink, marginBottom: 12 },
  fact: { marginBottom: 10 },
  factLabel: { fontSize: 12, color: theme.muted, fontWeight: '600' },
  factValue: { fontSize: 15, color: theme.charcoal, marginTop: 2 },
  historyLine: { fontSize: 13, color: theme.muted, marginBottom: 6 },
  gap: { gap: 10, marginBottom: 10 },
});
