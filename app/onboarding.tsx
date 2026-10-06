import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { hasCompletedOnboarding, markOnboardingComplete } from '@/lib/onboarding';
import * as ExpoSplashScreen from 'expo-splash-screen';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

const HAUL_YELLOW = '#FFE500';
const LETTERS = ['H', 'A', 'U', 'L'] as const;

/** Quiet empty yellow frame before the first letter. */
const INTRO_EMPTY_MS = 280;
/** Stillness after L locks, before the slogan appears. */
const POST_WORD_STILL_MS = 200;
/** Slogan fade + short rise-in. */
const SLOGAN_IN_MS = 420;
/** Hold finished title card (word + slogan) before fade. */
const LETTER_HOLD_MS = 1000;
const INTRO_FADE_MS = 380;
/** Tiny brand-lock settle on the finished cluster. */
const BRAND_LOCK_MS = 220;
const HAUL_SLOGAN = 'move what matters....';

/**
 * Per-letter motion budgets (ms) — anticipation → fall → land → settle.
 * Slightly different so the sequence feels human, not mechanical.
 */
const LETTER_MOTION = [
  { anticipMs: 70, fallMs: 330, landMs: 95, settleMs: 110 }, // H
  { anticipMs: 55, fallMs: 305, landMs: 88, settleMs: 100 }, // A
  { anticipMs: 65, fallMs: 340, landMs: 100, settleMs: 115 }, // U
  { anticipMs: 50, fallMs: 315, landMs: 90, settleMs: 105 }, // L
] as const;

function letterDurationMs(index: number) {
  const m = LETTER_MOTION[index] ?? LETTER_MOTION[0];
  return m.anticipMs + m.fallMs + m.landMs + m.settleMs;
}

function letterStartDelayMs(index: number) {
  let delay = INTRO_EMPTY_MS;
  for (let i = 0; i < index; i += 1) {
    delay += letterDurationMs(i);
  }
  return delay;
}

const parcelArt = require('@/assets/images/onboarding-parcel-plane-bus.png');
const ninunulieArt = require('@/assets/images/onboarding-ninunulie-market.png');
const cargoArt = require('@/assets/images/onboarding-cargo-truck-bajaji.png');
const tiketiArt = require('@/assets/images/onboarding-tiketi-bus.png');

type OnboardingSlide = {
  key: string;
  headline: string;
  subtitle?: string;
  points?: string[];
  art: number;
};

const SLIDES: OnboardingSlide[] = [
  {
    key: 'parcel',
    headline: 'Tuma kifurushi, mkoa wowote Tanzania.',
    art: parcelArt,
  },
  {
    key: 'ninunulie',
    headline: 'Ninunulie.',
    points: [
      'Tunakununulia bidhaa',
      'Wewe unamlipa mfanyabiashara',
      'Sisi tunakusafirishia, bila ubababishaji',
    ],
    art: ninunulieArt,
  },
  {
    key: 'cargo',
    headline: 'Safirisha mizigo.',
    subtitle: 'Lori na bajaji vinakusafirishia.',
    art: cargoArt,
  },
  {
    key: 'tiketi',
    headline: 'Tiketi.',
    subtitle: 'Kata tiketi ya basi lolote hapa.',
    art: tiketiArt,
  },
];

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<OnboardingSlide>>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  // Hide native splash on first layout so no logo page sits in front of HAUL.
  useLayoutEffect(() => {
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hasCompletedOnboarding().then((done) => {
      if (cancelled) {
        return;
      }
      setAlreadyDone(done);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, next));
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
    setIndex(clamped);
  }, []);

  const finish = useCallback(async () => {
    await markOnboardingComplete();
    router.replace('/home');
  }, [router]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = viewableItems[0]?.index;
    if (typeof next === 'number') {
      setIndex(next);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60 }).current;

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, next)));
  }, []);

  // First JS screen: letter fall immediately (no Redirect hop, no logo image).
  if (showIntro) {
    return (
      <HaulLetterIntro
        onFinished={() => {
          if (alreadyDone) {
            router.replace('/home');
            return;
          }
          setShowIntro(false);
        }}
      />
    );
  }

  if (!ready) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="dark-content" backgroundColor={HAUL_YELLOW} />
      </View>
    );
  }

  const renderItem = ({ item, index: itemIndex }: ListRenderItemInfo<OnboardingSlide>) => {
    const isLast = itemIndex === SLIDES.length - 1;
    const canGoBack = itemIndex > 0;

    return (
      <View style={[styles.page, { width: SCREEN_WIDTH, paddingTop: insets.top + 8 }]}>
        <View style={styles.topBar}>
          {canGoBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rudi"
              hitSlop={12}
              onPress={() => goTo(itemIndex - 1)}
              style={styles.backButton}>
              <Ionicons name="chevron-back" size={26} color={cargoTheme.colors.ink} />
            </Pressable>
          ) : (
            <View style={styles.backButton} />
          )}
        </View>

        <Text style={styles.headline}>{item.headline}</Text>
        {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}

        {item.points?.length ? (
          <View style={styles.pointsWrap}>
            {item.points.map((point) => (
              <View key={point} style={styles.pointRow}>
                <View style={styles.pointBullet} />
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.centerStage}>
          <Image source={item.art} style={styles.centerArt} resizeMode="contain" />
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <PagerDots activeIndex={itemIndex} onPressDot={goTo} />

          {isLast ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Anza"
              onPress={() => {
                void finish();
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>Anza</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Endelea"
              onPress={() => goTo(itemIndex + 1)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>Endelea</Text>
              <Ionicons name="chevron-forward" size={20} color={cargoTheme.cta.labelColor} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Tayari una akaunti? Ingia"
            onPress={() => router.push('/login')}
            style={styles.loginLinkWrap}>
            <Text style={styles.loginLinkMuted}>Tayari una akaunti? </Text>
            <Text style={styles.loginLinkAction}>Ingia</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={onMomentumScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, itemIndex) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * itemIndex,
          index: itemIndex,
        })}
      />
    </View>
  );
}

function HaulLetterIntro({ onFinished }: { onFinished: () => void }) {
  const finishedRef = useRef(false);
  const wordOpacity = useSharedValue(1);
  const frameScale = useSharedValue(1.016);
  const sloganOpacity = useSharedValue(0);
  const sloganTranslateY = useSharedValue(10);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [motionReady, setMotionReady] = useState(false);

  // Optical size: large but safe on small phones; never clip.
  const letterSize = Math.round(
    Math.min(96, Math.max(58, Math.min(SCREEN_WIDTH * 0.168, SCREEN_HEIGHT * 0.1)))
  );
  const fallDistance = Math.round(Math.min(118, Math.max(78, SCREEN_HEIGHT * 0.115)));
  // Tight wordmark kerning via gap + negative letterSpacing on glyphs.
  const letterGap = Math.max(0, Math.round(letterSize * -0.02));
  const sloganSize = Math.round(Math.min(19, Math.max(14, letterSize * 0.2)));

  const finishOnce = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    onFinished();
  }, [onFinished]);

  useLayoutEffect(() => {
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (cancelled) {
        return;
      }
      setReduceMotion(Boolean(enabled));
      setMotionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!motionReady) {
      return;
    }

    if (reduceMotion) {
      frameScale.value = 1;
      sloganOpacity.value = 1;
      sloganTranslateY.value = 0;
      wordOpacity.value = withDelay(
        LETTER_HOLD_MS,
        withTiming(0, { duration: INTRO_FADE_MS, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) {
            runOnJS(finishOnce)();
          }
        })
      );
      return;
    }

    const wordCompleteMs = letterStartDelayMs(LETTERS.length - 1) + letterDurationMs(LETTERS.length - 1);
    const sloganStartMs = wordCompleteMs + POST_WORD_STILL_MS;
    const sloganDoneMs = sloganStartMs + SLOGAN_IN_MS;
    const fadeStartMs = sloganDoneMs + LETTER_HOLD_MS;

    // Camera: extremely subtle drift-in as the wordmark forms, then a quiet brand-lock.
    frameScale.value = 1.016;
    frameScale.value = withSequence(
      withTiming(1, {
        duration: wordCompleteMs,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      }),
      withTiming(1.008, {
        duration: Math.round(BRAND_LOCK_MS * 0.45),
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      }),
      withTiming(1, {
        duration: Math.round(BRAND_LOCK_MS * 0.55),
        easing: Easing.inOut(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      })
    );

    sloganOpacity.value = 0;
    sloganTranslateY.value = 10;
    sloganOpacity.value = withDelay(
      sloganStartMs,
      withTiming(1, {
        duration: SLOGAN_IN_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      })
    );
    sloganTranslateY.value = withDelay(
      sloganStartMs,
      withTiming(0, {
        duration: SLOGAN_IN_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      })
    );

    wordOpacity.value = withDelay(
      fadeStartMs,
      withTiming(0, { duration: INTRO_FADE_MS, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) {
          runOnJS(finishOnce)();
        }
      })
    );
  }, [
    finishOnce,
    frameScale,
    motionReady,
    reduceMotion,
    sloganOpacity,
    sloganTranslateY,
    wordOpacity,
  ]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ scale: frameScale.value }],
  }));

  const sloganStyle = useAnimatedStyle(() => ({
    opacity: sloganOpacity.value,
    transform: [{ translateY: sloganTranslateY.value }],
  }));

  if (!motionReady) {
    return (
      <View style={styles.introRoot} accessibilityLabel="HAUL">
        <StatusBar barStyle="dark-content" backgroundColor={HAUL_YELLOW} />
      </View>
    );
  }

  return (
    <View style={styles.introRoot} accessibilityLabel="HAUL">
      <StatusBar barStyle="dark-content" backgroundColor={HAUL_YELLOW} />
      <Animated.View style={[styles.introCluster, fadeStyle]}>
        <View style={[styles.introWordRow, { columnGap: letterGap }]}>
          {LETTERS.map((letter, letterIndex) => (
            <FallingLetter
              key={letter}
              letter={letter}
              letterIndex={letterIndex}
              delayMs={letterStartDelayMs(letterIndex)}
              fallDistance={fallDistance}
              letterSize={letterSize}
              reduceMotion={reduceMotion}
            />
          ))}
        </View>
        <Animated.Text
          style={[
            styles.introSlogan,
            {
              marginTop: Math.round(letterSize * 0.28),
              fontSize: sloganSize,
              lineHeight: Math.round(sloganSize * 1.35),
              letterSpacing: Math.round(sloganSize * 0.18),
            },
            sloganStyle,
          ]}>
          {HAUL_SLOGAN}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

function FallingLetter({
  letter,
  letterIndex,
  delayMs,
  fallDistance,
  letterSize,
  reduceMotion,
}: {
  letter: string;
  letterIndex: number;
  delayMs: number;
  fallDistance: number;
  letterSize: number;
  reduceMotion: boolean;
}) {
  const motion = LETTER_MOTION[letterIndex] ?? LETTER_MOTION[0];
  // Very small entry tilt — engineered, not theatrical.
  const entryRotate = letterIndex % 2 === 0 ? -2.2 : 1.8;
  const anticipLift = Math.round(fallDistance * 0.06);

  const translateY = useSharedValue(reduceMotion ? 0 : -(fallDistance - anticipLift));
  const scale = useSharedValue(reduceMotion ? 1 : 1.08);
  const rotate = useSharedValue(reduceMotion ? 0 : entryRotate);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      translateY.value = 0;
      scale.value = 1;
      rotate.value = 0;
      opacity.value = 1;
      return;
    }

    const startY = -fallDistance;
    const anticipY = -(fallDistance + anticipLift);

    opacity.value = 0;
    translateY.value = startY;
    scale.value = 1.08;
    rotate.value = entryRotate;

    opacity.value = withDelay(delayMs, withTiming(1, { duration: 28, easing: Easing.linear }));

    translateY.value = withDelay(
      delayMs,
      withSequence(
        withTiming(anticipY, {
          duration: motion.anticipMs,
          easing: Easing.out(Easing.quad),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(3, {
          duration: motion.fallMs,
          easing: Easing.bezier(0.7, 0.0, 0.84, 0.2),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(-1.5, {
          duration: motion.landMs,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(0, {
          duration: motion.settleMs,
          easing: Easing.inOut(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        })
      )
    );

    scale.value = withDelay(
      delayMs,
      withSequence(
        withTiming(1.12, {
          duration: motion.anticipMs,
          easing: Easing.out(Easing.quad),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(1.015, {
          duration: motion.fallMs,
          easing: Easing.bezier(0.55, 0.0, 0.8, 0.35),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(0.992, {
          duration: motion.landMs,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(1, {
          duration: motion.settleMs,
          easing: Easing.inOut(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        })
      )
    );

    rotate.value = withDelay(
      delayMs,
      withSequence(
        withTiming(entryRotate * 1.15, {
          duration: motion.anticipMs,
          easing: Easing.out(Easing.quad),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(entryRotate * 0.2, {
          duration: motion.fallMs,
          easing: Easing.in(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        }),
        withTiming(0, {
          duration: motion.landMs + motion.settleMs,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.Never,
        })
      )
    );
  }, [
    anticipLift,
    delayMs,
    entryRotate,
    fallDistance,
    motion.anticipMs,
    motion.fallMs,
    motion.landMs,
    motion.settleMs,
    opacity,
    reduceMotion,
    rotate,
    scale,
    translateY,
  ]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.Text
      style={[
        styles.introLetter,
        {
          fontSize: letterSize,
          lineHeight: Math.round(letterSize * 1.02),
          minWidth: Math.round(letterSize * (letter === 'A' || letter === 'H' ? 0.62 : 0.56)),
          letterSpacing: Math.round(letterSize * -0.045),
        },
        style,
      ]}>
      {letter}
    </Animated.Text>
  );
}

function PagerDots({
  activeIndex,
  onPressDot,
}: {
  activeIndex: number;
  onPressDot: (index: number) => void;
}) {
  return (
    <View style={styles.dots}>
      {SLIDES.map((slide, dotIndex) => {
        const active = dotIndex === activeIndex;
        return (
          <Pressable
            key={slide.key}
            accessibilityRole="button"
            accessibilityLabel={`Slide ${dotIndex + 1}`}
            onPress={() => onPressDot(dotIndex)}
            hitSlop={10}
            style={[styles.dot, active ? styles.dotActive : styles.dotIdle]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loading: {
    flex: 1,
    backgroundColor: HAUL_YELLOW,
  },
  introRoot: {
    flex: 1,
    backgroundColor: HAUL_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCluster: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  introWordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introLetter: {
    fontFamily: typography.ident,
    color: '#111111',
    textAlign: 'center',
    includeFontPadding: false,
    textTransform: 'uppercase',
  },
  introSlogan: {
    fontFamily: typography.identSlogan,
    fontStyle: 'italic',
    color: '#111111',
    textAlign: 'center',
    includeFontPadding: false,
    textTransform: 'none',
  },
  page: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  topBar: {
    minHeight: 40,
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.bold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.4,
    paddingRight: 8,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
    paddingRight: 8,
  },
  pointsWrap: {
    gap: 12,
    paddingTop: 16,
    paddingBottom: 4,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pointBullet: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: HAUL_YELLOW,
    borderWidth: 1.5,
    borderColor: cargoTheme.colors.ink,
  },
  pointText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.ink,
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -12,
    minHeight: 180,
  },
  centerArt: {
    width: '100%',
    height: 260,
  },
  footer: {
    gap: 14,
    paddingTop: 8,
  },
  primaryButton: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  primaryButtonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
  pressed: {
    opacity: 0.88,
  },
  loginLinkWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
  },
  loginLinkMuted: {
    fontSize: 14,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
  },
  loginLinkAction: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.ink,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 999,
  },
  dotIdle: {
    width: 8,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    width: 28,
    backgroundColor: HAUL_YELLOW,
  },
});
