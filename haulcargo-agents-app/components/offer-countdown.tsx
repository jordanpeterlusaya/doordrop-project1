import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { formatCountdown, offerExpiresMs } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';

export function OfferCountdown({ shipment, compact }: { shipment: CarrierShipment; compact?: boolean }) {
  const [left, setLeft] = useState(() => offerExpiresMs(shipment) - Date.now());

  const expiresAt = offerExpiresMs(shipment);

  useEffect(() => {
    const tick = () => setLeft(expiresAt - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = left <= 0;
  const urgent = left > 0 && left <= 60000;

  if (compact) {
    return (
      <Text style={[styles.compact, urgent && styles.compactUrgent, expired && styles.compactExpired]}>
        {expired ? 'Muda umeisha' : formatCountdown(left)}
      </Text>
    );
  }

  return (
    <View style={[styles.box, urgent && styles.urgent, expired && styles.expired]}>
      <Text style={styles.label}>{expired ? 'Muda umeisha' : 'Muda wa kukubali'}</Text>
      <Text style={styles.time}>{expired ? '0:00' : formatCountdown(left)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.accentSoft,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.accent,
  },
  urgent: { borderColor: theme.warning, backgroundColor: '#FFFBEB' },
  expired: { borderColor: theme.muted, backgroundColor: theme.tile },
  label: {
    fontSize: 12,
    color: theme.muted,
    fontFamily: typography.semibold,
  },
  time: {
    fontSize: 28,
    fontFamily: typography.bold,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  compact: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  compactUrgent: { color: theme.warning },
  compactExpired: { color: theme.muted },
});
