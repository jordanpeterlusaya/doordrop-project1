import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommissionLock } from '@/components/commission-lock';
import { Header, Muted, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { cashStatusLabel, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

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
    <Screen scroll>
      <Header title="Fedha" />
      <Muted style={styles.lead}>Muhtasari wa fedha, salio, na kamisheni ya HAUL.</Muted>

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
          {totals.unpaid > 0
            ? `${totals.unpaid} bado hazijalinganishwa`
            : rows.length
              ? 'Zote zimefananishwa'
              : 'Hakuna oda bado'}
        </Text>
        <Pressable onPress={() => router.push('/history')} hitSlop={8}>
          <Text style={styles.link}>Historia</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Oda</Text>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Muted>Hakuna rekodi za fedha.</Muted>
        </View>
      ) : (
        rows.map((item) => {
          const reconciled = item.cashStatus === 'reconciled';
          return (
            <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)} style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <View style={[styles.badge, reconciled ? styles.badgeOk : styles.badgeWait]}>
                  <Text style={[styles.badgeText, reconciled ? styles.badgeTextOk : styles.badgeTextWait]}>
                    {cashStatusLabel(item.cashStatus)}
                  </Text>
                </View>
              </View>
              <View style={styles.amounts}>
                <Text style={styles.amtMuted}>Mteja {money(item.cashExpected)}</Text>
                <Text style={styles.amtMuted}>Kamisheni {money(item.haulFee)}</Text>
                <Text style={styles.amtNet}>Salio {money(item.carrierNet)}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 14 },
  summary: {
    backgroundColor: theme.white,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
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
  section: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: theme.ink,
    letterSpacing: -0.2,
    marginBottom: 10,
  },
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  row: {
    backgroundColor: theme.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  code: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeOk: { backgroundColor: '#ECFDF5' },
  badgeWait: { backgroundColor: theme.primarySoft },
  badgeText: { fontFamily: typography.semibold, fontSize: 11 },
  badgeTextOk: { color: '#047857' },
  badgeTextWait: { color: theme.ink },
  amounts: { gap: 2 },
  amtMuted: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  amtNet: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
    marginTop: 2,
  },
});
