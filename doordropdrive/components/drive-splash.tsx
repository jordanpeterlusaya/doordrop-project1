import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { driveTheme, driveType } from '../constants/drive-theme';

type Props = {
  tagline: string;
  statusBarInset?: number;
};

/** Dark premium splash — matches HAUL Pilots home shell. */
export function DriveSplashScreen({ tagline, statusBarInset = 0 }: Props) {
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.88)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(markOpacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(markScale, {
        toValue: 1,
        friction: 8,
        tension: 68,
        useNativeDriver: true,
      }),
      Animated.timing(tagOpacity, {
        toValue: 1,
        duration: 420,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 1,
        duration: 3600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [markOpacity, markScale, progress, tagOpacity]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '100%'],
  });

  return (
    <View style={[styles.screen, statusBarInset ? { paddingTop: statusBarInset } : null]}>
      <StatusBar style="light" backgroundColor={driveTheme.colors.canvas} translucent />
      <View style={styles.glowA} />
      <View style={styles.glowB} />

      <View style={styles.center}>
        <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }] }}>
          <Text style={styles.brand}>HAUL</Text>
          <Text style={styles.product}>Pilots</Text>
        </Animated.View>
        <Animated.Text style={[styles.tagline, { opacity: tagOpacity }]}>{tagline}</Animated.Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
    overflow: 'hidden',
  },
  glowA: {
    position: 'absolute',
    top: -100,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,229,0,0.08)',
  },
  glowB: {
    position: 'absolute',
    bottom: 80,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(52,199,89,0.06)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 18,
  },
  brand: {
    color: driveTheme.colors.primary,
    fontFamily: driveType.bold,
    fontSize: 42,
    letterSpacing: 6,
    textAlign: 'center',
  },
  product: {
    marginTop: 4,
    color: driveTheme.colors.ink,
    fontFamily: driveType.semibold,
    fontSize: 18,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  tagline: {
    color: driveTheme.colors.subtext,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: driveType.regular,
    textAlign: 'center',
    maxWidth: 280,
  },
  footer: {
    paddingHorizontal: 56,
    paddingBottom: 48,
  },
  progressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(248,250,252,0.12)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
  },
});
