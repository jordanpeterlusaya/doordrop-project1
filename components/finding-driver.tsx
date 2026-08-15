import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';

function useRotation(durationMs: number) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [durationMs, value]);

  return value.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
}

function SpinnerMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? 40 : 68;
  const coreSize = compact ? 28 : 48;
  const rotate = useRotation(compact ? 1100 : 1400);

  return (
    <View style={[styles.mark, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.arc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ rotate }],
          },
        ]}
      />
      <View style={[styles.core, compact && styles.coreCompact, { width: coreSize, height: coreSize, borderRadius: coreSize / 2 }]}>
        <MaterialCommunityIcons
          name="motorbike"
          size={compact ? 16 : 20}
          color={cargoTheme.colors.primaryDark}
        />
      </View>
    </View>
  );
}

function QuietProgress() {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1800,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [sweep]);

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.sweep,
          {
            transform: [
              {
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-56, 240],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function FoundMark() {
  const scale = useRef(new Animated.Value(0.82)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <Animated.View style={[styles.foundMark, { opacity, transform: [{ scale }] }]}>
      <MaterialCommunityIcons name="check" size={26} color="#FFFFFF" />
    </Animated.View>
  );
}

export function FindingDriverVisual({ compact = false }: { compact?: boolean }) {
  const copy = useAppCopy();

  if (compact) {
    return <SpinnerMark compact />;
  }

  return (
    <View style={styles.block}>
      <SpinnerMark />
      <Text style={styles.title}>{copy.track.findingDriver}</Text>
      <Text style={styles.subtitle}>{copy.track.lookingText}</Text>
      <QuietProgress />
    </View>
  );
}

export function DriverFoundVisual({ driverName }: { driverName?: string | null }) {
  const copy = useAppCopy();
  const subtitle = driverName?.trim()
    ? copy.track.driverFoundText.replace('{name}', driverName.trim())
    : copy.track.driverFoundFallback;

  return (
    <View style={styles.block}>
      <FoundMark />
      <Text style={styles.title}>{copy.track.driverFound}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.completeTrack} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    marginBottom: 18,
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  arc: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(22, 163, 74, 0.16)',
    borderTopColor: cargoTheme.colors.primary,
    borderRightColor: cargoTheme.colors.primary,
  },
  core: {
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreCompact: {
    backgroundColor: '#ECFDF3',
  },
  title: {
    fontFamily: typography.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 4,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  track: {
    width: '100%',
    height: 3,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    marginTop: 16,
    overflow: 'hidden',
  },
  sweep: {
    width: 72,
    height: 3,
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.primary,
    opacity: 0.85,
  },
  foundMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: cargoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  completeTrack: {
    width: '100%',
    height: 3,
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.primary,
    marginTop: 16,
  },
});
