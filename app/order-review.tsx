import { FirebaseError } from 'firebase/app';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AuthSessionBoundary } from '@/components/auth/session-boundary';
import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { ParcelPackingInstructions } from '@/components/parcel-packing-instructions';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, cargoVehicles, type FlowType, type ParcelScope } from '@/constants/cargo-theme';
import { CITY_PARCELS_ENABLED } from '@/constants/parcel-features';
import { typography } from '@/constants/typography';
import { useAppCopy } from '@/lib/app-copy';
import { recordAppActivity } from '@/lib/app-analytics';
import { getFirebaseDataErrorMessage } from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { createDeliveryOrder } from '@/lib/delivery-data';
import { clearParcelPhotoDraft, getParcelPhotoDraft } from '@/lib/parcel-photo-draft';
import { uploadParcelCargoPhoto } from '@/lib/parcel-photo-upload';
import { readablePhone } from '@/lib/phone-link';
import { getUserProfile } from '@/lib/user-profile';
import { OUTSIDE_STANDARD_MAX_KG } from '@/lib/outside-parcel';
import { useAuthSession } from '@/providers/auth-provider';

export { ErrorBoundary } from '@/components/expo-router-error-boundary';

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

  Object.entries(params || {}).forEach(([key, value]) => {
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
  toyo_electric: 'toyo_electric',
  'toyo-electric': 'toyo_electric',
  toyoelectric: 'toyo_electric',
  toyo: 'toyo',
  kirikuu: 'kirikuu',
  cargo: 'toyo',
  pickup: 'toyo',
  van: 'toyo',
  truck: 'toyo',
  toyo_xl: 'toyo',
  'toyo-xl': 'toyo',
  canter: 'toyo',
  center: 'toyo',
  fuso: 'toyo',
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
    outsideShippingMode?: string;
    outsideHandoffMode?: string;
    recipientName?: string;
    recipientPhone?: string;
    parcelWeightKg?: string;
    declaredValueTzs?: string;
    contentsDeclarationAccepted?: string;
    scheduleDate?: string;
    scheduleTime?: string;
    distance?: string;
    duration?: string;
    distanceMeters?: string;
    durationSeconds?: string;
    cargoSize?: string;
    fareType?: string;
    customerOffer?: string;
    minFare?: string;
    distanceKm?: string;
    suggestedFare?: string;
    suggestedFareMin?: string;
    suggestedFareMax?: string;
    notifyRecipient?: string;
    outsideParcelSize?: string;
    parcelPhotoUri?: string;
    parcelPhotoUrl?: string;
    requestedDriverId?: string;
    requestedDriverName?: string;
    outsideExpressRouteId?: string;
    outsideExpressDepartureId?: string;
    outsideExpressDepartureAtMs?: string;
    outsideExpressDepartureLabel?: string;
    outsideExpressBookingCutoffAtMs?: string;
    outsideExpressAirportHandoffAtMs?: string;
    outsideExpressFirstMileDeadlineAtMs?: string;
    outsideExpressArrivalOffsetMinutes?: string;
  }>();
  const copy = useAppCopy();
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [error, setError] = useState('');
  const reviewReturnTo = useMemo(() => buildOrderReviewReturnTo(params), [params]);

  const flow: FlowType = params.flow === 'cargo' ? 'cargo' : 'parcel';
  const scope: ParcelScope = params.scope === 'outside' ? 'outside' : 'city';
  const isOutsideParcel = flow === 'parcel' && scope === 'outside';
  const cityParcelCheckoutBlocked = flow === 'parcel' && scope === 'city' && !CITY_PARCELS_ENABLED;
  const vehicle = resolveCargoVehicle(params.vehicle);

  const timing =
    params.timing === 'later'
      ? `Scheduled${params.scheduleDate || params.scheduleTime ? ` • ${[params.scheduleDate, params.scheduleTime].filter(Boolean).join(' at ')}` : ''}`
      : 'Dispatch now';

  const serviceLabel =
    flow === 'cargo' ? vehicle.title : scope === 'city' ? 'In-city parcel delivery' : 'Other regions parcel delivery';
  const customerOfferAmount = useMemo(() => {
    const fromParam = parseCoordinate(params.customerOffer);
    if (typeof fromParam === 'number' && fromParam > 0) {
      return fromParam;
    }
    const digits = String(params.price || '').replace(/[^\d]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [params.customerOffer, params.price]);
  const suggestedFareAmount = useMemo(() => parseCoordinate(params.suggestedFare), [params.suggestedFare]);
  const suggestedFareMin = useMemo(() => parseCoordinate(params.suggestedFareMin), [params.suggestedFareMin]);
  const suggestedFareMax = useMemo(() => parseCoordinate(params.suggestedFareMax), [params.suggestedFareMax]);
  const isNegotiatedCargo = flow === 'cargo' && (params.fareType === 'negotiated' || typeof customerOfferAmount === 'number');
  const estimatedFare =
    flow === 'cargo'
      ? params.price ?? (customerOfferAmount ? `TZS ${customerOfferAmount.toLocaleString('en-US')}` : vehicle.price)
      : params.price ?? (scope === 'city' ? 'TZS 6,500' : 'TZS 12,500');
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
  const customerPhone = profile?.phoneNumber?.trim() || user?.phoneNumber?.trim() || '';
  const customerEmail = user?.email?.trim().toLowerCase() || '';

  useEffect(() => {
    if (!cityParcelCheckoutBlocked) {
      return;
    }
    router.replace('/send-parcel');
  }, [cityParcelCheckoutBlocked, router]);

  const handleCreateOrder = async () => {
    if (cityParcelCheckoutBlocked) {
      router.replace('/send-parcel');
      return;
    }
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
        fareType: isNegotiatedCargo ? 'negotiated' : undefined,
        customerOffer: customerOfferAmount,
      },
    });
    logAsyncStart(screenScope, 'createDeliveryOrder', {
      flow,
      serviceLabel,
      userId: user.uid,
    });

    try {
      let senderPhone = readablePhone(customerPhone);
      if (!senderPhone) {
        try {
          const freshProfile = await getUserProfile(user.uid);
          senderPhone = readablePhone(freshProfile?.phoneNumber);
        } catch (profileError) {
          logWarning(screenScope, 'sender phone lookup skipped', {
            userId: user.uid,
            error: profileError instanceof Error ? profileError.message : String(profileError),
          });
        }
      }
      let parcelPhotoUrls: string[] | undefined;
      if (isOutsideParcel) {
        const draft = getParcelPhotoDraft();
        const existingUrl = String(params.parcelPhotoUrl || draft?.downloadURL || '').trim();
        const localUri = String(draft?.localUri || params.parcelPhotoUri || '').trim();
        if (existingUrl.startsWith('http')) {
          parcelPhotoUrls = [existingUrl];
        } else if (localUri) {
          const uploaded = await uploadParcelCargoPhoto({
            userId: user.uid,
            localUri,
            orderKey: `outside-${Date.now()}`,
          });
          parcelPhotoUrls = [uploaded.downloadURL];
        } else {
          throw new Error('Weka picha ya mzigo kabla ya kutuma ombi.');
        }
        clearParcelPhotoDraft();
      }
      const order = await createDeliveryOrder({
        userId: user.uid,
        customerName,
        customerEmail,
        customerPhone: senderPhone || customerPhone,
        flow,
        serviceLabel,
        pickupLabel: pickupValue,
        dropoffLabel: dropoffValue,
        pickupLatitude,
        pickupLongitude,
        dropoffLatitude,
        dropoffLongitude,
        etaLabel: eta,
        fareLabel: isOutsideParcel && params.outsideShippingMode !== 'express' ? 'Bei baada ya kampuni' : estimatedFare,
        totalLabel: isOutsideParcel && params.outsideShippingMode !== 'express' ? 'Bei baada ya kampuni' : estimatedTotal,
        quoteStatus: isOutsideParcel && params.outsideShippingMode !== 'express' ? 'awaiting_company' : undefined,
        outsideParcelSize: isOutsideParcel ? params.outsideParcelSize?.trim() || undefined : undefined,
        parcelPhotoUrls,
        routeLabel:
          pricingRoute && !/local delivery/i.test(pricingRoute)
            ? pricingRoute
            : `${pickupValue} → ${dropoffValue}`,
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
        declaredValueTzs: params.declaredValueTzs?.trim() || undefined,
        contentsDeclarationAccepted: params.contentsDeclarationAccepted === '1',
        outsideShippingMode: isOutsideParcel ? params.outsideShippingMode?.trim() || undefined : undefined,
        outsideHandoffMode: isOutsideParcel ? params.outsideHandoffMode?.trim() || undefined : undefined,
        distanceLabel: params.distance,
        durationLabel: params.duration,
        distanceMeters,
        durationSeconds,
        fareType: isNegotiatedCargo ? 'negotiated' : undefined,
        customerOffer: isNegotiatedCargo ? customerOfferAmount : undefined,
        minFare: isNegotiatedCargo ? parseCoordinate(params.minFare) : undefined,
        distanceKm: isNegotiatedCargo ? parseCoordinate(params.distanceKm) : undefined,
        lastOfferBy: isNegotiatedCargo ? 'customer' : undefined,
        negotiationStatus: isNegotiatedCargo ? 'confirmed' : undefined,
        suggestedFare: isNegotiatedCargo ? suggestedFareAmount : undefined,
        suggestedFareMin: isNegotiatedCargo ? suggestedFareMin : undefined,
        suggestedFareMax: isNegotiatedCargo ? suggestedFareMax : undefined,
        requestedDriverId: parseTextParam(params.requestedDriverId),
        requestedDriverName: parseTextParam(params.requestedDriverName),
        outsideExpressRouteId: parseTextParam(params.outsideExpressRouteId),
        outsideExpressDepartureId: parseTextParam(params.outsideExpressDepartureId),
        outsideExpressDepartureAtMs: parseCoordinate(params.outsideExpressDepartureAtMs),
        outsideExpressDepartureLabel: parseTextParam(params.outsideExpressDepartureLabel),
        outsideExpressBookingCutoffAtMs: parseCoordinate(params.outsideExpressBookingCutoffAtMs),
        outsideExpressAirportHandoffAtMs: parseCoordinate(params.outsideExpressAirportHandoffAtMs),
        outsideExpressFirstMileDeadlineAtMs: parseCoordinate(params.outsideExpressFirstMileDeadlineAtMs),
        outsideExpressArrivalOffsetMinutes: parseCoordinate(params.outsideExpressArrivalOffsetMinutes),
        carrierDispatch: isOutsideParcel ? 'instant' : undefined,
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
        params:
          flow === 'parcel'
            ? {
                orderId: order.id,
                placed: '1',
                instantCarrier: isOutsideParcel ? '1' : '',
              }
            : {
                orderId: order.id,
                placed: '1',
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

  if (cityParcelCheckoutBlocked) {
    return null;
  }

  if (flow === 'parcel') {
    const outsideSize = String(params.outsideParcelSize || '');
    const showPacking = scope !== 'outside' || outsideSize === 'ndogo' || outsideSize === 'wastani';
    const weightLimitKg =
      outsideSize === 'ndogo' ? 5 : outsideSize === 'wastani' ? 20 : scope === 'outside' ? OUTSIDE_STANDARD_MAX_KG : 15;

    if (!showPacking) {
      return (
        <CargoScreen
          contentContainerStyle={styles.content}
          backgroundColor="#FFFFFF"
          footer={
            <View style={styles.footer}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <PrimaryButton
                label={creatingOrder ? copy.confirm.creating : 'Tuma ombi'}
                onPress={() => {
                  if (!user) {
                    router.push({ pathname: '/login', params: { returnTo: reviewReturnTo } });
                    return;
                  }
                  void handleCreateOrder();
                }}
                style={creatingOrder ? styles.buttonDisabled : undefined}
              />
            </View>
          }>
          <CargoHeader title="Ombi la mzigo" subtitle="Bei itatumwa na kampuni baada ya kuona picha." />
        </CargoScreen>
      );
    }

    return (
      <>
        <ParcelPackingInstructions
          weightLimitKg={weightLimitKg}
          strict={scope === 'outside'}
          busy={creatingOrder}
          error={error || authError || ''}
          onClose={() => router.back()}
          onConfirm={() => {
            if (!user) {
              router.push({ pathname: '/login', params: { returnTo: reviewReturnTo } });
              return;
            }
            void handleCreateOrder();
          }}
        />
      </>
    );
  }

  return (
    <CargoScreen
      contentContainerStyle={styles.content}
      backgroundColor="#FFFFFF"
      footer={
        <View style={styles.footer}>
          {user ? (
            <PrimaryButton
              label={
                creatingOrder
                  ? copy.confirm.creating
                  : flow === 'cargo'
                    ? copy.cargo.findOffers
                    : `${copy.confirm.confirm} · ${estimatedFare}`
              }
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
        {params.outsideExpressDepartureLabel ? (
          <View style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>Flight</Text>
            <Text style={styles.summaryValue}>{params.outsideExpressDepartureLabel}</Text>
          </View>
        ) : null}
        {params.timing === 'later' ? (
          <View style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>{copy.confirm.when}</Text>
            <Text style={styles.summaryValue}>{timing}</Text>
          </View>
        ) : null}
        {params.declaredValueTzs ? (
          <View style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>{copy.parcel.declaredValue}</Text>
            <Text style={styles.summaryValue}>
              TZS {String(params.declaredValueTzs).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            </Text>
          </View>
        ) : null}
        <View style={[styles.summaryLine, styles.summaryLineLast]}>
          <Text style={styles.summaryLabel}>{flow === 'cargo' ? copy.cargo.offerAmount : copy.confirm.fare}</Text>
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
