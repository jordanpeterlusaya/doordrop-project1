import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';

export default function BookCargoWebScreen() {
  const router = useRouter();

  return (
    <CargoScreen contentContainerStyle={styles.content}>
      <CargoHeader
        title="Book cargo"
        subtitle="Web preview for the mobile cargo flow."
        leftAction="none"
      />

      <View style={styles.card}>
        <Text style={styles.title}>Cargo booking uses the native app route tools</Text>
        <Text style={styles.text}>
          The full cargo request flow calculates route distance and hybrid distance-based pricing from the mobile app. Once the customer confirms it, the order is written to Firestore and the DoorDrop team handles assignment and status updates.
        </Text>
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Dispatch connection</Text>
        <Text style={styles.noticeText}>Orders created from the app and dispatch updates share the same Firebase project and Firestore collections.</Text>
      </View>

      <PrimaryButton label="Back to web home" variant="secondary" onPress={() => router.replace('/home')} />
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
    gap: 18,
  },
  card: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 10,
  },
  text: {
    fontSize: 14,
    lineHeight: 22,
    color: cargoTheme.colors.subtext,
  },
  notice: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 10,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
});
