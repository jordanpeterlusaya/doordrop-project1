import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/constants/theme';
import { formatCountdown, offerExpiresMs } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';

export function OfferCountdown({ shipment }: { shipment: CarrierShipment }) {
  const [left, setLeft] = useState(() => offerExpiresMs(shipment) - Date.now());

  useEffect(() => {
    const tick = () => setLeft(offerExpiresMs(shipment) - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shipment]);

  const expired = left <= 0;
  const urgent = left > 0 && left <= 60000;

  return (
    <View style={[styles.box, urgent && styles.urgent, expired && styles.expired]}>
      <Text style={styles.label}>{expired ? 'Muda umeisha' : 'Muda wa kukubali'}</Text>
      <Text style={styles.time}>{expired ? '0:00' : formatCountdown(left)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#ecfdf5',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  urgent: { borderColor: theme.warning, backgroundColor: '#fefce8' },
  expired: { borderColor: theme.muted, backgroundColor: '#f5f5f4' },
  label: { fontSize: 12, color: theme.muted, fontWeight: '600' },
  time: { fontSize: 28, fontWeight: '800', color: theme.green, fontVariant: ['tabular-nums'] },
});
