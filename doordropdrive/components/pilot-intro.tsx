import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { driveTheme, driveType } from '../constants/drive-theme';

const LETTERS = ['H', 'A', 'U', 'L'] as const;

type Props = {
  onFinished: () => void;
};

export function PilotIntro({ onFinished }: Props) {
  const [phase, setPhase] = useState<'ident' | 'pages'>('ident');
  const [page, setPage] = useState(0);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    onFinished();
  };

  if (phase === 'ident') {
    return <LetterIdent onDone={() => setPhase('pages')} />;
  }

  const last = page === 1;

  return (
    <View style={styles.page}>
      <StatusBar style="light" backgroundColor={driveTheme.colors.canvas} />
      <View style={styles.pageBody}>
        {page === 0 ? (
          <>
            <Text style={styles.kicker}>Magari</Text>
            <Text style={styles.headline}>TOYO. Kirikuu. Canter.</Text>
            <Text style={styles.sub}>Magari matatu ya mizigo.</Text>
          </>
        ) : (
          <>
            <Text style={styles.kicker}>HAUL Pilots</Text>
            <Text style={styles.headline}>Unaingia kama pilot aliyethibitishwa.</Text>
            <Text style={styles.sub}>Akaunti isiyoidhinishwa haipokei oda.</Text>
          </>
        )}
      </View>
      <View style={styles.footer}>
        <View style={styles.dots}>
          <View style={[styles.dot, page === 0 && styles.dotOn]} />
          <View style={[styles.dot, page === 1 && styles.dotOn]} />
        </View>
        <Pressable
          onPress={() => {
            if (last) {
              finish();
              return;
            }
            setPage(1);
          }}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
          <Text style={styles.ctaText}>{last ? 'Anza' : 'Endelea'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LetterIdent({ onDone }: { onDone: () => void }) {
  const { width } = useWindowDimensions();
  const letterSize = Math.min(84, Math.round(width * 0.18));
  const pilotsOpacity = useRef(new Animated.Value(0)).current;
  const pilotsY = useRef(new Animated.Value(12)).current;
  const done = useRef(false);

  useEffect(() => {
    const pilotsDelay = 280 + LETTERS.length * 420 + 200;
    const anim = Animated.sequence([
      Animated.delay(pilotsDelay),
      Animated.parallel([
        Animated.timing(pilotsOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pilotsY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1100),
    ]);
    anim.start(({ finished }) => {
      if (finished && !done.current) {
        done.current = true;
        onDone();
      }
    });
    return () => anim.stop();
  }, [onDone, pilotsOpacity, pilotsY]);

  return (
    <View style={styles.ident} accessibilityLabel="HAUL Pilots">
      <StatusBar style="light" backgroundColor={driveTheme.colors.canvas} />
      <View style={styles.glow} />
      <View style={styles.wordRow}>
        {LETTERS.map((letter, index) => (
          <FallingLetter key={letter} letter={letter} delay={280 + index * 420} size={letterSize} />
        ))}
      </View>
      <Animated.Text
        style={[
          styles.pilots,
          { opacity: pilotsOpacity, transform: [{ translateY: pilotsY }] },
        ]}>
        Pilots
      </Animated.Text>
    </View>
  );
}

function FallingLetter({ letter, delay, size }: { letter: string; delay: number; size: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-56)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.Text
      style={[
        styles.letter,
        { fontSize: size, lineHeight: Math.round(size * 1.02), opacity, transform: [{ translateY }] },
      ]}>
      {letter}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  ident: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: '28%',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,229,0,0.08)',
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  letter: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.primary,
    textAlign: 'center',
  },
  pilots: {
    marginTop: 10,
    fontFamily: driveType.semibold,
    fontSize: 20,
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: driveTheme.colors.ink,
  },
  page: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 28,
  },
  pageBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
  },
  kicker: {
    fontFamily: driveType.bold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: driveTheme.colors.ctaText,
    backgroundColor: driveTheme.colors.primary,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
  },
  headline: {
    fontFamily: driveType.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
    color: driveTheme.colors.ink,
  },
  sub: {
    fontFamily: driveType.regular,
    fontSize: 16,
    lineHeight: 24,
    color: driveTheme.colors.subtext,
  },
  footer: {
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: driveTheme.colors.lineStrong,
  },
  dotOn: {
    width: 22,
    backgroundColor: driveTheme.colors.primary,
  },
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: driveTheme.colors.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {
    opacity: 0.88,
  },
  ctaText: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ctaText,
    fontSize: 17,
  },
});
