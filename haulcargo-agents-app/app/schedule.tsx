import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field, Header, PrimaryButton, Screen, Muted } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { darTodayKey } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import {
  ALL_OPERATING_DAYS,
  DAY_LABEL_SW,
  DAYS,
  type DayKey,
} from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

function normalizeDays(raw?: string[] | null): DayKey[] {
  if (!raw?.length) return [...ALL_OPERATING_DAYS];
  const set = new Set(raw.map((d) => String(d).toLowerCase().slice(0, 3)));
  const picked = DAYS.filter((d) => set.has(d));
  return picked.length ? [...picked] : [...ALL_OPERATING_DAYS];
}

export default function ScheduleScreen() {
  const { carrier, routes } = useCarrierSession();
  const primary = routes.find((r) => r.active !== false) || routes[0];
  const [origin, setOrigin] = useState(primary?.origin || 'Dar es Salaam');
  const [destination, setDestination] = useState(primary?.destination || '');
  const [departureTime, setDepartureTime] = useState(primary?.departureTime || '08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState(String(primary?.cargoCapacityKg || 500));
  const [operatingDays, setOperatingDays] = useState<DayKey[]>(() => normalizeDays(primary?.operatingDays));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const toggleDay = (day: DayKey) => {
    setOperatingDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return DAYS.filter((d) => prev.includes(d) || d === day);
    });
  };

  return (
    <Screen scroll>
      <Header title="Safari / Ratiba" back />
      <Muted style={styles.lead}>Weka njia na siku za kufanya kazi. Chaguo la kawaida: kila siku.</Muted>
      <Field label="Kutoka" value={origin} onChangeText={setOrigin} />
      <Field label="Kwenda" value={destination} onChangeText={setDestination} />
      <Field label="Muda wa kuondoka" value={departureTime} onChangeText={setDepartureTime} />
      <Field label="Uwezo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />

      <Text style={styles.daysLabel}>Siku za kufanya kazi</Text>
      <View style={styles.daysRow}>
        {DAYS.map((day) => {
          const on = operatingDays.includes(day);
          return (
            <Pressable
              key={day}
              onPress={() => toggleDay(day)}
              style={[styles.dayChip, on && styles.dayChipOn]}>
              <Text style={[styles.dayText, on && styles.dayTextOn]}>{DAY_LABEL_SW[day]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Muted style={styles.daysHint}>
        {operatingDays.length === DAYS.length ? 'Kila siku' : `${operatingDays.length} siku zimechaguliwa`}
      </Muted>

      {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      <PrimaryButton
        label="Hifadhi ratiba"
        loading={loading}
        onPress={async () => {
          if (!carrier?.id) return;
          setLoading(true);
          const days = operatingDays.length ? operatingDays : [...ALL_OPERATING_DAYS];
          const payload = {
            carrierId: carrier.id,
            origin: origin.trim(),
            destination: destination.trim(),
            departureTime,
            arrivalTime: departureTime,
            cargoCapacityKg: Number(cargoCapacityKg) || 0,
            operatingDays: days,
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
  daysLabel: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginBottom: 8,
  },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  dayChip: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: theme.tile,
    alignItems: 'center',
  },
  dayChipOn: {
    backgroundColor: theme.ink,
  },
  dayText: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.ink,
  },
  dayTextOn: { color: theme.primary },
  daysHint: { marginBottom: 16 },
  ok: { color: theme.success, marginBottom: 12, fontFamily: typography.semibold },
});
