import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CargoHeader, CargoScreen } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { useLanguage, type AppLanguage } from '@/providers/language-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

const OPTIONS: { value: AppLanguage; labelKey: 'languageKiswahili' | 'languageEnglish' }[] = [
  { value: 'sw', labelKey: 'languageKiswahili' },
  { value: 'en', labelKey: 'languageEnglish' },
];

export default function LanguageScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const { language, loading, setLanguage } = useLanguage();

  const handleSelect = async (nextLanguage: AppLanguage) => {
    if (loading || nextLanguage === language) {
      router.back();
      return;
    }

    await setLanguage(nextLanguage);
    router.back();
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" contentContainerStyle={styles.content}>
      <CargoHeader title={copy.account.language} onLeftPress={() => router.back()} />

      <View style={styles.group}>
        {OPTIONS.map((option, index) => {
          const selected = language === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              activeOpacity={0.88}
              disabled={loading}
              style={[styles.row, index > 0 && styles.rowBorder]}
              onPress={() => void handleSelect(option.value)}>
              <Text style={styles.rowTitle}>{copy.account[option.labelKey]}</Text>
              {selected ? (
                <MaterialCommunityIcons name="check" size={20} color={cargoTheme.colors.text} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
  },
  group: {
    backgroundColor: '#F3F4F6',
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
});
