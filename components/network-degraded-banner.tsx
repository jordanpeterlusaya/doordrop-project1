import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

type Props = {
  language: 'sw' | 'en';
  visible: boolean;
  onRetry?: () => void;
};

export function NetworkDegradedBanner({ language, visible, onRetry }: Props) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <MaterialCommunityIcons name="cloud-alert-outline" size={18} color="#B45309" />
      <Text style={styles.text}>
        {language === 'sw'
          ? 'Mtandao una chelewa. Bei na eneo vinaweza kusasishwa.'
          : 'Network is slow. Price and location may refresh shortly.'}
      </Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>{language === 'sw' ? 'Jaribu' : 'Retry'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.medium,
    color: '#92400E',
  },
  retryButton: {
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  retryText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
});
