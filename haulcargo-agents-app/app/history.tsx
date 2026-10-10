import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Header, Muted, Screen } from '@/components/ui';
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
      <Header title="Historia" back />
      <Muted style={styles.lead}>Mizigo iliyokabidhiwa — rekodi za zamani.</Muted>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Bado hakuna historia</Text>
          <Muted style={styles.emptyBody}>Mizigo iliyowasili itaonekana hapa.</Muted>
        </View>
      ) : (
        rows.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)} style={styles.row}>
            <Text style={styles.code}>{shipmentCode(item)}</Text>
            <Text style={styles.meta}>
              {formatWhen(item.deliveredAt)} · {money(item.carrierNet)}
            </Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 16 },
  empty: {
    paddingVertical: 36,
    paddingHorizontal: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.white,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    marginBottom: 6,
  },
  emptyBody: { textAlign: 'center' },
  row: {
    backgroundColor: theme.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
  },
  code: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  meta: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
});
