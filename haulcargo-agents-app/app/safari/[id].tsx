import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Header, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { attachShipmentToTrip, detachShipmentFromTrip } from '@/lib/carrier-actions';
import { shipmentCode } from '@/lib/carrier-helpers';
import { sameRegion } from '@/lib/regions';
import { useCarrierSession } from '@/providers/carrier-session';

const ATTACHABLE = new Set(['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived']);

export default function SafariDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { trips, shipments, carrier } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const trip = trips.find((item) => item.id === id);
  const [error, setError] = useState('');

  const attached = useMemo(
    () => shipments.filter((item) => item.carrierId === carrierId && item.tripId === id),
    [shipments, carrierId, id]
  );
  const available = useMemo(
    () =>
      shipments.filter((item) => {
        if (item.carrierId !== carrierId || item.tripId) return false;
        if (!ATTACHABLE.has(item.shipmentStatus)) return false;
        return sameRegion(item.destination || '', trip?.destinationRegion || '');
      }),
    [shipments, carrierId, trip?.destinationRegion]
  );

  if (!trip) {
    return (
      <Screen>
        <Header title="Safari" subtitle="Haipatikani." back />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={trip.name} subtitle={`${trip.serviceDate} · ${trip.destinationRegion}`} back />
      {trip.vehicleNote ? <Text style={styles.note}>{trip.vehicleNote}</Text> : null}
      {trip.arrivalTime ? <Text style={styles.note}>Kufika {trip.arrivalTime}</Text> : null}

      <Text style={styles.section}>Kwenye safari</Text>
      {attached.length === 0 ? <Text style={styles.empty}>Bado hakuna mzigo.</Text> : null}
      {attached.map((item) => {
        const locked = ['in_transit', 'arrived', 'delivered'].includes(item.shipmentStatus);
        return (
          <Pressable key={item.id} style={styles.row} onPress={() => router.push(`/order/${item.id}`)}>
            <View style={styles.copy}>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.meta}>{item.destination || '—'}</Text>
            </View>
            {locked ? null : (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  Alert.alert('Ondoa kwenye safari', shipmentCode(item), [
                    { text: 'Ghairi', style: 'cancel' },
                    {
                      text: 'Ondoa',
                      style: 'destructive',
                      onPress: () => {
                        setError('');
                        void detachShipmentFromTrip(item.id, carrierId).catch((err) =>
                          setError(err instanceof Error ? err.message : 'Imeshindwa.')
                        );
                      },
                    },
                  ]);
                }}>
                <Text style={styles.remove}>Ondoa</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}

      <Text style={styles.section}>Zilizokubaliwa kwenda hapa</Text>
      {available.length === 0 ? (
        <EmptyState title="Hakuna mzigo wa kuongeza" body="Kubali oda ambayo marudio yake ni mkoa wa safari hii." />
      ) : (
        available.map((item) => (
          <Pressable
            key={item.id}
            style={styles.row}
            onPress={() => {
              setError('');
              void attachShipmentToTrip(item.id, carrierId, { id: trip.id, name: trip.name }).catch((err) =>
                setError(err instanceof Error ? err.message : 'Imeshindwa.')
              );
            }}>
            <View style={styles.copy}>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.meta}>{item.destination || '—'} · {item.weightKg || 0} kg</Text>
            </View>
            <Text style={styles.add}>Weka</Text>
          </Pressable>
        ))
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: typography.body, fontSize: 14, color: theme.muted, marginBottom: 6 },
  section: {
    marginTop: 16,
    marginBottom: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.muted,
  },
  empty: { fontFamily: typography.body, fontSize: 14, color: theme.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  copy: { flex: 1 },
  code: { fontFamily: typography.bold, fontSize: 15, color: theme.ink },
  meta: { marginTop: 2, fontFamily: typography.body, fontSize: 13, color: theme.muted },
  add: { fontFamily: typography.semibold, fontSize: 14, color: theme.ink },
  remove: { fontFamily: typography.semibold, fontSize: 14, color: theme.danger },
  error: { marginTop: 12, color: theme.danger, fontFamily: typography.semibold },
});
