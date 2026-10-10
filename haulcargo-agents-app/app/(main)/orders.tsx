import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OrderInboxCard } from '@/components/order-inbox-card';
import { Card, Header, Muted, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { inboxShipments, isIncomingOffer } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

type FilterKey = 'inbox' | 'offers' | 'active';

export default function OrdersScreen() {
  const { carrier, shipments } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [filter, setFilter] = useState<FilterKey>('inbox');

  const inbox = useMemo(() => inboxShipments(shipments, carrierId), [shipments, carrierId]);
  const rows = useMemo(() => {
    if (filter === 'offers') return inbox.filter((item) => isIncomingOffer(item, carrierId));
    if (filter === 'active') return inbox.filter((item) => item.carrierId === carrierId);
    return inbox;
  }, [inbox, filter, carrierId]);

  return (
    <Screen scroll>
      <Header title="Oda" />
      <Muted style={styles.lead}>Inbox ya oda zinazoingia na zinazoendelea.</Muted>
      <View style={styles.filters}>
        {(
          [
            ['inbox', 'Inbox'],
            ['offers', 'Mpya'],
            ['active', 'Hai'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.chip, filter === key && styles.chipOn]}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {rows.length === 0 ? (
        <Card>
          <Muted>Hakuna oda kwenye kichujio hiki.</Muted>
        </Card>
      ) : (
        rows.map((item) => <OrderInboxCard key={item.id} item={item} carrierId={carrierId} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 14 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: theme.tile,
  },
  chipOn: { backgroundColor: theme.ink },
  chipText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  chipTextOn: { color: theme.primary },
});
