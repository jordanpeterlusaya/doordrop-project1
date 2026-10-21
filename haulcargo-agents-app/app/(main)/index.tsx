import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HomeStanding } from '@/components/home-standing';
import { OrderInboxCard } from '@/components/order-inbox-card';
import { EmptyState, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { deskStanding } from '@/lib/desk-standing';
import {
  carrierDisplayName,
  fireTimeMs,
  isCompletedShipment,
  isIncomingOffer,
  offerStillValid,
} from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

function byRecent(a: CarrierShipment, b: CarrierShipment) {
  const time = (item: CarrierShipment) =>
    fireTimeMs(item.offeredAt) || fireTimeMs(item.acceptedAt) || fireTimeMs(item.createdAt);
  return time(b) - time(a);
}

export default function HomeScreen() {
  const { carrier, shipments, decisions } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const company = carrierDisplayName(carrier);

  const { offers, active, standing } = useMemo(() => {
    const owned = shipments.filter((item) => item.carrierId === carrierId);
    const live = shipments
      .filter((item) => isIncomingOffer(item, carrierId) && offerStillValid(item))
      .sort(byRecent);
    const jobs = owned.filter((item) => !isCompletedShipment(item) && !isIncomingOffer(item, carrierId)).sort(byRecent);
    return {
      offers: live,
      active: jobs,
      standing: deskStanding(shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels),
    };
  }, [shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels]);

  const empty = offers.length === 0 && active.length === 0;

  return (
    <Screen scroll edges="top" backgroundColor="#F4F5F7">
      <View style={styles.desk}>
        <Text style={styles.company} numberOfLines={1} accessibilityRole="header">
          {company}
        </Text>
        <HomeStanding standing={standing} />
      </View>

      {offers.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Oda mpya</Text>
          {offers.map((item) => (
            <OrderInboxCard key={item.id} item={item} carrierId={carrierId} />
          ))}
        </View>
      ) : null}

      {active.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Kazi hai</Text>
          {active.map((item) => (
            <OrderInboxCard key={item.id} item={item} carrierId={carrierId} />
          ))}
        </View>
      ) : null}

      {empty ? <EmptyState title="Hakuna oda" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  desk: {
    marginBottom: 28,
  },
  company: {
    fontFamily: typography.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: theme.ink,
  },
  section: { marginBottom: 8 },
  sectionLabel: {
    fontFamily: typography.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.muted,
    marginBottom: 8,
  },
});
