import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { Field, Header, PrimaryButton, Screen, Card, Muted, SectionTitle } from '@/components/ui';
import { coverageSummary } from '@/constants/coverage';
import { ADMIN_EMAIL, theme } from '@/constants/theme';
import { carrierStatusLabel } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function SettingsScreen() {
  const { carrier, user, signOut, refreshCarrier, isAdmin } = useCarrierSession();
  const [companyName, setCompanyName] = useState(carrier?.companyName || '');
  const [phone, setPhone] = useState(carrier?.phone || '');
  const [location, setLocation] = useState(carrier?.location || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!carrier && !isAdmin) {
    return (
      <Screen>
        <Header title="Mipangilio" />
        <Muted>Akaunti ya msimamizi — hakuna kampuni iliyounganishwa.</Muted>
        {user?.email?.toLowerCase() === ADMIN_EMAIL ? (
          <PrimaryButton label="Uthibitisho wa makampuni" onPress={() => router.push('/admin/verify')} />
        ) : null}
        <PrimaryButton label="Toka" variant="outline" onPress={() => void signOut().then(() => router.replace('/'))} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Mipangilio" />
      <Card>
        <Text style={styles.status}>{carrierStatusLabel(carrier?.status)}</Text>
        <Muted>
          {carrier?.status === 'verified'
            ? 'Unaweza kupokea oda za mizigo kutoka HAUL.'
            : 'Timu ya HAUL inapitia taarifa za kampuni yako.'}
        </Muted>
        <Muted style={{ marginTop: 8 }}>
          Coverage:{' '}
          {coverageSummary({
            coverageRegions: carrier?.coverageRegions || [],
            coverageAllTanzania: Boolean(carrier?.coverageAllTanzania),
            coverageInternational: Boolean(carrier?.coverageInternational),
          })}
        </Muted>
        {carrier?.rejectionReason ? <Text style={styles.reject}>Sababu: {carrier.rejectionReason}</Text> : null}
      </Card>

      <SectionTitle>Wasifu wa kampuni</SectionTitle>
      <Field label="Jina la kampuni" value={companyName} onChangeText={setCompanyName} />
      <Field label="Simu" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Eneo" value={location} onChangeText={setLocation} />
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      <PrimaryButton
        label="Hifadhi"
        loading={saving}
        onPress={async () => {
          if (!carrier?.id) return;
          setSaving(true);
          try {
            await updateDoc(doc(db, 'carriers', carrier.id), { companyName, phone, location });
            await refreshCarrier();
            setMessage('Imehifadhiwa.');
          } finally {
            setSaving(false);
          }
        }}
      />

      <PrimaryButton label="Ratiba ya safari" variant="outline" onPress={() => router.push('/schedule')} />
      {user?.email?.toLowerCase() === ADMIN_EMAIL ? (
        <PrimaryButton label="Admin: Uthibitisho" variant="outline" onPress={() => router.push('/admin/verify')} />
      ) : null}
      <PrimaryButton label="Toka" variant="danger" onPress={() => void signOut().then(() => router.replace('/'))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 18, fontWeight: '800', color: theme.green, marginBottom: 8 },
  reject: { color: theme.danger, marginTop: 8 },
  ok: { color: theme.success, marginBottom: 8 },
});
