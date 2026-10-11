import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function SafariListScreen() {
  const { trips } = useCarrierSession();
  const rows = useMemo(
    () => [...trips].sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || ''))),
    [trips]
  );

  return (
    <Screen scroll>
      <Header title="Safari" subtitle="Weka mizigo iliyokubaliwa kwenye safari moja." back />
      {rows.length === 0 ? (
        <EmptyState
          title="Hakuna safari"
          body="Unda safari yenye jina, tarehe, na mkoa ulio ndani ya coverage yako.">
          <View style={styles.create}>
            <PrimaryButton label="Unda safari" onPress={() => router.push('/safari/new')} />
          </View>
        </EmptyState>
      ) : (
        <>
          {rows.map((trip) => (
            <Pressable key={trip.id} style={styles.row} onPress={() => router.push(`/safari/${trip.id}`)}>
              <Text style={styles.name}>{trip.name}</Text>
              <Text style={styles.meta}>
                {trip.serviceDate} · {trip.destinationRegion}
                {trip.vehicleNote ? ` · ${trip.vehicleNote}` : ''}
              </Text>
            </Pressable>
          ))}
          <View style={styles.create}>
            <PrimaryButton label="Unda safari" onPress={() => router.push('/safari/new')} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  name: { fontFamily: typography.bold, fontSize: 16, color: theme.ink },
  meta: { marginTop: 4, fontFamily: typography.body, fontSize: 13, color: theme.muted },
  create: { marginTop: 8 },
});
