import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { sendCarrierOtp, verifyCarrierOtp, type OtpPurpose } from '@/lib/otp-api';
import { formatCountdown } from '@/lib/phone';
import { useCarrierSession } from '@/providers/carrier-session';

export default function OtpScreen() {
  const params = useLocalSearchParams<{
    phone?: string;
    purpose?: string;
    phoneMasked?: string;
    cooldown?: string;
    expires?: string;
  }>();
  const { signInWithPhoneOtp, authenticating, user, carrier, needsCompanySetup } = useCarrierSession();

  const phone = String(params.phone || '');
  const purpose = (String(params.purpose || 'login') as OtpPurpose) === 'signup' ? 'signup' : 'login';
  const [code, setCode] = useState('');
  const [phoneMasked, setPhoneMasked] = useState(String(params.phoneMasked || ''));
  const [cooldown, setCooldown] = useState(Number(params.cooldown || 60) || 60);
  const [expiresIn, setExpiresIn] = useState(Number(params.expires || 300) || 300);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const id = setInterval(() => setExpiresIn((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [expiresIn]);

  if (!phone) return <Redirect href="/login" />;

  if (user && purpose === 'login') {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  const verify = async () => {
    if (code.replace(/\D/g, '').length < 4) {
      setError('Enter the full code.');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const result = await verifyCarrierOtp(phone, code);
      setPhoneMasked(result.phoneMasked);
      if (purpose === 'login') {
        await signInWithPhoneOtp(phone, result.otpTicket);
        return;
      }
      router.replace({
        pathname: '/register',
        params: { otpTicket: result.otpTicket, phone, phoneMasked: result.phoneMasked },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code.');
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError('');
    try {
      const result = await sendCarrierOtp(phone, purpose);
      setPhoneMasked(result.phoneMasked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresIn(result.expiresInSeconds || 300);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title="Enter verification code"
      subtitle={phoneMasked ? `Sent to ${phoneMasked}` : 'Check your SMS'}
      centered
      footer={
        <Pressable
          onPress={() => void resend()}
          disabled={cooldown > 0 || resending}
          style={styles.resendWrap}
          accessibilityRole="button">
          <Text style={[styles.resend, (cooldown > 0 || resending) && styles.resendDisabled]}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
          </Text>
        </Pressable>
      }>
      <OtpUnderlineInput value={code} onChange={setCode} editable={!verifying && !authenticating} />

      <View style={styles.timerRow}>
        <Text style={styles.timerLabel}>Code valid for </Text>
        <Ionicons name="time-outline" size={14} color={theme.muted} />
        <Text style={styles.timerValue}> {formatCountdown(expiresIn)}</Text>
      </View>

      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error}>
          {error}
        </Animated.Text>
      ) : null}

      <View style={styles.verifyWrap}>
        <PrimaryButton
          label="Verify"
          loading={verifying || authenticating}
          onPress={() => void verify()}
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  timerLabel: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  timerValue: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  verifyWrap: {
    alignSelf: 'center',
    width: '78%',
    minWidth: 180,
  },
  error: {
    color: theme.danger,
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  resendWrap: { paddingVertical: 4 },
  resend: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: theme.ink,
  },
  resendDisabled: { color: theme.muted },
});
