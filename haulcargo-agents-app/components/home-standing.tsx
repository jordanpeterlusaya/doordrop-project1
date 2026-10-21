import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TierMedal } from '@/components/tier-medal';
import { tierProgressShort, type CarrierStanding } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

/**
 * Nyumbani standing, one column under the company name.
 * Tier and cancel are separate rows. The notice is full width, only when set.
 */
export function HomeStanding({ standing, warning }: { standing: CarrierStanding; warning: string }) {
  const progress = tierProgressShort(standing);
  const closure = warning.startsWith('Akaunti');
  const tierLabel = `${standing.tier.label}. ${progress}`;

  return (
    <View style={styles.block}>
      <View style={styles.tierRow} accessibilityRole="text" accessibilityLabel={tierLabel}>
        <TierMedal id={standing.tier.id} width={34} />
        <Text style={styles.tierWord} numberOfLines={1}>
          {standing.tier.label}
        </Text>
        <Text style={styles.progress} numberOfLines={1}>
          {progress}
        </Text>
      </View>

      <View style={styles.cancelRow} accessibilityRole="text" accessibilityLabel={`Cancel ${standing.cancelPercent}%`}>
        <Ionicons name="close-circle-outline" size={16} color={theme.muted} />
        <Text style={styles.cancelText} numberOfLines={1}>
          Cancel {standing.cancelPercent}%
        </Text>
      </View>

      {warning ? (
        <View style={styles.notice} accessibilityRole="text" accessibilityLabel={warning}>
          <Text style={[styles.noticeText, closure && styles.noticeHard]}>{warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 22,
    alignSelf: 'stretch',
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  tierWord: {
    flexShrink: 1,
    fontFamily: typography.bold,
    fontSize: 17,
    lineHeight: 22,
    color: theme.ink,
  },
  progress: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  cancelRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  cancelText: {
    flexShrink: 1,
    fontFamily: typography.medium,
    fontSize: 14,
    lineHeight: 18,
    color: theme.muted,
  },
  notice: {
    marginTop: 16,
    alignSelf: 'stretch',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  noticeText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  noticeHard: {
    color: theme.danger,
  },
});
