import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FirebaseError } from 'firebase/app';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton, SummaryRow } from '@/components/cargo-ui';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, cargoVehicles, type FlowType, type ParcelScope } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { recordAppActivity } from '@/lib/app-analytics';
import { getFirebaseDataErrorMessage } from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { createDeliveryOrder } from '@/lib/delivery-data';
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
  }>();
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
    flow === 'cargo' ? vehicle.title : scope === 'city' ? 'In-city parcel delivery' : 'Outside-city parcel delivery';
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
      router.replace({
        pathname: '/track-order',
        params: {
          orderId: order.id,
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
      footer={
        <View style={styles.footer}>
          {user ? (
            <PrimaryButton
              label={creatingOrder ? 'Creating order...' : 'Create order'}
              icon="check-circle-outline"
              onPress={handleCreateOrder}
              style={creatingOrder ? styles.buttonDisabled : undefined}
            />
          ) : (
            <View style={styles.authFooterActions}>
              <PrimaryButton
                label="Login to complete"
                onPress={() => router.push({ pathname: '/login', params: { returnTo: reviewReturnTo } })}
              />
              <PrimaryButton
                label="Register"
                variant="secondary"
                onPress={() => router.push({ pathname: '/register', params: { returnTo: reviewReturnTo } })}
              />
            </View>
          )}
          {creatingOrder ? <ActivityIndicator style={styles.loadingIndicator} color={cargoTheme.colors.primary} /> : null}
          {error || authError ? <Text style={styles.errorText}>{error || authError}</Text> : null}
        </View>
      }>
      <CargoHeader
        title="Review order"
        subtitle="Confirm payment before sending this request to dispatch."
        onLeftPress={() => router.back()}
        rightIcon="menu"
        onRightPress={() => router.push('/menu')}
      />

      <View style={styles.highlightCard}>
        <View style={styles.highlightBadge}>
          <MaterialCommunityIcons
            name={flow === 'cargo' ? 'truck-fast-outline' : 'package-variant-closed'}
            size={16}
            color="#FFFFFF"
          />
          <Text style={styles.highlightBadgeText}>{flow === 'cargo' ? 'Cargo request' : 'Parcel request'}</Text>
        </View>
        <Text style={styles.highlightTitle}>{serviceLabel}</Text>
        <Text style={styles.highlightText}>
          Once you create the order it is sent into DoorDrop dispatch, where our team can assign the best driver in real time.
        </Text>
      </View>

      {!user ? (
        <View style={styles.authGateCard}>
          <View style={styles.authGateBadge}>
            <MaterialCommunityIcons name="account-lock-outline" size={16} color="#FFFFFF" />
            <Text style={styles.authGateBadgeText}>Final step</Text>
          </View>
          <Text style={styles.authGateTitle}>Login to complete this order</Text>
          <Text style={styles.authGateText}>
            If you already have a DoorDrop account, login with your email and password. If you do not have one yet, register first using your full name, phone number, email and password.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payment</Text>
        <SummaryRow label="Method" value="Cash on delivery" />
        <SummaryRow label="Service fare" value={estimatedFare} />
        <SummaryRow label="Estimated total" value={estimatedTotal} emphasis />
      </View>

      <View style={styles.noticeCard}>
        <MaterialCommunityIcons name="shield-check-outline" size={20} color={cargoTheme.colors.primaryDark} />
        <Text style={styles.noticeText}>
          After the order is created, DoorDrop dispatch receives it instantly and can assign a driver without calling you back.
        </Text>
      </View>
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
  highlightCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 28,
    padding: 18,
    marginBottom: 22,
  },
  highlightBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 12,
  },
  highlightBadgeText: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
  highlightTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  highlightText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#D7E1EA',
  },
  card: {
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 14,
  },
  authGateCard: {
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
  },
  authGateBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 12,
  },
  authGateBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: typography.bold,
  },
  authGateTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: typography.extrabold,
    marginBottom: 8,
  },
  authGateText: {
    color: '#D7E1EA',
    fontSize: 13,
    lineHeight: 20,
  },
  noticeCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    padding: 16,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
  },
});
