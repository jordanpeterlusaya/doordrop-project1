import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { sendCarrierOtp } from '@/lib/otp-api';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LoginScreen() {
  const {
    authenticating,
    authError,
    clearAuthError,
    signIn,
    user,
    needsCompanySetup,
    carrier,
    refreshCarrier,
  } = useCarrierSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [localError, setLocalError] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  if (user && needsCompanySetup) return <Redirect href="/register-company" />;
  if (user && carrier && !carrier.phoneVerified) {
    const phone = String(carrier.phone || '').trim();
    if (phone) {
      return (
        <Redirect
          href={{
            pathname: '/otp',
            params: { phone, purpose: 'confirm', carrierId: carrier.id },
          }}
        />
      );
    }
  }
  if (user && !needsCompanySetup && (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com')) {
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    return <Redirect href="/(main)" />;
  }

  const validate = () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !email.includes('@')) next.email = 'Enter a valid business email.';
    if (!password) next.password = 'Enter your password.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const continueAfterSignIn = async () => {
    await refreshCarrier();
    // Re-read via a short delay — session state may still be settling.
    const { auth } = await import('@/lib/firebase');
    const current = auth.currentUser;
    if (!current) return;

    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const memberSnap = await getDoc(doc(db, 'carrierMembers', current.uid));
    const carrierId = memberSnap.exists()
      ? String(memberSnap.data().carrierId || current.uid)
      : current.uid;
    const carrierSnap = await getDoc(doc(db, 'carriers', carrierId));
    if (!carrierSnap.exists()) {
      router.replace('/register-company');
      return;
    }
    const data = carrierSnap.data();
    const phone = String(data.phone || data.phoneNormalized || '').trim();
    const phoneVerified = Boolean(data.phoneVerified);
    const status = String(data.status || 'pending');

    if (!phoneVerified) {
      if (!phone) {
        setLocalError('No phone on this account. Contact HAUL support or re-register.');
        return;
      }
      setSendingOtp(true);
      try {
        const result = await sendCarrierOtp(phone, 'confirm');
        router.replace({
          pathname: '/otp',
          params: {
            phone,
            purpose: 'confirm',
            phoneMasked: result.phoneMasked,
            cooldown: String(result.cooldownSeconds || 60),
            expires: String(result.expiresInSeconds || 300),
            carrierId,
            ...(result.otpBypass ? { otpBypass: '1' } : {}),
          },
        });
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : 'Could not send verification SMS.');
      } finally {
        setSendingOtp(false);
      }
      return;
    }

    if (status === 'pending') {
      router.replace('/verification-pending');
      return;
    }
    router.replace('/(main)');
  };

  const onSignIn = async () => {
    if (!validate()) return;
    clearAuthError();
    setLocalError('');
    try {
      await signIn(email.trim().toLowerCase(), password);
      await continueAfterSignIn();
    } catch {
      // authError already set by session
    }
  };

  const error = localError || authError;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your company email and password."
      footer={
        <Pressable onPress={() => router.replace('/register')} style={styles.linkWrap}>
          <Text style={styles.muted}>
            New company? <Text style={styles.link}>Register</Text>
          </Text>
        </Pressable>
      }>
      <Field
        label="Business email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="name@company.co.tz"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setFieldErrors((f) => ({ ...f, email: undefined }));
          clearAuthError();
          setLocalError('');
        }}
        error={fieldErrors.email}
      />
      <Field
        label="Password"
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        secureTextEntry
        secureToggle
        placeholder="••••••••"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          setFieldErrors((f) => ({ ...f, password: undefined }));
          clearAuthError();
          setLocalError('');
        }}
        error={fieldErrors.password}
      />

      <Pressable onPress={() => router.push('/forgot-password')} style={styles.forgot}>
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>

      {error ? (
        <Animated.Text entering={FadeIn.duration(200)} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : null}

      <View style={styles.cta}>
        <PrimaryButton
          label="Sign in"
          loading={authenticating || sendingOtp}
          onPress={() => void onSignIn()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', marginBottom: 16, marginTop: -4 },
  forgotText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.accent,
  },
  error: {
    color: theme.danger,
    marginBottom: 12,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: { marginTop: 4 },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.accent, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
});
