import { collection, deleteField, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Card, Header, Muted, PrimaryButton, Screen, SectionTitle } from '@/components/ui';
import { ADMIN_EMAIL, theme } from '@/constants/theme';
import { carrierStatusLabel } from '@/lib/carrier-helpers';
import type { Carrier } from '@/lib/carrier-types';
import { db } from '@/lib/firebase';
import { useCarrierSession } from '@/providers/carrier-session';

export default function AdminVerifyScreen() {
  const { user } = useCarrierSession();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const snap = await getDocs(collection(db, 'carriers'));
    setCarriers(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Carrier[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user?.email?.toLowerCase() !== ADMIN_EMAIL) return;
    void load();
  }, [user, load]);

  if (user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return (
      <Screen>
        <Header title="Uthibitisho" back />
        <Muted>Ukurasa huu ni wa msimamizi pekee.</Muted>
      </Screen>
    );
  }

  const pending = carriers.filter((c) => ['pending', 'rejected', 'suspended'].includes(String(c.status || 'pending').toLowerCase()));

  const setStatus = (id: string, status: string) => {
    const patch: Record<string, unknown> = {
      status,
      reviewedAt: serverTimestamp(),
      reviewedBy: user?.email || '',
    };
    if (status === 'verified') patch.rejectionReason = deleteField();
    void updateDoc(doc(db, 'carriers', id), patch).then(load);
  };

  return (
    <Screen scroll>
      <Header title="Uthibitisho" back />
      {loading ? <Muted>Inapakia…</Muted> : null}
      <SectionTitle>{`Inasubiri (${pending.length})`}</SectionTitle>
      {pending.length === 0 ? (
        <Card>
          <Muted>Hakuna kampuni inayosubiri.</Muted>
        </Card>
      ) : (
        pending.map((item) => (
          <Card key={item.id}>
            <Text style={styles.name}>{item.companyName || '—'}</Text>
            <Text style={styles.meta}>{item.phone || '—'} · {carrierStatusLabel(item.status)}</Text>
            {item.rejectionReason ? <Text style={styles.reason}>Sababu: {item.rejectionReason}</Text> : null}
            <View style={styles.row}>
              <PrimaryButton label="Thibitisha" onPress={() => setStatus(item.id, 'verified')} />
              <PrimaryButton
                label="Kataa"
                variant="outline"
                onPress={() => {
                  Alert.prompt?.('Sababu', 'Sababu fupi (si lazima)', (reason) => {
                    void updateDoc(doc(db, 'carriers', item.id), {
                      status: 'rejected',
                      rejectionReason: String(reason || '').trim(),
                      reviewedAt: serverTimestamp(),
                      reviewedBy: user?.email || '',
                    }).then(load);
                  });
                  if (!Alert.prompt) setStatus(item.id, 'rejected');
                }}
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '800', color: theme.charcoal },
  meta: { color: theme.muted, marginTop: 4, marginBottom: 8 },
  reason: { color: theme.danger, fontSize: 13, marginBottom: 8 },
  row: { gap: 10 },
});
