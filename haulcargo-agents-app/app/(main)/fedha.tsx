import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { CommissionLock } from '@/components/commission-lock';
import { Card, Header, Muted, Screen, SectionTitle } from '@/components/ui';
import { theme } from '@/constants/theme';
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
      <Card>
        <CommissionLock cashExpected={totals.expected} haulFee={totals.haulFee} carrierNet={totals.net} cashStatus={totals.unpaid ? 'unpaid' : 'reconciled'} />
      </Card>
      <Muted style={styles.hint}>{totals.unpaid} mizigo bado haijalinganishwa na HAUL.</Muted>
      <Pressable onPress={() => router.push('/history')}>
        <Text style={styles.history}>Historia ya mizigo iliyowasili →</Text>
      </Pressable>

      <SectionTitle>Kila oda</SectionTitle>
      {rows.map((item) => (
        <Pressable key={item.id} onPress={() => router.push(`/order/${item.id}`)}>
          <Card>
            <Text style={styles.code}>{shipmentCode(item)}</Text>
            <Text style={styles.line}>Mteja: {money(item.cashExpected)}</Text>
            <Text style={styles.line}>Kamisheni: {money(item.haulFee)}</Text>
            <Text style={styles.net}>Salio: {money(item.carrierNet)}</Text>
            <Text style={styles.status}>{cashStatusLabel(item.cashStatus)}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginVertical: 12 },
  history: { color: theme.ink, fontWeight: '700', marginBottom: 16 },
  code: { fontWeight: '800', fontSize: 15, color: theme.charcoal },
  line: { color: theme.muted, marginTop: 4, fontSize: 13 },
  net: { color: theme.ink, fontWeight: '700', marginTop: 6 },
  status: { marginTop: 4, fontSize: 12, color: theme.muted },
});
