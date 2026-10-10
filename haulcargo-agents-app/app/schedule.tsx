import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Field, Header, PrimaryButton, Screen, Muted } from '@/components/ui';
import { theme } from '@/constants/theme';
import { darTodayKey } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ScheduleScreen() {
  const { carrier, routes } = useCarrierSession();
  const primary = routes.find((r) => r.active !== false) || routes[0];
  const [origin, setOrigin] = useState(primary?.origin || 'Dar es Salaam');
  const [destination, setDestination] = useState(primary?.destination || '');
  const [departureTime, setDepartureTime] = useState(primary?.departureTime || '08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState(String(primary?.cargoCapacityKg || 500));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' })
    .format(new Date())
    .slice(0, 3)
    .toLowerCase();

  return (
    <Screen scroll>
      <Header title="Safari / Ratiba" back />
      <Muted style={styles.lead}>Weka safari ya leo — inahifadhiwa kwenye carrierRoutes.</Muted>
      <Field label="Kutoka" value={origin} onChangeText={setOrigin} />
      <Field label="Kwenda" value={destination} onChangeText={setDestination} />
      <Field label="Muda wa kuondoka" value={departureTime} onChangeText={setDepartureTime} />
      <Field label="Uwezo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />
      {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      <PrimaryButton
        label="Hifadhi ratiba"
        loading={loading}
        onPress={async () => {
          if (!carrier?.id) return;
          setLoading(true);
          const payload = {
            carrierId: carrier.id,
            origin: origin.trim(),
            destination: destination.trim(),
            departureTime,
            arrivalTime: departureTime,
            cargoCapacityKg: Number(cargoCapacityKg) || 0,
            operatingDays: [dayName],
            pickupKariakoo: true,
            active: true,
            serviceDate: darTodayKey(),
            updatedAt: serverTimestamp(),
          };
          try {
            if (primary?.id) {
              await updateDoc(doc(db, 'carrierRoutes', primary.id), payload);
            } else {
              await addDoc(collection(db, 'carrierRoutes'), { ...payload, createdAt: serverTimestamp() });
            }
            setMsg('Ratiba imehifadhiwa.');
            router.back();
          } finally {
            setLoading(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 16 },
  ok: { color: theme.success, marginBottom: 12 },
});
