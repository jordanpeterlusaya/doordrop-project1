import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, FilterChip, Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { fireTimeMs, formatWhen, isShipmentLate, money, shipmentCode } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

type Chip = 'done' | 'rejected' | 'late';

export default function HistoryScreen() {
  const { carrier, shipments, decisions, trips } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const lateEnabled = trips.some((trip) => String(trip.arrivalTime || '').trim());
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
  const late = useMemo(
    () =>
      shipments
        .filter((item) => item.carrierId === carrierId && isShipmentLate(item, trips))
        .sort((a, b) => fireTimeMs(b.arrivedAt) - fireTimeMs(a.arrivedAt)),
    [shipments, carrierId, trips]
  );

  const active = lateEnabled || chip !== 'late' ? chip : 'done';

  return (
    <Screen scroll>
      <Header title="Historia" subtitle="Hesabu ndogo za kazi iliyopita." back />
      <View style={styles.chips}>
        <FilterChip label={`Zimekamilika ${done.length}`} selected={active === 'done'} onPress={() => setChip('done')} />
        <FilterChip
          label={`Zimekataliwa ${rejected.length}`}
          selected={active === 'rejected'}
          onPress={() => setChip('rejected')}
        />
        {lateEnabled ? (
          <FilterChip label={`Zimechelewa ${late.length}`} selected={active === 'late'} onPress={() => setChip('late')} />
        ) : null}
      </View>

      {active === 'done' ? (
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

      {active === 'rejected' ? (
        rejected.length === 0 ? (
          <EmptyState title="Hakuna iliyokataliwa" body="Ukatayo mpya utaandikwa hapa. Hakuna rekodi za zamani zilizobuniwa." />
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

      {active === 'late' ? (
        late.length === 0 ? (
          <EmptyState title="Hakuna iliyochelewa" body="Inalinganisha muda wa kufika uliowekwa na kampuni." />
        ) : (
          late.map((item) => (
            <Pressable key={item.id} style={styles.row} onPress={() => router.push(`/order/${item.id}`)}>
              <View style={styles.copy}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.meta}>Imefika {formatWhen(item.arrivedAt)}</Text>
              </View>
            </Pressable>
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
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  copy: { flex: 1, minWidth: 0 },
  code: { fontFamily: typography.bold, fontSize: 16, color: theme.ink },
  meta: { marginTop: 4, fontFamily: typography.body, fontSize: 13, color: theme.muted },
  price: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink },
});
