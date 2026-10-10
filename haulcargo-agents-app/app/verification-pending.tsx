import { Redirect, router } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function VerificationPendingScreen() {
  const { user, carrier, refreshCarrier, signOut } = useCarrierSession();

  useEffect(() => {
    const id = setInterval(() => {
      void refreshCarrier();
    }, 12_000);
    return () => clearInterval(id);
  }, [refreshCarrier]);

  if (!user) return <Redirect href="/login" />;
  if (carrier?.status === 'verified') return <Redirect href="/(main)" />;
  if (carrier?.status === 'rejected') {
    return (
      <AuthShell title="Not approved" subtitle="HAUL has not approved this account." back={false}>
        {carrier.rejectionReason ? <Text style={styles.reason}>{carrier.rejectionReason}</Text> : null}
        <PrimaryButton label="Open settings" onPress={() => router.replace('/(main)/settings')} />
        <View style={styles.gap} />
        <PrimaryButton
          label="Sign out"
          variant="outline"
          onPress={() => void signOut().then(() => router.replace('/'))}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Waiting for verification"
      subtitle="Your company is under review. You will receive orders once HAUL verifies your documents."
      back={false}>
      <Animated.View entering={FadeInDown.duration(420)} style={styles.statusCard}>
        <Text style={styles.statusEyebrow}>Status</Text>
        <Text style={styles.statusTitle}>Pending</Text>
        <Text style={styles.statusBody}>
          {carrier?.companyName ? `${carrier.companyName}. ` : ''}
          BRELA, TIN, and licences are being checked.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(100).duration(420)} style={styles.steps}>
        <Text style={styles.step}>1. Documents under review</Text>
        <Text style={styles.step}>2. Business numbers verified</Text>
        <Text style={styles.step}>3. Orders unlock when verified</Text>
      </Animated.View>

      <PrimaryButton label="Refresh status" onPress={() => void refreshCarrier()} />
      <View style={styles.gap} />
      <PrimaryButton
        label="Sign out"
        variant="outline"
        onPress={() => void signOut().then(() => router.replace('/'))}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusEyebrow: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.muted,
    marginBottom: 4,
  },
  statusTitle: {
    fontFamily: typography.bold,
    fontSize: 22,
    color: theme.ink,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  statusBody: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.ink,
  },
  steps: { marginBottom: 18, gap: 8 },
  step: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.muted,
  },
  reason: {
    color: theme.danger,
    fontFamily: typography.semibold,
    marginBottom: 14,
    lineHeight: 20,
  },
  gap: { height: 10 },
});
