import { FirebaseError } from 'firebase/app';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, cargoVehicles, type FlowType, type ParcelScope } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { recordAppActivity } from '@/lib/app-analytics';
import { getFirebaseDataErrorMessage } from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { createDeliveryOrder } from '@/lib/delivery-data';
import { isNotifiableRecipientPhone } from '@/lib/recipient-notify';
import { useAuthSession } from '@/providers/auth-provider';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/ErrorBoundary';

const screenScope = 'OrderReviewScreen';

function parseCoordinate(value?: string | string[]) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized?.trim()) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTextParam(value?: string | string[]) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized?.trim() || undefined;
}

function buildOrderReviewReturnTo(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized !== undefined) {
      query.set(key, normalized);
    }
  });

  const queryString = query.toString();
  return queryString ? `/order-review?${queryString}` : '/order-review';
}

const cargoVehicleKeyAliases: Record<string, string> = {
  bodaboda: 'bodaboda',
  boda: 'bodaboda',
  pikipiki: 'bodaboda',
  motorcycle: 'bodaboda',
  motorbike: 'bodaboda',
  bike: 'bodaboda',
  bajaj: 'toyo',
  bajaji: 'toyo',
  toyo: 'toyo',
  kirikuu: 'kirikuu',
  cargo: 'toyo',
  pickup: 'toyo',
  van: 'toyo',
  truck: 'toyo',
  toyo_xl: 'toyo',
  'toyo-xl': 'toyo',
};

function resolveCargoVehicle(vehicleParam?: string | string[]) {
  const rawVehicleKey = parseTextParam(vehicleParam)?.toLowerCase();
  const normalizedVehicleKey = rawVehicleKey ? cargoVehicleKeyAliases[rawVehicleKey] ?? rawVehicleKey : undefined;
  const defaultCargoVehicle = cargoVehicles.find((item) => item.key === 'toyo') ?? cargoVehicles[0];
  return cargoVehicles.find((item) => item.key === normalizedVehicleKey) ?? defaultCargoVehicle;
}

function OrderReviewScreenContent() {
  const router = useRouter();
  const { authError, profile, user } = useAuthSession();
  const params = useLocalSearchParams<{
    flow?: string;
    scope?: string;
    parcelType?: string;
    parcelLabel?: string;
    price?: string;
    eta?: string;
    pricingRoute?: string;
    vehicle?: string;
    timing?: string;
    pickup?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoff?: string;
    dropoffLat?: string;
    dropoffLng?: string;
    driverDropoff?: string;
    driverDropoffLat?: string;
    driverDropoffLng?: string;
    outsideDestination?: string;
    outsideDestinationCity?: string;
    outsideDestinationStand?: string;
    outsideDestinationLat?: string;
    outsideDestinationLng?: string;
    recipientName?: string;
    recipientPhone?: string;
    parcelWeightKg?: string;
    scheduleDate?: string;
    scheduleTime?: string;
    distance?: string;
    duration?: string;
    distanceMeters?: string;
    durationSeconds?: string;
    cargoSize?: string;
    notifyRecipient?: string;
  }>();
  const copy = useAppCopy();
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [error, setError] = useState('');
  const reviewReturnTo = useMemo(() => buildOrderReviewReturnTo(params), [params]);

  const flow: FlowType = params.flow === 'cargo' ? 'cargo' : 'parcel';
  const scope: ParcelScope = params.scope === 'outside' ? 'outside' : 'city';
  const isOutsideParcel = flow === 'parcel' && scope === 'outside';
  const vehicle = resolveCargoVehicle(params.vehicle);

  const timing =
    params.timing === 'later'
      ? `Scheduled${params.scheduleDate || params.scheduleTime ? ` • ${[params.scheduleDate, params.scheduleTime].filter(Boolean).join(' at ')}` : ''}`
      : 'Dispatch now';

  const serviceLabel =
    flow === 'cargo' ? vehicle.title : scope === 'city' ? 'In-city parcel delivery' : 'Other regions parcel delivery';
  const estimatedFare =
    flow === 'cargo' ? params.price ?? vehicle.price : params.price ?? (scope === 'city' ? 'TZS 6,500' : 'TZS 12,500');
  const eta = flow === 'cargo' ? params.duration ?? vehicle.eta : params.eta ?? (scope === 'city' ? '15-30 min' : '3-5 hrs');
  const estimatedTotal =
    flow === 'cargo'
      ? estimatedFare
      : estimatedFare;
  const pickupValue = params.pickup ?? (flow === 'cargo' ? 'Mlimani City loading bay' : 'Posta Mpya, Azikiwe Street');
  const dropoffValue =
    params.dropoff ??
    (flow === 'cargo' ? 'Kariakoo wholesale district' : scope === 'city' ? 'Masaki, Haile Selassie Road' : 'Morogoro town center');
  const parcelTypeLabel = params.parcelLabel ?? 'Parcel order';
  const cargoSizeLabel = params.cargoSize?.trim() || '';
  const pricingRoute = params.pricingRoute;
  const pickupLatitude = useMemo(() => parseCoordinate(params.pickupLat), [params.pickupLat]);
  const pickupLongitude = useMemo(() => parseCoordinate(params.pickupLng), [params.pickupLng]);
  const dropoffLatitude = useMemo(() => parseCoordinate(params.dropoffLat), [params.dropoffLat]);
  const dropoffLongitude = useMemo(() => parseCoordinate(params.dropoffLng), [params.dropoffLng]);
  const driverDropoffLatitude = useMemo(
    () => parseCoordinate(params.driverDropoffLat) ?? (isOutsideParcel ? doordropAdminHandoffLocation.latitude : undefined),
    [isOutsideParcel, params.driverDropoffLat]
  );
  const driverDropoffLongitude = useMemo(
    () => parseCoordinate(params.driverDropoffLng) ?? (isOutsideParcel ? doordropAdminHandoffLocation.longitude : undefined),
    [isOutsideParcel, params.driverDropoffLng]
  );
  const outsideDestinationLatitude = useMemo(() => parseCoordinate(params.outsideDestinationLat), [params.outsideDestinationLat]);
  const outsideDestinationLongitude = useMemo(() => parseCoordinate(params.outsideDestinationLng), [params.outsideDestinationLng]);
  const distanceMeters = useMemo(() => parseCoordinate(params.distanceMeters), [params.distanceMeters]);
  const durationSeconds = useMemo(() => parseCoordinate(params.durationSeconds), [params.durationSeconds]);
  const customerName = profile?.fullName?.trim() || user?.displayName?.trim() || 'DoorDrop Customer';
  const customerPhone = profile?.phoneNumber?.trim() || '';
  const customerEmail = user?.email?.trim().toLowerCase() || '';

  const handleCreateOrder = async () => {
    if (!user || creatingOrder) {
      logWarning(screenScope, 'handleCreateOrder skipped', {
        hasUser: Boolean(user),
        creatingOrder,
      });
      return;
    }

    setCreatingOrder(true);
    setError('');
    void recordAppActivity({
      userId: user.uid,
      userName: customerName,
      userRole: 'customer',
      eventName: 'order_create_started',
      featureKey: 'order_checkout',
      featureLabel: 'Order checkout',
      screen: 'order_review',
      route: '/order-review',
      metadata: {
        flow,
        serviceLabel,
        vehicleType: flow === 'cargo' ? vehicle.key : 'bodaboda',
        vehicleLabel: flow === 'cargo' ? vehicle.title : 'Bodaboda / Motorcycle',
        parcelScope: flow === 'parcel' ? scope : undefined,
        timingMode: params.timing === 'later' ? 'later' : 'now',
        distanceMeters,
        durationSeconds,
        estimatedFare,
      },
    });
    logAsyncStart(screenScope, 'createDeliveryOrder', {
      flow,
      serviceLabel,
      userId: user.uid,
    });

    try {
      const order = await createDeliveryOrder({
        userId: user.uid,
        customerName,
        customerEmail,
        customerPhone,
        flow,
        serviceLabel,
        pickupLabel: pickupValue,
        dropoffLabel: dropoffValue,
        pickupLatitude,
        pickupLongitude,
        dropoffLatitude,
        dropoffLongitude,
        etaLabel: eta,
        fareLabel: estimatedFare,
        totalLabel: estimatedTotal,
        routeLabel: pricingRoute ?? `${pickupValue} to ${dropoffValue}`,
        timingMode: params.timing === 'later' ? 'later' : 'now',
        scheduleDate: params.scheduleDate,
        scheduleTime: params.scheduleTime,
        scheduleLabel: timing,
        recipientName: params.recipientName?.trim() || 'Recipient not provided',
        recipientPhone: params.recipientPhone?.trim() || 'Not provided',
        parcelScope: flow === 'parcel' ? scope : undefined,
        parcelTypeKey: flow === 'parcel' ? params.parcelType : undefined,
        parcelTypeLabel: flow === 'parcel' ? parcelTypeLabel : undefined,
        cargoVehicleKey: flow === 'cargo' ? vehicle.key : 'bodaboda',
        cargoVehicleLabel: flow === 'cargo' ? vehicle.title : 'Bodaboda / Motorcycle',
        cargoCapacityLabel: flow === 'cargo' ? vehicle.capacity : 'Bodaboda parcel dispatch',
        cargoSizeLabel: flow === 'cargo' ? cargoSizeLabel : undefined,
        driverDropoffLabel: isOutsideParcel ? params.driverDropoff?.trim() || doordropAdminHandoffLocation.label : undefined,
        driverDropoffLatitude: isOutsideParcel ? driverDropoffLatitude : undefined,
        driverDropoffLongitude: isOutsideParcel ? driverDropoffLongitude : undefined,
        outsideDestinationLabel: isOutsideParcel ? params.outsideDestination?.trim() || dropoffValue : undefined,
        outsideDestinationCity: isOutsideParcel ? params.outsideDestinationCity?.trim() || undefined : undefined,
        outsideDestinationStand: isOutsideParcel ? params.outsideDestinationStand?.trim() || undefined : undefined,
        outsideDestinationLatitude: isOutsideParcel ? outsideDestinationLatitude : undefined,
        outsideDestinationLongitude: isOutsideParcel ? outsideDestinationLongitude : undefined,
        outsideParcelWeightKg: isOutsideParcel ? params.parcelWeightKg?.trim() || undefined : undefined,
        distanceLabel: params.distance,
        durationLabel: params.duration,
        distanceMeters,
        durationSeconds,
      });

      logAsyncSuccess(screenScope, 'createDeliveryOrder', {
        flow,
        orderId: order.id,
        userId: user.uid,
      });
      void recordAppActivity({
        userId: user.uid,
        userName: customerName,
        userRole: 'customer',
        eventName: 'order_created',
        featureKey: 'order_checkout',
        featureLabel: 'Order checkout',
        screen: 'order_review',
        route: '/order-review',
        metadata: {
          flow,
          orderId: order.id,
          orderNumber: order.orderNumber,
          serviceLabel,
          vehicleType: flow === 'cargo' ? vehicle.key : 'bodaboda',
          vehicleLabel: flow === 'cargo' ? vehicle.title : 'Bodaboda / Motorcycle',
          parcelScope: flow === 'parcel' ? scope : undefined,
          timingMode: params.timing === 'later' ? 'later' : 'now',
          distanceMeters,
          durationSeconds,
          estimatedFare,
        },
      });

      const recipientPhone = params.recipientPhone?.trim() || '';
      const shouldNotifyRecipient =
        flow === 'parcel' && params.notifyRecipient !== '0' && isNotifiableRecipientPhone(recipientPhone);

      router.replace({
        pathname: '/track-order',
        params: {
          orderId: order.id,
          placed: '1',
          notifyRecipient: shouldNotifyRecipient ? '1' : '0',
        },
      });
    } catch (saveError) {
      logAsyncFailure(screenScope, 'createDeliveryOrder', saveError, {
        flow,
        userId: user.uid,
      });
      const message =
        saveError instanceof FirebaseError
          ? getFirebaseDataErrorMessage(saveError.code, 'We could not save this order yet. Please try again.')
          : saveError instanceof Error
            ? saveError.message
            : 'We could not save this order yet. Please try again.';
      setError(message);
      void recordAppActivity({
        userId: user.uid,
        userName: customerName,
        userRole: 'customer',
        eventName: 'order_create_failed',
        featureKey: 'order_checkout',
        featureLabel: 'Order checkout',
        screen: 'order_review',
        route: '/order-review',
        metadata: {
          flow,
          serviceLabel,
          vehicleType: flow === 'cargo' ? vehicle.key : 'bodaboda',
          parcelScope: flow === 'parcel' ? scope : undefined,
        },
      });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <CargoScreen
      contentContainerStyle={styles.content}
      backgroundColor="#FFFFFF"
      footer={
        <View style={styles.footer}>
          {user ? (
            <PrimaryButton
              label={creatingOrder ? copy.confirm.creating : `${copy.confirm.confirm} · ${estimatedFare}`}
              onPress={handleCreateOrder}
              style={creatingOrder ? styles.buttonDisabled : undefined}
            />
          ) : (
            <View style={styles.authFooterActions}>
              <PrimaryButton
                label={copy.confirm.loginToComplete}
                onPress={() => router.push({ pathname: '/login', params: { returnTo: reviewReturnTo } })}
              />
              <PrimaryButton
                label={copy.common.register}
                variant="secondary"
                onPress={() => router.push({ pathname: '/register', params: { returnTo: reviewReturnTo } })}
              />
            </View>
          )}
          {creatingOrder ? <ActivityIndicator style={styles.loadingIndicator} color={cargoTheme.colors.primary} /> : null}
          {error || authError ? <Text style={styles.errorText}>{error || authError}</Text> : null}
        </View>
      }>
      <CargoHeader title={copy.confirm.title} onLeftPress={() => router.back()} />

      <View style={styles.routeCard}>
        <View style={styles.routeTimeline}>
          <View style={styles.routeSpineCol}>
            <View style={styles.pickupDot} />
            <View style={styles.routeSpine} />
            <View style={styles.dropoffDot} />
          </View>
          <View style={styles.routeStops}>
            <View style={styles.routeStop}>
              <Text style={styles.routeLabel}>{copy.common.from}</Text>
              <Text style={styles.routeValue}>{pickupValue}</Text>
            </View>
            <View style={styles.routeStop}>
              <Text style={styles.routeLabel}>{copy.common.to}</Text>
              <Text style={styles.routeValue}>{dropoffValue}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryLine}>
          <Text style={styles.summaryLabel}>{copy.confirm.service}</Text>
          <Text style={styles.summaryValue}>
            {flow === 'cargo'
              ? [vehicle.title, cargoSizeLabel].filter(Boolean).join(' · ')
              : [serviceLabel, parcelTypeLabel !== 'Parcel order' ? parcelTypeLabel : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={styles.summaryLine}>
          <Text style={styles.summaryLabel}>{copy.confirm.payment}</Text>
          <Text style={styles.summaryValue}>{copy.confirm.cash}</Text>
        </View>
        {params.timing === 'later' ? (
          <View style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>{copy.confirm.when}</Text>
            <Text style={styles.summaryValue}>{timing}</Text>
          </View>
        ) : null}
        <View style={[styles.summaryLine, styles.summaryLineLast]}>
          <Text style={styles.summaryLabel}>{copy.confirm.fare}</Text>
          <Text style={styles.fareValue}>{estimatedFare}</Text>
        </View>
      </View>

      {!user ? (
        <Text style={styles.authHint}>{copy.confirm.authHint}</Text>
      ) : null}
    </CargoScreen>
  );
}

export default function OrderReviewScreen() {
  return (
    <AuthSessionBoundary>
      <OrderReviewScreenContent />
    </AuthSessionBoundary>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 20,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: cargoTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#EAF0F6',
  },
  buttonDisabled: {
    opacity: 0.74,
  },
  loadingIndicator: {
    marginTop: 10,
  },
  authFooterActions: {
    gap: 10,
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: typography.bold,
    color: '#DC2626',
    textAlign: 'center',
  },
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 12,
  },
  routeTimeline: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  routeSpineCol: {
    width: 16,
    alignItems: 'center',
    marginRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  routeSpine: {
    flex: 1,
    width: 2,
    marginVertical: 6,
    borderRadius: 999,
    backgroundColor: '#86EFAC',
  },
  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: cargoTheme.colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dropoffDot: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: cargoTheme.colors.ink,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  routeStops: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
    gap: 22,
  },
  routeStop: {
    minHeight: 40,
  },
  routeLabel: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  routeValue: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryLineLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  summaryValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
  },
  fareValue: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
  },
  authHint: {
    marginTop: 16,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
});
