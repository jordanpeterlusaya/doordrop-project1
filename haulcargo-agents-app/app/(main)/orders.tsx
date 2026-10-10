import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OfferCountdown } from '@/components/offer-countdown';
import { Card, Header, Muted, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { theme } from '@/constants/theme';
import { acceptOffer, rejectOffer } from '@/lib/carrier-actions';
import { STATUS_LABEL } from '@/lib/carrier-types';
import { dropOffLabel, isIncomingOffer, money, offerStillValid, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function OrdersScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const offers = shipments.filter((s) => isIncomingOffer(s, carrierId));
  const active = shipments.filter(
    (s) => s.carrierId === carrierId && s.shipmentStatus !== 'delivered' && s.shipmentStatus !== 'matching' && !isIncomingOffer(s, carrierId)
  );

  return (
    <Screen scroll>
      <Header title="Oda" />
      <SectionTitle>Zinazosubiri kukubaliwa</SectionTitle>
      {offers.length === 0 ? (
        <Card>
          <Muted>Hakuna oda mpya kwa sasa.</Muted>
        </Card>
      ) : (
        offers.map((item) => (
          <Card key={item.id}>
            <Pressable onPress={() => router.push(`/order/${item.id}`)}>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.dest}>{dropOffLabel(item)}</Text>
              <Text style={styles.meta}>
                {item.weightKg || 0} kg · {money(item.cashExpected)}
              </Text>
            </Pressable>
            {offerStillValid(item) ? <OfferCountdown shipment={item} /> : <Muted>Muda umeisha</Muted>}
            {offerStillValid(item) && user?.email ? (
              <View style={styles.row}>
                <View style={styles.flex}>
                  <PrimaryButton label="Kubali" onPress={() => void acceptOffer(item.id, carrierId, user.email!)} />
                </View>
                <View style={styles.flex}>
                  <PrimaryButton label="Kataa" variant="outline" onPress={() => void rejectOffer(item.id, carrierId, user.email!)} />
                </View>
              </View>
            ) : null}
          </Card>
        ))
      )}

      <SectionTitle>Zinazoendelea</SectionTitle>
      {active.length === 0 ? (
        <Card>
          <Muted>Hakuna oda hai.</Muted>
        </Card>
      ) : (
        active.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)}>
            <Card>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.dest}>{dropOffLabel(item)}</Text>
              <Text style={styles.meta}>{STATUS_LABEL[item.shipmentStatus] || item.shipmentStatus}</Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 17, fontWeight: '800', color: theme.charcoal },
  dest: { color: theme.muted, marginTop: 4 },
  meta: { color: theme.muted, fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flex: { flex: 1 },
});
