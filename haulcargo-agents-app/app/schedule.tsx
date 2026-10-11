import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field, Header, PrimaryButton, Screen, Muted } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
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
  const [cargoCapacityKg, setCargoCapacityKg] = useState(String(primary?.cargoCapacityKg || carrier?.cargoCapacityKg || 500));
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
      <Header
        title="Uwezo"
        subtitle="Kilo na siku za kufanya kazi. Oda zinategemea mkoa wa kampuni na coverage."
        back
      />
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
        label="Hifadhi"
        loading={loading}
        onPress={async () => {
          if (!carrier?.id) return;
          setLoading(true);
          const days = operatingDays.length ? operatingDays : [...ALL_OPERATING_DAYS];
          const capacity = Number(cargoCapacityKg) || 0;
          try {
            if (primary?.id) {
              await updateDoc(doc(db, 'carrierRoutes', primary.id), {
                cargoCapacityKg: capacity,
                operatingDays: days,
                updatedAt: serverTimestamp(),
              });
            }
            await updateDoc(doc(db, 'carriers', carrier.id), {
              cargoCapacityKg: capacity,
              operatingDays: days,
            });
            setMsg('Imehifadhiwa.');
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
  dayTextOn: { color: theme.accent },
  daysHint: { marginBottom: 16 },
  ok: { color: theme.success, marginBottom: 12, fontFamily: typography.semibold },
});
