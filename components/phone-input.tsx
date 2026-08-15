import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useLanguage } from '@/providers/language-provider';

export type PhoneCountry = {
  code: string;
  name: string;
  flag: string;
  dial: string;
  dialDigits: string;
};

export const phoneCountries: PhoneCountry[] = [
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿', dial: '+255', dialDigits: '255' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', dial: '+254', dialDigits: '254' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬', dial: '+256', dialDigits: '256' },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', dial: '+250', dialDigits: '250' },
  { code: 'BI', name: 'Burundi', flag: '🇧🇮', dial: '+257', dialDigits: '257' },
  { code: 'MW', name: 'Malawi', flag: '🇲🇼', dial: '+265', dialDigits: '265' },
  { code: 'ZM', name: 'Zambia', flag: '🇿🇲', dial: '+260', dialDigits: '260' },
  { code: 'MZ', name: 'Mozambique', flag: '🇲🇿', dial: '+258', dialDigits: '258' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', dial: '+27', dialDigits: '27' },
  { code: 'CD', name: 'DR Congo', flag: '🇨🇩', dial: '+243', dialDigits: '243' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', dial: '+971', dialDigits: '971' },
  { code: 'IN', name: 'India', flag: '🇮🇳', dial: '+91', dialDigits: '91' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '+44', dialDigits: '44' },
  { code: 'US', name: 'United States', flag: '🇺🇸', dial: '+1', dialDigits: '1' },
];

const defaultCountry = phoneCountries[0];

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

function nationalDigits(value: string) {
  return digitsOnly(value).replace(/^0+/, '');
}

export function parsePhoneValue(value: string) {
  const digits = digitsOnly(value);
  const ranked = [...phoneCountries].sort((left, right) => right.dialDigits.length - left.dialDigits.length);
  const match = ranked.find((country) => digits.startsWith(country.dialDigits));

  if (match) {
    return {
      country: match,
      national: digits.slice(match.dialDigits.length),
    };
  }

  return {
    country: defaultCountry,
    national: nationalDigits(value),
  };
}

export function toE164Phone(country: PhoneCountry, national: string) {
  const nextNational = nationalDigits(national);
  return nextNational ? `${country.dial}${nextNational}` : '';
}

type PhoneInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: object;
};

export function PhoneInput({ value, onChangeText, placeholder, style }: PhoneInputProps) {
  const { language } = useLanguage();
  const isSw = language === 'sw';
  const resolvedPlaceholder = placeholder ?? (isSw ? 'Namba ya simu' : 'Phone number');
  const parsed = useMemo(() => parsePhoneValue(value), [value]);
  const [country, setCountry] = useState(parsed.country);
  const [national, setNational] = useState(parsed.national);
  const lastEmittedRef = useRef(value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (value === lastEmittedRef.current) {
      return;
    }

    const next = parsePhoneValue(value);
    setCountry(next.country);
    setNational(next.national);
    lastEmittedRef.current = value;
  }, [value]);

  const filteredCountries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return phoneCountries;
    }

    return phoneCountries.filter(
      (country) =>
        country.name.toLowerCase().includes(needle) ||
        country.dial.includes(needle) ||
        country.code.toLowerCase().includes(needle)
    );
  }, [query]);

  const emit = (nextCountry: PhoneCountry, nextNational: string) => {
    const nextValue = toE164Phone(nextCountry, nextNational);
    lastEmittedRef.current = nextValue;
    setCountry(nextCountry);
    setNational(nextNational);
    onChangeText(nextValue);
  };

  return (
    <>
      <View style={[styles.phoneWrap, style]}>
        <TouchableOpacity
          activeOpacity={0.88}
          style={styles.countryButton}
          onPress={() => setPickerOpen(true)}>
          <Text style={styles.flag}>{country.flag}</Text>
          <Text style={styles.dial}>{country.dial}</Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={cargoTheme.colors.subtext} />
        </TouchableOpacity>
        <TextInput
          value={national}
          onChangeText={(next) => emit(country, next)}
          placeholder={resolvedPlaceholder}
          placeholderTextColor="#94A3B8"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          style={styles.phoneInput}
        />
      </View>

      <Modal animationType="slide" transparent visible={pickerOpen} onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isSw ? 'Nchi' : 'Country'}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.subtext} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={isSw ? 'Tafuta nchi' : 'Search country'}
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
            />
            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = item.code === country.code;
                return (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={[styles.countryRow, selected && styles.countryRowSelected]}
                    onPress={() => {
                      emit(item, national);
                      setQuery('');
                      setPickerOpen(false);
                    }}>
                    <Text style={styles.flag}>{item.flag}</Text>
                    <Text style={styles.countryName}>{item.name}</Text>
                    <Text style={styles.countryDial}>{item.dial}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  phoneWrap: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    marginBottom: 12,
  },
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 54,
  },
  flag: {
    fontSize: 20,
  },
  dial: {
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  phoneInput: {
    flex: 1,
    minHeight: 54,
    fontSize: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
    paddingVertical: 0,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    maxHeight: '72%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  searchInput: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
    marginBottom: 8,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
  },
  countryRowSelected: {
    backgroundColor: '#F0FDF4',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  countryName: {
    flex: 1,
    fontSize: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  countryDial: {
    fontSize: 14,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
  },
});
