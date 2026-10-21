import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { EarnedIcon, OwedIcon } from '@/components/money-icons';
import { TierMedal } from '@/components/tier-medal';
import { Screen } from '@/components/ui';
import { COMMISSION_PAY_THRESHOLD_TZS, tierBenefitLabel } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { deskStanding } from '@/lib/desk-standing';
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
  const { carrier, shipments, refreshCarrier, decisions } = useCarrierSession();
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

  const standing = useMemo(
    () => deskStanding(shipments, carrierId, decisions, carrier?.rejected),
    [shipments, carrierId, decisions, carrier?.rejected],
  );
  const due = totals.unpaid >= COMMISSION_PAY_THRESHOLD_TZS && !totals.holding;
  const debtNote =
    totals.unpaid <= 0
      ? 'Hakuna deni'
      : totals.unpaid < COMMISSION_PAY_THRESHOLD_TZS
        ? `Lipa ukifika ${money(COMMISSION_PAY_THRESHOLD_TZS)}`
        : '';

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
      <View style={styles.tierLine}>
        <TierMedal id={standing.tier.id} width={32} />
        <View style={styles.tierCopy}>
          <Text style={styles.tierName}>{standing.tier.label}</Text>
          <Text style={styles.tierBenefit}>{tierBenefitLabel(standing.tier)}</Text>
        </View>
      </View>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <View style={styles.iconWell}>
            <EarnedIcon />
          </View>
          <Text style={styles.figureLabel}>Umepata</Text>
          <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
            {money(totals.mapato)}
          </Text>
          <Text style={styles.figureHint}>Pesa yako</Text>
        </View>
        <View style={styles.figure}>
          <View style={styles.iconWell}>
            <OwedIcon />
          </View>
          <Text style={styles.figureLabel}>Unadaiwa</Text>
          <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
            {money(totals.unpaid)}
          </Text>
          <Text style={styles.figureHint}>Kamisheni</Text>
        </View>
      </View>
      {debtNote ? <Text style={styles.debtNote}>{debtNote}</Text> : null}

      {due || totals.holding || (confirmed && !totals.holding) || error ? (
      <View style={styles.panel}>
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
      ) : null}

      {delivered.length === 0 ? (
        <Text style={styles.empty}>Hakuna mzigo uliofika.</Text>
      ) : (
        <View style={styles.list}>
          <Text style={styles.listLabel}>Mizigo iliyofika</Text>
          {delivered.map((item) => {
            const fee = Number(item.haulFee) || 0;
            const reconciled = String(item.cashStatus || '').toLowerCase() === 'reconciled';
            return (
              <View key={item.id} style={styles.row}>
                <Text style={styles.code}>{shipmentCode(item)}</Text>
                <View style={styles.rowMoney}>
                  <Text style={styles.amt}>{money(item.carrierNet)}</Text>
                  {fee > 0 && !reconciled ? <Text style={styles.fee}>Deni {money(fee)}</Text> : null}
                </View>
              </View>
            );
          })}
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
  tierLine: {
    marginTop: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tierCopy: { flex: 1, minWidth: 0 },
  tierName: {
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 20,
    color: theme.ink,
  },
  tierBenefit: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  figures: {
    flexDirection: 'row',
    gap: 8,
  },
  figure: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    backgroundColor: theme.white,
  },
  iconWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  figureLabel: {
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  figureValue: {
    marginTop: 4,
    fontFamily: typography.bold,
    fontSize: 16,
    lineHeight: 22,
    color: theme.ink,
  },
  figureHint: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 16,
    color: theme.muted,
  },
  debtNote: {
    marginTop: 8,
    marginBottom: 4,
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 16,
    color: theme.muted,
  },
  panel: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    borderRadius: 12,
    backgroundColor: theme.white,
    padding: 14,
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
  payBlock: { gap: 8 },
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
  list: { marginTop: 18 },
  listLabel: {
    fontFamily: typography.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.muted,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  rowMoney: { alignItems: 'flex-end' },
  fee: {
    marginTop: 2,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
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
