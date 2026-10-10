import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Header, Muted, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { applyManifestMark } from '@/lib/carrier-actions';
import { STATUS_LABEL } from '@/lib/carrier-types';
import { groupManifestByDrop, manifestNextAction, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ManifestScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const groups = carrierId ? groupManifestByDrop(shipments, carrierId) : [];

  return (
    <Screen scroll>
      <Header title="Orodha / Manifest" />
      <Muted style={styles.lead}>Mizigo ya leo imepangwa kwa marudio. Gusa hatua inayofuata.</Muted>
      {groups.length === 0 ? (
        <Card>
          <Muted>Hakuna mizigo kwenye manifesti leo.</Muted>
        </Card>
      ) : (
        groups.map(([drop, rows]) => (
          <View key={drop} style={styles.group}>
            <Text style={styles.dropTitle}>{drop}</Text>
            {rows.map((item) => {
              const next = manifestNextAction(item);
              return (
                <Card key={item.id}>
                  <Pressable onPress={() => router.push(`/order/${item.id}`)}>
                    <Text style={styles.code}>{shipmentCode(item)}</Text>
                    <Text style={styles.meta}>
                      {item.weightKg || 0} kg · {money(item.cashExpected)} · {STATUS_LABEL[item.shipmentStatus] || '—'}
                    </Text>
                  </Pressable>
                  {next && user?.email ? (
                    <PrimaryButton
                      label={next.label}
                      onPress={() => void applyManifestMark(item.id, carrierId, next.act, user.email!)}
                    />
                  ) : null}
                  <Pressable onPress={() => router.push(`/receipt/${item.id}`)} style={styles.receipt}>
                    <Text style={styles.receiptText}>Risiti</Text>
                  </Pressable>
                </Card>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 16 },
  group: { marginBottom: 8 },
  dropTitle: { fontSize: 16, fontWeight: '800', color: theme.green, marginBottom: 8 },
  code: { fontSize: 16, fontWeight: '700', color: theme.charcoal },
  meta: { fontSize: 13, color: theme.muted, marginVertical: 8 },
  receipt: { marginTop: 10, alignItems: 'center' },
  receiptText: { color: theme.green, fontWeight: '600' },
});
