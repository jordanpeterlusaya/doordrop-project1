import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HaulLetterIntro } from '@/components/haul-letter-intro';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { images } from '@/lib/images';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LandingScreen() {
  const { user, initializing, needsCompanySetup, carrier } = useCarrierSession();
  const [showIntro, setShowIntro] = useState(true);
  const insets = useSafeAreaInsets();

  if (showIntro) {
    return <HaulLetterIntro onFinished={() => setShowIntro(false)} />;
  }

  if (initializing) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.primary} />
        <ActivityIndicator size="large" color={theme.ink} />
      </View>
    );
  }

  if (user) {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.white} />

      <View style={styles.brandRow}>
        <Image source={images.haulLogo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandMark}>HAUL</Text>
      </View>

      <Text style={styles.headline}>Cargo Agents</Text>
      <Text style={styles.subtitle}>
        Pokea oda za mizigo, simamia safari, na fedha — katika mfumo mmoja wa HAUL.
      </Text>

      <View style={styles.artStage}>
        <Image source={images.onboardingCargo} style={styles.art} resizeMode="contain" />
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Ingia" onPress={() => router.push('/login')} />
        <View style={styles.gap} />
        <PrimaryButton label="Jisajili kampuni" variant="outline" onPress={() => router.push('/register')} />
        <Pressable onPress={() => router.push('/login')} style={styles.loginLinkWrap}>
          <Text style={styles.loginLinkMuted}>Tayari una akaunti? </Text>
          <Text style={styles.loginLinkAction}>Ingia</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  root: {
    flex: 1,
    backgroundColor: theme.white,
    paddingHorizontal: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  logo: {
    width: 40,
    height: 40,
  },
  brandMark: {
    fontSize: 28,
    lineHeight: 32,
    fontFamily: typography.ident,
    color: theme.ink,
    letterSpacing: -0.8,
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.medium,
    color: theme.subtext,
    marginBottom: 8,
  },
  artStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
  },
  art: {
    width: '100%',
    height: 240,
  },
  footer: {
    gap: 0,
    paddingTop: 8,
  },
  gap: { height: 12 },
  loginLinkWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  loginLinkMuted: {
    fontSize: 14,
    fontFamily: typography.medium,
    color: theme.subtext,
  },
  loginLinkAction: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: theme.ink,
  },
});
