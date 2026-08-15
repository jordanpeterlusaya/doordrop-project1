import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { PasswordInput } from '@/components/password-input';
import { PhoneInput } from '@/components/phone-input';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { resolveAuthReturnTo } from '@/lib/auth-navigation';
import { useAppCopy } from '@/lib/app-copy';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';
const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

function RegisterScreenContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { authError, authenticating, clearAuthError, registerWithEmail, user } = useAuthSession();
  const copy = useAppCopy();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
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

  const handleRegister = () => {
    const trimmedFullName = fullName.trim();
    const trimmedPhoneNumber = phoneNumber.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedFullName || !trimmedPhoneNumber || !trimmedEmail || !password.trim()) {
      setFormError(copy.register.missing);
      return;
    }

    if (trimmedPhoneNumber.replace(/\D/g, '').length < 11) {
      setFormError(copy.register.invalidPhone);
      return;
    }

    if (password.length < 6) {
      setFormError(copy.register.shortPassword);
      return;
    }

    if (password !== confirmPassword) {
      setFormError(copy.register.mismatch);
      return;
    }

    if (!acceptedTerms) {
      setFormError(copy.register.termsRequired);
      return;
    }

    setFormError('');
    void registerWithEmail({
      fullName: trimmedFullName,
      phoneNumber: trimmedPhoneNumber,
      email: trimmedEmail,
      password,
    });
  };

  return (
    <CargoScreen backgroundColor="#FFFFFF" keyboardAvoiding contentContainerStyle={styles.content}>
      <CargoHeader
        title={copy.register.title}
        onLeftPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }
          router.replace('/login');
        }}
      />

      <TextInput
        value={fullName}
        onChangeText={(value) => {
          setFullName(value);
          clearErrors();
        }}
        placeholder={copy.register.fullName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        style={styles.input}
        placeholderTextColor="#94A3B8"
      />

      <PhoneInput
        value={phoneNumber}
        onChangeText={(value) => {
          setPhoneNumber(value);
          clearErrors();
        }}
      />

      <TextInput
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          clearErrors();
        }}
        placeholder={copy.register.email}
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
        placeholder={copy.register.password}
        autoComplete="password-new"
        textContentType="newPassword"
      />

      <PasswordInput
        value={confirmPassword}
        onChangeText={(value) => {
          setConfirmPassword(value);
          clearErrors();
        }}
        placeholder={copy.register.confirmPassword}
        textContentType="newPassword"
        onSubmitEditing={handleRegister}
      />

      <View style={styles.termsRow}>
        <TouchableOpacity
          activeOpacity={0.88}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptedTerms }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            setAcceptedTerms((current) => !current);
            clearErrors();
          }}
          style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
          {acceptedTerms ? <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" /> : null}
        </TouchableOpacity>
        <Text style={styles.termsText}>
          {copy.register.agree}{' '}
          <Text style={styles.termsLink} onPress={() => void Linking.openURL(TERMS_URL)}>
            {copy.register.terms}
          </Text>{' '}
          {copy.register.and}{' '}
          <Text style={styles.termsLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
            {copy.register.privacy}
          </Text>
        </Text>
      </View>

      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

      <PrimaryButton
        label={authenticating ? copy.register.submitting : copy.register.submit}
        onPress={handleRegister}
        style={authenticating ? styles.buttonDisabled : undefined}
      />

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>{copy.register.haveAccount}</Text>
        <TouchableOpacity onPress={() => router.push({ pathname: '/login', params: { returnTo } })}>
          <Text style={styles.footerLink}>{copy.common.login}</Text>
        </TouchableOpacity>
      </View>
    </CargoScreen>
  );
}

export default function RegisterScreen() {
  return (
    <AuthSessionBoundary>
      <RegisterScreenContent />
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
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
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
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
    marginBottom: 16,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: cargoTheme.colors.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  termsLink: {
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
  },
});
