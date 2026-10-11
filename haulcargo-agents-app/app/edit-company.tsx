import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { Field, Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function EditCompanyScreen() {
  const { carrier, refreshCarrier } = useCarrierSession();
  const [companyName, setCompanyName] = useState(carrier?.companyName || carrier?.name || '');
  const [tradingName, setTradingName] = useState(carrier?.tradingName || '');
  const [phone, setPhone] = useState(carrier?.phone || '');
  const [location, setLocation] = useState(carrier?.location || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!carrier) return <Redirect href="/(main)/settings" />;

  return (
    <Screen scroll>
      <Header title="Taarifa za kampuni" subtitle="Hariri jina, simu, na eneo la ofisi." back />
      <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
      <Field
        label="Jina la biashara"
        value={tradingName}
        onChangeText={setTradingName}
        hint="Si lazima. Likiwekwa, linaonekana kwenye Nyumbani."
      />
      <Field label="Simu" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Eneo" value={location} onChangeText={setLocation} />
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi"
        loading={saving}
        onPress={async () => {
          if (!companyName.trim()) {
            setError('Jina la kampuni linahitajika.');
            return;
          }
          setSaving(true);
          setError('');
          setMessage('');
          try {
            const registered = companyName.trim();
            const trading = tradingName.trim();
            await updateDoc(doc(db, 'carriers', carrier.id), {
              companyName: registered,
              tradingName: trading,
              name: trading || registered,
              phone: phone.trim(),
              location: location.trim(),
            });
            await refreshCarrier();
            setMessage('Imehifadhiwa.');
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
  ok: {
    fontFamily: typography.semibold,
    color: theme.success,
    marginBottom: 8,
    fontSize: 13,
  },
  error: {
    fontFamily: typography.semibold,
    color: theme.danger,
    marginBottom: 8,
    fontSize: 13,
  },
});
