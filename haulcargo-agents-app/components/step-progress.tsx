import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

type Props = {
  steps: readonly string[];
  /** Zero-based active step index. */
  active: number;
};

export function StepProgress({ steps, active }: Props) {
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.wrap} accessibilityRole="progressbar">
      <View style={styles.track}>
        {steps.map((label, index) => {
          const done = index < active;
          const current = index === active;
          return (
            <View key={label} style={styles.item}>
              <View
                style={[
                  styles.dot,
                  (done || current) && styles.dotActive,
                  done && styles.dotDone,
                ]}>
                <Text style={[styles.dotText, (done || current) && styles.dotTextOn]}>
                  {done ? '✓' : String(index + 1)}
                </Text>
              </View>
              <Text style={[styles.label, current && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
              {index < steps.length - 1 ? (
                <View style={[styles.connector, done && styles.connectorOn]} />
              ) : null}
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  item: { flex: 1, alignItems: 'center', position: 'relative' },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  dotActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  dotDone: { borderColor: theme.accent, backgroundColor: theme.accent },
  dotText: { fontFamily: typography.bold, fontSize: 11, color: theme.muted },
  dotTextOn: { color: theme.accent },
  label: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 11,
    color: theme.muted,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  labelOn: { fontFamily: typography.semibold, color: theme.ink },
  connector: {
    position: 'absolute',
    top: 12,
    left: '55%',
    right: '-45%',
    height: 1.5,
    backgroundColor: theme.border,
    zIndex: 0,
  },
  connectorOn: { backgroundColor: theme.accent },
});
