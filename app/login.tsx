import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { PasswordInput } from '@/components/password-input';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { resolveAuthReturnTo } from '@/lib/auth-navigation';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';

function LoginScreenContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { authError, authenticating, clearAuthError, signInWithEmail, user } = useAuthSession();
  const copy = useAppCopy();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const returnTo = resolveAuthReturnTo(params.returnTo);
  const errorText = formError || authError;

  useEffect(() => {
    if (!user) {
      return;
    }

    if (returnTo.startsWith('/order-review') && router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(returnTo);
  }, [returnTo, router, user]);

  const clearErrors = () => {
    if (formError) {
      setFormError('');
    }
    if (authError) {
      clearAuthError();
    }
  };

  const handleLogin = () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password.trim()) {
      setFormError(copy.login.missing);
      return;
    }

    setFormError('');
    void signInWithEmail({
      email: trimmedEmail,
      password,
    });
  };

  return (
    <CargoScreen
      backgroundColor="#FFFFFF"
      keyboardAvoiding
      contentContainerStyle={styles.content}>
      <CargoHeader
        title={copy.login.title}
        onLeftPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }
          router.replace('/home');
        }}
      />

      <TextInput
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          clearErrors();
        }}
        placeholder={copy.login.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        style={styles.input}
        placeholderTextColor="#94A3B8"
      />

      <PasswordInput
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          clearErrors();
        }}
        placeholder={copy.login.password}
        autoComplete="password"
        textContentType="password"
        onSubmitEditing={handleLogin}
      />

      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

      <PrimaryButton
        label={authenticating ? copy.login.submitting : copy.login.submit}
        onPress={handleLogin}
        style={authenticating ? styles.buttonDisabled : undefined}
      />

      <TouchableOpacity style={styles.forgotWrap} onPress={() => router.push('/forgot-password')}>
        <Text style={styles.forgotText}>{copy.login.forgot}</Text>
      </TouchableOpacity>

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{copy.login.noAccount}</Text>
        <TouchableOpacity onPress={() => router.push({ pathname: '/register', params: { returnTo } })}>
          <Text style={styles.footerLink}>{copy.common.register}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.legalText}>
        {copy.login.legal}{' '}
        <Text style={styles.legalLink} onPress={() => void Linking.openURL(TERMS_URL)}>
          {copy.login.terms}
        </Text>
        .
      </Text>
    </CargoScreen>
  );
}

export default function LoginScreen() {
  return (
    <AuthSessionBoundary>
      <LoginScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.text,
    marginBottom: 12,
  },
  errorText: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#DC2626',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  forgotWrap: {
    alignSelf: 'center',
    paddingVertical: 16,
  },
  forgotText: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  footerText: {
    fontSize: 14,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  footerLink: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
  legalText: {
    marginTop: 28,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  legalLink: {
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
});
