import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TierMedal } from '@/components/tier-medal';
import { tierProgressShort, type CarrierStanding, type CarrierTierId } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

const TRACK_FILL: Record<CarrierTierId, string> = {
  bronze: '#B45309',
  silver: '#475569',
  gold: '#A16207',
  platinum: '#1D4ED8',
};

/**
 * Nyumbani standing, one column under the company name.
 * Medal, tier, progress track, and cancel each keep their own line.
 */
export function HomeStanding({ standing }: { standing: CarrierStanding }) {
  const progress = tierProgressShort(standing);
  const nextName = standing.nextLabel;
  const pct = standing.nextMin == null ? 100 : Math.max(0, Math.min(100, standing.ratio * 100));
  const summary = [standing.tier.label, 'Mfululizo', progress, nextName, `Cancel ${standing.cancelPercent}%`]
    .filter(Boolean)
    .join('. ');

  return (
    <View style={styles.block}>
      <View style={styles.card} accessibilityLabel={summary}>
        <View style={styles.tierRow}>
          <TierMedal id={standing.tier.id} width={48} />
          <Text style={styles.tierWord} numberOfLines={1}>
            {standing.tier.label}
          </Text>
        </View>

        <Text style={styles.meterLabel}>Mfululizo</Text>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: standing.nextMin ?? Math.max(standing.streak, 1),
            now: standing.streak,
          }}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: TRACK_FILL[standing.tier.id] }]} />
        </View>
        <View style={styles.numbers}>
          <Text style={styles.progress} numberOfLines={1}>
            {progress}
          </Text>
          {nextName ? (
            <Text style={styles.next} numberOfLines={1}>
              {nextName}
            </Text>
          ) : null}
        </View>

        <View style={styles.cancelRow} accessibilityRole="text" accessibilityLabel={`Cancel ${standing.cancelPercent}%`}>
          <Ionicons name="close-circle-outline" size={18} color={theme.ink} />
          <Text style={styles.cancelText} numberOfLines={1}>
            Cancel {standing.cancelPercent}%
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 20,
    alignSelf: 'stretch',
  },
  card: {
    alignSelf: 'stretch',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
  },
  tierWord: {
    flex: 1,
    fontFamily: typography.bold,
    fontSize: 22,
    lineHeight: 28,
    color: theme.ink,
  },
  meterLabel: {
    marginTop: 14,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  track: {
    marginTop: 8,
    height: 14,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  numbers: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 28,
  },
  progress: {
    flexShrink: 0,
    fontFamily: typography.bold,
    fontSize: 20,
    lineHeight: 26,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  next: {
    flexShrink: 1,
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 22,
    color: theme.ink,
    textAlign: 'right',
  },
  cancelRow: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
  },
  cancelText: {
    flexShrink: 1,
    fontFamily: typography.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: theme.ink,
  },
});
