import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  StatusBar,
  StyleSheet,
  View,
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
import * as ExpoSplashScreen from 'expo-splash-screen';

import { typography } from '@/constants/typography';

const HAUL_YELLOW = '#FFE500';
const LETTERS = ['H', 'A', 'U', 'L'] as const;
const INTRO_EMPTY_MS = 280;
const POST_WORD_STILL_MS = 200;
const SLOGAN_IN_MS = 420;
const LETTER_HOLD_MS = 1000;
const INTRO_FADE_MS = 380;
const BRAND_LOCK_MS = 220;
const HAUL_SLOGAN = 'move what matters....';

const LETTER_MOTION = [
  { anticipMs: 70, fallMs: 330, landMs: 95, settleMs: 110 },
  { anticipMs: 55, fallMs: 305, landMs: 88, settleMs: 100 },
  { anticipMs: 65, fallMs: 340, landMs: 100, settleMs: 115 },
  { anticipMs: 50, fallMs: 315, landMs: 90, settleMs: 105 },
] as const;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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

export function HaulLetterIntro({ onFinished }: { onFinished: () => void }) {
  const finishedRef = useRef(false);
  const wordOpacity = useSharedValue(1);
  const frameScale = useSharedValue(1.016);
  const sloganOpacity = useSharedValue(0);
  const sloganTranslateY = useSharedValue(10);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [motionReady, setMotionReady] = useState(false);

  const letterSize = Math.round(
    Math.min(96, Math.max(58, Math.min(SCREEN_WIDTH * 0.168, SCREEN_HEIGHT * 0.1)))
  );
  const fallDistance = Math.round(Math.min(118, Math.max(78, SCREEN_HEIGHT * 0.115)));
  const letterGap = Math.max(0, Math.round(letterSize * -0.02));
  const sloganSize = Math.round(Math.min(19, Math.max(14, letterSize * 0.2)));

  const finishOnce = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished();
  }, [onFinished]);

  useLayoutEffect(() => {
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (cancelled) return;
      setReduceMotion(Boolean(enabled));
      setMotionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!motionReady) return;

    if (reduceMotion) {
      frameScale.value = 1;
      sloganOpacity.value = 1;
      sloganTranslateY.value = 0;
      wordOpacity.value = withDelay(
        LETTER_HOLD_MS,
        withTiming(0, { duration: INTRO_FADE_MS, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) runOnJS(finishOnce)();
        })
      );
      return;
    }

    const wordCompleteMs = letterStartDelayMs(LETTERS.length - 1) + letterDurationMs(LETTERS.length - 1);
    const sloganStartMs = wordCompleteMs + POST_WORD_STILL_MS;
    const sloganDoneMs = sloganStartMs + SLOGAN_IN_MS;
    const fadeStartMs = sloganDoneMs + LETTER_HOLD_MS;

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
        if (done) runOnJS(finishOnce)();
      })
    );
  }, [finishOnce, frameScale, motionReady, reduceMotion, sloganOpacity, sloganTranslateY, wordOpacity]);

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

const styles = StyleSheet.create({
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
});
