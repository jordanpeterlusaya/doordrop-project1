import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LoginScreen() {
  const { signIn, authenticating, authError, clearAuthError, user, needsCompanySetup, carrier } = useCarrierSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  if (user && !needsCompanySetup && (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com')) {
    return <Redirect href="/(main)" />;
  }
  if (user && needsCompanySetup) return <Redirect href="/register-company" />;

  const error = localError || authError;

  return (
    <Screen scroll>
      <Header title="Ingia" back />
      <Text style={styles.sub}>Barua pepe na nenosiri la kampuni yako.</Text>
      <Field
        label="Barua pepe"
        autoCapitalize="none"
        keyboardType="email-address"
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
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          clearAuthError();
          setLocalError('');
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
      <Pressable onPress={() => router.push('/forgot-password')} style={styles.linkWrap}>
        <Text style={styles.link}>Umesahau nenosiri?</Text>
      </Pressable>
      <Pressable onPress={() => router.replace('/register')} style={styles.linkWrap}>
        <Text style={styles.link}>Huna akaunti? Jisajili</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: theme.muted, marginBottom: 20, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 12 },
  linkWrap: { marginTop: 16, alignItems: 'center' },
  link: { color: theme.ink, fontWeight: '600' },
});
