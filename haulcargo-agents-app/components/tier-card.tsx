import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TierMedal } from '@/components/tier-medal';
import { type CarrierStanding } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Full gamification on Akaunti. Homepage stays the short desk. */
export function TierCard({ standing }: { standing: CarrierStanding }) {
  const next =
    standing.nextLabel && standing.nextMin != null ? `${standing.nextLabel} · ${standing.nextMin}` : 'Uko juu';
  const summary = `${standing.tier.label}. Mfululizo ${standing.streak}. Inayofuata ${next}. Kamisheni ${standing.feePercent}%. Cancel ${standing.cancelPercent}%.`;

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={summary}>
      <View style={styles.head}>
        <TierMedal id={standing.tier.id} width={48} />
        <View style={styles.headCopy}>
          <Text style={styles.kicker}>Kiwango</Text>
          <Text style={styles.name} numberOfLines={1}>
            {standing.tier.label}
          </Text>
        </View>
      </View>
      <Fact label="Mfululizo" value={String(standing.streak)} />
      <Fact label="Inayofuata" value={next} />
      <Fact label="Kamisheni" value={`${standing.feePercent}%`} />
      <Fact label="Cancel" value={`${standing.cancelPercent}%`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    minHeight: 56,
  },
  headCopy: { flex: 1, minWidth: 0 },
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
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: theme.ink,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line,
  },
  factLabel: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 18,
    color: theme.muted,
  },
  factValue: {
    flexShrink: 1,
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: theme.ink,
    textAlign: 'right',
  },
});
