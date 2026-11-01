import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import {
  buildScheduleTimeSlots,
  formatScheduleDateField,
  formatScheduleDateHeading,
  formatScheduleMonthLabel,
  formatScheduleSummary,
  snapScheduleTime,
  toIsoDate,
  type ScheduleDayOption,
} from '@/lib/schedule-delivery';
import { ScheduleClockPicker, type ScheduleClockPickerHandle } from '@/components/schedule-clock-picker';

type AppRoute = '/send-parcel' | '/book-cargo' | '/ninunulie';

export type ScheduleSheetOption = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  image?: ImageSourcePropType;
  imageScale?: number;
  route: AppRoute;
};

export type ScheduleSheetCopy = {
  title: string;
  subtitle: string;
  cancel: string;
  back: string;
  stepService: string;
  stepWhen: string;
  pickTime: string;
  selectTime: string;
  selectTimeTitle: string;
  selectTimeHint: string;
  timeDone: string;
  noSlots: string;
  continue: string;
  confirm: string;
  smartHint: string;
  selectDate: string;
  okDate: string;
  departureDate: string;
  departureTime: string;
  whenPlaceholder: string;
};

type ScheduleDeliverySheetProps = {
  visible: boolean;
  step: 'service' | 'when';
  copy: ScheduleSheetCopy;
  options: ScheduleSheetOption[];
  selectedRoute: AppRoute | null;
  scheduleDays: ScheduleDayOption[];
  selectedDate: string;
  selectedTime: string;
  hasAvailableSlots: boolean;
  canContinue: boolean;
  language: 'sw' | 'en';
  /** When 'page', renders as a full screen (no modal/backdrop). */
  presentation?: 'modal' | 'page';
  onClose: () => void;
  onBack: () => void;
  onSelectRoute: (route: AppRoute) => void;
  onStartWhen: () => void;
  onSelectDate: (isoDate: string) => void;
  onSelectTime: (value: string) => void;
  onContinue: () => void;
};

const weekdayHeaders = {
  sw: ['Jp', 'Jt', 'Jn', 'Jtn', 'Al', 'Ij', 'Jm'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
} as const;

const CALENDAR_ACCENT = cargoTheme.colors.primary;
const CALENDAR_ON_ACCENT = cargoTheme.colors.onPrimary;

function isoFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMonthCells(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return { year, month, cells };
}

function ServiceOptionCard({
  option,
  selected,
  onPress,
}: {
  option: ScheduleSheetOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.serviceCard, selected && styles.serviceCardSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      android_disableSound
      onPressIn={onPress}>
      <View style={[styles.serviceAvatarWell, selected && styles.serviceAvatarWellSelected]}>
        {option.image ? (
          <Image
            source={option.image}
            style={[styles.serviceAvatar, option.imageScale ? { transform: [{ scale: option.imageScale }] } : null]}
            resizeMode="contain"
          />
        ) : (
          <MaterialCommunityIcons name={option.icon} size={22} color={cargoTheme.colors.primaryDark} />
        )}
      </View>
      <View style={styles.serviceCopy}>
        <Text style={styles.serviceTitle} numberOfLines={1}>
          {option.title}
        </Text>
        <Text style={styles.serviceSubtitle} numberOfLines={2}>
          {option.subtitle}
        </Text>
      </View>
      <View style={[styles.serviceCheck, selected && styles.serviceCheckSelected]}>
        {selected ? (
          <MaterialCommunityIcons name="check" size={16} color={cargoTheme.colors.primaryDark} />
        ) : (
          <MaterialCommunityIcons name="chevron-right" size={18} color="#D1D5DB" />
        )}
      </View>
    </Pressable>
  );
}

function ScheduleCalendarModal({
  visible,
  days,
  selectedDate,
  language,
  copy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  days: ScheduleDayOption[];
  selectedDate: string;
  language: 'sw' | 'en';
  copy: ScheduleSheetCopy;
  onClose: () => void;
  onConfirm: (isoDate: string) => void;
}) {
  const allowed = useMemo(
    () =>
      new Set(
        days
          .filter((day) => buildScheduleTimeSlots(day.isoDate, language).some((slot) => !slot.disabled))
          .map((day) => day.isoDate)
      ),
    [days, language]
  );
  const fallbackDate = selectedDate || days[0]?.isoDate || toIsoDate(new Date());
  const [draftDate, setDraftDate] = useState(fallbackDate);
  const [visibleMonth, setVisibleMonth] = useState(fallbackDate);

  useEffect(() => {
    if (visible) {
      const next = selectedDate || days[0]?.isoDate || toIsoDate(new Date());
      setDraftDate(next);
      setVisibleMonth(next);
    }
  }, [days, selectedDate, visible]);

  const { year, month, cells } = useMemo(() => buildMonthCells(visibleMonth), [visibleMonth]);
  const headers = weekdayHeaders[language];
  const heading = formatScheduleDateHeading(draftDate, language);
  const monthLabel = formatScheduleMonthLabel(visibleMonth, language);

  const canShiftMonth = (delta: number) => {
    const cursor = new Date(`${visibleMonth}T00:00:00`);
    cursor.setMonth(cursor.getMonth() + delta, 1);
    const prefix = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    return days.some((day) => day.isoDate.startsWith(prefix));
  };

  const shiftMonth = (delta: number) => {
    if (!canShiftMonth(delta)) {
      return;
    }
    const cursor = new Date(`${visibleMonth}T00:00:00`);
    cursor.setMonth(cursor.getMonth() + delta, 1);
    setVisibleMonth(toIsoDate(cursor));
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.calendarModalRoot}>
        <Pressable style={styles.calendarBackdrop} onPress={onClose} />
        <View style={styles.calendarCard}>
          <View style={styles.calendarAccent}>
            <Text style={styles.calendarAccentKicker}>{copy.selectDate}</Text>
            <View style={styles.calendarAccentRow}>
              <Text style={styles.calendarAccentTitle} numberOfLines={1}>
                {heading}
              </Text>
              <MaterialCommunityIcons name="pencil-outline" size={20} color={CALENDAR_ON_ACCENT} />
            </View>
          </View>

          <View style={styles.calendarBody}>
            <View style={styles.calendarMonthRow}>
              <Text style={styles.calendarMonth}>{monthLabel}</Text>
              <View style={styles.calendarMonthNav}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!canShiftMonth(-1)}
                  onPress={() => shiftMonth(-1)}
                  style={[styles.calendarNavButton, !canShiftMonth(-1) && styles.calendarNavDisabled]}>
                  <MaterialCommunityIcons name="chevron-left" size={22} color="#111827" />
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!canShiftMonth(1)}
                  onPress={() => shiftMonth(1)}
                  style={[styles.calendarNavButton, !canShiftMonth(1) && styles.calendarNavDisabled]}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#111827" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.calendarWeekRow}>
              {headers.map((label, index) => (
                <Text key={`${label}-${index}`} style={styles.calendarWeekday}>
                  {label}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {cells.map((day, index) => {
                if (!day) {
                  return <View key={`empty-${index}`} style={styles.calendarCell} />;
                }

                const isoDate = isoFromParts(year, month, day);
                const enabled = allowed.has(isoDate);
                const selected = draftDate === isoDate;
                return (
                  <TouchableOpacity
                    key={isoDate}
                    style={styles.calendarCell}
                    activeOpacity={0.85}
                    disabled={!enabled}
                    onPress={() => setDraftDate(isoDate)}>
                    <View style={[styles.calendarDayChip, selected && styles.calendarDayChipSelected]}>
                      <Text
                        style={[
                          styles.calendarDayNumber,
                          !enabled && styles.calendarDayDisabled,
                          selected && styles.calendarDaySelected,
                        ]}>
                        {day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.calendarActions}>
              <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.calendarAction}>
                <Text style={styles.calendarActionText}>{copy.cancel}</Text>
              </TouchableOpacity>
              <Pressable
                accessibilityRole="button"
                android_disableSound
                onPressIn={() => onConfirm(draftDate)}
                style={styles.calendarAction}>
                <Text style={styles.calendarActionText}>{copy.okDate}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ScheduleTimePickerSheet({
  visible,
  copy,
  isoDate,
  language,
  value,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  copy: ScheduleSheetCopy;
  isoDate: string;
  language: 'sw' | 'en';
  value: string;
  onClose: () => void;
  onConfirm: (nextValue: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const pickerRef = useRef<ScheduleClockPickerHandle>(null);
  const draftRef = useRef(value);
  const [draftTime, setDraftTime] = useState(() => snapScheduleTime(isoDate, value, language));

  useEffect(() => {
    if (!visible) {
      return;
    }
    const next = snapScheduleTime(isoDate, value, language);
    draftRef.current = next;
    setDraftTime(next);
  }, [isoDate, language, value, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, visible]);

  const persistDraft = (nextValue: string) => {
    draftRef.current = nextValue;
    setDraftTime(nextValue);
  };

  const confirmTime = () => {
    const fromWheel = pickerRef.current?.getValue() ?? '';
    const next = snapScheduleTime(isoDate, fromWheel || draftRef.current || value, language);
    if (!next) {
      return;
    }
    persistDraft(next);
    onConfirm(next);
  };

  const canSave = Boolean(snapScheduleTime(isoDate, draftTime || value, language));

  if (!visible) {
    return null;
  }

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        styles.timePage,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
      pointerEvents="auto"
      collapsable={false}>
      <TouchableOpacity
        style={styles.timeBack}
        activeOpacity={0.88}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={copy.back}>
        <MaterialCommunityIcons name="arrow-left" size={22} color="#111827" />
      </TouchableOpacity>
      <Text style={styles.timeTitle}>{copy.selectTimeTitle}</Text>
      <Text style={styles.timeHint}>{copy.selectTimeHint}</Text>

      <View style={styles.timeWheelWell} collapsable={false}>
        {isoDate ? (
          <ScheduleClockPicker
            ref={pickerRef}
            key={`${isoDate}-open`}
            value={value}
            isoDate={isoDate}
            language={language}
            onChange={persistDraft}
          />
        ) : null}
      </View>

      <Pressable
        style={[styles.timeDoneButton, !canSave && styles.confirmButtonDisabled]}
        android_disableSound
        disabled={!canSave}
        onPressIn={() => {
          if (canSave) {
            confirmTime();
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={copy.timeDone}>
        <Text style={styles.timeDoneText}>{copy.timeDone}</Text>
      </Pressable>
    </View>
  );
}

export function ScheduleDeliverySheet({
  visible,
  step,
  copy,
  options,
  selectedRoute,
  scheduleDays,
  selectedDate,
  selectedTime,
  hasAvailableSlots,
  canContinue,
  language,
  presentation = 'modal',
  onClose,
  onBack,
  onSelectRoute,
  onStartWhen,
  onSelectDate,
  onSelectTime,
  onContinue,
}: ScheduleDeliverySheetProps) {
  const insets = useSafeAreaInsets();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const isPage = presentation === 'page';

  const selectedOption = useMemo(
    () => options.find((option) => option.route === selectedRoute) ?? null,
    [options, selectedRoute]
  );

  const scheduleSummary = useMemo(
    () => formatScheduleSummary(selectedDate, selectedTime, language),
    [language, selectedDate, selectedTime]
  );

  const selectedTimeLabel = useMemo(() => {
    if (!selectedDate || !selectedTime) {
      return '';
    }
    const slots = buildScheduleTimeSlots(selectedDate, language);
    return slots.find((slot) => slot.value === selectedTime)?.label ?? selectedTime;
  }, [language, selectedDate, selectedTime]);

  const dateFieldLabel = selectedDate ? formatScheduleDateField(selectedDate, language) : copy.selectDate;

  useEffect(() => {
    if (!visible) {
      setCalendarOpen(false);
      setTimePickerOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (step === 'when' && visible) {
      setCalendarOpen(true);
      setTimePickerOpen(false);
    }
  }, [step, visible]);

  const handleConfirmDate = (isoDate: string) => {
    onSelectDate(isoDate);
    setCalendarOpen(false);
    const hasSlots = buildScheduleTimeSlots(isoDate, language).some((slot) => !slot.disabled);
    if (hasSlots) {
      setTimeout(() => setTimePickerOpen(true), 280);
    } else {
      setTimePickerOpen(false);
    }
  };

  const handleConfirmSchedule = () => {
    if (!canContinue) {
      if (!selectedDate) {
        setTimePickerOpen(false);
        setCalendarOpen(true);
        return;
      }
      openTimePicker();
      return;
    }
    setCalendarOpen(false);
    setTimePickerOpen(false);
    onContinue();
  };

  const openTimePicker = () => {
    if (!selectedDate) {
      setTimePickerOpen(false);
      setCalendarOpen(true);
      return;
    }
    setCalendarOpen(false);
    setTimePickerOpen(true);
  };

  const sheetInner = (
    <View style={[styles.sheet, isPage && styles.sheetPage, step === 'when' && styles.sheetPlan]}>
      {!isPage && step === 'service' ? <View style={styles.handle} /> : null}

      {step === 'service' ? (
        <View style={styles.servicePage}>
          <View style={styles.serviceTopBar}>
            <TouchableOpacity
              style={styles.iconButton}
              activeOpacity={0.88}
              onPress={onClose}
              accessibilityLabel={copy.cancel}>
              <MaterialCommunityIcons name="arrow-left" size={20} color="#0F172A" />
            </TouchableOpacity>
            {!isPage ? (
              <TouchableOpacity style={styles.iconButton} activeOpacity={0.88} onPress={onClose} accessibilityLabel={copy.cancel}>
                <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconButtonSpacer} />
            )}
          </View>

          <View style={styles.serviceHero}>
            <View style={styles.serviceKicker}>
              <View style={styles.serviceKickerDot} />
              <Text style={styles.serviceKickerText}>{copy.stepService}</Text>
            </View>
            <Text style={styles.serviceHeroTitle}>{copy.title}</Text>
            <Text style={styles.serviceHeroSubtitle}>{copy.subtitle}</Text>
          </View>

          <ScrollView
            style={styles.scrollArea}
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.serviceList}>
            {options.map((option) => {
              const selected = option.route === selectedRoute;
              return (
                <ServiceOptionCard
                  key={option.key}
                  option={option}
                  selected={selected}
                  onPress={() => {
                    if (selected) {
                      onStartWhen();
                      return;
                    }
                    onSelectRoute(option.route);
                  }}
                />
              );
            })}
          </ScrollView>

          <View style={[styles.serviceFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.serviceFooterHint}>{copy.smartHint}</Text>
            <Pressable
              style={[styles.confirmButton, !selectedRoute && styles.confirmButtonDisabled]}
              android_disableSound
              disabled={!selectedRoute}
              onPressIn={() => {
                if (selectedRoute) {
                  onStartWhen();
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={copy.continue}>
              <Text style={styles.confirmButtonText}>{copy.continue}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.planPage}>
          <View style={styles.planHeader}>
            <TouchableOpacity
              style={styles.planBack}
              activeOpacity={0.88}
              onPress={onBack}
              accessibilityLabel={copy.back}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.planTitle}>{copy.title}</Text>
          </View>

          <View style={styles.stopBlock}>
            <View style={styles.stopRow}>
              <View style={styles.stopDot} />
              <Text style={styles.stopText} numberOfLines={1}>
                {selectedOption?.title ?? copy.stepService}
              </Text>
              <TouchableOpacity accessibilityRole="button" onPress={onBack} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
            <View style={styles.stopConnector} />
            <View style={styles.stopRow}>
              <MaterialCommunityIcons name="map-marker" size={18} color="#111827" />
              <Text style={styles.stopText} numberOfLines={1}>
                {selectedDate && selectedTime ? scheduleSummary : copy.whenPlaceholder}
              </Text>
            </View>
          </View>

          <View style={styles.departRow}>
            <Pressable
              style={styles.departField}
              android_disableSound
              accessibilityRole="button"
              accessibilityLabel={copy.departureDate}
              onPressIn={() => {
                setTimePickerOpen(false);
                setCalendarOpen(true);
              }}>
              <Text style={styles.departLabel}>{copy.departureDate}</Text>
              <View style={styles.departValueRow}>
                <MaterialCommunityIcons name="calendar-blank-outline" size={18} color="#111827" />
                <Text style={styles.departValue} numberOfLines={1}>
                  {dateFieldLabel}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.departField}
              android_disableSound
              accessibilityRole="button"
              accessibilityLabel={copy.departureTime}
              onPressIn={openTimePicker}>
              <Text style={styles.departLabel}>{copy.departureTime}</Text>
              <View style={styles.departValueRow}>
                <MaterialCommunityIcons name="clock-outline" size={18} color="#111827" />
                <Text style={styles.departValue} numberOfLines={1}>
                  {selectedTimeLabel || copy.selectTime}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color="#9CA3AF" />
              </View>
            </Pressable>
          </View>

          {!hasAvailableSlots ? <Text style={styles.emptySlotsText}>{copy.noSlots}</Text> : null}

          <View style={styles.planSpacer} />

          <View style={[styles.planFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable
              style={[styles.confirmButton, !canContinue && styles.confirmButtonDisabled]}
              android_disableSound
              onPressIn={handleConfirmSchedule}
              accessibilityRole="button"
              accessibilityLabel={copy.confirm}>
              <Text style={styles.confirmButtonText}>{copy.confirm}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );

  const pickers = (
    <>
      <ScheduleCalendarModal
        visible={calendarOpen && step === 'when' && Boolean(scheduleDays.length)}
        days={scheduleDays}
        selectedDate={selectedDate}
        language={language}
        copy={copy}
        onClose={() => setCalendarOpen(false)}
        onConfirm={handleConfirmDate}
      />

      <ScheduleTimePickerSheet
        visible={timePickerOpen && Boolean(selectedDate)}
        copy={copy}
        isoDate={selectedDate}
        language={language}
        value={selectedTime}
        onClose={() => setTimePickerOpen(false)}
        onConfirm={(nextValue) => {
          onSelectTime(nextValue);
          setTimePickerOpen(false);
        }}
      />
    </>
  );

  if (isPage) {
    if (!visible) {
      return null;
    }
    return (
      <View style={[styles.pageRoot, step === 'when' && styles.pageRootPlan]}>
        {sheetInner}
        {pickers}
      </View>
    );
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        {sheetInner}
        {pickers}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    position: 'relative',
    overflow: 'visible',
    backgroundColor: '#FFFFFF',
  },
  pageRootPlan: {
    backgroundColor: '#F4F4F5',
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxHeight: '78%',
    flexShrink: 1,
  },
  sheetPage: {
    flex: 1,
    maxHeight: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  sheetPlan: {
    backgroundColor: '#F4F4F5',
  },
  headerPage: {
    paddingTop: 8,
  },
  servicePage: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  serviceTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  serviceHero: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 8,
  },
  serviceKicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  serviceKickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
  },
  serviceKickerText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#6B7280',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  serviceHeroTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.8,
  },
  serviceHeroSubtitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: typography.body,
    color: '#6B7280',
    maxWidth: 320,
  },
  serviceList: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    gap: 0,
  },
  serviceFooter: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  serviceFooterHint: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#94A3B8',
    textAlign: 'center',
  },
  scrollArea: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonSpacer: {
    width: 34,
    height: 34,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
    textAlign: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '42%',
  },
  stepBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeActive: {
    backgroundColor: cargoTheme.colors.primarySoft,
  },
  stepBadgeDone: {
    backgroundColor: cargoTheme.colors.primarySoft,
  },
  stepBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  stepBadgeDotActive: {
    backgroundColor: cargoTheme.colors.primaryDark,
  },
  stepLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
    color: '#94A3B8',
  },
  stepLabelActive: {
    color: '#334155',
  },
  stepLine: {
    width: 28,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  sectionHint: {
    marginBottom: 10,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.body,
    color: '#64748B',
  },
  serviceCard: {
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E8EEF3',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  serviceCardSelected: {
    backgroundColor: cargoTheme.colors.primarySoft,
    borderColor: cargoTheme.colors.primary,
  },
  serviceAvatarWell: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 14,
  },
  serviceAvatarWellSelected: {
    borderColor: cargoTheme.colors.primary,
  },
  serviceAvatar: {
    width: 44,
    height: 44,
  },
  serviceCopy: {
    flex: 1,
    minWidth: 0,
  },
  serviceTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: typography.ident,
    color: '#111827',
    letterSpacing: -0.3,
  },
  serviceSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#64748B',
  },
  serviceCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  serviceCheckSelected: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  planPage: {
    flex: 1,
    paddingHorizontal: 20,
  },
  planHeader: {
    paddingTop: 8,
    marginBottom: 22,
  },
  planBack: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 18,
  },
  planTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -0.6,
  },
  stopBlock: {
    marginBottom: 22,
  },
  stopRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stopDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    borderColor: cargoTheme.colors.primaryDark,
    backgroundColor: '#FFFFFF',
  },
  stopConnector: {
    width: 2,
    height: 18,
    marginLeft: 5,
    backgroundColor: '#D1D5DB',
  },
  stopText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  departRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  departField: {
    flex: 1,
    minWidth: 0,
  },
  departLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  departValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  departValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  planSpacer: {
    flex: 1,
  },
  planFooter: {
    paddingTop: 8,
  },
  calendarModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  calendarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.28)',
  },
  calendarCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    elevation: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  calendarAccent: {
    backgroundColor: CALENDAR_ACCENT,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  calendarAccentKicker: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
    color: CALENDAR_ON_ACCENT,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity: 0.72,
    marginBottom: 10,
  },
  calendarAccentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  calendarAccentTitle: {
    flex: 1,
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.extrabold,
    color: CALENDAR_ON_ACCENT,
    letterSpacing: -0.5,
  },
  calendarBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  calendarMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  calendarMonth: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  calendarMonthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calendarNavButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarNavDisabled: {
    opacity: 0.28,
  },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calendarWeekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.semibold,
    color: '#9CA3AF',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayChipSelected: {
    backgroundColor: CALENDAR_ACCENT,
  },
  calendarDayNumber: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: '#111827',
  },
  calendarDayDisabled: {
    color: '#D1D5DB',
  },
  calendarDaySelected: {
    color: CALENDAR_ON_ACCENT,
    fontFamily: typography.extrabold,
  },
  calendarActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 8,
  },
  calendarAction: {
    minWidth: 84,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  calendarActionText: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: typography.bold,
    color: '#111827',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  timePage: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    zIndex: 40,
    elevation: 40,
  },
  timeBack: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 10,
  },
  timeTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -0.6,
  },
  timeHint: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  timeWheelWell: {
    flexGrow: 1,
    minHeight: 320,
    justifyContent: 'center',
  },
  timeDoneButton: {
    minHeight: cargoTheme.cta.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  timeDoneText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
  emptySlotsText: {
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
  },
  confirmButton: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmButtonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
