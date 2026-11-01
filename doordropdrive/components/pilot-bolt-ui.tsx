import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import {
  PILOT_TIER_RULES,
  pilotBenefitsForTier,
  pilotTierProgressLabel,
  type PilotStanding,
  type PilotTierId,
} from '../constants/pilot-standing';
import { driveHapticLight, driveHapticMedium } from '../lib/drive-haptics';
import { PilotTierMedal } from './pilot-tier-medal';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Glass earnings chip over the live map. */
export function BoltEarningsPill({
  value,
  meta,
  onPress,
}: {
  value: string;
  meta: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.earningsPill, pressed && styles.pressed]}>
      <Text style={styles.earningsValue}>{value}</Text>
      <Text style={styles.earningsMeta}>{meta}</Text>
    </Pressable>
  );
}

export function BoltMapIconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.mapIconBtn, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon} size={22} color={driveTheme.colors.ink} />
    </Pressable>
  );
}

/** HAUL yellow go-online — brand CTA, not Bolt green. */
export function BoltGoOnlineButton({
  online,
  label,
  loading,
  onPress,
}: {
  online: boolean;
  label: string;
  loading?: boolean;
  onPress?: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!online || loading) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [online, loading, pulse]);

  return (
    <Animated.View style={{ transform: [{ scale: online && !loading ? pulse : 1 }] }}>
      <Pressable
        disabled={loading}
        onPress={() => {
          void driveHapticMedium();
          onPress?.();
        }}
        style={({ pressed }) => [
          styles.goOnlineBtn,
          online ? styles.goOnlineBtnOnline : styles.goOnlineBtnOffline,
          loading && styles.disabled,
          pressed && styles.pressed,
        ]}>
        {loading ? (
          <ActivityIndicator color={online ? '#FFFFFF' : driveTheme.colors.ctaText} />
        ) : (
          <>
            <View style={[styles.goOnlineDot, online ? styles.goOnlineDotOn : styles.goOnlineDotOff]} />
            <Text style={[styles.goOnlineText, online && styles.goOnlineTextOnline]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function BoltHomeSheet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.homeSheet}>
      <View style={styles.homeSheetHandle} />
      {children}
    </View>
  );
}

/** Dynamic home dock: live status + standing + score (HAUL, not Bolt promos). */
export function PilotHomeDock({
  online,
  statusTitle,
  statusHint,
  nearbyLabel,
  standing,
  rewardsLabel,
  scoreLabel,
  streakWord,
  commissionLabel,
  onPressRewards,
  onPressScore,
}: {
  online: boolean;
  statusTitle: string;
  statusHint: string;
  nearbyLabel?: string;
  standing: PilotStanding;
  rewardsLabel: string;
  scoreLabel: string;
  streakWord: string;
  commissionLabel: string;
  onPressRewards?: () => void;
  onPressScore?: () => void;
}) {
  const pct = Math.round(standing.ratio * 100);

  return (
    <BoltHomeSheet>
      <View style={styles.statusBlock}>
        <View style={styles.statusTitleRow}>
          <View style={[styles.liveDot, online ? styles.liveDotOn : styles.liveDotOff]} />
          <Text style={styles.statusTitle} numberOfLines={1}>
            {statusTitle}
          </Text>
        </View>
        <Text style={styles.statusHint} numberOfLines={2}>
          {statusHint}
        </Text>
        {nearbyLabel ? (
          <View style={styles.nearbyChip}>
            <MaterialCommunityIcons name="map-marker-radius" size={14} color={driveTheme.colors.primary} />
            <Text style={styles.nearbyChipText}>{nearbyLabel}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={() => {
          void driveHapticLight();
          onPressRewards?.();
        }}
        style={({ pressed }) => [styles.standingHero, pressed && styles.pressed]}>
        <PilotTierMedal id={standing.tier.id} width={56} />
        <View style={styles.standingHeroCopy}>
          <Text style={styles.standingKicker}>{rewardsLabel}</Text>
          <Text style={[styles.standingTier, { color: standing.tier.accent }]}>{standing.tier.label}</Text>
          <Text style={styles.standingMeta}>{commissionLabel}</Text>
          <View style={styles.standingTrack}>
            <View
              style={[
                styles.standingFill,
                { width: `${pct}%`, backgroundColor: standing.tier.accent },
              ]}
            />
          </View>
          <Text style={styles.standingProgress}>
            {streakWord} {pilotTierProgressLabel(standing)}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={driveTheme.colors.muted} />
      </Pressable>

      <View style={styles.scoreRow}>
        <Pressable
          onPress={() => {
            void driveHapticLight();
            onPressScore?.();
          }}
          style={({ pressed }) => [styles.scoreCard, pressed && styles.pressed]}>
          <Text style={styles.scoreLabel}>{scoreLabel}</Text>
          <Text style={styles.scoreValue}>{standing.driverScorePercent}%</Text>
        </Pressable>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>Cancel</Text>
          <Text style={styles.scoreValue}>{standing.cancelPercent}%</Text>
        </View>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>Done</Text>
          <Text style={styles.scoreValue}>{standing.completed}</Text>
        </View>
      </View>
    </BoltHomeSheet>
  );
}

/** @deprecated kept for import compat — use PilotHomeDock */
export function BoltPromoRow(_props: {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
}) {
  return null;
}

/** @deprecated kept for import compat — use PilotHomeDock */
export function BoltStandingCards(_props: {
  standing: PilotStanding;
  rewardsLabel: string;
  scoreLabel: string;
  pointsLabel: string;
  onPressRewards?: () => void;
  onPressScore?: () => void;
}) {
  return null;
}

export function BoltRewardsScreen({
  standing,
  title,
  startingLevelLabel,
  unlockLabel,
  howItWorksLabel,
  benefitsTitle: _benefitsTitle,
  streakWord,
  onBack,
  lang = 'sw',
}: {
  standing: PilotStanding;
  title: string;
  startingLevelLabel: string;
  unlockLabel: string;
  howItWorksLabel: string;
  benefitsTitle: string;
  streakWord: string;
  onBack?: () => void;
  lang?: 'en' | 'sw';
}) {
  const next = standing.next;
  const requiredHint = next
    ? lang === 'sw'
      ? `${standing.remainingToNext} mfululizo zinahitajika`
      : `${standing.remainingToNext} streak required`
    : lang === 'sw'
      ? 'Uko juu kabisa'
      : 'You are at the top';

  return (
    <View style={styles.rewardsRoot}>
      <View style={styles.rewardsHeader}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={driveTheme.colors.ink} />
        </Pressable>
        <Text style={styles.rewardsTitle}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.rewardsContent} showsVerticalScrollIndicator={false}>
        <View style={styles.rewardsHero}>
          <PilotTierMedal id={standing.tier.id} width={96} />
          <Text style={[styles.rewardsTierName, { color: standing.tier.accent }]}>{standing.tier.label}</Text>
          <Text style={styles.rewardsTierMeta}>{startingLevelLabel}</Text>
        </View>

        <View style={styles.rewardsCard}>
          <Text style={styles.rewardsCardTitle}>
            {next ? `${unlockLabel} ${next.label}` : unlockLabel}
          </Text>
          <Text style={styles.rewardsCardHint}>{requiredHint}</Text>
          <View style={styles.rewardsProgressRow}>
            <Text style={styles.rewardsProgressLabel}>{streakWord}</Text>
            <Text style={styles.rewardsProgressValue}>{pilotTierProgressLabel(standing, lang)}</Text>
          </View>
          <View style={styles.standingTrack}>
            <View
              style={[
                styles.standingFill,
                {
                  width: `${Math.round(standing.ratio * 100)}%`,
                  backgroundColor: standing.tier.accent,
                },
              ]}
            />
          </View>
          <View style={styles.howItWorksBtn}>
            <Text style={styles.howItWorksText}>{howItWorksLabel}</Text>
          </View>
        </View>

        <View style={styles.rewardsCard}>
          <Text style={styles.rewardsCardHint}>
            {lang === 'sw'
              ? `Kamisheni ${standing.feePercent}% · ${standing.tier.priority}`
              : `Commission ${standing.feePercent}% · ${standing.tier.priority}`}
          </Text>
          <Text style={[styles.rewardsCardHint, { marginTop: 6 }]}>
            {lang === 'sw'
              ? `Cancel ${standing.cancelPercent}% · Imekamilika ${standing.completed}`
              : `Cancel ${standing.cancelPercent}% · Completed ${standing.completed}`}
          </Text>
        </View>

        {PILOT_TIER_RULES.map((tier) => {
          const unlocked = standing.streak >= tier.minStreak;
          const isCurrent = standing.tier.id === tier.id;
          const benefits = pilotBenefitsForTier(tier.id, lang);
          return (
            <View key={tier.id} style={[styles.tierBlock, !unlocked && styles.tierBlockLocked]}>
              <View style={styles.tierBlockHead}>
                <PilotTierMedal id={tier.id} width={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tierBlockTitle}>
                    {isCurrent
                      ? lang === 'sw'
                        ? `Faida zako za ${tier.label}`
                        : `Your ${tier.label} Benefits`
                      : lang === 'sw'
                        ? `Faida za ${tier.label}`
                        : `${tier.label} Benefits`}
                  </Text>
                  {!unlocked ? (
                    <Text style={styles.tierBlockReq}>
                      {lang === 'sw'
                        ? `${tier.minStreak} mfululizo · kamisheni ${tier.feePercent}%`
                        : `${tier.minStreak} streak · ${tier.feePercent}% commission`}
                    </Text>
                  ) : null}
                </View>
                {!unlocked ? (
                  <MaterialCommunityIcons name="lock" size={16} color={tier.accent} />
                ) : null}
              </View>
              {benefits.map((benefit) => (
                <View key={`${tier.id}-${benefit.title}`} style={styles.benefitRow}>
                  <View
                    style={[
                      styles.benefitIcon,
                      { backgroundColor: unlocked ? tier.accentSoft : '#1A1F26' },
                    ]}>
                    <MaterialCommunityIcons
                      name={benefit.icon}
                      size={18}
                      color={unlocked ? tier.accent : driveTheme.colors.muted}
                    />
                  </View>
                  <Text
                    style={[styles.benefitText, !unlocked && styles.benefitTextLocked]}
                    numberOfLines={2}>
                    {benefit.title}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function BoltRideRow({
  when,
  place,
  status,
  statusTone,
  fare,
  onPress,
}: {
  when: string;
  place: string;
  status: string;
  statusTone: 'done' | 'warn' | 'muted';
  fare: string;
  onPress?: () => void;
}) {
  const statusColor =
    statusTone === 'done'
      ? '#6EE7A8'
      : statusTone === 'warn'
        ? '#F5B96A'
        : driveTheme.colors.subtext;

  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.rideRow, pressed && styles.pressed]}>
      <View style={styles.rideMain}>
        <Text style={styles.rideWhen}>{when}</Text>
        <Text style={styles.ridePlace} numberOfLines={2}>
          {place}
        </Text>
        <Text style={[styles.rideStatus, { color: statusColor }]}>{status}</Text>
      </View>
      <View style={styles.rideFareCol}>
        <Text style={styles.rideFare}>{fare}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={driveTheme.colors.muted} />
      </View>
    </Pressable>
  );
}

export function BoltBottomNavItem({
  icon,
  label,
  active,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  badge?: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}>
      <View style={styles.navIconWrap}>
        <MaterialCommunityIcons
          name={icon}
          size={24}
          color={active ? driveTheme.colors.primary : driveTheme.colors.muted}
        />
        {badge ? (
          <View style={styles.navBadge}>
            <Text style={styles.navBadgeText}>{Math.min(badge, 9)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <View style={styles.navDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.55 },

  earningsPill: {
    minWidth: 128,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,229,0,0.28)',
    alignItems: 'center',
    ...driveTheme.shadows.pill,
  },
  earningsValue: {
    fontFamily: driveType.bold,
    fontSize: 16,
    color: driveTheme.colors.ink,
  },
  earningsMeta: {
    marginTop: 1,
    fontFamily: driveType.regular,
    fontSize: 12,
    color: driveTheme.colors.subtext,
  },

  mapIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: driveTheme.colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...driveTheme.shadows.float,
  },

  goOnlineBtn: {
    minWidth: 180,
    paddingHorizontal: 28,
    paddingVertical: 15,
    borderRadius: driveTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'center',
    ...driveTheme.shadows.pill,
  },
  goOnlineBtnOffline: {
    backgroundColor: driveTheme.colors.cta,
  },
  goOnlineBtnOnline: {
    backgroundColor: driveTheme.colors.glass,
    borderWidth: 1.5,
    borderColor: driveTheme.colors.primary,
  },
  goOnlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  goOnlineDotOff: { backgroundColor: driveTheme.colors.ctaText },
  goOnlineDotOn: { backgroundColor: driveTheme.colors.online },
  goOnlineText: {
    fontFamily: driveType.bold,
    fontSize: 17,
    color: driveTheme.colors.ctaText,
    letterSpacing: 0.2,
  },
  goOnlineTextOnline: {
    color: driveTheme.colors.primary,
  },

  homeSheet: {
    backgroundColor: driveTheme.colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
    ...driveTheme.shadows.sheet,
  },
  homeSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: driveTheme.colors.lineStrong,
    marginBottom: 12,
  },

  statusBlock: {
    marginBottom: 12,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDotOn: { backgroundColor: driveTheme.colors.online },
  liveDotOff: { backgroundColor: driveTheme.colors.muted },
  statusTitle: {
    flex: 1,
    fontFamily: driveType.bold,
    fontSize: 17,
    color: driveTheme.colors.ink,
  },
  statusHint: {
    marginTop: 4,
    fontFamily: driveType.regular,
    fontSize: 13,
    lineHeight: 18,
    color: driveTheme.colors.subtext,
  },
  nearbyChip: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,229,0,0.35)',
  },
  nearbyChipText: {
    fontFamily: driveType.semibold,
    fontSize: 12,
    color: driveTheme.colors.primary,
  },

  standingHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,229,0,0.18)',
  },
  standingHeroCopy: { flex: 1, minWidth: 0 },
  standingKicker: {
    fontFamily: driveType.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: driveTheme.colors.subtext,
  },
  standingTier: {
    marginTop: 2,
    fontFamily: driveType.bold,
    fontSize: 22,
  },
  standingMeta: {
    marginTop: 2,
    fontFamily: driveType.regular,
    fontSize: 12,
    color: driveTheme.colors.subtext,
  },
  standingTrack: {
    marginTop: 10,
    height: 5,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.line,
    overflow: 'hidden',
  },
  standingFill: {
    height: '100%',
    borderRadius: 999,
  },
  standingProgress: {
    marginTop: 6,
    fontFamily: driveType.semibold,
    fontSize: 12,
    color: driveTheme.colors.ink,
  },

  scoreRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  scoreCard: {
    flex: 1,
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
  },
  scoreLabel: {
    fontFamily: driveType.regular,
    fontSize: 11,
    color: driveTheme.colors.subtext,
  },
  scoreValue: {
    marginTop: 4,
    fontFamily: driveType.bold,
    fontSize: 20,
    color: driveTheme.colors.ink,
    letterSpacing: -0.4,
  },

  rewardsRoot: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  rewardsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: driveTheme.colors.line,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rewardsTitle: {
    fontFamily: driveType.bold,
    fontSize: 17,
    color: driveTheme.colors.ink,
  },
  rewardsContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  rewardsHero: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  rewardsTierName: {
    marginTop: 10,
    fontFamily: driveType.bold,
    fontSize: 28,
  },
  rewardsTierMeta: {
    marginTop: 4,
    fontFamily: driveType.regular,
    fontSize: 14,
    color: driveTheme.colors.subtext,
  },
  rewardsCard: {
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
  },
  rewardsCardTitle: {
    fontFamily: driveType.bold,
    fontSize: 18,
    color: driveTheme.colors.ink,
  },
  rewardsCardHint: {
    marginTop: 6,
    fontFamily: driveType.regular,
    fontSize: 13,
    color: driveTheme.colors.subtext,
  },
  rewardsProgressRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rewardsProgressLabel: {
    fontFamily: driveType.regular,
    fontSize: 13,
    color: driveTheme.colors.subtext,
  },
  rewardsProgressValue: {
    fontFamily: driveType.bold,
    fontSize: 14,
    color: driveTheme.colors.ink,
  },
  howItWorksBtn: {
    marginTop: 14,
    backgroundColor: driveTheme.colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  howItWorksText: {
    fontFamily: driveType.bold,
    fontSize: 15,
    color: driveTheme.colors.ctaText,
  },

  tierBlock: {
    backgroundColor: driveTheme.colors.surfaceMuted,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: driveTheme.colors.line,
  },
  tierBlockLocked: {
    opacity: 0.78,
  },
  tierBlockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  tierBlockTitle: {
    fontFamily: driveType.bold,
    fontSize: 16,
    color: driveTheme.colors.ink,
  },
  tierBlockReq: {
    marginTop: 2,
    fontFamily: driveType.regular,
    fontSize: 12,
    color: driveTheme.colors.subtext,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: driveTheme.colors.line,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    fontFamily: driveType.semibold,
    fontSize: 14,
    color: driveTheme.colors.ink,
  },
  benefitTextLocked: {
    color: driveTheme.colors.subtext,
  },

  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: driveTheme.colors.line,
  },
  rideMain: { flex: 1, minWidth: 0 },
  rideWhen: {
    fontFamily: driveType.regular,
    fontSize: 12,
    color: driveTheme.colors.subtext,
  },
  ridePlace: {
    marginTop: 4,
    fontFamily: driveType.bold,
    fontSize: 16,
    color: driveTheme.colors.ink,
  },
  rideStatus: {
    marginTop: 4,
    fontFamily: driveType.semibold,
    fontSize: 13,
  },
  rideFareCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rideFare: {
    fontFamily: driveType.semibold,
    fontSize: 14,
    color: driveTheme.colors.ink,
  },

  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 2,
  },
  navIconWrap: {
    position: 'relative',
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  navBadgeText: {
    fontFamily: driveType.bold,
    fontSize: 10,
    color: '#FFFFFF',
  },
  navLabel: {
    fontFamily: driveType.regular,
    fontSize: 11,
    color: driveTheme.colors.muted,
  },
  navLabelActive: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.primary,
  },
  navDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: driveTheme.colors.primary,
    marginTop: 2,
  },
});

export type { PilotTierId };
