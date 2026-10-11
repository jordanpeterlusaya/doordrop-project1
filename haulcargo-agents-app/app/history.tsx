import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, FilterChip, Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { fireTimeMs, formatWhen, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

type Chip = 'done' | 'rejected';

export default function HistoryScreen() {
  const { carrier, shipments, decisions } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [chip, setChip] = useState<Chip>('done');

  const done = useMemo(
    () =>
      shipments
        .filter((item) => item.carrierId === carrierId && item.shipmentStatus === 'delivered')
        .sort((a, b) => fireTimeMs(b.deliveredAt) - fireTimeMs(a.deliveredAt)),
    [shipments, carrierId]
  );
  const rejected = useMemo(
    () =>
      decisions
        .filter((item) => item.decision === 'rejected')
        .sort((a, b) => String(b.atIso || '').localeCompare(String(a.atIso || ''))),
    [decisions]
  );
  return (
    <Screen scroll>
      <Header title="Historia" back />
      <View style={styles.chips}>
        <FilterChip label={`Zimekamilika ${done.length}`} selected={chip === 'done'} onPress={() => setChip('done')} />
        <FilterChip
          label={`Zimekataliwa ${rejected.length}`}
          selected={chip === 'rejected'}
          onPress={() => setChip('rejected')}
        />
      </View>

      {chip === 'done' ? (
        done.length === 0 ? (
          <EmptyState title="Hakuna iliyokamilika" body="Mizigo iliyokabidhiwa itaonekana hapa." />
        ) : (
          done.map((item) => (
            <Pressable key={item.id} style={styles.row} onPress={() => router.push(`/order/${item.id}`)}>
              <View style={styles.copy}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.meta}>{formatWhen(item.deliveredAt)}</Text>
              </View>
              <Text style={styles.price}>{money(item.carrierNet)}</Text>
            </Pressable>
          ))
        )
      ) : null}

      {chip === 'rejected' ? (
        rejected.length === 0 ? (
          <EmptyState title="Hakuna iliyokataliwa" />
        ) : (
          rejected.map((item) => (
            <View key={item.id} style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.code}>{String(item.parcelCode || item.shipmentId || '').toUpperCase()}</Text>
                <Text style={styles.meta}>
                  {item.destination || '—'}
                  {item.atIso ? ` · ${formatWhen(item.atIso)}` : ''}
                </Text>
              </View>
            </View>
          ))
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.tile,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  copy: { flex: 1, minWidth: 0 },
  code: { fontFamily: typography.bold, fontSize: 16, color: theme.ink },
  meta: { marginTop: 4, fontFamily: typography.body, fontSize: 13, color: theme.muted },
  price: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink },
});
