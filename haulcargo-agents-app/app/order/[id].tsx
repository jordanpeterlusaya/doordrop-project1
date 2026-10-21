import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeskRail } from '@/components/desk-rail';
import { OfferCountdown } from '@/components/offer-countdown';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, advanceDeskStep, cancelAcceptedJob, rejectOffer } from '@/lib/carrier-actions';
import {
  agentStatusError,
  deskIndex,
  deskStatusLabel,
  isCompletedShipment,
  isIncomingOffer,
  money,
  nextDeskStep,
  offerStillValid,
  orderShareMessage,
  shipmentCode,
  telHref,
} from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

async function shareOrder(message: string) {
  const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
  try {
    const can = await Linking.canOpenURL('whatsapp://send');
    if (can) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // WhatsApp is not available — use the system sheet.
  }
  await Share.share({ message });
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shipments, shipmentsReady, carrier, user } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const carrierId = carrier?.id || '';
  const item = useMemo(() => shipments.find((s) => s.id === id), [shipments, id]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const email = user?.email || '';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(agentStatusError(err instanceof Error ? err.message : 'Imeshindwa.'));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (!item) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 8, paddingHorizontal: 20 }]}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Rudi">
          <Ionicons name="chevron-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={styles.code}>{shipmentsReady ? 'Haipo' : 'Oda'}</Text>
      </View>
    );
  }

  const offer = isIncomingOffer(item, carrierId);
  const liveOffer = offer && offerStillValid(item);
  const expiredOffer = offer && !offerStillValid(item);
  const owned = item.carrierId === carrierId;
  const code = shipmentCode(item);
  const next = owned ? nextDeskStep(item) : null;
  const onRail = deskIndex(item) >= 0;
  const pickup = String(item.pickupLabel || item.origin || '').trim();
  const destination = String(item.destination || '').trim();
  const cargoType = String(item.parcelDescription || '').trim();
  const weight = Number(item.weightKg) || 0;
  const cargoLine = [cargoType, weight ? `${weight} kg` : ''].filter(Boolean).join(' · ');
  const priceLine = item.carrierNet != null ? money(item.carrierNet) : '';

  const copyCode = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const confirmReject = () => {
    Alert.alert('Kataa oda', undefined, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Kataa',
        style: 'destructive',
        onPress: () => void run(() => rejectOffer(item.id, carrierId, email)),
      },
    ]);
  };

  const confirmCancel = () => {
    Alert.alert('Futa oda', 'Kufuta baada ya kukubali kunaondoa mfululizo. Akaunti inaweza kufungwa.', [
      { text: 'Rudi', style: 'cancel' },
      {
        text: 'Futa',
        style: 'destructive',
        onPress: () => void run(() => cancelAcceptedJob(item.id, carrierId, email)),
      },
    ]);
  };

  const goNext = () => {
    if (!next) return;
    void run(() => advanceDeskStep(item.id, carrierId, next.key, email));
  };

  let primaryLabel = '';
  let primaryPress: () => void = () => undefined;
  if (liveOffer) {
    primaryLabel = 'Kubali';
    primaryPress = () => void run(() => acceptOffer(item.id, carrierId, email));
  } else if (next) {
    primaryLabel = next.key === 'arrived' ? 'Weka imefika' : next.label;
    primaryPress = goNext;
  }

  if (expiredOffer || (!owned && !offer)) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 8, paddingHorizontal: 20 }]}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Rudi">
          <Ionicons name="chevron-back" size={22} color={theme.ink} />
        </Pressable>
        <Text style={styles.code}>{code}</Text>
        <Text style={styles.status}>Muda umeisha</Text>
      </View>
    );
  }

  const statusLine = copied ? 'Imenakiliwa' : liveOffer ? 'Oda mpya' : deskStatusLabel(item);

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Rudi">
          <Ionicons name="chevron-back" size={22} color={theme.ink} />
        </Pressable>

        <Pressable onPress={() => void copyCode()} accessibilityRole="button">
          <Text style={styles.code}>{code}</Text>
        </Pressable>
        <View style={styles.statusRow}>
          <Text style={styles.status}>{statusLine}</Text>
          {liveOffer ? <OfferCountdown shipment={item} compact /> : null}
        </View>

        {onRail ? <DeskRail item={item} /> : null}

        {pickup || destination ? (
          <View style={styles.block}>
            <Text style={styles.kicker}>Njia</Text>
            {pickup ? <Text style={styles.line}>{pickup}</Text> : null}
            {destination ? <Text style={styles.line}>→ {destination}</Text> : null}
          </View>
        ) : null}

        {cargoLine ? (
          <View style={styles.block}>
            <Text style={styles.kicker}>Mzigo</Text>
            <Text style={styles.line}>{cargoLine}</Text>
          </View>
        ) : null}

        <People
          senderName={item.senderName || item.customerName}
          senderPhone={item.senderPhone || item.customerPhone}
          recipientName={item.recipientName}
          recipientPhone={item.recipientPhone}
          recipientAddress={item.recipientAddress || item.dropoffLabel}
        />

        {priceLine ? (
          <View style={styles.block}>
            <Text style={styles.kicker}>Bei</Text>
            <Text style={styles.line}>{priceLine}</Text>
          </View>
        ) : null}

        {owned ? (
          <Pressable
            style={styles.share}
            onPress={() => void shareOrder(orderShareMessage(item)).catch(() => setError('Imeshindwa kushiriki.'))}
            accessibilityRole="button">
            <Ionicons name="logo-whatsapp" size={18} color={theme.ink} />
            <Text style={styles.shareLabel}>Shiriki</Text>
          </Pressable>
        ) : null}

        {error || agentStatusError(item.arrivalSmsError) ? (
          <Text style={styles.error}>{error || agentStatusError(item.arrivalSmsError)}</Text>
        ) : null}
      </ScrollView>

      {primaryLabel || (owned && !isCompletedShipment(item)) ? (
        <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {owned && !isCompletedShipment(item) && !liveOffer ? (
            <Pressable onPress={confirmCancel} disabled={busy} accessibilityRole="button" style={styles.cancelLink}>
              <Text style={styles.cancelText}>Futa oda</Text>
            </Pressable>
          ) : null}
          {primaryLabel ? <PrimaryButton label={primaryLabel} loading={busy} onPress={primaryPress} /> : null}
          {liveOffer ? <PrimaryButton label="Kataa" variant="outline" disabled={busy} onPress={confirmReject} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function People({
  senderName,
  senderPhone,
  recipientName,
  recipientPhone,
  recipientAddress,
}: {
  senderName?: string;
  senderPhone?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
}) {
  const senderNameText = String(senderName || '').trim();
  const senderPhoneText = String(senderPhone || '').trim();
  const recipientNameText = String(recipientName || '').trim();
  const recipientPhoneText = String(recipientPhone || '').trim();
  const recipientAddressText = String(recipientAddress || '').trim();
  if (
    !senderNameText &&
    !senderPhoneText &&
    !recipientNameText &&
    !recipientPhoneText &&
    !recipientAddressText
  ) {
    return null;
  }
  return (
    <View style={styles.block}>
      <Text style={styles.kicker}>Watu</Text>
      {senderNameText || senderPhoneText ? (
        <PersonRow
          role="Mtumaji"
          value={[senderNameText, senderPhoneText].filter(Boolean).join(' · ')}
          phone={senderPhoneText}
        />
      ) : null}
      {recipientNameText || recipientPhoneText ? (
        <PersonRow
          role="Mpokeaji"
          value={[recipientNameText, recipientPhoneText].filter(Boolean).join(' · ')}
          phone={recipientPhoneText}
        />
      ) : null}
      {recipientAddressText ? <PersonRow role="Anwani" value={recipientAddressText} /> : null}
    </View>
  );
}

function PersonRow({ role, value, phone }: { role: string; value: string; phone?: string }) {
  const tel = telHref(phone);
  const row = (
    <View style={styles.person}>
      <Text style={styles.personRole}>{role}</Text>
      <Text style={styles.personValue}>{value}</Text>
      {tel ? <Ionicons name="call-outline" size={16} color={theme.ink} /> : null}
    </View>
  );
  if (!tel) return row;
  return (
    <Pressable onPress={() => void Linking.openURL(tel)} accessibilityRole="button">
      {row}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.white },
  back: {
    width: 36,
    height: 36,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    fontFamily: typography.bold,
    fontSize: 20,
    lineHeight: 26,
    color: theme.ink,
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 12,
  },
  status: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 18,
    color: theme.muted,
  },
  block: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line,
    paddingVertical: 12,
    gap: 2,
  },
  kicker: {
    fontFamily: typography.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: theme.muted,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  line: {
    fontFamily: typography.body,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
  },
  personRole: {
    width: 78,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  personValue: {
    flex: 1,
    fontFamily: typography.semibold,
    fontSize: 15,
    color: theme.ink,
  },
  share: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareLabel: {
    fontFamily: typography.semibold,
    fontSize: 15,
    color: theme.ink,
  },
  error: {
    marginTop: 10,
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.danger,
  },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
    backgroundColor: theme.white,
  },
  cancelLink: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  cancelText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.danger,
  },
});
