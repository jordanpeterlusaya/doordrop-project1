import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  EXPRESS_CLOSING_SOON_MINUTES,
  formatExpressBookingCountdown,
  getBookableExpressDepartures,
  pickExpressNextDayFallbackSlot,
  type BookableExpressDeparture,
  type OutsideExpressRouteSchedule,
} from '@/lib/outside-express-schedule';

type Props = {
  language: 'sw' | 'en';
  route: OutsideExpressRouteSchedule;
  selectedDepartureId?: string | null;
  firstMileMinutes?: number;
  compactSelected?: boolean;
  loading?: boolean;
  onSelect: (slot: BookableExpressDeparture) => void;
  onChangeFlight?: () => void;
};

function renderOpenSlotCard(params: {
  slot: BookableExpressDeparture;
  language: 'sw' | 'en';
  nowMs: number;
  active: boolean;
  onSelect: (slot: BookableExpressDeparture) => void;
  highlight?: 'next-day';
}) {
  const { slot, language, nowMs, active, onSelect, highlight } = params;
  const countdownMs = Math.max(0, slot.bookingClosesAtMs - nowMs);

  return (
    <Pressable
      key={slot.departureId}
      accessibilityRole="button"
      onPress={() => onSelect(slot)}
      style={({ pressed }) => [
        styles.slotCard,
        active && styles.slotCardActive,
        slot.status === 'closing' && styles.slotCardClosing,
        highlight === 'next-day' && styles.slotCardNextDay,
        pressed && styles.slotCardPressed,
      ]}>
      {highlight === 'next-day' ? (
        <View style={styles.nextDayBanner}>
          <MaterialCommunityIcons name="calendar-arrow-right" size={14} color="#0369A1" />
          <Text style={styles.nextDayBannerText}>
            {language === 'sw' ? 'Ndege inayofuata — kesho' : 'Next available flight — tomorrow'}
          </Text>
        </View>
      ) : null}
      <View style={styles.slotTop}>
        <View style={styles.slotTimeWrap}>
          <MaterialCommunityIcons
            name="airplane-takeoff"
            size={16}
            color={active ? cargoTheme.colors.primaryDark : '#0369A1'}
          />
          <Text style={[styles.slotTime, active && styles.slotTimeActive]}>{slot.timeLabel}</Text>
        </View>
        <View
          style={[
            styles.statusPill,
            slot.status === 'closing' ? styles.statusPillClosing : styles.statusPillOpen,
          ]}>
          <Text
            style={[styles.statusPillText, slot.status === 'closing' && styles.statusPillTextClosing]}>
            {slot.status === 'closing'
              ? language === 'sw'
                ? `Haraka · ${EXPRESS_CLOSING_SOON_MINUTES}dk`
                : `Closing · ${EXPRESS_CLOSING_SOON_MINUTES}m`
              : language === 'sw'
                ? 'Wazi'
                : 'Open'}
          </Text>
        </View>
      </View>
      <View style={styles.fomoTimer}>
        <MaterialCommunityIcons name="timer-outline" size={16} color="#B45309" />
        <Text style={styles.fomoTimerText}>
          {formatExpressBookingCountdown(countdownMs, language, slot.bookingClosesAtMs)}
        </Text>
      </View>
    </Pressable>
  );
}

function groupSlotsByDay(slots: BookableExpressDeparture[]) {
  const groups: Array<{ dayLabel: string; isoDate: string; slots: BookableExpressDeparture[] }> = [];
  slots.forEach((slot) => {
    const existing = groups.find((group) => group.isoDate === slot.isoDate);
    if (existing) {
      existing.slots.push(slot);
      return;
    }
    groups.push({ dayLabel: slot.dayLabel, isoDate: slot.isoDate, slots: [slot] });
  });
  return groups;
}

export function OutsideExpressFlightPicker({
  language,
  route,
  selectedDepartureId,
  firstMileMinutes,
  compactSelected = false,
  loading = false,
  onSelect,
  onChangeFlight,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSelect = (slot: BookableExpressDeparture) => {
    void Haptics.selectionAsync();
    onSelect(slot);
  };

  const slots = useMemo(
    () => getBookableExpressDepartures({ route, language, firstMileMinutes, nowMs }),
    [firstMileMinutes, language, nowMs, route]
  );
  const selectedSlot = slots.find((slot) => slot.departureId === selectedDepartureId && slot.bookable) ?? null;
  const groupedSlots = useMemo(() => groupSlotsByDay(slots), [slots]);
  const nextDayFallback = useMemo(() => pickExpressNextDayFallbackSlot(slots, nowMs), [nowMs, slots]);
  const visibleGroups = useMemo(() => {
    if (nextDayFallback) {
      // Today is closed/empty — only the next-day highlight card below should show.
      return [];
    }
    return groupedSlots;
  }, [groupedSlots, nextDayFallback]);
  if (loading) {
    return (
      <View style={styles.wrap}>
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
      </View>
    );
  }

  if (compactSelected && selectedSlot) {
    const countdownMs = Math.max(0, selectedSlot.bookingClosesAtMs - nowMs);
    return (
      <View style={styles.selectedSummary}>
        <View style={styles.selectedSummaryTop}>
          <MaterialCommunityIcons name="airplane-check" size={18} color={cargoTheme.colors.primaryDark} />
          <View style={styles.selectedSummaryCopy}>
            <Text style={styles.selectedSummaryTitle}>
              {selectedSlot.dayLabel} · {selectedSlot.timeLabel}
            </Text>
          </View>
          {onChangeFlight ? (
            <Pressable accessibilityRole="button" onPress={onChangeFlight} style={styles.changeFlightButton}>
              <Text style={styles.changeFlightText}>{language === 'sw' ? 'Badilisha' : 'Change'}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.fomoTimer}>
          <MaterialCommunityIcons name="timer-outline" size={16} color="#B45309" />
          <Text style={styles.fomoTimerText}>
            {formatExpressBookingCountdown(countdownMs, language, selectedSlot.bookingClosesAtMs)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {!slots.length ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="calendar-remove" size={24} color="#94A3B8" />
          <Text style={styles.emptyTitle}>
            {language === 'sw' ? 'Hakuna ratiba ya ndege bado' : 'No flight schedule yet'}
          </Text>
          <Text style={styles.emptyText}>
            {language === 'sw'
              ? 'Admin bado haijaweka ratiba ya siku kwa route hii.'
              : 'Daily schedules for this route have not been published yet.'}
          </Text>
        </View>
      ) : (
        <>
          {visibleGroups.map((group) => (
            <View key={group.isoDate} style={styles.dayGroup}>
              <Text style={styles.dayHeading}>{group.dayLabel}</Text>
              <View style={styles.slotList}>
                {group.slots.map((slot) => {
                  const active = selectedDepartureId === slot.departureId;
                  const closed = !slot.bookable;

                  if (closed) {
                    return (
                      <View key={slot.departureId} style={styles.closedCard} accessibilityState={{ disabled: true }}>
                        <View style={styles.slotTop}>
                          <View style={styles.slotTimeWrap}>
                            <MaterialCommunityIcons name="airplane-remove" size={16} color="#DC2626" />
                            <Text style={styles.closedTime}>{slot.timeLabel}</Text>
                          </View>
                          <View style={styles.closedPill}>
                            <Text style={styles.closedPillText}>
                              {language === 'sw' ? 'Imefungwa' : 'Closed'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.closedStrike} />
                      </View>
                    );
                  }

                  if (nextDayFallback && slot.departureId === nextDayFallback.departureId) {
                    return null;
                  }

                  return (
                    <React.Fragment key={slot.departureId}>
                      {renderOpenSlotCard({
                        slot,
                        language,
                        nowMs,
                        active,
                        onSelect: handleSelect,
                      })}
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          ))}

          {nextDayFallback ? (
            <View style={styles.dayGroup}>
              <Text style={styles.dayHeading}>{nextDayFallback.dayLabel}</Text>
              {renderOpenSlotCard({
                slot: nextDayFallback,
                language,
                nowMs,
                active: selectedDepartureId === nextDayFallback.departureId,
                onSelect: handleSelect,
                highlight: 'next-day',
              })}
            </View>
          ) : null}
        </>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#1E3A8A',
  },
  dayGroup: {
    gap: 8,
  },
  dayHeading: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.bold,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slotList: {
    gap: 10,
  },
  slotCard: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  slotCardActive: {
    borderColor: '#E8EEF3',
    backgroundColor: '#FFFFFF',
  },
  slotCardClosing: {
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  slotCardNextDay: {
    borderColor: '#7DD3FC',
    backgroundColor: '#F0F9FF',
  },
  nextDayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 2,
  },
  nextDayBannerText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: '#0369A1',
  },
  slotCardPressed: {
    opacity: 0.92,
  },
  closedCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  closedStrike: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: '52%',
    height: 2,
    backgroundColor: '#DC2626',
    opacity: 0.85,
  },
  slotTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  slotTimeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slotTime: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: typography.extrabold,
    color: '#0F172A',
  },
  slotTimeActive: {
    color: cargoTheme.colors.primaryDark,
  },
  closedTime: {
    fontSize: 18,
    lineHeight: 22,
    fontFamily: typography.extrabold,
    color: '#991B1B',
    textDecorationLine: 'line-through',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillOpen: {
    backgroundColor: '#FFE500',
  },
  statusPillClosing: {
    backgroundColor: '#FEF3C7',
  },
  statusPillText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.bold,
    color: '#111827',
    textTransform: 'uppercase',
  },
  statusPillTextClosing: {
    color: '#B45309',
  },
  closedPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FEE2E2',
  },
  closedPillText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.bold,
    color: '#DC2626',
    textTransform: 'uppercase',
  },
  slotSummary: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#334155',
  },
  closedSummary: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#991B1B',
    textDecorationLine: 'line-through',
  },
  closedFomo: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.medium,
    color: '#B45309',
  },
  slotMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.body,
    color: '#64748B',
  },
  fomoTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  fomoTimerText: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: '#B45309',
  },
  selectedSummary: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EEF3',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  selectedSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedSummaryCopy: {
    flex: 1,
    gap: 2,
  },
  selectedSummaryTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  selectedSummaryMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
  },
  changeFlightButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  changeFlightText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  skeletonCard: {
    height: 88,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: '#0F172A',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#64748B',
    textAlign: 'center',
  },
  noOpenHint: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
    textAlign: 'center',
  },
});
