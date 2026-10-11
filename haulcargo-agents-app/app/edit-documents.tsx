import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';

import { Header, PrimaryButton, Screen } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { pickDocument, pickImageDocument, type PickedDoc, uploadCarrierDocument } from '@/lib/document-upload';
import { auth, db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

const DOC_ITEMS = [
  { key: 'brelaCert', label: 'Cheti / usajili BRELA' },
  { key: 'tinCert', label: 'Cheti cha TIN' },
  { key: 'businessLicence', label: 'Leseni ya biashara' },
  { key: 'latraLicence', label: 'Leseni LATRA' },
  { key: 'repId', label: 'Kitambulisho cha mwakilishi' },
] as const;

type DocKey = (typeof DOC_ITEMS)[number]['key'];

export default function EditDocumentsScreen() {
  const { carrier, refreshCarrier } = useCarrierSession();
  const [pending, setPending] = useState<Partial<Record<DocKey, PickedDoc>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!carrier) return <Redirect href="/(main)/settings" />;

  const existing = carrier.documents || {};

  const setDoc = async (key: DocKey, mode: 'file' | 'image') => {
    const picked = mode === 'image' ? await pickImageDocument(key) : await pickDocument(key);
    if (!picked) return;
    setPending((prev) => ({ ...prev, [key]: picked }));
    setMessage('');
    setError('');
  };

  return (
    <Screen scroll>
      <Header
        title="Hati za kampuni"
        subtitle="Pakia au sasisha hati. HAUL inaweza kuomba uthibitisho tena."
        back
      />
      <Text style={styles.hint}>Chagua faili (PDF/picha) au picha kutoka galeri.</Text>
      {DOC_ITEMS.map((item) => {
        const hasExisting = Boolean(existing[item.key]);
        const hasPending = Boolean(pending[item.key]);
        return (
          <View key={item.key} style={styles.docCard}>
            <Text style={styles.docLabel}>{item.label}</Text>
            <Text style={styles.docStatus}>
              {hasPending ? 'Mpya imewekwa — hifadhi' : hasExisting ? 'Imepakiwa' : 'Haijapakiwa'}
            </Text>
            <View style={styles.docActions}>
              <Pressable style={styles.docBtn} onPress={() => void setDoc(item.key, 'file')}>
                <Text style={styles.docBtnText}>Faili</Text>
              </Pressable>
              <Pressable style={styles.docBtn} onPress={() => void setDoc(item.key, 'image')}>
                <Text style={styles.docBtnText}>Picha</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label="Hifadhi hati"
        loading={saving}
        disabled={Object.keys(pending).length === 0}
        onPress={async () => {
          const keys = Object.keys(pending) as DocKey[];
          if (!keys.length) return;
          setSaving(true);
          setError('');
          setMessage('');
          try {
            const idToken = await auth.currentUser?.getIdToken();
            if (!idToken) throw new Error('Ingia tena ili kupakia hati.');
            const uploaded: Record<string, string> = { ...existing };
            for (const key of keys) {
              const file = pending[key];
              if (!file) continue;
              uploaded[key] = await uploadCarrierDocument(file, idToken);
            }
            await updateDoc(doc(db, 'carriers', carrier.id), { documents: uploaded });
            await refreshCarrier();
            setPending({});
            setMessage('Hati zimehifadhiwa.');
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Imeshindwa kupakia.');
          } finally {
            setSaving(false);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.muted,
    marginBottom: 14,
  },
  docCard: {
    backgroundColor: theme.tile,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  docLabel: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: theme.ink,
  },
  docStatus: {
    marginTop: 4,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
  docActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  docBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: theme.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
  },
  docBtnText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
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
