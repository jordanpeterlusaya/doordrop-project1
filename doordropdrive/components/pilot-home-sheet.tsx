import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { driveTheme, driveType } from '../constants/drive-theme';
import { pilotTierProgressLabel, type PilotStanding } from '../constants/pilot-standing';
import { driveHapticLight, driveHapticMedium } from '../lib/drive-haptics';
import { PilotTierMedal } from './pilot-tier-medal';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const SCREEN_H = Dimensions.get('window').height;
/** Collapsed strip — map stays dominant. */
export const HOME_SHEET_PEEK = 72;
/** Expanded dashboard height. */
export const HOME_SHEET_EXPANDED = Math.min(Math.round(SCREEN_H * 0.48), 380);

export function PilotGoOnlineButton({
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
  return (
    <Pressable
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        void driveHapticMedium();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.goBtn,
        online ? styles.goBtnOnline : styles.goBtnOffline,
        loading && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.goBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function PilotMapChromeButton({
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
      style={({ pressed }) => [styles.mapBtn, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon} size={22} color="#F8FAFC" />
    </Pressable>
  );
}

/** Tap to reveal commission due under today's earnings. */
export function PilotEarningsPill({
  value,
  meta,
  commissionLabel,
  commissionValue,
  expandedHint,
}: {
  value: string;
  meta: string;
  commissionLabel?: string;
  commissionValue?: string;
  expandedHint?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasCommission = Boolean(commissionValue && commissionValue !== 'TZS 0');

  return (
    <Pressable
      onPress={() => {
        void driveHapticLight();
        setExpanded((v) => !v);
      }}
      style={({ pressed }) => [styles.earnPill, expanded && styles.earnPillExpanded, pressed && styles.pressed]}>
      <Text style={styles.earnValue}>{value}</Text>
      <Text style={styles.earnMeta}>{meta}</Text>
      {expanded ? (
        <View style={styles.earnExpand}>
          <Text style={styles.earnCommissionLabel}>{commissionLabel || 'Commission'}</Text>
          <Text style={[styles.earnCommissionValue, hasCommission && styles.earnCommissionDue]}>
            {commissionValue || 'TZS 0'}
          </Text>
          {expandedHint ? <Text style={styles.earnExpandHint}>{expandedHint}</Text> : null}
        </View>
      ) : (
        <Text style={styles.earnTapHint}>ⓘ</Text>
      )}
    </Pressable>
  );
}

const SearchingDots = React.memo(function SearchingDotsInner() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 320, useNativeDriver: true }),
        ])
      );
    const la = make(a, 0);
    const lb = make(b, 160);
    const lc = make(c, 320);
    la.start();
    lb.start();
    lc.start();
    return () => {
      la.stop();
      lb.stop();
      lc.stop();
    };
  }, [a, b, c]);

  return (
    <View style={styles.dotsRow}>
      {[a, b, c].map((v, i) => (
        <Animated.View key={i} style={[styles.dotPulse, { opacity: v }]} />
      ))}
    </View>
  );
});

const SearchingPulse = React.memo(function SearchingPulseInner({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      orbit.setValue(0);
      return;
    }
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ])
    );
    const orbitLoop = Animated.loop(
      Animated.timing(orbit, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true })
    );
    pulseLoop.start();
    orbitLoop.start();
    return () => {
      pulseLoop.stop();
      orbitLoop.stop();
    };
  }, [active, pulse, orbit]);

  if (!active) {
    return <View style={[styles.liveDot, styles.liveOff]} />;
  }

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const rotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.searchAnimWrap}>
      <Animated.View style={[styles.searchRing, { opacity, transform: [{ scale }] }]} />
      <Animated.View style={{ transform: [{ rotate }] }}>
        <View style={styles.searchSweep} />
      </Animated.View>
      <View style={[styles.liveDot, styles.liveOn]} />
    </View>
  );
});

type ActionCard = {
  key: string;
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
};

/**
 * Peek by default. Swipe up for rewards / stats / actions.
 * Reports expand state so the Go Online button can sit above the peek.
 */
export function PilotSwipeDashboard({
  online,
  statusTitle,
  statusHint,
  actionCards,
  standing,
  rewardsLabel,
  scoreLabel,
  streakWord,
  commissionLabel,
  deliveredToday,
  earningsTodayValue,
  onPressRewards,
  onExpandedChange,
}: {
  online: boolean;
  statusTitle: string;
  statusHint: string;
  actionCards: ActionCard[];
  standing: PilotStanding;
  rewardsLabel: string;
  scoreLabel: string;
  streakWord: string;
  commissionLabel: string;
  deliveredToday: number;
  earningsTodayValue: string;
  onPressRewards?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const hiddenY = HOME_SHEET_EXPANDED - HOME_SHEET_PEEK;
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const dragStart = useRef(hiddenY);
  const [expanded, setExpanded] = useState(false);

  const setSheet = (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
    Animated.spring(translateY, {
      toValue: nextExpanded ? 0 : hiddenY,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8,
        onPanResponderGrant: () => {
          translateY.stopAnimation((v) => {
            dragStart.current = typeof v === 'number' ? v : hiddenY;
          });
        },
        onPanResponderMove: (_e, g) => {
          const next = Math.min(hiddenY, Math.max(0, dragStart.current + g.dy));
          translateY.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          const current = Math.min(hiddenY, Math.max(0, dragStart.current + g.dy));
          const shouldExpand = g.vy < -0.4 || (Math.abs(g.vy) <= 0.4 && current < hiddenY / 2);
          setSheet(shouldExpand);
          void driveHapticLight();
        },
      }),
    [hiddenY, translateY]
  );

  const pct = Math.round(standing.ratio * 100);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: HOME_SHEET_EXPANDED,
          transform: [{ translateY }],
        },
      ]}
      {...pan.panHandlers}>
      <Pressable onPress={() => setSheet(!expanded)} style={styles.handleHit}>
        <View style={styles.handle} />
        <View style={styles.peekRow}>
          <SearchingPulse active={online} />
          <Text style={styles.peekTitle} numberOfLines={1}>
            {statusTitle}
          </Text>
          {online ? (
            <View style={styles.searchingDotsWrap}>
              <SearchingDots />
            </View>
          ) : null}
          <MaterialCommunityIcons
            name={expanded ? 'chevron-down' : 'chevron-up'}
            size={20}
            color="#64748B"
          />
        </View>
      </Pressable>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        scrollEnabled={expanded}>
        <Text style={styles.hint}>{statusHint}</Text>

        {actionCards.map((card) => (
          <Pressable
            key={card.key}
            onPress={() => {
              void driveHapticLight();
              card.onPress?.();
            }}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
            <View style={[styles.actionIcon, { backgroundColor: card.iconBg }]}>
              <MaterialCommunityIcons name={card.icon} size={20} color={card.iconColor} />
            </View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>{card.title}</Text>
              <Text style={styles.actionSub} numberOfLines={1}>
                {card.subtitle}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
          </Pressable>
        ))}

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{scoreLabel}</Text>
            <Text style={styles.metricValue}>{standing.driverScorePercent}%</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Leo</Text>
            <Text style={styles.metricValue} numberOfLines={1}>
              {earningsTodayValue}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Done</Text>
            <Text style={styles.metricValue}>{deliveredToday}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => {
            void driveHapticLight();
            onPressRewards?.();
          }}
          style={({ pressed }) => [styles.rewardsCard, pressed && styles.pressed]}>
          <PilotTierMedal id={standing.tier.id} width={48} />
          <View style={styles.rewardsCopy}>
            <Text style={styles.rewardsKicker}>{rewardsLabel}</Text>
            <Text style={[styles.rewardsTier, { color: standing.tier.accent }]}>{standing.tier.label}</Text>
            <Text style={styles.rewardsMeta}>{commissionLabel}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: standing.tier.accent }]} />
            </View>
            <Text style={styles.rewardsProgress}>
              {streakWord} {pilotTierProgressLabel(standing)}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#64748B" />
        </Pressable>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.55 },

  goBtn: {
    minWidth: 188,
    paddingHorizontal: 36,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    ...driveTheme.shadows.pill,
  },
  goBtnOffline: {
    backgroundColor: '#34C759',
  },
  goBtnOnline: {
    backgroundColor: '#1C2430',
    borderWidth: 1.5,
    borderColor: '#34C759',
  },
  goBtnText: {
    fontFamily: driveType.bold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.15,
  },

  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(18,24,31,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    ...driveTheme.shadows.float,
  },

  earnPill: {
    minWidth: 120,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(18,24,31,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    ...driveTheme.shadows.pill,
  },
  earnValue: {
    fontFamily: driveType.bold,
    fontSize: 16,
    color: '#F8FAFC',
  },
  earnMeta: {
    marginTop: 1,
    fontFamily: driveType.regular,
    fontSize: 12,
    color: '#94A3B8',
  },
  earnPillExpanded: {
    paddingVertical: 12,
    minWidth: 148,
  },
  earnExpand: {
    marginTop: 8,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 8,
    alignSelf: 'stretch',
  },
  earnCommissionLabel: {
    fontFamily: driveType.regular,
    fontSize: 11,
    color: '#94A3B8',
  },
  earnCommissionValue: {
    marginTop: 2,
    fontFamily: driveType.bold,
    fontSize: 14,
    color: '#F8FAFC',
  },
  earnCommissionDue: {
    color: '#F5A623',
  },
  earnExpandHint: {
    marginTop: 4,
    fontFamily: driveType.regular,
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
  },
  earnTapHint: {
    marginTop: 2,
    fontSize: 10,
    color: '#64748B',
  },
  searchAnimWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRing: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#34C759',
  },
  searchSweep: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: 1,
    top: -1,
    left: 2,
  },
  searchingDotsWrap: {
    marginRight: 2,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dotPulse: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#34C759',
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#151A21',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A313B',
    overflow: 'hidden',
    ...driveTheme.shadows.sheet,
  },
  handleHit: {
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A4350',
    marginBottom: 10,
  },
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveOn: { backgroundColor: '#34C759' },
  liveOff: { backgroundColor: '#64748B' },
  peekTitle: {
    flex: 1,
    fontFamily: driveType.semibold,
    fontSize: 15,
    color: '#F8FAFC',
  },

  sheetScroll: { flex: 1 },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  hint: {
    fontFamily: driveType.regular,
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 8,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: { flex: 1, minWidth: 0 },
  actionTitle: {
    fontFamily: driveType.semibold,
    fontSize: 15,
    color: '#F8FAFC',
  },
  actionSub: {
    marginTop: 2,
    fontFamily: driveType.regular,
    fontSize: 13,
    color: '#94A3B8',
  },

  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#1C222B',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  metricLabel: {
    fontFamily: driveType.regular,
    fontSize: 11,
    color: '#94A3B8',
  },
  metricValue: {
    marginTop: 4,
    fontFamily: driveType.bold,
    fontSize: 18,
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },

  rewardsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C222B',
    borderRadius: 16,
    padding: 12,
  },
  rewardsCopy: { flex: 1, minWidth: 0 },
  rewardsKicker: {
    fontFamily: driveType.semibold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#94A3B8',
  },
  rewardsTier: {
    marginTop: 2,
    fontFamily: driveType.bold,
    fontSize: 20,
  },
  rewardsMeta: {
    marginTop: 2,
    fontFamily: driveType.regular,
    fontSize: 12,
    color: '#94A3B8',
  },
  track: {
    marginTop: 8,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#2A313B',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 999 },
  rewardsProgress: {
    marginTop: 6,
    fontFamily: driveType.semibold,
    fontSize: 12,
    color: '#F8FAFC',
  },
});
