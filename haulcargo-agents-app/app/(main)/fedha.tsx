import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommissionPaySheet, type PayNetworkKey } from '@/components/commission-pay-sheet';
import { EarnedIcon, OwedIcon } from '@/components/money-icons';
import { TierMedal } from '@/components/tier-medal';
import { Screen } from '@/components/ui';
import { commissionPayCeiling, tierBenefitLabel } from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { isValidTzPhone } from '@/lib/phone';
import { deskStanding, haulFeeOutstanding, unpaidHaulFee } from '@/lib/desk-standing';
import { loadCommissionPayIntent, saveCommissionPayIntent } from '@/lib/commission-intent';
import { requestCommissionUssd, verifyCommissionUssd } from '@/lib/carrier-commission-api';
import { fireTimeMs, isCompletedShipment, money, shipmentCode } from '@/lib/carrier-helpers';
import type { CarrierShipment } from '@/lib/carrier-types';
import { useCarrierSession } from '@/providers/carrier-session';

export default function FedhaScreen() {
  const { carrier, shipments, decisions } = useCarrierSession();
  const carrierId = carrier?.id || '';
  const [phone, setPhone] = useState(carrier?.phone || '');
  const [network, setNetwork] = useState<PayNetworkKey>('mpesa');
  const [phoneHint, setPhoneHint] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [sheetNote, setSheetNote] = useState('');
  const [waitNote, setWaitNote] = useState('');
  const orderRef = useRef('');

  useEffect(() => {
    const next = carrier?.phone || '';
    if (next) setPhone((current) => current || next);
  }, [carrier?.phone]);

  useEffect(() => {
    if (!carrierId) return;
    let stopped = false;
    void loadCommissionPayIntent(carrierId).then((intent) => {
      if (stopped || !intent) return;
      if (intent.phone) setPhone(intent.phone);
      setNetwork(intent.network);
    });
    return () => {
      stopped = true;
    };
  }, [carrierId]);

  useEffect(() => {
    if (!carrierId) return undefined;
    let stopped = false;
    const tick = async (force: boolean) => {
      if (!force && !orderRef.current) return;
      try {
        const result = await verifyCommissionUssd(orderRef.current || undefined);
        if (stopped) return;
        if (result.status === 'pending') {
          if (result.orderId) orderRef.current = result.orderId;
          setWaitNote('Subiri uthibitisho kwenye simu.');
          return;
        }
        if (result.status === 'failed' && orderRef.current) {
          orderRef.current = '';
          setWaitNote('');
          setSheetNote('Malipo hayajakamilika.');
          return;
        }
        setWaitNote('');
        orderRef.current = '';
      } catch {
        // Unknown result leaves Unadaiwa as it is.
      }
    };
    void tick(true);
    const timer = setInterval(() => void tick(false), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [carrierId]);

  const delivered = useMemo(() => {
    return shipments
      .filter((item) => item.carrierId === carrierId && isCompletedShipment(item))
      .sort((a, b) => (fireTimeMs(b.arrivedAt) || fireTimeMs(b.deliveredAt) || 0) - (fireTimeMs(a.arrivedAt) || fireTimeMs(a.deliveredAt) || 0));
  }, [shipments, carrierId]);

  const mapato = useMemo(() => delivered.reduce((sum, item) => sum + (Number(item.carrierNet) || 0), 0), [delivered]);
  const unpaid = useMemo(() => unpaidHaulFee(shipments, carrierId), [shipments, carrierId]);

  const standing = useMemo(
    () => deskStanding(shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels),
    [shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels],
  );
  const ceiling = commissionPayCeiling(standing);
  const blocked = unpaid >= ceiling;

  const payCommission = async (payAmount: number) => {
    const chosen = Math.round(Number(payAmount) || 0);
    if (payBusy) return;
    if (chosen <= 0 || chosen > unpaid) return;
    if (!isValidTzPhone(phone)) {
      setPhoneHint('Weka namba ya simu.');
      return;
    }
    setPhoneHint('');
    setSheetNote('');
    setPayBusy(true);
    try {
      const result = await requestCommissionUssd({
        phoneNumber: phone.trim(),
        network,
        amount: chosen,
      });
      void saveCommissionPayIntent({
        carrierId,
        phone: phone.trim(),
        network,
        amount: chosen,
        at: new Date().toISOString(),
      }).catch(() => undefined);
      if (result.orderId) orderRef.current = result.orderId;
      if (result.status === 'failed') {
        setWaitNote('');
        setSheetNote('Malipo hayajakamilika.');
        return;
      }
      setWaitNote('Subiri uthibitisho kwenye simu.');
      setSheetNote('Subiri uthibitisho kwenye simu.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'USSD haijatumwa. Jaribu tena.';
      setSheetNote(message);
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <Screen scroll edges="top" backgroundColor="#F4F5F7">
      <Text style={styles.title}>Fedha</Text>
      <View style={styles.tierLine}>
        <TierMedal id={standing.tier.id} width={32} />
        <View style={styles.tierCopy}>
          <Text style={styles.tierName}>{standing.tier.label}</Text>
          <Text style={styles.tierBenefit}>{tierBenefitLabel(standing)}</Text>
        </View>
      </View>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <View style={styles.iconWell}>
            <EarnedIcon />
          </View>
          <Text style={styles.figureLabel}>Umepata</Text>
          <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
            {money(mapato)}
          </Text>
          <Text style={styles.figureHint}>Pesa yako</Text>
        </View>
        <View style={styles.figure}>
          <View style={styles.iconWell}>
            <OwedIcon />
          </View>
          <Text style={styles.figureLabel}>Unadaiwa</Text>
          <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
            {money(unpaid)}
          </Text>
          <Text style={styles.figureHint}>Kamisheni</Text>
        </View>
      </View>

      {unpaid <= 0 ? <Text style={styles.debtNote}>Hakuna deni</Text> : (
        <Text style={styles.debtNote}>Lipa kiasi chochote sasa.</Text>
      )}
      <Text style={blocked ? styles.blocked : styles.debtNote}>
        {blocked
          ? `Ofa mpya zimesimama. Zinaendelea Unadaiwa ikishuka chini ya ${money(ceiling)}.`
          : `Oda mpya zinasimama Unadaiwa ikifika ${money(ceiling)}.`}
      </Text>

      {unpaid > 0 ? (
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.openPay, pressed && styles.openPayPressed]}>
          <Text style={styles.openPayText}>Lipa kamisheni</Text>
        </Pressable>
      ) : null}
      {waitNote ? <Text style={styles.debtNote}>{waitNote}</Text> : null}
      {!sheetOpen && sheetNote && sheetNote !== waitNote ? <Text style={styles.debtNote}>{sheetNote}</Text> : null}

      <CommissionPaySheet
        visible={sheetOpen}
        amount={unpaid}
        phone={phone}
        network={network}
        phoneHint={phoneHint}
        busy={payBusy}
        statusNote={sheetNote}
        onChangePhone={(value) => {
          setPhone(value);
          if (phoneHint) setPhoneHint('');
        }}
        onChangeNetwork={setNetwork}
        onPay={(value) => void payCommission(value)}
        onClose={() => setSheetOpen(false)}
      />

      {delivered.length === 0 ? (
        <Text style={styles.empty}>Hakuna mzigo uliofika.</Text>
      ) : (
        <View style={styles.list}>
          <Text style={styles.listLabel}>Mizigo iliyofika</Text>
          {delivered.map((item) => (
            <DeliveredRow key={item.id} item={item} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function DeliveredRow({ item }: { item: CarrierShipment }) {
  const owed = haulFeeOutstanding(item);
  return (
    <View style={styles.row}>
      <Text style={styles.code}>{shipmentCode(item)}</Text>
      <View style={styles.rowMoney}>
        <Text style={styles.amt}>{money(item.carrierNet)}</Text>
        {owed > 0 ? <Text style={styles.fee}>Deni {money(owed)}</Text> : null}
      </View>
    </View>
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
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.muted,
  },
  blocked: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  openPay: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openPayPressed: { opacity: 0.9 },
  openPayText: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: '#FFFFFF',
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
