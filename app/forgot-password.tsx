import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { sendPasswordResetEmail } from 'firebase/auth';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { useAppCopy } from '@/lib/app-copy';
import { getFirebasePasswordResetErrorMessage } from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { auth } from '@/lib/firebase';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const screenScope = 'ForgotPasswordScreen';

export default function ForgotPassword() {
  const router = useRouter();
  const copy = useAppCopy();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const seededEmail = typeof params.email === 'string' ? params.email : '';
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const emailLooksValid = /\S+@\S+\.\S+/.test(email.trim());

  const helperText = useMemo(() => {
    if (error) {
      return error;
    }

    if (message) {
      return message;
    }

    if (!email.length) {
      return copy.forgot.empty;
    }

    if (!emailLooksValid) {
      return copy.forgot.invalid;
    }

    return copy.forgot.willSend.replace('{email}', email.trim().toLowerCase());
  }, [copy.forgot.empty, copy.forgot.invalid, copy.forgot.willSend, email, emailLooksValid, error, message]);

  useEffect(() => {
    if (seededEmail && !email.length) {
      setEmail(seededEmail);
    }
  }, [email.length, seededEmail]);

  const sendReset = async () => {
    if (!emailLooksValid || submitting) {
      logWarning(screenScope, 'sendReset skipped', {
        emailLooksValid,
        submitting,
      });
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    logAsyncStart(screenScope, 'sendPasswordResetEmail', { email: email.trim().toLowerCase() });

    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setMessage(copy.forgot.sent);
      logAsyncSuccess(screenScope, 'sendPasswordResetEmail', { email: email.trim().toLowerCase() });
    } catch (authError) {
      logAsyncFailure(screenScope, 'sendPasswordResetEmail', authError, {
        email: email.trim().toLowerCase(),
      });
      const nextError =
        authError instanceof FirebaseError
          ? getFirebasePasswordResetErrorMessage(authError.code)
          : copy.forgot.failed;
      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.forgot.title}</Text>
          <Text style={styles.subtitle}>{copy.forgot.subtitle}</Text>

          <View style={styles.form}>
            <TextInput
              placeholder="you@example.com"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (error) {
                  setError('');
                }
                if (message) {
                  setMessage('');
                }
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />

            <Text style={error ? styles.errorText : message ? styles.successText : styles.helperText}>{helperText}</Text>

            <TouchableOpacity
              style={[styles.button, (!emailLooksValid || submitting) && styles.buttonDisabled]}
              disabled={!emailLooksValid || submitting}
              onPress={sendReset}>
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{copy.forgot.submit}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/login')}>
              <Text style={styles.secondaryButtonText}>{copy.forgot.back}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: cargoTheme.colors.canvas,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  subtitle: {
    color: cargoTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
  },
  form: {
    gap: 12,
  },
  input: {
    height: 54,
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    color: cargoTheme.colors.text,
    fontSize: 15,
  },
  button: {
    height: 52,
    backgroundColor: cargoTheme.colors.primary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    color: cargoTheme.colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    lineHeight: 18,
  },
  helperText: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  successText: {
    color: '#15803D',
    fontSize: 13,
    lineHeight: 18,
  },
});
