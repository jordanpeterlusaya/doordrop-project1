import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

const ORBIT_WIDTH = 88;

export function BusParcelSearchIndicator({ accessibilityLabel }: { accessibilityLabel?: string }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.stopAnimation();
      sweep.stopAnimation();
      pulse.setValue(0.65);
      sweep.setValue(0.5);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    pulseLoop.start();
    sweepLoop.start();

    return () => {
      pulseLoop.stop();
      sweepLoop.stop();
    };
  }, [pulse, reduceMotion, sweep]);

  const busScale = reduceMotion ? 1 : pulse.interpolate({ inputRange: [0.3, 1], outputRange: [0.94, 1.06] });
  const busOpacity = reduceMotion ? 1 : pulse.interpolate({ inputRange: [0.3, 1], outputRange: [0.7, 1] });
  const dotX = reduceMotion
    ? 0
    : sweep.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [-ORBIT_WIDTH / 2 + 8, 0, ORBIT_WIDTH / 2 - 8],
      });
  const ringScale = reduceMotion
    ? 1
    : pulse.interpolate({
        inputRange: [0.3, 1],
        outputRange: [1, 1.12],
      });
  const ringOpacity = reduceMotion ? 0.35 : pulse.interpolate({ inputRange: [0.3, 1], outputRange: [0.18, 0.42] });

  return (
    <View
      style={styles.wrap}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || 'Tunatafuta basi'}>
      <View style={styles.orbitTrack}>
        <Animated.View
          style={[
            styles.orbitRing,
            {
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orbitDot,
            {
              opacity: busOpacity,
              transform: [{ translateX: dotX }],
            },
          ]}
        />
        <Animated.View style={[styles.busIcon, { opacity: busOpacity, transform: [{ scale: busScale }] }]}>
          <MaterialCommunityIcons name="bus-side" size={30} color="#111827" />
        </Animated.View>
        <View style={styles.searchBadge}>
          <MaterialCommunityIcons name="magnify" size={14} color="#374151" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  orbitTrack: {
    width: ORBIT_WIDTH,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitRing: {
    position: 'absolute',
    width: ORBIT_WIDTH,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFE500',
    backgroundColor: '#FFFBEB',
  },
  orbitDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#111827',
    top: 10,
  },
  busIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBadge: {
    position: 'absolute',
    right: 4,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
