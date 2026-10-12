import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { RegionSelect } from '@/components/region-select';
import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { coverageSummary } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { db } from '@/lib/firebase';
import { isValidTzPhone } from '@/lib/phone';
import { useCarrierSession } from '@/providers/carrier-session';

export default function EditCompanyScreen() {
  const { carrier, refreshCarrier } = useCarrierSession();
  const [companyName, setCompanyName] = useState(carrier?.companyName || carrier?.name || '');
  const [tradingName, setTradingName] = useState(carrier?.tradingName || '');
  const [phone, setPhone] = useState(carrier?.phone || '');
  const [region, setRegion] = useState(carrier?.region || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!carrier) return <Redirect href="/(main)/settings" />;

  const coverage = coverageSummary({
    coverageRegions: carrier.coverageRegions || [],
    coverageAllTanzania: Boolean(carrier.coverageAllTanzania),
    coverageIntraCity: Boolean(carrier.coverageIntraCity),
    coverageInternational: Boolean(carrier.coverageInternational),
    coverageInternationalCountries: String(carrier.coverageInternationalCountries || ''),
  });

  return (
    <Screen scroll>
      <Header title="Kampuni" back />
      <Field label="Kampuni" value={companyName} onChangeText={setCompanyName} autoCapitalize="words" />
      <Field label="Biashara" value={tradingName} onChangeText={setTradingName} autoCapitalize="words" />
      <Field label="Simu" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <RegionSelect label="Mkoa" hint="" value={region} onChange={setRegion} />
      <Pressable
        style={styles.link}
        onPress={() => router.push({ pathname: '/operation-coverage', params: { mode: 'edit' } })}
        accessibilityRole="button">
        <View style={styles.linkCopy}>
          <Text style={styles.linkLabel}>Coverage</Text>
          <Text style={styles.linkValue} numberOfLines={2}>
            {coverage}
          </Text>
        </View>
        <Text style={styles.linkAction}>Hariri</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi"
        loading={saving}
        onPress={async () => {
          const registered = companyName.trim();
          const trading = tradingName.trim();
          const nextPhone = phone.trim();
          const nextRegion = region.trim();
          if (!registered) {
            setError('Weka jina la kampuni.');
            return;
          }
          if (!isValidTzPhone(nextPhone)) {
            setError('Weka simu sahihi.');
            return;
          }
          if (!nextRegion) {
            setError('Chagua mkoa.');
            return;
          }
          setSaving(true);
          setError('');
          try {
            await updateDoc(doc(db, 'carriers', carrier.id), {
              companyName: registered,
              tradingName: trading,
              name: trading || registered,
              phone: nextPhone,
              region: nextRegion,
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
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  linkCopy: { flex: 1, minWidth: 0 },
  linkLabel: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  linkValue: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  linkAction: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  error: {
    fontFamily: typography.semibold,
    color: theme.danger,
    marginBottom: 8,
    fontSize: 13,
  },
});
