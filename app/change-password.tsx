import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FirebaseError } from 'firebase/app';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { cargoTheme } from '@/constants/cargo-theme';
import { useAppCopy } from '@/lib/app-copy';
import {
  getFirebasePasswordChangeErrorMessage,
  getFirebasePasswordResetErrorMessage,
} from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { auth } from '@/lib/firebase';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const screenScope = 'ChangePasswordScreen';

function ChangePasswordScreenContent() {
  const router = useRouter();
  const copy = useAppCopy();
  const { user } = useAuthSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNextPassword, setShowNextPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const email = user?.email?.trim().toLowerCase() || '';
  const trimmedCurrentPassword = currentPassword.trim();
  const trimmedNextPassword = nextPassword.trim();
  const trimmedConfirmPassword = confirmPassword.trim();
  const nextPasswordIsLongEnough = trimmedNextPassword.length >= 6;
  const passwordsMatch = trimmedNextPassword.length > 0 && trimmedNextPassword === trimmedConfirmPassword;
  const nextPasswordIsDifferent = trimmedNextPassword.length > 0 && trimmedNextPassword !== trimmedCurrentPassword;
  const canSubmit =
    !!user &&
    !!email &&
    trimmedCurrentPassword.length >= 6 &&
    nextPasswordIsLongEnough &&
    passwordsMatch &&
    nextPasswordIsDifferent &&
    !submitting &&
    !resetSubmitting;
  const canSendResetEmail = !!email && !submitting && !resetSubmitting;

  const helperText = useMemo(() => {
    if (error) {
      return error;
    }

    if (message) {
      return message;
    }

    if (!email) {
      return 'This account is missing an email address, so we cannot change the password from the app yet.';
    }

    if (!currentPassword.length) {
      return 'Enter your current password first so we can confirm this change.';
    }

    if (trimmedCurrentPassword.length < 6) {
      return 'Current password must be at least 6 characters.';
    }

    if (trimmedNextPassword.length < 6) {
      return 'Choose a new password with at least 6 characters.';
    }

    if (!nextPasswordIsDifferent) {
      return 'Choose a new password that is different from the current one.';
    }

    if (!trimmedConfirmPassword.length) {
      return 'Repeat the new password to confirm the change.';
    }

    if (!passwordsMatch && confirmPassword.length > 0) {
      return 'Repeat the new password exactly so both fields match.';
    }

    return 'Everything looks ready. Save the new password when you are ready.';
  }, [
    confirmPassword.length,
    currentPassword.length,
    email,
    error,
    message,
    nextPasswordIsDifferent,
    passwordsMatch,
    trimmedConfirmPassword.length,
    trimmedCurrentPassword.length,
    trimmedNextPassword.length,
  ]);

  const clearFeedback = () => {
    if (error) {
      setError('');
    }

    if (message) {
      setMessage('');
    }
  };

  const handleChangePassword = async () => {
    if (!user || !email || !canSubmit) {
      logWarning(screenScope, 'handleChangePassword skipped', {
        hasUser: Boolean(user),
        hasEmail: Boolean(email),
        canSubmit,
      });
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    logAsyncStart(screenScope, 'handleChangePassword', { email });

    try {
      const credential = EmailAuthProvider.credential(email, trimmedCurrentPassword);

      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, trimmedNextPassword);

      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setMessage('Password updated successfully. Use the new password the next time you sign in.');
      logAsyncSuccess(screenScope, 'handleChangePassword', { email });
    } catch (authError) {
      logAsyncFailure(screenScope, 'handleChangePassword', authError, { email });
      const nextError =
        authError instanceof FirebaseError
          ? getFirebasePasswordChangeErrorMessage(authError.code)
          : 'Unable to change your password right now. Please try again.';
      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!email || !canSendResetEmail) {
      logWarning(screenScope, 'handleSendResetEmail skipped', {
        hasEmail: Boolean(email),
        canSendResetEmail,
      });
      return;
    }

    setResetSubmitting(true);
    setError('');
    setMessage('');
    logAsyncStart(screenScope, 'handleSendResetEmail', { email });

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(`Password reset email sent to ${email}. Check your inbox and spam folder.`);
      logAsyncSuccess(screenScope, 'handleSendResetEmail', { email });
    } catch (authError) {
      logAsyncFailure(screenScope, 'handleSendResetEmail', authError, { email });
      const nextError =
        authError instanceof FirebaseError
          ? getFirebasePasswordResetErrorMessage(authError.code)
          : 'Unable to send the reset email right now. Please try again.';
      setError(nextError);
    } finally {
      setResetSubmitting(false);
    }
  };

  const bannerStyles = error
    ? [styles.banner, styles.errorBanner]
    : message
      ? [styles.banner, styles.successBanner]
      : [styles.banner, styles.infoBanner];
  const bannerIcon = error ? 'alert-circle-outline' : message ? 'check-decagram-outline' : 'shield-check-outline';
  const bannerTextStyle = error ? styles.errorBannerText : message ? styles.successBannerText : styles.infoBannerText;

  return (
    <CargoScreen scroll={false} contentContainerStyle={styles.screenContent}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <CargoHeader
            title={copy.password.title}
            onLeftPress={() => router.back()}
          />

          <View style={styles.heroCard}>
            <View style={styles.heroIconWrap}>
              <MaterialCommunityIcons name="lock-reset" size={24} color="#FFFFFF" />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Secure your sign-in</Text>
              <Text style={styles.heroSubtitle}>
                {email || 'Email unavailable'}
              </Text>
            </View>
          </View>

          <View style={bannerStyles}>
            <MaterialCommunityIcons name={bannerIcon} size={18} color={error ? '#B91C1C' : message ? '#166534' : cargoTheme.colors.primaryDark} />
            <Text style={bannerTextStyle}>{helperText}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Update password</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Current password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={currentPassword}
                  onChangeText={(value) => {
                    clearFeedback();
                    setCurrentPassword(value);
                  }}
                  placeholder="Enter your current password"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="none"
                  secureTextEntry={!showCurrentPassword}
                  style={styles.passwordInput}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowCurrentPassword((value) => !value)}>
                  <MaterialCommunityIcons
                    name={showCurrentPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={cargoTheme.colors.subtext}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>New password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={nextPassword}
                  onChangeText={(value) => {
                    clearFeedback();
                    setNextPassword(value);
                  }}
                  placeholder="Enter your new password"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="none"
                  secureTextEntry={!showNextPassword}
                  style={styles.passwordInput}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowNextPassword((value) => !value)}>
                  <MaterialCommunityIcons
                    name={showNextPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={cargoTheme.colors.subtext}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm new password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={confirmPassword}
                  onChangeText={(value) => {
                    clearFeedback();
                    setConfirmPassword(value);
                  }}
                  placeholder="Repeat your new password"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="none"
                  secureTextEntry={!showConfirmPassword}
                  style={styles.passwordInput}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword((value) => !value)}>
                  <MaterialCommunityIcons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={cargoTheme.colors.subtext}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <PrimaryButton
              label={submitting ? 'Saving password...' : 'Save new password'}
              icon={submitting ? undefined : 'content-save-outline'}
              onPress={canSubmit ? handleChangePassword : undefined}
              style={!canSubmit ? styles.buttonDisabled : undefined}
            />

            {submitting ? <ActivityIndicator color={cargoTheme.colors.primary} /> : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Forgot the current password?</Text>
            <Text style={styles.cardBody}>
              Send a reset email to the account address instead. You can create a fresh password from the link in that message.
            </Text>

            <PrimaryButton
              label={resetSubmitting ? 'Sending reset email...' : 'Send reset email'}
              icon={resetSubmitting ? undefined : 'email-fast-outline'}
              variant="secondary"
              onPress={canSendResetEmail ? handleSendResetEmail : undefined}
              style={!canSendResetEmail ? styles.buttonDisabled : undefined}
            />

            {resetSubmitting ? <ActivityIndicator color={cargoTheme.colors.primary} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </CargoScreen>
  );
}

export default function ChangePasswordScreen() {
  return (
    <AuthSessionBoundary>
      <ChangePasswordScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingBottom: 0,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#D7E1EA',
    fontSize: 13,
  },
  banner: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  infoBanner: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  successBanner: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  infoBannerText: {
    flex: 1,
    color: cargoTheme.colors.primaryDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  successBannerText: {
    flex: 1,
    color: '#166534',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  errorBannerText: {
    flex: 1,
    color: '#B91C1C',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  card: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    gap: 14,
  },
  cardTitle: {
    color: cargoTheme.colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  cardBody: {
    color: cargoTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: cargoTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  passwordInput: {
    flex: 1,
    minHeight: 54,
    paddingHorizontal: 16,
    color: cargoTheme.colors.text,
    fontSize: 15,
  },
  eyeButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
