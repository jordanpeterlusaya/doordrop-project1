import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { confirmCarrierPhone, sendCarrierOtp, verifyCarrierOtp, type OtpPurpose } from '@/lib/otp-api';
import { formatCountdown } from '@/lib/phone';
import {
  clearRegistrationDraft,
  getRegistrationDraft,
} from '@/lib/registration-draft';
import { uploadCarrierDocument } from '@/lib/document-upload';
import { useCarrierSession } from '@/providers/carrier-session';

function resolvePurpose(raw: string): OtpPurpose {
  if (raw === 'signup') return 'signup';
  if (raw === 'confirm') return 'confirm';
  return 'login';
}

export default function OtpScreen() {
  const params = useLocalSearchParams<{
    phone?: string;
    purpose?: string;
    phoneMasked?: string;
    cooldown?: string;
    expires?: string;
    carrierId?: string;
  }>();
  const { signInWithPhoneOtp, signUp, authenticating, user, carrier, needsCompanySetup } =
    useCarrierSession();

  const phone = String(params.phone || '');
  const purpose = resolvePurpose(String(params.purpose || 'login'));
  const [code, setCode] = useState('');
  const [phoneMasked, setPhoneMasked] = useState(String(params.phoneMasked || ''));
  const [cooldown, setCooldown] = useState(Number(params.cooldown || 60) || 60);
  const [expiresIn, setExpiresIn] = useState(Number(params.expires || 300) || 300);
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

  // Session restore / deep link: send a real SMS if we landed without a fresh send.
  useEffect(() => {
    if (!phone || purpose === 'signup') return;
    if (params.phoneMasked || Number(params.cooldown || 0) > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await sendCarrierOtp(phone, purpose);
        if (cancelled) return;
        setPhoneMasked(result.phoneMasked);
        setCooldown(result.cooldownSeconds || 60);
        setExpiresIn(result.expiresInSeconds || 300);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not send verification SMS.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally once on mount for this phone/purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!phone) {
    return <Redirect href={purpose === 'signup' ? '/register' : '/login'} />;
  }

  if (user && purpose === 'login') {
    if (needsCompanySetup) return <Redirect href="/register-company" />;
    if (carrier?.status === 'pending') return <Redirect href="/verification-pending" />;
    if (carrier || user.email?.toLowerCase() === 'boyzeus11@gmail.com') {
      return <Redirect href="/(main)" />;
    }
  }

  if (user && purpose === 'confirm' && carrier?.phoneVerified) {
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

  const completeConfirm = async (ticket: string) => {
    const { auth } = await import('@/lib/firebase');
    const current = auth.currentUser;
    if (!current) throw new Error('Sign in again, then verify your phone.');
    const idToken = await current.getIdToken();
    await confirmCarrierPhone({
      phone,
      otpTicket: ticket,
      idToken,
      carrierId: String(params.carrierId || current.uid),
    });
    setSuccess('Phone verified');
    const { doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const snap = await getDoc(doc(db, 'carriers', String(params.carrierId || current.uid)));
    const status = String(snap.data()?.status || 'pending');
    router.replace(status === 'pending' ? '/verification-pending' : '/(main)');
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
      if (purpose === 'login') {
        await signInWithPhoneOtp(phone, result.otpTicket);
        return;
      }
      if (purpose === 'signup') {
        await completeSignup(result.otpTicket);
        return;
      }
      await completeConfirm(result.otpTicket);
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

  const changePhone = () => {
    if (purpose === 'signup') {
      router.replace('/register');
      return;
    }
    if (purpose === 'confirm') {
      router.replace('/login');
      return;
    }
    router.replace('/login');
  };

  return (
    <AuthShell
      title="Verify your phone"
      subtitle={
        phoneMasked
          ? `Enter the 6-digit code sent to ${phoneMasked}`
          : 'Enter the 6-digit code from SMS'
      }
      centered
      stepLabel={purpose === 'signup' ? 'Phone verification' : undefined}
      onBack={changePhone}
      footer={
        <View style={styles.footerCol}>
          <Pressable
            onPress={() => void resend()}
            disabled={cooldown > 0 || resending}
            style={styles.resendWrap}
            accessibilityRole="button">
            <Text style={[styles.resend, (cooldown > 0 || resending) && styles.resendDisabled]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable onPress={changePhone} style={styles.changePhone} accessibilityRole="button">
            <Text style={styles.changePhoneText}>Change phone number</Text>
          </Pressable>
        </View>
      }>
      <OtpUnderlineInput value={code} onChange={setCode} editable={!verifying && !authenticating} />

      <Text style={styles.timer}>
        Code expires in {formatCountdown(expiresIn)}
      </Text>

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
