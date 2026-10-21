import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PickupDirectionButton } from '@/components/pickup-direction-button';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, rejectOffer } from '@/lib/carrier-actions';
import { agentStatusError } from '@/lib/carrier-helpers';
import { stopIncomingOrderAlarm } from '@/lib/incoming-order-sound';
import { useCarrierSession } from '@/providers/carrier-session';

/** Bottom sheet for a new offer. Sits under the desk rows. Chime stops on action. */
export function IncomingOrderAlert() {
  const { offerBanner, dismissOfferBanner, carrier, user } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  if (!offerBanner || !carrier?.id) return null;

  const carrierId = carrier.id;
  const email = user?.email || '';
  const weight = offerBanner.weightKg ? `${offerBanner.weightKg} kg` : '—';
  const payout = offerBanner.payoutLabel || '';
  const route =
    offerBanner.routeLabel && offerBanner.routeLabel !== offerBanner.code ? offerBanner.routeLabel : '';
  const tabClearance = 54 + Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 6) + 10;

  const handleDismiss = () => {
    stopIncomingOrderAlarm('dismiss');
    dismissOfferBanner();
  };

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    stopIncomingOrderAlarm('accept');
    try {
      const shipmentId = offerBanner.shipmentId;
      await acceptOffer(shipmentId, carrierId, email);
      dismissOfferBanner();
      router.push(`/order/${shipmentId}`);
    } catch (err) {
      const msg = agentStatusError(err instanceof Error ? err.message : 'Imeshindwa kukubali oda.');
      if (msg) Alert.alert('Imeshindwa', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = () => {
    if (busy) return;
    stopIncomingOrderAlarm('reject');
    Alert.alert('Kataa oda', undefined, [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Kataa',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void rejectOffer(offerBanner.shipmentId, carrierId, email)
            .then(() => {
              dismissOfferBanner();
            })
            .catch((err) => {
              const msg = agentStatusError(err instanceof Error ? err.message : 'Imeshindwa.');
              if (msg) Alert.alert('Imeshindwa', msg);
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: tabClearance }]}>
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.head}>
          <Text style={styles.code} numberOfLines={1}>
            {offerBanner.code}
          </Text>
          <PickupDirectionButton item={offerBanner.shipment} compact />
          <Pressable
            onPress={handleDismiss}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Funga"
            style={styles.close}>
            <Ionicons name="close" size={16} color={theme.ink} />
          </Pressable>
        </View>

        {route ? (
          <Text style={styles.route} numberOfLines={1}>
            {route}
          </Text>
        ) : null}

        {offerBanner.valueLabel ? (
          <Text style={styles.value} numberOfLines={1}>
            {offerBanner.valueLabel}
          </Text>
        ) : null}

        <View style={styles.meta}>
          <Text style={styles.metaText}>{weight}</Text>
          {payout ? <Text style={styles.payout}>{payout}</Text> : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => void handleAccept()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.accept, pressed && styles.acceptPressed, busy && styles.acceptBusy]}>
            <Text style={styles.acceptText}>{busy ? 'Inakubali…' : 'Kubali'}</Text>
          </Pressable>
          <Pressable onPress={handleReject} disabled={busy} accessibilityRole="button" hitSlop={8} style={styles.reject}>
            <Text style={styles.rejectText}>Kataa</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
  },
  card: {
    backgroundColor: theme.white,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D6D9DE',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  code: {
    flex: 1,
    fontFamily: typography.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.3,
    color: theme.ink,
  },
  close: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
  },
  route: {
    marginTop: 8,
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: theme.ink,
  },
  value: {
    marginTop: 2,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.ink,
  },
  meta: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaText: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.muted,
  },
  payout: {
    fontFamily: typography.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: theme.ink,
  },
  actions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accept: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptPressed: { backgroundColor: '#1A1A1A' },
  acceptBusy: { backgroundColor: theme.cta.disabledBackgroundColor },
  acceptText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  reject: {
    minHeight: 40,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    fontFamily: typography.semibold,
    fontSize: 14,
    color: theme.muted,
  },
});
