import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { Card, Muted, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { theme } from '@/constants/theme';
import { acceptOffer, rejectOffer, setPickupMode } from '@/lib/carrier-actions';
import { STATUS_LABEL } from '@/lib/carrier-types';
import {
  darTodayLabel,
  dropOffLabel,
  isIncomingOffer,
  manifestNextAction,
  money,
  offerStillValid,
  primaryActiveJob,
  shipmentCode,
  todayCargoRows,
  trackIndex,
} from '@/lib/carrier-helpers';
import { TRACK } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

export default function HomeScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const job = carrierId ? primaryActiveJob(shipments, carrierId) : null;
  const todayCount = carrierId ? todayCargoRows(shipments, carrierId).filter((i) => i.shipmentStatus !== 'delivered').length : 0;

  const renderJobActions = () => {
    if (!job || !carrierId || !user?.email) return null;
    if (isIncomingOffer(job, carrierId) && offerStillValid(job)) {
      return (
        <View style={styles.actions}>
          <PrimaryButton
            label="Kubali"
            onPress={() => void acceptOffer(job.id, carrierId, user.email!).then(() => router.push(`/order/${job.id}`))}
          />
          <PrimaryButton label="Kataa" variant="outline" onPress={() => void rejectOffer(job.id, carrierId, user.email!)} />
        </View>
      );
    }
    if (!job.pickupMode && ['accepted', 'contacted'].includes(job.shipmentStatus)) {
      return (
        <View style={styles.actions}>
          <PrimaryButton
            label="Nitafuata kwa mteja"
            onPress={() => void setPickupMode(job.id, carrierId, 'agent_collects', user.email!).then(() => router.push(`/directions/${job.id}`))}
          />
          <PrimaryButton
            label="Leteni ofisini"
            variant="outline"
            onPress={() => void setPickupMode(job.id, carrierId, 'haul_delivers_to_office', user.email!)}
          />
        </View>
      );
    }
    if (job.pickupMode === 'agent_collects' && job.pickupLatitude && job.pickupLongitude) {
      return <PrimaryButton label="Elekea eneo la oda" onPress={() => router.push(`/directions/${job.id}`)} />;
    }
    const manifest = manifestNextAction(job);
    if (manifest) {
      return (
        <PrimaryButton label={manifest.label} onPress={() => router.push(`/order/${job.id}`)} />
      );
    }
    const idx = trackIndex(job);
    const next = idx >= 0 ? TRACK[idx + 1] : null;
    if (next) {
      return <PrimaryButton label={next.label} onPress={() => router.push(`/order/${job.id}`)} />;
    }
    return <PrimaryButton label="Angalia oda" variant="outline" onPress={() => router.push(`/order/${job.id}`)} />;
  };

  return (
    <Screen scroll>
      <Text style={styles.greeting}>{carrier?.companyName || 'Haul Cargo Agents'}</Text>
      <Muted>{darTodayLabel()}</Muted>
      <Text style={styles.count}>{todayCount} mizigo leo</Text>

      <SectionTitle>Kazi yako sasa</SectionTitle>
      {!job ? (
        <Card>
          <Muted>Hakuna oda hai kwa sasa. Oda mpya itaonekana hapa na countdown ya dakika 5.</Muted>
        </Card>
      ) : (
        <Card>
          <Text style={styles.code}>{shipmentCode(job)}</Text>
          <Text style={styles.dest}>{dropOffLabel(job)}</Text>
          <Text style={styles.meta}>
            {job.weightKg || 0} kg · {money(job.cashExpected)} · {STATUS_LABEL[job.shipmentStatus] || job.shipmentStatus}
          </Text>
          {isIncomingOffer(job, carrierId) ? <OfferCountdown shipment={job} /> : null}
          <View style={styles.spacer} />
          {renderJobActions()}
          <Pressable onPress={() => router.push(`/order/${job.id}`)} style={styles.detailLink}>
            <Text style={styles.detailText}>Maelezo kamili</Text>
          </Pressable>
        </Card>
      )}

      <Pressable onPress={() => router.push('/schedule')} style={styles.scheduleLink}>
        <Text style={styles.scheduleText}>Ratiba ya safari leo →</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 22, fontWeight: '800', color: theme.charcoal, marginBottom: 4 },
  count: { fontSize: 16, fontWeight: '700', color: theme.green, marginTop: 8, marginBottom: 8 },
  code: { fontSize: 20, fontWeight: '800', color: theme.charcoal },
  dest: { fontSize: 15, color: theme.muted, marginTop: 4 },
  meta: { fontSize: 13, color: theme.muted, marginTop: 8, marginBottom: 12 },
  actions: { gap: 10 },
  spacer: { height: 8 },
  detailLink: { marginTop: 14, alignItems: 'center' },
  detailText: { color: theme.green, fontWeight: '600' },
  scheduleLink: { marginTop: 20 },
  scheduleText: { color: theme.green, fontWeight: '700', fontSize: 15 },
});
