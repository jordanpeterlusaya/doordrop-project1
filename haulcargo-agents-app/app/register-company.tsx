import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/components/auth-shell';
import { Field, PrimaryButton } from '@/components/ui';
import {
  coverageIsValid,
  coverageSummary,
  emptyCoverage,
  type CoverageSelection,
} from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { createCarrierFromRegistration } from '@/lib/carrier-registration';
import { getCoverageDraft, getCoverageDraftStamp, setCoverageDraft } from '@/lib/coverage-draft';
import { useCarrierSession } from '@/providers/carrier-session';

export default function RegisterCompanyScreen() {
  const { user, refreshCarrier, carrier } = useCarrierSession();
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

  useFocusEffect(
    useCallback(() => {
      if (getCoverageDraftStamp() > 0) {
        setCoverage(getCoverageDraft());
      }
    }, [])
  );

  if (!user) return <Redirect href="/login" />;
  // Avoid redirect ping-pong with (main) when carrier is missing but setup flag is false.
  if (carrier) {
    return <Redirect href={carrier.status === 'pending' ? '/verification-pending' : '/(main)'} />;
  }

  return (
    <AuthShell title="Kamilisha kampuni" subtitle={`Hatua ${step} / 3 — unganisha akaunti na kampuni.`}>
      {step === 1 ? (
        <>
          <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
          <Field label="Simu ya ofisi" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </>
      ) : null}

      {step === 2 ? (
        <Pressable
          onPress={() => {
            setCoverageDraft(coverage);
            router.push({ pathname: '/operation-coverage', params: { mode: 'register-company' } });
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
      ) : null}

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
              setError('Chagua coverage: fungua eneo la operesheni.');
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
                coverageRegions: coverage.coverageAllTanzania ? [] : coverage.coverageRegions,
                coverageAllTanzania: coverage.coverageAllTanzania,
                coverageInternational: coverage.coverageInternational,
                coverageInternationalCountries: coverage.coverageInternationalCountries,
              },
              email
            );
            await refreshCarrier();
            router.replace('/verification-pending');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Imeshindwa.');
          } finally {
            setLoading(false);
          }
        }}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.danger,
    marginBottom: 12,
    fontFamily: typography.semibold,
    fontSize: 13,
  },
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
