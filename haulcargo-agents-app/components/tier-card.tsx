import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TierMedal } from '@/components/tier-medal';
import { tierBenefitLabel, tierProgressLabel, type CarrierStanding } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

export function TierCard({ standing }: { standing: CarrierStanding }) {
  const benefit = tierBenefitLabel(standing.tier);
  const progress = tierProgressLabel(standing);
  const summary = `${standing.tier.label}. ${progress}. ${benefit}. Pointi ${standing.points}. Cancel ${standing.cancelPercent}%.`;
  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={summary}>
      <TierMedal id={standing.tier.id} width={64} />
      <View style={styles.copy}>
        <Text style={styles.kicker}>Kiwango</Text>
        <Text style={styles.name}>{standing.tier.label}</Text>
        <Text style={styles.progress}>{progress}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(standing.ratio * 100)}%` }]} />
        </View>
        <Text style={styles.stats}>
          Pointi {standing.points} · Cancel {standing.cancelPercent}%
        </Text>
        <Text style={styles.benefit}>{benefit}</Text>
        {standing.nextLabel && !standing.held ? (
          <Text style={styles.next}>Inayofuata · {standing.nextLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.tile,
  },
  copy: { flex: 1, minWidth: 0 },
  kicker: {
    fontFamily: typography.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
    color: theme.muted,
  },
  name: {
    marginTop: 2,
    fontFamily: typography.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: theme.ink,
  },
  progress: {
    marginTop: 4,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  track: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E6EAF0',
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    backgroundColor: '#000000',
  },
  stats: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  benefit: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  next: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 16,
    color: theme.muted,
  },
});
