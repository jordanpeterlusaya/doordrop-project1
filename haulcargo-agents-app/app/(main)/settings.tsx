import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { Field, Header, PrimaryButton, Screen, Muted } from '@/components/ui';
import { coverageSummary } from '@/constants/coverage';
import { ADMIN_EMAIL, theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { carrierStatusLabel } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function SettingsScreen() {
  const { carrier, user, signOut, refreshCarrier, isAdmin } = useCarrierSession();
  const [companyName, setCompanyName] = useState(carrier?.companyName || carrier?.name || '');
  const [phone, setPhone] = useState(carrier?.phone || '');
  const [location, setLocation] = useState(carrier?.location || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!carrier && !isAdmin) {
    return (
      <Screen>
        <Header title="Mipangilio" />
        <Muted style={styles.lead}>Akaunti ya msimamizi — hakuna kampuni.</Muted>
        {user?.email?.toLowerCase() === ADMIN_EMAIL ? (
          <PrimaryButton label="Uthibitisho wa makampuni" onPress={() => router.push('/admin/verify')} />
        ) : null}
        <View style={styles.spacer} />
        <PrimaryButton label="Toka" variant="outline" onPress={() => void signOut().then(() => router.replace('/'))} />
      </Screen>
    );
  }

  const verified = carrier?.status === 'verified';
  const coverage = coverageSummary({
    coverageRegions: carrier?.coverageRegions || [],
    coverageAllTanzania: Boolean(carrier?.coverageAllTanzania),
    coverageInternational: Boolean(carrier?.coverageInternational),
  });

  return (
    <Screen scroll>
      <Header title="Mipangilio" />
      <Muted style={styles.lead}>Wasifu, coverage, na akaunti.</Muted>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Hali</Text>
          <View style={[styles.statusPill, verified ? styles.statusPillOk : styles.statusPillWait]}>
            <Text style={[styles.statusPillText, verified ? styles.statusPillTextOk : undefined]}>
              {carrierStatusLabel(carrier?.status)}
            </Text>
          </View>
        </View>
        <Text style={styles.statusBody}>
          {verified ? 'Unaweza kupokea oda kutoka HAUL.' : 'HAUL inapitia taarifa za kampuni.'}
        </Text>
        <Text style={styles.coverage}>Coverage · {coverage}</Text>
        {carrier?.rejectionReason ? (
          <Text style={styles.reject}>Sababu: {carrier.rejectionReason}</Text>
        ) : null}
      </View>

      <Text style={styles.section}>Kampuni</Text>
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
            await updateDoc(doc(db, 'carriers', carrier.id), {
              companyName: companyName.trim(),
              phone: phone.trim(),
              location: location.trim(),
            });
            await refreshCarrier();
            setMessage('Imehifadhiwa.');
          } finally {
            setSaving(false);
          }
        }}
      />

      <Text style={styles.section}>Zana</Text>
      <View style={styles.tools}>
        <PrimaryButton label="Ratiba ya safari" variant="outline" onPress={() => router.push('/schedule')} />
        {user?.email?.toLowerCase() === ADMIN_EMAIL ? (
          <PrimaryButton label="Admin: Uthibitisho" variant="outline" onPress={() => router.push('/admin/verify')} />
        ) : null}
      </View>

      <View style={styles.logoutWrap}>
        <PrimaryButton label="Toka" variant="danger" onPress={() => void signOut().then(() => router.replace('/'))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 16 },
  spacer: { height: 12 },
  statusCard: {
    backgroundColor: theme.white,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusLabel: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.muted,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillOk: { backgroundColor: '#ECFDF5' },
  statusPillWait: { backgroundColor: theme.primarySoft },
  statusPillText: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.ink,
  },
  statusPillTextOk: { color: '#047857' },
  statusBody: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.ink,
  },
  coverage: {
    marginTop: 10,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  reject: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.danger,
  },
  section: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: theme.ink,
    letterSpacing: -0.2,
    marginBottom: 12,
    marginTop: 4,
  },
  ok: {
    fontFamily: typography.semibold,
    color: theme.success,
    marginBottom: 8,
  },
  tools: { gap: 10, marginBottom: 8 },
  logoutWrap: { marginTop: 24 },
});
