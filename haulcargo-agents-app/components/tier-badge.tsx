import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CarrierTier } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

export function TierBadge({ tier }: { tier: CarrierTier }) {
  const platinum = tier.id === 'platinum';
  const gold = tier.id === 'gold';
  return (
    <View
      style={[styles.badge, gold && styles.gold, platinum && styles.platinum]}
      accessibilityRole="text"
      accessibilityLabel={tier.label}>
      <Text style={[styles.label, platinum && styles.platinumLabel]}>{tier.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  gold: {
    borderColor: theme.brandYellow,
    borderWidth: 1,
  },
  platinum: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  label: {
    fontFamily: typography.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: theme.ink,
  },
  platinumLabel: {
    color: theme.white,
  },
});
