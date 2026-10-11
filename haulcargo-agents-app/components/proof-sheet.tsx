import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { OtpUnderlineInput } from '@/components/otp-underline-input';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import {
  completeDeliveryProof,
  fetchDeliveryProofOptions,
  sendDeliveryOtp,
  uploadDeliveryProof,
} from '@/lib/carrier-proof-api';
import { pickImageDocument, type PickedDoc } from '@/lib/document-upload';

type Method = 'photo' | 'otp' | 'signature';

export function ProofSheet({
  shipmentId,
  recipientPhone,
  onClose,
  onDone,
}: {
  shipmentId: string;
  recipientPhone?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [otpAvailable, setOtpAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [method, setMethod] = useState<Method>('photo');
  const [file, setFile] = useState<PickedDoc | null>(null);
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setChecking(true);
    void fetchDeliveryProofOptions(shipmentId)
      .then((options) => {
        if (!alive) return;
        const showOtp = Boolean(options.otpAvailable && String(recipientPhone || '').trim());
        setOtpAvailable(showOtp);
      })
      .catch(() => {
        if (alive) setOtpAvailable(false);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [recipientPhone, shipmentId]);

  const choosePhoto = async (kind: 'photo' | 'signature', camera: boolean) => {
    setError('');
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('Ruhusa ya kamera imekataliwa.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setFile({
        kind,
        uri: asset.uri,
        name: asset.fileName || `${kind}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      setMethod(kind);
      return;
    }
    const picked = await pickImageDocument(kind);
    if (!picked) return;
    setFile(picked);
    setMethod(kind);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (method === 'otp') {
        await completeDeliveryProof({ shipmentId, method: 'otp', code });
      } else {
        if (!file) throw new Error(method === 'signature' ? 'Pakia saini.' : 'Pakia picha.');
        const uploaded = await uploadDeliveryProof(shipmentId, method, file);
        await completeDeliveryProof({ shipmentId, method, proofUrl: uploaded.downloadURL });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Imeshindwa.');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      await sendDeliveryOtp(shipmentId);
      setOtpSent(true);
      setMethod('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMS haijatumwa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Funga" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Thibitisha ukabidhi</Text>
        <Text style={styles.lead}>Picha, saini, au msimbo wa mpokeaji. Imekabidhiwa inaandikwa pamoja na uthibitisho.</Text>
        {checking ? <ActivityIndicator color={theme.ink} /> : null}

        <View style={styles.choices}>
          <Choice label="Picha" selected={method === 'photo'} onPress={() => { setMethod('photo'); setError(''); }} />
          <Choice
            label="Saini"
            selected={method === 'signature'}
            onPress={() => { setMethod('signature'); setError(''); }}
          />
          {otpAvailable ? (
            <Choice label="Msimbo" selected={method === 'otp'} onPress={() => { setMethod('otp'); setError(''); }} />
          ) : null}
        </View>

        {method === 'photo' || method === 'signature' ? (
          <View style={styles.actions}>
            <PrimaryButton
              label={file && method === file.kind ? 'Badilisha picha' : method === 'signature' ? 'Piga picha ya saini' : 'Piga picha'}
              variant="outline"
              onPress={() => void choosePhoto(method, true)}
            />
            <PrimaryButton
              label="Chagua kutoka kwenye simu"
              variant="outline"
              onPress={() => void choosePhoto(method, false)}
            />
            {file && file.kind === method ? <Text style={styles.fileName}>{file.name}</Text> : null}
          </View>
        ) : null}

        {method === 'otp' && otpAvailable ? (
          <View style={styles.actions}>
            <PrimaryButton
              label={otpSent ? 'Tuma msimbo tena' : 'Tuma msimbo kwa mpokeaji'}
              variant="outline"
              loading={busy && !code}
              onPress={() => void sendCode()}
            />
            {otpSent ? <OtpUnderlineInput value={code} onChange={setCode} /> : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label="Imekabidhiwa"
          loading={busy}
          disabled={method === 'otp' ? code.length < 6 : !file || file.kind !== method}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceOn]}>
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: theme.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
  },
  title: {
    fontFamily: typography.bold,
    fontSize: 20,
    color: theme.ink,
  },
  lead: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.muted,
  },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.tile,
  },
  choiceOn: { backgroundColor: theme.ink },
  choiceText: { fontFamily: typography.semibold, fontSize: 13, color: theme.ink },
  choiceTextOn: { color: theme.white },
  actions: { gap: 8 },
  fileName: { fontFamily: typography.body, fontSize: 13, color: theme.muted },
  error: { fontFamily: typography.semibold, fontSize: 13, color: theme.danger },
});
