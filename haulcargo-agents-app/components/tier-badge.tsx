import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TierMedal } from '@/components/tier-medal';
import { tierProgressLabel, tierWarning, type CarrierStanding } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

/** Compact tier on Nyumbani. The full benefit card lives on Akaunti. */
export function TierBadge({ standing }: { standing: CarrierStanding }) {
  const progress = standing.nextMin == null ? 'Uko juu' : `${standing.streak}/${standing.nextMin}`;
  const warning = tierWarning(standing);
  const label = `${standing.tier.label}. ${tierProgressLabel(standing)}. Cancel ${standing.cancelPercent}%. ${warning}`.trim();
  return (
    <View style={styles.chip} accessibilityRole="text" accessibilityLabel={label}>
      <TierMedal id={standing.tier.id} width={30} />
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>
          {standing.tier.label}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(standing.ratio * 100)}%` }]} />
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {progress}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 148,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  copy: { width: 78 },
  name: {
    fontFamily: typography.semibold,
    fontSize: 12,
    lineHeight: 15,
    color: theme.ink,
  },
  track: {
    marginTop: 4,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#E6EAF0',
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    backgroundColor: '#000000',
  },
  meta: {
    marginTop: 3,
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: 13,
    color: theme.muted,
  },
});
