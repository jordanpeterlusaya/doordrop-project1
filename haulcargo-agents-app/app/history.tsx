import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, FilterChip, Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { fireTimeMs, formatWhen, isCompletedShipment, isShipmentLate, money, shipmentCode } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

type Chip = 'done' | 'rejected' | 'late';

function routeLine(item: CarrierShipment) {
  const from = String(item.pickupLabel || item.origin || '').trim();
  const to = String(item.destination || '').trim();
  if (from && to) return `${from} → ${to}`;
  return to || from || '—';
}

function completedMs(item: CarrierShipment) {
  return fireTimeMs(item.arrivedAt) || fireTimeMs(item.deliveredAt);
}

export default function HistoryScreen() {
  const { carrier, shipments, decisions, trips } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [chip, setChip] = useState<Chip>('done');

  const done = useMemo(
    () =>
      shipments
        .filter((item) => item.carrierId === carrierId && isCompletedShipment(item))
        .sort((a, b) => completedMs(b) - completedMs(a)),
    [shipments, carrierId]
  );
  const rejected = useMemo(
    () =>
      decisions
        .filter((item) => item.decision === 'rejected')
        .sort((a, b) => String(b.atIso || '').localeCompare(String(a.atIso || ''))),
    [decisions]
  );
  const late = useMemo(() => done.filter((item) => isShipmentLate(item, trips)), [done, trips]);
  const activeChip: Chip = chip === 'late' && late.length === 0 ? 'done' : chip;

  return (
    <Screen scroll>
      <Header title="Historia" back />
      <View style={styles.chips}>
        <FilterChip label={`Zimekamilika ${done.length}`} selected={activeChip === 'done'} onPress={() => setChip('done')} />
        <FilterChip
          label={`Zimekataliwa ${rejected.length}`}
          selected={activeChip === 'rejected'}
          onPress={() => setChip('rejected')}
        />
        {late.length > 0 ? (
          <FilterChip label={`Zimechelewa ${late.length}`} selected={activeChip === 'late'} onPress={() => setChip('late')} />
        ) : null}
      </View>

      {activeChip === 'done' ? (
        done.length === 0 ? (
          <EmptyState title="Hakuna iliyokamilika" body="Mizigo iliyofika itaonekana hapa." />
        ) : (
          done.map((item) => (
            <Pressable key={item.id} style={styles.row} onPress={() => router.push(`/order/${item.id}`)}>
              <View style={styles.copy}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {routeLine(item)}
                </Text>
                <Text style={styles.meta}>{formatWhen(item.arrivedAt || item.deliveredAt)}</Text>
              </View>
              <Text style={styles.price}>{money(item.carrierNet)}</Text>
            </Pressable>
          ))
        )
      ) : null}

      {activeChip === 'rejected' ? (
        rejected.length === 0 ? (
          <EmptyState title="Hakuna iliyokataliwa" />
        ) : (
          rejected.map((item) => (
            <View key={item.id} style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.code}>{String(item.parcelCode || item.shipmentId || '').toUpperCase()}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.destination || '—'}
                  {item.atIso ? ` · ${formatWhen(item.atIso)}` : ''}
                </Text>
              </View>
            </View>
          ))
        )
      ) : null}

      {activeChip === 'late'
        ? late.map((item) => (
            <Pressable key={item.id} style={styles.row} onPress={() => router.push(`/order/${item.id}`)}>
              <View style={styles.copy}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {routeLine(item)}
                </Text>
                <Text style={styles.meta}>{formatWhen(item.arrivedAt || item.deliveredAt)}</Text>
              </View>
              <Text style={styles.late}>Imechelewa</Text>
            </Pressable>
          ))
        : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.white,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  copy: { flex: 1, minWidth: 0 },
  code: { fontFamily: typography.bold, fontSize: 16, color: theme.ink },
  meta: { marginTop: 2, fontFamily: typography.body, fontSize: 13, color: theme.muted },
  price: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink },
  late: { fontFamily: typography.semibold, fontSize: 12, color: theme.warning },
});
