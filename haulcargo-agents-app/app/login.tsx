import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { sendCarrierOtp } from '@/lib/otp-api';
import { isValidTzPhone } from '@/lib/phone';
import { useCarrierSession } from '@/providers/carrier-session';

export default function LoginScreen() {
  const { authenticating, user, needsCompanySetup, carrier } = useCarrierSession();
  const [phone, setPhone] = useState('');
  const [localError, setLocalError] = useState('');
  const [sending, setSending] = useState(false);

  if (user && !needsCompanySetup && (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com')) {
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    return <Redirect href="/(main)" />;
  }
  if (user && needsCompanySetup) return <Redirect href="/register-company" />;

  const sendCode = async () => {
    if (!isValidTzPhone(phone)) {
      setLocalError('Enter a valid phone number.');
      return;
    }
    setSending(true);
    setLocalError('');
    try {
      const result = await sendCarrierOtp(phone, 'login');
      router.push({
        pathname: '/otp',
        params: {
          phone,
          purpose: 'login',
          phoneMasked: result.phoneMasked,
          cooldown: String(result.cooldownSeconds || 60),
          expires: String(result.expiresInSeconds || 300),
        },
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not send code.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in with your company phone."
      footer={
        <Pressable onPress={() => router.replace('/register')} style={styles.linkWrap}>
          <Text style={styles.muted}>
            New company? <Text style={styles.link}>Register</Text>
          </Text>
        </Pressable>
      }>
      <Field
        label="Phone"
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="07XX XXX XXX"
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          setLocalError('');
        }}
      />
      {localError ? (
        <Animated.Text entering={FadeIn.duration(200)} style={styles.error}>
          {localError}
        </Animated.Text>
      ) : null}
      <PrimaryButton
        label="Send code"
        loading={sending || authenticating}
        onPress={() => void sendCode()}
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
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
});
