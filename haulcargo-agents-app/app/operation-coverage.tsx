import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { CoveragePicker } from '@/components/coverage-picker';
import { Header, PrimaryButton, Screen } from '@/components/ui';
import { coverageIsValid, emptyCoverage, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { getCoverageDraft, setCoverageDraft } from '@/lib/coverage-draft';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

type Mode = 'edit' | 'register' | 'register-company';

function resolveMode(raw: string | string[] | undefined): Mode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'register' || value === 'register-company') return value;
  return 'edit';
}

export default function OperationCoverageScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = resolveMode(params.mode);
  const { carrier, refreshCarrier } = useCarrierSession();

  const initial = useMemo((): CoverageSelection => {
    if (mode === 'register' || mode === 'register-company') {
      return getCoverageDraft();
    }
    if (!carrier) return emptyCoverage();
    return {
      coverageRegions: carrier.coverageRegions || [],
      coverageAllTanzania: Boolean(carrier.coverageAllTanzania),
      coverageIntraCity: Boolean(carrier.coverageIntraCity),
      coverageInternational: Boolean(carrier.coverageInternational),
      coverageInternationalCountries: String(carrier.coverageInternationalCountries || ''),
    };
  }, [mode, carrier]);

  const [coverage, setCoverage] = useState<CoverageSelection>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (mode === 'edit' && !carrier) {
    return <Redirect href="/(main)/settings" />;
  }

  const onConfirm = async () => {
    if (!coverageIsValid(coverage)) {
      setError('Chagua coverage: mikoa yote, mikoa maalum, au ndani ya mji.');
      return;
    }
    setError('');

    if (mode === 'register' || mode === 'register-company') {
      setCoverageDraft(coverage);
      router.back();
      return;
    }

    if (!carrier) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'carriers', carrier.id), {
        coverageRegions: coverage.coverageAllTanzania || coverage.coverageIntraCity ? [] : coverage.coverageRegions,
        coverageAllTanzania: coverage.coverageAllTanzania,
        coverageIntraCity: coverage.coverageIntraCity,
        coverageInternational: coverage.coverageIntraCity ? false : coverage.coverageInternational,
        coverageInternationalCountries: coverage.coverageIntraCity
          ? ''
          : coverage.coverageInternationalCountries.trim(),
      });
      await refreshCarrier();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Imeshindwa kuhifadhi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Header
        title="Eneo la operesheni"
        subtitle="Chagua mikoa yote, mikoa maalum, au ndani ya mji."
        back
      />
      <CoveragePicker value={coverage} onChange={setCoverage} baseRegion={carrier?.region} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.cta}>
        <PrimaryButton
          label={mode === 'edit' ? 'Hifadhi coverage' : 'Tumia uchaguzi'}
          loading={saving}
          onPress={() => void onConfirm()}
        />
      </View>
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
  cta: { marginTop: 8, marginBottom: 12 },
});
