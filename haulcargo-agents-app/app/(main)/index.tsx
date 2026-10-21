import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OrderInboxCard } from '@/components/order-inbox-card';
import { TierBadge } from '@/components/tier-badge';
import { EmptyState, Screen } from '@/components/ui';
import { tierWarning } from '@/constants/carrier-desk';
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
  const warning = tierWarning(standing, Boolean(carrier?.offersPaused || carrier?.fraudHold));

  return (
    <Screen scroll edges="top" backgroundColor="#F4F5F7">
      <View style={styles.header}>
        <View style={styles.identity}>
          <View style={styles.brandRow}>
            <View style={styles.mark} />
            <Text style={styles.brand}>HAUL</Text>
          </View>
          <Text style={styles.company} numberOfLines={2} accessibilityRole="header">
            {company}
          </Text>
          {warning ? (
            <Text style={[styles.warning, (carrier?.offersPaused || carrier?.fraudHold || standing.closure) && styles.warningHard]}>
              {warning}
            </Text>
          ) : null}
        </View>
        <TierBadge standing={standing} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 22,
  },
  identity: { flex: 1, minWidth: 0 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  mark: {
    width: 7,
    height: 7,
    borderRadius: 2,
    backgroundColor: theme.brandYellow,
  },
  brand: {
    fontFamily: typography.semibold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: theme.muted,
  },
  company: {
    fontFamily: typography.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    color: theme.ink,
  },
  warning: {
    marginTop: 6,
    fontFamily: typography.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: theme.ink,
  },
  warningHard: {
    color: theme.danger,
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
