import { Redirect, router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
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
  const finishIntro = useCallback(() => setShowIntro(false), []);

  if (showIntro) {
    return <HaulLetterIntro onFinished={finishIntro} />;
  }

  if (initializing) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.bg} />
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (user) {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier && !carrier.phoneVerified) {
      const phone = String(carrier.phone || '').trim();
      if (!phone) return <Redirect href="/login" />;
      return (
        <Redirect
          href={{
            pathname: '/otp',
            params: {
              phone,
              purpose: 'confirm',
              carrierId: carrier.id,
            },
          }}
        />
      );
    }
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.bg} />

      <Animated.View entering={FadeIn.duration(360)} style={styles.brandBlock}>
        <View style={styles.logoRow}>
          <Image source={images.haulLogo} style={styles.logo} resizeMode="contain" />
          <View style={styles.brandDot} />
        </View>
        <Text style={styles.brandMark}>HAUL</Text>
        <Text style={styles.product}>Cargo Agents</Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(60).duration(420)} style={styles.copy}>
        <Text style={styles.headline}>Your freight desk, quietly powerful.</Text>
        <Text style={styles.subtitle}>
          Sign in to manage orders, routes, and payouts — built for verified carriers.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(120).duration(440)} style={styles.artStage}>
        <Image source={images.onboardingCargo} style={styles.art} resizeMode="contain" />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(180).duration(420)} style={styles.footer}>
        <PrimaryButton label="Sign in" onPress={() => router.push('/login')} />
        <Pressable onPress={() => router.push('/register')} style={styles.secondary}>
          <Text style={styles.secondaryText}>Register your company</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 28,
  },
  brandBlock: {
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  logoRow: { position: 'relative', marginBottom: 12 },
  logo: {
    width: 36,
    height: 36,
  },
  brandDot: {
    position: 'absolute',
    right: -3,
    top: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.brandYellow,
  },
  brandMark: {
    fontSize: 34,
    lineHeight: 38,
    fontFamily: typography.ident,
    color: theme.navy,
    letterSpacing: 0.5,
  },
  product: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: typography.medium,
    color: theme.muted,
    letterSpacing: 0.2,
  },
  copy: {
    marginBottom: 8,
  },
  headline: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.bold,
    color: theme.ink,
    letterSpacing: -0.35,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.body,
    color: theme.muted,
    maxWidth: 340,
  },
  artStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
  },
  art: {
    width: '100%',
    height: 200,
  },
  footer: {
    gap: 4,
    paddingTop: 8,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  secondaryText: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: theme.navyMid,
  },
});
