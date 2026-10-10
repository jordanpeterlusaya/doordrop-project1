import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommissionLock } from '@/components/commission-lock';
import { Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { cashStatusLabel, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

function shortCash(status?: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'reconciled') return 'Sawa';
  if (s === 'pending_reconciliation') return 'Inasubiri';
  if (s === 'collected') return 'Imekusanywa';
  if (s === 'unpaid') return 'Bado';
  return cashStatusLabel(status);
}

export default function FedhaScreen() {
  const { carrier, shipments } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const rows = useMemo(
    () => shipments.filter((s) => s.carrierId === carrierId && s.shipmentStatus !== 'matching'),
    [shipments, carrierId]
  );

  const totals = useMemo(() => {
    let expected = 0;
    let haulFee = 0;
    let net = 0;
    let unpaid = 0;
    for (const r of rows) {
      expected += Number(r.cashExpected) || 0;
      haulFee += Number(r.haulFee) || 0;
      net += Number(r.carrierNet) || 0;
      if (r.cashStatus !== 'reconciled') unpaid += 1;
    }
    return { expected, haulFee, net, unpaid };
  }, [rows]);

  return (
    <Screen scroll edges="top">
      <Header title="Fedha" />

      <View style={styles.summary}>
        <CommissionLock
          cashExpected={totals.expected}
          haulFee={totals.haulFee}
          carrierNet={totals.net}
          cashStatus={totals.unpaid ? 'unpaid' : 'reconciled'}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {totals.unpaid > 0 ? `${totals.unpaid} bado` : rows.length ? 'Sawa' : '—'}
        </Text>
        <Pressable onPress={() => router.push('/history')} hitSlop={8}>
          <Text style={styles.link}>Historia</Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>Hakuna oda</Text>
      ) : (
        <View style={styles.list}>
          {rows.map((item, index) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/order/${item.id}`)}
              style={[styles.row, index < rows.length - 1 && styles.rowBorder]}>
              <View style={styles.rowMain}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.status}>{shortCash(item.cashStatus)}</Text>
              </View>
              <Text style={styles.amt}>{money(item.carrierNet)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    paddingBottom: 18,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 12,
  },
  metaText: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  link: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  list: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 16,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  rowMain: { flex: 1, gap: 2 },
  code: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  status: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  amt: {
    fontFamily: typography.semibold,
    fontSize: 14,
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
