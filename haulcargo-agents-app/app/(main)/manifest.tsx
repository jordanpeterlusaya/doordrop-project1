import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Header, Screen } from '@/components/ui';
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

  return (
    <Screen scroll edges="top">
      <Header title="Orodha" />

      {groups.length === 0 ? (
        <Text style={styles.empty}>Hakuna mizigo</Text>
      ) : (
        groups.map(([drop, rows]) => (
          <View key={drop} style={styles.group}>
            <View style={styles.dropHeader}>
              <Text style={styles.dropTitle} numberOfLines={2}>
                {drop}
              </Text>
              <Text style={styles.dropCount}>{rows.length}</Text>
            </View>
            {rows.map((item, index) => {
              const next = manifestNextAction(item);
              return (
                <View
                  key={item.id}
                  style={[styles.row, index < rows.length - 1 && styles.rowBorder]}>
                  <Pressable
                    onPress={() => router.push(`/order/${item.id}`)}
                    style={styles.rowPress}>
                    <View style={styles.rowTop}>
                      <Text style={styles.code}>{shipmentCode(item)}</Text>
                      <Text style={styles.meta}>
                        {item.weightKg || 0} kg · {money(item.cashExpected)}
                      </Text>
                    </View>
                    <Text style={styles.status}>{STATUS_LABEL[item.shipmentStatus] || '—'}</Text>
                  </Pressable>
                  <View style={styles.actions}>
                    {next && user?.email ? (
                      <Pressable
                        onPress={() => void applyManifestMark(item.id, carrierId, next.act, user.email!)}
                        hitSlop={6}
                        style={styles.actionBtn}>
                        <Text style={styles.actionText}>{next.label}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => router.push(`/receipt/${item.id}`)} hitSlop={6}>
                      <Text style={styles.link}>Risiti</Text>
                    </Pressable>
                  </View>
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
  group: { marginBottom: 28 },
  dropHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  dropTitle: {
    fontFamily: typography.bold,
    fontSize: 13,
    color: theme.muted,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    flex: 1,
  },
  dropCount: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  row: {
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  rowPress: { gap: 4 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  code: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  meta: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  status: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 10,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.ink,
  },
  actionText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.white,
  },
  link: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    fontFamily: typography.body,
    fontSize: 14,
    color: theme.muted,
  },
});
