import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { isExplicitSignOutActive } from '@/lib/auth-persistence';
import { confirmCarrierPhone, sendCarrierOtp, verifyCarrierOtp } from '@/lib/otp-api';
import { formatCountdown } from '@/lib/phone';
import {
  clearRegistrationDraft,
  getRegistrationDraft,
} from '@/lib/registration-draft';
import { uploadCarrierDocument } from '@/lib/document-upload';
import { useCarrierSession } from '@/providers/carrier-session';

/**
 * Registration-only phone OTP (final step before Waiting for Approval).
 * Login is email + password with no OTP.
 */
export default function OtpScreen() {
  const params = useLocalSearchParams<{
    phone?: string;
    purpose?: string;
    phoneMasked?: string;
    cooldown?: string;
    expires?: string;
    otpBypass?: string;
  }>();
  const { signUp, authenticating, user, carrier, needsCompanySetup } = useCarrierSession();

  const phone = String(params.phone || '');
  const purpose = String(params.purpose || 'signup');
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

  // Login/confirm OTP removed — only registration may use this screen.
  if (purpose !== 'signup') {
    return <Redirect href="/login" />;
  }

  if (!phone) {
    return <Redirect href="/register" />;
  }

  // Already finished registration (e.g. back navigation after success).
  if (!isExplicitSignOutActive() && user && !needsCompanySetup && carrier) {
    if (carrier.status === 'pending') return <Redirect href="/verification-pending" />;
    return <Redirect href="/(main)" />;
  }

  const completeSignup = async (ticket: string) => {
    const draft = getRegistrationDraft();
    if (!draft) {
      throw new Error('Registration session expired. Start again from company details.');
    }
    const loginEmail = draft.email.trim().toLowerCase();
    await signUp(loginEmail, draft.password, {
      companyName: draft.companyName.trim(),
      tradingName: draft.tradingName.trim(),
      brelaNumber: draft.brelaNumber,
      tin: draft.tin,
      businessLicence: draft.businessLicence,
      latraLicence: draft.latraLicence,
      contactPerson: draft.contactPerson,
      representativeTitle: draft.representativeTitle,
      representativeIdNumber: draft.representativeIdNumber,
      phone: draft.phone,
      businessEmail: (draft.businessEmail.trim() || loginEmail).toLowerCase(),
      region: draft.region,
      district: draft.district,
      physicalAddress: draft.physicalAddress,
      location: draft.physicalAddress,
      gpsLatitude: draft.gpsLatitude,
      gpsLongitude: draft.gpsLongitude,
      operatingStations: draft.operatingStations,
      documents: {},
      termsAccepted: true,
      privacyAccepted: true,
      phoneVerified: false,
      routeOrigin: draft.routeOrigin,
      routeDestination: draft.routeDestination,
      routeDepart: draft.routeDepart,
      cargoCapacityKg: Number(draft.cargoCapacityKg) || 0,
      coverageRegions: draft.coverage.coverageRegions,
      coverageAllTanzania: draft.coverage.coverageAllTanzania,
      coverageInternational: draft.coverage.coverageInternational,
      coverageInternationalCountries: draft.coverage.coverageInternationalCountries,
    });

    const { auth, db } = await import('@/lib/firebase');
    const current = auth.currentUser;
    if (!current) throw new Error('Account was not created.');
    const idToken = await current.getIdToken();

    const uploaded: Record<string, string> = {};
    for (const [key, docFile] of Object.entries(draft.docs)) {
      if (!docFile) continue;
      uploaded[key] = await uploadCarrierDocument(docFile, idToken);
    }

    const { doc, updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'carriers', current.uid), { documents: uploaded });

    await confirmCarrierPhone({
      phone: draft.phone,
      otpTicket: ticket,
      idToken,
      carrierId: current.uid,
    });

    clearRegistrationDraft();
    setSuccess('Phone verified');
    router.replace('/verification-pending');
  };

  const verify = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) {
      setError('Enter the 6-digit code from SMS.');
      return;
    }
    setVerifying(true);
    setError('');
    setSuccess('');
    try {
      const result = await verifyCarrierOtp(phone, digits);
      setPhoneMasked(result.phoneMasked);
      await completeSignup(result.otpTicket);
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
      const result = await sendCarrierOtp(phone, 'signup');
      setPhoneMasked(result.phoneMasked);
      setCooldown(result.cooldownSeconds || 60);
      setExpiresIn(result.expiresInSeconds || 300);
      if (result.otpBypass) setOtpBypass(true);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend.');
    } finally {
      setResending(false);
    }
  };

  const changePhone = () => {
    router.replace('/register');
  };

  return (
    <AuthShell
      title="Verify your phone"
      subtitle={
        otpBypass
          ? phoneMasked
            ? `SMS is temporarily unavailable. Enter any 6-digit code for ${phoneMasked}`
            : 'SMS is temporarily unavailable. Enter any 6-digit code to continue'
          : phoneMasked
            ? `Enter the 6-digit code sent to ${phoneMasked}`
            : 'Enter the 6-digit code from SMS'
      }
      centered
      stepLabel="Phone verification"
      onBack={changePhone}
      footer={
        <View style={styles.footerCol}>
          {!otpBypass ? (
            <Pressable
              onPress={() => void resend()}
              disabled={cooldown > 0 || resending}
              style={styles.resendWrap}
              accessibilityRole="button">
              <Text style={[styles.resend, (cooldown > 0 || resending) && styles.resendDisabled]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Resend code'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={changePhone} style={styles.changePhone} accessibilityRole="button">
            <Text style={styles.changePhoneText}>Change phone number</Text>
          </Pressable>
        </View>
      }>
      <OtpUnderlineInput value={code} onChange={setCode} editable={!verifying && !authenticating} />

      {otpBypass ? (
        <Text style={styles.bypassNote}>SMS delivery will resume after Sender ID approval.</Text>
      ) : (
        <Text style={styles.timer}>Code expires in {formatCountdown(expiresIn)}</Text>
      )}

      {success ? (
        <Animated.Text entering={FadeIn} style={styles.success}>
          {success}
        </Animated.Text>
      ) : null}

      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : null}

      <PrimaryButton
        label="Verify"
        loading={verifying || authenticating}
        onPress={() => void verify()}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  timer: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  bypassNote: {
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 17,
  },
  error: {
    color: theme.danger,
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: theme.success,
    marginBottom: 12,
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
  },
  footerCol: { alignItems: 'center', gap: 12 },
  resendWrap: { paddingVertical: 4 },
  resend: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.accent,
  },
  resendDisabled: { color: theme.muted },
  changePhone: { paddingVertical: 4 },
  changePhoneText: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
    textDecorationLine: 'underline',
  },
});
