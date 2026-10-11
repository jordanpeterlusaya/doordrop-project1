import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Redirect, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { StepProgress } from '@/components/step-progress';
import { Field, PrimaryButton } from '@/components/ui';
import {
  coverageIsValid,
  coverageSummary,
  emptyCoverage,
  type CoverageSelection,
} from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { getCoverageDraft, getCoverageDraftStamp, setCoverageDraft } from '@/lib/coverage-draft';
import { pickDocument, pickImageDocument, type PickedDoc } from '@/lib/document-upload';
import { sendCarrierOtp } from '@/lib/otp-api';
import { passwordsMatch, validatePassword } from '@/lib/password';
import { isValidTzPhone } from '@/lib/phone';
import {
  saveRegistrationDraft,
  type DocKey,
  type RegistrationDraft,
} from '@/lib/registration-draft';
import { useCarrierSession } from '@/providers/carrier-session';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';
const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

const STEPS = ['Company', 'Verification', 'Approval'] as const;

export default function RegisterScreen() {
  const { authenticating, authError, user, carrier, clearAuthError } = useCarrierSession();
  const [step, setStep] = useState(0);

  const [companyName, setCompanyName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [representativeTitle, setRepresentativeTitle] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
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

  const [localError, setLocalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (getCoverageDraftStamp() > 0) {
        setCoverage(getCoverageDraft());
      }
    }, [])
  );

  const error = localError || authError;

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

  const buildDraft = (): RegistrationDraft => ({
    companyName,
    tradingName,
    email,
    password,
    phone,
    contactPerson,
    representativeTitle,
    businessEmail,
    region,
    district,
    physicalAddress,
    brelaNumber,
    tin,
    businessLicence,
    latraLicence,
    representativeIdNumber,
    operatingStations,
    gpsLatitude,
    gpsLongitude,
    docs,
    coverage,
    routeOrigin,
    routeDestination,
    routeDepart,
    cargoCapacityKg,
    termsAccepted,
  });

  const validateStep = (): boolean => {
    const nextErrors: Record<string, string> = {};
    clearAuthError();
    setLocalError('');

    if (step === 0) {
      if (!companyName.trim()) nextErrors.companyName = 'Registered company name required.';
      if (!email.trim() || !email.includes('@')) nextErrors.email = 'Valid business email required.';
      const pwError = validatePassword(password);
      if (pwError) nextErrors.password = pwError;
      const matchError = passwordsMatch(password, confirmPassword);
      if (matchError) nextErrors.confirmPassword = matchError;
      if (!isValidTzPhone(phone)) nextErrors.phone = 'Valid +255 / 07XX phone required.';
      if (!contactPerson.trim()) nextErrors.contactPerson = 'Company contact person required.';
      if (!region.trim()) nextErrors.region = 'Region required.';
      if (!district.trim()) nextErrors.district = 'District required.';
      if (!physicalAddress.trim()) nextErrors.physicalAddress = 'Physical address required.';
      if (!coverageIsValid(coverage)) {
        setLocalError('Select operating coverage: regions, all Tanzania, or international countries.');
        setFieldErrors(nextErrors);
        return false;
      }
      if (!routeDestination.trim()) nextErrors.routeDestination = 'Primary route destination required.';
    }

    if (step === 1) {
      if (!brelaNumber.trim()) nextErrors.brelaNumber = 'BRELA number required.';
      if (!tin.trim()) nextErrors.tin = 'TIN required.';
      if (!businessLicence.trim()) nextErrors.businessLicence = 'Business licence number required.';
      if (!operatingStations.trim()) nextErrors.operatingStations = 'Stations / locations required.';
      if (gpsLatitude == null || gpsLongitude == null) {
        setLocalError('Capture office GPS so dispatch can locate your desk.');
        setFieldErrors(nextErrors);
        return false;
      }
      if (!docs.brelaCert || !docs.tinCert || !docs.businessLicence || !docs.repId) {
        setLocalError('Upload BRELA, TIN, business licence, and representative ID.');
        setFieldErrors(nextErrors);
        return false;
      }
      if (!termsAccepted) {
        setLocalError('Accept Terms of Service and Privacy Policy to continue.');
        setFieldErrors(nextErrors);
        return false;
      }
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitAndSendOtp = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    setLocalError('');
    try {
      saveRegistrationDraft(buildDraft());
      const result = await sendCarrierOtp(phone, 'signup');
      router.push({
        pathname: '/otp',
        params: {
          phone,
          purpose: 'signup',
          phoneMasked: result.phoneMasked,
          cooldown: String(result.cooldownSeconds || 60),
          expires: String(result.expiresInSeconds || 300),
          ...(result.otpBypass ? { otpBypass: '1' } : {}),
        },
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not send OTP.');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!validateStep()) return;
    if (step === 0) {
      setStep(1);
      return;
    }
    void submitAndSendOtp();
  };

  const DocButton = ({
    label,
    docKey,
    required,
    hint,
  }: {
    label: string;
    docKey: DocKey;
    required?: boolean;
    hint?: string;
  }) => (
    <View style={styles.docRow}>
      <View style={styles.docMeta}>
        <Text style={styles.docLabel}>
          {label}
          {required ? ' *' : ''}
        </Text>
        {hint ? <Text style={styles.docHint}>{hint}</Text> : null}
        <Text style={styles.docName}>{docs[docKey]?.name || 'No file selected'}</Text>
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

  return (
    <AuthShell
      title={step === 0 ? 'Company information' : 'Government & business'}
      subtitle={
        step === 0
          ? 'Tell us about your registered carrier company and where you operate.'
          : 'Verify BRELA, TIN, licences, and accept HAUL policies.'
      }
      stepLabel={`Step ${step + 1} of ${STEPS.length}`}
      footer={
        step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={styles.linkWrap}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
            <Text style={styles.muted}>
              Already registered? <Text style={styles.link}>Sign in</Text>
            </Text>
          </Pressable>
        )
      }>
      <StepProgress steps={STEPS} active={step} />

      {step === 0 && (
        <>
          <Field
            label="Registered company name"
            value={companyName}
            onChangeText={setCompanyName}
            error={fieldErrors.companyName}
          />
          <Field label="Trading name" value={tradingName} onChangeText={setTradingName} hint="Optional DBA / brand name." />
          <Field
            label="Business email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
            hint="Used to sign in."
          />
          <Field
            label="Password"
            secureTextEntry
            secureToggle
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            hint="At least 8 characters with a letter and a number."
          />
          <Field
            label="Confirm password"
            secureTextEntry
            secureToggle
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={fieldErrors.confirmPassword}
          />
          <Field
            label="Phone"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            error={fieldErrors.phone}
            hint="+255 / 07XX — we’ll SMS a real OTP next."
          />
          <Field
            label="Region"
            value={region}
            onChangeText={setRegion}
            error={fieldErrors.region}
            placeholder="e.g. Dar es Salaam"
          />
          <Field
            label="District"
            value={district}
            onChangeText={setDistrict}
            error={fieldErrors.district}
            placeholder="e.g. Ilala"
          />
          <Field
            label="Physical address"
            value={physicalAddress}
            onChangeText={setPhysicalAddress}
            error={fieldErrors.physicalAddress}
          />
          <Field
            label="Company contact person"
            value={contactPerson}
            onChangeText={setContactPerson}
            error={fieldErrors.contactPerson}
          />
          <Field
            label="Title (optional)"
            value={representativeTitle}
            onChangeText={setRepresentativeTitle}
          />
          <Field
            label="Alternate business email (optional)"
            autoCapitalize="none"
            keyboardType="email-address"
            value={businessEmail}
            onChangeText={setBusinessEmail}
          />

          <Text style={styles.section}>Operating coverage</Text>
          <Text style={styles.sectionHint}>
            Used for carrier matching — regions, all Tanzania, and/or international countries.
          </Text>
          <Pressable
            onPress={() => {
              setCoverageDraft(coverage);
              router.push({ pathname: '/operation-coverage', params: { mode: 'register' } });
            }}
            style={({ pressed }) => [styles.coverageCard, pressed && styles.coverageCardPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open operation coverage">
            <View style={styles.coverageCardTop}>
              <Text style={styles.coverageCardTitle}>Eneo la operesheni</Text>
              <Ionicons name="chevron-forward" size={18} color={theme.muted} />
            </View>
            <Text style={styles.coverageCardValue} numberOfLines={2}>
              {coverageSummary(coverage)}
            </Text>
            <Text style={styles.coverageCardHint}>Tafuta na chagua mikoa, au mikoa yote</Text>
          </Pressable>
          <Field label="Primary route from" value={routeOrigin} onChangeText={setRouteOrigin} />
          <Field
            label="Primary route to"
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
        </>
      )}

      {step === 1 && (
        <>
          <Text style={styles.sectionHint}>
            Clear scans of BRELA, TIN, and licences speed up HAUL review. Transport permits (LATRA)
            are optional if not applicable.
          </Text>
          <Field
            label="BRELA number"
            value={brelaNumber}
            onChangeText={setBrelaNumber}
            error={fieldErrors.brelaNumber}
          />
          <Field label="TIN" value={tin} onChangeText={setTin} error={fieldErrors.tin} />
          <Field
            label="Business licence number"
            value={businessLicence}
            onChangeText={setBusinessLicence}
            error={fieldErrors.businessLicence}
          />
          <Field
            label="Transport permit / LATRA (if any)"
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
                ? `GPS saved · ${gpsLatitude.toFixed(4)}, ${gpsLongitude?.toFixed(4)}`
                : 'Capture office GPS'
            }
            variant="outline"
            onPress={() => void captureGps()}
          />
          <View style={styles.gap} />
          <Text style={styles.section}>Required documents</Text>
          <DocButton
            label="BRELA certificate"
            docKey="brelaCert"
            required
            hint="Company registration extract"
          />
          <DocButton label="TIN certificate" docKey="tinCert" required hint="TRA TIN certificate" />
          <DocButton
            label="Business licence"
            docKey="businessLicence"
            required
            hint="Municipal / BRELA licence"
          />
          <DocButton label="LATRA / transport permit" docKey="latraLicence" hint="If you hold one" />
          <DocButton label="Representative ID" docKey="repId" required hint="NIDA or passport" />

          <Pressable
            onPress={() => setTermsAccepted((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}>
            <View style={[styles.checkbox, termsAccepted && styles.checkboxOn]}>
              {termsAccepted ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
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
        <Animated.Text entering={FadeIn} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : null}

      <PrimaryButton
        label={step === 0 ? 'Continue' : 'Submit & verify phone'}
        loading={authenticating || submitting}
        onPress={next}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  section: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginBottom: 8,
    marginTop: 8,
  },
  sectionHint: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: theme.muted,
    marginBottom: 12,
  },
  error: { color: theme.danger, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13, lineHeight: 18 },
  gap: { height: 10 },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.accent, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
  docRow: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    padding: 12,
    marginBottom: 10,
    backgroundColor: theme.white,
  },
  docMeta: { marginBottom: 8 },
  docLabel: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  docHint: { fontFamily: typography.body, fontSize: 12, color: theme.muted, marginTop: 2 },
  docName: { fontFamily: typography.body, fontSize: 12, color: theme.muted, marginTop: 4 },
  docActions: { flexDirection: 'row', gap: 8 },
  docBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.tile,
  },
  docBtnText: { fontFamily: typography.semibold, fontSize: 12, color: theme.ink },
  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, marginTop: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: '#000000', borderColor: '#000000' },
  checkMark: { color: theme.white, fontFamily: typography.bold, fontSize: 12 },
  termsText: { flex: 1, fontFamily: typography.body, fontSize: 14, lineHeight: 21, color: theme.ink },
  termsLink: { fontFamily: typography.semibold, color: theme.ink, textDecorationLine: 'underline' },
  coverageCard: {
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.white,
    padding: 14,
    marginBottom: 14,
  },
  coverageCardPressed: { opacity: 0.92, backgroundColor: theme.tile },
  coverageCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  coverageCardTitle: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
  },
  coverageCardValue: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.ink,
  },
  coverageCardHint: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
});
