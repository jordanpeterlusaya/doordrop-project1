import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function ForgotPasswordScreen() {
  const { resetPassword } = useCarrierSession();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Enter the email on your HAUL Agents account.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset password"
      subtitle="We’ll email a secure Firebase reset link to your business address."
      footer={
        <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
          <Text style={styles.muted}>
            Remembered it? <Text style={styles.link}>Sign in</Text>
          </Text>
        </Pressable>
      }>
      {sent ? (
        <Animated.View entering={FadeIn.duration(280)} style={styles.successBox}>
          <Text style={styles.successTitle}>Check your inbox</Text>
          <Text style={styles.successBody}>
            If an account exists for {email.trim().toLowerCase()}, a password reset link is on the way.
            Follow it, then sign in here.
          </Text>
          <View style={styles.gap} />
          <PrimaryButton label="Back to sign in" onPress={() => router.replace('/login')} />
        </Animated.View>
      ) : (
        <>
          <Field
            label="Business email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              setError('');
            }}
            placeholder="name@company.co.tz"
          />
          {error ? (
            <Animated.Text entering={FadeIn} style={styles.error}>
              {error}
            </Animated.Text>
          ) : null}
          <PrimaryButton label="Send reset link" loading={loading} onPress={() => void onSubmit()} />
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.danger,
    marginBottom: 12,
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  successBox: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    padding: 16,
    backgroundColor: theme.successSoft,
  },
  successTitle: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.ink,
    marginBottom: 6,
  },
  successBody: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.muted,
  },
  gap: { height: 16 },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.accent, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
});
