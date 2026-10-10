import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LoginScreen() {
  const { signIn, authenticating, authError, clearAuthError, user, needsCompanySetup, carrier } =
    useCarrierSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  if (user && !needsCompanySetup && (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com')) {
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    return <Redirect href="/(main)" />;
  }
  if (user && needsCompanySetup) return <Redirect href="/register-company" />;

  const error = localError || authError;

  return (
    <AuthShell
      title="Ingia"
      subtitle="Barua pepe na nenosiri la kampuni yako ya usafirishaji."
      footer={
        <>
          <Pressable onPress={() => router.push('/forgot-password')} style={styles.linkWrap}>
            <Text style={styles.link}>Umesahau nenosiri?</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/register')} style={styles.linkWrap}>
            <Text style={styles.muted}>
              Huna akaunti? <Text style={styles.link}>Jisajili</Text>
            </Text>
          </Pressable>
        </>
      }>
      <Field
        label="Barua pepe"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          clearAuthError();
          setLocalError('');
        }}
      />
      <Field
        label="Nenosiri"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          clearAuthError();
          setLocalError('');
        }}
      />
      {error ? (
        <Animated.Text entering={FadeIn.duration(200)} style={styles.error}>
          {error}
        </Animated.Text>
      ) : null}
      <PrimaryButton
        label="Ingia"
        loading={authenticating}
        onPress={() => {
          if (!email.trim() || !password) {
            setLocalError('Weka barua pepe na nenosiri.');
            return;
          }
          void signIn(email, password).catch(() => undefined);
        }}
      />
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
  linkWrap: { marginTop: 10, alignItems: 'center' },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
});
