import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { getActiveOrderHeadline, getActiveOrderProgress } from '@/lib/active-order-display';
import type { DeliveryOrder } from '@/lib/delivery-data';

type Props = {
  order: DeliveryOrder;
  language: 'en' | 'sw';
  extraCount?: number;
  scheduleLabel: string;
  onPress: () => void;
  onSchedulePress: () => void;
};

export function HomeActiveOrderCard({
  order,
  language,
  extraCount = 1,
  scheduleLabel,
  onPress,
  onSchedulePress,
}: Props) {
  const headline = useMemo(() => getActiveOrderHeadline(order, language), [language, order]);
  const steps = useMemo(() => getActiveOrderProgress(order, language), [language, order]);
  const progress = useMemo(() => {
    if (!steps.length) return 0;
    const reached = steps.filter((step) => step.state === 'done' || step.state === 'current').length;
    return Math.min(1, reached / steps.length);
  }, [steps]);

  const meta =
    extraCount > 1
      ? language === 'sw'
        ? `${extraCount} oda`
        : `${extraCount} orders`
      : language === 'sw'
        ? 'Fuatilia'
        : 'Track';

  return (
    <View style={styles.strip}>
      <TouchableOpacity
        style={styles.track}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`${headline}. ${meta}`}
        onPress={onPress}>
        <View style={styles.liveDot} />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.headline}>
            {headline}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(12, progress * 100)}%` }]} />
          </View>
        </View>
        <Text style={styles.meta}>{meta}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color="#111827" />
      </TouchableOpacity>
      <View style={styles.divider} />
      <TouchableOpacity
        style={styles.schedule}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={scheduleLabel}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        onPress={onSchedulePress}>
        <Ionicons name="time-outline" size={16} color="#111827" />
        <Text style={styles.scheduleLabel}>{scheduleLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: 56,
    marginTop: 2,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  copy: {
    flex: 1,
    gap: 6,
  },
  headline: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  barTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.primary,
  },
  meta: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: '#6B7280',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: '#D1D5DB',
  },
  schedule: {
    width: 62,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  scheduleLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.semibold,
    color: '#111827',
  },
});
