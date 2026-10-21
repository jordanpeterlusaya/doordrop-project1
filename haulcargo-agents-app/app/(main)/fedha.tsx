import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/ui';
import { COMMISSION_PAY_THRESHOLD_TZS } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { requestCommissionUssd, verifyCommissionUssd } from '@/lib/carrier-commission-api';
import { agentStatusError, fireTimeMs, isCompletedShipment, money, shipmentCode } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

const NETWORKS = [
  { key: 'mpesa', label: 'M-Pesa' },
  { key: 'mixx', label: 'Mixx' },
  { key: 'airtel', label: 'Airtel' },
] as const;

function isUssdHold(item: CarrierShipment) {
  return (
    String(item.cashStatus || '').toLowerCase() === 'pending_reconciliation' &&
    String(item.commissionPaymentId || '').startsWith('HCC-')
  );
}

export default function FedhaScreen() {
  const { carrier, shipments, refreshCarrier } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [phone, setPhone] = useState(carrier?.commissionPayerPhone || carrier?.phone || '');
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]['key']>('mpesa');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const heldAmount = useRef<number | null>(null);

  useEffect(() => {
    const next = carrier?.commissionPayerPhone || carrier?.phone || '';
    if (next) setPhone((current) => current || next);
  }, [carrier?.commissionPayerPhone, carrier?.phone]);

  const delivered = useMemo(() => {
    return shipments
      .filter((item) => item.carrierId === carrierId && isCompletedShipment(item))
      .sort((a, b) => (fireTimeMs(b.arrivedAt) || fireTimeMs(b.deliveredAt) || 0) - (fireTimeMs(a.arrivedAt) || fireTimeMs(a.deliveredAt) || 0));
  }, [shipments, carrierId]);

  const totals = useMemo(() => {
    let mapato = 0;
    let unpaid = 0;
    let holding = false;
    for (const item of delivered) {
      mapato += Number(item.carrierNet) || 0;
      const fee = Number(item.haulFee) || 0;
      if (String(item.cashStatus || '').toLowerCase() !== 'reconciled' && fee > 0) unpaid += fee;
      if (isUssdHold(item)) holding = true;
    }
    return { mapato, unpaid, holding };
  }, [delivered]);

  const due = totals.unpaid >= COMMISSION_PAY_THRESHOLD_TZS && !totals.holding;

  useEffect(() => {
    if (totals.holding) {
      heldAmount.current = totals.unpaid;
      return;
    }
    if (heldAmount.current != null && totals.unpaid < heldAmount.current) {
      setConfirmed(true);
      setError('');
    }
    heldAmount.current = null;
  }, [totals.holding, totals.unpaid]);

  useEffect(() => {
    if (!totals.holding && !paying) return;
    let stopped = false;
    const tick = () => {
      void verifyCommissionUssd()
        .then((result) => {
          if (stopped) return;
          if (result.settled) setConfirmed(true);
        })
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [totals.holding, paying]);

  const sendPush = () => {
    const trimmed = phone.trim();
    if (trimmed.length < 9) {
      setError('Weka namba ya simu.');
      return;
    }
    Alert.alert('Lipa kamisheni', `${money(totals.unpaid)} · ${trimmed}`, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Tuma USSD',
        onPress: () => {
          setPaying(true);
          setError('');
          setConfirmed(false);
          void requestCommissionUssd({ phoneNumber: trimmed, network })
            .then(async (result) => {
              if (result.status === 'below_threshold') {
                setError('Kamisheni bado haijafika kiwango.');
                return;
              }
              await refreshCarrier().catch(() => undefined);
            })
            .catch((err) => {
              const message = agentStatusError(err instanceof Error ? err.message : '');
              setError(message || 'USSD haijatumwa. Jaribu tena.');
            })
            .finally(() => setPaying(false));
        },
      },
    ]);
  };

  return (
    <Screen scroll edges="top" backgroundColor="#F4F5F7">
      <Text style={styles.title}>Fedha</Text>
      <Text style={styles.mapato}>{money(totals.mapato)}</Text>
      <Text style={styles.mapatoLabel}>Mapato</Text>

      <View style={styles.panel}>
        <Text style={styles.progress}>
          Kamisheni: {money(totals.unpaid)} / {money(COMMISSION_PAY_THRESHOLD_TZS)}
        </Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.max(0, Math.min(100, (totals.unpaid / COMMISSION_PAY_THRESHOLD_TZS) * 100))}%` },
            ]}
          />
        </View>

        {confirmed && !totals.holding ? <Text style={styles.ok}>Imethibitishwa</Text> : null}
        {totals.holding ? <Text style={styles.wait}>Inasubiri USSD</Text> : null}

        {due ? (
          <View style={styles.payBlock}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="07XXXXXXXX"
              placeholderTextColor={theme.muted}
              style={styles.input}
              accessibilityLabel="Namba ya simu"
            />
            <View style={styles.networks}>
              {NETWORKS.map((item) => {
                const selected = network === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setNetwork(item.key)}
                    accessibilityRole="button"
                    style={[styles.network, selected && styles.networkOn]}>
                    <Text style={[styles.networkText, selected && styles.networkTextOn]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={sendPush}
              disabled={paying}
              accessibilityRole="button"
              style={({ pressed }) => [styles.pay, pressed && styles.payPressed, paying && styles.payBusy]}>
              <Text style={styles.payText}>{paying ? 'Inatuma…' : 'Lipa kamisheni'}</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {delivered.length === 0 ? (
        <Text style={styles.empty}>Hakuna mzigo uliofika.</Text>
      ) : (
        <View style={styles.list}>
          {delivered.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={styles.code}>{shipmentCode(item)}</Text>
              <Text style={styles.amt}>{money(item.carrierNet)}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    color: theme.ink,
  },
  mapato: {
    marginTop: 16,
    fontFamily: typography.bold,
    fontSize: 20,
    lineHeight: 26,
    color: theme.ink,
  },
  mapatoLabel: {
    marginTop: 2,
    marginBottom: 16,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    borderRadius: 12,
    backgroundColor: theme.white,
    padding: 14,
  },
  progress: {
    fontFamily: typography.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: theme.ink,
  },
  track: {
    marginTop: 10,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#EEF1F4',
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    backgroundColor: '#000000',
  },
  ok: {
    marginTop: 10,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.success,
  },
  wait: {
    marginTop: 10,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.muted,
  },
  payBlock: { marginTop: 14, gap: 8 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontFamily: typography.body,
    fontSize: 15,
    color: theme.ink,
    backgroundColor: theme.white,
  },
  networks: { flexDirection: 'row', gap: 6 },
  network: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
  },
  networkOn: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  networkText: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.ink,
  },
  networkTextOn: { color: theme.white },
  pay: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  payPressed: { backgroundColor: '#1A1A1A' },
  payBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  payText: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  error: {
    marginTop: 10,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.danger,
  },
  empty: {
    marginTop: 22,
    textAlign: 'center',
    fontFamily: typography.body,
    fontSize: 14,
    color: theme.muted,
  },
  list: { marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  code: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.ink,
  },
  amt: {
    fontFamily: typography.body,
    fontSize: 14,
    color: theme.muted,
  },
});
