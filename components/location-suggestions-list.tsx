import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import type { LocationSuggestion } from '@/lib/location-search';
import { sanitizeSuggestionPresentation } from '@/lib/place-labels';

type Props = {
  suggestions: LocationSuggestion[];
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  showEmpty?: boolean;
  tone?: 'pickup' | 'dropoff';
  embedded?: boolean;
  variant?: 'default' | 'haul';
  headerLabel?: string;
  onSelect: (suggestion: LocationSuggestion) => void;
};

export function LocationSuggestionsList({
  suggestions,
  loading = false,
  loadingLabel = 'Searching places...',
  emptyLabel = 'No places found nearby. Try a street, landmark, or area name.',
  showEmpty = false,
  tone = 'dropoff',
  embedded = false,
  variant = 'default',
  headerLabel = 'Places',
  onSelect,
}: Props) {
  if (!loading && suggestions.length === 0 && !showEmpty) {
    return null;
  }

  const haul = variant === 'haul';
  const iconName = haul ? 'map-marker' : tone === 'pickup' ? 'crosshairs-gps' : 'map-marker';
  const accent = haul ? '#111827' : tone === 'pickup' ? cargoTheme.colors.primary : '#2563EB';
  const iconBg = haul ? (tone === 'pickup' ? '#FFE500' : '#111827') : tone === 'pickup' ? '#ECFDF3' : '#EFF6FF';
  const iconColor = haul && tone === 'dropoff' ? '#FFE500' : accent;

  return (
    <View style={[embedded ? (haul ? styles.haulEmbedded : styles.embedded) : styles.card, haul ? null : styles.elevated]}>
      {!embedded ? (
        <View style={styles.header}>
          <Text style={styles.headerLabel}>{headerLabel}</Text>
          {loading ? <ActivityIndicator size="small" color={accent} /> : null}
        </View>
      ) : loading ? (
        <View style={styles.embeddedLoading}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={styles.loadingText}>{loadingLabel}</Text>
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((suggestion, index) => {
            const presentation = sanitizeSuggestionPresentation(
              suggestion.name,
              suggestion.address,
              suggestion.fullText,
              suggestion.types ?? (suggestion.featureType ? [suggestion.featureType] : [])
            );

            return (
              <TouchableOpacity
                key={suggestion.id}
                activeOpacity={0.9}
                style={[styles.row, haul && styles.haulRow, index === suggestions.length - 1 ? styles.rowLast : null]}
                onPress={() => onSelect(suggestion)}>
                <View style={[styles.iconWrap, haul && styles.haulIconWrap, { backgroundColor: iconBg }]}>
                  <MaterialCommunityIcons name={iconName} size={haul ? 16 : 18} color={iconColor} />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.title, haul && styles.haulTitle]}>
                    {presentation.name}
                  </Text>
                  {presentation.address ? (
                    <Text numberOfLines={haul ? 1 : 2} style={[styles.subtitle, haul && styles.haulSubtitle]}>
                      {presentation.address}
                    </Text>
                  ) : null}
                </View>
                {haul ? null : (
                  <View style={styles.chevronWrap}>
                    <MaterialCommunityIcons name="arrow-top-right" size={16} color="#94A3B8" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : showEmpty && !loading ? (
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons name="map-search-outline" size={22} color="#94A3B8" />
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6ECF1',
    overflow: 'hidden',
  },
  embedded: {
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF2',
    overflow: 'hidden',
  },
  haulEmbedded: {
    backgroundColor: 'transparent',
  },
  elevated: {
    zIndex: 40,
    elevation: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EEF3',
    backgroundColor: '#F8FAFC',
  },
  headerLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.extrabold,
    color: '#64748B',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  embeddedLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#64748B',
  },
  list: {
    paddingVertical: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  haulRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  haulIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  haulTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: '#111827',
  },
  haulSubtitle: {
    fontSize: 13,
    lineHeight: 17,
    color: '#6B7280',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
  },
  chevronWrap: {
    width: 24,
    alignItems: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontFamily: typography.body,
    color: '#64748B',
  },
});
