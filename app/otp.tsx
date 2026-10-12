import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { resolveAuthReturnTo } from '@/lib/auth-navigation';
import { auth } from '@/lib/firebase';
import {
  confirmCustomerPhone,
  formatOtpCountdown,
  sendCustomerOtp,
  verifyCustomerOtp,
} from '@/lib/otp-api';
import {
  clearRegistrationDraft,
  getRegistrationDraft,
} from '@/lib/registration-draft';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

function OtpScreenContent() {
  const router = useRouter();
  const copy = useAppCopy();
  const { language } = useLanguage();
  const sw = language === 'sw';
  const params = useLocalSearchParams<{
    phone?: string;
    phoneMasked?: string;
    cooldown?: string;
    expires?: string;
    otpBypass?: string;
    returnTo?: string;
  }>();
  const { authenticating, registerWithEmail, user } = useAuthSession();

  const phone = String(params.phone || '');
  const returnTo = resolveAuthReturnTo(params.returnTo);
  const [code, setCode] = useState('');
  const [phoneMasked, setPhoneMasked] = useState(String(params.phoneMasked || ''));
  const [cooldown, setCooldown] = useState(Number(params.cooldown || 60) || 60);
  const [expiresIn, setExpiresIn] = useState(Number(params.expires || 300) || 300);
  const [otpBypass, setOtpBypass] = useState(
    params.otpBypass === '1' || params.otpBypass === 'true'
  );
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [completed, setCompleted] = useState(false);

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

  useEffect(() => {
    if (!completed || !user) return;
    router.replace(returnTo);
  }, [completed, returnTo, router, user]);

  if (!phone) {
    return <Redirect href="/register" />;
  }

  if (user && completed) {
    return null;
  }

  const completeSignup = async (ticket: string) => {
    const draft = await getRegistrationDraft();
    if (!draft) {
      throw new Error(
        sw
          ? 'Kipindi cha usajili kimeisha. Anza upya.'
          : 'Registration session expired. Start again from the form.'
      );
    }

    await registerWithEmail({
      fullName: draft.fullName,
      phoneNumber: draft.phoneNumber,
      email: draft.email,
      password: draft.password,
    });

    const current = auth.currentUser;
    if (!current) {
      throw new Error(sw ? 'Akaunti haikuundwa.' : 'Account was not created.');
    }
    const idToken = await current.getIdToken();

    await confirmCustomerPhone({
      phone: draft.phoneNumber,
      otpTicket: ticket,
      idToken,
    });

    await clearRegistrationDraft();
    setSuccess(sw ? 'Simu imethibitishwa' : 'Phone verified');
    setCompleted(true);
  };

  const verify = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) {
      setError(copy.otp.enterCode);
      return;
    }
    setVerifying(true);
    setError('');
    setSuccess('');
    try {
      const result = await verifyCustomerOtp(phone, digits);
      setPhoneMasked(result.phoneMasked);
      await completeSignup(result.otpTicket);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.otp.invalidCode);
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError('');
    try {
      const result = await sendCustomerOtp(phone, 'signup');
      setPhoneMasked(result.phoneMasked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresIn(result.expiresInSeconds || 300);
      if (result.otpBypass) setOtpBypass(true);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.otp.resendFailed);
    } finally {
      setResending(false);
    }
  };

  const changePhone = () => {
    router.replace({
      pathname: '/register',
      params: params.returnTo ? { returnTo: String(params.returnTo) } : undefined,
    });
  };

  const subtitle = otpBypass
    ? phoneMasked
      ? copy.otp.bypassSubtitle.replace('{phone}', phoneMasked)
      : copy.otp.bypassSubtitleAny
    : phoneMasked
      ? copy.otp.subtitle.replace('{phone}', phoneMasked)
      : copy.otp.subtitleGeneric;

  return (
    <CargoScreen backgroundColor="#FFFFFF" keyboardAvoiding contentContainerStyle={styles.content}>
      <CargoHeader title={copy.otp.title} onLeftPress={changePhone} />

      <Text style={styles.subtitle}>{subtitle}</Text>

      <OtpUnderlineInput value={code} onChange={setCode} editable={!verifying && !authenticating} />

      {otpBypass ? (
        <Text style={styles.bypassNote}>{copy.otp.bypassNote}</Text>
      ) : (
        <Text style={styles.timer}>
          {copy.otp.expiresIn.replace('{time}', formatOtpCountdown(expiresIn))}
        </Text>
      )}

      {success ? <Text style={styles.success}>{success}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        label={verifying || authenticating ? copy.otp.verifying : copy.otp.verify}
        onPress={() => void verify()}
        style={verifying || authenticating ? styles.buttonDisabled : undefined}
        disabled={verifying || authenticating}
      />

      <View style={styles.footerCol}>
        {!otpBypass ? (
          <Pressable
            onPress={() => void resend()}
            disabled={cooldown > 0 || resending}
            style={styles.resendWrap}
            accessibilityRole="button">
            <Text style={[styles.resend, (cooldown > 0 || resending) && styles.resendDisabled]}>
              {cooldown > 0
                ? copy.otp.resendIn.replace('{n}', String(cooldown))
                : resending
                  ? copy.otp.sending
                  : copy.otp.resend}
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={changePhone} style={styles.changePhone} accessibilityRole="button">
          <Text style={styles.changePhoneText}>{copy.otp.changePhone}</Text>
        </Pressable>
      </View>
    </CargoScreen>
  );
}

export default function OtpScreen() {
  return (
    <AuthSessionBoundary>
      <OtpScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  timer: {
    fontFamily: typography.body,
    fontSize: 13,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
    marginBottom: 16,
  },
  bypassNote: {
    fontFamily: typography.body,
    fontSize: 12,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 17,
  },
  error: {
    color: '#DC2626',
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: cargoTheme.colors.success,
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  footerCol: {
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  resendWrap: { paddingVertical: 4 },
  resend: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: cargoTheme.colors.primaryDark,
  },
  resendDisabled: { color: cargoTheme.colors.subtext },
  changePhone: { paddingVertical: 4 },
  changePhoneText: {
    fontFamily: typography.body,
    fontSize: 13,
    color: cargoTheme.colors.subtext,
    textDecorationLine: 'underline',
  },
});
