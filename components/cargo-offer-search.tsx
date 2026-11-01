import { typography } from '@/constants/typography';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const INK = '#111827';
const HAUL = '#FFE500';

export function CargoOfferSearch({
  label,
  vehicleLabel,
}: {
  label: string;
  hint?: string;
  vehicleKey?: string;
  vehicleLabel?: string;
}) {
  const spread = useSharedValue(0);

  useEffect(() => {
    spread.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(spread);
  }, [spread]);

  const ring = useAnimatedStyle(() => ({
    opacity: 1 - spread.value,
    transform: [{ scale: 0.55 + spread.value * 0.9 }],
  }));

  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.stage}>
        <Animated.View style={[styles.ring, ring]} />
        <View style={styles.core}>
          <Text style={styles.coreText}>{vehicleLabel || 'HAUL'}</Text>
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  stage: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: HAUL,
    backgroundColor: 'rgba(255,229,0,0.18)',
  },
  core: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreText: {
    color: HAUL,
    fontFamily: typography.bold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  label: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: INK,
  },
});
