import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { CoveragePicker } from '@/components/coverage-picker';
import { Field, PrimaryButton } from '@/components/ui';
import { coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { pickDocument, pickImageDocument, type PickedDoc, uploadCarrierDocument } from '@/lib/document-upload';
import { confirmCarrierPhone, sendCarrierOtp, verifyCarrierOtp } from '@/lib/otp-api';
import { passwordsMatch, validatePassword } from '@/lib/password';
import { useCarrierSession } from '@/providers/carrier-session';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';
const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

const STEPS = [
  'Akaunti',
  'Kampuni',
  'Mwakilishi',
  'Anwani',
  'Coverage',
  'Hati',
  'OTP',
  'Sheria',
] as const;

type DocKey = 'brelaCert' | 'tinCert' | 'businessLicence' | 'latraLicence' | 'repId';

export default function RegisterScreen() {
  const { signUp, authenticating, authError, user, carrier, clearAuthError } = useCarrierSession();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [brelaNumber, setBrelaNumber] = useState('');
  const [tin, setTin] = useState('');
  const [businessLicence, setBusinessLicence] = useState('');
  const [latraLicence, setLatraLicence] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [representativeTitle, setRepresentativeTitle] = useState('');
  const [representativeIdNumber, setRepresentativeIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [physicalAddress, setPhysicalAddress] = useState('');
  const [operatingStations, setOperatingStations] = useState('');
  const [gpsLatitude, setGpsLatitude] = useState<number | null>(null);
  const [gpsLongitude, setGpsLongitude] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<CoverageSelection>(emptyCoverage());
  const [routeOrigin, setRouteOrigin] = useState('Dar es Salaam');
  const [routeDestination, setRouteDestination] = useState('');
  const [routeDepart, setRouteDepart] = useState('08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState('500');
  const [docs, setDocs] = useState<Partial<Record<DocKey, PickedDoc>>>({});
  const [otpCode, setOtpCode] = useState('');
  const [otpTicket, setOtpTicket] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [localError, setLocalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const error = localError || authError;
  const progress = useMemo(() => `${step + 1} / ${STEPS.length}`, [step]);

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
      setLocalError('Ruhusu eneo (GPS) ili kuhifadhi mahali pa ofisi.');
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
      if (!email.trim() || !email.includes('@')) nextErrors.email = 'Weka barua pepe sahihi.';
      const pw = validatePassword(password);
      if (pw) nextErrors.password = pw;
      const match = passwordsMatch(password, confirmPassword);
      if (match) nextErrors.confirmPassword = match;
    }
    if (step === 1) {
      if (!companyName.trim()) nextErrors.companyName = 'Jina la kampuni linahitajika.';
      if (!brelaNumber.trim()) nextErrors.brelaNumber = 'Namba ya BRELA inahitajika.';
      if (!tin.trim()) nextErrors.tin = 'TIN inahitajika.';
      if (!businessLicence.trim()) nextErrors.businessLicence = 'Leseni ya biashara inahitajika.';
    }
    if (step === 2) {
      if (!contactPerson.trim()) nextErrors.contactPerson = 'Jina la mwakilishi linahitajika.';
      if (!phone.trim() || phone.replace(/\D/g, '').length < 9) nextErrors.phone = 'Simu sahihi inahitajika.';
      if (!businessEmail.trim() || !businessEmail.includes('@')) {
        nextErrors.businessEmail = 'Barua pepe ya biashara inahitajika.';
      }
    }
    if (step === 3) {
      if (!physicalAddress.trim()) nextErrors.physicalAddress = 'Anwani ya ofisi inahitajika.';
      if (gpsLatitude == null || gpsLongitude == null) {
        setLocalError('Chukua GPS ya ofisi / kituo.');
        setFieldErrors(nextErrors);
        return false;
      }
      if (!operatingStations.trim()) nextErrors.operatingStations = 'Orodhesha vituo / coverage stations.';
    }
    if (step === 4) {
      if (!coverageIsValid(coverage)) {
        setLocalError('Chagua angalau mkoa, mikoa yote, au nje ya nchi.');
        return false;
      }
      if (!routeDestination.trim()) nextErrors.routeDestination = 'Weka marudio ya njia ya kwanza.';
    }
    if (step === 5) {
      if (!docs.brelaCert || !docs.tinCert || !docs.businessLicence || !docs.repId) {
        setLocalError('Pakia hati zinazohitajika: BRELA, TIN, leseni, na kitambulisho cha mwakilishi.');
        return false;
      }
    }
    if (step === 6) {
      if (!otpTicket) {
        setLocalError('Thibitisha simu kwa OTP kwanza.');
        return false;
      }
    }
    if (step === 7) {
      if (!termsAccepted) {
        setLocalError('Kubali Terms of Service na Privacy Policy ili kuendelea.');
        return false;
      }
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return false;
    return true;
  };

  const sendOtp = async () => {
    setOtpSending(true);
    setLocalError('');
    try {
      const result = await sendCarrierOtp(phone);
      setPhoneMasked(result.phoneMasked);
      setOtpCooldown(result.cooldownSeconds || 60);
      const timer = setInterval(() => {
        setOtpCooldown((n) => {
          if (n <= 1) {
            clearInterval(timer);
            return 0;
          }
          return n - 1;
        });
      }, 1000);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Imeshindwa kutuma OTP.');
    } finally {
      setOtpSending(false);
    }
  };

  const verifyOtp = async () => {
    setOtpVerifying(true);
    setLocalError('');
    try {
      const result = await verifyCarrierOtp(phone, otpCode);
      setOtpTicket(result.otpTicket);
      setPhoneMasked(result.phoneMasked);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'OTP si sahihi.');
    } finally {
      setOtpVerifying(false);
    }
  };

  const submit = async () => {
    if (!validateStep()) return;
    try {
      await signUp(email, password, {
        companyName,
        brelaNumber,
        tin,
        businessLicence,
        latraLicence,
        contactPerson,
        representativeTitle,
        representativeIdNumber,
        phone,
        businessEmail,
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
      });

      // After auth user exists, upload docs + confirm phone via secure ticket.
      const { auth } = await import('@/lib/firebase');
      const current = auth.currentUser;
      if (!current) throw new Error('Akaunti haikuundwa.');
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
        otpTicket,
        idToken,
        carrierId: current.uid,
      });

      router.replace('/verification-pending');
    } catch {
      // authError already set by provider when Firebase fails
    }
  };

  const next = () => {
    if (!validateStep()) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      if (step + 1 === 6 && !otpTicket && !otpSending) {
        void sendOtp();
      }
      return;
    }
    void submit();
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
        <Text style={styles.docName}>{docs[docKey]?.name || 'Haijachaguliwa'}</Text>
      </View>
      <View style={styles.docActions}>
        <Pressable onPress={() => void setDoc(docKey, 'image')} style={styles.docBtn}>
          <Text style={styles.docBtnText}>Picha</Text>
        </Pressable>
        <Pressable onPress={() => void setDoc(docKey, 'file')} style={styles.docBtn}>
          <Text style={styles.docBtnText}>Faili</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <AuthShell
      title="Jisajili"
      subtitle={`${STEPS[step]} · Hatua ${progress}`}
      footer={
        step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={styles.linkWrap}>
            <Text style={styles.link}>Rudi hatua iliyopita</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
            <Text style={styles.muted}>
              Tayari una akaunti? <Text style={styles.link}>Ingia</Text>
            </Text>
          </Pressable>
        )
      }>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
      </View>

      {step === 0 && (
        <>
          <Field label="Barua pepe ya kuingia" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} error={fieldErrors.email} />
          <Field label="Nenosiri" secureTextEntry value={password} onChangeText={setPassword} error={fieldErrors.password} hint="Angalau herufi 8, herufi + namba." />
          <Field label="Thibitisha nenosiri" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} error={fieldErrors.confirmPassword} />
        </>
      )}

      {step === 1 && (
        <>
          <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} error={fieldErrors.companyName} />
          <Field label="Namba ya usajili BRELA" value={brelaNumber} onChangeText={setBrelaNumber} error={fieldErrors.brelaNumber} />
          <Field label="TIN" value={tin} onChangeText={setTin} error={fieldErrors.tin} />
          <Field label="Leseni ya biashara (namba)" value={businessLicence} onChangeText={setBusinessLicence} error={fieldErrors.businessLicence} />
          <Field label="Leseni ya LATRA (ikiwa inahitajika)" value={latraLicence} onChangeText={setLatraLicence} hint="Acha wazi ikiwa haitumiki." />
        </>
      )}

      {step === 2 && (
        <>
          <Field label="Jina la mwakilishi aliyeidhinishwa" value={contactPerson} onChangeText={setContactPerson} error={fieldErrors.contactPerson} />
          <Field label="Cheo / title" value={representativeTitle} onChangeText={setRepresentativeTitle} />
          <Field label="Namba ya kitambulisho" value={representativeIdNumber} onChangeText={setRepresentativeIdNumber} />
          <Field label="Simu (itathibitishwa kwa OTP)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} error={fieldErrors.phone} />
          <Field label="Barua pepe ya biashara" autoCapitalize="none" keyboardType="email-address" value={businessEmail} onChangeText={setBusinessEmail} error={fieldErrors.businessEmail} />
        </>
      )}

      {step === 3 && (
        <>
          <Field label="Anwani ya ofisi" value={physicalAddress} onChangeText={setPhysicalAddress} error={fieldErrors.physicalAddress} />
          <Field
            label="Vituo / stations za kufanya kazi"
            value={operatingStations}
            onChangeText={setOperatingStations}
            error={fieldErrors.operatingStations}
            hint="Mfano: Kariakoo, Ubungo, Mwanza terminal"
          />
          <PrimaryButton
            label={gpsLatitude != null ? `GPS ✓ ${gpsLatitude.toFixed(4)}, ${gpsLongitude?.toFixed(4)}` : 'Chukua GPS ya ofisi'}
            variant="outline"
            onPress={() => void captureGps()}
          />
        </>
      )}

      {step === 4 && (
        <>
          <CoveragePicker value={coverage} onChange={setCoverage} />
          <Field label="Njia: Kutoka" value={routeOrigin} onChangeText={setRouteOrigin} />
          <Field label="Njia: Kwenda" value={routeDestination} onChangeText={setRouteDestination} error={fieldErrors.routeDestination} />
          <Field label="Muda wa kuondoka (HH:MM)" value={routeDepart} onChangeText={setRouteDepart} />
          <Field label="Uwezo wa mzigo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />
        </>
      )}

      {step === 5 && (
        <>
          <Text style={styles.hint}>Pakia nakala (picha au PDF). Hati zinahitajika kwa uthibitisho.</Text>
          <DocButton label="Cheti / usajili BRELA" docKey="brelaCert" required />
          <DocButton label="Cheti cha TIN" docKey="tinCert" required />
          <DocButton label="Leseni ya biashara" docKey="businessLicence" required />
          <DocButton label="Leseni LATRA" docKey="latraLicence" />
          <DocButton label="Kitambulisho cha mwakilishi" docKey="repId" required />
        </>
      )}

      {step === 6 && (
        <>
          <Text style={styles.hint}>
            Tumeweka SMS OTP kwa {phoneMasked || phone}. Weka msimbo uliopokea.
          </Text>
          <Field label="Msimbo wa OTP" keyboardType="number-pad" value={otpCode} onChangeText={setOtpCode} maxLength={8} />
          {otpTicket ? <Text style={styles.ok}>Simu imethibitishwa ✓</Text> : null}
          <PrimaryButton label="Thibitisha OTP" loading={otpVerifying} onPress={() => void verifyOtp()} disabled={Boolean(otpTicket)} />
          <View style={styles.gap} />
          <PrimaryButton
            label={otpCooldown > 0 ? `Tuma tena (${otpCooldown}s)` : 'Tuma OTP tena'}
            variant="outline"
            loading={otpSending}
            disabled={otpCooldown > 0 || Boolean(otpTicket)}
            onPress={() => void sendOtp()}
          />
        </>
      )}

      {step === 7 && (
        <>
          <Pressable
            onPress={() => setTermsAccepted((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}>
            <View style={[styles.checkbox, termsAccepted && styles.checkboxOn]}>
              {termsAccepted ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>
              Nakubali{' '}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                Terms of Service
              </Text>{' '}
              na{' '}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Baada ya kusajili, hali itakuwa pending hadi HAUL ithibitishe kampuni.
          </Text>
        </>
      )}

      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error}>
          {error}
        </Animated.Text>
      ) : null}

      <PrimaryButton
        label={step === STEPS.length - 1 ? 'Unda akaunti' : 'Endelea'}
        loading={authenticating && step === STEPS.length - 1}
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
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 19,
    color: theme.muted,
    marginBottom: 12,
  },
  error: { color: theme.danger, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13 },
  ok: { color: theme.success, marginBottom: 12, fontFamily: typography.semibold, fontSize: 13 },
  gap: { height: 10 },
  linkWrap: { marginTop: 4 },
  link: { color: theme.ink, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
  docRow: {
    borderWidth: 1,
    borderColor: theme.border,
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
    backgroundColor: theme.tile,
  },
  docBtnText: { fontFamily: typography.semibold, fontSize: 12, color: theme.ink },
  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14 },
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
});
