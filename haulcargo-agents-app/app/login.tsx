import { Redirect, router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { getRememberMePreference } from '@/lib/auth-persistence';
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
  const [rememberMe, setRememberMe] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    void getRememberMePreference().then(setRememberMe);
  }, []);

  if (user && needsCompanySetup) return <Redirect href="/register-company" />;
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
    const status = String(carrierSnap.data()?.status || 'pending');
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
      await signIn(email.trim().toLowerCase(), password, { rememberMe });
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

      <View style={styles.rowBetween}>
        <Pressable
          onPress={() => setRememberMe((v) => !v)}
          style={styles.rememberRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberMe }}
          accessibilityLabel="Remember me">
          <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
            {rememberMe ? <Ionicons name="checkmark" size={14} color={theme.white} /> : null}
          </View>
          <Text style={styles.rememberLabel}>Remember me</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/forgot-password')} style={styles.forgot}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>
      </View>

      {error ? (
        <Animated.Text entering={FadeIn.duration(200)} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : null}

      <View style={styles.cta}>
        <PrimaryButton label="Sign in" loading={authenticating} onPress={() => void onSignIn()} />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: -4,
    gap: 12,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: theme.cta.backgroundColor,
    borderColor: theme.cta.backgroundColor,
  },
  rememberLabel: {
    fontFamily: typography.medium,
    fontSize: 13,
    color: theme.ink,
  },
  forgot: { paddingVertical: 2 },
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
