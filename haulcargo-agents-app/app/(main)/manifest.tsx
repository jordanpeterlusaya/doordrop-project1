import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { applyManifestMark } from '@/lib/carrier-actions';
import { STATUS_LABEL } from '@/lib/carrier-types';
import { groupManifestByDrop, manifestNextAction, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ManifestScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const groups = carrierId ? groupManifestByDrop(shipments, carrierId) : [];
  const total = groups.reduce((n, [, rows]) => n + rows.length, 0);

  return (
    <Screen scroll edges="top">
      <Header
        title="Orodha"
        subtitle={total > 0 ? `${total} mizigo · kwa marudio` : 'Mizigo ya leo inaonekana hapa.'}
      />

      {groups.length === 0 ? (
        <EmptyState title="Hakuna mizigo" body="Oda zinazokubaliwa zitaonekana kwenye orodha." />
      ) : (
        groups.map(([drop, rows]) => (
          <View key={drop} style={styles.group}>
            <View style={styles.dropHeader}>
              <Text style={styles.dropTitle} numberOfLines={2}>
                {drop}
              </Text>
              <Text style={styles.dropCount}>{rows.length}</Text>
            </View>
            {rows.map((item) => {
              const next = manifestNextAction(item);
              return (
                <View key={item.id} style={styles.card}>
                  <Pressable onPress={() => router.push(`/order/${item.id}`)}>
                    <Text style={styles.code}>{shipmentCode(item)}</Text>
                    <Text style={styles.meta}>
                      {item.weightKg || 0} kg · {money(item.cashExpected)}
                    </Text>
                    <Text style={styles.status}>{STATUS_LABEL[item.shipmentStatus] || '—'}</Text>
                  </Pressable>
                  {next && user?.email ? (
                    <View style={styles.action}>
                      <PrimaryButton
                        label={next.label}
                        onPress={() => void applyManifestMark(item.id, carrierId, next.act, user.email!)}
                      />
                    </View>
                  ) : null}
                  <Pressable onPress={() => router.push(`/receipt/${item.id}`)} style={styles.receipt}>
                    <Text style={styles.receiptText}>Risiti</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 20 },
  dropHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  dropTitle: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: theme.ink,
    letterSpacing: -0.2,
    flex: 1,
  },
  dropCount: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.ink,
    backgroundColor: theme.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  code: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  meta: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
    marginTop: 4,
  },
  status: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginTop: 6,
  },
  action: { marginTop: 12 },
  receipt: { marginTop: 10, alignItems: 'center', paddingVertical: 4 },
  receiptText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
});
