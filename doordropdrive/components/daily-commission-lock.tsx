import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';

type Props = {
  unpaidLabel: string;
  pending: boolean;
  busy?: boolean;
  onPay: () => void;
};

/** Full-screen lock when unpaid commission hits the ceiling. */
export function DailyCommissionLock({ unpaidLabel, pending, busy, onPay }: Props) {
  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>HAUL Pilots</Text>
      <Text style={styles.title}>Lipa komisheni</Text>
      <Text style={styles.amount}>{unpaidLabel}</Text>
      <Text style={styles.hint}>{pending ? 'Subiri uthibitisho kwenye simu.' : 'Oda mpya zitasimama hadi ulipe.'}</Text>

      <Pressable
        disabled={busy}
        onPress={onPay}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, busy && styles.ctaBusy]}>
        {busy ? (
          <ActivityIndicator color={driveTheme.colors.ctaText} />
        ) : (
          <Text style={styles.ctaText}>{pending ? 'Angalia hali' : 'Lipa'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 32,
    justifyContent: 'center',
    gap: 12,
  },
  brand: {
    fontFamily: driveType.bold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: driveTheme.colors.primary,
  },
  title: {
    fontFamily: driveType.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: driveTheme.colors.ink,
  },
  amount: {
    marginTop: 8,
    fontFamily: driveType.bold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1,
    color: driveTheme.colors.primary,
  },
  hint: {
    marginTop: 4,
    fontFamily: driveType.regular,
    fontSize: 15,
    lineHeight: 22,
    color: driveTheme.colors.subtext,
  },
  cta: {
    marginTop: 28,
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: driveTheme.colors.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.88 },
  ctaBusy: { opacity: 0.7 },
  ctaText: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ctaText,
    fontSize: 17,
  },
});
