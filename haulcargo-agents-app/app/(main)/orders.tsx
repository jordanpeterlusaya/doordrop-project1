import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { OrderInboxCard } from '@/components/order-inbox-card';
import { EmptyState, FilterChip, Header, Screen } from '@/components/ui';
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
    <Screen scroll edges="top">
      <Header title="Oda" subtitle="Inbox ya oda zinazoingia na zinazoendelea." />
      <View style={styles.filters}>
        {(
          [
            ['inbox', 'Inbox'],
            ['offers', 'Mpya'],
            ['active', 'Hai'],
          ] as const
        ).map(([key, label]) => (
          <FilterChip
            key={key}
            label={label}
            selected={filter === key}
            onPress={() => setFilter(key)}
          />
        ))}
      </View>

      {rows.length === 0 ? (
        <EmptyState title="Hakuna oda" body="Hakuna oda kwenye kichujio hiki." />
      ) : (
        rows.map((item) => <OrderInboxCard key={item.id} item={item} carrierId={carrierId} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
});
