import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { CoveragePicker } from '@/components/coverage-picker';
import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { useCarrierSession } from '@/providers/carrier-session';

export default function RegisterScreen() {
  const { signUp, authenticating, authError, user, carrier } = useCarrierSession();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [coverage, setCoverage] = useState<CoverageSelection>(emptyCoverage());
  const [routeOrigin, setRouteOrigin] = useState('Dar es Salaam');
  const [routeDestination, setRouteDestination] = useState('');
  const [routeDepart, setRouteDepart] = useState('08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState('500');
  const [localError, setLocalError] = useState('');

  if (user && carrier?.status === 'verified') return <Redirect href="/(main)" />;

  const error = localError || authError;
  const totalSteps = 4;

  const next = () => {
    if (step === 1) {
      if (!email.trim() || password.length < 6) {
        setLocalError('Weka barua pepe na nenosiri (herufi 6+).');
        return;
      }
    }
    if (step === 2 && !companyName.trim()) {
      setLocalError('Weka jina la kampuni.');
      return;
    }
    if (step === 3 && !coverageIsValid(coverage)) {
      setLocalError('Chagua angalau mkoa mmoja, mikoa yote Tanzania, au nje ya nchi.');
      return;
    }
    if (step === 4 && !routeDestination.trim()) {
      setLocalError('Weka marudio ya njia ya kwanza.');
      return;
    }
    setLocalError('');
    if (step < totalSteps) {
      setStep(step + 1);
      return;
    }
    void signUp(email, password, {
      companyName,
      phone,
      routeOrigin,
      routeDestination,
      routeDepart,
      cargoCapacityKg: Number(cargoCapacityKg) || 0,
      coverageRegions: coverage.coverageRegions,
      coverageAllTanzania: coverage.coverageAllTanzania,
      coverageInternational: coverage.coverageInternational,
    })
      .then(() => router.replace('/(main)'))
      .catch(() => undefined);
  };

  return (
    <Screen scroll>
      <Header title="Jisajili — Kampuni" back />
      <Text style={styles.step}>
        Hatua {step} / {totalSteps}
      </Text>
      {step === 1 && (
        <>
          <Text style={styles.hint}>Akaunti ya kampuni ya usafirishaji (agents).</Text>
          <Field label="Barua pepe" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Field label="Nenosiri" secureTextEntry value={password} onChangeText={setPassword} />
        </>
      )}
      {step === 2 && (
        <>
          <Text style={styles.hint}>Taarifa za kampuni — HAUL itathibitisha kabla ya kupokea oda.</Text>
          <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
          <Field label="Simu ya ofisi" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </>
      )}
      {step === 3 && (
        <>
          <Text style={styles.hint}>Eneo la huduma (coverage)</Text>
          <CoveragePicker value={coverage} onChange={setCoverage} />
        </>
      )}
      {step === 4 && (
        <>
          <Text style={styles.hint}>Njia ya kwanza — unaweza kuongeza zaidi baadaye kwenye Ratiba.</Text>
          <Field label="Kutoka" value={routeOrigin} onChangeText={setRouteOrigin} />
          <Field label="Kwenda" value={routeDestination} onChangeText={setRouteDestination} />
          <Field label="Muda wa kuondoka (HH:MM)" value={routeDepart} onChangeText={setRouteDepart} />
          <Field label="Uwezo wa mzigo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label={step === totalSteps ? 'Unda akaunti' : 'Endelea'}
        loading={authenticating && step === totalSteps}
        onPress={next}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { fontWeight: '700', color: theme.ink, marginBottom: 12 },
  hint: { color: theme.muted, marginBottom: 12, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 12 },
});
