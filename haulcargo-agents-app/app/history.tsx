import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
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
      <Header title="Historia" subtitle="Mizigo iliyokabidhiwa — rekodi za zamani." back />

      {rows.length === 0 ? (
        <EmptyState title="Bado hakuna historia" body="Mizigo iliyowasili itaonekana hapa." />
      ) : (
        rows.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.meta}>{formatWhen(item.deliveredAt)}</Text>
            </View>
            <Text style={styles.price}>{money(item.carrierNet)}</Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.tile,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  copy: { flex: 1, minWidth: 0 },
  code: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  meta: {
    marginTop: 4,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  price: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
  },
});
