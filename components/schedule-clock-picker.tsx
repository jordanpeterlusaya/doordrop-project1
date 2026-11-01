import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  buildScheduleTimeSlots,
  formatScheduleTimeValue,
  parseScheduleTime,
  snapScheduleTime,
} from '@/lib/schedule-delivery';

type Props = {
  value: string;
  isoDate: string;
  language: 'sw' | 'en';
  onChange: (nextValue: string) => void;
};

export type ScheduleClockPickerHandle = {
  getValue: () => string;
};

const ITEM_HEIGHT = 52;
const VISIBLE_ROWS = 5;
const PAD = ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2);
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const HOUR_ITEMS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((item) => ({
  key: `h-${item}`,
  label: String(item).padStart(2, '0'),
  value: item,
}));
const MINUTE_ITEMS = [0, 30].map((item) => ({
  key: `m-${item}`,
  label: String(item).padStart(2, '0'),
  value: item,
}));

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function indexFromOffset(offsetY: number, length: number) {
  return clampIndex(Math.round(offsetY / ITEM_HEIGHT), length);
}

function WheelColumn({
  items,
  selectedValue,
  fadedValues,
  onCenterChange,
  onSelect,
  width,
}: {
  items: { key: string; label: string; value: number }[];
  selectedValue: number;
  fadedValues?: Set<number>;
  onCenterChange: (value: number) => void;
  onSelect: (value: number) => void;
  width: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const placedRef = useRef(false);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === selectedValue)
  );

  const placeAt = useCallback(
    (index: number, animated: boolean) => {
      scrollRef.current?.scrollTo({ y: clampIndex(index, items.length) * ITEM_HEIGHT, animated });
    },
    [items.length]
  );

  const readOffset = (offsetY: number, commit: boolean) => {
    const index = indexFromOffset(offsetY, items.length);
    const next = items[index];
    if (!next) {
      return;
    }
    onCenterChange(next.value);
    if (commit) {
      placeAt(index, true);
      onSelect(next.value);
    }
  };

  return (
    <View style={[styles.wheelCol, { width }]} collapsable={false}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        nestedScrollEnabled
        overScrollMode="never"
        bounces
        scrollEventThrottle={16}
        onLayout={(event) => {
          if (placedRef.current || event.nativeEvent.layout.height < WHEEL_HEIGHT - 1) {
            return;
          }
          placedRef.current = true;
          placeAt(selectedIndex, false);
          requestAnimationFrame(() => placeAt(selectedIndex, false));
        }}
        onScroll={(event) => readOffset(event.nativeEvent.contentOffset.y, false)}
        onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          readOffset(event.nativeEvent.contentOffset.y, true);
        }}
        onScrollEndDrag={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          if (Math.abs(event.nativeEvent.velocity?.y ?? 0) < 0.05) {
            readOffset(event.nativeEvent.contentOffset.y, true);
          }
        }}>
        <View style={{ height: PAD }} />
        {items.map((item) => {
          const selected = item.value === selectedValue;
          return (
            <View key={item.key} style={styles.wheelItem}>
              <Text
                style={[
                  styles.wheelLabel,
                  selected && styles.wheelLabelSelected,
                  fadedValues?.has(item.value) && !selected && styles.wheelLabelFaded,
                ]}>
                {item.label}
              </Text>
            </View>
          );
        })}
        <View style={{ height: PAD }} />
      </ScrollView>
    </View>
  );
}

export const ScheduleClockPicker = forwardRef<ScheduleClockPickerHandle, Props>(function ScheduleClockPicker(
  { value, isoDate, language, onChange },
  ref
) {
  const slots = useMemo(() => buildScheduleTimeSlots(isoDate, language), [isoDate, language]);
  const initial = snapScheduleTime(isoDate, value, language) || '08:00';
  const parsed = parseScheduleTime(initial);
  const [hour, setHour] = useState(() => {
    const next = parsed.hour24;
    return HOUR_ITEMS.some((item) => item.value === next) ? next : 8;
  });
  const [minute, setMinute] = useState(() => (parsed.minute >= 30 ? 30 : 0));
  const hourRef = useRef(hour);
  const minuteRef = useRef(minute);
  hourRef.current = hour;
  minuteRef.current = minute;

  const emit = (nextHour: number, nextMinute: number) => {
    hourRef.current = nextHour;
    minuteRef.current = nextMinute;
    setHour(nextHour);
    setMinute(nextMinute);
    onChange(formatScheduleTimeValue(nextHour, nextMinute));
  };

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => formatScheduleTimeValue(hourRef.current, minuteRef.current),
    }),
    []
  );

  const fadedHours = useMemo(() => {
    const next = new Set<number>();
    for (const item of HOUR_ITEMS) {
      if (!slots.some((slot) => !slot.disabled && parseScheduleTime(slot.value).hour24 === item.value)) {
        next.add(item.value);
      }
    }
    return next;
  }, [slots]);

  const fadedMinutes = useMemo(() => {
    const next = new Set<number>();
    for (const item of MINUTE_ITEMS) {
      if (!slots.some((slot) => !slot.disabled && slot.value === formatScheduleTimeValue(hour, item.value))) {
        next.add(item.value);
      }
    }
    return next;
  }, [hour, slots]);

  const preview =
    slots.find((slot) => slot.value === formatScheduleTimeValue(hour, minute))?.label ??
    formatScheduleTimeValue(hour, minute);

  return (
    <View style={styles.wrap}>
      <Text style={styles.preview}>{preview}</Text>
      <View style={styles.wheels}>
        <View style={styles.highlight} pointerEvents="none" />
        <View style={styles.row}>
          <WheelColumn
            width={110}
            items={HOUR_ITEMS}
            selectedValue={hour}
            fadedValues={fadedHours}
            onCenterChange={(next) => {
              hourRef.current = next;
            }}
            onSelect={(next) => emit(next, minuteRef.current)}
          />
          <Text style={styles.colon}>:</Text>
          <WheelColumn
            width={110}
            items={MINUTE_ITEMS}
            selectedValue={minute}
            fadedValues={fadedMinutes}
            onCenterChange={(next) => {
              minuteRef.current = next;
            }}
            onSelect={(next) => emit(hourRef.current, next)}
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  preview: {
    marginBottom: 18,
    fontSize: 34,
    lineHeight: 40,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.6,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  wheels: {
    height: WHEEL_HEIGHT,
    width: '100%',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: WHEEL_HEIGHT,
  },
  highlight: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: (WHEEL_HEIGHT - ITEM_HEIGHT) / 2,
    height: ITEM_HEIGHT,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
  },
  colon: {
    width: 16,
    textAlign: 'center',
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
  },
  wheelCol: {
    height: WHEEL_HEIGHT,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelLabel: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.medium,
    color: '#9CA3AF',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  wheelLabelSelected: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
  },
  wheelLabelFaded: {
    color: '#D1D5DB',
  },
});
