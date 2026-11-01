import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import type { PilotTierId } from '../constants/pilot-standing';

const MEDAL_SRC: Record<PilotTierId, number> = {
  bronze: require('../assets/badges/medal-bronze.png'),
  silver: require('../assets/badges/medal-silver.png'),
  gold: require('../assets/badges/medal-gold.png'),
  platinum: require('../assets/badges/medal-platinum.png'),
};

/** Real metallic badge art (same medals as HAUL Cargo Agents). */
export function PilotTierMedal({ id, width = 48 }: { id: PilotTierId; width?: number }) {
  const height = Math.round((width * 156) / 128);
  return (
    <View style={[styles.wrap, { width, height }]} accessibilityLabel={`${id} medal`}>
      <Image source={MEDAL_SRC[id]} style={{ width, height }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
