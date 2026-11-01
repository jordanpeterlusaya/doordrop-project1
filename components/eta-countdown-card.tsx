import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { buildEtaCountdownParts } from '@/lib/outside-parcel-eta';

type Props = {
  deadlineMs: number | null;
  startedAtMs?: number | null;
  label?: string;
};

/** Compact live ETA countdown — ticks from full duration down to 0. */
export function EtaCountdownChip({ deadlineMs, startedAtMs, label }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineMs) {
      return;
    }

    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [deadlineMs]);

  const parts = useMemo(() => {
    if (!deadlineMs) {
      return null;
    }

    return buildEtaCountdownParts(deadlineMs, nowMs, startedAtMs);
  }, [deadlineMs, nowMs, startedAtMs]);

  if (!deadlineMs || !parts) {
    return null;
  }

  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons
        name={parts.isOverdue ? 'clock-alert-outline' : 'timer-sand'}
        size={14}
        color={parts.isOverdue ? '#B45309' : cargoTheme.colors.primaryDark}
      />
      <Text style={[styles.time, parts.isOverdue && styles.timeOverdue]}>{parts.display}</Text>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  time: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#0F172A',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  timeOverdue: {
    color: '#B45309',
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.semibold,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
