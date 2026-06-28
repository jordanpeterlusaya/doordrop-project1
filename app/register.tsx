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

function RegisterScreenContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const { authError, authenticating, clearAuthError, registerWithEmail, user } = useAuthSession();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const returnTo = resolveAuthReturnTo(params.returnTo);
  const TERMS_URL = 'https://doordrop-terms.vercel.app/';
  const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

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

  const handleRegister = () => {
    const trimmedFullName = fullName.trim();
    const trimmedPhoneNumber = phoneNumber.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedFullName || !trimmedPhoneNumber || !trimmedEmail || !password.trim()) {
      setFormError('Fill in full name, phone number, email and password.');
      return;
    }

    if (password.length < 6) {
      setFormError('Password must have at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Password confirmation does not match.');
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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <MaterialCommunityIcons name="account-check-outline" size={18} color={cargoTheme.colors.primaryDark} />
            <Text style={styles.badgeText}>Fast onboarding</Text>
          </View>

          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Create your DoorDrop account</Text>
            <Text style={styles.cardSubtitle}>
              Register with your full name, phone number, email and password, then return and complete your order.
            </Text>
          </View>

          <View style={styles.infoCard}>
            <MaterialCommunityIcons
              name={authError || formError ? 'alert-circle-outline' : 'shield-check-outline'}
              size={18}
              color={authError || formError ? '#DC2626' : cargoTheme.colors.primary}
            />
            <Text style={styles.infoText}>
              {authError || formError || 'We use these details for customer identity, order updates and driver contact.'}
            </Text>
          </View>

          <View style={styles.termsCard}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={cargoTheme.colors.primaryDark} />
            <View style={styles.termsCopy}>
              <Text style={styles.termsText}>
                By continuing, you agree to the{' '}
                <Text style={styles.termsLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                  Terms & Conditions
                </Text>{' '}
                and{' '}
                <Text style={styles.termsLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput
              value={fullName}
              onChangeText={(value) => {
                setFullName(value);
                if (formError) {
                  setFormError('');
                }
                if (authError) {
                  clearAuthError();
                }
              }}
              placeholder="Enter your full name"
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              value={phoneNumber}
              onChangeText={(value) => {
                setPhoneNumber(value);
                if (formError) {
                  setFormError('');
                }
                if (authError) {
                  clearAuthError();
                }
              }}
              placeholder="+255 7XX XXX XXX"
              keyboardType="phone-pad"
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
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
              placeholder="Create password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Confirm password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                if (formError) {
                  setFormError('');
                }
                if (authError) {
                  clearAuthError();
                }
              }}
              placeholder="Repeat password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <PrimaryButton label={authenticating ? 'Creating account...' : 'Register to continue'} onPress={handleRegister} />

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Already have a DoorDrop account?</Text>
            <TouchableOpacity onPress={() => router.push({ pathname: '/login', params: { returnTo } })}>
              <Text style={styles.footerLink}>Login here</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  infoText: {
    flex: 1,
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  termsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#F8FAFC',
  },
  termsCopy: {
    flex: 1,
  },
  termsText: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  termsLink: {
    color: cargoTheme.colors.primary,
    fontFamily: typography.bold,
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
