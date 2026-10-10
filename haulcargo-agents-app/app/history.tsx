import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Card, Header, Muted, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { formatWhen, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function HistoryScreen() {
  const { carrier, shipments } = useCarrierSession();
  const rows = useMemo(
    () =>
      shipments
        .filter((s) => s.carrierId === carrier?.id && s.shipmentStatus === 'delivered')
        .sort((a, b) => formatWhen(b.deliveredAt).localeCompare(formatWhen(a.deliveredAt))),
    [shipments, carrier?.id]
  );

  return (
    <Screen scroll>
      <Header title="Historia" back />
      {rows.length === 0 ? (
        <Card>
          <Muted>Bado hakuna mizigo iliyowasili.</Muted>
        </Card>
      ) : (
        rows.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)}>
            <Card>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.meta}>
                {formatWhen(item.deliveredAt)} · {money(item.carrierNet)}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontWeight: '800', color: theme.charcoal },
  meta: { color: theme.muted, marginTop: 6, fontSize: 13 },
});
