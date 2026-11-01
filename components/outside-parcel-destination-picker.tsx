import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { isOutsideRouteAllowed, type OutsideDestinationCityKey } from '@/lib/outside-parcel-routes';
import { isZanzibarSeaDestination, type OutsideDestinationCity } from '@/lib/outside-parcel';

type Props = {
  language: 'sw' | 'en';
  originCity: OutsideDestinationCity | null;
  originCityKey: OutsideDestinationCityKey;
  destinations: OutsideDestinationCity[];
  selectedCityKey: OutsideDestinationCityKey | null;
  onSelectCity: (cityKey: OutsideDestinationCityKey) => void;
};

function OutsideStepHeader({ step, title }: { step: number; title: string }) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{step}</Text>
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

function CityModeTags({
  originCityKey,
  destinationCityKey,
  language,
}: {
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  language: 'sw' | 'en';
}) {
  const express = isOutsideRouteAllowed({
    originCityKey,
    destinationCityKey,
    shippingMode: 'express',
  });
  const standard = isOutsideRouteAllowed({
    originCityKey,
    destinationCityKey,
    shippingMode: 'standard',
  });

  if (!express && !standard) {
    return null;
  }

  return (
    <View style={styles.modeTagRow}>
      {express ? (
        <View style={[styles.modeTag, styles.modeTagAir]}>
          <MaterialCommunityIcons name="airplane" size={10} color="#0369A1" />
          <Text style={[styles.modeTagText, styles.modeTagTextAir]}>
            {language === 'sw' ? 'Ndege' : 'Air'}
          </Text>
        </View>
      ) : null}
      {standard ? (
        <View style={[styles.modeTag, styles.modeTagBus]}>
          <MaterialCommunityIcons
            name={isZanzibarSeaDestination(destinationCityKey) ? 'ferry' : 'bus-side'}
            size={10}
            color="#111827"
          />
          <Text style={[styles.modeTagText, styles.modeTagTextBus]}>
            {isZanzibarSeaDestination(destinationCityKey)
              ? 'Ferry'
              : language === 'sw'
                ? 'Basi'
                : 'Bus'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function OutsideParcelDestinationPicker({
  language,
  originCity,
  originCityKey,
  destinations,
  selectedCityKey,
  onSelectCity,
}: Props) {
  const selectedCity = useMemo(
    () => destinations.find((city) => city.key === selectedCityKey) ?? null,
    [destinations, selectedCityKey]
  );

  const stepDestination = language === 'sw' ? 'Chagua mji wa mpokeaji' : 'Choose destination city';

  return (
    <View style={styles.wrap}>
      <View style={styles.routeSummary}>
        <View style={styles.routeSummaryTop}>
          <View style={styles.routeIconWell}>
            <MaterialCommunityIcons name="map-marker-radius" size={18} color={cargoTheme.colors.primaryDark} />
          </View>
          <View style={styles.routeSummaryCopy}>
            <Text style={styles.routeSummaryEyebrow}>
              {language === 'sw' ? 'Unatuma kutoka' : 'Sending from'}
            </Text>
            <Text style={styles.routeSummaryOrigin}>{originCity?.label ?? 'Dar es Salaam'}</Text>
          </View>
          <View style={styles.routeCountPill}>
            <Text style={styles.routeCountText}>{destinations.length}</Text>
          </View>
        </View>

        {selectedCity ? (
          <View style={styles.routeSummarySelected}>
            <MaterialCommunityIcons name="arrow-down" size={16} color="#94A3B8" />
            <Text style={styles.routeSummarySelectedLabel}>
              {language === 'sw' ? 'Kwenda' : 'To'}{' '}
              <Text style={styles.routeSummarySelectedCity}>{selectedCity.label}</Text>
            </Text>
          </View>
        ) : (
          <Text style={styles.routeSummaryHint}>
            {language === 'sw'
              ? 'Chagua mji unapotuma kifurushi chini.'
              : 'Pick the destination city below.'}
          </Text>
        )}
      </View>

      <OutsideStepHeader step={1} title={stepDestination} />

      {destinations.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={28} color="#94A3B8" />
          <Text style={styles.emptyTitle}>
            {language === 'sw' ? 'Hakuna njia kutoka hapa' : 'No routes from here'}
          </Text>
          <Text style={styles.emptyText}>
            {language === 'sw'
              ? 'Badilisha eneo la kuchukua, au tumia Dar es Salaam kama eneo la kutuma.'
              : 'Change your pickup location, or send from Dar es Salaam.'}
          </Text>
        </View>
      ) : (
        <View style={styles.cityGrid}>
          {destinations.map((city) => {
            const isActive = city.key === selectedCityKey;
            return (
              <Pressable
                key={city.key}
                accessibilityRole="button"
                onPress={() => onSelectCity(city.key)}
                style={({ pressed }) => [
                  styles.cityCard,
                  isActive && styles.cityCardActive,
                  pressed && styles.cityCardPressed,
                ]}>
                <View style={styles.cityCardTop}>
                  <Text style={[styles.cityCardTitle, isActive && styles.cityCardTitleActive]} numberOfLines={1}>
                    {city.label}
                  </Text>
                  {isActive ? (
                    <MaterialCommunityIcons name="check-circle" size={18} color={cargoTheme.colors.primaryDark} />
                  ) : (
                    <MaterialCommunityIcons name="chevron-right" size={18} color="#CBD5E1" />
                  )}
                </View>
                <CityModeTags
                  originCityKey={originCityKey}
                  destinationCityKey={city.key}
                  language={language}
                />
              </Pressable>
            );
          })}
        </View>
      )}

    </View>
  );
}

export function OutsideParcelStepHeader({ step, title }: { step: number; title: string }) {
  return <OutsideStepHeader step={step} title={title} />;
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  routeSummary: {
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  routeSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeIconWell: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#FFF9CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeSummaryEyebrow: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.bold,
    color: '#64748B',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  routeSummaryOrigin: {
    marginTop: 2,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  routeCountPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  routeCountText: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: '#334155',
  },
  routeSummarySelected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
  },
  routeSummarySelectedLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#64748B',
  },
  routeSummarySelectedCity: {
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  routeSummaryHint: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.body,
    color: '#64748B',
    paddingTop: 2,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
  stepTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#0F172A',
  },
  cityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cityCard: {
    width: '48%',
    minHeight: 72,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
  },
  cityCardActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#FFF9CC',
  },
  cityCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  cityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cityCardTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#0F172A',
  },
  cityCardTitleActive: {
    color: cargoTheme.colors.primaryDark,
  },
  modeTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  modeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modeTagAir: {
    backgroundColor: '#E0F2FE',
  },
  modeTagBus: {
    backgroundColor: '#FFE500',
  },
  modeTagText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.bold,
  },
  modeTagTextAir: {
    color: '#0369A1',
  },
  modeTagTextBus: {
    color: '#111827',
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF3',
    paddingHorizontal: 18,
    paddingVertical: 22,
    gap: 8,
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
});
