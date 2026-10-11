import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeskRail } from '@/components/desk-rail';
import { OfferCountdown } from '@/components/offer-countdown';
import { ProofSheet } from '@/components/proof-sheet';
import { Header, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  acceptOffer,
  advanceDeskStep,
  attachShipmentToTrip,
  rejectOffer,
  requestCommissionPayment,
  setPickupMode,
} from '@/lib/carrier-actions';
import {
  capacitySnapshot,
  deskIndex,
  deskStatusLabel,
  isIncomingOffer,
  money,
  nextDeskStep,
  offerStillValid,
  shipmentCode,
  telHref,
} from '@/lib/carrier-helpers';
import { sameRegion } from '@/lib/regions';
import type { CarrierTrip } from '@/lib/carrier-types';
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
  const { shipments, shipmentsReady, carrier, user, trips } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const carrierId = carrier?.id || '';
  const item = useMemo(() => shipments.find((s) => s.id === id), [shipments, id]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [error, setError] = useState('');

  const email = user?.email || '';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Imeshindwa.');
    } finally {
      setBusy(false);
    }
  };

  if (!item) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 8 }]}>
        <Header
          title={shipmentsReady ? 'Muda umeisha' : 'Oda'}
          subtitle={
            shipmentsReady
              ? 'Oda hii haipo tena kwako. Muda wa kukubali umeisha, au imekwenda kampuni nyingine.'
              : 'Inapakia…'
          }
          back
        />
      </View>
    );
  }

  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);
  const expiredOffer = offer && !offerStillValid(item);
  const owned = item.carrierId === carrierId;
  const code = shipmentCode(item);
  const senderTel = telHref(item.customerPhone);
  const recipientTel = telHref(item.recipientPhone);
  const photos = (item.parcelPhotoUrls || []).filter((url) => /^https?:\/\//i.test(url));
  const next = owned ? nextDeskStep(item) : null;
  const capacity = capacitySnapshot(carrier, shipments, carrierId, item.id);
  const weight = Number(item.weightKg) || 0;
  const overCapacity = capacity.open != null && weight > capacity.open;
  const matchingTrips = trips.filter((trip) => sameRegion(item.destination || '', trip.destinationRegion));
  const onRail = deskIndex(item) >= 0;

  const copyCode = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const confirmReject = () => {
    Alert.alert('Kataa oda', 'Oda itarudi kwenye matching. Unathibitisha mara moja.', [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Kataa',
        style: 'destructive',
        onPress: () => void run(() => rejectOffer(item.id, carrierId, email)),
      },
    ]);
  };

  const goNext = () => {
    if (!next || next === 'proof') return;
    if (next.key === 'transit' && !item.tripId) {
      setTripOpen(true);
      return;
    }
    void run(() =>
      advanceDeskStep(item.id, carrierId, next.key, email, {
        tripId: item.tripId,
        tripName: item.tripName,
      })
    );
  };

  const sendOnTrip = (trip: CarrierTrip) => {
    void run(async () => {
      await attachShipmentToTrip(item.id, carrierId, { id: trip.id, name: trip.name });
      await advanceDeskStep(item.id, carrierId, 'transit', email, { tripId: trip.id, tripName: trip.name });
      setTripOpen(false);
    });
  };

  const payCommission = () => {
    Alert.alert(
      'Lipa kamisheni',
      `Ombi la ${money(item.haulFee)} litatumwa kwa HAUL. Hii si malipo yaliyokamilika.`,
      [
        { text: 'Ghairi', style: 'cancel' },
        {
          text: 'Tuma ombi',
          onPress: () => void run(() => requestCommissionPayment(item.id, carrierId, email)),
        },
      ]
    );
  };

  const cash = String(item.cashStatus || '').toLowerCase();
  const canRequestPay = owned && item.shipmentStatus === 'delivered' && (cash === 'unpaid' || cash === 'collected') && Number(item.haulFee) > 0;

  let primaryLabel = '';
  let primaryPress: () => void = () => undefined;
  if (liveOffer) {
    primaryLabel = 'Kubali';
    primaryPress = () => void run(() => acceptOffer(item.id, carrierId, email));
  } else if (next && next !== 'proof') {
    primaryLabel = next.label;
    primaryPress = goNext;
  } else if (next === 'proof') {
    primaryLabel = 'Thibitisha ukabidhi';
    primaryPress = () => setProofOpen(true);
  } else if (canRequestPay) {
    primaryLabel = 'Lipa kamisheni';
    primaryPress = payCommission;
  }

  if (expiredOffer || (!owned && !offer)) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 8, paddingHorizontal: 20 }]}>
        <Header title="Muda umeisha" subtitle={`${code} haiwezi kukubaliwa tena.`} back />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled">
        <Header title={copied ? 'Imenakiliwa' : code} subtitle={deskStatusLabel(item)} back />
        <Pressable onPress={() => void copyCode()} accessibilityRole="button">
          <Text style={styles.copyHint}>Gusa msimbo kunakili</Text>
        </Pressable>

        {onRail ? <DeskRail item={item} /> : null}
        {liveOffer ? (
          <View style={styles.countdownWrap}>
            <OfferCountdown shipment={item} />
          </View>
        ) : null}

        <View style={styles.panel}>
          <Fact label="Njia" value={item.routeLabel || `${item.origin || '—'} → ${item.destination || '—'}`} />
          <Fact label="Mzigo" value={item.parcelDescription || '—'} />
          <Fact label="Uzito" value={weight ? `${weight} kg` : 'Uzito wazi'} />
          <Fact label="Thamani" value={item.declaredValueTzs ? money(item.declaredValueTzs) : '—'} />
          <Fact label="Kuchukua" value={item.pickupLabel || item.origin || '—'} />
          {item.tripName ? <Fact label="Safari" value={item.tripName} /> : null}
        </View>

        {photos.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photos}>
            {photos.map((url) => (
              <Image key={url} source={{ uri: url }} style={styles.photo} />
            ))}
          </ScrollView>
        ) : null}

        {owned && deskIndex(item) >= 0 && deskIndex(item) < 2 ? (
          <View style={styles.panel}>
            <Text style={styles.factLabel}>Uchukuzi</Text>
            <Text style={styles.pickupCurrent}>
              {item.pickupMode === 'agent_collects'
                ? 'Nitafuata'
                : item.pickupMode === 'haul_delivers_to_office'
                  ? 'Leteni ofisini'
                  : 'Chagua jinsi mzigo utakavyoingia'}
            </Text>
            <View style={styles.pickupRow}>
              <Pressable
                style={[styles.pickupChip, item.pickupMode === 'agent_collects' && styles.pickupChipOn]}
                onPress={() => void run(() => setPickupMode(item.id, carrierId, 'agent_collects', email))}>
                <Text style={[styles.pickupText, item.pickupMode === 'agent_collects' && styles.pickupTextOn]}>
                  Nitafuata
                </Text>
              </Pressable>
              <Pressable
                style={[styles.pickupChip, item.pickupMode === 'haul_delivers_to_office' && styles.pickupChipOn]}
                onPress={() => void run(() => setPickupMode(item.id, carrierId, 'haul_delivers_to_office', email))}>
                <Text
                  style={[
                    styles.pickupText,
                    item.pickupMode === 'haul_delivers_to_office' && styles.pickupTextOn,
                  ]}>
                  Leteni ofisini
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {senderTel || recipientTel ? (
          <View style={styles.panel}>
            {senderTel ? (
              <Fact
                label="Mtumaji"
                value={`${item.customerName || 'Mtumaji'} · ${item.customerPhone}`}
                onPress={() => void Linking.openURL(senderTel)}
              />
            ) : null}
            {recipientTel ? (
              <Fact
                label="Mpokeaji"
                value={`${item.recipientName || 'Mpokeaji'} · ${item.recipientPhone}`}
                onPress={() => void Linking.openURL(recipientTel)}
              />
            ) : null}
            <Text style={styles.callHint}>Gusa simu kupiga.</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Fact label="Mteja analipa" value={money(item.cashExpected)} />
          <Fact label="Kamisheni" value={money(item.haulFee)} />
          <Fact label="Mapato yako" value={money(item.carrierNet)} />
        </View>

        <Pressable onPress={() => router.push(`/receipt/${item.id}`)}>
          <Text style={styles.link}>Risiti</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {primaryLabel || item.shipmentStatus === 'delivered' ? (
        <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {liveOffer ? (
            <Text style={[styles.capacity, overCapacity && styles.capacityOver]}>
              {weight
                ? `${weight} kg · uwezo wazi ${capacity.open == null ? 'haujawekwa' : `${Math.max(0, Math.round(capacity.open))} kg`}`
                : 'Uzito haujawekwa (wazi).'}
              {overCapacity ? ' Unazidi uwezo — bado unaweza kukubali.' : ''}
            </Text>
          ) : null}
          {primaryLabel ? <PrimaryButton label={primaryLabel} loading={busy} onPress={primaryPress} /> : null}
          {liveOffer ? (
            <PrimaryButton label="Kataa" variant="outline" disabled={busy} onPress={confirmReject} />
          ) : null}
          {item.shipmentStatus === 'delivered' && cash === 'pending_reconciliation' ? (
            <Text style={styles.pending}>Inasubiri ulinganifu</Text>
          ) : null}
          {item.shipmentStatus === 'delivered' && cash === 'reconciled' ? (
            <Text style={styles.pending}>Imelinganishwa</Text>
          ) : null}
        </View>
      ) : null}

      {proofOpen ? (
        <ProofSheet
          shipmentId={item.id}
          recipientPhone={item.recipientPhone}
          onClose={() => setProofOpen(false)}
          onDone={() => setProofOpen(false)}
        />
      ) : null}

      {tripOpen ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetDismiss} onPress={() => setTripOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Imetumwa</Text>
            {matchingTrips.length === 0 ? (
              <>
                <Text style={styles.sheetBody}>
                  Hakuna safari inayokwenda {item.destination || 'eneo hili'}. Unda safari kwanza, kisha tuma mzigo.
                </Text>
                <PrimaryButton
                  label="Unda safari"
                  onPress={() => {
                    setTripOpen(false);
                    router.push({ pathname: '/safari/new', params: { destination: item.destination || '' } });
                  }}
                />
              </>
            ) : (
              matchingTrips.map((trip) => (
                <Pressable key={trip.id} style={styles.tripRow} onPress={() => sendOnTrip(trip)}>
                  <Text style={styles.tripName}>{trip.name}</Text>
                  <Text style={styles.tripMeta}>
                    {trip.serviceDate} · {trip.destinationRegion}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.white },
  copyHint: {
    marginTop: -8,
    marginBottom: 14,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
  countdownWrap: { marginBottom: 14 },
  panel: {
    backgroundColor: theme.tile,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 12,
  },
  fact: { marginBottom: 12 },
  factLabel: { fontSize: 12, fontFamily: typography.semibold, color: theme.muted },
  factValue: { fontSize: 15, lineHeight: 21, fontFamily: typography.body, color: theme.ink, marginTop: 3 },
  photos: { marginBottom: 12 },
  photo: { width: 120, height: 90, borderRadius: 12, marginRight: 8 },
  pickupCurrent: { marginTop: 4, marginBottom: 10, fontFamily: typography.body, fontSize: 15, color: theme.ink },
  pickupRow: { flexDirection: 'row', gap: 8 },
  pickupChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pickupChipOn: { backgroundColor: theme.ink },
  pickupText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  pickupTextOn: { color: theme.white },
  callHint: { fontFamily: typography.body, fontSize: 12, color: theme.muted },
  link: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink, marginBottom: 8 },
  error: { fontFamily: typography.semibold, fontSize: 13, color: theme.danger, marginBottom: 8 },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    backgroundColor: theme.white,
  },
  capacity: { fontFamily: typography.body, fontSize: 13, lineHeight: 18, color: theme.muted },
  capacityOver: { color: theme.warning },
  pending: { textAlign: 'center', fontFamily: typography.semibold, fontSize: 13, color: theme.muted },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheetDismiss: { flex: 1 },
  sheet: {
    backgroundColor: theme.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
  },
  sheetTitle: { fontFamily: typography.bold, fontSize: 20, color: theme.ink },
  sheetBody: { fontFamily: typography.body, fontSize: 14, lineHeight: 20, color: theme.muted },
  tripRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  tripName: { fontFamily: typography.semibold, fontSize: 16, color: theme.ink },
  tripMeta: { marginTop: 2, fontFamily: typography.body, fontSize: 13, color: theme.muted },
});
