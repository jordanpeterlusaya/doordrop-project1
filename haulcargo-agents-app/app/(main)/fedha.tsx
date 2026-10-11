import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { requestCommissionPayment } from '@/lib/carrier-actions';
import { isDelivered, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

function cashLine(status?: string) {
  const value = String(status || '').toLowerCase();
  if (value === 'reconciled') return 'Imelinganishwa';
  if (value === 'pending_reconciliation') return 'Inasubiri ulinganifu';
  return 'Inasubiri';
}

export default function FedhaScreen() {
  const { carrier, shipments, user } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [payingId, setPayingId] = useState('');
  const delivered = useMemo(
    () => shipments.filter((item) => item.carrierId === carrierId && isDelivered(item)),
    [shipments, carrierId]
  );

  const totals = useMemo(() => {
    let mapato = 0;
    let kamisheni = 0;
    let inasubiri = 0;
    for (const item of delivered) {
      mapato += Number(item.carrierNet) || 0;
      kamisheni += Number(item.haulFee) || 0;
      if (String(item.cashStatus || '').toLowerCase() !== 'reconciled') inasubiri += 1;
    }
    return { mapato, kamisheni, inasubiri };
  }, [delivered]);

  const askPay = (shipmentId: string, haulFee: number) => {
    Alert.alert('Lipa kamisheni', `Ombi la ${money(haulFee)} litasubiri ulinganifu wa HAUL. Hii si "Umelipwa".`, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Tuma ombi',
        onPress: () => {
          setPayingId(shipmentId);
          void requestCommissionPayment(shipmentId, carrierId, user?.email || '')
            .catch((error) => Alert.alert('Imeshindwa', error instanceof Error ? error.message : 'Jaribu tena'))
            .finally(() => setPayingId(''));
        },
      },
    ]);
  };

  return (
    <Screen scroll edges="top">
      <Header title="Fedha" subtitle="Mizigo iliyokabidhiwa pekee." />
      <View style={styles.stats}>
        <Stat label="Mapato" value={money(totals.mapato)} />
        <Stat label="Kamisheni" value={money(totals.kamisheni)} />
        <Stat label="Inasubiri" value={String(totals.inasubiri)} />
      </View>

      {delivered.length === 0 ? (
        <Text style={styles.empty}>Hakuna mzigo uliokabidhiwa bado.</Text>
      ) : (
        delivered.map((item, index) => {
          const status = String(item.cashStatus || '').toLowerCase();
          const canPay = (status === 'unpaid' || status === 'collected') && Number(item.haulFee) > 0;
          return (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/order/${item.id}`)}
              style={[styles.row, index < delivered.length - 1 && styles.rowBorder]}>
              <View style={styles.rowMain}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.status}>{cashLine(item.cashStatus)}</Text>
              </View>
              <View style={styles.amounts}>
                <Text style={styles.amt}>{money(item.carrierNet)}</Text>
                {canPay ? (
                  <Pressable disabled={payingId === item.id} onPress={() => askPay(item.id, Number(item.haulFee) || 0)}>
                    <Text style={styles.pay}>{payingId === item.id ? 'Inatuma…' : 'Lipa kamisheni'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  stat: {
    flex: 1,
    backgroundColor: theme.tile,
    borderRadius: 14,
    padding: 12,
  },
  statLabel: { fontFamily: typography.body, fontSize: 12, color: theme.muted },
  statValue: { marginTop: 6, fontFamily: typography.bold, fontSize: 14, color: theme.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  rowMain: { flex: 1, gap: 2 },
  code: { fontFamily: typography.bold, fontSize: 15, color: theme.ink },
  status: { fontFamily: typography.body, fontSize: 13, color: theme.muted },
  amounts: { alignItems: 'flex-end', gap: 4 },
  amt: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink },
  pay: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  empty: { marginTop: 28, textAlign: 'center', fontFamily: typography.body, fontSize: 14, color: theme.muted },
});
