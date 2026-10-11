import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field, Header, Muted, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { darTodayKey } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import { sameRegion, tripRegionChoices } from '@/lib/regions';
import { useCarrierSession } from '@/providers/carrier-session';

export default function NewSafariScreen() {
  const { destination } = useLocalSearchParams<{ destination?: string }>();
  const { carrier, user } = useCarrierSession();
  const choices = useMemo(() => tripRegionChoices(carrier), [carrier]);
  const hinted = useMemo(
    () => choices.find((region) => sameRegion(String(destination || ''), region)) || '',
    [choices, destination]
  );
  const [name, setName] = useState('');
  const [serviceDate, setServiceDate] = useState(darTodayKey());
  const [region, setRegion] = useState(hinted);
  const [vehicleNote, setVehicleNote] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  return (
    <Screen scroll>
      <Header title="Safari mpya" subtitle="Mkoa wa kwenda lazima uwe ndani ya coverage yako." back />
      <Field label="Jina" value={name} onChangeText={setName} placeholder="Dar — Mwanza asubuhi" />
      <Field label="Tarehe" value={serviceDate} onChangeText={setServiceDate} placeholder="2026-10-11" autoCapitalize="none" />
      <Field
        label="Maelezo ya gari (si lazima)"
        value={vehicleNote}
        onChangeText={setVehicleNote}
        placeholder="Toyo T123 ABC"
      />
      <Field
        label="Muda wa kufika (si lazima)"
        value={arrivalTime}
        onChangeText={setArrivalTime}
        placeholder="18:30"
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.label}>Mkoa wa kwenda</Text>
      {choices.length === 0 ? (
        <Muted>Weka coverage kwenye Akaunti kwanza.</Muted>
      ) : (
        <View style={styles.chips}>
          {choices.map((choice) => {
            const on = region === choice;
            return (
              <Pressable key={choice} onPress={() => setRegion(choice)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{choice}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi safari"
        loading={loading}
        onPress={() => {
          if (!carrier?.id) return;
          const trimmedName = name.trim();
          const trimmedRegion = region.trim();
          const clock = arrivalTime.trim();
          if (!trimmedName) {
            setError('Weka jina la safari.');
            return;
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate.trim())) {
            setError('Tarehe iwe YYYY-MM-DD.');
            return;
          }
          if (!trimmedRegion || !choices.includes(trimmedRegion)) {
            setError('Chagua mkoa ulio ndani ya coverage.');
            return;
          }
          if (clock && !/^\d{2}:\d{2}$/.test(clock)) {
            setError('Muda wa kufika uwe HH:mm, au uache wazi.');
            return;
          }
          setLoading(true);
          setError('');
          void addDoc(collection(db, 'carrierTrips'), {
            carrierId: carrier.id,
            name: trimmedName,
            serviceDate: serviceDate.trim(),
            destinationRegion: trimmedRegion,
            vehicleNote: vehicleNote.trim(),
            ...(clock ? { arrivalTime: clock } : {}),
            createdBy: user?.email || '',
            createdAt: serverTimestamp(),
          })
            .then(() => router.back())
            .catch((err) => setError(err instanceof Error ? err.message : 'Imeshindwa kuhifadhi.'))
            .finally(() => setLoading(false));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.tile },
  chipOn: { backgroundColor: theme.ink },
  chipText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  chipTextOn: { color: theme.white },
  error: { color: theme.danger, fontFamily: typography.semibold, marginBottom: 10 },
});
