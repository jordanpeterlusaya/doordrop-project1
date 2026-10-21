import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { theme } from '@/constants/theme';
import { openPickupMaps, pickupNavigateUrl } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';

type Props = {
  item: CarrierShipment;
  /** Smaller hit target for the incoming sheet so it stays under the tier row. */
  compact?: boolean;
};

/** Icon only. Opens navigation to the pickup pin, or maps search of the pickup address. */
export function PickupDirectionButton({ item, compact = false }: Props) {
  if (!pickupNavigateUrl(item)) return null;
  const dim = compact ? 36 : 44;
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation?.();
        void openPickupMaps(item);
      }}
      accessibilityRole="button"
      accessibilityLabel="Kufuata mzigo"
      hitSlop={6}
      style={[styles.btn, { width: dim, height: dim, borderRadius: dim / 2 }]}>
      <Ionicons name="navigate" size={compact ? 18 : 22} color={theme.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
