import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { CoveragePicker } from '@/components/coverage-picker';
import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { createCarrierFromRegistration } from '@/lib/carrier-registration';
import { useCarrierSession } from '@/providers/carrier-session';

export default function RegisterCompanyScreen() {
  const { user, needsCompanySetup, refreshCarrier } = useCarrierSession();
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [coverage, setCoverage] = useState<CoverageSelection>(emptyCoverage());
  const [routeOrigin, setRouteOrigin] = useState('Dar es Salaam');
  const [routeDestination, setRouteDestination] = useState('');
  const [routeDepart, setRouteDepart] = useState('08:00');
  const [cargoCapacityKg, setCargoCapacityKg] = useState('500');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return <Redirect href="/login" />;
  if (!needsCompanySetup) return <Redirect href="/(main)" />;

  return (
    <Screen scroll>
      <Header title="Kamilisha kampuni" back />
      <Text style={styles.sub}>Hatua {step} / 3 — unganisha akaunti na kampuni ya usafirishaji.</Text>

      {step === 1 ? (
        <>
          <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
          <Field label="Simu ya ofisi" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </>
      ) : null}

      {step === 2 ? <CoveragePicker value={coverage} onChange={setCoverage} /> : null}

      {step === 3 ? (
        <>
          <Field label="Kutoka" value={routeOrigin} onChangeText={setRouteOrigin} />
          <Field label="Kwenda" value={routeDestination} onChangeText={setRouteDestination} />
          <Field label="Muda wa kuondoka" value={routeDepart} onChangeText={setRouteDepart} />
          <Field label="Uwezo (kg)" keyboardType="numeric" value={cargoCapacityKg} onChangeText={setCargoCapacityKg} />
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        label={step < 3 ? 'Endelea' : 'Hifadhi'}
        loading={loading}
        onPress={async () => {
          if (step === 1) {
            if (!companyName.trim()) {
              setError('Jaza jina la kampuni.');
              return;
            }
            setError('');
            setStep(2);
            return;
          }
          if (step === 2) {
            if (!coverageIsValid(coverage)) {
              setError('Chagua coverage: mikoa, mikoa yote, na/au nje ya nchi.');
              return;
            }
            setError('');
            setStep(3);
            return;
          }
          if (!routeDestination.trim()) {
            setError('Jaza marudio ya njia.');
            return;
          }
          setLoading(true);
          try {
            const email = user.email?.trim().toLowerCase() || '';
            await createCarrierFromRegistration(
              user,
              {
                companyName,
                phone,
                routeOrigin,
                routeDestination,
                routeDepart,
                cargoCapacityKg: Number(cargoCapacityKg) || 0,
                coverageRegions: coverage.coverageRegions,
                coverageAllTanzania: coverage.coverageAllTanzania,
                coverageInternational: coverage.coverageInternational,
              },
              email
            );
            await refreshCarrier();
            router.replace('/(main)');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Imeshindwa.');
          } finally {
            setLoading(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: theme.muted, marginBottom: 16, lineHeight: 20 },
  error: { color: theme.danger, marginBottom: 12 },
});
