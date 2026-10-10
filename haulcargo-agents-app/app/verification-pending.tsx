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
      <AuthShell title="Haijakubaliwa" subtitle="HAUL haijaidhinisha akaunti hii kwa sasa." back={false}>
        {carrier.rejectionReason ? <Text style={styles.reason}>{carrier.rejectionReason}</Text> : null}
        <PrimaryButton label="Fungua mipangilio" onPress={() => router.replace('/(main)/settings')} />
        <View style={styles.gap} />
        <PrimaryButton
          label="Toka"
          variant="outline"
          onPress={() => void signOut().then(() => router.replace('/'))}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Inasubiri uthibitisho"
      subtitle="Akaunti ya kampuni imetumwa. HAUL itathibitisha hati na BRELA/TIN kabla ya kupokea oda."
      back={false}>
      <Animated.View entering={FadeInDown.duration(450)} style={styles.statusCard}>
        <Text style={styles.statusEyebrow}>Hali ya biashara</Text>
        <Text style={styles.statusTitle}>Pending verification</Text>
        <Text style={styles.statusBody}>
          {carrier?.companyName
            ? `${carrier.companyName} · `
            : ''}
          Simu na barua pepe zimehifadhiwa. Unaweza kuingia kuona wasifu, lakini oda mpya zinahitaji
          uthibitisho wa HAUL.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(120).duration(450)} style={styles.steps}>
        <Text style={styles.step}>1. Timu yetu inapitia hati ulizopakia</Text>
        <Text style={styles.step}>2. Tutathibitisha BRELA, TIN, na leseni</Text>
        <Text style={styles.step}>3. Utapokea oda mara tu status ikawa verified</Text>
      </Animated.View>

      <PrimaryButton label="Endelea kwenye desk" onPress={() => router.replace('/(main)')} />
      <View style={styles.gap} />
      <PrimaryButton label="Sasisha hali" variant="outline" onPress={() => void refreshCarrier()} />
      <View style={styles.gap} />
      <PrimaryButton
        label="Toka"
        variant="outline"
        onPress={() => void signOut().then(() => router.replace('/'))}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: theme.primarySoft,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3E7A3',
  },
  statusEyebrow: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.muted,
    marginBottom: 4,
  },
  statusTitle: {
    fontFamily: typography.bold,
    fontSize: 20,
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
