import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferCountdown } from '@/components/offer-countdown';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { acceptOffer, rejectOffer } from '@/lib/carrier-actions';
import { agentStatusError } from '@/lib/carrier-helpers';
import {
  isIncomingOrderAlarmRinging,
  startIncomingOrderAlarm,
  stopIncomingOrderAlarm,
  subscribeIncomingOrderAlarm,
} from '@/lib/incoming-order-sound';
import { useCarrierSession } from '@/providers/carrier-session';

/**
 * Custom high-priority incoming cargo order notification overlay.
 * Appears immediately with custom alarm sound (`incoming_order_alarm.wav`)
 * whenever a new cargo offer (`shipmentStatus === 'assigned'`) arrives for the carrier.
 */
export function IncomingOrderAlert() {
  const { offerBanner, dismissOfferBanner, carrier, user } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [ringing, setRinging] = useState(isIncomingOrderAlarmRinging());

  useEffect(() => {
    return subscribeIncomingOrderAlarm((active) => {
      setRinging(active);
    });
  }, []);

  if (!offerBanner || !carrier?.id) return null;

  const carrierId = carrier.id;
  const email = user?.email || '';
  const metaParts = [
    offerBanner.weightKg ? `${offerBanner.weightKg} kg` : '',
    offerBanner.parcelDescription,
    offerBanner.payoutLabel,
  ].filter(Boolean);

  const handleOpenOrder = () => {
    const shipmentId = offerBanner.shipmentId;
    stopIncomingOrderAlarm('open-order');
    dismissOfferBanner();
    router.push(`/order/${shipmentId}`);
  };

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    stopIncomingOrderAlarm('accept-from-notification');
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
    stopIncomingOrderAlarm('reject-prompt');
    Alert.alert('Kataa oda', 'Una uhakika unataka kukataa oda hii ya mzigo?', [
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

  const toggleSound = () => {
    if (ringing) {
      stopIncomingOrderAlarm('muted-by-user');
    } else {
      void startIncomingOrderAlarm(offerBanner.shipmentId, { loop: true });
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingTop: Math.max(insets.top + 6, 14) }]}>
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.headerRow}>
          <View style={styles.badge}>
            <Ionicons
              name={ringing ? 'volume-high' : 'notifications'}
              size={14}
              color={theme.ink}
            />
            <Text style={styles.badgeText}>ODA MPYA YA MZIGO — KUBALI SASA</Text>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              onPress={toggleSound}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={ringing ? 'Zima sauti' : 'Washa sauti'}
              style={styles.soundPill}>
              <Ionicons
                name={ringing ? 'volume-mute-outline' : 'volume-high-outline'}
                size={14}
                color={theme.white}
              />
              <Text style={styles.soundPillText}>{ringing ? 'Zima sauti' : 'Sauti'}</Text>
            </Pressable>
            <Pressable
              onPress={dismissOfferBanner}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Funga arifa"
              style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={theme.white} />
            </Pressable>
          </View>
        </View>

        <Pressable onPress={handleOpenOrder} style={styles.contentTap}>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{offerBanner.code}</Text>
            <OfferCountdown shipment={offerBanner.shipment} compact />
          </View>

          <Text style={styles.route} numberOfLines={2}>
            {offerBanner.routeLabel}
          </Text>

          {metaParts.length > 0 ? (
            <Text style={styles.meta} numberOfLines={2}>
              {metaParts.join(' · ')}
            </Text>
          ) : null}
        </Pressable>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => void handleAccept()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.acceptBtn,
              pressed && styles.acceptPressed,
              busy && styles.btnDisabled,
            ]}>
            <Ionicons name="checkmark-circle" size={17} color={theme.ink} />
            <Text style={styles.acceptText}>{busy ? 'Inakubali…' : 'Kubali mzigo'}</Text>
          </Pressable>

          <Pressable
            onPress={handleOpenOrder}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.openBtn, pressed && styles.openPressed]}>
            <Text style={styles.openText}>Fungua</Text>
          </Pressable>

          <Pressable
            onPress={handleReject}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.rejectBtn, pressed && styles.openPressed]}>
            <Text style={styles.rejectText}>Kataa</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingHorizontal: 12,
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.brandYellow,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: theme.brandYellow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexShrink: 1,
  },
  badgeText: {
    fontFamily: typography.bold,
    fontSize: 10.5,
    letterSpacing: 0.3,
    color: theme.ink,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  soundPillText: {
    fontFamily: typography.semibold,
    fontSize: 11,
    color: theme.white,
  },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  contentTap: {
    marginTop: 10,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  code: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: '#CBD5E1',
    letterSpacing: 0.4,
  },
  route: {
    marginTop: 2,
    fontFamily: typography.bold,
    fontSize: 17,
    lineHeight: 22,
    color: theme.white,
    letterSpacing: -0.3,
  },
  meta: {
    marginTop: 4,
    fontFamily: typography.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: theme.brandYellow,
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acceptBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.brandYellow,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  acceptPressed: {
    opacity: 0.9,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  acceptText: {
    fontFamily: typography.bold,
    fontSize: 13.5,
    color: theme.ink,
  },
  openBtn: {
    flex: 0.9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 40,
  },
  openPressed: {
    opacity: 0.8,
  },
  openText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.white,
  },
  rejectBtn: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 40,
  },
  rejectText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: '#FCA5A5',
  },
});
