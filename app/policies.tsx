import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { CargoHeader, CargoScreen, MenuRow } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { useAppCopy } from '@/lib/app-copy';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

export default function PoliciesScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const termsUrl = 'https://doordrop-terms.vercel.app/';
  const privacyUrl = 'https://doordrop-terms.vercel.app/privacy.html';

  return (
    <CargoScreen contentContainerStyle={styles.content}>
      <CargoHeader
        title={copy.policies.title}
        subtitle={copy.policies.subtitle}
        onLeftPress={() => router.back()}
      />

      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>{copy.policies.heroTitle}</Text>
        <Text style={styles.heroText}>{copy.policies.heroText}</Text>
      </View>

      <MenuRow
        icon="file-document-outline"
        title={copy.policies.terms}
        subtitle={copy.policies.termsSub}
        onPress={() => void Linking.openURL(termsUrl)}
      />
      <MenuRow
        icon="shield-lock-outline"
        title={copy.policies.privacy}
        subtitle={copy.policies.privacySub}
        onPress={() => void Linking.openURL(privacyUrl)}
      />
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
  },
  heroCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 20,
    marginBottom: 18,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroText: {
    color: '#D6E0EA',
    fontSize: 14,
    lineHeight: 21,
  },
});
