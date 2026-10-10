import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { AuthShell } from '@/components/auth-shell';
import { CoveragePicker } from '@/components/coverage-picker';
import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { Field, PrimaryButton } from '@/components/ui';
import { coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { pickDocument, pickImageDocument, type PickedDoc, uploadCarrierDocument } from '@/lib/document-upload';
import { confirmCarrierPhone, sendCarrierOtp, verifyCarrierOtp } from '@/lib/otp-api';
import { generateAccountPassword } from '@/lib/password';
import { formatCountdown, isValidTzPhone } from '@/lib/phone';
import { useCarrierSession } from '@/providers/carrier-session';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';
const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

const STEPS = ['Company', 'Business', 'Coverage'] as const;

type DocKey = 'brelaCert' | 'tinCert' | 'businessLicence' | 'latraLicence' | 'repId';
type Phase = 'form' | 'otp';

export default function RegisterScreen() {
  const { signUp, authenticating, authError, user, carrier, clearAuthError } = useCarrierSession();
  const [phase, setPhase] = useState<Phase>('form');
  const [step, setStep] = useState(0);

  const [companyName, setCompanyName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [representativeTitle, setRepresentativeTitle] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [physicalAddress, setPhysicalAddress] = useState('');

  const [brelaNumber, setBrelaNumber] = useState('');
  const [tin, setTin] = useState('');
  const [businessLicence, setBusinessLicence] = useState('');
  const [latraLicence, setLatraLicence] = useState('');
  const [representativeIdNumber, setRepresentativeIdNumber] = useState('');
  const [operatingStations, setOperatingStations] = useState('');
  const [gpsLatitude, setGpsLatitude] = useState<number | null>(null);
  const [gpsLongitude, setGpsLongitude] = useState<number | null>(null);
  const [docs, setDocs] = useState<Partial<Record<DocKey, PickedDoc>>>({});

  const [coverage, setCoverage] = useState<CoverageSelection>(emptyCoverage());
  const [routeOrigin, setRouteOrigin] = useState('Dar es Salaam');
  const [routeDestination, setRouteDestination] = useState('');
  const [routeDepart, setRouteDepart] = useState('08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState('500');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [otpCode, setOtpCode] = useState('');
  const [otpTicket, setOtpTicket] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpExpires, setOtpExpires] = useState(300);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState('');

  const [localError, setLocalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const error = localError || authError;
  const progress = useMemo(() => `${step + 1} / ${STEPS.length}`, [step]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = setInterval(() => setOtpCooldown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [otpCooldown]);

  useEffect(() => {
    if (phase !== 'otp' || otpExpires <= 0) return;
    const id = setInterval(() => setOtpExpires((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [phase, otpExpires]);

  if (user && carrier?.status === 'verified') return <Redirect href="/(main)" />;
  if (user && carrier?.status === 'pending') return <Redirect href="/verification-pending" />;

  const setDoc = async (key: DocKey, mode: 'file' | 'image') => {
    const picked = mode === 'image' ? await pickImageDocument(key) : await pickDocument(key);
    if (!picked) return;
    setDocs((prev) => ({ ...prev, [key]: picked }));
  };

  const captureGps = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setLocalError('Allow location to save office GPS.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setGpsLatitude(pos.coords.latitude);
    setGpsLongitude(pos.coords.longitude);
    setLocalError('');
  };

  const validateStep = (): boolean => {
    const nextErrors: Record<string, string> = {};
    clearAuthError();
    setLocalError('');

    if (step === 0) {
      if (!companyName.trim()) nextErrors.companyName = 'Company name required.';
      if (!email.trim() || !email.includes('@')) nextErrors.email = 'Valid email required.';
      if (!isValidTzPhone(phone)) nextErrors.phone = 'Valid phone required.';
      if (!contactPerson.trim()) nextErrors.contactPerson = 'Contact person required.';
      if (!physicalAddress.trim()) nextErrors.physicalAddress = 'Office address required.';
    }
    if (step === 1) {
      if (!brelaNumber.trim()) nextErrors.brelaNumber = 'BRELA number required.';
      if (!tin.trim()) nextErrors.tin = 'TIN / TRA number required.';
      if (!businessLicence.trim()) nextErrors.businessLicence = 'Business licence required.';
      if (!operatingStations.trim()) nextErrors.operatingStations = 'Stations / locations required.';
      if (gpsLatitude == null || gpsLongitude == null) {
        setLocalError('Capture office GPS.');
        setFieldErrors(nextErrors);
        return false;
      }
      if (!docs.brelaCert || !docs.tinCert || !docs.businessLicence || !docs.repId) {
        setLocalError('Upload BRELA, TIN, licence, and ID documents.');
        setFieldErrors(nextErrors);
        return false;
      }
    }
    if (step === 2) {
      if (!coverageIsValid(coverage)) {
        setLocalError('Select regions, all Tanzania, or outside countries.');
        return false;
      }
      if (!routeDestination.trim()) nextErrors.routeDestination = 'Primary route destination required.';
      if (!termsAccepted) {
        setLocalError('Accept Terms and Privacy to continue.');
        setFieldErrors(nextErrors);
        return false;
      }
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const sendOtp = async () => {
    setOtpSending(true);
    setLocalError('');
    try {
      const result = await sendCarrierOtp(phone, 'signup');
      setPhoneMasked(result.phoneMasked);
      setOtpCooldown(result.cooldownSeconds || 60);
      setOtpExpires(result.expiresInSeconds || 300);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not send OTP.');
      throw e;
    } finally {
      setOtpSending(false);
    }
  };

  const submitAfterOtp = async (ticket: string) => {
    const password = generateAccountPassword();
    const loginEmail = email.trim().toLowerCase();
    await signUp(loginEmail, password, {
      companyName: tradingName.trim() ? `${companyName.trim()} (${tradingName.trim()})` : companyName,
      brelaNumber,
      tin,
      businessLicence,
      latraLicence,
      contactPerson,
      representativeTitle,
      representativeIdNumber,
      phone,
      businessEmail: (businessEmail.trim() || loginEmail).toLowerCase(),
      physicalAddress,
      location: physicalAddress,
      gpsLatitude,
      gpsLongitude,
      operatingStations,
      documents: {},
      termsAccepted: true,
      privacyAccepted: true,
      phoneVerified: false,
      routeOrigin,
      routeDestination,
      routeDepart,
      cargoCapacityKg: Number(cargoCapacityKg) || 0,
      coverageRegions: coverage.coverageRegions,
      coverageAllTanzania: coverage.coverageAllTanzania,
      coverageInternational: coverage.coverageInternational,
      coverageInternationalCountries: coverage.coverageInternationalCountries,
    });

    const { auth } = await import('@/lib/firebase');
    const current = auth.currentUser;
    if (!current) throw new Error('Account was not created.');
    const idToken = await current.getIdToken();

    const uploaded: Record<string, string> = {};
    for (const [key, docFile] of Object.entries(docs)) {
      if (!docFile) continue;
      uploaded[key] = await uploadCarrierDocument(docFile, idToken);
    }

    const { doc, updateDoc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    await updateDoc(doc(db, 'carriers', current.uid), { documents: uploaded });

    await confirmCarrierPhone({
      phone,
      otpTicket: ticket,
      idToken,
      carrierId: current.uid,
    });

    router.replace('/verification-pending');
  };

  const verifyAndSubmit = async () => {
    setOtpVerifying(true);
    setLocalError('');
    try {
      let ticket = otpTicket;
      if (!ticket) {
        const result = await verifyCarrierOtp(phone, otpCode);
        ticket = result.otpTicket;
        setOtpTicket(ticket);
        setPhoneMasked(result.phoneMasked);
      }
      await submitAfterOtp(ticket);
    } catch (e) {
      if (!(e instanceof Error && authError)) {
        setLocalError(e instanceof Error ? e.message : 'Could not complete signup.');
      }
    } finally {
      setOtpVerifying(false);
    }
  };

  const next = () => {
    if (!validateStep()) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setPhase('otp');
    setOtpCode('');
    setOtpTicket('');
    void sendOtp().catch(() => undefined);
  };

  const DocButton = ({
    label,
    docKey,
    required,
  }: {
    label: string;
    docKey: DocKey;
    required?: boolean;
  }) => (
    <View style={styles.docRow}>
      <View style={styles.docMeta}>
        <Text style={styles.docLabel}>
          {label}
          {required ? ' *' : ''}
        </Text>
        <Text style={styles.docName}>{docs[docKey]?.name || 'Not selected'}</Text>
      </View>
      <View style={styles.docActions}>
        <Pressable onPress={() => void setDoc(docKey, 'image')} style={styles.docBtn}>
          <Text style={styles.docBtnText}>Photo</Text>
        </Pressable>
        <Pressable onPress={() => void setDoc(docKey, 'file')} style={styles.docBtn}>
          <Text style={styles.docBtnText}>File</Text>
        </Pressable>
      </View>
    </View>
  );

  if (phase === 'otp') {
    return (
      <AuthShell
        title="Enter verification code"
        subtitle={phoneMasked ? `Sent to ${phoneMasked}` : 'Confirm your phone'}
        centered
        footer={
          <Pressable
            onPress={() => void sendOtp()}
            disabled={otpCooldown > 0 || otpSending}
            style={styles.linkWrap}>
            <Text style={[styles.link, (otpCooldown > 0 || otpSending) && styles.linkMuted]}>
              {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend Code'}
            </Text>
          </Pressable>
        }>
        <OtpUnderlineInput
          value={otpCode}
          onChange={setOtpCode}
          editable={!otpVerifying && !authenticating}
        />
        <View style={styles.timerRow}>
          <Text style={styles.timerLabel}>Code valid for </Text>
          <Ionicons name="time-outline" size={14} color={theme.muted} />
          <Text style={styles.timerValue}> {formatCountdown(otpExpires)}</Text>
        </View>
        {otpTicket ? <Text style={styles.ok}>Phone verified ✓</Text> : null}
        {error ? (
          <Animated.Text entering={FadeIn} style={styles.error}>
            {error}
          </Animated.Text>
        ) : null}
        <View style={styles.verifyWrap}>
          <PrimaryButton
            label="Verify"
            loading={otpVerifying || authenticating || otpSending}
            onPress={() => void verifyAndSubmit()}
          />
        </View>
        <Pressable
          onPress={() => {
            setPhase('form');
            setStep(2);
          }}
          style={styles.backForm}>
          <Text style={styles.linkMuted}>Back to coverage</Text>
        </Pressable>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create account"
      subtitle={`${STEPS[step]} · ${progress}`}
      footer={
        step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={styles.linkWrap}>
            <Text style={styles.link}>Previous step</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
            <Text style={styles.muted}>
              Already registered? <Text style={styles.link}>Sign in</Text>
            </Text>
          </Pressable>
        )
      }>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
      </View>

      {step === 0 && (
        <>
          <Field
            label="Company name"
            value={companyName}
            onChangeText={setCompanyName}
            error={fieldErrors.companyName}
          />
          <Field
            label="Trading name (optional)"
            value={tradingName}
            onChangeText={setTradingName}
          />
          <Field
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
          />
          <Field
            label="Phone"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            error={fieldErrors.phone}
          />
          <Field
            label="Contact person"
            value={contactPerson}
            onChangeText={setContactPerson}
            error={fieldErrors.contactPerson}
          />
          <Field label="Title (optional)" value={representativeTitle} onChangeText={setRepresentativeTitle} />
          <Field
            label="Business email (optional)"
            autoCapitalize="none"
            keyboardType="email-address"
            value={businessEmail}
            onChangeText={setBusinessEmail}
            hint="Defaults to login email."
          />
          <Field
            label="Office address"
            value={physicalAddress}
            onChangeText={setPhysicalAddress}
            error={fieldErrors.physicalAddress}
          />
        </>
      )}

      {step === 1 && (
        <>
          <Field
            label="BRELA number"
            value={brelaNumber}
            onChangeText={setBrelaNumber}
            error={fieldErrors.brelaNumber}
          />
          <Field label="TIN / TRA" value={tin} onChangeText={setTin} error={fieldErrors.tin} />
          <Field
            label="Business licence number"
            value={businessLicence}
            onChangeText={setBusinessLicence}
            error={fieldErrors.businessLicence}
          />
          <Field
            label="LATRA licence (if any)"
            value={latraLicence}
            onChangeText={setLatraLicence}
          />
          <Field
            label="Representative ID number"
            value={representativeIdNumber}
            onChangeText={setRepresentativeIdNumber}
          />
          <Field
            label="Stations / locations"
            value={operatingStations}
            onChangeText={setOperatingStations}
            error={fieldErrors.operatingStations}
            hint="e.g. Kariakoo, Ubungo"
          />
          <PrimaryButton
            label={
              gpsLatitude != null
                ? `GPS ✓ ${gpsLatitude.toFixed(4)}, ${gpsLongitude?.toFixed(4)}`
                : 'Capture office GPS'
            }
            variant="outline"
            onPress={() => void captureGps()}
          />
          <View style={styles.gap} />
          <Text style={styles.hint}>Required documents</Text>
          <DocButton label="BRELA certificate" docKey="brelaCert" required />
          <DocButton label="TIN certificate" docKey="tinCert" required />
          <DocButton label="Business licence" docKey="businessLicence" required />
          <DocButton label="LATRA licence" docKey="latraLicence" />
          <DocButton label="Representative ID" docKey="repId" required />
        </>
      )}

      {step === 2 && (
        <>
          <CoveragePicker value={coverage} onChange={setCoverage} />
          <Field label="Route from" value={routeOrigin} onChangeText={setRouteOrigin} />
          <Field
            label="Route to"
            value={routeDestination}
            onChangeText={setRouteDestination}
            error={fieldErrors.routeDestination}
          />
          <Field label="Depart (HH:MM)" value={routeDepart} onChangeText={setRouteDepart} />
          <Field
            label="Capacity (kg)"
            keyboardType="numeric"
            value={cargoCapacityKg}
            onChangeText={setCargoCapacityKg}
          />
          <Pressable
            onPress={() => setTermsAccepted((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}>
            <View style={[styles.checkbox, termsAccepted && styles.checkboxOn]}>
              {termsAccepted ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>
              I agree to{' '}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>
        </>
      )}

      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error}>
          {error}
        </Animated.Text>
      ) : null}

      <PrimaryButton
        label={step === STEPS.length - 1 ? 'Continue' : 'Continue'}
        loading={authenticating}
        onPress={next}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  progressTrack: {
    height: 4,
    borderRadius: 99,
    backgroundColor: theme.tile,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: theme.ink },
  hint: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginBottom: 10,
    marginTop: 4,
  },
  error: { color: theme.danger, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13 },
  ok: { color: theme.success, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13, textAlign: 'center' },
  gap: { height: 10 },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
  linkMuted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
  docRow: {
    backgroundColor: theme.tile,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  docMeta: { marginBottom: 8 },
  docLabel: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  docName: { fontFamily: typography.body, fontSize: 12, color: theme.muted, marginTop: 2 },
  docActions: { flexDirection: 'row', gap: 8 },
  docBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: theme.white,
  },
  docBtnText: { fontFamily: typography.semibold, fontSize: 12, color: theme.ink },
  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, marginTop: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  checkMark: { color: theme.primary, fontFamily: typography.bold, fontSize: 12 },
  termsText: { flex: 1, fontFamily: typography.body, fontSize: 14, lineHeight: 21, color: theme.ink },
  termsLink: { fontFamily: typography.bold, textDecorationLine: 'underline' },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  timerLabel: { fontFamily: typography.body, fontSize: 13, color: theme.muted },
  timerValue: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  verifyWrap: { alignSelf: 'center', width: '78%', minWidth: 180 },
  backForm: { marginTop: 16, alignItems: 'center' },
});
