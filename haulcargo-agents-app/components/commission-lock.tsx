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
        <Text style={styles.label}>Mteja</Text>
        <Text style={styles.value}>{money(cashExpected)}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.lockLabel}>
          <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={14} color={theme.muted} />
          <Text style={styles.label}>Kamisheni</Text>
        </View>
        <Text style={styles.value}>{money(haulFee)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Salio</Text>
        <Text style={styles.net}>{money(carrierNet)}</Text>
      </View>
      <Text style={styles.status}>{cashStatusLabel(status)}</Text>
      {canRequestPay ? (
        <View style={styles.pay}>
          <PrimaryButton label="Lipa kamisheni" loading={paying} onPress={() => onPayCommission?.()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  lockLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  label: {
    fontSize: 14,
    fontFamily: typography.body,
    color: theme.muted,
  },
  value: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
  net: {
    fontFamily: typography.bold,
    fontSize: 17,
    color: theme.ink,
  },
  status: {
    fontSize: 13,
    fontFamily: typography.body,
    color: theme.muted,
  },
  pay: { marginTop: 4 },
});
