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
        <ActivityIndicator size="large" color={theme.ink} />
      </View>
    );
  }

  if (user) {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 20) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.bg} />

      <Animated.View entering={FadeIn.duration(400)} style={styles.brandBlock}>
        <Image source={images.haulLogo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandMark}>HAUL</Text>
        <Text style={styles.product}>Cargo Agents</Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(80).duration(480)} style={styles.copy}>
        <Text style={styles.headline}>Move freight with your desk.</Text>
        <Text style={styles.subtitle}>Orders, routes, and payouts — one place.</Text>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(140).duration(500)} style={styles.artStage}>
        <Image source={images.onboardingCargo} style={styles.art} resizeMode="contain" />
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(200).duration(480)} style={styles.footer}>
        <PrimaryButton label="Start" onPress={() => router.push('/login')} />
        <Pressable onPress={() => router.push('/register')} style={styles.secondary}>
          <Text style={styles.secondaryText}>Register company</Text>
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
    marginBottom: 28,
  },
  logo: {
    width: 44,
    height: 44,
    marginBottom: 12,
  },
  brandMark: {
    fontSize: 42,
    lineHeight: 46,
    fontFamily: typography.ident,
    color: theme.ink,
    letterSpacing: -1.2,
  },
  product: {
    marginTop: 4,
    fontSize: 16,
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
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: theme.muted,
  },
  artStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
  art: {
    width: '100%',
    height: 220,
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
    fontSize: 15,
    fontFamily: typography.semibold,
    color: theme.ink,
  },
});
