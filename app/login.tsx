import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { resolveAuthReturnTo } from '@/lib/auth-navigation';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';

function LoginScreenContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { authError, authenticating, clearAuthError, signInWithEmail, user } = useAuthSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const returnTo = resolveAuthReturnTo(params.returnTo);

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

  const handleLogin = () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !password.trim()) {
      setFormError('Enter your email and password to continue.');
      return;
    }

    setFormError('');
    void signInWithEmail({
      email: trimmedEmail,
      password,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <MaterialCommunityIcons name="shield-account-outline" size={18} color={cargoTheme.colors.primaryDark} />
            <Text style={styles.badgeText}>Email sign in</Text>
          </View>

          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Login to finish your DoorDrop order</Text>
            <Text style={styles.cardSubtitle}>
              Use your DoorDrop email and password. Once you sign in, your order review will still be waiting.
            </Text>
          </View>

          <View style={styles.helperBanner}>
            <MaterialCommunityIcons
              name={authError || formError ? 'alert-circle-outline' : 'information-outline'}
              size={18}
              color={authError || formError ? '#DC2626' : cargoTheme.colors.info}
            />
            <Text style={styles.helperText}>
              {authError || formError || 'Login uses the same customer account details you created when registering.'}
            </Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Email address</Text>
            <TextInput
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (formError) {
                  setFormError('');
                }
                if (authError) {
                  clearAuthError();
                }
              }}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (formError) {
                  setFormError('');
                }
                if (authError) {
                  clearAuthError();
                }
              }}
              placeholder="Enter password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <PrimaryButton label={authenticating ? 'Logging in...' : 'Login to complete'} onPress={handleLogin} />

          <TouchableOpacity style={styles.resetLinkWrap} onPress={() => router.push('/forgot-password')}>
            <Text style={styles.resetLink}>Forgot password?</Text>
          </TouchableOpacity>

          <View style={styles.legalCard}>
            <Text style={styles.legalText}>
              By continuing, you agree to the{' '}
              <Text style={styles.legalLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                Terms & Conditions
              </Text>
              .
            </Text>
          </View>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Don&apos;t have an account?</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: '/register', params: { returnTo } })}>
              <Text style={styles.footerLink}>Register here</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  safeArea: {
    flex: 1,
    backgroundColor: cargoTheme.colors.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    justifyContent: 'center',
  },
  card: {
    borderRadius: cargoTheme.radius.xl,
    backgroundColor: cargoTheme.colors.surface,
    padding: 20,
    gap: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ECFDF5',
  },
  badgeText: {
    color: cargoTheme.colors.primaryDark,
    fontSize: 12,
    fontFamily: typography.bold,
  },
  cardHeader: {
    gap: 6,
  },
  cardTitle: {
    color: cargoTheme.colors.text,
    fontSize: 24,
    fontFamily: typography.extrabold,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    color: cargoTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  helperBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  helperText: {
    flex: 1,
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  formGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: cargoTheme.colors.text,
    fontSize: 13,
    fontFamily: typography.bold,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D9E2EC',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: cargoTheme.colors.text,
    backgroundColor: '#FFFFFF',
  },
  resetLinkWrap: {
    alignSelf: 'center',
  },
  resetLink: {
    color: cargoTheme.colors.info,
    fontSize: 13,
    fontFamily: typography.bold,
  },
  legalCard: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  legalText: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  legalLink: {
    color: cargoTheme.colors.primary,
    fontFamily: typography.bold,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
  },
  footerLink: {
    color: cargoTheme.colors.primary,
    fontSize: 13,
    fontFamily: typography.bold,
  },
});
