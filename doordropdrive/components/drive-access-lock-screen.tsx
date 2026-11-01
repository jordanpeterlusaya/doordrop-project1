import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { DriveSceneAvatar } from '../lib/drive-avatars';
import { DriveFadeSlideIn } from '../lib/drive-motion';
import { DriveGhostButton, DrivePrimaryButton } from './drive-ui';

export type DriveAccessLockMode = 'due' | 'pending' | 'grace';

export function DriveAccessLockScreen({
  mode,
  periodLabel,
  feeLabel,
  headline,
  shortLabel,
  caption,
  body,
  progressLabel,
  progressPercent,
  completedOrders,
  minOrders,
  bullets,
  primaryLabel,
  secondaryLabel,
  loading,
  disabled,
  onPrimaryPress,
  onSecondaryPress,
}: {
  mode: DriveAccessLockMode;
  periodLabel: string;
  feeLabel: string;
  headline: string;
  shortLabel: string;
  caption: string;
  body: string;
  progressLabel: string;
  progressPercent: number;
  completedOrders: number;
  minOrders: number;
  bullets: string[];
  primaryLabel: string;
  secondaryLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onPrimaryPress: () => void;
  onSecondaryPress?: () => void;
}) {
  const modeStyle =
    mode === 'pending' ? styles.badgePending : mode === 'grace' ? styles.badgeGrace : styles.badgeDue;
  const modeIcon =
    mode === 'pending' ? 'clock-outline' : mode === 'grace' ? 'shield-check-outline' : 'shield-lock-outline';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <DriveFadeSlideIn style={styles.heroCard}>
        <View style={styles.heroTop}>
          <DriveSceneAvatar kind="payment" size={108} />
          <View style={styles.heroCopy}>
            <Text style={styles.kicker}>{periodLabel}</Text>
            <Text style={styles.title}>{headline}</Text>
            <View style={[styles.badge, modeStyle]}>
              <MaterialCommunityIcons name={modeIcon} size={14} color={driveTheme.colors.ink} />
              <Text style={styles.badgeText}>{shortLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text style={styles.amount}>{feeLabel}</Text>
          <Text style={styles.amountHint}>{caption}</Text>
        </View>

        <Text style={styles.body}>{body}</Text>

        <View style={styles.progressBlock}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>{progressLabel}</Text>
            <Text style={styles.progressValue}>
              {completedOrders}/{minOrders}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, progressPercent))}%` }]} />
          </View>
        </View>

        <View style={styles.bulletList}>
          {bullets.map((item) => (
            <View key={item} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <DrivePrimaryButton
            label={primaryLabel}
            icon={mode === 'pending' ? 'refresh' : 'cash-fast'}
            loading={loading}
            disabled={disabled}
            onPress={onPrimaryPress}
            variant="brand"
          />
          {secondaryLabel && onSecondaryPress ? (
            <DriveGhostButton label={secondaryLabel} onPress={onSecondaryPress} disabled={loading} />
          ) : null}
        </View>
      </DriveFadeSlideIn>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  content: {
    paddingHorizontal: driveTheme.spacing.lg,
    paddingTop: driveTheme.spacing.xl,
    paddingBottom: driveTheme.spacing.xxxl,
  },
  heroCard: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xxl,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: driveTheme.spacing.xl,
    gap: driveTheme.spacing.lg,
    ...driveTheme.shadows.card,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: driveTheme.spacing.lg,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: driveTheme.spacing.sm,
  },
  kicker: {
    fontFamily: driveType.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: driveTheme.colors.primaryDark,
  },
  title: {
    fontFamily: driveType.bold,
    fontSize: 22,
    lineHeight: 28,
    color: driveTheme.colors.ink,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
  },
  badgeDue: {
    backgroundColor: driveTheme.colors.warningSoft,
    borderColor: '#FED7AA',
  },
  badgePending: {
    backgroundColor: driveTheme.colors.infoSoft,
    borderColor: '#BFDBFE',
  },
  badgeGrace: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#A7F3D0',
  },
  badgeText: {
    fontFamily: driveType.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: driveTheme.colors.ink,
  },
  amountRow: {
    gap: 4,
  },
  amount: {
    fontFamily: driveType.bold,
    fontSize: 34,
    lineHeight: 40,
    color: driveTheme.colors.ink,
    letterSpacing: -0.5,
  },
  amountHint: {
    fontFamily: driveType.regular,
    fontSize: 14,
    lineHeight: 20,
    color: driveTheme.colors.subtext,
  },
  body: {
    fontFamily: driveType.regular,
    fontSize: 15,
    lineHeight: 22,
    color: driveTheme.colors.text,
  },
  progressBlock: {
    gap: driveTheme.spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: {
    fontFamily: driveType.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: driveTheme.colors.subtext,
  },
  progressValue: {
    fontFamily: driveType.bold,
    fontSize: 13,
    lineHeight: 18,
    color: driveTheme.colors.ink,
  },
  progressTrack: {
    height: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primary,
  },
  bulletList: {
    gap: driveTheme.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: driveTheme.colors.primary,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontFamily: driveType.regular,
    fontSize: 14,
    lineHeight: 20,
    color: driveTheme.colors.subtext,
  },
  actions: {
    gap: driveTheme.spacing.md,
    marginTop: driveTheme.spacing.sm,
  },
});
