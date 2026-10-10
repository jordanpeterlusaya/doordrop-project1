import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { cashStatusLabel, money } from '@/lib/carrier-helpers';

export function CommissionLock({
  cashExpected,
  haulFee,
  carrierNet,
  cashStatus,
  onPayCommission,
  paying,
}: {
  cashExpected?: number;
  haulFee?: number;
  carrierNet?: number;
  cashStatus?: string;
  onPayCommission?: () => void;
  paying?: boolean;
}) {
  const status = String(cashStatus || 'unpaid').toLowerCase();
  const locked = status !== 'reconciled';
  const canRequestPay =
    Boolean(onPayCommission) &&
    (status === 'unpaid' || status === 'collected') &&
    Number(haulFee) > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Jumla ya mteja</Text>
        <Text style={styles.value}>{money(cashExpected)}</Text>
      </View>
      <View style={[styles.row, styles.commissionRow]}>
        <View style={styles.lockLabel}>
          <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={16} color={theme.ink} />
          <Text style={styles.commissionText}>Kamisheni ya HAUL (20%)</Text>
        </View>
        <Text style={styles.commissionValue}>{money(haulFee)}</Text>
      </View>
      <Text style={styles.hint}>
        {status === 'reconciled'
          ? 'Kamisheni imelinganishwa — salio lako limepatikana.'
          : status === 'pending_reconciliation'
            ? 'Ombi la malipo limetumwa. HAUL inalinganisha (pending reconciliation).'
            : 'Kamisheni imefungwa. Lipa kamisheni kamili ili HAUL ilinganishe.'}
      </Text>
      <Text style={styles.statusLine}>Hali: {cashStatusLabel(status)}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Salio lako (carrier net)</Text>
        <Text style={[styles.value, styles.net]}>{money(carrierNet)}</Text>
      </View>
      {canRequestPay ? (
        <PrimaryButton label="Lipa kamisheni" loading={paying} onPress={() => onPayCommission?.()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: {
    fontSize: 14,
    fontFamily: typography.body,
    color: theme.muted,
    flex: 1,
  },
  value: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
  net: {
    fontFamily: typography.bold,
    fontSize: 17,
  },
  commissionRow: {
    backgroundColor: theme.primarySoft,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3E7A3',
  },
  lockLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  commissionText: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: theme.ink,
    flexShrink: 1,
  },
  commissionValue: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: theme.ink,
  },
  hint: {
    fontSize: 12,
    fontFamily: typography.body,
    color: theme.muted,
    lineHeight: 18,
  },
  statusLine: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
});
