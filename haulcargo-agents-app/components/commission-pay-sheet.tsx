import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { money } from '@/lib/carrier-helpers';

const LOGOS = {
  mpesa: require('@/assets/payments/mpesa.png'),
  mixx: require('@/assets/payments/mixx.png'),
  airtel: require('@/assets/payments/airtel.png'),
} as const;

export const PAY_NETWORKS = [
  { key: 'mpesa', label: 'M-Pesa', provider: 'Vodacom' },
  { key: 'mixx', label: 'Mixx by Yas', provider: 'Tigo / Yas' },
  { key: 'airtel', label: 'Airtel Money', provider: 'Airtel' },
] as const;

export type PayNetworkKey = (typeof PAY_NETWORKS)[number]['key'];

type Props = {
  visible: boolean;
  amount: number;
  phone: string;
  network: PayNetworkKey;
  phoneHint: string;
  onChangePhone: (value: string) => void;
  onChangeNetwork: (value: PayNetworkKey) => void;
  /** Chosen amount only. Does not call a provider or mark commission paid. */
  onPay: (amount: number) => void;
  onClose: () => void;
};

/** HAUL Drive checkout layout. Any amount up to Unadaiwa. Lipa does not call a provider. */
export function CommissionPaySheet({
  visible,
  amount,
  phone,
  network,
  phoneHint,
  onChangePhone,
  onChangeNetwork,
  onPay,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const owed = Math.max(0, Math.round(Number(amount) || 0));
  const owedRef = useRef(owed);
  owedRef.current = owed;
  const [draft, setDraft] = useState('');
  const [amountHint, setAmountHint] = useState('');

  useEffect(() => {
    if (!visible) return;
    const next = owedRef.current;
    setDraft(next > 0 ? String(next) : '');
    setAmountHint('');
  }, [visible]);

  const chosen = Math.round(Number(draft.replace(/[^\d]/g, '')) || 0);

  const submit = () => {
    if (chosen <= 0) {
      setAmountHint('Weka kiasi.');
      return;
    }
    if (chosen > owed) {
      setAmountHint(`Kiasi kisizidi ${money(owed)}.`);
      return;
    }
    setAmountHint('');
    onPay(chosen);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Funga" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <Text style={styles.kicker}>Unadaiwa</Text>
          <Text style={styles.amount}>{money(amount)}</Text>
          <Text style={styles.caption}>Kamisheni</Text>

          <Text style={styles.section}>Kiasi</Text>
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value.replace(/[^\d]/g, ''));
              if (amountHint) setAmountHint('');
            }}
            keyboardType="number-pad"
            placeholder={owed > 0 ? String(owed) : '0'}
            placeholderTextColor="#94A3B8"
            style={styles.input}
            accessibilityLabel="Kiasi cha kulipa"
          />
          <Text style={styles.amountHelp}>Andika kiasi chochote, mpaka Unadaiwa.</Text>
          {amountHint ? <Text style={styles.hint}>{amountHint}</Text> : null}

          <Text style={styles.section}>Lipa kwa</Text>
          {PAY_NETWORKS.map((item) => {
            const selected = network === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => onChangeNetwork(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.method, selected && styles.methodOn, pressed && styles.pressed]}>
                <View style={[styles.logoTile, item.key === 'mixx' && styles.logoMixx, item.key === 'airtel' && styles.logoAirtel]}>
                  <Image source={LOGOS[item.key]} style={styles.logo} resizeMode="contain" />
                </View>
                <View style={styles.methodCopy}>
                  <Text style={styles.methodName}>{item.label}</Text>
                  <Text style={styles.methodProvider}>{item.provider}</Text>
                </View>
                <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              </Pressable>
            );
          })}

          <Text style={styles.section}>Namba ya simu</Text>
          <TextInput
            value={phone}
            onChangeText={onChangePhone}
            keyboardType="phone-pad"
            placeholder="07XX XXX XXX"
            placeholderTextColor="#94A3B8"
            style={styles.input}
            accessibilityLabel="Namba ya simu"
          />
          {phoneHint ? <Text style={styles.hint}>{phoneHint}</Text> : null}

          <Pressable
            onPress={submit}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pay, pressed && styles.payPressed]}>
            <Text style={styles.payText}>{`Lipa · ${money(chosen)}`}</Text>
          </Pressable>
          <Text style={styles.note}>Unadaiwa inabaki mpaka malipo yatakapothibitishwa.</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(11, 18, 32, 0.45)',
  },
  sheet: {
    backgroundColor: '#F4F6F8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 12,
  },
  kicker: {
    textAlign: 'center',
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amount: {
    marginTop: 4,
    textAlign: 'center',
    fontFamily: typography.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: '#0B1220',
  },
  caption: {
    marginTop: 2,
    textAlign: 'center',
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
  section: {
    marginTop: 16,
    marginBottom: 8,
    fontFamily: typography.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#6B7280',
  },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#EEF0F3',
    marginBottom: 8,
  },
  methodOn: { borderColor: '#0B1220' },
  pressed: { opacity: 0.92 },
  logoTile: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEEF2',
  },
  logoMixx: {
    width: 76,
    height: 44,
    backgroundColor: '#FFD200',
    borderWidth: 0,
  },
  logoAirtel: {
    width: 76,
    height: 44,
    backgroundColor: '#ED1C24',
    borderWidth: 0,
  },
  logo: { width: '100%', height: '100%' },
  methodCopy: { flex: 1, minWidth: 0, gap: 2 },
  methodName: {
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 20,
    color: '#0B1220',
  },
  methodProvider: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#0B1220' },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0B1220',
  },
  input: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EEF0F3',
    paddingHorizontal: 16,
    color: '#0B1220',
    fontSize: 17,
    fontFamily: typography.semibold,
  },
  amountHelp: {
    marginTop: 8,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
  },
  hint: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  pay: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  payPressed: { opacity: 0.9 },
  payText: {
    fontFamily: typography.bold,
    fontSize: 16,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  note: {
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
});
