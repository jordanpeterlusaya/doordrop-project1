import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '@/constants/theme';
import { money } from '@/lib/carrier-helpers';

export function CommissionLock({
  cashExpected,
  haulFee,
  carrierNet,
  cashStatus,
}: {
  cashExpected?: number;
  haulFee?: number;
  carrierNet?: number;
  cashStatus?: string;
}) {
  const locked = cashStatus !== 'reconciled';
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>Jumla ya mteja</Text>
        <Text style={styles.value}>{money(cashExpected)}</Text>
      </View>
      <View style={[styles.row, styles.commissionRow]}>
        <View style={styles.lockLabel}>
          <Ionicons name={locked ? 'lock-closed' : 'lock-open'} size={16} color={theme.green} />
          <Text style={styles.commissionText}>Kamisheni ya HAUL (20%)</Text>
        </View>
        <Text style={styles.commissionValue}>{money(haulFee)}</Text>
      </View>
      <Text style={styles.hint}>
        {locked
          ? 'Kamisheni imefungwa hadi malipo yalinganishwe na HAUL.'
          : 'Kamisheni imelinganishwa — salio lako limepatikana.'}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Salio lako (carrier net)</Text>
        <Text style={[styles.value, styles.net]}>{money(carrierNet)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, color: theme.muted },
  value: { fontSize: 15, fontWeight: '600', color: theme.charcoal },
  net: { color: theme.green, fontWeight: '800' },
  commissionRow: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  lockLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  commissionText: { fontSize: 14, fontWeight: '700', color: theme.green },
  commissionValue: { fontSize: 16, fontWeight: '800', color: theme.green },
  hint: { fontSize: 12, color: theme.muted, lineHeight: 18 },
});
