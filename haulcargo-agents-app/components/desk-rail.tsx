import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { deskIndex } from '@/lib/carrier-helpers';
import { DESK_RAIL, type CarrierShipment } from '@/lib/carrier-types';

export function DeskRail({ item }: { item: CarrierShipment }) {
  const current = deskIndex(item);
  return (
    <View style={styles.row}>
      {DESK_RAIL.map((step, index) => {
        const done = current > index;
        const active = current === index;
        return (
          <View key={step.key} style={styles.step}>
            <View style={styles.track}>
              <View style={[styles.line, index === 0 && styles.lineHidden, (done || active) && styles.lineOn]} />
              <View style={[styles.dot, (done || active) && styles.dotOn, active && styles.dotActive]} />
              <View
                style={[
                  styles.line,
                  index === DESK_RAIL.length - 1 && styles.lineHidden,
                  done && styles.lineOn,
                ]}
              />
            </View>
            <Text style={[styles.label, (done || active) && styles.labelOn]} numberOfLines={2}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 16 },
  step: { flex: 1, alignItems: 'center' },
  track: { flexDirection: 'row', alignItems: 'center', height: 16, alignSelf: 'stretch' },
  line: { flex: 1, height: 2, backgroundColor: theme.line },
  lineOn: { backgroundColor: theme.ink },
  lineHidden: { backgroundColor: 'transparent' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.line,
  },
  dotOn: { backgroundColor: theme.ink },
  dotActive: { width: 12, height: 12, borderRadius: 6 },
  label: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
    color: theme.muted,
  },
  labelOn: { fontFamily: typography.semibold, color: theme.ink },
});
