import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ScheduleDeliverySheet,
  type ScheduleSheetCopy,
  type ScheduleSheetOption,
} from '@/components/schedule-delivery-sheet';
import { CITY_PARCELS_ENABLED } from '@/constants/parcel-features';
import {
  buildScheduleDays,
  buildScheduleTimeSlots,
  firstAvailableScheduleDate,
  firstAvailableScheduleTime,
} from '@/lib/schedule-delivery';
import { useLanguage } from '@/providers/language-provider';

type ScheduleAppRoute = '/send-parcel' | '/book-cargo' | '/ninunulie';

export default function ScheduleScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const [step, setStep] = useState<'service' | 'when'>('service');
  const [selectedRoute, setSelectedRoute] = useState<ScheduleAppRoute | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

  const copy = useMemo(
    () =>
      language === 'sw'
        ? {
            title: 'Panga safari yako',
            subtitle: 'Chagua huduma. Kisha siku na saa ya kuchukuliwa.',
            cancel: 'Ghairi',
            back: 'Rudi',
            stepService: 'Huduma',
            stepWhen: 'Siku na saa',
            pickTime: 'Saa',
            selectTime: 'Chagua saa',
            selectTimeTitle: 'Chagua saa ya kuchukuliwa',
            selectTimeHint: 'Zungusha saa na dakika',
            timeDone: 'Tayari',
            noSlots: 'Hakuna saa zilizobaki leo. Chagua siku nyingine.',
            continue: 'Endelea',
            confirm: 'Thibitisha ratiba',
            smartHint: 'Chagua huduma moja ili kuendelea.',
            selectDate: 'Chagua tarehe',
            okDate: 'Sawa',
            departureDate: 'Tarehe ya kuchukuliwa',
            departureTime: 'Saa ya kuchukuliwa',
            whenPlaceholder: 'Chagua siku na saa',
          }
        : {
            title: 'Schedule your delivery',
            subtitle: 'Pick a service. Then choose pickup date and time.',
            cancel: 'Cancel',
            back: 'Back',
            stepService: 'Service',
            stepWhen: 'Date & time',
            pickTime: 'Time',
            selectTime: 'Select time',
            selectTimeTitle: 'Pick pickup time',
            selectTimeHint: 'Scroll hour and minutes',
            timeDone: 'Done',
            noSlots: 'No times left today. Pick another day.',
            continue: 'Continue',
            confirm: 'Confirm schedule',
            smartHint: 'Choose one service to continue.',
            selectDate: 'Select date',
            okDate: 'OK',
            departureDate: 'Pickup date',
            departureTime: 'Pickup time',
            whenPlaceholder: 'Pick a date and time',
          },
    [language]
  ) satisfies ScheduleSheetCopy;

  const options = useMemo<ScheduleSheetOption[]>(
    () =>
      language === 'sw'
        ? [
            {
              key: 'cargo',
              title: 'Mizigo',
              subtitle: 'Toyo Electric, TOYO na Kirikuu',
              image: require('@/assets/images/home-avatar-mizigo.png'),
              imageScale: 1,
              icon: 'truck-fast-outline',
              route: '/book-cargo',
            },
            {
              key: 'parcel',
              title: 'Kifurushi',
              subtitle: 'Nyaraka na vifurushi',
              image: require('@/assets/images/home-avatar-parcel.png'),
              imageScale: 1,
              icon: 'package-variant-closed',
              route: '/send-parcel',
            },
            {
              key: 'ninunulie',
              title: 'Ninunulie',
              subtitle: 'Tunakununulia',
              image: require('@/assets/images/home-avatar-ninunulie.png'),
              imageScale: 1,
              icon: 'shopping-outline',
              route: '/ninunulie',
            },
          ]
        : [
            {
              key: 'cargo',
              title: 'Cargo',
              subtitle: 'Toyo Electric, TOYO and Kirikuu',
              image: require('@/assets/images/home-avatar-mizigo.png'),
              imageScale: 1,
              icon: 'truck-fast-outline',
              route: '/book-cargo',
            },
            {
              key: 'parcel',
              title: 'Parcel',
              subtitle: 'Documents and packages',
              image: require('@/assets/images/home-avatar-parcel.png'),
              imageScale: 1,
              icon: 'package-variant-closed',
              route: '/send-parcel',
            },
            {
              key: 'ninunulie',
              title: 'Buy for me',
              subtitle: 'We shop for you',
              image: require('@/assets/images/home-avatar-ninunulie.png'),
              imageScale: 1,
              icon: 'shopping-outline',
              route: '/ninunulie',
            },
          ],
    [language]
  );

  const scheduleDays = useMemo(() => buildScheduleDays(language), [language]);
  const scheduleTimes = useMemo(
    () => (selectedDate ? buildScheduleTimeSlots(selectedDate, language) : []),
    [language, selectedDate]
  );
  const hasAvailableSlots = scheduleTimes.some((slot) => !slot.disabled);
  const canContinue = Boolean(selectedRoute && selectedDate && selectedTime);

  const applyPickupWindow = useCallback(
    (isoDate: string) => {
      const nextDate = isoDate || firstAvailableScheduleDate(language);
      setSelectedDate(nextDate);
      setSelectedTime(firstAvailableScheduleTime(nextDate, language));
    },
    [language]
  );

  const handleSelectRoute = useCallback((route: ScheduleAppRoute) => {
    setSelectedRoute(route);
  }, []);

  const handleStartWhen = useCallback(() => {
    if (!selectedRoute) {
      return;
    }
    applyPickupWindow(firstAvailableScheduleDate(language));
    setStep('when');
  }, [applyPickupWindow, language, selectedRoute]);

  const handleContinue = useCallback(() => {
    if (!selectedRoute || !selectedDate || !selectedTime) {
      return;
    }

    router.push({
      pathname: selectedRoute,
      params: {
        timing: 'later',
        scheduleDate: selectedDate,
        scheduleTime: selectedTime,
        ...(selectedRoute === '/send-parcel' && !CITY_PARCELS_ENABLED ? { scope: 'outside' } : {}),
      },
    });
  }, [router, selectedDate, selectedRoute, selectedTime]);

  const pageBg = step === 'when' ? '#F4F4F5' : '#FFFFFF';

  return (
    <View style={[styles.container, { backgroundColor: pageBg }]}>
      <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: pageBg }]}>
        <StatusBar barStyle="dark-content" backgroundColor={pageBg} />
        <ScheduleDeliverySheet
          visible
          presentation="page"
          step={step}
          copy={copy}
          options={options}
          selectedRoute={selectedRoute}
          scheduleDays={scheduleDays}
          selectedDate={selectedDate}
          selectedTime={selectedTime}
          hasAvailableSlots={hasAvailableSlots}
          canContinue={canContinue}
          language={language}
          onClose={() => router.back()}
          onBack={() => setStep('service')}
          onSelectRoute={handleSelectRoute}
          onStartWhen={handleStartWhen}
          onSelectDate={applyPickupWindow}
          onSelectTime={setSelectedTime}
          onContinue={handleContinue}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
