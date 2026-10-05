import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { BusParcelSearchIndicator } from '@/components/bus-parcel-search-indicator';
import { typography } from '@/constants/typography';

type BusParcelTrackSlotProps = {
  language: 'en' | 'sw';
  searching: boolean;
  agentLabel: string;
  agentName: string;
  busLabel: string;
  busName: string;
  phone: string;
  hasPhone: boolean;
  onCallPhone: () => void;
  callAccessibilityLabel: string;
};

export function BusParcelTrackSlot({
  language,
  searching,
  agentLabel,
  agentName,
  busLabel,
  busName,
  phone,
  hasPhone,
  onCallPhone,
  callAccessibilityLabel,
}: BusParcelTrackSlotProps) {
  const searchingTitle = language === 'sw' ? 'Tunatafuta basi' : 'Matching a bus';

  if (searching) {
    return (
      <View style={styles.searchBlock}>
        <BusParcelSearchIndicator accessibilityLabel={searchingTitle} />
        <Text style={styles.searchTitle}>{searchingTitle}</Text>
        <Text style={styles.searchHint}>
          {language === 'sw'
            ? 'Tunalinganisha njia na uzito wa mzigo wako.'
            : 'We are matching your route and parcel weight.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.matchedCard}>
      <View style={styles.matchedIconWrap}>
        <MaterialCommunityIcons name="bus-side" size={24} color="#111827" />
      </View>
      <View style={styles.matchedCopy}>
        <View style={styles.matchedRow}>
          <Text style={styles.matchedLabel}>{agentLabel}</Text>
          <Text style={styles.matchedValue} numberOfLines={2}>
            {agentName || '—'}
          </Text>
        </View>
        <View style={styles.matchedRow}>
          <Text style={styles.matchedLabel}>{busLabel}</Text>
          <Text style={styles.matchedValue} numberOfLines={2}>
            {busName || '—'}
          </Text>
        </View>
        {hasPhone ? (
          <Pressable accessibilityRole="link" onPress={onCallPhone}>
            <Text style={styles.matchedPhone} numberOfLines={1}>
              {phone}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hasPhone ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={callAccessibilityLabel}
          style={styles.callButton}
          onPress={onCallPhone}>
          <MaterialCommunityIcons name="phone" size={18} color="#111827" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBlock: {
    alignItems: 'center',
    paddingVertical: 6,
    gap: 4,
  },
  searchTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: typography.semibold,
    color: '#111827',
    letterSpacing: -0.2,
  },
  searchHint: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.regular,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  matchedCard: {
    marginTop: 4,
    marginBottom: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  matchedIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchedCopy: {
    flex: 1,
    gap: 8,
  },
  matchedRow: {
    gap: 2,
  },
  matchedLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  matchedValue: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  matchedPhone: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.medium,
    color: '#2563EB',
    marginTop: 2,
  },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
