import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { CoveragePicker } from '@/components/coverage-picker';
import { RegionSelect } from '@/components/region-select';
import { StepProgress } from '@/components/step-progress';
import { Field, PrimaryButton } from '@/components/ui';
import { TZ_REGIONS, coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { isExplicitSignOutActive } from '@/lib/auth-persistence';
import { sendCarrierOtp } from '@/lib/otp-api';
import { passwordsMatch, validatePassword } from '@/lib/password';
import { isValidTzPhone } from '@/lib/phone';
import { saveRegistrationDraft } from '@/lib/registration-draft';
import { useCarrierSession } from '@/providers/carrier-session';

const TERMS_URL = 'https://doordrop-terms.vercel.app/';
const PRIVACY_URL = 'https://doordrop-terms.vercel.app/privacy.html';

const STEPS = ['Company', 'Phone', 'Approval'] as const;

export default function RegisterScreen() {
  const { authenticating, authError, user, carrier, clearAuthError } = useCarrierSession();

  const [companyName, setCompanyName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [coverage, setCoverage] = useState<CoverageSelection>(emptyCoverage());
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [localError, setLocalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const error = localError || authError;

  if (!isExplicitSignOutActive() && user && carrier?.status === 'verified') return <Redirect href="/(main)" />;
  if (!isExplicitSignOutActive() && user && carrier?.status === 'pending') return <Redirect href="/verification-pending" />;

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    clearAuthError();
    setLocalError('');

    if (!companyName.trim()) nextErrors.companyName = 'Registered company name required.';
    if (!email.trim() || !email.includes('@')) nextErrors.email = 'Valid business email required.';
    const pwError = validatePassword(password);
    if (pwError) nextErrors.password = pwError;
    const matchError = passwordsMatch(password, confirmPassword);
    if (matchError) nextErrors.confirmPassword = matchError;
    if (!isValidTzPhone(phone)) nextErrors.phone = 'Enter a valid +255 phone number.';
    if (!(TZ_REGIONS as readonly string[]).includes(region)) {
      nextErrors.region = 'Select the region where your company is based.';
    }
    if (!coverageIsValid(coverage)) {
      setLocalError('Choose coverage: All, selected regions, or intra-city.');
    }
    if (!termsAccepted) {
      setLocalError('Accept Terms of Service and Privacy Policy to continue.');
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 && coverageIsValid(coverage) && termsAccepted;
  };

  const submitAndSendOtp = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setLocalError('');
    try {
      saveRegistrationDraft({
        companyName,
        tradingName,
        email,
        password,
        phone,
        region,
        coverage,
        termsAccepted,
      });
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

  return (
    <AuthShell
      title="Register your company"
      subtitle="Details HAUL uses to match orders. Phone verification is the last step."
      stepLabel="Step 1 of 3"
      footer={
        <Pressable onPress={() => router.replace('/login')} style={styles.linkWrap}>
          <Text style={styles.muted}>
            Already registered? <Text style={styles.link}>Sign in</Text>
          </Text>
        </Pressable>
      }>
      <StepProgress steps={STEPS} active={0} />

      <Field
        label="Registered company name"
        value={companyName}
        onChangeText={setCompanyName}
        error={fieldErrors.companyName}
        autoCapitalize="words"
      />
      <Field
        label="Trading name"
        value={tradingName}
        onChangeText={setTradingName}
        autoCapitalize="words"
      />
      <Field
        label="Business email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        placeholder="name@company.co.tz"
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
        placeholder="+2557XXXXXXXX"
      />

      <RegionSelect
        value={region}
        onChange={(next) => {
          setRegion(next);
          setFieldErrors((current) => ({ ...current, region: '' }));
        }}
        error={fieldErrors.region}
      />

      <Text style={styles.section}>Coverage</Text>
      <CoveragePicker value={coverage} onChange={setCoverage} baseRegion={region} />

      <Pressable
        onPress={() => setTermsAccepted((current) => !current)}
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

      {error ? (
        <Animated.Text entering={FadeIn} style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Animated.Text>
      ) : null}

      <PrimaryButton label="Continue" loading={authenticating || submitting} onPress={() => void submitAndSendOtp()} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  section: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginBottom: 8,
  },
  error: {
    color: theme.danger,
    marginBottom: 12,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
  },
  linkWrap: { marginTop: 4, alignItems: 'center' },
  link: { color: theme.accent, fontFamily: typography.bold, fontSize: 14 },
  muted: { color: theme.muted, fontFamily: typography.body, fontSize: 14 },
  termsRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, marginTop: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    backgroundColor: theme.white,
  },
  checkboxOn: { backgroundColor: '#000000', borderColor: '#000000' },
  checkMark: { color: theme.white, fontFamily: typography.bold, fontSize: 12 },
  termsText: { flex: 1, fontFamily: typography.body, fontSize: 13, lineHeight: 19, color: theme.ink },
  termsLink: { fontFamily: typography.semibold, color: theme.ink, textDecorationLine: 'underline' },
});
