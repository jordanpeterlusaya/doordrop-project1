import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { CoveragePicker } from '@/components/coverage-picker';
import { Header, PrimaryButton, Screen } from '@/components/ui';
import { coverageIsValid, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function EditCoverageScreen() {
  const { carrier, refreshCarrier } = useCarrierSession();
  const [coverage, setCoverage] = useState<CoverageSelection>({
    coverageRegions: carrier?.coverageRegions || [],
    coverageAllTanzania: Boolean(carrier?.coverageAllTanzania),
    coverageInternational: Boolean(carrier?.coverageInternational),
    coverageInternationalCountries: String(carrier?.coverageInternationalCountries || ''),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!carrier) return <Redirect href="/(main)/settings" />;

  return (
    <Screen scroll>
      <Header title="Coverage" subtitle="Maeneo mnayohudumia kwa oda za HAUL." back />
      <CoveragePicker value={coverage} onChange={setCoverage} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi coverage"
        loading={saving}
        onPress={async () => {
          if (!coverageIsValid(coverage)) {
            setError('Chagua coverage: mikoa, mikoa yote, na/au nje ya nchi.');
            return;
          }
          setSaving(true);
          setError('');
          try {
            await updateDoc(doc(db, 'carriers', carrier.id), {
              coverageRegions: coverage.coverageAllTanzania ? [] : coverage.coverageRegions,
              coverageAllTanzania: coverage.coverageAllTanzania,
              coverageInternational: coverage.coverageInternational,
              coverageInternationalCountries: coverage.coverageInternationalCountries.trim(),
            });
            await refreshCarrier();
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Imeshindwa kuhifadhi.');
          } finally {
            setSaving(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: typography.semibold,
    color: theme.danger,
    marginBottom: 8,
    fontSize: 13,
  },
});
