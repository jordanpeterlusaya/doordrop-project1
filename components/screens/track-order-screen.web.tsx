import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { BottomNav, CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { OutsideParcelReceiptModal } from '@/components/outside-parcel-receipt-modal';
import { cargoTheme } from '@/constants/cargo-theme';
import { useAppCopy } from '@/lib/app-copy';
import {
  cancelDeliveryOrderByUser,
  getDeliveryOrderStatusLabel,
  hasDeliveryOrderRating,
  isNinunulieOrder,
  submitDeliveryOrderRating,
  subscribeToOrder,
  type DeliveryOrder,
} from '@/lib/delivery-data';
import { buildRecipientSmsBody, isNotifiableRecipientPhone, openRecipientSms } from '@/lib/recipient-notify';
import { getActiveOrderHeadline, getBusParcelDetail, isBusCustomerParcel, isCargoNegotiationOpen } from '@/lib/active-order-display';
import { lookupTrackOrderByCode, normalizeTrackCodeInput } from '@/lib/parcel-track-lookup';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';

const cancellationReasons = [
  'I entered the wrong pickup or drop-off details',
  'The price is higher than expected',
  'I no longer need this delivery',
  'I want to change the vehicle or service type',
  'Pickup is taking too long',
] as const;

const ratingOptions = [1, 2, 3, 4, 5] as const;

function getParamValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function shouldHideOrderOnTrack(order: DeliveryOrder | null) {
  return !!order && (order.status === 'cancelled' || isNinunulieOrder(order) || isCargoNegotiationOpen(order));
}

export default function TrackOrderWebScreen() {
  const router = useRouter();
  const { profile, user } = useAuthSession();
  const copy = useAppCopy();
  const { language } = useLanguage();
  const params = useLocalSearchParams<{ orderId?: string; placed?: string; notifyRecipient?: string; receipt?: string }>();
  const orderId = getParamValue(params.orderId);
  const placedParam = getParamValue(params.placed);
  const notifyRecipientParam = getParamValue(params.notifyRecipient);
  const receiptParam = getParamValue(params.receipt);
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState<(typeof cancellationReasons)[number] | ''>('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [showRatingPanel, setShowRatingPanel] = useState(false);
  const [showPlacedSheet, setShowPlacedSheet] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [smsOpening, setSmsOpening] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingPromptDismissedOrderId, setRatingPromptDismissedOrderId] = useState<string | null>(null);
  const [trackCodeInput, setTrackCodeInput] = useState('');
  const [trackLookupError, setTrackLookupError] = useState('');
  const [trackLookupLoading, setTrackLookupLoading] = useState(false);

  useEffect(() => {
    if (placedParam === '1' && notifyRecipientParam !== '1') {
      setShowPlacedSheet(true);
    }
  }, [notifyRecipientParam, orderId, placedParam]);

  useEffect(() => {
    if (receiptParam === '1' && order) {
      setShowReceipt(true);
    }
  }, [order, receiptParam]);

  useEffect(() => {
    if (!order) {
      return;
    }
    setTrackCodeInput(String(order.parcelCode || order.trackingId || order.orderNumber || '').trim());
  }, [order?.id]);

  const handleTrackCodeLookup = async () => {
    const queryText = trackCodeInput.trim();
    if (!queryText || trackLookupLoading) {
      return;
    }
    setTrackLookupLoading(true);
    setTrackLookupError('');
    try {
      const result = await lookupTrackOrderByCode(queryText);
      if (!result) {
        setTrackLookupError(copy.track.trackCodeNotFound);
        return;
      }
      setTrackCodeInput(result.parcelCode || result.orderNumber || normalizeTrackCodeInput(queryText));
      router.setParams({ orderId: result.orderId, placed: '', notifyRecipient: '' });
    } catch {
      setTrackLookupError(copy.track.trackCodeLookupFailed);
    } finally {
      setTrackLookupLoading(false);
    }
  };

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }

    const unsubscribe = subscribeToOrder(orderId, (nextOrder) => {
      setOrder(shouldHideOrderOnTrack(nextOrder) ? null : nextOrder);
      setLoading(false);
    });

    return unsubscribe;
  }, [orderId]);

  useEffect(() => {
    if (!order) {
      setShowRatingPanel(false);
      setRatingValue(0);
      setRatingReview('');
      setRatingPromptDismissedOrderId(null);
      return;
    }

    if (hasDeliveryOrderRating(order)) {
      setRatingValue(order.customerRating ?? 0);
      setRatingReview(order.customerReview?.trim() || '');
      return;
    }

    if (order.status !== 'delivered') {
      setShowRatingPanel(false);
      setRatingValue(0);
      setRatingReview('');
      setRatingPromptDismissedOrderId(null);
      return;
    }

    if (ratingPromptDismissedOrderId !== order.id && !showRatingPanel) {
      setShowRatingPanel(true);
    }
  }, [order, ratingPromptDismissedOrderId, showRatingPanel]);

  const driverPhone = order?.driverPhone?.trim() || '';
  const hasDriverPhone = driverPhone.length > 0;
  const canCancelOrder = !!order && !['delivered', 'cancelled'].includes(order.status);
  const orderHasRating = hasDeliveryOrderRating(order);
  const canRateOrder = !!order && order.status === 'delivered' && !!user?.uid && user.uid === order.userId;

  const handleCallDriver = async () => {
    if (!hasDriverPhone) {
      return;
    }

    await Linking.openURL(`tel:${driverPhone.replace(/[^\d+]/g, '')}`);
  };

  const handleShareTrip = async () => {
    if (!order || typeof window === 'undefined') {
      return;
    }

    const shareMessage = [
      `DoorDrop trip ${order.orderNumber}`,
      `${order.pickupLabel} to ${order.dropoffLabel}`,
      `Status: ${getDeliveryOrderStatusLabel(order.status)}`,
      order.driverName ? `Driver: ${order.driverName}` : '',
      driverPhone ? `Phone: ${driverPhone}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const shareUrl = orderId ? `${window.location.origin}/track-order?orderId=${encodeURIComponent(orderId)}` : window.location.href;

    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({
        title: order.orderNumber,
        text: shareMessage,
        url: shareUrl,
      });
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(`${shareMessage}\n${shareUrl}`);
    }
  };

  const handleSubmitCancelOrder = () => {
    if (!order || !canCancelOrder || cancelSubmitting) {
      return;
    }

    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length < 4) {
      Alert.alert('Reason required', 'Please choose a cancellation reason before submitting.');
      return;
    }

    Alert.alert('Cancel this order?', `Reason: ${trimmedReason}`, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setCancelSubmitting(true);
              await cancelDeliveryOrderByUser(order.id, trimmedReason);
              setShowCancelPanel(false);
              setCancelReason('');
              setOrder(null);
              router.replace('/track-order');
            } catch (error) {
              Alert.alert(
                'Unable to cancel order',
                error instanceof Error ? error.message : 'Please try cancelling this order again.'
              );
            } finally {
              setCancelSubmitting(false);
            }
          })();
        },
      },
    ]);
  };

  const handleOpenRatingPanel = () => {
    if (!order) {
      return;
    }

    setRatingValue(order.customerRating ?? 0);
    setRatingReview(order.customerReview?.trim() || '');
    setRatingPromptDismissedOrderId(null);
    setShowRatingPanel(true);
  };

  const handleCloseRatingPanel = () => {
    if (ratingSubmitting) {
      return;
    }

    if (order?.status === 'delivered' && !orderHasRating) {
      setRatingPromptDismissedOrderId(order.id);
    }

    setShowRatingPanel(false);
  };

  const dismissPlacedSheet = () => {
    setShowPlacedSheet(false);
    router.setParams({ placed: '', notifyRecipient: '' });
  };

  const handlePlacedNotifySms = async () => {
    if (!order || !isNotifiableRecipientPhone(order.recipientPhone)) {
      dismissPlacedSheet();
      return;
    }

    setSmsOpening(true);
    try {
      await openRecipientSms(
        order.recipientPhone,
        buildRecipientSmsBody({
          isSw: language === 'sw',
          senderName: order.customerName || profile?.fullName || 'DoorDrop',
          orderNumber: order.orderNumber,
          pickup: order.pickupLabel,
          dropoff: order.dropoffLabel,
        })
      );
    } catch {
      Alert.alert(copy.help.callFailed, copy.track.smsRecipient);
    } finally {
      setSmsOpening(false);
      dismissPlacedSheet();
    }
  };

  const handleSubmitRating = async () => {
    if (!order || !user?.uid || user.uid !== order.userId) {
      Alert.alert('Rating unavailable', 'Please sign in with the account that placed this order to rate it.');
      return;
    }

    if (ratingValue < 1 || ratingValue > 5) {
      Alert.alert('Choose a star rating', 'Tap between 1 and 5 stars before submitting your review.');
      return;
    }

    try {
      setRatingSubmitting(true);
      await submitDeliveryOrderRating({
        orderId: order.id,
        userId: user.uid,
        rating: ratingValue,
        review: ratingReview,
      });
      setRatingPromptDismissedOrderId(null);
      setShowRatingPanel(false);
    } catch (error) {
      Alert.alert('Rating not saved', error instanceof Error ? error.message : 'Please try sending your rating again.');
    } finally {
      setRatingSubmitting(false);
    }
  };

  const vehicleLine = [order?.driverVehicleLabel, order?.driverPlateNumber].filter(Boolean).join(' · ');

  return (
    <CargoScreen contentContainerStyle={styles.content} footer={<BottomNav />}>
      <View style={styles.pageBar} />
      <CargoHeader
        title={copy.track.title}
        leftAction="back"
        onLeftPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }
          router.replace('/home');
        }}
      />

      {loading ? (
        <View style={styles.quietState}>
          <Text style={styles.statusLine}>{copy.common.loading}</Text>
        </View>
      ) : null}

      {!loading && !order ? (
        <View style={styles.quietState}>
          <Text style={styles.statusLine}>{copy.track.emptyTitle}</Text>
          <TextInput
            value={trackCodeInput}
            onChangeText={(value) => {
              setTrackCodeInput(value);
              if (trackLookupError) setTrackLookupError('');
            }}
            placeholder={copy.track.trackCodePlaceholder}
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
            onSubmitEditing={() => {
              void handleTrackCodeLookup();
            }}
          />
          <Pressable accessibilityRole="button" style={styles.codeButton} onPress={() => void handleTrackCodeLookup()}>
            <Text style={styles.codeButtonLabel}>{trackLookupLoading ? copy.common.loading : copy.track.trackCodeSearch}</Text>
          </Pressable>
          {trackLookupError ? <Text style={styles.codeError}>{trackLookupError}</Text> : null}
        </View>
      ) : null}

      {order ? (
        <>
          <View style={styles.statusBlock}>
            <Text style={styles.statusLine}>{getActiveOrderHeadline(order, language)}</Text>
            {isBusCustomerParcel(order) ? <Text style={styles.driverMeta}>{getBusParcelDetail(order, language)}</Text> : null}
            <View style={styles.statusPointer} />
          </View>

          {order.driverId ? (
            <View style={styles.driverRow}>
              <View style={styles.driverCopy}>
                <Text style={styles.driverName}>{order.driverName || copy.track.assigned}</Text>
                {vehicleLine ? <Text style={styles.driverMeta}>{vehicleLine}</Text> : null}
              </View>
              {hasDriverPhone ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={copy.track.call}
                  style={styles.callButton}
                  onPress={() => {
                    void handleCallDriver();
                  }}>
                  <MaterialCommunityIcons name="phone" size={18} color="#111827" />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={styles.stopRow}>
            <Text style={styles.stopLabel}>{copy.common.from}</Text>
            <Text style={styles.stopValue}>{order.pickupLabel}</Text>
          </View>
          <View style={styles.stopRow}>
            <Text style={styles.stopLabel}>{copy.common.to}</Text>
            <Text style={styles.stopValue}>{order.dropoffLabel}</Text>
          </View>
          <Text style={styles.stopLabel}>{language === 'sw' ? 'Msimbo wa mzigo' : 'Parcel code'}</Text>
          <TextInput
            value={trackCodeInput}
            onChangeText={(value) => {
              setTrackCodeInput(value);
              if (trackLookupError) setTrackLookupError('');
            }}
            placeholder={copy.track.trackCodePlaceholder}
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
            onSubmitEditing={() => {
              void handleTrackCodeLookup();
            }}
          />
          <Pressable accessibilityRole="button" style={styles.codeButton} onPress={() => void handleTrackCodeLookup()}>
            <Text style={styles.codeButtonLabel}>{trackLookupLoading ? copy.common.loading : copy.track.trackCodeSearch}</Text>
          </Pressable>
          {trackLookupError ? <Text style={styles.codeError}>{trackLookupError}</Text> : null}

          {order.status === 'delivered' ? (
            <Pressable accessibilityRole="button" style={styles.textAction} onPress={canRateOrder ? handleOpenRatingPanel : undefined}>
              <Text style={styles.textActionLabel}>{copy.track.rating}</Text>
            </Pressable>
          ) : null}

          <View style={styles.iconActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.track.share}
              style={styles.iconAction}
              onPress={() => {
                void handleShareTrip();
              }}>
              <View style={styles.iconBubble}>
                <MaterialCommunityIcons name="share-variant" size={22} color="#111827" />
              </View>
              <Text style={styles.iconActionLabel}>{copy.track.share}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.parcel.receiptView}
              style={styles.iconAction}
              onPress={() => setShowReceipt(true)}>
              <View style={[styles.iconBubble, styles.iconBubbleYellow]}>
                <MaterialCommunityIcons name="receipt" size={22} color="#111827" />
              </View>
              <Text style={styles.iconActionLabel}>{copy.parcel.receiptView}</Text>
            </Pressable>
          </View>
          {isNotifiableRecipientPhone(order.recipientPhone) ? (
            <Pressable
              accessibilityRole="button"
              style={styles.solidButton}
              onPress={() => {
                void handlePlacedNotifySms();
              }}>
              <Text style={styles.solidButtonLabel}>{copy.track.smsRecipient}</Text>
            </Pressable>
          ) : null}
          {canCancelOrder ? (
            <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => setShowCancelPanel(true)}>
              <Text style={styles.dangerButtonLabel}>{copy.track.cancelOrder}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Modal animationType="fade" transparent visible={showCancelPanel} onRequestClose={() => setShowCancelPanel(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!cancelSubmitting) {
                setShowCancelPanel(false);
              }
            }}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.cardTitle}>Cancel this order</Text>
              <TouchableOpacity
                disabled={cancelSubmitting}
                onPress={() => {
                  setShowCancelPanel(false);
                  setCancelReason('');
                }}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.subtext} />
              </TouchableOpacity>
            </View>
            <Text style={styles.cardMeta}>Choose a cancellation reason so dispatch and the driver have the right context.</Text>
            <View style={styles.reasonList}>
              {cancellationReasons.map((reason) => {
                const isSelected = cancelReason === reason;

                return (
                  <TouchableOpacity
                    key={reason}
                    activeOpacity={0.88}
                    style={[styles.reasonOption, isSelected && styles.reasonOptionSelected]}
                    onPress={() => setCancelReason(reason)}>
                    <View style={[styles.reasonRadio, isSelected && styles.reasonRadioSelected]}>
                      {isSelected ? <View style={styles.reasonRadioDot} /> : null}
                    </View>
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.actionsRow}>
              <PrimaryButton
                label="Keep order"
                variant="secondary"
                style={styles.actionButton}
                onPress={() => {
                  setShowCancelPanel(false);
                  setCancelReason('');
                }}
              />
              <PrimaryButton
                label={cancelSubmitting ? 'Cancelling...' : 'Confirm cancel'}
                variant="dark"
                icon="close-circle-outline"
                style={styles.cancelPrimaryButton}
                onPress={handleSubmitCancelOrder}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={showRatingPanel} onRequestClose={handleCloseRatingPanel}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={handleCloseRatingPanel} />
          <View style={styles.ratingModalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.cardTitle}>Rate this delivery</Text>
              <TouchableOpacity disabled={ratingSubmitting} onPress={handleCloseRatingPanel}>
                <MaterialCommunityIcons name="close" size={22} color={cargoTheme.colors.subtext} />
              </TouchableOpacity>
            </View>
            <Text style={styles.cardMeta}>Share a star rating and optional note about this completed DoorDrop trip.</Text>
            <View style={styles.ratingStarsPickerRow}>
              {ratingOptions.map((star) => {
                const active = star <= ratingValue;
                return (
                  <TouchableOpacity
                    key={star}
                    activeOpacity={0.88}
                    disabled={ratingSubmitting}
                    style={[styles.ratingStarButton, active && styles.ratingStarButtonActive]}
                    onPress={() => setRatingValue(star)}>
                    <MaterialCommunityIcons name={active ? 'star' : 'star-outline'} size={24} color="#F59E0B" />
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              value={ratingReview}
              onChangeText={setRatingReview}
              editable={!ratingSubmitting}
              multiline
              maxLength={240}
              placeholder="Optional note about the delivery experience"
              placeholderTextColor="#94A3B8"
              style={styles.ratingInput}
            />
            <View style={styles.actionsRow}>
              <PrimaryButton label="Maybe later" variant="secondary" style={styles.actionButton} onPress={handleCloseRatingPanel} />
              <PrimaryButton
                label={ratingSubmitting ? 'Saving...' : orderHasRating ? 'Update rating' : 'Submit rating'}
                icon="star-outline"
                style={styles.actionButton}
                onPress={() => {
                  void handleSubmitRating();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={showPlacedSheet} onRequestClose={dismissPlacedSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={dismissPlacedSheet} />
          <View style={styles.placedModalCard}>
            <View style={styles.placedIconWrap}>
              <MaterialCommunityIcons name="check" size={28} color="#166534" />
            </View>
            <Text style={styles.placedTitle}>{copy.track.orderPlaced}</Text>
            {order?.orderNumber ? <Text style={styles.placedOrderNumber}>{order.orderNumber}</Text> : null}
            <Text style={styles.placedBody}>
              {order && isBusCustomerParcel(order)
                ? language === 'sw'
                  ? 'Tunatafuta basi linaloenda huko. Hatua zitaonekana hapa.'
                  : 'We are matching a bus for this route. Progress will show here.'
                : copy.track.lookingDriver}
            </Text>
            <PrimaryButton label={copy.common.gotIt} onPress={dismissPlacedSheet} />
          </View>
        </View>
      </Modal>

      <OutsideParcelReceiptModal
        visible={showReceipt && Boolean(order)}
        order={order}
        originCity={order?.outsideOriginCity}
        onContinue={() => setShowReceipt(false)}
        onDismiss={() => setShowReceipt(false)}
      />
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  pageBar: {
    height: 28,
    backgroundColor: '#FFE500',
    marginHorizontal: -20,
  },
  statusBlock: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    maxWidth: '100%',
  },
  statusPointer: {
    marginTop: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#111827',
  },
  solidButton: {
    minHeight: 56,
    marginTop: 8,
    borderRadius: 18,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solidButtonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dangerButton: {
    minHeight: 56,
    marginTop: 8,
    borderRadius: 18,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  quietState: {
    paddingTop: 12,
  },
  statusLine: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: -0.4,
  },
  barTrack: {
    marginTop: 14,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFE500',
  },
  driverRow: {
    marginTop: 22,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverCopy: {
    flex: 1,
    gap: 2,
  },
  driverName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: '#111827',
  },
  driverMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
  },
  callButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopRow: {
    marginTop: 16,
    gap: 2,
  },
  stopLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  stopValue: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: '#111827',
  },
  fareRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 12,
  },
  iconAction: {
    flex: 1,
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubbleYellow: {
    backgroundColor: '#FFE500',
  },
  iconActionLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: '#111827',
  },
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  textActionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#111827',
  },
  cancelQuiet: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#6B7280',
  },
  codeInput: {
    minHeight: 56,
    marginTop: 8,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#111827',
  },
  codeButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  codeButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  codeError: {
    fontSize: 13,
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  emptyText: {
    maxWidth: 420,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.subtext,
  },
  statusCard: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: cargoTheme.colors.darkSurface,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 12,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    marginBottom: 8,
  },
  statusText: {
    color: '#D7E1EA',
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 10,
  },
  cardLine: {
    fontSize: 14,
    lineHeight: 21,
    color: cargoTheme.colors.text,
    marginBottom: 6,
  },
  cardMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  reviewHeaderCopy: {
    flex: 1,
  },
  reviewEditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  reviewEditChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  reviewStarsText: {
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginLeft: 2,
  },
  reviewBody: {
    fontSize: 14,
    lineHeight: 21,
    color: cargoTheme.colors.text,
    fontStyle: 'italic',
  },
  phoneCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  phoneCardMuted: {
    opacity: 0.72,
  },
  phoneLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
    marginBottom: 4,
  },
  phoneValue: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  phoneValueMuted: {
    color: cargoTheme.colors.subtext,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  actionButton: {
    flex: 1,
    minHeight: 60,
  },
  actionButtonDisabled: {
    opacity: 0.72,
  },
  cancelToggleButton: {
    alignSelf: 'stretch',
    minHeight: 64,
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 28,
    padding: 20,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    gap: 14,
  },
  ratingModalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 28,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
  },
  placedModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 8,
  },
  placedIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  placedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  placedOrderNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: cargoTheme.colors.subtext,
  },
  placedBody: {
    fontSize: 14,
    lineHeight: 21,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  placedNotify: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingStarsPickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ratingStarButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingStarButtonActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7',
  },
  ratingInput: {
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: cargoTheme.colors.text,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  reasonList: {
    gap: 10,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FDBA74',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  reasonOptionSelected: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRadioSelected: {
    borderColor: '#DC2626',
  },
  reasonRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  reasonLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: cargoTheme.colors.text,
  },
  reasonLabelSelected: {
    color: '#991B1B',
    fontWeight: '700',
  },
  cancelPrimaryButton: {
    flex: 1,
    minHeight: 60,
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
});
