import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { CargoHeader, CargoScreen, MenuRow } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

export default function PoliciesScreen() {
  const router = useRouter();
  const termsUrl = 'https://doordrop-terms.vercel.app/';
  const privacyUrl = 'https://doordrop-terms.vercel.app/privacy.html';

  return (
    <CargoScreen contentContainerStyle={styles.content}>
      <CargoHeader
        title="Policies"
        subtitle="Review the terms and privacy information for DoorDrop."
        onLeftPress={() => router.back()}
      />

      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Policies and protection</Text>
        <Text style={styles.heroText}>
          Open the legal and privacy pages below to understand how DoorDrop handles deliveries and account information.
        </Text>
      </View>

      <MenuRow
        icon="file-document-outline"
        title="Terms and conditions"
        subtitle="Read the customer terms for bookings, cancellations and deliveries"
        onPress={() => void Linking.openURL(termsUrl)}
      />
      <MenuRow
        icon="shield-lock-outline"
        title="Privacy policy"
        subtitle="See how DoorDrop stores and uses personal information"
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
