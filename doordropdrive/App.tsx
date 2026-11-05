import ErrorBoundary from './components/ErrorBoundary';
import { DailyCommissionLock } from './components/daily-commission-lock';
import { PilotIntro } from './components/pilot-intro';
import {
  DriveAccountHero,
  DriveAuthPanel,
  DriveBrandMark,
  DriveBottomSheet,
  DriveCancelReasonSheet,
  DriveGhostButton,
  DriveHomeMapGradients,
  DriveIconWell,
  DriveMenuRow,
  DriveNearbyPin,
  DriveNotificationRow,
  DriveOrderCard,
  DrivePrimaryButton,
  DriveProEmptyState,
  DriveRouteStops,
  DriveScreenHeader,
  DriveSectionTitle,
  DriveStatRow,
  DriveStatusPill,
  DriveSurfaceCard,
  DriveSegmentedControl,
} from './components/drive-ui';
import { BoltBottomNavItem, BoltRewardsScreen, BoltRideRow } from './components/pilot-bolt-ui';
import {
  HOME_SHEET_PEEK,
  PilotEarningsPill,
  PilotGoOnlineButton,
  PilotMapChromeButton,
  PilotSwipeDashboard,
} from './components/pilot-home-sheet';
import { PilotHelpScreen, openSupportCall, openSupportWhatsApp } from './components/pilot-help-screen';
import { PilotMenuDrawer } from './components/pilot-menu-drawer';
import { PilotOrderCancelledModal } from './components/pilot-order-cancelled-modal';
import { DRIVE_DARK_MAP_STYLE } from './constants/drive-map-style';
import { pilotStanding, pilotTiersExplanation } from './constants/pilot-standing';
import { DriveAccessLockScreen } from './components/drive-access-lock-screen';
import { tryRequire } from './lib/safety';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { FirebaseError } from 'firebase/app';
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithCustomToken,
    signInWithEmailAndPassword,
    signOut,
    updateProfile,
    type User,
} from 'firebase/auth';
import {
    doc,
    increment,
    serverTimestamp,
    updateDoc,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StatusBar as AndroidStatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';

import { canonicalCargoVehicleKey, cargoOffersMatch, isCargoOfferIncoming } from './lib/cargo-order-agreement';
import { connectCargoOfferSocket } from './lib/cargo-offer-socket';
import { getFirebaseAuthErrorMessage, getFirebaseDataErrorMessage, getFirebasePasswordResetErrorMessage } from './lib/auth-errors';
import { recordDriverActivity } from './lib/driver-analytics';
import {
    formatDeliveryDateTime,
    getDeliveryOrderStatusLabel,
    acceptDriverOrder,
    declineDriverOrder,
    submitDriverFare,
    DEFAULT_FARE_NOTE,
    DRIVER_NEGOTIATION_CHANCES,
    recordDriverAppOpen,
    registerDriver,
    rateDeliveryCustomer,
    setDriverAvailability,
    subscribeToDeliveryOrder,
    subscribeToDriver,
    subscribeToDriverOrders,
    subscribeToOpenCargoOffers,
    updateDriverLocation,
    updateDriverOrderStatus,
    type DeliveryOrder,
    type DeliveryOrderStatus,
    type DriverRecord,
    type DriverVehicleType,
} from './lib/driver-data';
import {
    fetchDriverCommissionStatus,
    fetchDriverPaymentHistory,
    fetchDriverPaymentStatus,
    initiateDriverCommissionUssd,
    PaymentApiError,
    subscribeToDriverPayments,
    verifyDriverCommissionUssd,
    type DriverPaymentNetwork,
    type DriverPaymentNetworkKey,
    type DriverPaymentRecord,
    type DriverPaymentStatusResponse,
} from './lib/driver-payments';
import { summarizeDriverCommission } from './lib/driver-commission';
import { auth, db } from './lib/firebase';
import { getDriverCopy, type DriverCopy } from './lib/driver-copy';
import { loadDriverSettings, saveDriverSettings, type DriverLang, type DriverSettings } from './lib/driver-settings';
import { hasSeenPilotIntro, markPilotIntroSeen } from './lib/pilot-intro-storage';
import { sendOrderMessage, subscribeToOrderMessages, type OrderMessage } from './lib/order-messages';
import { fetchNearbyOnlineCustomers, subscribeToNearbyOnlineCustomers, type NearbyCustomer } from './lib/customer-presence';
import { buildDemandZones, estimateOrderProbabilityAtPoint, getTopDemandZone } from './lib/demand-zones';
import { fetchCustomerPhoneForOrder, resolveOrderContactPhone } from './lib/order-contact';
import { openPhoneDialer, readablePhone } from './lib/phone-link';
import { sendDirectCustomerMessage } from './lib/direct-messages';
import { startIncomingOrderAlert, stopIncomingOrderAlert, setIncomingAlertOnline } from './lib/order-alert';
import {
  listenForForegroundOrderPushes,
  listenForOrderNotificationTaps,
  registerDriverPushToken,
} from './lib/driver-push-notifications';
import { loginDriverWithOtp, sendDriverOtp, verifyDriverOtp } from './lib/driver-otp';
import { normalizePhoneNumber } from './lib/phone-auth';
import {
  buildAccessPlanState,
  formatAccessFeeLabel,
  getAccessBillingPeriodKey,
  getAccessPeriodStartMillis,
  getDriverAccessPlan,
  isDriverSubscriptionActive,
} from './lib/driver-access';
import { fetchRoadFollowingCoordinates, type MapPoint as RoadMapPoint } from './lib/road-route';
import { driveHapticSuccess } from './lib/drive-haptics';
import {
  buildMapRegion,
  DAR_ES_SALAAM_FALLBACK,
  ensureLocationServicesEnabled,
  getLocationWatchOptions,
  readDeviceLocation,
  requestDriveLocationPermissions,
  resolveDriverMapPoint,
  toMapPoint,
} from './lib/drive-location';
import { driveTheme, driveType } from './constants/drive-theme';
import { DriveSceneAvatar, type DriveAvatarKind } from './lib/drive-avatars';

type AuthMode = 'phone' | 'signin' | 'register' | 'forgot';
type DriverTab = 'home' | 'trip' | 'earn' | 'history' | 'notifications' | 'account';
type AccountView = 'overview' | 'payments';
type PaymentCheckoutStep = 'debt' | 'proof' | 'submitted';
type FeedbackTone = 'error' | 'info' | 'success';
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type DriverNotification = {
  id: string;
  title: string;
  message: string;
  icon: IconName;
  tone: 'success' | 'info' | 'warning';
  time: string;
  action?: 'trip' | 'chat' | 'payments' | 'account' | 'location';
  unread?: boolean;
};
type TripAction = {
  label: string;
  nextStatus: 'driver_at_pickup' | 'in_transit' | 'delivered';
  icon: IconName;
};
type PaymentStepTone = 'done' | 'active' | 'muted';
type RegisterFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  vehicleType: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor: string;
  plateNumber: string;
};
type ProfileSetupState = {
  fullName: string;
  phoneNumber: string;
  vehicleType: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor: string;
  plateNumber: string;
};

const ACTIVE_ORDER_STATUSES: DeliveryOrderStatus[] = ['driver_assigned', 'driver_at_pickup', 'in_transit'];
const vehicleTypeOptions: { key: 'toyo_electric' | 'toyo' | 'kirikuu' | 'canter'; label: string }[] = [
  { key: 'toyo_electric', label: 'Toyo Electric' },
  { key: 'toyo', label: 'TOYO' },
  { key: 'kirikuu', label: 'Kirikuu' },
  { key: 'canter', label: 'Canter' },
];
const pilotVehicleArt = {
  toyo_electric: require('./assets/images/cargo-avatar-toyo.png'),
  toyo: require('./assets/images/cargo-avatar-toyo.png'),
  kirikuu: require('./assets/images/cargo-avatar-kirikuu.png'),
  canter: require('./assets/images/cargo-avatar-canter.png'),
};
const tabs: { key: DriverTab; icon: IconName }[] = [
  { key: 'home', icon: 'home-outline' },
  { key: 'earn', icon: 'cash-multiple' },
  { key: 'history', icon: 'clock-outline' },
  { key: 'account', icon: 'help-circle-outline' },
];
const vehicleColorOptions: { label: string; swatch: string }[] = [
  { label: 'White', swatch: '#FFFFFF' },
  { label: 'Green', swatch: '#0F9D58' },
  { label: 'Black', swatch: '#111827' },
  { label: 'Silver', swatch: '#CBD5E1' },
  { label: 'Blue', swatch: '#2563EB' },
  { label: 'Red', swatch: '#DC2626' },
];
const paymentNetworkLogos = {
  mpesa: require('./assets/payments/mpesa.png'),
  mixx: require('./assets/payments/mixx.png'),
  airtel: require('./assets/payments/airtel.png'),
} as const;

function detectPaymentNetworkFromPhone(phone?: string | null): DriverPaymentNetworkKey | null {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('255') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  const prefix = local.slice(0, 2);
  if (['74', '75', '76'].includes(prefix)) {
    return 'mpesa';
  }
  if (['65', '67', '71', '77'].includes(prefix)) {
    return 'mixx';
  }
  if (['68', '69', '78'].includes(prefix)) {
    return 'airtel';
  }
  return null;
}

function paymentNetworkLabel(key?: string | null) {
  const network = String(key || '').toLowerCase();
  if (network === 'mixx') {
    return 'Mixx by Yas';
  }
  if (network === 'airtel' || network === 'airtelmoney') {
    return 'Airtel Money';
  }
  return 'M-Pesa';
}

function paymentNetworkLogo(key?: string | null) {
  const network = String(key || '').toLowerCase();
  if (network === 'mixx') {
    return paymentNetworkLogos.mixx;
  }
  if (network === 'airtel' || network === 'airtelmoney') {
    return paymentNetworkLogos.airtel;
  }
  return paymentNetworkLogos.mpesa;
}

const defaultPaymentNetworks: DriverPaymentNetwork[] = [
  {
    key: 'mpesa',
    label: 'M-Pesa',
    provider: 'Vodacom',
    color: '#EE1C25',
    enabled: true,
    comingSoon: false,
  },
  {
    key: 'mixx',
    label: 'Mixx by Yas',
    provider: 'Tigo / Yas',
    color: '#00338D',
    enabled: true,
    comingSoon: false,
  },
  {
    key: 'airtel',
    label: 'Airtel Money',
    provider: 'Airtel',
    color: '#ED1C24',
    enabled: true,
    comingSoon: false,
  },
];
const dayMs = 24 * 60 * 60 * 1000;
const tanzaniaUtcOffsetMs = 3 * 60 * 60 * 1000;

// Public hosted Terms & Privacy pages on DoorDrop Firebase Hosting.
const TERMS_URL = 'https://efootball-app-9d175.web.app/terms/';
const PRIVACY_URL = 'https://efootball-app-9d175.web.app/privacy';
const DOORDRIVE_TERMS_VERSION = 'doordrive-driver-terms-2026-06-04';

function getInitialRegisterForm(): RegisterFormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
    vehicleType: 'toyo',
    vehicleLabel: 'TOYO',
    vehicleColor: 'White',
    plateNumber: '',
  };
}

function getInitialProfileSetup(user?: User | null): ProfileSetupState {
  return {
    fullName: user?.displayName?.trim() || '',
    phoneNumber: '',
    vehicleType: 'toyo',
    vehicleLabel: 'TOYO',
    vehicleColor: '',
    plateNumber: '',
  };
}

function getRegisterFullName(form: RegisterFormState) {
  return [form.firstName, form.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function getRegisterVehicleLabel(form: RegisterFormState) {
  return form.vehicleLabel.trim() || getVehicleTypeLabel(form.vehicleType);
}

function toPilotVehicleType(vehicleType?: string): DriverVehicleType {
  const normalized = String(vehicleType || '').trim().toLowerCase();
  if (
    normalized === 'toyo_electric' ||
    normalized === 'toyo-electric' ||
    normalized === 'toyoelectric' ||
    normalized === 'electric_toyo'
  ) {
    return 'toyo_electric';
  }
  if (normalized === 'kirikuu') {
    return 'kirikuu';
  }
  if (normalized === 'canter' || normalized === 'center' || normalized === 'fuso') {
    return 'canter';
  }
  if (
    normalized === 'toyo' ||
    normalized === 'bajaj' ||
    normalized === 'bajaji' ||
    normalized === 'pickup' ||
    normalized === 'van' ||
    normalized === 'toyo_xl' ||
    normalized === 'toyo-xl'
  ) {
    return 'toyo';
  }
  return 'toyo';
}

function getVehicleTypeLabel(vehicleType?: string) {
  const labels: Record<string, string> = {
    kirikuu: 'Kirikuu',
    toyo_electric: 'Toyo Electric',
    toyo: 'TOYO',
    toyo_xl: 'TOYO',
    pickup: 'TOYO',
    van: 'TOYO',
    bajaj: 'TOYO',
    bajaji: 'TOYO',
    canter: 'Canter',
    center: 'Canter',
    fuso: 'Canter',
  };

  return labels[toPilotVehicleType(vehicleType)] || 'TOYO';
}

function isPlaceholderDriverName(name?: string | null) {
  const trimmed = String(name || '').trim();
  return !trimmed || trimmed.toLowerCase() === 'doordrop driver';
}

function isCanonicalPilotVehicle(vehicleType?: string | null) {
  const key = String(vehicleType || '').trim().toLowerCase();
  return key === 'toyo_electric' || key === 'toyo' || key === 'kirikuu' || key === 'canter';
}

function isCompleteDriverProfile(driver?: DriverRecord | null) {
  return Boolean(
    driver &&
      !isPlaceholderDriverName(driver.fullName) &&
      driver.phoneNumber?.trim() &&
      (driver.vehicleType || driver.vehicleLabel?.trim()) &&
      driver.plateNumber?.trim()
  );
}

function isActiveOrderStatus(status?: DeliveryOrderStatus) {
  return !!status && ACTIVE_ORDER_STATUSES.includes(status);
}

function isIncomingOffer(order?: DeliveryOrder | null) {
  return isCargoOfferIncoming(order);
}

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Instant cargo offers include the order on the socket. Show that card before Firestore catches up. */
function deliveryOrderFromCargoWsOffer(
  orderId: string,
  raw: Record<string, unknown> | undefined
): DeliveryOrder | null {
  if (!raw) {
    return null;
  }
  const id = String(raw.id || orderId || '').trim();
  if (!id) {
    return null;
  }
  const statusRaw = String(raw.status || 'driver_assigned');
  const status: DeliveryOrderStatus =
    statusRaw === 'pending_assignment' ||
    statusRaw === 'driver_assigned' ||
    statusRaw === 'driver_at_pickup' ||
    statusRaw === 'in_transit'
      ? statusRaw
      : 'driver_assigned';
  return {
    id,
    orderNumber: String(raw.orderNumber || id),
    userId: String(raw.userId || ''),
    customerName: String(raw.customerName || 'HAUL'),
    customerEmail: String(raw.customerEmail || ''),
    customerPhone: String(raw.customerPhone || ''),
    serviceLabel: String(raw.serviceLabel || raw.cargoVehicleLabel || 'Cargo'),
    status,
    pickupLabel: String(raw.pickupLabel || ''),
    dropoffLabel: String(raw.dropoffLabel || ''),
    pickupLatitude: numberOrUndefined(raw.pickupLatitude),
    pickupLongitude: numberOrUndefined(raw.pickupLongitude),
    dropoffLatitude: numberOrUndefined(raw.dropoffLatitude),
    dropoffLongitude: numberOrUndefined(raw.dropoffLongitude),
    etaLabel: String(raw.etaLabel || ''),
    fareLabel: String(raw.fareLabel || ''),
    totalLabel: String(raw.totalLabel || raw.fareLabel || ''),
    fareType: raw.fareType === 'algorithm' ? 'algorithm' : 'negotiated',
    customerOffer: numberOrUndefined(raw.customerOffer),
    minFare: numberOrUndefined(raw.minFare),
    negotiationStatus: String(raw.negotiationStatus || 'open'),
    cargoVehicleKey: String(raw.cargoVehicleKey || ''),
    cargoVehicleLabel: String(raw.cargoVehicleLabel || ''),
    flow: String(raw.flow || 'cargo'),
    scheduleLabel: String(raw.scheduleLabel || ''),
    recipientName: String(raw.recipientName || raw.customerName || ''),
    recipientPhone: String(raw.recipientPhone || raw.customerPhone || ''),
    driverId: String(raw.driverId || ''),
    assignmentMode: 'cargo_ws',
  };
}

function mergePendingCargoOffers(orders: DeliveryOrder[], pending: Map<string, DeliveryOrder>) {
  if (!pending.size) {
    return orders;
  }
  const seen = new Set(orders.map((order) => order.id));
  const extras: DeliveryOrder[] = [];
  for (const offer of pending.values()) {
    if (!seen.has(offer.id) && isActiveOrderStatus(offer.status)) {
      extras.push(offer);
    }
  }
  return extras.length ? [...extras, ...orders] : orders;
}

function getNextTripAction(status?: DeliveryOrderStatus): TripAction | null {
  switch (status) {
    case 'driver_assigned':
      return { label: 'Arrived at pickup', nextStatus: 'driver_at_pickup' as const, icon: 'map-marker-check-outline' };
    case 'driver_at_pickup':
      return { label: 'Start trip', nextStatus: 'in_transit' as const, icon: 'road-variant' };
    case 'in_transit':
      return { label: 'Mark delivered', nextStatus: 'delivered' as const, icon: 'check-circle-outline' };
    default:
      return null;
  }
}

function getDriverOrderStatusCopy(status: DeliveryOrderStatus | undefined, copy: DriverCopy) {
  switch (status) {
    case 'driver_assigned':
      return copy.newOrder;
    case 'driver_at_pickup':
      return copy.atPickup;
    case 'in_transit':
      return copy.onTrip;
    case 'delivered':
      return copy.deliveredStatus;
    case 'cancelled':
      return copy.cancelled;
    default:
      return copy.waitingOrder;
  }
}

function haversineDistanceKm(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number }
) {
  const earthRadiusKm = 6371;
  const dLat = ((end.latitude - start.latitude) * Math.PI) / 180;
  const dLng = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLat = (start.latitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceKm(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.max(0.1, Math.round(distanceKm * 10) / 10).toFixed(1)} km away`;
  }

  return `${distanceKm.toFixed(1)} km away`;
}

type MapPoint = { latitude: number; longitude: number };
type NavigationTarget = {
  kind: 'pickup' | 'dropoff';
  label: string;
  point: MapPoint | null;
};

const serviceCoordinateBounds = {
  minLatitude: -12.8,
  maxLatitude: 0.2,
  minLongitude: 28.5,
  maxLongitude: 41.5,
};

function parseMapCoordinate(value: unknown) {
  const coordinate = typeof value === 'number' ? value : Number(String(value ?? '').trim());

  return Number.isFinite(coordinate) ? coordinate : undefined;
}

function isValidLatitude(value: number) {
  return value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return value >= -180 && value <= 180;
}

function isLikelyServicePoint(point: MapPoint) {
  return (
    point.latitude >= serviceCoordinateBounds.minLatitude &&
    point.latitude <= serviceCoordinateBounds.maxLatitude &&
    point.longitude >= serviceCoordinateBounds.minLongitude &&
    point.longitude <= serviceCoordinateBounds.maxLongitude
  );
}

function getOrderPickupPoint(order: DeliveryOrder): MapPoint | null {
  return getPointFromCoordinates(order.pickupLatitude, order.pickupLongitude);
}

function getPointFromCoordinates(latitudeValue: unknown, longitudeValue: unknown): MapPoint | null {
  const latitude = parseMapCoordinate(latitudeValue);
  const longitude = parseMapCoordinate(longitudeValue);

  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const directPoint = { latitude, longitude };
  if (isValidLatitude(latitude) && isValidLongitude(longitude) && isLikelyServicePoint(directPoint)) {
    return directPoint;
  }

  const swappedPoint = { latitude: longitude, longitude: latitude };
  if (isValidLatitude(swappedPoint.latitude) && isValidLongitude(swappedPoint.longitude) && isLikelyServicePoint(swappedPoint)) {
    return swappedPoint;
  }

  return null;
}

function isOutsideParcelOrder(order: {
  parcelScope?: string | null;
  outsideDestinationCity?: string | null;
  outsideDestinationLabel?: string | null;
  outsideShippingMode?: string | null;
}) {
  if (String(order.parcelScope || '').trim().toLowerCase() === 'outside') {
    return true;
  }
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

function getDriverVisibleDropoffLabel(order: DeliveryOrder) {
  if (isOutsideParcelOrder(order)) {
    return order.driverDropoffLabel?.trim() || 'DoorDrop Admin Handoff';
  }
  return order.dropoffLabel?.trim() || order.outsideDestinationLabel?.trim() || order.driverDropoffLabel?.trim() || 'Drop-off';
}

function getDriverVisibleDropoffPoint(order: DeliveryOrder) {
  if (isOutsideParcelOrder(order)) {
    return (
      getPointFromCoordinates(order.driverDropoffLatitude, order.driverDropoffLongitude) ??
      getPointFromCoordinates(order.dropoffLatitude, order.dropoffLongitude)
    );
  }
  return (
    getPointFromCoordinates(order.dropoffLatitude, order.dropoffLongitude) ??
    getPointFromCoordinates(order.outsideDestinationLatitude, order.outsideDestinationLongitude) ??
    getPointFromCoordinates(order.driverDropoffLatitude, order.driverDropoffLongitude)
  );
}

function getDriverNavigationTarget(order: DeliveryOrder): NavigationTarget {
  if (order.status === 'driver_assigned') {
    return {
      kind: 'pickup',
      label: order.pickupLabel?.trim() || 'Pickup',
      point: getOrderPickupPoint(order),
    };
  }

  return {
    kind: 'dropoff',
    label: getDriverVisibleDropoffLabel(order),
    point: getDriverVisibleDropoffPoint(order),
  };
}

function NearbyCustomerMarker({
  MarkerComponent,
  customer,
  onPress,
}: {
  MarkerComponent: any;
  customer: NearbyCustomer;
  onPress: () => void;
}) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setTracksViewChanges(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <MarkerComponent
      coordinate={{ latitude: customer.displayLatitude, longitude: customer.displayLongitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      tappable
    >
      <View style={styles.nearbyPersonPin} collapsable={false}>
        <DriveNearbyPin />
      </View>
    </MarkerComponent>
  );
}

function FeedbackBanner({ tone, message }: { tone: FeedbackTone; message: string }) {
  const toneStyle =
    tone === 'success'
      ? styles.feedbackSuccess
      : tone === 'error'
        ? styles.feedbackError
        : styles.feedbackInfo;
  const iconName =
    tone === 'success' ? 'check-circle-outline' : tone === 'error' ? 'alert-circle-outline' : 'information-outline';
  const iconColor =
    tone === 'success' ? driveTheme.colors.online : tone === 'error' ? driveTheme.colors.danger : driveTheme.colors.info;

  return (
    <View style={[styles.feedbackBanner, toneStyle]}>
      <MaterialCommunityIcons name={iconName} size={18} color={iconColor} />
      <Text style={styles.feedbackText}>{message}</Text>
    </View>
  );
}

function AppButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
  icon,
  compact,
  grow,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'dark';
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  compact?: boolean;
  grow?: boolean;
}) {
  const buttonStyle =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'dark'
        ? styles.buttonDark
        : styles.buttonSecondary;
  const textStyle = variant === 'secondary' ? styles.buttonTextSecondary : styles.buttonTextPrimary;
  const iconColor =
    variant === 'secondary'
      ? driveTheme.colors.ink
      : variant === 'primary'
        ? driveTheme.colors.ctaText
        : '#FFFFFF';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        buttonStyle,
        compact && styles.buttonCompact,
        grow && styles.buttonGrow,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <View style={styles.buttonInner}>
        <Text
          style={[textStyle, compact && styles.buttonTextCompact]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}>
          {label}
        </Text>
        {icon ? <MaterialCommunityIcons name={icon} size={compact ? 16 : 18} color={iconColor} /> : null}
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'words',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        style={styles.textInput}
      />
    </View>
  );
}

function VehicleTypePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextValue: DriverVehicleType) => void;
}) {
  return (
    <View style={styles.vehicleCardList}>
      {vehicleTypeOptions.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.vehicleCard,
              selected && styles.vehicleCardActive,
              pressed && styles.buttonPressed,
            ]}>
            <Image source={pilotVehicleArt[option.key]} style={styles.vehicleCardArt} resizeMode="contain" />
            <Text style={styles.vehicleCardLabel}>{option.label}</Text>
            {selected ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={driveTheme.colors.ink} />
            ) : (
              <View style={styles.vehicleCardDot} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function VehicleColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextValue: string) => void;
}) {
  return (
    <View style={styles.colorPicker}>
      {vehicleColorOptions.map((option) => {
        const selected = option.label === value;

        return (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.label)}
            style={({ pressed }) => [
              styles.colorChip,
              selected && styles.colorChipActive,
              pressed && styles.buttonPressed,
            ]}>
            <View style={[styles.colorChipSwatch, { backgroundColor: option.swatch }]} />
            <Text style={[styles.colorChipText, selected && styles.colorChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.formSection}>
      <Text style={styles.formSectionTitle}>{title}</Text>
      <View style={styles.formSectionBody}>{children}</View>
    </View>
  );
}

function AuthHero({
  title,
  subtitle,
  avatarKind,
}: {
  title: string;
  subtitle: string;
  avatarKind?: Exclude<DriveAvatarKind, 'customer' | 'driver'>;
}) {
  return (
    <View style={styles.authHeroBlock}>
      <Text style={styles.authHeroTitle}>{title}</Text>
      <Text style={styles.authLandingSubtitle}>{subtitle}</Text>
      {avatarKind ? (
        <View style={styles.authIllustrationWell}>
          <DriveSceneAvatar kind={avatarKind} size={128} />
        </View>
      ) : null}
    </View>
  );
}

function SetupField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'words',
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  editable = true,
  maxLength,
  centered = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: React.ComponentProps<typeof TextInput>['autoComplete'];
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  returnKeyType?: React.ComponentProps<typeof TextInput>['returnKeyType'];
  onSubmitEditing?: () => void;
  editable?: boolean;
  maxLength?: number;
  centered?: boolean;
}) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={[styles.setupInputShell, !isPassword && styles.setupInputShellPlain]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A8B4C4"
        keyboardType={keyboardType}
        editable={editable}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        secureTextEntry={isPassword && !passwordVisible}
        style={[styles.setupTextInput, centered && styles.setupTextInputCentered]}
      />
      {isPassword ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
          hitSlop={8}
          onPress={() => setPasswordVisible((current) => !current)}
          style={({ pressed }) => [styles.setupPasswordToggle, pressed && styles.buttonPressed]}>
          <MaterialCommunityIcons
            name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={driveTheme.colors.subtext}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function SetupSelectField({
  value,
  placeholder,
  onPress,
  swatchColor,
}: {
  value?: string;
  placeholder: string;
  onPress: () => void;
  swatchColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.setupInputShell, styles.setupInputShellPlain, styles.setupSelectShell, pressed && styles.buttonPressed]}>
      {swatchColor ? <View style={[styles.setupColorSwatch, { backgroundColor: swatchColor }]} /> : null}
      <Text style={[styles.setupSelectText, !value && styles.setupSelectPlaceholder]}>
        {value || placeholder}
      </Text>
      <MaterialCommunityIcons name="menu-down" size={30} color="#7B8B8D" />
    </Pressable>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function TripStopRow({
  tone,
  title,
  label,
}: {
  tone: 'pickup' | 'dropoff';
  title: string;
  label: string;
}) {
  return (
    <View style={styles.tripStopRow}>
      <View style={[styles.tripStopDot, tone === 'pickup' ? styles.tripStopPickup : styles.tripStopDropoff]} />
      <View style={styles.tripStopCopy}>
        <Text style={styles.tripStopTitle}>{title}</Text>
        <Text style={styles.tripStopLabel}>{label}</Text>
      </View>
    </View>
  );
}

function TripMetricChip({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
}) {
  return (
    <View style={styles.tripMetricChip}>
      <MaterialCommunityIcons name={icon} size={16} color={driveTheme.colors.primaryDark} />
      <Text style={styles.tripMetricText}>{label}</Text>
    </View>
  );
}

function MetricTile({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  label: string;
}) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricTileIconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color={driveTheme.colors.primaryDark} />
      </View>
      <Text style={styles.metricTileValue}>{value}</Text>
      <Text style={styles.metricTileLabel}>{label}</Text>
    </View>
  );
}

function PaymentFlowStep({
  index,
  title,
  detail,
  tone,
}: {
  index: string;
  title: string;
  detail: string;
  tone: PaymentStepTone;
}) {
  const isDone = tone === 'done';
  const isActive = tone === 'active';

  return (
    <View style={styles.paymentFlowStep}>
      <View
        style={[
          styles.paymentFlowIndex,
          isDone ? styles.paymentFlowIndexDone : isActive ? styles.paymentFlowIndexActive : styles.paymentFlowIndexMuted,
        ]}>
        <Text style={[styles.paymentFlowIndexText, (isDone || isActive) && styles.paymentFlowIndexTextActive]}>{index}</Text>
      </View>
      <View style={styles.paymentFlowCopy}>
        <Text style={styles.paymentFlowTitle}>{title}</Text>
        <Text style={styles.paymentFlowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function TripMap({
  pickupPoint,
  dropoffPoint,
  driverPoint,
  statusLabel,
  onOpenNavigation,
  MapViewComponent,
  MarkerComponent,
  PolylineComponent,
  mapHeight,
  compact,
  onRefreshLocation,
}: {
  pickupPoint: MapPoint;
  dropoffPoint: MapPoint | null;
  driverPoint: MapPoint | null;
  statusLabel: string;
  onOpenNavigation: () => void;
  MapViewComponent: any;
  MarkerComponent: any;
  PolylineComponent: any;
  mapHeight?: number;
  compact?: boolean;
  onRefreshLocation?: () => void;
}) {
  const MapView = MapViewComponent;
  const Marker = MarkerComponent;
  const Polyline = PolylineComponent;
  const fallbackMap = (
    <View style={styles.mapFallbackShell}>
      <View style={[styles.mapFallbackScene, mapHeight ? { height: mapHeight } : null]}>
        <View style={styles.mapFallbackGlowA} />
        <View style={styles.mapFallbackGlowB} />
        <View style={styles.mapRouteLine} />
        <View style={[styles.mapNode, styles.mapNodePickup]}>
          <View style={styles.mapNodeInner} />
        </View>
        <View style={[styles.mapNode, styles.mapNodeDropoff]}>
          <View style={styles.mapNodeInner} />
        </View>
        <View style={[styles.mapNode, styles.mapNodeDriver]}>
          <MaterialCommunityIcons name="car-outline" size={14} color="#FFFFFF" />
        </View>
      </View>
      <View style={styles.mapFallbackCard}>
        <Text style={styles.mapFallbackTitle}>Route guidance</Text>
        <Text style={styles.mapFallbackText}>
          {dropoffPoint ? 'Pickup point and destination are loaded for this trip.' : 'Pickup point is loaded. Destination coordinates are pending.'}
        </Text>
        <Text style={styles.mapFallbackText}>
          Pickup: {pickupPoint.latitude.toFixed(5)}, {pickupPoint.longitude.toFixed(5)}
        </Text>
        {dropoffPoint ? (
          <Text style={styles.mapFallbackText}>
            Drop-off: {dropoffPoint.latitude.toFixed(5)}, {dropoffPoint.longitude.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.mapFallbackText}>Drop-off coordinates are not available yet.</Text>
        )}
        {driverPoint ? (
          <Text style={styles.mapFallbackText}>
            Driver: {driverPoint.latitude.toFixed(5)}, {driverPoint.longitude.toFixed(5)}
          </Text>
        ) : null}
        <AppButton label="Open navigation" icon="navigation-variant-outline" onPress={onOpenNavigation} />
      </View>
    </View>
  );

  if (Platform.OS === 'web') {
    return fallbackMap;
  }

  const routePoints = [pickupPoint, driverPoint, dropoffPoint].filter(Boolean) as MapPoint[];
  const centerPoint = dropoffPoint
    ? {
        latitude: (pickupPoint.latitude + dropoffPoint.latitude) / 2,
        longitude: (pickupPoint.longitude + dropoffPoint.longitude) / 2,
      }
    : pickupPoint;

  return (
    <View style={[styles.mapCard, compact && styles.mapCardFill]}>
      {MapView ? (
        <MapView
          provider={undefined}
          style={compact ? styles.mapViewFill : [styles.mapView, mapHeight ? { height: mapHeight } : null]}
          mapType="standard"
          customMapStyle={DRIVE_DARK_MAP_STYLE}
          userInterfaceStyle="dark"
          liteMode={false}
          showsCompass={false}
          showsTraffic
          showsMyLocationButton={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          rotateEnabled={false}
          pitchEnabled={false}
          showsUserLocation
          followsUserLocation
          loadingEnabled
          onPoiClick={() => undefined}
          initialRegion={{
            latitude: centerPoint.latitude,
            longitude: centerPoint.longitude,
            latitudeDelta: dropoffPoint ? Math.max(Math.abs(pickupPoint.latitude - dropoffPoint.latitude) * 2, 0.04) : 0.04,
            longitudeDelta: dropoffPoint ? Math.max(Math.abs(pickupPoint.longitude - dropoffPoint.longitude) * 2, 0.04) : 0.04,
          }}>
          {Marker ? <Marker coordinate={pickupPoint} pinColor="#F97316" tappable={false} tracksViewChanges={false} /> : null}
          {dropoffPoint && Marker ? <Marker coordinate={dropoffPoint} pinColor="#38BDF8" tappable={false} tracksViewChanges={false} /> : null}
          {driverPoint && Marker ? (
            <Marker coordinate={driverPoint} pinColor="#34C759" tappable={false} tracksViewChanges={false} />
          ) : null}
          {routePoints.length >= 2 && Polyline ? <Polyline coordinates={routePoints} strokeColor="#34C759" strokeWidth={5} /> : null}
        </MapView>
      ) : (
        <View style={[compact ? styles.mapViewFill : styles.mapView, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#94A3B8' }}>Map unavailable on this device</Text>
        </View>
      )}
      <View pointerEvents="box-none" style={[styles.mapOverlay, compact && styles.mapOverlayCompact]}>
        <View style={[styles.mapOverlayTop, compact && styles.mapOverlayTopCompact]}>
          {compact ? null : (
            <View style={styles.mapBadge}>
              <MaterialCommunityIcons name="map-marker-path" size={14} color="#FFFFFF" />
              <Text style={styles.mapBadgeText}>{statusLabel}</Text>
            </View>
          )}
          {onRefreshLocation ? (
            <Pressable onPress={onRefreshLocation} style={({ pressed }) => [styles.mapBadgeMuted, pressed && styles.buttonPressed]}>
              <MaterialCommunityIcons name="crosshairs-gps" size={16} color={driveTheme.colors.ink} />
            </Pressable>
          ) : compact ? null : (
            <View style={styles.mapBadgeMuted}>
              <MaterialCommunityIcons name="navigation-variant-outline" size={14} color={driveTheme.colors.ink} />
              <Text style={styles.mapBadgeMutedText}>Route loaded</Text>
            </View>
          )}
        </View>
        {compact ? null : (
          <View style={styles.mapOverlayBottom}>
            <Pressable onPress={onOpenNavigation} style={({ pressed }) => [styles.mapNavButton, pressed && styles.buttonPressed]}>
              <MaterialCommunityIcons name="navigation-variant-outline" size={18} color="#FFFFFF" />
              <Text style={styles.mapNavButtonText}>Follow route</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
// NEW: Driver extra fields interface for Firestore
// ──────────────────────────────────────────────
interface DriverExtraFields {
  totalOnlineHours?: number;
  onlineSessionStart?: number;
  cancellationCount?: number;
  rejectionCount?: number;
  disciplinePoints?: number;
  driverScore?: number;
  completedOrderCount?: number;
  suspensionUntil?: number;
  lastCommissionPaymentDateKey?: string;
  lastCommissionPaidAmount?: number;
  lastCommissionPaidAt?: unknown;
  lastCommissionPaymentStatus?: string;
  lastSubscriptionPaymentStatus?: string;
  lastSubscriptionPaymentExpiresAt?: unknown;
  subscriptionPaidUntil?: unknown;
  subscriptionTrialStartedAt?: unknown;
  subscriptionTrialEndsAt?: unknown;
  subscriptionStatus?: string;
  totalCommissionPaid?: number;
}

// ──────────────────────────────────────────────
// NEW: Utility to extract number from currency string
// ──────────────────────────────────────────────
function parseAmountFromLabel(label?: string | null): number {
  const digits = String(label || '').replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
}

function toLocalDateKey(value: Date | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function toTanzaniaDateKey(value: Date | number = new Date()) {
  const millis = value instanceof Date ? value.getTime() : value;
  const date = new Date(millis + tanzaniaUtcOffsetMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + tanzaniaUtcOffsetMs);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - tanzaniaUtcOffsetMs;
}

function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + tanzaniaUtcOffsetMs);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * dayMs;
}

function getPaymentFeedbackMessage(error: unknown, copy: DriverCopy, fallback: string) {
  if (error instanceof PaymentApiError) {
    return error.code === 'unavailable' ? copy.payServiceDown : copy.payOffline;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getOrderTimestampMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getDeliveredOrderMillis(order: DeliveryOrder) {
  return getOrderTimestampMillis(order.deliveredAt || order.updatedAt || order.createdAt);
}

function getOrderActivityMillis(order: DeliveryOrder) {
  return getOrderTimestampMillis(
    order.status === 'delivered'
      ? order.deliveredAt || order.updatedAt || order.createdAt
      : order.updatedAt || order.createdAt
  );
}

function getDriverSubscriptionBillingCycleStartMillis() {
  return getTanzaniaWeekStartMillis();
}

// ──────────────────────────────────────────────
// DoorDriveApp Component
// ──────────────────────────────────────────────

export default function DoorDriveApp() {
  useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.round(Math.min(320, Math.max(180, windowHeight * 0.28)));
  const statusBarInset =
    Platform.OS === 'android' ? Math.max(AndroidStatusBar.currentHeight ?? 0, 24) + 12 : 0;
  const androidNavInset =
    Platform.OS === 'android'
      ? Math.max(
          52,
          Dimensions.get('screen').height - windowHeight - (AndroidStatusBar.currentHeight ?? 0)
        )
      : 0;
  // ─── Original state ───────────────────────
  const [authMode, setAuthMode] = useState<AuthMode>('phone');
  const [phoneAuthNumber, setPhoneAuthNumber] = useState('');
  const [phoneAuthCode, setPhoneAuthCode] = useState('');
  const [phoneAuthStep, setPhoneAuthStep] = useState<'number' | 'code'>('number');
  const [phoneAuthBusy, setPhoneAuthBusy] = useState(false);
  const otpPhoneRef = useRef('');
  const [registerStep, setRegisterStep] = useState<'details' | 'vehicle'>('vehicle');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [showStartupSplash, setShowStartupSplash] = useState(true);
  const [pilotIntroReady, setPilotIntroReady] = useState(false);
  const [pilotIntroDone, setPilotIntroDone] = useState(false);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [driverOrdersLoading, setDriverOrdersLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [driverFareDraft, setDriverFareDraft] = useState<number | null>(null);
  const [driverOfferNote, setDriverOfferNote] = useState(DEFAULT_FARE_NOTE);
  const [selectedTab, setSelectedTab] = useState<DriverTab>('home');
  const [homeSheetExpanded, setHomeSheetExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inAppNavMode, setInAppNavMode] = useState(false);
  const [orderCancelledVisible, setOrderCancelledVisible] = useState(false);
  const lastCancelledOrderIdRef = useRef<string | null>(null);
  const [historySection, setHistorySection] = useState<'trips' | 'payments'>('trips');
  const [accountView, setAccountView] = useState<AccountView>('overview');
  const [paymentCheckoutStep, setPaymentCheckoutStep] = useState<PaymentCheckoutStep>('debt');
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null);
  const [locationPermission, setLocationPermission] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [locationLabel, setLocationLabel] = useState('Location sync has not started yet.');
  const [driverProfile, setDriverProfile] = useState<DriverRecord | null>(null);
  const [driverOrders, setDriverOrders] = useState<DeliveryOrder[]>([]);
  const pendingCargoOffersRef = useRef<Map<string, DeliveryOrder>>(new Map());
  const [openCargoOffers, setOpenCargoOffers] = useState<DeliveryOrder[]>([]);
  const [tripMessages, setTripMessages] = useState<OrderMessage[]>([]);
  const [tripMessagesLoading, setTripMessagesLoading] = useState(false);
  const [tripMessageDraft, setTripMessageDraft] = useState('');
  const [tripMessageSending, setTripMessageSending] = useState(false);
  const [tripChatOpen, setTripChatOpen] = useState(false);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [nearbyCustomers, setNearbyCustomers] = useState<NearbyCustomer[]>([]);
  const [activeOrderContactPhone, setActiveOrderContactPhone] = useState('');
  const [liveMapPoint, setLiveMapPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedNearbyCustomer, setSelectedNearbyCustomer] = useState<NearbyCustomer | null>(null);
  const [activeRoadRoute, setActiveRoadRoute] = useState<RoadMapPoint[]>([]);
  const [leadMessageSending, setLeadMessageSending] = useState(false);
  const [customerRatingScore, setCustomerRatingScore] = useState(5);
  const [customerRatingComment, setCustomerRatingComment] = useState('');
  const [customerRatingSaving, setCustomerRatingSaving] = useState(false);
  const [language, setLanguage] = useState<DriverLang>('sw');
  const [languageChosen, setLanguageChosen] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const autoAcceptedOrderIdRef = useRef<string | null>(null);
  const ussdInitiateLockRef = useRef(false);
  const settingsReadyRef = useRef(false);
  const homeMapRef = useRef<any>(null);
  const copy = getDriverCopy(language);

  const chooseLanguage = (next: DriverLang) => {
    setLanguage(next);
    setLanguageChosen(true);
  };

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(getInitialRegisterForm());
  const [registerTermsAccepted, setRegisterTermsAccepted] = useState(false);
  const [profileSetup, setProfileSetup] = useState<ProfileSetupState>(getInitialProfileSetup(null));
  const [registrationSubmitted, setRegistrationSubmitted] = useState(false);

  // ─── NEW state for performance & payment tracking ───
  const [extraFields, setExtraFields] = useState<DriverExtraFields>({});
  const [onlineHours, setOnlineHours] = useState(0);
  const [onlineSessionTimer, setOnlineSessionTimer] = useState<NodeJS.Timeout | null>(null);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [showPaymentNotice, setShowPaymentNotice] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentPhoneNumber, setPaymentPhoneNumber] = useState('');
  const [selectedPaymentNetwork, setSelectedPaymentNetwork] = useState<DriverPaymentNetworkKey>('mpesa');
  const [driverPaymentStatus, setDriverPaymentStatus] = useState<DriverPaymentStatusResponse | null>(null);
  const [driverPaymentHistory, setDriverPaymentHistory] = useState<DriverPaymentRecord[]>([]);
  const [paymentRefreshing, setPaymentRefreshing] = useState(false);
  const [nowMillis, setNowMillis] = useState(Date.now());
  const sessionAccumulatorRef = useRef<number>(0);
  const knownTripMessageIdsRef = useRef<Set<string>>(new Set());
  const tripMessagesHydratedRef = useRef(false);
  const lastIncomingOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    const splashTimer = setTimeout(() => setShowStartupSplash(false), 4000);
    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hasSeenPilotIntro().then((seen) => {
      if (cancelled) {
        return;
      }
      setPilotIntroDone(seen);
      setPilotIntroReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadDriverSettings().then((settings) => {
      setLanguage(settings.language);
      setLanguageChosen(Boolean(settings.languageChosen));
      setAutoConfirm(settings.autoConfirm);
      settingsReadyRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!settingsReadyRef.current) {
      return;
    }
    const settings: DriverSettings = { language, autoConfirm, languageChosen };
    void saveDriverSettings(settings);
  }, [autoConfirm, language, languageChosen]);

  useEffect(() => {
    const timer = setInterval(() => setNowMillis(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Guarded maps import. AndroidManifest now includes com.google.android.geo.API_KEY.
  const Maps = tryRequire<any>('react-native-maps');
  const MapView = Maps?.default ?? Maps ?? null;
  const Marker = Maps?.Marker ?? null;
  const Polyline = Maps?.Polyline ?? null;
  const Circle = Maps?.Circle ?? null;
  const mapsProvider = Platform.OS === 'android' ? Maps?.PROVIDER_GOOGLE : undefined;

  const normalizedRegisterPhone = useMemo(() => normalizePhoneNumber(registerForm.phoneNumber), [registerForm.phoneNumber]);
  const normalizedSetupPhone = useMemo(() => normalizePhoneNumber(profileSetup.phoneNumber), [profileSetup.phoneNumber]);
  const driverProfileComplete = isCompleteDriverProfile(driverProfile);
  const needsVehicleChoice = Boolean(driverProfileComplete && driverProfile && !isCanonicalPilotVehicle(driverProfile.vehicleType));
  const driverProfileMissing =
    !!authUser &&
    !profileLoading &&
    !registering &&
    !registrationSubmitted &&
    !driverProfileComplete;
  const hasReadyDriverProfile = !!driverProfile && !driverProfileMissing;
  const nearbyQueryKey = useMemo(() => {
    const latitude = Number(liveMapPoint?.latitude ?? driverProfile?.currentLatitude);
    const longitude = Number(liveMapPoint?.longitude ?? driverProfile?.currentLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return '';
    }

    return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  }, [driverProfile?.currentLatitude, driverProfile?.currentLongitude, liveMapPoint?.latitude, liveMapPoint?.longitude]);
  const activeOrder = useMemo(
    () => {
      const currentOrderId = driverProfile?.currentOrderId?.trim();
      if (currentOrderId) {
        const currentOrder = driverOrders.find((order) => order.id === currentOrderId && isActiveOrderStatus(order.status));
        if (currentOrder) {
          return currentOrder;
        }
      }

      const assigned = driverOrders.find((order) => isActiveOrderStatus(order.status));
      if (assigned) {
        return assigned;
      }

      if (!driverProfile?.isAvailable) {
        return null;
      }

      return openCargoOffers.find((order) => !order.declinedDriverIds?.includes(driverProfile.id)) ?? null;
    },
    [driverOrders, driverProfile?.currentOrderId, driverProfile?.id, driverProfile?.isAvailable, openCargoOffers]
  );
  useEffect(() => {
    if (!activeOrder || activeOrder.fareType !== 'negotiated') {
      setDriverFareDraft(null);
      return;
    }
    const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
    const customerAmount =
      typeof activeOrder.customerOffer === 'number' && activeOrder.customerOffer > 0
        ? activeOrder.customerOffer
        : minFare;
    const driverAmount =
      typeof activeOrder.driverOffer === 'number' && activeOrder.driverOffer > 0 ? activeOrder.driverOffer : 0;
    const start =
      activeOrder.lastOfferBy === 'driver' && driverAmount > 0
        ? Math.max(minFare, driverAmount)
        : Math.max(minFare, customerAmount);
    setDriverFareDraft(start);
  }, [
    activeOrder?.customerOffer,
    activeOrder?.driverOffer,
    activeOrder?.fareType,
    activeOrder?.id,
    activeOrder?.lastOfferBy,
    activeOrder?.minFare,
  ]);
  useEffect(() => {
    setDriverOfferNote(DEFAULT_FARE_NOTE);
  }, [activeOrder?.id]);
  const isInstantCargoVerify = String(activeOrder?.assignmentMode || '') === 'cargo_ws';
  const fareNegotiation = (() => {
    if (!activeOrder || activeOrder.fareType !== 'negotiated') {
      return null;
    }
    // Instant verify: fixed quoted fare — accept or decline only.
    if (isInstantCargoVerify) {
      const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
      const customerOffer = activeOrder.customerOffer ?? 0;
      return {
        minFare,
        used: 0,
        left: 0,
        matching: true,
        sameResend: false,
        mustWait: false,
        sendingNew: false,
        chanceHint: '',
        fixedFare: Math.max(minFare, customerOffer),
      };
    }
    const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
    const customerOffer = activeOrder.customerOffer ?? 0;
    const draft = Math.max(minFare, driverFareDraft ?? customerOffer ?? minFare);
    const used = Math.max(0, Math.round(Number(activeOrder.driverNegotiationUsed) || 0));
    const left = Math.max(0, DRIVER_NEGOTIATION_CHANCES - used);
    const matching = cargoOffersMatch(customerOffer, draft);
    const sameResend = activeOrder.lastOfferBy === 'driver' && cargoOffersMatch(activeOrder.driverOffer, draft);
    const mustWait = left <= 0 && activeOrder.lastOfferBy !== 'customer' && !matching;
    const sendingNew = !matching && !sameResend && left > 0;
    const chanceHint = left <= 0 ? 'Mwisho' : left === 1 ? '1' : '';
    return { minFare, used, left, matching, sameResend, mustWait, sendingNew, chanceHint };
  })();
  const demandZones = useMemo(() => buildDemandZones(nearbyCustomers), [nearbyCustomers]);
  const topDemandZone = useMemo(() => getTopDemandZone(demandZones), [demandZones]);
  const orderProbability = useMemo(() => {
    const point =
      getPointFromCoordinates(driverProfile?.currentLatitude, driverProfile?.currentLongitude) ?? liveMapPoint;
    if (!point) {
      return 0;
    }
    return estimateOrderProbabilityAtPoint(point, nearbyCustomers, demandZones);
  }, [
    demandZones,
    driverProfile?.currentLatitude,
    driverProfile?.currentLongitude,
    liveMapPoint,
    nearbyCustomers,
  ]);
  const trackDriverActivity = (
    eventName: string,
    featureKey: string,
    metadata?: Record<string, string | number | boolean | null | undefined>
  ) => {
    void recordDriverActivity({
      driverId: authUser?.uid,
      driverName: driverProfile?.fullName || authUser?.displayName || authUser?.email || 'HAUL Pilots',
      eventName,
      featureKey,
      featureLabel: 'Driver operations',
      screen: selectedTab,
      route: 'doordrive',
      metadata: {
        vehicleType: driverProfile?.vehicleType,
        isAvailable: driverProfile?.isAvailable,
        hasActiveOrder: Boolean(activeOrder),
        ...metadata,
      },
    });
  };
  const todayDateKey = toTanzaniaDateKey(nowMillis);
  const todayOrders = useMemo(
    () => driverOrders.filter((order) => {
      const activityMillis = getOrderActivityMillis(order);
      return !!activityMillis && toTanzaniaDateKey(activityMillis) === todayDateKey;
    }),
    [driverOrders, todayDateKey]
  );
  const todayDeliveredOrders = useMemo(
    () => todayOrders.filter((order) => order.status === 'delivered'),
    [todayOrders]
  );
  const todayCompletedCount = todayDeliveredOrders.length;
  const todayActiveCount = todayOrders.filter((order) => isActiveOrderStatus(order.status)).length;
  const todayEarnings = todayDeliveredOrders.reduce(
    (sum, order) => sum + parseAmountFromLabel(order.totalLabel || order.fareLabel),
    0
  );
  const rawVerificationStatus = String(driverProfile?.verificationStatus || '').trim().toLowerCase();
  const driverVerificationPending =
    rawVerificationStatus === 'pending_admin_verification' ||
    rawVerificationStatus === 'pending' ||
    rawVerificationStatus === 'submitted';
  const driverVerificationRejected = rawVerificationStatus === 'rejected';
  const accessPlan = getDriverAccessPlan(driverProfile);
  const accessPeriodStartMillis = getAccessPeriodStartMillis(accessPlan, nowMillis);
  const accessBillingKey = getAccessBillingPeriodKey(accessPlan, nowMillis);
  const periodDeliveredOrders = useMemo(
    () =>
      driverOrders.filter(
        (order) => order.status === 'delivered' && getDeliveredOrderMillis(order) >= accessPeriodStartMillis
      ),
    [driverOrders, accessPeriodStartMillis]
  );
  const periodCompletedCount = periodDeliveredOrders.length;
  const deliveredOrderCount = accessPlan.period === 'week' ? periodCompletedCount : todayCompletedCount;
  const accessDriver = {
    ...driverProfile,
    dailyCompletedDateKey: toTanzaniaDateKey(nowMillis),
    dailyCompletedOrderCount: todayCompletedCount,
    weeklyCompletedWeekKey: driverProfile?.weeklyCompletedWeekKey || accessBillingKey,
    weeklyCompletedOrderCount:
      String(driverProfile?.weeklyCompletedWeekKey || '') === accessBillingKey
        ? Number(driverProfile?.weeklyCompletedOrderCount || periodCompletedCount)
        : periodCompletedCount,
    accessPaymentDuePeriodKey: driverProfile?.accessPaymentDuePeriodKey,
  };
  const accessPlanState = buildAccessPlanState(accessDriver, nowMillis, deliveredOrderCount);
  const isWeeklyAccess = accessPlanState.period === 'week';
  const driverAccessDailyFeeTzs = Number(
    driverPaymentStatus?.subscription?.amount || driverPaymentStatus?.subscription?.dailyFee || accessPlanState.feeTzs
  );
  const weeklySubscriptionFeeTzs = driverAccessDailyFeeTzs;
  const accessFeeLabel = formatAccessFeeLabel({
    feeTzs: driverAccessDailyFeeTzs,
    periodLabel: (driverPaymentStatus?.subscription?.periodLabel || accessPlanState.periodLabel) as 'day' | 'week',
  });
  const subscriptionPaidUntilMillis = getOrderTimestampMillis(driverPaymentStatus?.subscription?.paidUntil || driverProfile?.subscriptionPaidUntil);
  const subscriptionActive =
    hasReadyDriverProfile &&
    (driverPaymentStatus?.subscription?.active ?? isDriverSubscriptionActive(accessDriver, nowMillis, deliveredOrderCount));
  const latestPayment = driverPaymentStatus?.latestPayment || null;
  const latestPaymentStatus = (latestPayment?.status || driverProfile?.lastSubscriptionPaymentStatus || '').toLowerCase();
  const latestPaymentExpiresMillis = getOrderTimestampMillis(latestPayment?.expiresAt || driverProfile?.lastSubscriptionPaymentExpiresAt);
  const subscriptionPaymentPending =
    !subscriptionActive &&
    ['creating', 'pending', 'initiated', 'processing'].includes(latestPaymentStatus) &&
    (!latestPaymentExpiresMillis || latestPaymentExpiresMillis > nowMillis);
  const commissionOrders = periodDeliveredOrders;
  const weeklyDeliveredOrderCount = accessPlan.period === 'week' ? periodCompletedCount : todayCompletedCount;
  const commissionDateKey = toTanzaniaDateKey(nowMillis);
  const dailyGrossEarnings = todayEarnings;
  const commissionSummary = useMemo(
    () => summarizeDriverCommission(driverOrders, driverProfile),
    [driverOrders, driverProfile]
  );
  const dailyCommissionDue = commissionSummary.unpaidTzs;
  const hasCommissionDue =
    hasReadyDriverProfile &&
    !driverVerificationPending &&
    !driverVerificationRejected &&
    commissionSummary.unpaidTzs > 0;
  const commissionPaymentPending =
    String(driverProfile?.commissionPayment?.status || driverProfile?.commissionStatus || '').toLowerCase() ===
    'pending';
  /** Lock only when unpaid commission hits the ceiling — not weekly subscription. */
  const driverAccessBlocked =
    hasReadyDriverProfile &&
    !driverVerificationPending &&
    !driverVerificationRejected &&
    commissionSummary.locked;
  const subscriptionCountdownLabel = !hasReadyDriverProfile
    ? copy.accessCountdownVerify
    : accessPlanState.unpaidDebt
      ? isWeeklyAccess
        ? copy.accessCountdownUnpaidDebtWeek
        : copy.accessCountdownUnpaidDebt
      : accessPlanState.workWindow && accessPlanState.completedOrders >= accessPlanState.minOrders
        ? isWeeklyAccess
          ? copy.accessCountdownPayAtWeekEnd(accessPlanState.completedOrders)
          : copy.accessCountdownPayAtTen(accessPlanState.completedOrders)
        : accessPlanState.grace
          ? isWeeklyAccess
            ? copy.accessCountdownProgressWeek(accessPlanState.completedOrders, accessPlanState.minOrders)
            : copy.accessCountdownProgress(accessPlanState.completedOrders, accessPlanState.minOrders)
          : subscriptionActive
            ? isWeeklyAccess
              ? copy.accessCountdownActiveWeek
              : copy.accessCountdownActive
            : isWeeklyAccess
              ? copy.accessCountdownPayWeek(accessFeeLabel)
              : copy.accessCountdownPayToday(accessFeeLabel);
  const subscriptionCountdownShortLabel = !hasReadyDriverProfile
    ? copy.accessShortPending
    : accessPlanState.unpaidDebt
      ? copy.accessShortUnpaid
      : accessPlanState.workWindow && accessPlanState.completedOrders >= accessPlanState.minOrders
        ? isWeeklyAccess
          ? copy.accessShortPayAtWeekEnd(accessPlanState.completedOrders)
          : copy.accessShortPayAtTen(accessPlanState.completedOrders)
        : accessPlanState.grace
          ? copy.accessShortProgress(accessPlanState.completedOrders, accessPlanState.minOrders)
          : subscriptionActive
            ? isWeeklyAccess
              ? copy.accessShortActiveWeek
              : copy.accessShortActive
            : copy.accessShortPayNow;
  const subscriptionCountdownCaption = !hasReadyDriverProfile
    ? copy.accessCaptionVerify
    : accessPlanState.unpaidDebt
      ? isWeeklyAccess
        ? copy.accessCaptionUnpaidDebtWeek
        : copy.accessCaptionUnpaidDebt
      : accessPlanState.workWindow && accessPlanState.completedOrders >= accessPlanState.minOrders
        ? isWeeklyAccess
          ? copy.accessCaptionPayAtWeekEnd(accessPlanState.label, accessPlanState.minOrders)
          : copy.accessCaptionPayAtTen(accessPlanState.label, accessPlanState.minOrders)
        : accessPlanState.grace
          ? isWeeklyAccess
            ? copy.accessCaptionProgressWeek(accessPlanState.label, accessPlanState.remainingOrders)
            : copy.accessCaptionProgress(accessPlanState.label, accessPlanState.remainingOrders)
          : subscriptionActive
            ? isWeeklyAccess
              ? copy.accessCaptionActiveWeek(accessPlanState.label)
              : copy.accessCaptionActive(accessPlanState.label)
            : isWeeklyAccess
              ? copy.accessCaptionPayUssdWeek(accessPlanState.label)
              : copy.accessCaptionPayUssd(accessPlanState.label);
  const commissionPaymentOverdue = hasCommissionDue && !subscriptionPaymentPending;
  const subscriptionStatusMessage = subscriptionActive
    ? copy.accessStatusActive
    : subscriptionPaymentPending
      ? copy.accessStatusPending
      : accessPlanState.grace
        ? copy.accessStatusGrace
        : copy.accessStatusRenew;
  const commissionPaidForDate = subscriptionPaymentPending;
  const driverCanReceiveDispatch = !driverVerificationPending && !driverVerificationRejected;
  const paymentNetworks = (driverPaymentStatus?.networks?.length ? driverPaymentStatus.networks : defaultPaymentNetworks).filter(
    (item) => item.key === 'mpesa' || item.key === 'mixx' || item.key === 'airtel'
  );
  const selectedNetworkMeta =
    paymentNetworks.find((item) => item.key === selectedPaymentNetwork) ||
    paymentNetworks.find((item) => item.enabled) ||
    defaultPaymentNetworks[0];
  const selectedNetworkLogo = paymentNetworkLogo(selectedPaymentNetwork);
  const detectedPaymentNetwork = detectPaymentNetworkFromPhone(paymentPhoneNumber || driverProfile?.phoneNumber);
  const selectedNetworkLabel = paymentNetworkLabel(selectedPaymentNetwork);
  const paymentNetworkTileStyle = (key?: string | null) => {
    const network = String(key || '').toLowerCase();
    if (network === 'mixx') {
      return styles.fintechLogoTileMixx;
    }
    if (network === 'airtel' || network === 'airtelmoney') {
      return styles.fintechLogoTileAirtel;
    }
    return styles.fintechLogoTileMpesa;
  };
  const availabilityLabel = activeOrder
    ? 'Busy on active trip'
    : driverVerificationPending
      ? 'Pending admin verification'
      : driverVerificationRejected
        ? 'Verification needs correction'
        : hasCommissionDue
            ? subscriptionPaymentPending ? 'Payment pending' : 'Payment required'
            : driverProfile?.isAvailable
              ? 'Online for dispatch'
              : 'Offline from dispatch';
  const availabilityNote = activeOrder
    ? 'Dispatch can see that you are currently handling a live order.'
    : driverVerificationPending
      ? 'Admin is reviewing your name, phone, vehicle, and plate number.'
      : driverVerificationRejected
        ? 'Your verification was rejected. Contact admin or update your profile details.'
        : hasCommissionDue
            ? subscriptionPaymentPending
              ? 'Approve the mobile money prompt or refresh status after paying.'
              : `Pay TZS ${driverAccessDailyFeeTzs.toLocaleString()} daily to receive and manage orders.`
            : driverProfile?.isAvailable
              ? 'Admin can assign work to you now.'
              : 'Admin will not assign new work until you go online.';
  const commissionPaymentReference = useMemo(() => {
    const plateReference = driverProfile?.plateNumber?.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const driverReference = authUser?.uid ? authUser.uid.slice(0, 6).toUpperCase() : 'DRIVER';
    const dateReference = commissionDateKey.replace(/-/g, '');

    return `DD-${plateReference || driverReference}-${dateReference}`;
  }, [authUser?.uid, commissionDateKey, driverProfile?.plateNumber]);
  const pendingCustomerRatingOrder = useMemo(
    () => driverOrders.find((order) => order.status === 'delivered' && !order.driverCustomerRating) ?? null,
    [driverOrders]
  );
  const notificationItems = useMemo<DriverNotification[]>(() => {
    const items: DriverNotification[] = [];
    const awaitingAccept = isIncomingOffer(activeOrder);

    if (activeOrder) {
      items.push({
        id: `active-${activeOrder.id}`,
        title: awaitingAccept ? copy.notifActiveAssigned : copy.notifActiveTitle,
        message: `${activeOrder.orderNumber} · ${getDriverOrderStatusCopy(activeOrder.status, copy)}`,
        icon: awaitingAccept ? 'bell-ring-outline' : 'navigation-variant-outline',
        tone: awaitingAccept ? 'warning' : 'info',
        time: formatDeliveryDateTime(activeOrder.createdAt),
        action: 'trip',
        unread: true,
      });
    }

    const latestCustomerMessage = tripMessages.filter((item) => item.senderRole === 'customer').slice(-1)[0];
    if (latestCustomerMessage) {
      items.push({
        id: `message-${latestCustomerMessage.id}`,
        title: copy.notifCustomerMessage,
        message: latestCustomerMessage.message,
        icon: 'message-text-outline',
        tone: 'info',
        time: formatDeliveryDateTime(latestCustomerMessage.createdAt),
        action: 'chat',
        unread: true,
      });
    }

    if (hasCommissionDue) {
      items.push({
        id: 'payment-due',
        title: commissionPaymentPending ? copy.notifPaymentPendingTitle : copy.notifPaymentDueTitle,
        message: commissionPaymentPending
          ? 'Malipo ya komisheni hayajathibitishwa.'
          : `Unadaiwa TZS ${commissionSummary.unpaidTzs.toLocaleString()} · kiwango TZS ${commissionSummary.payCeilingTzs.toLocaleString()}`,
        icon: 'cash-clock',
        tone: 'warning',
        time: subscriptionStatusMessage,
        action: 'payments',
        unread: true,
      });
    }

    if (driverVerificationPending) {
      items.push({
        id: 'driver-verification-pending',
        title: copy.notifVerifyPendingTitle,
        message: copy.notifVerifyPendingMsg,
        icon: 'shield-check-outline',
        tone: 'warning',
        time: copy.pending,
        action: 'account',
        unread: true,
      });
    }

    if (driverVerificationRejected) {
      items.push({
        id: 'driver-verification-rejected',
        title: copy.notifVerifyRejectedTitle,
        message: copy.notifVerifyRejectedMsg,
        icon: 'shield-alert-outline',
        tone: 'warning',
        time: copy.due,
        action: 'account',
        unread: true,
      });
    }

    if (locationPermission === 'denied') {
      items.push({
        id: 'location-denied',
        title: copy.notifLocationTitle,
        message: copy.notifLocationMsg,
        icon: 'map-marker-alert-outline',
        tone: 'warning',
        time: copy.hold,
        action: 'location',
        unread: true,
      });
    }

    return items;
  }, [activeOrder, commissionPaymentPending, commissionSummary.payCeilingTzs, commissionSummary.unpaidTzs, copy, driverVerificationPending, driverVerificationRejected, hasCommissionDue, locationPermission, subscriptionStatusMessage, tripMessages]);
  const unreadNotificationCount = notificationItems.filter((item) => item.unread).length;

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timer = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    setFeedback(null);
  }, [selectedTab]);

  async function refreshDriverPayments(showSpinner = true) {
    if (!authUser?.uid) {
      return;
    }

    if (showSpinner) {
      setPaymentRefreshing(true);
    }

    try {
      const status = await fetchDriverPaymentStatus();
      setDriverPaymentStatus(status);
      setDriverPaymentHistory(status.history || []);
    } catch (error) {
      if (showSpinner) {
        setFeedback({
          tone: 'error',
          message: getPaymentFeedbackMessage(error, copy, 'Could not refresh payment status right now.'),
        });
      }
    } finally {
      if (showSpinner) {
        setPaymentRefreshing(false);
      }
    }
  }

  useEffect(() => {
    setDriverPaymentStatus(null);
    setDriverPaymentHistory([]);
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid) {
      return;
    }

    void refreshDriverPayments(false);
  }, [authUser?.uid]);

  useEffect(() => {
    const detected = detectPaymentNetworkFromPhone(paymentPhoneNumber || driverProfile?.phoneNumber);
    if (detected) {
      setSelectedPaymentNetwork(detected);
    }
  }, [driverProfile?.phoneNumber, paymentPhoneNumber]);

  useEffect(() => {
    if (!authUser?.uid || !commissionPaymentPending) {
      return;
    }

    let interval: ReturnType<typeof setInterval> | undefined;
    const delay = setTimeout(() => {
      interval = setInterval(() => {
        void verifyDriverCommissionUssd(driverProfile?.commissionPayment?.orderId)
          .then((status) => {
            if (status.networks?.length) {
              // keep pay sheet networks fresh when backend returns them
            }
            if (typeof status.unpaidTzs === 'number') {
              setFeedback((current) =>
                status.settled
                  ? { tone: 'success', message: 'Malipo yamethibitishwa.' }
                  : current
              );
            }
          })
          .catch(() => null);
      }, 20000);
    }, 15000);

    return () => {
      clearTimeout(delay);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [authUser?.uid, commissionPaymentPending, driverProfile?.commissionPayment?.orderId]);

  useEffect(() => {
    const awaitingAccept = isIncomingOffer(activeOrder);

    if (awaitingAccept && activeOrder && lastIncomingOrderIdRef.current !== activeOrder.id) {
      lastIncomingOrderIdRef.current = activeOrder.id;
      startIncomingOrderAlert(activeOrder.id);
      return;
    }

    if (!awaitingAccept) {
      stopIncomingOrderAlert();
    }
  }, [activeOrder?.acceptedByDriverAt, activeOrder?.id, activeOrder?.status]);

  useEffect(() => {
    if (!authUser) {
      lastIncomingOrderIdRef.current = null;
      stopIncomingOrderAlert();
      setIncomingAlertOnline(false);
      return;
    }

    const awaitingAccept = isIncomingOffer(activeOrder);
    setIncomingAlertOnline(Boolean(driverProfile?.isAvailable) || awaitingAccept);
  }, [activeOrder?.acceptedByDriverAt, activeOrder?.id, activeOrder?.status, authUser, driverProfile?.isAvailable]);

  useEffect(() => {
    if (!authUser?.uid) {
      return;
    }

    let cancelled = false;
    void registerDriverPushToken(authUser.uid).catch((error) => {
      console.warn(
        '[HAUL_PILOTS_PUSH] register failed',
        error instanceof Error ? error.message : 'error'
      );
    });

    const stopForeground = listenForForegroundOrderPushes();
    const stopTaps = listenForOrderNotificationTaps((orderId) => {
      if (cancelled) {
        return;
      }
      console.info('[HAUL_PILOTS_PUSH] notification tap', orderId);
      setSelectedTab('home');
      setMenuOpen(false);
    });

    return () => {
      cancelled = true;
      stopForeground();
      stopTaps();
    };
  }, [authUser?.uid]);

  // ──────────────────────────────────────────────
  // Original effects (unchanged)
  // ──────────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setAuthUser(nextUser);
      setAuthInitializing(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authUser) {
      setDriverProfile(null);
      setDriverOrders([]);
      setTripMessages([]);
      setTripMessagesLoading(false);
      setTripMessageDraft('');
      setExtraFields({});
      setOnlineHours(0);
      setProfileLoading(false);
      setDriverOrdersLoading(false);
      setRegistrationSubmitted(false);
      knownTripMessageIdsRef.current = new Set();
      tripMessagesHydratedRef.current = false;
      return;
    }

    setProfileLoading(true);
    setDriverOrdersLoading(true);

    const unsubscribeDriver = subscribeToDriver(
      authUser.uid,
      (nextDriver) => {
        setDriverProfile(nextDriver);
        if (nextDriver) {
          const nextExtraFields = nextDriver as DriverExtraFields;
          setExtraFields(nextExtraFields);
          if (nextExtraFields.totalOnlineHours !== undefined) {
            setOnlineHours(nextExtraFields.totalOnlineHours);
          }
        } else {
          setExtraFields({});
          setOnlineHours(0);
        }
        setProfileLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not load the driver profile right now.')
              : 'Could not load the driver profile right now.',
        });
        setProfileLoading(false);
      }
    );

    const unsubscribeDriverOrders = subscribeToDriverOrders(
      authUser.uid,
      (orders) => {
        for (const order of orders) {
          pendingCargoOffersRef.current.delete(order.id);
        }
        setDriverOrders(mergePendingCargoOffers(orders, pendingCargoOffersRef.current));
        setDriverOrdersLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not load your delivery feed right now.')
              : 'Could not load your delivery feed right now.',
        });
        setDriverOrdersLoading(false);
      }
    );

    const unsubscribeDriverPayments = subscribeToDriverPayments(
      authUser.uid,
      (payments) => {
        setDriverPaymentHistory(payments);
      }
    );

    void fetchDriverPaymentHistory()
      .then((payload) => {
        if (payload.history?.length) {
          setDriverPaymentHistory((current) => (current.length ? current : payload.history));
        }
      })
      .catch(() => null);

    return () => {
      unsubscribeDriver();
      unsubscribeDriverOrders();
      unsubscribeDriverPayments();
    };
  }, [authUser]);

  useEffect(() => {
    const vehicleType = canonicalCargoVehicleKey(driverProfile?.vehicleType);
    if (!authUser?.uid || !driverProfile?.isAvailable || !vehicleType) {
      setOpenCargoOffers([]);
      return;
    }

    const unsubscribe = subscribeToOpenCargoOffers(vehicleType, (orders) => {
      setOpenCargoOffers(orders);
    });
    return () => unsubscribe();
  }, [authUser?.uid, driverProfile?.isAvailable, driverProfile?.vehicleType]);

  const cargoOfferSocketRef = useRef<ReturnType<typeof connectCargoOfferSocket> | null>(null);

  // Instant cargo verify WebSocket — receive assigned offers without open-pool polling.
  useEffect(() => {
    const driverId = authUser?.uid;
    if (!driverId || !driverProfile?.isAvailable) {
      cargoOfferSocketRef.current?.close();
      cargoOfferSocketRef.current = null;
      return;
    }

    let client: ReturnType<typeof connectCargoOfferSocket> | null = null;
    try {
      client = connectCargoOfferSocket({
        onOpen: () => {
          void (async () => {
            const token = await auth.currentUser?.getIdToken().catch(() => '');
            if (!token) {
              return;
            }
            client?.send({ type: 'hello', role: 'driver', driverId, token });
          })();
        },
        onEvent: (event) => {
          if (event.type === 'offer' && event.orderId) {
            const incoming = deliveryOrderFromCargoWsOffer(event.orderId, event.order);
            if (incoming) {
              pendingCargoOffersRef.current.set(incoming.id, incoming);
              setDriverOrders((current) => {
                const without = current.filter((item) => item.id !== incoming.id);
                return [incoming, ...without];
              });
            }
            // Firestore assignment also sets currentOrderId; this wakes the alert path immediately.
            setFeedback({
              tone: 'info',
              message: 'Oda mpya ya mizigo — thibitisha sasa.',
            });
          }
          if (event.type === 'offer_cleared' && event.orderId) {
            pendingCargoOffersRef.current.delete(event.orderId);
            const clearedId = event.orderId;
            setDriverOrders((current) => current.filter((item) => item.id !== clearedId));
          }
          if (event.type === 'cancelled' && event.orderId && event.by !== 'driver') {
            pendingCargoOffersRef.current.delete(event.orderId);
            const cancelledId = event.orderId;
            setDriverOrders((current) => current.filter((item) => item.id !== cancelledId));
            if (lastCancelledOrderIdRef.current !== event.orderId) {
              lastCancelledOrderIdRef.current = event.orderId;
              setOrderCancelledVisible(true);
              setInAppNavMode(false);
              setTripChatOpen(false);
              setSelectedTab('home');
            }
          }
        },
      });
      cargoOfferSocketRef.current = client;
    } catch {
      // WS URL may be unset in production builds until hosted; Firestore path still works for assigned orders.
      cargoOfferSocketRef.current = null;
    }

    return () => {
      client?.close();
      if (cargoOfferSocketRef.current === client) {
        cargoOfferSocketRef.current = null;
      }
    };
  }, [authUser?.uid, driverProfile?.isAvailable]);

  useEffect(() => {
    const currentOrderId = driverProfile?.currentOrderId?.trim();
    if (!authUser?.uid || !currentOrderId) {
      return;
    }

    const unsubscribeCurrentOrder = subscribeToDeliveryOrder(
      currentOrderId,
      (order) => {
        if (!order || order.driverId !== authUser.uid) {
          return;
        }

        if (
          order.status === 'cancelled' &&
          order.cancelledBy !== 'driver' &&
          lastCancelledOrderIdRef.current !== order.id
        ) {
          lastCancelledOrderIdRef.current = order.id;
          setOrderCancelledVisible(true);
          setInAppNavMode(false);
        }

        pendingCargoOffersRef.current.delete(order.id);
        setDriverOrders((currentOrders) => {
          const withoutCurrent = currentOrders.filter((item) => item.id !== order.id);
          return [order, ...withoutCurrent];
        });
        setDriverOrdersLoading(false);
      },
      (error) => {
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not sync the assigned order right now.')
              : 'Could not sync the assigned order right now.',
        });
      }
    );

    return unsubscribeCurrentOrder;
  }, [authUser?.uid, driverProfile?.currentOrderId]);

  useEffect(() => {
    if (isCompleteDriverProfile(driverProfile)) {
      setRegistrationSubmitted(false);
    }
  }, [driverProfile]);

  useEffect(() => {
    if (!authUser || !driverProfileMissing) {
      return;
    }

    setProfileSetup((current) => ({
      ...current,
      fullName:
        current.fullName ||
        (!isPlaceholderDriverName(driverProfile?.fullName) ? driverProfile?.fullName?.trim() : '') ||
        authUser.displayName?.trim() ||
        '',
      phoneNumber: current.phoneNumber || driverProfile?.phoneNumber || otpPhoneRef.current || authUser.phoneNumber || '',
      vehicleType: toPilotVehicleType(driverProfile?.vehicleType || current.vehicleType),
      vehicleLabel: getVehicleTypeLabel(driverProfile?.vehicleType || current.vehicleType),
      vehicleColor: current.vehicleColor || driverProfile?.vehicleColor || '',
      plateNumber: current.plateNumber || driverProfile?.plateNumber || '',
    }));
  }, [authUser, driverProfile, driverProfileMissing]);

  useEffect(() => {
    const detected = detectPaymentNetworkFromPhone(paymentPhoneNumber || driverProfile?.phoneNumber);
    if (detected) {
      setSelectedPaymentNetwork(detected);
    }
  }, [paymentPhoneNumber, driverProfile?.phoneNumber]);

  useEffect(() => {
    if (!authUser?.uid || !activeOrder?.id || driverProfile?.currentOrderId === activeOrder.id) {
      return;
    }
    if (activeOrder.driverId !== authUser.uid || !isActiveOrderStatus(activeOrder.status) || isIncomingOffer(activeOrder)) {
      return;
    }

    updateDoc(doc(db, 'drivers', authUser.uid), {
      currentOrderId: activeOrder.id,
      isAvailable: false,
      updatedAt: serverTimestamp(),
    }).catch(() => null);
  }, [activeOrder, authUser?.uid, driverProfile?.currentOrderId]);

  useEffect(() => {
    let cancelled = false;

    if (!activeOrder) {
      setActiveRoadRoute([]);
      setInAppNavMode(false);
      return;
    }

    const pickup = getOrderPickupPoint(activeOrder);
    const dropoff = getDriverVisibleDropoffPoint(activeOrder);
    const driverPoint = getPointFromCoordinates(driverProfile?.currentLatitude, driverProfile?.currentLongitude);

    const origin =
      activeOrder.status === 'driver_assigned' || activeOrder.status === 'driver_at_pickup'
        ? driverPoint ?? pickup
        : pickup;
    const destination =
      activeOrder.status === 'driver_assigned' || activeOrder.status === 'driver_at_pickup'
        ? pickup
        : dropoff;

    if (!origin || !destination) {
      setActiveRoadRoute([]);
      return;
    }

    setActiveRoadRoute([origin, destination]);
    void fetchRoadFollowingCoordinates(origin, destination).then((coordinates) => {
      if (!cancelled && coordinates.length > 1) {
        setActiveRoadRoute(coordinates);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeOrder?.id,
    activeOrder?.status,
    activeOrder?.pickupLatitude,
    activeOrder?.pickupLongitude,
    activeOrder?.dropoffLatitude,
    activeOrder?.dropoffLongitude,
    driverProfile?.currentLatitude,
    driverProfile?.currentLongitude,
  ]);

  useEffect(() => {
    if (!activeOrder?.id) {
      setTripMessages([]);
      setTripMessagesLoading(false);
      setTripMessageDraft('');
      setTripChatOpen(false);
      knownTripMessageIdsRef.current = new Set();
      tripMessagesHydratedRef.current = false;
      return;
    }

    setTripMessagesLoading(true);
    knownTripMessageIdsRef.current = new Set();
    tripMessagesHydratedRef.current = false;

    const unsubscribe = subscribeToOrderMessages(
      activeOrder.id,
      (nextMessages) => {
        setTripMessages(nextMessages);
        setTripMessagesLoading(false);

        if (!tripMessagesHydratedRef.current) {
          knownTripMessageIdsRef.current = new Set(nextMessages.map((item) => item.id));
          tripMessagesHydratedRef.current = true;
          return;
        }

        const freshCustomerMessages = nextMessages.filter(
          (item) => !knownTripMessageIdsRef.current.has(item.id) && item.senderRole === 'customer'
        );

        nextMessages.forEach((item) => {
          knownTripMessageIdsRef.current.add(item.id);
        });

        const latestCustomerMessage = freshCustomerMessages[freshCustomerMessages.length - 1];
        if (latestCustomerMessage) {
          setFeedback({
            tone: 'info',
            message: `${copy.notifNewMessageBanner}: ${latestCustomerMessage.message}`,
          });
        }
      },
      (error) => {
        setTripMessagesLoading(false);
        setFeedback({
          tone: 'error',
          message:
            error instanceof FirebaseError
              ? getFirebaseDataErrorMessage(error.code, 'Could not sync trip messages right now.')
              : 'Could not sync trip messages right now.',
        });
      }
    );

    return unsubscribe;
  }, [activeOrder?.id]);

  useEffect(() => {
    if (!authUser?.uid || !hasReadyDriverProfile) {
      return;
    }

    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    const pushLocation = async (coords: Location.LocationObjectCoords) => {
      const heading = typeof coords.heading === 'number' && coords.heading >= 0 ? coords.heading : undefined;
      const speedKph = typeof coords.speed === 'number' && coords.speed >= 0 ? coords.speed * 3.6 : undefined;
      const accuracyMeters = typeof coords.accuracy === 'number' ? coords.accuracy : undefined;

      await updateDriverLocation(authUser.uid, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        heading,
        speedKph,
        accuracyMeters,
      });

      if (!active) {
        return;
      }

      setLiveMapPoint({ latitude: coords.latitude, longitude: coords.longitude });

      setLocationLabel(
        `Live location synced ${new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })}`
      );
    };

    const startLocationSync = async () => {
      setLocationPermission('requesting');

      try {
        const servicesEnabled = await ensureLocationServicesEnabled();
        if (!servicesEnabled) {
          setLocationPermission('denied');
          setLocationLabel(copy.locationServicesOff || 'Turn on location services on this phone to continue.');
          return;
        }

        const permission = await requestDriveLocationPermissions();

        if (!active) {
          return;
        }

        if (!permission.granted) {
          await recordDriverAppOpen({
            uid: authUser.uid,
            email: authUser.email?.trim().toLowerCase(),
            fullName: driverProfile?.fullName || authUser.displayName?.trim() || 'HAUL Pilots',
            phoneNumber: driverProfile?.phoneNumber || '',
          });
          setLocationPermission('denied');
          setLocationLabel(copy.locationPermissionRequired || 'Location permission is required for live driver tracking.');
          return;
        }

        setLocationPermission('granted');

        const current = await readDeviceLocation();

        await recordDriverAppOpen({
          uid: authUser.uid,
          email: authUser.email?.trim().toLowerCase(),
          fullName: driverProfile?.fullName || authUser.displayName?.trim() || 'HAUL Pilots',
          phoneNumber: driverProfile?.phoneNumber || '',
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
        await pushLocation(current.coords);

        subscription = await Location.watchPositionAsync(getLocationWatchOptions(), (nextLocation) => {
          void pushLocation(nextLocation.coords).catch(() => null);
        });
      } catch {
        if (!active) {
          return;
        }

        setLocationPermission('denied');
        setLocationLabel('Live location could not be started right now.');
      }
    };

    void startLocationSync();

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    copy.locationPermissionRequired,
    copy.locationServicesOff,
    driverProfile?.fullName,
    driverProfile?.phoneNumber,
    hasReadyDriverProfile,
  ]);

  useEffect(() => {
    const point = resolveDriverMapPoint(driverProfile, liveMapPoint);
    if (!point || !homeMapRef.current?.animateToRegion) {
      return;
    }

    homeMapRef.current.animateToRegion(buildMapRegion(point), 650);
  }, [driverProfile?.currentLatitude, driverProfile?.currentLongitude, liveMapPoint?.latitude, liveMapPoint?.longitude]);

  // ──────────────────────────────────────────────
  // NEW: Online session timer
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!hasReadyDriverProfile || !driverProfile?.isAvailable || !authUser?.uid) {
      if (onlineSessionTimer) {
        clearInterval(onlineSessionTimer);
        setOnlineSessionTimer(null);
        if (sessionAccumulatorRef.current > 0 && authUser?.uid) {
          const secondsToAdd = sessionAccumulatorRef.current;
          updateDoc(doc(db, 'drivers', authUser.uid), {
            totalOnlineHours: increment(secondsToAdd / 3600),
            onlineSessionStart: null,
          }).catch(() => {});
          sessionAccumulatorRef.current = 0;
        }
      }
      return;
    }

    if (!onlineSessionTimer) {
      const timer = setInterval(() => {
        sessionAccumulatorRef.current += 10;
        // flush every minute
        if (sessionAccumulatorRef.current % 60 === 0) {
          const secondsToAdd = sessionAccumulatorRef.current;
          updateDoc(doc(db, 'drivers', authUser.uid), {
            totalOnlineHours: increment(secondsToAdd / 3600),
            onlineSessionStart: serverTimestamp(),
          }).catch(() => {});
          sessionAccumulatorRef.current = 0;
        }
      }, 10000);
      setOnlineSessionTimer(timer);
    }

    return () => {
      if (onlineSessionTimer) {
        clearInterval(onlineSessionTimer);
      }
    };
  }, [driverProfile?.isAvailable, authUser?.uid, hasReadyDriverProfile]);

  useEffect(() => {
    if (!hasReadyDriverProfile || !nearbyQueryKey) {
      setNearbyCustomers([]);
      return;
    }

    const [latitudeText, longitudeText] = nearbyQueryKey.split(',');
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setNearbyCustomers([]);
      return;
    }

    const point = { latitude, longitude };
    let cancelled = false;
    // Shared map so API + Firestore results merge, not overwrite each other
    const merged = new Map<string, NearbyCustomer>();

    const applyBatch = (next: NearbyCustomer[]) => {
      if (cancelled) {
        return;
      }
      for (const customer of next) {
        if (customer.id !== authUser?.uid) {
          merged.set(customer.id, customer);
        }
      }
      setNearbyCustomers([...merged.values()]);
    };

    const loadFromApi = () => {
      void fetchNearbyOnlineCustomers(point)
        .then(applyBatch)
        .catch(() => undefined);
    };

    loadFromApi();
    const timer = setInterval(loadFromApi, 15_000);
    const unsubscribe = subscribeToNearbyOnlineCustomers(point, applyBatch, () => undefined);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [authUser?.uid, hasReadyDriverProfile, nearbyQueryKey]);

  useEffect(() => {
    if (!activeOrder) {
      setActiveOrderContactPhone('');
      return;
    }

    const directPhone = resolveOrderContactPhone(activeOrder);
    if (directPhone) {
      setActiveOrderContactPhone(directPhone);
      return;
    }

    let cancelled = false;
    void fetchCustomerPhoneForOrder(activeOrder).then((phone) => {
      if (!cancelled) {
        setActiveOrderContactPhone(phone);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeOrder]);

  // ──────────────────────────────────────────────
  // NEW: Total earnings from delivered orders
  // ──────────────────────────────────────────────
  useEffect(() => {
    const deliveredTotal = driverOrders
      .filter(order => order.status === 'delivered')
      .reduce((sum, order) => sum + parseAmountFromLabel(order.totalLabel), 0);
    setTotalEarnings(deliveredTotal);
  }, [driverOrders]);

  /** Agents-style streak standing (mfululizo), surfaced in Bolt Rewards UI. */
  const pilotStandingState = useMemo(() => {
    const completed =
      Number(driverProfile?.completedOrderCount) ||
      driverOrders.filter((order) => order.status === 'delivered').length;
    const rejects = Math.max(
      0,
      Number((driverProfile as { rejectionCount?: number } | null)?.rejectionCount) || 0
    );
    const streak = Math.max(
      0,
      Number((driverProfile as { completionStreak?: number } | null)?.completionStreak) || completed
    );
    return pilotStanding({ streak, completed, rejects });
  }, [driverOrders, driverProfile]);

  // ──────────────────────────────────────────────
  // Keep access payment status in sync with the backend.
  // ──────────────────────────────────────────────
  useEffect(() => {
    setPaymentAmount(dailyCommissionDue);
    setShowPaymentNotice(hasCommissionDue);
  }, [dailyCommissionDue, hasCommissionDue]);

  useEffect(() => {
    if (!hasCommissionDue) {
      setPaymentCheckoutStep('debt');
      return;
    }

    if (commissionPaidForDate) {
      setPaymentCheckoutStep('submitted');
    }
  }, [commissionPaidForDate, hasCommissionDue]);

  // ──────────────────────────────────────────────
  // Original handlers (unchanged)
  // ──────────────────────────────────────────────

  const handleSignIn = async () => {
    const normalizedEmail = loginEmail.trim().toLowerCase();

    if (signingIn) {
      return;
    }

    if (!/\S+@\S+\.\S+/.test(normalizedEmail) || loginPassword.trim().length < 6) {
      setFeedback({ tone: 'error', message: copy.authMissingLogin });
      return;
    }

    setSigningIn(true);
    setFeedback(null);

    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, loginPassword);
      setFeedback({ tone: 'success', message: 'Signed in to HAUL Pilots.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseAuthErrorMessage(error.code)
            : 'Unable to sign in right now. Please try again.',
      });
    } finally {
      setSigningIn(false);
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = registerForm.email.trim().toLowerCase();
    const fullName = getRegisterFullName(registerForm);
    const vehicleLabel = getRegisterVehicleLabel(registerForm);
    const password = registerForm.password.trim();
    const confirm = registerForm.confirmPassword.trim();
    const vehicleColor = registerForm.vehicleColor.trim() || 'White';

    if (!confirm || confirm !== password) {
      setFeedback({ tone: 'error', message: copy.authPasswordMismatch });
      return;
    }

    if (
      registering ||
      fullName.length < 2 ||
      !/\S+@\S+\.\S+/.test(normalizedEmail) ||
      !normalizedRegisterPhone ||
      password.length < 6 ||
      !vehicleLabel ||
      !registerForm.plateNumber.trim() ||
      !registerTermsAccepted
    ) {
      setFeedback({
        tone: 'error',
        message: !registerTermsAccepted ? copy.authTermsRequired : copy.authMissingRegister,
      });
      return;
    }

    setRegistering(true);
    setFeedback(null);

    try {
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, registerForm.password.trim());

      await updateProfile(credential.user, {
        displayName: fullName,
      });

      const pilotVehicleType = toPilotVehicleType(registerForm.vehicleType);
      const pilotVehicleLabel = getVehicleTypeLabel(pilotVehicleType);

      await registerDriver({
        uid: credential.user.uid,
        email: normalizedEmail,
        fullName,
        phoneNumber: normalizedRegisterPhone,
        vehicleType: pilotVehicleType,
        vehicleLabel: pilotVehicleLabel,
        vehicleColor,
        plateNumber: registerForm.plateNumber.trim(),
        verificationStatus: 'pending_admin_verification',
        acceptedTerms: true,
        acceptedTermsVersion: DOORDRIVE_TERMS_VERSION,
      });

      setRegisterForm(getInitialRegisterForm());
      setRegisterTermsAccepted(false);
      setRegisterStep('details');
      setRegistrationSubmitted(true);
      setFeedback({ tone: 'success', message: 'Account imetumwa kwa admin. Utaweza kupokea orders baada ya verification.' });
      void recordDriverActivity({
        driverId: credential.user.uid,
        driverName: fullName,
        eventName: 'driver_registered',
        featureKey: 'driver_onboarding',
        featureLabel: 'Driver onboarding',
        screen: 'register',
        route: 'doordrive',
        metadata: {
          vehicleType: pilotVehicleType,
          vehicleLabel: pilotVehicleLabel,
          verificationStatus: 'pending_admin_verification',
        },
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? error.code.startsWith('auth/')
              ? getFirebaseAuthErrorMessage(error.code)
              : getFirebaseDataErrorMessage(error.code, 'Account haikuweza kufika admin. Jaribu tena.')
            : error instanceof Error
              ? error.message
              : 'Unable to register the driver account right now.',
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleCompleteProfile = async () => {
    const pilotVehicleType = toPilotVehicleType(profileSetup.vehicleType);
    const vehicleLabel = getVehicleTypeLabel(pilotVehicleType);

    if (!authUser || !normalizedSetupPhone || !profileSetup.fullName.trim() || !vehicleLabel || !profileSetup.plateNumber.trim()) {
      setFeedback({ tone: 'error', message: 'Finish the driver profile before continuing.' });
      return;
    }

    setBusyAction('complete-profile');
    setFeedback(null);

    try {
      await registerDriver({
        uid: authUser.uid,
        email: authUser.email?.trim().toLowerCase(),
        fullName: profileSetup.fullName.trim(),
        phoneNumber: normalizedSetupPhone,
        vehicleType: pilotVehicleType,
        vehicleLabel,
        vehicleColor: profileSetup.vehicleColor.trim() || 'White',
        plateNumber: profileSetup.plateNumber.trim(),
        verificationStatus: 'pending_admin_verification',
      });

      setFeedback({ tone: 'success', message: 'Profile imetumwa kwa admin kwa verification.' });
      setRegistrationSubmitted(true);
      trackDriverActivity('driver_profile_completed', 'driver_onboarding', {
        vehicleType: profileSetup.vehicleType,
        verificationStatus: 'pending_admin_verification',
      });
    } catch (error) {
      console.warn('Driver profile submit failed', error);
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Profile haikuweza kufika admin sasa hivi. Jaribu tena.')
            : error instanceof Error
              ? error.message
              : 'Profile haikuweza kufika admin sasa hivi. Jaribu tena.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const openExternalMapsToPoint = async (
    point: { latitude: number; longitude: number } | null | undefined,
    meta?: { orderId?: string; orderNumber?: string; target?: string; status?: string }
  ) => {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      return;
    }

    const destination = `${point.latitude},${point.longitude}`;
    const nativeUrl = `google.navigation:q=${destination}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

    try {
      if (Platform.OS === 'android') {
        try {
          await Linking.openURL(nativeUrl);
        } catch {
          await Linking.openURL(webUrl);
        }
      } else {
        await Linking.openURL(webUrl);
      }
      trackDriverActivity('driver_external_navigation', 'driver_navigation', {
        orderId: meta?.orderId,
        orderNumber: meta?.orderNumber,
        targetStatus: meta?.status,
        target: meta?.target,
        provider: 'google_maps',
      });
    } catch {
      // Stay in HAUL Pilots — never treat maps failure as trip failure.
    }
  };

  const handleAdvanceTrip = async (
    nextStatus: DeliveryOrderStatus,
    options?: { cancellationReason?: string; openMapsAfter?: boolean }
  ) => {
    if (!authUser || !activeOrder || busyAction) {
      return;
    }

    // Completing or cancelling must never finish the Android activity / reload the JS bundle.
    setBusyAction(`trip-${nextStatus}`);
    setFeedback(null);

    const mapsPointBefore =
      nextStatus === 'driver_at_pickup'
        ? getOrderPickupPoint(activeOrder)
        : nextStatus === 'in_transit'
          ? getDriverVisibleDropoffPoint(activeOrder)
          : null;
    const mapsTarget =
      nextStatus === 'driver_at_pickup' ? 'pickup' : nextStatus === 'in_transit' ? 'dropoff' : undefined;
    const shouldOpenMaps =
      Boolean(options?.openMapsAfter) &&
      nextStatus !== 'delivered' &&
      nextStatus !== 'cancelled' &&
      Boolean(mapsPointBefore);

    try {
      await updateDriverOrderStatus(authUser.uid, activeOrder.id, nextStatus, {
        cancellationReason: options?.cancellationReason,
      });
      const localStatusTime = new Date();
      const cancelReason =
        nextStatus === 'cancelled'
          ? String(options?.cancellationReason || '').trim() || 'Driver cancelled the trip'
          : '';
      setDriverOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === activeOrder.id
            ? {
                ...order,
                status: nextStatus,
                deliveredAt: nextStatus === 'delivered' ? localStatusTime : order.deliveredAt,
                cancelledAt: nextStatus === 'cancelled' ? localStatusTime : order.cancelledAt,
                cancelledBy: nextStatus === 'cancelled' ? 'driver' : order.cancelledBy,
                cancellationReason: nextStatus === 'cancelled' ? cancelReason : order.cancellationReason,
                driverSearchMessage:
                  nextStatus === 'cancelled' ? `Dereva ameghairi oda hii: ${cancelReason}` : order.driverSearchMessage,
                updatedAt: localStatusTime,
              }
            : order
        )
      );
      if (nextStatus === 'delivered' || nextStatus === 'cancelled') {
        setDriverProfile((currentProfile) =>
          currentProfile
            ? {
                ...currentProfile,
                currentOrderId: '',
                isAvailable: true,
                lastActiveAt: localStatusTime,
                updatedAt: localStatusTime,
              }
            : currentProfile
        );
      }
      trackDriverActivity('driver_trip_status_updated', 'driver_trip', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        previousStatus: activeOrder.status,
        nextStatus,
        serviceLabel: activeOrder.serviceLabel,
        cancellationReason: nextStatus === 'cancelled' ? cancelReason : undefined,
      });
      setFeedback({
        tone: 'success',
        message:
          nextStatus === 'delivered'
            ? language === 'sw'
              ? 'Delivery imekamilika. Kakaa kwenye HAUL Pilots — rate mteja kwenye Historia.'
              : 'Delivery completed. Stay in HAUL Pilots — rate the customer from History.'
            : nextStatus === 'cancelled'
              ? language === 'sw'
                ? 'Safari imeghairiwa. App inaendelea — mteja ataona sababu.'
                : 'Trip cancelled. You stay in the app — the customer will see the reason.'
            : `Trip updated to ${getDeliveryOrderStatusLabel(nextStatus).toLowerCase()}.`,
      });
      if (nextStatus === 'cancelled') {
        setCancelReasonOpen(false);
        setInAppNavMode(false);
        setTripChatOpen(false);
        setSelectedTab('home');
        const token = await auth.currentUser?.getIdToken().catch(() => '');
        if (token) {
          cargoOfferSocketRef.current?.send({
            type: 'driver_cancel',
            orderId: activeOrder.id,
            driverId: authUser.uid,
            token,
            reason: cancelReason,
          });
        }
      }
      if (nextStatus === 'delivered') {
        // Keep the app open: history hosts the customer rating sheet.
        setInAppNavMode(false);
        setTripChatOpen(false);
        setSelectedTab('history');
      }
      if (shouldOpenMaps && mapsPointBefore) {
        // Fire after status write so a maps handoff cannot interrupt completion/cancel.
        void openExternalMapsToPoint(mapsPointBefore, {
          orderId: activeOrder.id,
          orderNumber: activeOrder.orderNumber,
          target: mapsTarget,
          status: nextStatus,
        });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not update the trip status right now.')
            : error instanceof Error
              ? error.message
              : 'Could not update the trip status right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleTripPrimaryAdvance = (nextStatus: DeliveryOrderStatus) => {
    // Yellow status CTA advances the trip and opens Maps to the next leg (not on complete).
    void handleAdvanceTrip(nextStatus, { openMapsAfter: nextStatus !== 'delivered' });
  };

  const handleToggleAvailability = async () => {
    if (!authUser || !driverProfile || activeOrder || busyAction) {
      return;
    }

    if (!driverCanReceiveDispatch) {
      setFeedback({
        tone: 'error',
        message          : driverVerificationRejected
            ? 'Verification yako inahitaji kurekebishwa kabla ya kupokea orders.'
            : 'Account yako bado inasubiri admin verification.',
      });
      return;
    }

    setBusyAction('availability');
    setFeedback(null);

    try {
      await setDriverAvailability(authUser.uid, !driverProfile.isAvailable);
      void driveHapticSuccess();
      trackDriverActivity('driver_availability_changed', 'driver_availability', {
        nextAvailability: !driverProfile.isAvailable,
        hasCommissionDue,
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not update availability right now.')
            : error instanceof Error
              ? error.message
              : 'Could not update availability right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleManualLocationRefresh = async () => {
    if (!authUser || !driverProfile || busyAction) {
      return;
    }

    setBusyAction('location-refresh');
    setFeedback(null);

    try {
      const permission = await requestDriveLocationPermissions();
      if (!permission.granted) {
        setLocationPermission('denied');
        setLocationLabel(copy.locationPermissionRequired || 'Location permission is still denied.');
        trackDriverActivity('driver_location_permission_denied', 'driver_location', {
          source: 'manual_refresh',
        });
        return;
      }

      const servicesEnabled = await ensureLocationServicesEnabled();
      if (!servicesEnabled) {
        setFeedback({ tone: 'error', message: copy.locationServicesOff || 'Turn on location services on this phone.' });
        return;
      }

      setLocationPermission('granted');
      const current = await readDeviceLocation();
      await updateDriverLocation(authUser.uid, {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        heading:
          typeof current.coords.heading === 'number' && current.coords.heading >= 0
            ? current.coords.heading
            : undefined,
        speedKph:
          typeof current.coords.speed === 'number' && current.coords.speed >= 0
            ? current.coords.speed * 3.6
            : undefined,
        accuracyMeters: current.coords.accuracy ?? undefined,
      });
      setLocationLabel(
        `Location refreshed ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
      );
      trackDriverActivity('driver_location_refreshed', 'driver_location', {
        source: 'manual_refresh',
        hasPermission: true,
        accuracyMeters: current.coords.accuracy ?? undefined,
      });
    } catch {
      setFeedback({ tone: 'error', message: 'Could not refresh live location right now.' });
    } finally {
      setBusyAction('');
    }
  };

  const handleCallCustomer = async () => {
    const phone = activeOrderContactPhone || resolveOrderContactPhone(activeOrder);
    if (!phone) {
      setFeedback({ tone: 'info', message: copy.customerPhoneMissing || 'Customer phone number is not available for this order yet.' });
      return;
    }

    const dialable = readablePhone(phone);
    if (!dialable) {
      setFeedback({ tone: 'info', message: copy.customerPhoneMissing || 'Customer phone number is not available for this order yet.' });
      return;
    }

    try {
      await openPhoneDialer(dialable);
    } catch {
      Alert.alert(copy.callUnavailable || 'Call unavailable', dialable);
    }
  };

  const handleNavigateToDemandHotspot = async () => {
    if (!topDemandZone) {
      return;
    }

    const destination = `${topDemandZone.latitude},${topDemandZone.longitude}`;
    const nativeUrl = `google.navigation:q=${destination}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

    try {
      const supported = await Linking.canOpenURL(nativeUrl);
      await Linking.openURL(supported ? nativeUrl : webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  };

  const handleSendCustomerMessage = async () => {
    if (!authUser?.uid || !activeOrder || tripMessageSending) {
      return;
    }

    const trimmedMessage = tripMessageDraft.trim();
    if (!trimmedMessage) {
      return;
    }

    setTripMessageSending(true);
    setFeedback(null);

    try {
      await sendOrderMessage({
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        customerId: activeOrder.userId,
        driverId: authUser.uid,
        senderId: authUser.uid,
        senderRole: 'driver',
        senderName:
          driverProfile?.fullName?.trim() || authUser.displayName?.trim() || activeOrder.driverName || 'HAUL Pilots',
        message: trimmedMessage,
      });
      setTripMessageDraft('');
      trackDriverActivity('driver_message_sent', 'driver_chat', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        messageLength: trimmedMessage.length,
      });
      setFeedback({ tone: 'success', message: 'Message sent to the customer.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not send the customer message right now.')
            : error instanceof Error
              ? error.message
              : 'Could not send the customer message right now.',
      });
    } finally {
      setTripMessageSending(false);
    }
  };

  const closeLeadMessageSheet = () => {
    setSelectedNearbyCustomer(null);
  };

  const handleSendLeadMessage = async (preset?: string) => {
    if (!authUser?.uid || !selectedNearbyCustomer || leadMessageSending) {
      return;
    }

    const trimmedMessage = String(preset || '').trim();
    if (!trimmedMessage) {
      setFeedback({ tone: 'info', message: 'Chagua template kutuma ujumbe.' });
      return;
    }

    setLeadMessageSending(true);
    setFeedback(null);

    try {
      await sendDirectCustomerMessage({
        driverId: authUser.uid,
        driverName: driverProfile?.fullName?.trim() || authUser.displayName?.trim() || 'HAUL Pilots',
        driverVehicleType: driverProfile?.vehicleType,
        customerId: selectedNearbyCustomer.id,
        customerName: selectedNearbyCustomer.firstName,
        message: trimmedMessage,
      });
      trackDriverActivity('driver_lead_message_sent', 'nearby_customers', {
        customerId: selectedNearbyCustomer.id,
        messageLength: trimmedMessage.length,
      });
      setFeedback({ tone: 'success', message: copy.leadMessageSent });
      closeLeadMessageSheet();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, copy.leadMessagePlaceholder)
            : error instanceof Error
              ? error.message
              : copy.leadMessagePlaceholder,
      });
    } finally {
      setLeadMessageSending(false);
    }
  };

  /** Turn-by-turn opens the Google Maps app. The HAUL map stays on screen. */
  const handleOpenNavigation = async () => {
    if (!activeOrder) {
      return;
    }

    if (activeOrder.status === 'delivered' || activeOrder.status === 'cancelled') {
      return;
    }

    const target = getDriverNavigationTarget(activeOrder);
    const targetLabel = target.label.trim();

    if (!target.point) {
      setFeedback({
        tone: 'info',
        message: `Coordinates for ${targetLabel || target.kind} are not confirmed yet. Call dispatch or the customer before moving.`,
      });
      return;
    }

    await openExternalMapsToPoint(target.point, {
      orderId: activeOrder.id,
      orderNumber: activeOrder.orderNumber,
      target: target.kind,
      status: activeOrder.status,
    });
  };

  const handleSignOut = async () => {
    if (busyAction) {
      return;
    }

    setBusyAction('sign-out');

    try {
      await signOut(auth);
      setSelectedTab('home');
      setFeedback({ tone: 'info', message: 'Signed out from HAUL Pilots.' });
    } catch {
      setFeedback({ tone: 'error', message: 'Could not sign out right now.' });
    } finally {
      setBusyAction('');
    }
  };

  // ──────────────────────────────────────────────
  // Driver access, order rejection, and customer rating handlers
  // ──────────────────────────────────────────────
  const handleStartPaymentCheckout = () => {
    if (!hasCommissionDue) {
      setFeedback({
        tone: 'info',
        message: 'Hakuna deni la komisheni. Unaendelea kupokea oda.',
      });
      return;
    }

    if (commissionPaymentPending) {
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'info', message: 'Malipo yako yapo pending. Approve USSD kwenye simu yako kisha refresh status.' });
      return;
    }

    setFeedback(null);
    setPaymentPhoneNumber((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
    setPaymentCheckoutStep('proof');
  };

  const handleInitiateMongikePayment = async (forceRetry = false) => {
    if (!authUser?.uid || busyAction === 'commission-payment' || ussdInitiateLockRef.current) {
      return;
    }

    if (!hasCommissionDue || !dailyCommissionDue) {
      setFeedback({
        tone: 'info',
        message: 'Hakuna deni la komisheni kwa sasa.',
      });
      return;
    }

    if (commissionPaymentPending && !forceRetry) {
      setPaymentCheckoutStep('submitted');
      setFeedback({ tone: 'info', message: 'Malipo yako yapo pending. Angalia prompt ya PIN kwenye simu yako.' });
      return;
    }

    if (selectedNetworkMeta && selectedNetworkMeta.enabled === false) {
      setFeedback({ tone: 'info', message: 'Chagua M-Pesa, Mixx by Yas, au Airtel Money.' });
      return;
    }

    // Normalize to 255XXXXXXXXX (same gate as transporters portal / backend).
    const e164 = normalizePhoneNumber(paymentPhoneNumber || driverProfile?.phoneNumber || '');
    const normalizedPaymentPhone = e164.replace(/^\+/, '');
    if (!normalizedPaymentPhone || !/^255[67]\d{8}$/.test(normalizedPaymentPhone)) {
      setFeedback({ tone: 'error', message: 'Weka namba sahihi ya simu (+255).' });
      return;
    }

    // Instant button feedback — never leave the tap looking idle.
    ussdInitiateLockRef.current = true;
    setBusyAction('commission-payment');
    setFeedback({ tone: 'info', message: 'Inaanzisha USSD…' });

    let didSendUssd = false;
    try {
      const status = await initiateDriverCommissionUssd({
        phoneNumber: normalizedPaymentPhone,
        network: selectedPaymentNetwork,
        amount: dailyCommissionDue,
      });
      const reference = String(status.reference || status.trivapesaReference || '').trim();
      // Same gate as portal: only claim sent with pushed===true && reference.
      const confirmedPush = status.pushed === true && Boolean(reference) && status.status !== 'creating';
      didSendUssd = confirmedPush && !status.duplicate;

      if (confirmedPush) {
        trackDriverActivity('driver_commission_payment_submitted', 'driver_payments', {
          dateKey: commissionDateKey,
          grossAmount: dailyGrossEarnings,
          commissionAmount: dailyCommissionDue,
          method: 'trivapesa_ussd',
          network: selectedPaymentNetwork,
          orderId: status.orderId || '',
          reference,
        });
        setPaymentCheckoutStep('submitted');
        setFeedback({
          tone: 'success',
          message: status.message || 'Angalia simu — USSD push imetumwa',
        });
      } else if (status.status === 'failed') {
        setFeedback({
          tone: 'error',
          message: status.message || status.error || 'Haijatumwa — jaribu tena',
        });
      } else {
        // Creating / no reference — never invent "imetumwa".
        setPaymentCheckoutStep(status.orderId ? 'submitted' : paymentCheckoutStep);
        setFeedback({
          tone: 'info',
          message: status.message || 'Inaanzisha USSD… Subiri kidogo kisha jaribu tena kama prompt haionekani.',
        });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Haijatumwa — jaribu tena')
            : getPaymentFeedbackMessage(error, copy, 'Haijatumwa — jaribu tena'),
      });
    } finally {
      setBusyAction('');
      if (!didSendUssd) {
        ussdInitiateLockRef.current = false;
      } else {
        setTimeout(() => {
          ussdInitiateLockRef.current = false;
        }, 20000);
      }
    }
  };

  const handleRefreshPaymentStatus = async () => {
    if (!authUser?.uid || paymentRefreshing) {
      return;
    }

    setPaymentRefreshing(true);
    setFeedback(null);

    try {
      const status = await verifyDriverCommissionUssd(driverProfile?.commissionPayment?.orderId);
      setFeedback({
        tone: status.settled || status.status === 'completed' || status.status === 'clear' ? 'success' : 'info',
        message: status.settled || status.status === 'completed' || status.status === 'clear'
          ? 'Malipo yamethibitishwa. Unaweza kuendelea kupokea oda.'
          : status.status === 'pending'
            ? status.message || 'Bado pending. Hakikisha ume-approve prompt ya mobile money.'
            : status.message || 'Payment haijakamilika bado.',
      });
      void fetchDriverCommissionStatus().catch(() => null);
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: getPaymentFeedbackMessage(error, copy, 'Could not verify the payment right now.'),
      });
    } finally {
      setPaymentRefreshing(false);
    }
  };

  const handleAcceptOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
      return;
    }

    setBusyAction('accept-order');
    setFeedback(null);

    try {
      const amount = Math.max(
        activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 0,
        activeOrder.customerOffer ?? 0
      );
      const instantVerify = String(activeOrder.assignmentMode || '') === 'cargo_ws';
      if (
        !instantVerify &&
        activeOrder.fareType === 'negotiated' &&
        (!activeOrder.driverId || activeOrder.status === 'pending_assignment')
      ) {
        await submitDriverFare(authUser.uid, activeOrder.id, amount || activeOrder.customerOffer || 0);
      }
      await acceptDriverOrder(authUser.uid, activeOrder.id);
      if (instantVerify) {
        const token = await auth.currentUser?.getIdToken().catch(() => '');
        if (token) {
          // Notify customer over the socket; server is idempotent if Firestore already accepted.
          cargoOfferSocketRef.current?.send({
            type: 'driver_accept',
            orderId: activeOrder.id,
            driverId: authUser.uid,
            token,
          });
        }
      }
      void driveHapticSuccess();
      trackDriverActivity('driver_order_accepted', 'driver_order_response', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        serviceLabel: activeOrder.serviceLabel,
        fareLabel: activeOrder.totalLabel || activeOrder.fareLabel,
      });
      setSelectedTab('home');
      setFeedback({ tone: 'success', message: copy.orderAccepted });
      // No separate Maps button after accept — open navigation to pickup immediately.
      void openExternalMapsToPoint(getOrderPickupPoint(activeOrder), {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        target: 'pickup',
        status: 'driver_assigned',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not accept the order right now.')
            : error instanceof Error
              ? error.message
              : 'Could not accept the order right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleDriverFarePrimary = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
      return;
    }
    if (activeOrder.fareType !== 'negotiated') {
      await handleAcceptOrder();
      return;
    }
    const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
    const draft = Math.max(minFare, driverFareDraft ?? activeOrder.customerOffer ?? minFare);
    const customerOffer = activeOrder.customerOffer ?? 0;
    if (cargoOffersMatch(customerOffer, draft)) {
      await handleAcceptOrder();
      return;
    }
    const used = Math.max(0, Math.round(Number(activeOrder.driverNegotiationUsed) || 0));
    const sameResend =
      activeOrder.lastOfferBy === 'driver' && cargoOffersMatch(activeOrder.driverOffer, draft);
    if (sameResend) {
      return;
    }
    if (used >= DRIVER_NEGOTIATION_CHANCES) {
      if (activeOrder.lastOfferBy === 'customer') {
        await handleAcceptOrder();
        return;
      }
      setFeedback({ tone: 'error', message: 'Nafasi za kujadili zimekwisha. Kubali bei ya mteja.' });
      return;
    }

    setBusyAction('counter-fare');
    setFeedback(null);
    try {
      await submitDriverFare(authUser.uid, activeOrder.id, draft, driverOfferNote);
      setDriverFareDraft(draft);
      setFeedback({ tone: 'success', message: 'Bei imetumwa kwa mteja.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not send this fare right now.')
            : error instanceof Error
              ? error.message
              : 'Could not send this fare right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  useEffect(() => {
    if (!autoConfirm || !activeOrder || busyAction) {
      return;
    }
    if (activeOrder.status !== 'driver_assigned' || activeOrder.acceptedByDriverAt) {
      return;
    }
    if (activeOrder.fareType === 'negotiated') {
      return;
    }
    if (autoAcceptedOrderIdRef.current === activeOrder.id) {
      return;
    }
    autoAcceptedOrderIdRef.current = activeOrder.id;
    void handleAcceptOrder();
  }, [activeOrder, autoConfirm, busyAction]);

  const performDeclineOrder = async () => {
    if (!authUser?.uid || !activeOrder || busyAction) {
      return;
    }

    setBusyAction('decline-order');
    setFeedback(null);

    try {
      const instantVerify = String(activeOrder.assignmentMode || '') === 'cargo_ws';
      if (instantVerify) {
        const token = await auth.currentUser?.getIdToken().catch(() => '');
        const sent =
          token &&
          cargoOfferSocketRef.current?.send({
            type: 'driver_decline',
            orderId: activeOrder.id,
            driverId: authUser.uid,
            reason: 'Rejected from driver app',
            token,
          });
        if (!sent) {
          await declineDriverOrder(authUser.uid, activeOrder.id, 'Rejected from driver app');
        }
      } else {
        await declineDriverOrder(authUser.uid, activeOrder.id, 'Rejected from driver app');
      }
      trackDriverActivity('driver_order_declined', 'driver_order_response', {
        orderId: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        serviceLabel: activeOrder.serviceLabel,
        reason: 'Rejected from driver app',
      });
      setSelectedTab('home');
      setFeedback({ tone: 'info', message: 'Order rejected and sent back to dispatch.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not reject the order right now.')
            : error instanceof Error
              ? error.message
              : 'Could not reject the order right now.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleDeclineOrder = () => {
    Alert.alert(copy.declineTitle, copy.declineBody, [
      { text: copy.declineKeep, style: 'cancel' },
      { text: copy.declineConfirm, style: 'destructive', onPress: () => void performDeclineOrder() },
    ]);
  };

  const handleCancelActiveTrip = () => {
    setCancelReasonOpen(true);
  };

  const handleConfirmCancelWithReason = (reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed) {
      return;
    }
    void handleAdvanceTrip('cancelled', { cancellationReason: trimmed });
  };

  const handleRateCustomer = async () => {
    if (!authUser?.uid || !pendingCustomerRatingOrder || customerRatingSaving) {
      return;
    }

    setCustomerRatingSaving(true);
    setFeedback(null);

    try {
      await rateDeliveryCustomer(authUser.uid, pendingCustomerRatingOrder.id, {
        rating: customerRatingScore,
        comment: customerRatingComment,
      });
      trackDriverActivity('driver_customer_rating_submitted', 'driver_customer_rating', {
        orderId: pendingCustomerRatingOrder.id,
        orderNumber: pendingCustomerRatingOrder.orderNumber,
        rating: customerRatingScore,
        hasComment: Boolean(customerRatingComment.trim()),
      });
      setCustomerRatingComment('');
      setCustomerRatingScore(5);
      setFeedback({ tone: 'success', message: 'Customer rating saved. Thank you.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebaseDataErrorMessage(error.code, 'Could not save the customer rating right now.')
            : error instanceof Error
              ? error.message
              : 'Could not save the customer rating right now.',
      });
    } finally {
      setCustomerRatingSaving(false);
    }
  };

  const handleRegisterBack = () => {
    setFeedback(null);
    if (authMode === 'phone' && phoneAuthStep === 'code') {
      setPhoneAuthStep('number');
      setPhoneAuthCode('');
      return;
    }
    if (authMode === 'register' && registerStep === 'details') {
      setRegisterStep('vehicle');
      return;
    }
    setRegisterStep('vehicle');
    setAuthMode(authMode === 'phone' ? 'phone' : 'signin');
  };

  const handlePasswordReset = async () => {
    const normalizedEmail = loginEmail.trim().toLowerCase();

    if (resettingPassword) {
      return;
    }

    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) {
      setFeedback({ tone: 'error', message: copy.authResetMissing });
      return;
    }

    setResettingPassword(true);
    setFeedback(null);

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setFeedback({ tone: 'success', message: copy.authResetSent });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof FirebaseError
            ? getFirebasePasswordResetErrorMessage(error.code)
            : copy.authResetMissing,
      });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleProfileSetupBack = () => {
    setFeedback(null);
    void handleSignOut();
  };

  // ──────────────────────────────────────────────
  // Auth screen
  // ──────────────────────────────────────────────

  const handleSendPhoneCode = async () => {
    const phone = normalizePhoneNumber(phoneAuthNumber);
    if (!phone) {
      setFeedback({ tone: 'error', message: copy.authPhoneMissing });
      return;
    }
    setPhoneAuthBusy(true);
    setFeedback(null);
    try {
      await sendDriverOtp(phone, 'signup');
      otpPhoneRef.current = phone;
      setPhoneAuthStep('code');
      setFeedback({ tone: 'success', message: copy.authPhoneSent });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : copy.authPhoneMissing,
      });
    } finally {
      setPhoneAuthBusy(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    const phone = normalizePhoneNumber(phoneAuthNumber) || otpPhoneRef.current;
    const code = phoneAuthCode.replace(/\D/g, '');
    if (!phone) {
      setFeedback({ tone: 'error', message: copy.authPhoneMissing });
      return;
    }
    if (code.length < 4) {
      setFeedback({ tone: 'error', message: copy.authPhoneCodeMissing });
      return;
    }
    setPhoneAuthBusy(true);
    setFeedback(null);
    try {
      const verified = await verifyDriverOtp(phone, code);
      const ticket = String(verified.otpTicket || '');
      if (!ticket) {
        throw new Error(copy.authPhoneCodeMissing);
      }
      const session = await loginDriverWithOtp(phone, ticket);
      const customToken = String(session.customToken || '');
      if (!customToken) {
        throw new Error('Phone sign-in did not return a session.');
      }
      otpPhoneRef.current = phone;
      await signInWithCustomToken(auth, customToken);
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : copy.authPhoneCodeMissing,
      });
    } finally {
      setPhoneAuthBusy(false);
    }
  };

  const renderAuthScreen = () => {
    const openRegister = () => {
      setFeedback(null);
      setPhoneAuthStep('number');
      setAuthMode('phone');
    };

    const openForgot = () => {
      setFeedback(null);
      setAuthMode('forgot');
    };

    const authTopBar = (showBack: boolean) => (
      <View style={styles.authScreenTopBar}>
        {showBack ? (
          <Pressable
            onPress={handleRegisterBack}
            accessibilityRole="button"
            accessibilityLabel={copy.authBackToLogin}
            style={({ pressed }) => [styles.authBackQuiet, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="arrow-left" size={22} color="#F8FAFC" />
          </Pressable>
        ) : (
          <View style={styles.authHeaderSpacer} />
        )}
        <View style={styles.authHeaderSpacer} />
        <Pressable onPress={() => chooseLanguage(language === 'en' ? 'sw' : 'en')} hitSlop={8}>
          <Text style={styles.authLanguageQuiet}>{copy.authLanguageOther}</Text>
        </Pressable>
      </View>
    );

    const renderRegisterForm = () => (
      <>
        {authTopBar(true)}
        <AuthHero
          title={registerStep === 'vehicle' ? copy.authVehicleDetailsTitle : copy.authRegisterTitle}
          subtitle={
            registerStep === 'vehicle' ? copy.authVehicleDetailsSubtitle : copy.authRegisterSubtitle
          }
        />

        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        {registerStep === 'details' ? (
          <View style={styles.authFormStack}>
            <SetupField
              value={registerForm.firstName}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, firstName: value }))}
              placeholder={copy.authFullName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
            />
            <View style={styles.setupPhoneRow}>
              <View style={styles.authCountryCode}>
                <Text style={styles.setupFlagText}>TZ</Text>
                <Text style={styles.authDialCode}>+255</Text>
              </View>
              <View style={styles.setupPhoneInput}>
                <SetupField
                  value={registerForm.phoneNumber}
                  onChangeText={(value) => setRegisterForm((current) => ({ ...current, phoneNumber: value }))}
                  placeholder={copy.authPhone}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                />
              </View>
            </View>
            <SetupField
              value={registerForm.email}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, email: value }))}
              placeholder={copy.authEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <SetupField
              value={registerForm.password}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, password: value }))}
              placeholder={copy.authPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              textContentType="newPassword"
            />
            <SetupField
              value={registerForm.confirmPassword}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, confirmPassword: value }))}
              placeholder={copy.authConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
            <SetupField
              value={registerForm.plateNumber}
              onChangeText={(value) => setRegisterForm((current) => ({ ...current, plateNumber: value }))}
              placeholder={copy.authPlate}
              autoCapitalize="characters"
            />
            <Pressable
              onPress={() => setRegisterTermsAccepted((current) => !current)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: registerTermsAccepted }}
              style={({ pressed }) => [styles.authTermsRow, pressed && styles.buttonPressed]}>
              <View style={[styles.termsCheckbox, registerTermsAccepted && styles.termsCheckboxActive]}>
                {registerTermsAccepted ? <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.authTermsText}>
                {copy.authAgreePrefix}{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
                  {copy.authTerms}
                </Text>
                {' '}{copy.authAnd}{' '}
                <Text style={styles.authLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  {copy.authPrivacy}
                </Text>
              </Text>
            </Pressable>
            <AppButton
              label={registering ? copy.authCreating : copy.authCreateAccount}
              onPress={() => void handleRegister()}
              disabled={registering}
            />
          </View>
        ) : (
          <View style={styles.authFormStack}>
            <VehicleTypePicker
              value={toPilotVehicleType(registerForm.vehicleType)}
              onChange={(vehicleType) =>
                setRegisterForm((current) => ({
                  ...current,
                  vehicleType,
                  vehicleLabel: getVehicleTypeLabel(vehicleType),
                }))
              }
            />
            <AppButton label={copy.authContinue} onPress={() => { setFeedback(null); setRegisterStep('details'); }} />
          </View>
        )}

        {registerStep === 'details' ? (
          <Pressable
            onPress={handleRegisterBack}
            style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
            <Text style={styles.loginSecondaryActionText}>{copy.authVehicleDetailsTitle}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleRegisterBack}
            style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
            <Text style={styles.loginSecondaryActionMuted}>{copy.authHaveAccount}</Text>
            <Text style={styles.loginSecondaryActionText}>{copy.authLoginHere}</Text>
          </Pressable>
        )}
      </>
    );

    const renderForgotForm = () => (
      <>
        {authTopBar(true)}
        <AuthHero
          title={copy.authForgotTitle}
          subtitle={copy.authForgotSubtitle}
          avatarKind="payment"
        />

        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.authFormStack}>
          <SetupField
            value={loginEmail}
            onChangeText={(value) => {
              setLoginEmail(value);
              if (feedback) {
                setFeedback(null);
              }
            }}
            placeholder={copy.authEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => void handlePasswordReset()}
          />

          <AppButton
            label={resettingPassword ? copy.authSendingReset : copy.authSendReset}
            onPress={() => void handlePasswordReset()}
            disabled={resettingPassword}
          />
        </View>

        <Pressable
          onPress={handleRegisterBack}
          style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
          <Text style={styles.loginSecondaryActionText}>{copy.authBackToLogin}</Text>
        </Pressable>
      </>
    );

    const renderPhoneForm = () => {
      const verifying = phoneAuthStep === 'code';

      return (
        <>
          {authTopBar(verifying)}
          <AuthHero
            title={verifying ? copy.authOtpTitle : copy.authPhoneTitle}
            subtitle={verifying ? copy.authOtpSubtitle : copy.authPhoneSubtitle}
            avatarKind={verifying ? 'verification' : undefined}
          />
          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
          <View style={styles.authFormStack}>
            {verifying ? (
              <SetupField
                value={phoneAuthCode}
                onChangeText={(value) => {
                  setPhoneAuthCode(value.replace(/[^\d]/g, '').slice(0, 6));
                  if (feedback) setFeedback(null);
                }}
                placeholder={copy.authPhoneCode}
                keyboardType="number-pad"
                autoCapitalize="none"
                textContentType="oneTimeCode"
                maxLength={6}
              />
            ) : (
              <View style={styles.setupPhoneRow}>
                <View style={styles.authCountryCode}>
                  <Text style={styles.setupFlagText}>TZ</Text>
                  <Text style={styles.authDialCode}>+255</Text>
                </View>
                <View style={styles.setupPhoneInput}>
                  <SetupField
                    value={phoneAuthNumber}
                    onChangeText={(value) => {
                      setPhoneAuthNumber(value);
                      if (feedback) setFeedback(null);
                    }}
                    placeholder={copy.authPhone}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    editable={!phoneAuthBusy}
                  />
                </View>
              </View>
            )}
            <AppButton
              label={
                phoneAuthBusy
                  ? verifying
                    ? copy.authPhoneVerifying
                    : copy.authPhoneSending
                  : verifying
                    ? copy.authPhoneVerify
                    : copy.authPhoneSend
              }
              onPress={() => void (verifying ? handleVerifyPhoneCode() : handleSendPhoneCode())}
              disabled={phoneAuthBusy}
            />
          </View>
          {verifying ? (
            <Pressable
              onPress={() => {
                setPhoneAuthStep('number');
                setPhoneAuthCode('');
                setFeedback(null);
              }}
              style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
              <Text style={styles.loginSecondaryActionMuted}>
                {language === 'sw' ? 'Hujapokea msimbo?' : "Didn't get a code?"}
              </Text>
              <Text style={styles.loginSecondaryActionText}>{copy.authPhoneSend}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                setFeedback(null);
                setAuthMode('signin');
              }}
              accessibilityLabel={copy.authPhoneEmail}
              style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
              <Text style={styles.loginSecondaryActionMuted}>{copy.authHaveAccount}</Text>
              <Text style={styles.loginSecondaryActionText}>{copy.authLoginHere}</Text>
            </Pressable>
          )}
        </>
      );
    };

    const renderLoginForm = () => (
      <>
        {authTopBar(false)}
        <AuthHero
          title={copy.authLoginTitle}
          subtitle={copy.authLoginSubtitle}
          avatarKind="authWelcome"
        />

        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.authFormStack}>
          <SetupField
            value={loginEmail}
            onChangeText={(value) => {
              setLoginEmail(value);
              if (feedback) {
                setFeedback(null);
              }
            }}
            placeholder={copy.authEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <SetupField
            value={loginPassword}
            onChangeText={(value) => {
              setLoginPassword(value);
              if (feedback) {
                setFeedback(null);
              }
            }}
            placeholder={copy.authPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => void handleSignIn()}
          />

          <AppButton
            label={signingIn ? copy.authLoggingIn : copy.authLogin}
            onPress={() => void handleSignIn()}
            disabled={signingIn}
          />
        </View>

        <Pressable
          onPress={openForgot}
          style={({ pressed }) => [styles.authForgotButton, pressed && styles.buttonPressed]}>
          <Text style={styles.authForgotButtonText}>{copy.authForgot}</Text>
        </Pressable>

        <Pressable
          onPress={openRegister}
          style={({ pressed }) => [styles.loginSecondaryAction, pressed && styles.buttonPressed]}>
          <Text style={styles.loginSecondaryActionMuted}>{copy.authNoAccount}</Text>
          <Text style={styles.loginSecondaryActionText}>{copy.authRegisterHere}</Text>
        </Pressable>

        <View style={styles.authFooter}>
          <Text style={styles.authFooterText}>
            {copy.authLegal}{' '}
            <Text style={styles.authLink} onPress={() => void Linking.openURL(TERMS_URL)}>
              {copy.authTerms}
            </Text>
            .
          </Text>
        </View>
      </>
    );

    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.authCanvas}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.authScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {authMode === 'register'
              ? renderRegisterForm()
              : authMode === 'forgot'
                ? renderForgotForm()
                : authMode === 'signin'
                  ? renderLoginForm()
                  : renderPhoneForm()}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // ──────────────────────────────────────────────
  // Profile setup
  // ──────────────────────────────────────────────

  const persistPilotVehicle = async (vehicleType: DriverVehicleType) => {
    const next = toPilotVehicleType(vehicleType);
    if (!authUser?.uid) {
      return;
    }
    setBusyAction('vehicle-choice');
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'drivers', authUser.uid), {
        vehicleType: next,
        vehicleLabel: getVehicleTypeLabel(next),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Gari halikuhifadhiwa. Jaribu tena.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const renderVehicleChoiceScreen = () => (
    <View style={styles.setupScreen}>
      <ScrollView contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.authHeroCopy}>
          <Text style={styles.authPageTitle}>{copy.authVehicleDetailsTitle}</Text>
        </View>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
        <VehicleTypePicker
          value={isCanonicalPilotVehicle(driverProfile?.vehicleType) ? String(driverProfile?.vehicleType) : ''}
          onChange={(vehicleType) => void persistPilotVehicle(vehicleType)}
        />
      </ScrollView>
    </View>
  );

  const renderProfileSetup = () => (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.setupScreen}>
        <View style={styles.authScreenTopBar}>
          <Pressable onPress={handleProfileSetupBack} style={({ pressed }) => [styles.authBackQuiet, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={driveTheme.colors.ink} />
          </Pressable>
          <Text style={styles.authTopBrandName}>{copy.authBrand}</Text>
          <View style={styles.authHeaderSpacer} />
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.setupScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.authHeroCopy}>
            <Text style={styles.authPageTitle}>Wasifu</Text>
          </View>

          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          <SetupField
            value={profileSetup.plateNumber}
            onChangeText={(value) => setProfileSetup((current) => ({ ...current, plateNumber: value }))}
            placeholder={copy.authPlate}
            autoCapitalize="characters"
          />
          <SetupField
            value={profileSetup.fullName}
            onChangeText={(value) => setProfileSetup((current) => ({ ...current, fullName: value }))}
            placeholder={copy.authFullName}
          />
          <View style={styles.setupPhoneRow}>
            <View style={styles.authCountryCode}>
              <Text style={styles.setupFlagText}>TZ</Text>
              <Text style={styles.authDialCode}>+255</Text>
            </View>
            <View style={styles.setupPhoneInput}>
              <SetupField
                value={profileSetup.phoneNumber}
                onChangeText={(value) => setProfileSetup((current) => ({ ...current, phoneNumber: value }))}
                placeholder={copy.authPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
              />
            </View>
          </View>
          <AppButton
            label={busyAction === 'complete-profile' ? copy.authSavingProfile : copy.authSubmitProfile}
            onPress={() => void handleCompleteProfile()}
            disabled={busyAction === 'complete-profile'}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );

  const renderDriverBlockedScreen = () => (
    <View style={[styles.authCanvas, styles.authQuietPage]}>
      <Text style={styles.authPageTitle}>{copy.authBlockedTitle}</Text>
      <Text style={styles.authHeroSubtitle}>{copy.authBlockedBody}</Text>
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
      <AppButton label={copy.signOut} onPress={() => void handleSignOut()} />
    </View>
  );

  const renderVerificationStatusScreen = () => {
    const vehicleLabel = driverProfile
      ? `${getVehicleTypeLabel(driverProfile.vehicleType || driverProfile.vehicleLabel)} · ${driverProfile.plateNumber || copy.platePending}`
      : getRegisterVehicleLabel(registerForm);

    return (
      <View style={[styles.authCanvas, styles.authQuietPage]}>
        <Text style={styles.authPageTitle}>{copy.authWaitingTitle}</Text>
        <View style={styles.waitingVehicleLine}>
          <Text style={styles.waitingVehicleText}>{vehicleLabel || copy.authVehicle}</Text>
        </View>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
        <AppButton label={copy.signOut} onPress={() => void handleSignOut()} />
      </View>
    );
  };

  const openBrokerageCheckout = () => {
    setPaymentCheckoutStep(subscriptionPaymentPending ? 'submitted' : 'proof');
    setPaymentPhoneNumber((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
    setAccountView('payments');
    setSelectedTab('account');
    if (subscriptionPaymentPending) {
      void handleRefreshPaymentStatus();
    }
  };

  // ──────────────────────────────────────────────
  // Access renewal (payment lock)
  // ──────────────────────────────────────────────

  const renderAccessRenewalScreen = () => {
    return (
      <>
        {feedback ? (
          <View style={styles.lockFeedbackWrap}>
            <FeedbackBanner tone={feedback.tone} message={feedback.message} />
          </View>
        ) : null}
        <DailyCommissionLock
          unpaidLabel={`TZS ${commissionSummary.unpaidTzs.toLocaleString()}`}
          pending={commissionPaymentPending}
          busy={busyAction === 'commission-payment' || paymentRefreshing}
          onPay={() => {
            if (commissionPaymentPending) {
              void handleRefreshPaymentStatus();
              return;
            }
            setPaymentPhoneNumber((current) => current || driverProfile?.phoneNumber || '');
            setPaymentCheckoutStep('proof');
            setAccountView('payments');
            setSelectedTab('account');
          }}
        />
      </>
    );
  };

  // ──────────────────────────────────────────────
  // Home tab (navigation-first driver dashboard)
  // ──────────────────────────────────────────────

  const renderHomeTab = () => {
    const orderPickupPoint = activeOrder ? getOrderPickupPoint(activeOrder) : null;
    const currentDriverPoint = resolveDriverMapPoint(driverProfile, liveMapPoint);
    const pickupPoint =
      orderPickupPoint
        ? orderPickupPoint
        : currentDriverPoint ?? DAR_ES_SALAAM_FALLBACK;
    const driverDropoffPoint = activeOrder ? getDriverVisibleDropoffPoint(activeOrder) : null;
    const driverDropoffLabel = activeOrder ? getDriverVisibleDropoffLabel(activeOrder) : '';
    const dropoffPoint =
      driverDropoffPoint ?? pickupPoint;
    const canRenderMap = Platform.OS !== 'web' && MapView && Marker && Polyline;
    const isOnline = Boolean(driverProfile?.isAvailable);
    const awaitingAccept = isIncomingOffer(activeOrder);
    const todayAverage = todayCompletedCount > 0 ? Math.round(todayEarnings / todayCompletedCount) : 0;
    const allTimeDeliveredCount = driverProfile?.completedOrderCount || driverOrders.filter((order) => order.status === 'delivered').length;
    const homeAvailabilityNote = activeOrder
      ? copy.orderInProgress
      : driverVerificationPending
        ? copy.verificationReview
        : driverVerificationRejected
          ? copy.verificationRejected
          : isOnline
            ? copy.ordersWillAppear
            : copy.tapGoToReceive;
    const homeOrderStatusLabel =
      activeOrder?.status === 'driver_assigned'
        ? copy.newOrder
        : activeOrder?.status === 'driver_at_pickup'
          ? copy.atPickup
          : activeOrder?.status === 'in_transit'
            ? copy.onTrip
            : activeOrder?.status === 'delivered'
              ? copy.deliveredStatus
              : copy.waitingOrder;
    const pickupDistanceKm = currentDriverPoint ? haversineDistanceKm(currentDriverPoint, pickupPoint) : null;
    const pickupEtaMin = pickupDistanceKm != null ? Math.max(1, Math.round(pickupDistanceKm / 0.35)) : null;
    const requestCustomerName = activeOrder?.customerName || activeOrder?.recipientName || '';
    const driverFirstName = (driverProfile?.fullName || '').trim().split(/\s+/)[0];
    const mapLatitude = activeOrder ? (pickupPoint.latitude + dropoffPoint.latitude) / 2 : pickupPoint.latitude;
    const mapLongitude = activeOrder ? (pickupPoint.longitude + dropoffPoint.longitude) / 2 : pickupPoint.longitude;
    const mapLatitudeDelta = activeOrder
      ? Math.max(Math.abs(pickupPoint.latitude - dropoffPoint.latitude) * 2.3, 0.04)
      : 0.02;
    const mapLongitudeDelta = activeOrder
      ? Math.max(Math.abs(pickupPoint.longitude - dropoffPoint.longitude) * 2.3, 0.04)
      : 0.02;

    return (
      <View style={styles.homeScreen}>
        <View style={styles.homeMapWrap}>
          {canRenderMap ? (
            <MapView
              ref={homeMapRef}
              provider={mapsProvider}
              style={styles.homeMapFill}
              mapType="standard"
              customMapStyle={DRIVE_DARK_MAP_STYLE}
              userInterfaceStyle="dark"
              liteMode={false}
              showsCompass={false}
              showsTraffic={Boolean((isOnline && !activeOrder) || inAppNavMode)}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              moveOnMarkerPress={false}
              rotateEnabled={false}
              pitchEnabled={false}
              showsUserLocation
              followsUserLocation={!activeOrder || inAppNavMode}
              loadingEnabled
              loadingBackgroundColor="#0E1626"
              loadingIndicatorColor="#34C759"
              onPoiClick={() => undefined}
              initialRegion={buildMapRegion(
                { latitude: mapLatitude, longitude: mapLongitude },
                mapLatitudeDelta,
                mapLongitudeDelta
              )}>
              {currentDriverPoint ? (
                <Marker
                  coordinate={currentDriverPoint}
                  pinColor="#34C759"
                  tappable={false}
                  tracksViewChanges={false}
                  title="HAUL Pilots"
                />
              ) : null}
              {activeOrder ? (
                <Marker coordinate={pickupPoint} pinColor="#F97316" tappable={false} tracksViewChanges={false} />
              ) : null}
              {activeOrder && driverDropoffPoint ? (
                <Marker coordinate={dropoffPoint} pinColor="#38BDF8" tappable={false} tracksViewChanges={false} />
              ) : null}
              {activeOrder && activeRoadRoute.length >= 2 ? (
                <Polyline
                  coordinates={activeRoadRoute}
                  strokeColor={inAppNavMode ? '#34C759' : '#38BDF8'}
                  strokeWidth={inAppNavMode ? 6 : 5}
                />
              ) : activeOrder && driverDropoffPoint ? (
                <Polyline coordinates={[pickupPoint, dropoffPoint]} strokeColor="#38BDF8" strokeWidth={5} />
              ) : currentDriverPoint && activeOrder ? (
                <Polyline coordinates={[currentDriverPoint, pickupPoint]} strokeColor="#34C759" strokeWidth={5} />
              ) : null}
              {!activeOrder && Circle
                ? demandZones.slice(0, 5).map((zone) => (
                    <Circle
                      key={zone.id}
                      center={{ latitude: zone.latitude, longitude: zone.longitude }}
                      radius={zone.radiusMeters}
                      fillColor={`rgba(234, 88, 12, ${0.1 + zone.intensity * 0.24})`}
                      strokeColor={`rgba(220, 38, 38, ${0.22 + zone.intensity * 0.35})`}
                      strokeWidth={1.5}
                      zIndex={1}
                    />
                  ))
                : null}
              {!activeOrder
                ? nearbyCustomers.map((customer) => (
                    <NearbyCustomerMarker
                      key={customer.id}
                      MarkerComponent={Marker}
                      customer={customer}
                      onPress={() => {
                        setSelectedNearbyCustomer(customer);
                      }}
                    />
                  ))
                : null}
            </MapView>
          ) : (
            <View style={[styles.homeMapFill, styles.homeMapFallback]}>
              <View style={styles.homeMapGridLineA} />
              <View style={styles.homeMapGridLineB} />
            </View>
          )}

          <DriveHomeMapGradients />

          {!activeOrder ? (
            <View pointerEvents="box-none" style={styles.homeFloatingHeader}>
              <View style={styles.boltTopBar}>
                <PilotMapChromeButton
                  icon="menu"
                  accessibilityLabel={copy.menuTitle}
                  onPress={() => setMenuOpen(true)}
                />
                <PilotEarningsPill
                  value={`TZS ${todayEarnings.toLocaleString()}`}
                  meta={copy.todayShort}
                  commissionLabel={copy.commissionDueShort}
                  commissionValue={`TZS ${(hasCommissionDue ? dailyCommissionDue : Math.round(todayEarnings * (pilotStandingState.feePercent / 100))).toLocaleString()}`}
                  expandedHint={
                    hasCommissionDue
                      ? copy.commissionTapHint
                      : language === 'sw'
                        ? `Makadirio ${pilotStandingState.feePercent}% ya leo · bofya tena kuficha`
                        : `Est. ${pilotStandingState.feePercent}% of today · tap again to hide`
                  }
                />
                <PilotMapChromeButton
                  icon="shield-check-outline"
                  accessibilityLabel={copy.tabAlerts}
                  onPress={() => setSelectedTab('notifications')}
                />
              </View>
              {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
            </View>
          ) : null}

          {!activeOrder && !awaitingAccept && !homeSheetExpanded ? (
            <View
              pointerEvents="box-none"
              style={[styles.boltGoOnlineWrap, { bottom: HOME_SHEET_PEEK + 20 }]}>
              <View style={styles.boltMapToolsRow}>
                <PilotMapChromeButton
                  icon="crosshairs-gps"
                  accessibilityLabel={copy.refreshLocation}
                  onPress={() => {
                    const point = resolveDriverMapPoint(driverProfile, liveMapPoint);
                    if (point && homeMapRef.current?.animateToRegion) {
                      homeMapRef.current.animateToRegion(buildMapRegion(point), 500);
                    }
                  }}
                />
                <View style={styles.boltMapToolsSpacer} />
                {topDemandZone ? (
                  <PilotMapChromeButton
                    icon="map-marker-radius"
                    accessibilityLabel={copy.demandNavigate}
                    onPress={() => void handleNavigateToDemandHotspot()}
                  />
                ) : null}
              </View>
              <PilotGoOnlineButton
                online={isOnline}
                label={
                  busyAction === 'availability'
                    ? copy.updating
                    : isOnline
                      ? copy.goOffline
                      : copy.goOnline
                }
                loading={busyAction === 'availability'}
                onPress={() => void handleToggleAvailability()}
              />
            </View>
          ) : null}

          <View pointerEvents="box-none" style={styles.homeBottomOverlay}>
            {awaitingAccept && activeOrder ? (
              <DriveOrderCard
                meta={
                  activeOrder.fareType === 'negotiated' && (activeOrder.customerOffer ?? 0) > 0
                    ? `Bei ya mteja TZS ${Math.round(activeOrder.customerOffer ?? 0).toLocaleString('en-US')}`
                    : pickupEtaMin != null && pickupDistanceKm != null
                      ? `${pickupEtaMin} min · ${pickupDistanceKm.toFixed(1)} km`
                      : copy.newOrder
                }
                place={activeOrder.pickupLabel}
                customer={requestCustomerName || undefined}
                customerPhone={activeOrderContactPhone || resolveOrderContactPhone(activeOrder) || undefined}
                phoneLabel={copy.customerPhoneLabel}
                fareLabel={copy.orderFareLabel}
                fare={
                  isInstantCargoVerify
                    ? activeOrder.totalLabel ||
                      `TZS ${Math.round(
                        Math.max(
                          activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000,
                          activeOrder.customerOffer ?? 0
                        )
                      ).toLocaleString('en-US')}`
                    : activeOrder.fareType === 'negotiated'
                      ? `TZS ${Math.round(
                          Math.max(
                            activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000,
                            driverFareDraft ?? activeOrder.customerOffer ?? 0
                          )
                        ).toLocaleString('en-US')}`
                      : activeOrder.totalLabel
                }
                loadLabel={activeOrder.fareType === 'negotiated' ? activeOrder.cargoSizeLabel : undefined}
                customerNote={
                  isInstantCargoVerify
                    ? undefined
                    : activeOrder.fareType === 'negotiated'
                      ? activeOrder.customerOfferNote
                      : undefined
                }
                chancesUsed={isInstantCargoVerify ? undefined : fareNegotiation ? fareNegotiation.used : undefined}
                chancesTotal={isInstantCargoVerify ? undefined : DRIVER_NEGOTIATION_CHANCES}
                chanceHint={isInstantCargoVerify ? undefined : fareNegotiation?.chanceHint}
                spendingChance={isInstantCargoVerify ? false : Boolean(fareNegotiation?.sendingNew)}
                offerNote={isInstantCargoVerify ? undefined : driverOfferNote}
                onChangeOfferNote={
                  isInstantCargoVerify
                    ? undefined
                    : fareNegotiation && fareNegotiation.left > 0
                      ? setDriverOfferNote
                      : undefined
                }
                fareStepper={
                  !isInstantCargoVerify &&
                  activeOrder.fareType === 'negotiated' &&
                  fareNegotiation &&
                  fareNegotiation.left > 0
                    ? {
                        minusDisabled:
                          (driverFareDraft ?? activeOrder.customerOffer ?? 0) <=
                          (activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000),
                        onMinus: () => {
                          const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
                          const current = driverFareDraft ?? activeOrder.customerOffer ?? minFare;
                          setDriverFareDraft(Math.max(minFare, current - 1000));
                        },
                        onPlus: () => {
                          const minFare = activeOrder.minFare && activeOrder.minFare > 0 ? activeOrder.minFare : 5000;
                          const current = driverFareDraft ?? activeOrder.customerOffer ?? minFare;
                          setDriverFareDraft(current + 1000);
                        },
                      }
                    : undefined
                }
                actionDisabled={
                  isInstantCargoVerify
                    ? false
                    : Boolean(
                        fareNegotiation?.mustWait ||
                          (fareNegotiation?.sameResend && (fareNegotiation?.left ?? 0) > 0)
                      )
                }
                actionLabel={
                  busyAction === 'accept-order' || busyAction === 'counter-fare'
                    ? busyAction === 'counter-fare'
                      ? 'Inatuma...'
                      : copy.accepting
                    : isInstantCargoVerify
                      ? 'Thibitisha'
                      : fareNegotiation?.mustWait || (fareNegotiation?.sameResend && fareNegotiation.left > 0)
                        ? 'Inasubiri mteja'
                        : fareNegotiation && fareNegotiation.left <= 0
                          ? 'Kubali'
                          : activeOrder.fareType === 'negotiated' &&
                              !cargoOffersMatch(activeOrder.customerOffer, driverFareDraft)
                            ? 'Tuma'
                            : activeOrder.fareType === 'negotiated'
                              ? 'Kubali'
                              : copy.accept
                }
                loading={busyAction === 'accept-order' || busyAction === 'counter-fare'}
                swipeHint={copy.swipeToAcceptHint}
                onAction={() => void (isInstantCargoVerify ? handleAcceptOrder() : handleDriverFarePrimary())}
                declineLabel={busyAction === 'decline-order' ? copy.declining : copy.decline}
                onDecline={() => {
                  if (busyAction === 'decline-order') return;
                  handleDeclineOrder();
                }}
              />
            ) : activeOrder ? (
              <DriveBottomSheet variant="home">
                <Text style={styles.homeSheetKicker}>{homeOrderStatusLabel}</Text>
                <DriveRouteStops
                  pickupTitle={copy.pickup}
                  pickupLabel={activeOrder.pickupLabel}
                  dropoffTitle={copy.dropoff}
                  dropoffLabel={driverDropoffLabel}
                />
                {(() => {
                  const nextAction = getNextTripAction(activeOrder.status);
                  const nextLabel =
                    nextAction?.nextStatus === 'driver_at_pickup'
                      ? copy.tripNextArrive
                      : nextAction?.nextStatus === 'in_transit'
                        ? copy.tripNextStart
                        : nextAction?.nextStatus === 'delivered'
                          ? copy.tripNextDeliver
                          : nextAction?.label || '';
                  const nextBusy = nextAction ? busyAction === `trip-${nextAction.nextStatus}` : false;
                  return nextLabel ? (
                    <DrivePrimaryButton
                      label={nextBusy ? `${nextLabel}...` : nextLabel}
                      icon={nextAction?.icon}
                      loading={nextBusy}
                      disabled={nextBusy}
                      onPress={() => {
                        if (nextAction) handleTripPrimaryAdvance(nextAction.nextStatus);
                      }}
                    />
                  ) : null;
                })()}
                <DriveGhostButton
                  tone="danger"
                  label={busyAction === 'trip-cancelled' ? copy.cancelling : copy.cancelTrip}
                  loading={busyAction === 'trip-cancelled'}
                  onPress={handleCancelActiveTrip}
                />
              </DriveBottomSheet>
            ) : !awaitingAccept ? (
              <PilotSwipeDashboard
                online={isOnline}
                statusTitle={isOnline ? copy.lookingForOrders : copy.youAreOffline}
                statusHint={homeAvailabilityNote}
                onExpandedChange={setHomeSheetExpanded}
                actionCards={[
                  {
                    key: 'rewards',
                    icon: 'trophy-outline',
                    iconColor: '#F5A623',
                    iconBg: '#2E2410',
                    title: copy.haulRewards,
                    subtitle:
                      language === 'sw'
                        ? `${pilotStandingState.tier.label} · mfululizo ${pilotStandingState.streak}`
                        : `${pilotStandingState.tier.label} · streak ${pilotStandingState.streak}`,
                    onPress: () => setSelectedTab('earn'),
                  },
                  ...(nearbyCustomers.length > 0 || orderProbability > 0
                    ? [
                        {
                          key: 'demand',
                          icon: 'map-marker-radius' as const,
                          iconColor: '#34C759',
                          iconBg: '#14301F',
                          title:
                            nearbyCustomers.length > 0
                              ? `${nearbyCustomers.length} ${copy.nearbyCustomers}`
                              : copy.demandHotspotTitle,
                          subtitle:
                            orderProbability > 0
                              ? copy.demandProbability(orderProbability)
                              : copy.nearbyDemandHint,
                          onPress: topDemandZone
                            ? () => void handleNavigateToDemandHotspot()
                            : undefined,
                        },
                      ]
                    : []),
                  {
                    key: 'alerts',
                    icon: 'bell-outline',
                    iconColor: '#38BDF8',
                    iconBg: '#0F2740',
                    title: copy.tabAlerts,
                    subtitle: unreadNotificationCount
                      ? `${unreadNotificationCount} ${copy.alertsLive}`
                      : copy.alertsSubtitle,
                    onPress: () => setSelectedTab('notifications'),
                  },
                ]}
                standing={pilotStandingState}
                rewardsLabel={copy.haulRewards}
                scoreLabel={copy.driverScore}
                streakWord={copy.streakWord}
                commissionLabel={
                  language === 'sw'
                    ? `Kamisheni ${pilotStandingState.feePercent}% · ${pilotStandingState.tier.priority}`
                    : `Commission ${pilotStandingState.feePercent}% · ${pilotStandingState.tier.priority}`
                }
                deliveredToday={todayCompletedCount}
                earningsTodayValue={`TZS ${todayEarnings.toLocaleString()}`}
                onPressRewards={() => setSelectedTab('earn')}
              />
            ) : null}
          </View>
        </View>

        <Modal
          visible={Boolean(selectedNearbyCustomer)}
          transparent
          animationType="slide"
          onRequestClose={closeLeadMessageSheet}>
          <Pressable style={styles.tripChatBackdrop} onPress={closeLeadMessageSheet} />
          <View style={styles.leadMessageSheet}>
            <View style={styles.tripChatSheetHandle} />
            <View style={styles.tripChatHeader}>
              <DriveIconWell icon="account-circle-outline" size={44} />
              <View style={styles.tripChatHeaderCopy}>
                <Text style={styles.tripChatHeaderTitle} numberOfLines={1}>
                  {selectedNearbyCustomer?.firstName || copy.leadMessageTitle}
                </Text>
                <Text style={styles.tripChatHeaderSubtitle} numberOfLines={2}>
                  {copy.leadMessageSubtitle}
                </Text>
              </View>
              <Pressable
                onPress={closeLeadMessageSheet}
                style={({ pressed }) => [styles.tripChatCloseButton, pressed && styles.buttonPressed]}>
                <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
              </Pressable>
            </View>

            <View style={styles.leadSimpleHintWrap}>
              <Text style={styles.leadSimpleHint}>Bonyeza template moja kutuma mara moja.</Text>
            </View>

            <View style={styles.leadTemplateGrid}>
              {[copy.leadQuickNearby, copy.leadQuickReady, copy.leadQuickWhere].map((template) => (
                <Pressable
                  key={template}
                  onPress={() => void handleSendLeadMessage(template)}
                  disabled={leadMessageSending}
                  style={({ pressed }) => [
                    styles.leadTemplateChip,
                    leadMessageSending && styles.leadTemplateChipDisabled,
                    pressed && !leadMessageSending && styles.buttonPressed,
                  ]}>
                  <MaterialCommunityIcons name="send-outline" size={14} color="#16A34A" style={styles.leadTemplateIcon} />
                  <Text style={styles.leadTemplateText}>{template}</Text>
                </Pressable>
              ))}
            </View>

            {leadMessageSending ? (
              <View style={styles.leadSendingRow}>
                <ActivityIndicator size="small" color="#16A34A" />
                <Text style={styles.leadSendingText}>{copy.sending}…</Text>
              </View>
            ) : null}
          </View>
        </Modal>
      </View>
    );
  };

  // ──────────────────────────────────────────────
  // Trip tab (with enhanced cancellation button)
  // ──────────────────────────────────────────────

  const renderTripTab = () => {
    const nextAction = getNextTripAction(activeOrder?.status);
    const awaitingAccept = isIncomingOffer(activeOrder);
    const orderPickupPoint = activeOrder ? getOrderPickupPoint(activeOrder) : null;
    const pickupPoint =
      orderPickupPoint
        ? orderPickupPoint
        : resolveDriverMapPoint(driverProfile, liveMapPoint) ?? DAR_ES_SALAAM_FALLBACK;
    const driverDropoffPoint = activeOrder ? getDriverVisibleDropoffPoint(activeOrder) : null;
    const driverDropoffLabel = activeOrder ? getDriverVisibleDropoffLabel(activeOrder) : '';
    const dropoffPoint = driverDropoffPoint;
    const driverPoint =
      getPointFromCoordinates(activeOrder?.driverLatitude, activeOrder?.driverLongitude) ??
      resolveDriverMapPoint(driverProfile, liveMapPoint);
    const tripNowLabel = awaitingAccept
      ? copy.newOrder
      : activeOrder?.status === 'driver_assigned'
        ? copy.tripGoPickup
        : activeOrder?.status === 'driver_at_pickup'
          ? copy.tripCollect
          : activeOrder?.status === 'in_transit'
            ? copy.tripGoDropoff
            : copy.activeDelivery;
    const nextActionLabel =
      nextAction?.nextStatus === 'driver_at_pickup'
        ? copy.tripNextArrive
        : nextAction?.nextStatus === 'in_transit'
          ? copy.tripNextStart
          : nextAction?.nextStatus === 'delivered'
            ? copy.tripNextDeliver
            : nextAction?.label ?? '';
    const primaryBusy = awaitingAccept
      ? busyAction === 'accept-order'
      : nextAction
        ? busyAction === `trip-${nextAction.nextStatus}`
        : false;
    const primaryLabel = awaitingAccept
      ? primaryBusy
        ? copy.accepting
        : copy.accept
      : nextAction
        ? primaryBusy
          ? `${nextActionLabel}...`
          : nextActionLabel
        : '';
    const primaryIcon = awaitingAccept
      ? 'check-circle-outline'
      : nextAction?.icon ?? 'check-circle-outline';

    if (!activeOrder) {
      return (
        <View style={styles.tripScreen}>
          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
          <View style={styles.tripEmptyWrap}>
            <DriveProEmptyState
              icon="map-marker-path"
              avatarKind="goOnline"
              title={copy.noActiveTrip}
              text={copy.noActiveTripHint}
              actionLabel={copy.goOnline}
              onAction={() => void handleToggleAvailability()}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.tripScreen}>
        <View style={styles.tripMapWrap}>
          <TripMap
            pickupPoint={pickupPoint}
            dropoffPoint={dropoffPoint}
            driverPoint={driverPoint}
            statusLabel={tripNowLabel}
            onOpenNavigation={() => void handleOpenNavigation()}
            MapViewComponent={MapView}
            MarkerComponent={Marker}
            PolylineComponent={Polyline}
            compact
            onRefreshLocation={() => void handleManualLocationRefresh()}
          />
        </View>

        <DriveBottomSheet style={styles.tripDockSheet}>
          {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

          <View style={styles.tripNowRow}>
            <View style={styles.tripNowCopy}>
              <Text style={styles.tripNowKicker}>{copy.activeDelivery}</Text>
              <Text style={styles.tripNowTitle} numberOfLines={1}>{tripNowLabel}</Text>
            </View>
            <Text style={styles.tripDockFare}>{activeOrder.totalLabel}</Text>
          </View>

          <DriveRouteStops
            pickupTitle={copy.pickup}
            pickupLabel={activeOrder.pickupLabel}
            dropoffTitle={copy.dropoff}
            dropoffLabel={driverDropoffLabel}
          />

          {primaryLabel ? (
            <DrivePrimaryButton
              label={primaryLabel}
              icon={primaryIcon}
              loading={primaryBusy}
              disabled={primaryBusy}
              onPress={() => {
                if (awaitingAccept) {
                  void handleAcceptOrder();
                  return;
                }
                if (nextAction) {
                  handleTripPrimaryAdvance(nextAction.nextStatus);
                }
              }}
            />
          ) : null}

          <DriveGhostButton
            tone="danger"
            label={
              awaitingAccept
                ? busyAction === 'decline-order'
                  ? copy.declining
                  : copy.rejectOrder
                : busyAction === 'trip-cancelled'
                  ? copy.cancelling
                  : copy.cancelTrip
            }
            loading={busyAction === 'decline-order' || busyAction === 'trip-cancelled'}
            onPress={awaitingAccept ? handleDeclineOrder : handleCancelActiveTrip}
          />
        </DriveBottomSheet>

      </View>
    );
  };

  // ──────────────────────────────────────────────
  // Earn / Rewards tab (Bolt layout + Agents streak)
  // ──────────────────────────────────────────────

  const renderEarnTab = () => (
    <BoltRewardsScreen
      standing={pilotStandingState}
      title={copy.rewardsTitle}
      startingLevelLabel={copy.startingLevel}
      unlockLabel={copy.unlockTier}
      howItWorksLabel={copy.howItWorks}
      benefitsTitle={copy.yourBenefits}
      streakWord={copy.streakWord}
      lang={language === 'sw' ? 'sw' : 'en'}
      onBack={() => setSelectedTab('home')}
    />
  );

  // ──────────────────────────────────────────────
  // History tab
  // ──────────────────────────────────────────────

  const handleOpenNotification = (item: DriverNotification) => {
    if (item.action === 'trip') {
      setSelectedTab('trip');
      return;
    }
    if (item.action === 'chat') {
      setTripChatOpen(true);
      setSelectedTab('trip');
      return;
    }
    if (item.action === 'payments') {
      setPaymentCheckoutStep(subscriptionPaymentPending ? 'submitted' : 'proof');
      setAccountView('payments');
      setSelectedTab('account');
      return;
    }
    if (item.action === 'account') {
      setAccountView('overview');
      setSelectedTab('account');
      return;
    }
    if (item.action === 'location') {
      void handleManualLocationRefresh();
    }
  };

  const renderHistoryTab = () => {
    return (
      <ScrollView style={[styles.flex, styles.studioScreen]} contentContainerStyle={styles.ridesContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <Text style={styles.ridesTitle}>{copy.ridesTitle}</Text>

        {pendingCustomerRatingOrder ? (
          <View style={styles.studioCard}>
            <Text style={styles.studioCardTitle}>{copy.rateCustomer}</Text>
            <Text style={styles.studioCardMeta}>{pendingCustomerRatingOrder.orderNumber}</Text>
            <View style={styles.ratingStarRow}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <Pressable
                  key={rating}
                  onPress={() => setCustomerRatingScore(rating)}
                  style={({ pressed }) => [styles.ratingStarButton, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons
                    name={rating <= customerRatingScore ? 'star' : 'star-outline'}
                    size={32}
                    color={rating <= customerRatingScore ? '#F59E0B' : '#CBD5E1'}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={customerRatingComment}
              onChangeText={setCustomerRatingComment}
              multiline
              maxLength={180}
              placeholder={copy.optionalNote}
              placeholderTextColor="#94A3B8"
              style={styles.customerRatingInput}
              textAlignVertical="top"
            />
            <Pressable
              onPress={() => void handleRateCustomer()}
              disabled={customerRatingSaving}
              style={({ pressed }) => [styles.studioPrimaryButton, customerRatingSaving && styles.buttonDisabled, pressed && styles.buttonPressed]}>
              <Text style={styles.studioPrimaryButtonText}>
                {customerRatingSaving ? copy.savingRating : copy.saveRating}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {driverOrdersLoading ? <ActivityIndicator color={driveTheme.colors.ink} /> : null}

        <DriveSegmentedControl
          value={historySection}
          options={[
            { value: 'trips', label: copy.historyTabTrips },
            { value: 'payments', label: copy.historyTabPayments },
          ]}
          onChange={setHistorySection}
        />

        {historySection === 'payments' ? (
          !driverPaymentHistory.length ? (
            <DriveProEmptyState icon="cash-multiple" avatarKind="payment" title={copy.payNoActivity} text={copy.noHistoryHint} />
          ) : (
            driverPaymentHistory.map((payment) => {
              const statusLabel = payment.status === 'completed'
                ? copy.payStatusPaid
                : payment.status === 'pending' || payment.status === 'creating'
                  ? copy.payStatusPending
                  : copy.payStatusFailed;
              const tone: 'done' | 'warn' | 'muted' =
                payment.status === 'completed' ? 'done' : payment.status === 'pending' || payment.status === 'creating' ? 'warn' : 'muted';
              return (
                <BoltRideRow
                  key={payment.id || payment.orderId}
                  when={
                    payment.completedAt || payment.createdAt
                      ? formatDeliveryDateTime(payment.completedAt || payment.createdAt)
                      : ''
                  }
                  place={paymentNetworkLabel(payment.network)}
                  status={statusLabel}
                  statusTone={tone}
                  fare={`TZS ${Number(payment.amount || driverAccessDailyFeeTzs).toLocaleString()}`}
                />
              );
            })
          )
        ) : !driverOrdersLoading && !driverOrders.length ? (
          <DriveProEmptyState icon="history" avatarKind="emptyTrips" title={copy.noHistory} text={copy.noHistoryHint} />
        ) : (
          driverOrders.map((order) => {
            const active = isActiveOrderStatus(order.status);
            const cancelled = String(order.status || '').includes('cancel');
            const statusTone: 'done' | 'warn' | 'muted' = order.status === 'delivered' ? 'done' : cancelled ? 'warn' : active ? 'warn' : 'muted';
            const statusLabel =
              order.status === 'delivered'
                ? copy.rideFinished
                : cancelled
                  ? copy.rideCancelled
                  : getDriverOrderStatusCopy(order.status, copy);
            return (
              <BoltRideRow
                key={order.id}
                when={formatDeliveryDateTime(order.deliveredAt || order.createdAt)}
                place={order.pickupLabel || getDriverVisibleDropoffLabel(order) || order.orderNumber}
                status={statusLabel}
                statusTone={statusTone}
                fare={order.totalLabel || 'TZS 0'}
                onPress={
                  active
                    ? () => {
                        setSelectedTab('trip');
                      }
                    : undefined
                }
              />
            );
          })
        )}
      </ScrollView>
    );
  };


  const renderNotificationsTab = () => (
    <ScrollView style={[styles.flex, styles.studioScreen]} contentContainerStyle={styles.studioContent} showsVerticalScrollIndicator={false}>
      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <DriveScreenHeader
        title={copy.alertsTitle}
        subtitle={unreadNotificationCount ? `${unreadNotificationCount} ${copy.alertsLive}` : copy.alertsSubtitle}
      />

      {!notificationItems.length ? (
        <DriveProEmptyState icon="bell-outline" avatarKind="notifications" title={copy.noAlerts} text={copy.noAlertsHint} />
      ) : (
        notificationItems.map((item) => (
          <DriveNotificationRow
            key={item.id}
            icon={item.icon}
            iconColor={
              item.tone === 'warning'
                ? driveTheme.colors.warning
                : item.tone === 'success'
                  ? driveTheme.colors.primaryDark
                  : driveTheme.colors.info
            }
            iconBg={
              item.tone === 'warning'
                ? driveTheme.colors.warningSoft
                : item.tone === 'success'
                  ? driveTheme.colors.primarySoft
                  : driveTheme.colors.infoSoft
            }
            title={item.title}
            body={item.message}
            time={item.time}
            unread={item.unread}
            onPress={() => handleOpenNotification(item)}
          />
        ))
      )}
    </ScrollView>
  );

  // ──────────────────────────────────────────────
  // Account tab
  // ──────────────────────────────────────────────

  const renderPaymentAccountPage = () => {
    const showCheckout = hasCommissionDue && !commissionPaymentPending;
    const showPending = hasCommissionDue && commissionPaymentPending;
    const amountDue = Math.max(0, Math.round(dailyCommissionDue || 0));

    return (
      <ScrollView style={styles.fintechPayScreen} contentContainerStyle={styles.fintechPayContent} showsVerticalScrollIndicator={false}>
        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <View style={styles.fintechTopbar}>
          <Pressable
            onPress={() => setAccountView('overview')}
            style={({ pressed }) => [styles.fintechBack, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="chevron-left" size={26} color="#0B1220" />
          </Pressable>
          <Text style={styles.fintechNavTitle}>{copy.payScreenTitle}</Text>
          <View style={styles.fintechBackSpacer} />
        </View>

        <Text style={styles.fintechHeroPeriod}>Unadaiwa</Text>
        <Text style={styles.fintechHeroAmount}>TZS {amountDue.toLocaleString()}</Text>
        <Text style={styles.fintechHeroCaption}>
          {amountDue > 0 ? 'Lipa ili uendelee kupokea oda.' : 'Hakuna deni kwa sasa.'}
        </Text>

        {showPending ? (
          <View style={styles.fintechWaitingCard}>
            <View style={[styles.fintechLogoTile, paymentNetworkTileStyle(selectedPaymentNetwork), styles.fintechWaitingLogo]}>
              <Image
                source={selectedNetworkLogo}
                style={styles.fintechLogoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.fintechWaitingTitle}>{subscriptionActive ? copy.payConfirmedTitle : copy.payApproveTitle}</Text>
            <Text style={styles.fintechWaitingText}>{copy.payApproveBody}</Text>
            {latestPayment?.receiptNumber || latestPayment?.orderId ? (
              <Text style={styles.fintechReference}>{latestPayment?.receiptNumber || latestPayment?.orderId}</Text>
            ) : null}
            <Pressable
              onPress={() => void handleInitiateMongikePayment(true)}
              disabled={busyAction === 'commission-payment'}
              style={({ pressed }) => [styles.fintechPrimaryButton, pressed && styles.buttonPressed, busyAction === 'commission-payment' && styles.fintechButtonDisabled]}>
              <Text style={styles.fintechPrimaryButtonText}>
                {busyAction === 'commission-payment'
                  ? 'Inatuma…'
                  : `Jaribu tena · TZS ${dailyCommissionDue.toLocaleString()}`}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleRefreshPaymentStatus()}
              disabled={paymentRefreshing}
              style={({ pressed }) => [styles.fintechSecondaryButton, pressed && styles.buttonPressed, paymentRefreshing && styles.fintechButtonDisabled]}>
              <Text style={styles.fintechSecondaryButtonText}>{paymentRefreshing ? '...' : copy.payRefresh}</Text>
            </Pressable>
          </View>
        ) : null}

        {showCheckout ? (
          <View style={styles.fintechCheckout}>
            <Text style={styles.fintechSectionLabel}>{copy.payWith}</Text>
            {paymentNetworks.map((network) => {
              const selected = selectedPaymentNetwork === network.key;
              return (
                <Pressable
                  key={network.key}
                  disabled={network.enabled === false}
                  onPress={() => {
                    if (network.enabled !== false) {
                      setSelectedPaymentNetwork(network.key as DriverPaymentNetworkKey);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.fintechMethodRow,
                    selected && styles.fintechMethodRowSelected,
                    pressed && network.enabled !== false && styles.buttonPressed,
                  ]}>
                  <View style={[styles.fintechLogoTile, paymentNetworkTileStyle(network.key)]}>
                    <Image source={paymentNetworkLogo(network.key)} style={styles.fintechLogoImage} resizeMode="contain" />
                  </View>
                  <View style={styles.fintechMethodCopy}>
                    <Text style={styles.fintechMethodName}>{network.label}</Text>
                    <Text style={styles.fintechMethodProvider}>{network.provider}</Text>
                  </View>
                  <View style={[styles.fintechRadio, selected && styles.fintechRadioOn]}>
                    {selected ? <View style={styles.fintechRadioDot} /> : null}
                  </View>
                </Pressable>
              );
            })}

            <Text style={styles.fintechSectionLabel}>{copy.payPhone}</Text>
            <TextInput
              value={paymentPhoneNumber}
              onChangeText={setPaymentPhoneNumber}
              keyboardType="phone-pad"
              placeholder={driverProfile?.phoneNumber || '07XX XXX XXX'}
              placeholderTextColor="#94A3B8"
              style={styles.fintechInput}
            />

            <Pressable
              onPress={() => void handleInitiateMongikePayment()}
              disabled={busyAction === 'commission-payment'}
              style={({ pressed }) => [
                styles.fintechPrimaryButton,
                pressed && styles.buttonPressed,
                busyAction === 'commission-payment' && styles.fintechButtonDisabled,
              ]}>
              <Text style={styles.fintechPrimaryButtonText}>
                {busyAction === 'commission-payment'
                  ? 'Inatuma…'
                  : `Lipa · TZS ${dailyCommissionDue.toLocaleString()}`}
              </Text>
            </Pressable>
            <Text style={styles.fintechFootnote}>{copy.payConfirmPin}</Text>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  const renderAccountTab = () => {
    if (accountView === 'payments') {
      return renderPaymentAccountPage();
    }

    return (
      <View style={styles.flex}>
        {feedback ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <FeedbackBanner tone={feedback.tone} message={feedback.message} />
          </View>
        ) : null}
        <PilotHelpScreen
          title={copy.helpTitle}
          subtitle={copy.helpSubtitle}
          tipsTitle={copy.helpTipsTitle}
          tips={[copy.helpTipOnline, copy.helpTipRoute, copy.helpTipCommission]}
          rows={[
            {
              key: 'call',
              icon: 'phone-outline',
              iconColor: '#34C759',
              iconBg: '#14301F',
              title: copy.helpCall,
              subtitle: copy.helpCallHint,
              onPress: () => void openSupportCall(),
            },
            {
              key: 'whatsapp',
              icon: 'whatsapp',
              iconColor: '#22C55E',
              iconBg: '#14301F',
              title: copy.helpWhatsApp,
              subtitle: copy.helpWhatsAppHint,
              onPress: () => void openSupportWhatsApp(),
            },
            {
              key: 'alerts',
              icon: 'bell-outline',
              iconColor: '#38BDF8',
              iconBg: '#0F2740',
              title: copy.helpAlerts,
              subtitle: copy.helpAlertsHint,
              onPress: () => setSelectedTab('notifications'),
            },
            {
              key: 'rewards',
              icon: 'trophy-outline',
              iconColor: '#F5A623',
              iconBg: '#2E2410',
              title: copy.helpRewards,
              subtitle: copy.helpRewardsHint,
              onPress: () => {
                Alert.alert(copy.howItWorks, pilotTiersExplanation(language === 'sw' ? 'sw' : 'en'), [
                  { text: copy.cancelTripKeep, style: 'cancel' },
                  { text: copy.haulRewards, onPress: () => setSelectedTab('earn') },
                ]);
              },
            },
            {
              key: 'terms',
              icon: 'file-document-outline',
              iconColor: '#94A3B8',
              iconBg: '#1C222B',
              title: copy.helpTerms,
              subtitle: TERMS_URL.replace('https://', ''),
              onPress: () => void Linking.openURL(TERMS_URL),
            },
            {
              key: 'privacy',
              icon: 'shield-lock-outline',
              iconColor: '#94A3B8',
              iconBg: '#1C222B',
              title: copy.helpPrivacy,
              subtitle: PRIVACY_URL.replace('https://', ''),
              onPress: () => void Linking.openURL(PRIVACY_URL),
            },
          ]}
        />
      </View>
    );
  };

  // ──────────────────────────────────────────────
  // Main return (unchanged)
  // ──────────────────────────────────────────────
  if (typeof global !== 'undefined' && (global as any).ErrorUtils && !(global as any).__dd_global_handler_installed) {
    try {
      const previous = (global as any).ErrorUtils.getGlobalHandler?.();
      (global as any).ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        setFeedback({
          tone: 'error',
          message: isFatal
            ? 'A fatal app error was caught. Restart HAUL Pilots if the screen becomes unstable.'
            : 'A background app error was caught while HAUL Pilots kept running.',
        });
        try {
          // call previous if available
          if (typeof previous === 'function') previous(error, isFatal);
        } catch (e) {
          // ignore
        }
      });
      (global as any).__dd_global_handler_installed = true;
    } catch (e) {
      // ignore
    }
  }

  if (!pilotIntroReady) {
    return (
      <ErrorBoundary>
        <View style={{ flex: 1, backgroundColor: '#FFE500' }} />
      </ErrorBoundary>
    );
  }

  if (!pilotIntroDone) {
    return (
      <ErrorBoundary>
        <PilotIntro
          onFinished={() => {
            void markPilotIntroSeen();
            setPilotIntroDone(true);
            setShowStartupSplash(false);
          }}
        />
      </ErrorBoundary>
    );
  }

  if (authInitializing) {
    return (
      <ErrorBoundary>
        <View style={{ flex: 1, backgroundColor: '#FFE500', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: driveType.bold, color: '#111827', fontSize: 16 }}>{copy.splashConnecting}</Text>
        </View>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaView style={[styles.safeArea, statusBarInset ? { paddingTop: statusBarInset } : null]}>
      <StatusBar style="light" backgroundColor={driveTheme.colors.canvas} translucent />
	      {!authUser ? (
        renderAuthScreen()
      ) : profileLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={driveTheme.colors.ink} />
          <Text style={styles.loadingText}>{copy.profileLoading}</Text>
        </View>
      ) : driverVerificationRejected ? (
        renderDriverBlockedScreen()
      ) : needsVehicleChoice ? (
        renderVehicleChoiceScreen()
      ) : registrationSubmitted || driverVerificationPending ? (
        renderVerificationStatusScreen()
      ) : driverProfileMissing ? (
        renderProfileSetup()
      ) : (
        <View style={styles.flex}>
          <View style={styles.appBody}>
          {driverAccessBlocked && selectedTab !== 'account' ? renderAccessRenewalScreen() : null}
          {!driverAccessBlocked && selectedTab === 'home' ? renderHomeTab() : null}
          {!driverAccessBlocked && selectedTab === 'trip' ? renderTripTab() : null}
          {!driverAccessBlocked && selectedTab === 'earn' ? renderEarnTab() : null}
          {!driverAccessBlocked && selectedTab === 'history' ? renderHistoryTab() : null}
          {!driverAccessBlocked && selectedTab === 'notifications' ? renderNotificationsTab() : null}
          {selectedTab === 'account' ? renderAccountTab() : null}
          </View>

          <View style={[styles.bottomNav, androidNavInset ? { paddingBottom: androidNavInset } : null]}>
            {tabs.map((tab) => {
              const active = selectedTab === tab.key || (tab.key === 'home' && selectedTab === 'trip');
              const label =
                tab.key === 'home'
                  ? copy.tabHome
                  : tab.key === 'earn'
                    ? copy.tabEarn
                    : tab.key === 'history'
                      ? copy.tabHistory
                      : copy.tabAccount;

              return (
                <BoltBottomNavItem
                  key={tab.key}
                  icon={tab.icon}
                  label={label}
                  active={active}
                  badge={undefined}
                  onPress={() => {
                    if (tab.key === 'account') {
                      setAccountView('overview');
                    }
                    if (tab.key === 'home' && activeOrder && !isIncomingOffer(activeOrder)) {
                      // Keep driver on the in-app map home (do not bounce to empty trip chrome).
                      setSelectedTab('home');
                      return;
                    }
                    setSelectedTab(tab.key);
                  }}
                />
              );
            })}
          </View>
        </View>
      )}

      {activeOrder ? (
        <Modal
          visible={tripChatOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setTripChatOpen(false)}>
          <KeyboardAvoidingView style={styles.tripChatModalRoot} behavior="padding">
            <Pressable style={styles.tripChatBackdrop} onPress={() => setTripChatOpen(false)} />
            <View style={styles.tripChatSheet}>
              <View style={styles.tripChatSheetHandle} />
              <View style={styles.tripChatHeader}>
                <View style={styles.tripChatHeaderCopy}>
                  <Text style={styles.tripChatHeaderTitle}>{copy.customerChat}</Text>
                  <Text style={styles.tripChatHeaderSubtitle} numberOfLines={1}>
                    {activeOrder.customerName || activeOrder.recipientName || activeOrder.orderNumber}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setTripChatOpen(false)}
                  style={({ pressed }) => [styles.tripChatCloseButton, pressed && styles.buttonPressed]}>
                  <MaterialCommunityIcons name="close" size={20} color="#0F172A" />
                </Pressable>
              </View>

              {tripMessagesLoading ? (
                <View style={styles.tripChatEmpty}>
                  <ActivityIndicator color={driveTheme.colors.ink} />
                </View>
              ) : tripMessages.length ? (
                <ScrollView
                  style={styles.tripChatThread}
                  contentContainerStyle={styles.tripChatThreadContent}
                  keyboardShouldPersistTaps="handled">
                  {tripMessages.map((item) => {
                    const isDriverMessage = item.senderRole === 'driver';
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.tripMessageRow,
                          isDriverMessage ? styles.tripMessageRowSelf : styles.tripMessageRowOther,
                        ]}>
                        <View
                          style={[
                            styles.tripMessageBubble,
                            isDriverMessage ? styles.tripMessageBubbleSelf : styles.tripMessageBubbleOther,
                          ]}>
                          <Text
                            style={[
                              styles.tripMessageSender,
                              isDriverMessage ? styles.tripMessageSenderSelf : styles.tripMessageSenderOther,
                            ]}>
                            {isDriverMessage ? copy.tripChatYou : item.senderName || activeOrder.customerName}
                          </Text>
                          <Text
                            style={[
                              styles.tripMessageText,
                              isDriverMessage ? styles.tripMessageTextSelf : styles.tripMessageTextOther,
                            ]}>
                            {item.message}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.tripChatEmpty}>
                  <MaterialCommunityIcons name="message-text-outline" size={28} color={driveTheme.colors.ink} />
                  <Text style={styles.tripHelperText}>{copy.tripNoMessages}</Text>
                </View>
              )}

              <View style={styles.tripMessageComposer}>
                <TextInput
                  value={tripMessageDraft}
                  onChangeText={setTripMessageDraft}
                  editable={!tripMessageSending}
                  multiline
                  maxLength={240}
                  placeholder={copy.messageCustomer}
                  placeholderTextColor="#94A3B8"
                  style={styles.tripMessageInput}
                  textAlignVertical="top"
                />
                <Pressable
                  disabled={!tripMessageDraft.trim() || tripMessageSending}
                  onPress={() => void handleSendCustomerMessage()}
                  style={({ pressed }) => [
                    styles.tripMessageSendButton,
                    (!tripMessageDraft.trim() || tripMessageSending) && styles.tripMessageSendButtonDisabled,
                    pressed && tripMessageDraft.trim() && !tripMessageSending && styles.buttonPressed,
                  ]}>
                  <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
                  <Text style={styles.tripMessageSendText}>{tripMessageSending ? copy.sending : copy.send}</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}

      <PilotOrderCancelledModal
        visible={orderCancelledVisible}
        title={copy.orderCancelledTitle}
        message={copy.orderCancelledMessage}
        closeLabel={copy.orderCancelledClose}
        onClose={() => setOrderCancelledVisible(false)}
      />

      <DriveCancelReasonSheet
        visible={cancelReasonOpen}
        title={copy.cancelReasonTitle}
        subtitle={copy.cancelReasonBody}
        presets={[
          copy.cancelReasonCustomerBusy,
          copy.cancelReasonWrongAddress,
          copy.cancelReasonVehicle,
          copy.cancelReasonSafety,
          copy.cancelReasonOther,
        ]}
        placeholder={copy.cancelReasonPlaceholder}
        confirmLabel={busyAction === 'trip-cancelled' ? copy.cancelling : copy.cancelReasonConfirm}
        keepLabel={copy.cancelTripKeep}
        loading={busyAction === 'trip-cancelled'}
        onClose={() => {
          if (busyAction === 'trip-cancelled') return;
          setCancelReasonOpen(false);
        }}
        onConfirm={handleConfirmCancelWithReason}
      />

      <PilotMenuDrawer
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        driverName={driverProfile?.fullName || authUser?.displayName || 'HAUL Pilots'}
        vehicleLine={`${getVehicleTypeLabel(driverProfile?.vehicleType || driverProfile?.vehicleLabel)} • ${driverProfile?.plateNumber || copy.platePending}`}
        online={Boolean(driverProfile?.isAvailable)}
        onlineLabel={copy.online}
        offlineLabel={copy.offline}
        language={language}
        onLanguageEn={() => chooseLanguage('en')}
        onLanguageSw={() => chooseLanguage('sw')}
        languageTitle={copy.language}
        languageEn={copy.languageEnglish}
        languageSw={copy.languageSwahili}
        autoConfirm={autoConfirm}
        onAutoConfirmChange={setAutoConfirm}
        autoConfirmTitle={copy.autoConfirm}
        autoConfirmHint={copy.autoConfirmHint}
        items={[
          {
            key: 'access',
            icon: 'cash-fast',
            title: copy.menuAccess,
            subtitle: hasCommissionDue
              ? `TZS ${commissionSummary.unpaidTzs.toLocaleString()}`
              : copy.accessFreeHint,
            onPress: () => {
              setMenuOpen(false);
              setPaymentCheckoutStep(subscriptionPaymentPending ? 'submitted' : 'proof');
              setPaymentPhoneNumber((currentPhone) => currentPhone || driverProfile?.phoneNumber || '');
              setAccountView('payments');
              setSelectedTab('account');
            },
          },
          {
            key: 'profile',
            icon: 'card-account-details-outline',
            title: copy.menuProfile,
            subtitle: driverProfile?.phoneNumber || copy.notSet,
            onPress: () => {
              setMenuOpen(false);
              setFeedback({
                tone: 'info',
                message: `${copy.phoneNumber}: ${driverProfile?.phoneNumber || copy.notSet}`,
              });
            },
          },
          {
            key: 'location',
            icon: 'crosshairs-gps',
            title: copy.menuLocation,
            subtitle:
              locationPermission === 'granted' ? copy.locationActive : copy.locationNeedsAccess,
            onPress: () => {
              setMenuOpen(false);
              void handleManualLocationRefresh();
            },
          },
          {
            key: 'alerts',
            icon: 'bell-outline',
            title: copy.tabAlerts,
            subtitle: unreadNotificationCount
              ? `${unreadNotificationCount} ${copy.alertsLive}`
              : copy.alertsSubtitle,
            onPress: () => {
              setMenuOpen(false);
              setSelectedTab('notifications');
            },
          },
        ]}
        signOutLabel={busyAction === 'sign-out' ? copy.signingOut : copy.signOut}
        onSignOut={() => {
          setMenuOpen(false);
          void handleSignOut();
        }}
      />
      </SafeAreaView>
    </ErrorBoundary>
  );
}

// ──────────────────────────────────────────────
// Styles (unchanged except for a few new ones)
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  splashSafeArea: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  flex: {
    flex: 1,
    minHeight: 0,
  },
  appBody: {
    flex: 1,
    minHeight: 0,
  },
  lockFeedbackWrap: {
    paddingHorizontal: driveTheme.spacing.lg,
    paddingTop: driveTheme.spacing.sm,
  },
  splashScreen: {
    flex: 1,
    backgroundColor: driveTheme.colors.primary,
  },
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 18,
  },
  splashLogo: {
    width: 128,
    height: 128,
    borderRadius: 32,
  },
  splashArt: {
    width: 120,
    height: 120,
    marginTop: 8,
    opacity: 0.92,
  },
  splashTagline: {
    marginTop: 20,
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: driveType.semibold,
    textAlign: 'center',
  },
  splashFooter: {
    paddingHorizontal: 56,
    paddingBottom: 40,
  },
  splashProgressTrack: {
    height: 3,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  splashProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  loadingText: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  authCanvas: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  authQuietPage: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
    gap: 16,
    justifyContent: 'center',
  },
  authScroll: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 16,
    justifyContent: 'flex-start',
  },
  authBackButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: driveTheme.colors.surface,
    marginBottom: 8,
  },
  authHeroBlock: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 4,
    width: '100%',
    paddingHorizontal: 4,
  },
  authHeroTitle: {
    color: driveTheme.colors.primary,
    fontSize: 28,
    lineHeight: 36,
    fontFamily: driveType.bold,
    textAlign: 'center',
    letterSpacing: 0.4,
    width: '100%',
    flexShrink: 1,
  },
  authIllustrationWell: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    marginTop: 6,
    borderRadius: 28,
    backgroundColor: driveTheme.colors.surfaceMuted,
  },
  authFormStack: {
    width: '100%',
    gap: 14,
  },
  authPageTitle: {
    color: driveTheme.colors.ink,
    fontSize: 26,
    lineHeight: 32,
    fontFamily: driveType.bold,
    textAlign: 'left',
    letterSpacing: -0.5,
    marginBottom: 0,
  },
  authLandingHero: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  authLandingLogo: {
    width: 80,
    height: 80,
    borderRadius: 20,
  },
  authWordmark: {
    color: driveTheme.colors.ctaText,
    fontFamily: driveType.bold,
    fontSize: 22,
    letterSpacing: 3,
    backgroundColor: driveTheme.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  authPilotsLine: {
    color: driveTheme.colors.ink,
    fontFamily: driveType.regular,
    fontStyle: 'italic',
    fontSize: 18,
    marginTop: -2,
  },
  waitingVehicleLine: {
    alignSelf: 'center',
    backgroundColor: driveTheme.colors.surfaceElevated,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  waitingVehicleText: {
    color: driveTheme.colors.ink,
    fontFamily: driveType.semibold,
    fontSize: 14,
  },
  authLandingTitle: {
    textAlign: 'center',
    marginTop: 4,
    fontSize: 32,
    lineHeight: 38,
  },
  authLandingSubtitle: {
    textAlign: 'center',
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
    fontFamily: driveType.regular,
    maxWidth: '100%',
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  authFieldHint: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: driveType.semibold,
    marginTop: 4,
  },
  authTermsRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 8,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.surface,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
  },
  authTermsText: {
    flex: 1,
    minWidth: 0,
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 20,
    fontFamily: driveType.regular,
    flexShrink: 1,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 42,
    paddingBottom: 28,
    gap: 20,
  },
  registerScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 22,
    gap: 18,
  },
  authTopBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  authBrandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authMarkSmall: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: driveTheme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBrandTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  authBrandCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  authLivePill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
  },
  authLivePillText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  authIconButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
  },
  authHeaderSpacer: {
    width: 44,
  },
  registerTopBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  registerBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E9FBEF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerBrandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  registerLogoShell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFE8D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerLogoImage: {
    width: 26,
    height: 26,
  },
  registerBrandName: {
    color: driveTheme.colors.primaryDark,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  registerHeaderSpacer: {
    width: 42,
  },
  loginIntro: {
    alignItems: 'center',
    gap: 6,
  },
  loginBrandHeader: {
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  loginLogoShell: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#E9FBEF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginLogoImage: {
    width: 42,
    height: 42,
  },
  loginBrandName: {
    color: driveTheme.colors.primaryDark,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
  },
  authHeroMark: {
    width: 78,
    height: 78,
    borderRadius: 24,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#064E3B',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  loginPanel: {
    gap: 15,
  },
  registerHero: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  authEyebrow: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  authHeadline: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  authSubcopy: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  authFormPanel: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  loginHero: {
    minHeight: 452,
    justifyContent: 'space-between',
    backgroundColor: '#0B1220',
  },
  loginHeroImage: {
    opacity: 0.84,
  },
  loginHeroTint: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 64,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(11, 18, 32, 0.42)',
  },
  loginBrandBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  loginBrandText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 13,
    fontWeight: '900',
  },
  loginHeroCopy: {
    maxWidth: 330,
    gap: 8,
  },
  loginHeroTitle: {
    color: '#FFFFFF',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
  },
  loginHeroText: {
    color: '#E2E8F0',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  loginSheet: {
    marginTop: -34,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -12 },
    shadowRadius: 28,
    elevation: 8,
  },
  loginSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emailOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emailOnlyText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  loginCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginTitle: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  loginSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  loginSecondaryAction: {
    minHeight: 40,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  loginSecondaryActionText: {
    color: driveTheme.colors.primary,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.bold,
    flexShrink: 1,
  },
  loginSecondaryActionMuted: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.regular,
    flexShrink: 1,
  },
  authScreenTopBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  authTopBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authTopLogo: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  authTopBrandName: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    fontFamily: driveType.bold,
    letterSpacing: -0.2,
  },
  authBackQuiet: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  authLanguageQuiet: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.semibold,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  authHeroCopy: {
    gap: 6,
    marginTop: 10,
    marginBottom: 6,
  },
  registerProgressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.surfaceElevated,
    overflow: 'hidden',
    marginTop: 8,
  },
  registerProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
  },
  registerStepMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontFamily: driveType.semibold,
    marginTop: 8,
  },
  formSection: {
    gap: 12,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
  },
  formSectionTitle: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: driveType.bold,
  },
  formSectionBody: {
    gap: 10,
  },
  authFormCard: {
    gap: 12,
    marginTop: 12,
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    ...driveTheme.shadows.card,
  },
  photoStage: {
    gap: 16,
    marginTop: 4,
  },
  photoStageFrame: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F4F7F5',
    borderWidth: 1.5,
    borderColor: '#D7E3DB',
    borderStyle: 'dashed',
  },
  photoStageFrameVehicle: {
    aspectRatio: 4 / 3,
  },
  photoStageFrameFilled: {
    borderStyle: 'solid',
    borderColor: '#86EFAC',
  },
  photoStageFramePortrait: {
    alignSelf: 'center',
    width: '78%',
    aspectRatio: 3 / 4,
    borderRadius: 28,
  },
  photoStageImage: {
    width: '100%',
    height: '100%',
  },
  photoStageEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  photoStageIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#E8F8EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  photoStageEmptyTitle: {
    color: driveTheme.colors.ink,
    fontSize: 17,
    fontFamily: driveType.bold,
    textAlign: 'center',
  },
  photoStageEmptyHint: {
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.regular,
    textAlign: 'center',
  },
  photoStageRetake: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  photoStageRetakeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: driveType.semibold,
  },
  photoTipList: {
    gap: 8,
  },
  photoTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photoTipText: {
    flex: 1,
    color: driveTheme.colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.regular,
  },
  photoActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  authHeroSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: driveType.regular,
  },
  authLanguageButton: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  authLanguageButtonText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 13,
    fontFamily: driveType.bold,
  },
  authForgotButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  authForgotButtonText: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.semibold,
  },
  authDialCode: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: driveType.semibold,
  },
  authCountryCode: {
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: 28,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: driveTheme.colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  setupScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  setupHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setupBackButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0FDF4',
  },
  setupHeaderSpacer: {
    width: 46,
  },
  setupTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontFamily: driveType.bold,
    textAlign: 'center',
  },
  setupIntro: {
    color: driveTheme.colors.subtext,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 14,
    marginBottom: 12,
    fontFamily: driveType.regular,
  },
  setupProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setupStepItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  setupStepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupStepCircleActive: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  setupStepCircleComplete: {
    backgroundColor: driveTheme.colors.primary,
    borderColor: driveTheme.colors.primary,
  },
  setupStepLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '800',
  },
  setupStepLabelActive: {
    color: driveTheme.colors.primaryDark,
  },
  setupConnector: {
    flex: 1,
    height: 1,
    backgroundColor: '#CFE8D8',
    marginHorizontal: 4,
    marginBottom: 20,
  },
  setupConnectorActive: {
    backgroundColor: driveTheme.colors.primary,
  },
  setupScroll: {
    flexGrow: 1,
    paddingBottom: 28,
    gap: 16,
  },
  setupFormStack: {
    gap: 14,
  },
  setupInputShell: {
    minHeight: 56,
    borderRadius: 28,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: driveTheme.colors.surfaceMuted,
    paddingLeft: 18,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  setupTextInput: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: driveType.regular,
    minHeight: 48,
    paddingVertical: 12,
    paddingRight: 8,
  },
  setupTextInputCentered: {
    textAlign: 'center',
  },
  setupPasswordToggle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupInputShellPlain: {
    paddingRight: 18,
  },
  setupSelectShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  setupSelectText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  setupSelectPlaceholder: {
    color: driveTheme.colors.muted,
  },
  setupColorSwatch: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  setupPhoneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  setupCountryCode: {
    width: 92,
    minHeight: 56,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  setupFlagText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontFamily: driveType.bold,
  },
  setupPhoneInput: {
    flex: 1,
  },
  setupMiniLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  setupVehiclePickerWrap: {
    gap: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  setupHintText: {
    color: driveTheme.colors.warning,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  setupNotice: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.primarySoft,
    padding: 14,
    alignItems: 'flex-start',
  },
  setupNoticeText: {
    flex: 1,
    color: driveTheme.colors.primaryDark,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  termsPanel: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    padding: 12,
  },
  termsPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  termsPanelTitle: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  termsFinePrint: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  termsAgreeRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: driveTheme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  termsAgreeRowActive: {
    borderColor: driveTheme.colors.primary,
    backgroundColor: driveTheme.colors.primarySoft,
  },
  loginTermsAgreeRow: {
    marginTop: 2,
  },
  termsCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: driveTheme.colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: driveTheme.colors.surfaceElevated,
  },
  termsCheckboxActive: {
    backgroundColor: driveTheme.colors.cta,
    borderColor: driveTheme.colors.cta,
  },
  termsAgreeText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  registerFooter: {
    borderTopWidth: 1,
    borderTopColor: driveTheme.colors.line,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 18,
  },
  setupFooter: {
    marginHorizontal: -20,
    borderTopWidth: 1,
    borderTopColor: driveTheme.colors.line,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 22,
  },
  verificationScreen: {
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 20,
    paddingVertical: 28,
    justifyContent: 'center',
  },
  verificationCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 22,
    gap: 18,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 32,
    elevation: 8,
  },
  verificationArt: {
    width: 112,
    height: 112,
    alignSelf: 'center',
    marginBottom: 8,
  },
  leadMessageAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0FDF4',
  },
  verificationCopy: {
    gap: 8,
    alignItems: 'center',
  },
  verificationEyebrow: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: driveType.semibold,
  },
  verificationTitle: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontFamily: driveType.bold,
    textAlign: 'center',
  },
  verificationText: {
    color: driveTheme.colors.subtext,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: driveType.regular,
    textAlign: 'center',
  },
  verificationChecklist: {
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#F8FFFB',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    padding: 14,
  },
  verificationCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verificationCheckText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: driveType.semibold,
  },
  verificationActions: {
    gap: 12,
  },
  verificationSignOut: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  verificationSignOutText: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontFamily: driveType.bold,
  },
  documentList: {
    gap: 14,
  },
  documentRow: {
    minHeight: 104,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  documentIconShell: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  documentThumb: {
    width: '100%',
    height: '100%',
  },
  documentCopy: {
    flex: 1,
    gap: 4,
  },
  documentTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  documentHelper: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  documentUploadButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  documentUploadButtonDone: {
    backgroundColor: driveTheme.colors.cta,
    borderColor: driveTheme.colors.cta,
  },
  documentUploadText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  documentUploadTextDone: {
    color: '#FFFFFF',
  },
  authHeroShell: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: driveTheme.radius.xl,
  },
  authGlowPrimary: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(134, 239, 172, 0.14)',
    top: -40,
    right: -30,
    zIndex: 1,
  },
  authGlowSecondary: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    bottom: -30,
    left: -20,
    zIndex: 1,
  },
  dashboardContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 14,
  },
  pageHeader: {
    gap: 4,
    paddingTop: 4,
    paddingBottom: 4,
  },
  pageTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 28,
    lineHeight: 34,
  },
  pageSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  homeTabContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },
  homeScreen: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
  },
  homeDashboard: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  homeMapCard: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    overflow: 'hidden',
    ...driveTheme.shadows.card,
  },
  homeMapCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  homeMapCardTitle: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.ink,
    fontSize: 14,
    letterSpacing: -0.2,
  },
  homeMapLiveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: driveTheme.colors.onlineSoft,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  homeMapLiveText: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.primaryDark,
    fontSize: 11,
  },
  homeMapCardBody: {
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: driveTheme.colors.line,
  },
  homeMapCardMap: {
    width: '100%',
    height: '100%',
  },
  homeTripCard: {
    gap: 12,
  },
  homeDeclineInline: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  homeDeclineInlineText: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.danger,
    fontSize: 14,
  },
  homeMapFill: {
    ...StyleSheet.absoluteFillObject,
  },
  homeMapWrap: {
    flex: 1,
    backgroundColor: driveTheme.colors.canvas,
    overflow: 'hidden',
  },
  homeFloatingHeader: {
    position: 'absolute',
    top: 10,
    left: 14,
    right: 14,
    zIndex: 4,
    gap: 10,
  },
  boltTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  boltGoOnlineWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 6,
    gap: 10,
    alignItems: 'center',
  },
  boltMapToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  boltMapToolsSpacer: {
    flex: 1,
  },
  boltSheetStatus: {
    fontFamily: driveType.bold,
    fontSize: 17,
    color: driveTheme.colors.ink,
    marginBottom: 4,
  },
  boltSheetHint: {
    fontFamily: driveType.regular,
    fontSize: 13,
    color: driveTheme.colors.subtext,
    marginBottom: 8,
  },
  ridesTitle: {
    fontFamily: driveType.bold,
    fontSize: 32,
    color: driveTheme.colors.ink,
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  ridesContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: driveTheme.colors.canvas,
  },
  homeDemandChip: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  homeDemandEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  homeDemandCopy: {
    flex: 1,
    minWidth: 0,
  },
  homeDemandTitle: {
    fontFamily: driveType.bold,
    color: '#14532D',
    fontSize: 14,
    lineHeight: 18,
  },
  homeDemandHint: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  nearbyPersonPin: {
    alignItems: 'center',
  },
  nearbyPersonBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14532D',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 5,
  },
  nearbyPersonEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  nearbyPersonStem: {
    width: 3,
    height: 7,
    backgroundColor: '#16A34A',
  },
  nearbyPersonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: -2,
  },
  leadMessageSheet: {
    maxHeight: '72%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  leadMessageThread: {
    maxHeight: 140,
  },
  leadTemplateScroll: {
    maxHeight: 280,
  },
  leadTemplateGrid: {
    gap: 8,
    paddingVertical: 4,
  },
  leadTemplateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 8,
  },
  leadTemplateChipDisabled: {
    opacity: 0.5,
  },
  leadTemplateIcon: {
    flexShrink: 0,
  },
  leadTemplateText: {
    fontFamily: driveType.semibold,
    color: '#14532D',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  leadSimpleHintWrap: {
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  leadSimpleHint: {
    fontFamily: driveType.semibold,
    color: '#334155',
    fontSize: 12,
    lineHeight: 18,
  },
  leadSendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  leadSendingText: {
    fontFamily: driveType.semibold,
    color: '#16A34A',
    fontSize: 13,
  },
  leadQuickRow: {
    gap: 8,
  },
  leadQuickChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  leadQuickChipText: {
    fontFamily: driveType.semibold,
    color: '#14532D',
    fontSize: 13,
    lineHeight: 18,
  },
  tripScreenContent: {
    flexGrow: 1,
    paddingBottom: 24,
    gap: 0,
  },
  tripScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  tripEmptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  tripMapWrap: {
    flex: 1,
    minHeight: 160,
    backgroundColor: '#E7EEF0',
    overflow: 'hidden',
  },
  mapCardFill: {
    flex: 1,
    minHeight: 0,
  },
  mapViewFill: {
    ...StyleSheet.absoluteFillObject,
  },
  mapOverlayCompact: {
    padding: 12,
    justifyContent: 'flex-start',
  },
  mapOverlayTopCompact: {
    justifyContent: 'flex-end',
  },
  tripDock: {
    flexShrink: 0,
  },
  tripDockSheet: {
    flexShrink: 0,
  },
  tripNowRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  tripNowCopy: {
    flex: 1,
    minWidth: 0,
  },
  tripNowKicker: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tripNowTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 2,
    letterSpacing: -0.6,
  },
  tripDockFare: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  tripPrimaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tripPrimaryButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 17,
    letterSpacing: 0.3,
  },
  tripQuickRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  tripQuickButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tripQuickButtonActive: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  tripQuickButtonText: {
    fontFamily: driveType.semibold,
    color: '#14532D',
    fontSize: 12,
    textAlign: 'center',
  },
  tripChatBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tripChatBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  tripChatModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  tripChatBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  tripChatSheet: {
    height: '72%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 12,
  },
  tripChatSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 4,
  },
  tripChatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tripChatHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  tripChatHeaderTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 18,
  },
  tripChatHeaderSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  tripChatCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripChatEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  tripChatThread: {
    flex: 1,
  },
  tripChatThreadContent: {
    gap: 10,
    paddingBottom: 8,
  },
  heroCard: {
    borderRadius: driveTheme.radius.xl,
    padding: 22,
    backgroundColor: driveTheme.colors.dark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 30,
    elevation: 6,
  },
  heroKicker: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginBottom: 10,
  },
  heroText: {
    color: '#D7E1EA',
    fontSize: 14,
    lineHeight: 22,
  },
  authShowcaseRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  authShowcaseCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    gap: 4,
  },
  authShowcaseValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  authShowcaseLabel: {
    color: '#C9D6E2',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  tripHero: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: driveTheme.colors.dark,
    gap: 10,
  },
  tripHeroTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
  },
  tripHeroText: {
    color: '#D7E1EA',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  tripMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  tripMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: driveTheme.radius.pill,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tripMetricText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  homeTopPanel: {
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: driveTheme.colors.line,
  },
  homeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeTopIdentity: {
    flex: 1,
    gap: 8,
  },
  homeGreeting: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  homeStatusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  homeStatusPillOnline: {
    backgroundColor: '#DCFCE7',
  },
  homeStatusPillOffline: {
    backgroundColor: '#F1F5F9',
  },
  homeStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  homeStatusDotOnline: {
    backgroundColor: '#16A34A',
  },
  homeStatusDotOffline: {
    backgroundColor: '#94A3B8',
  },
  homeStatusPillText: {
    fontFamily: driveType.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  homeStatusPillTextOnline: {
    color: '#14532D',
  },
  homeStatusPillTextOffline: {
    color: '#475569',
  },
  homeEarningsCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: '#E8EEF2',
  },
  homeEarningsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeEarningsKicker: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  homeEarningsValue: {
    fontFamily: driveType.bold,
    color: '#14532D',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
    marginTop: 6,
    marginBottom: 12,
  },
  homeEarningsStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  homeEarningsStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  homeEarningsStatValue: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  homeEarningsStatLabel: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    textAlign: 'center',
  },
  homeEarningsStatDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  homeEarningsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  homeEarningsFooterText: {
    flex: 1,
    fontFamily: driveType.semibold,
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  homeEarningsFooterMeta: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
  },
  homeIconChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E8EEF2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EA580C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationDotText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 9,
  },
  homeDueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  homeDueBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeDueBannerCopy: {
    flex: 1,
    gap: 2,
  },
  homeDueBannerOverdue: {
    backgroundColor: '#FFF7ED',
  },
  homeDueBannerPending: {
    backgroundColor: '#EFF6FF',
  },
  homeDueBannerText: {
    fontFamily: driveType.semibold,
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 18,
  },
  homeDueBannerMeta: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
  },
  homeBottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    paddingHorizontal: 4,
  },
  homeDeclinePill: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: driveTheme.colors.cta,
    borderRadius: driveTheme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...driveTheme.shadows.pill,
  },
  homeDeclinePillText: {
    fontFamily: driveType.semibold,
    color: '#FFFFFF',
    fontSize: 14,
  },
  homeBoltCard: {
    backgroundColor: '#16A34A',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 4,
    shadowColor: '#14532D',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: -6 },
    shadowRadius: 18,
    elevation: 12,
  },
  homeBoltStats: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 32,
  },
  homeBoltPlace: {
    fontFamily: driveType.semibold,
    color: '#F0FDF4',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 2,
  },
  homeBoltCustomer: {
    fontFamily: driveType.regular,
    color: '#DCFCE7',
    fontSize: 14,
    lineHeight: 20,
  },
  homeBoltFare: {
    fontFamily: driveType.semibold,
    color: '#FFFFFF',
    fontSize: 16,
  },
  homeBoltFareRow: {
    marginTop: 10,
    marginBottom: 8,
  },
  homeBoltAcceptBar: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeBoltAcceptText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
    letterSpacing: 0.8,
    textAlign: 'center',
    marginTop: 0,
  },
  homeSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 20,
    elevation: 10,
  },
  homeBrokerageCard: {
    gap: 8,
  },
  homeAccessPeriodTitle: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  homeBrokerageKicker: {
    fontFamily: driveType.semibold,
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  homeBrokerageTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeBrokerageAmountWrap: {
    flex: 1,
    minWidth: 0,
  },
  homeBrokerageAmount: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
  },
  homeBrokeragePeriod: {
    fontFamily: driveType.semibold,
    color: '#4B5563',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 4,
  },
  homeBrokerageLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 180,
  },
  homeBrokerageLogo: {
    width: 48,
    height: 36,
    borderRadius: 10,
  },
  homeBrokerageLogoSelected: {
    borderWidth: 2,
    borderColor: '#0B1220',
  },
  homeBrokerageNetwork: {
    fontFamily: driveType.semibold,
    color: '#0B1220',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  homeBrokerageCaption: {
    fontFamily: driveType.regular,
    color: '#111827',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  homeBrokerageNote: {
    fontFamily: driveType.semibold,
    color: '#0B1220',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  homeBrokerageHint: {
    fontFamily: driveType.regular,
    color: '#4B5563',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  homeBrokerageButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  homeBrokerageButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  homeSheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 12,
  },
  homeSheetKicker: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  homeCustomerPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: driveTheme.colors.primarySoft,
    borderRadius: driveTheme.radius.md,
    paddingHorizontal: driveTheme.spacing.md,
    paddingVertical: 10,
    marginBottom: driveTheme.spacing.sm,
  },
  homeCustomerPhoneCopy: { flex: 1 },
  homeCustomerPhoneLabel: { fontFamily: driveType.regular, color: driveTheme.colors.subtext, fontSize: 11 },
  homeCustomerPhoneValue: { fontFamily: driveType.semibold, color: driveTheme.colors.ink, fontSize: 14, marginTop: 1 },
  homeCustomerPhoneAction: { fontFamily: driveType.semibold, color: driveTheme.colors.primaryDark, fontSize: 12 },
  homeFare: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 32,
    lineHeight: 38,
    marginTop: 4,
    marginBottom: 14,
  },
  homeSheetTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
  },
  homeSheetSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 14,
  },
  homeStopList: {
    gap: 0,
    marginBottom: 16,
  },
  homeStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
  },
  homeStopRail: {
    width: 14,
    alignItems: 'center',
    paddingTop: 5,
  },
  homeStopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  homeStopDotPickup: {
    backgroundColor: '#16A34A',
  },
  homeStopDotDropoff: {
    backgroundColor: '#0F172A',
  },
  homeStopLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
    backgroundColor: '#E2E8F0',
    marginTop: 4,
  },
  homeStopCopy: {
    flex: 1,
    paddingBottom: 12,
  },
  homeStopLabel: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 14,
  },
  homeStopValue: {
    fontFamily: driveType.semibold,
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  homeAcceptButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  homeTripActionGrow: {
    flex: 1,
  },
  homeAcceptButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
  },
  homeGhostButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  homeGhostButtonText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 15,
  },
  homeTripActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeIconAction: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeIdleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 16,
    elevation: 8,
  },
  homeSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  homeLiveDotWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16A34A',
  },
  homeIdleCopy: {
    flex: 1,
  },
  homeIdleTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 21,
  },
  homeIdleSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  homeOfflineDock: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  homeGoHalo: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(22, 163, 74, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(22, 163, 74, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeGoButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14532D',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 8,
  },
  homeGoText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 18,
    letterSpacing: 1,
  },
  homeGoCopyCard: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  homeGoCaption: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
  },
  homeGoHint: {
    fontFamily: driveType.regular,
    marginTop: 4,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  homeMapFallback: {
    backgroundColor: '#E7EEF0',
    overflow: 'hidden',
  },
  homeMapGridLineA: {
    position: 'absolute',
    width: 460,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.28)',
    top: '42%',
    left: -70,
    transform: [{ rotate: '-22deg' }],
  },
  homeMapGridLineB: {
    position: 'absolute',
    width: 430,
    height: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
    top: '58%',
    left: -40,
    transform: [{ rotate: '28deg' }],
  },
  homeMapRoutePreview: {
    position: 'absolute',
    width: 220,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#16A34A',
    top: '48%',
    left: 54,
    transform: [{ rotate: '16deg' }],
  },
  homeMapPin: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  homeMapPinPickup: {
    top: '44%',
    left: 44,
    backgroundColor: '#16A34A',
  },
  homeMapPinDropoff: {
    top: '56%',
    right: 48,
    backgroundColor: '#2563EB',
  },
  homeMapVehicle: {
    position: 'absolute',
    top: '49%',
    left: '52%',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#14532D',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-18deg' }],
  },
  customerRatingCard: {
    gap: 14,
  },
  ratingStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingStarButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  customerRatingInput: {
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  homePrimaryMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#16A34A',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  homePrimaryMiniButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  homeSecondaryMiniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  homeSecondaryMiniButtonText: {
    color: '#14532D',
    fontSize: 13,
    fontWeight: '700',
  },
  homeOrderDivider: {
    height: 1,
    backgroundColor: driveTheme.colors.line,
    marginVertical: 6,
  },
  homeOrderDetail: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  quickActionGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  quickAction: {
    flex: 1,
    minHeight: 78,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    position: 'relative',
  },
  quickActionText: {
    color: driveTheme.colors.ink,
    fontSize: 11,
    fontWeight: '900',
  },
  quickActionBadge: {
    position: 'absolute',
    top: 11,
    right: 16,
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.warning,
  },
  metricTileRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricTile: {
    flex: 1,
    minHeight: 108,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    justifyContent: 'space-between',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 2,
  },
  metricTileIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTileValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 24,
  },
  metricTileLabel: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 12,
  },
  card: {
    borderRadius: driveTheme.radius.xl,
    backgroundColor: driveTheme.colors.surface,
    padding: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    gap: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 22,
    elevation: 2,
  },
  cardHeader: {
    gap: 6,
  },
  cardTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 18,
  },
  cardSubtitle: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  authModeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  authModeChip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  authModeChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#BBF7D0',
  },
  authModeText: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  authModeTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  textInput: {
    minHeight: 56,
    borderRadius: driveTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#CFE8D8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    color: driveTheme.colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  stackLg: {
    gap: 16,
  },
  stackMd: {
    gap: 12,
  },
  helperCard: {
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  helperText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
  },
  authFooter: {
    marginTop: 8,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  authFooterText: {
    color: '#CBD5E1',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    flexShrink: 1,
  },
  authLink: {
    color: driveTheme.colors.primary,
    fontFamily: driveType.bold,
    fontWeight: '700',
  },
  buttonBase: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexGrow: 0,
    flexShrink: 1,
    alignSelf: 'stretch',
    paddingHorizontal: 12,
  },
  buttonCompact: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    minHeight: 48,
    height: 48,
    maxHeight: 48,
    borderRadius: 12,
    marginTop: 4,
  },
  buttonGrow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignSelf: 'auto',
  },
  buttonTextCompact: {
    fontSize: 16,
    fontFamily: driveType.semibold,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  buttonPrimary: {
    backgroundColor: driveTheme.colors.cta,
    borderColor: driveTheme.colors.cta,
    borderRadius: 28,
    minHeight: 58,
    marginTop: 4,
  },
  buttonSecondary: {
    backgroundColor: driveTheme.colors.surface,
    borderColor: driveTheme.colors.lineStrong,
  },
  buttonDark: {
    backgroundColor: driveTheme.colors.darkElevated,
    borderColor: driveTheme.colors.lineStrong,
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  buttonPressed: {
    opacity: 0.86,
  },
  buttonTextPrimary: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ctaText,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
    flexShrink: 1,
    paddingHorizontal: 4,
  },
  buttonTextSecondary: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
    flexShrink: 1,
    paddingHorizontal: 4,
  },
  vehicleCardList: {
    gap: 12,
  },
  vehicleCard: {
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: driveTheme.colors.line,
    backgroundColor: driveTheme.colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  vehicleCardActive: {
    borderWidth: 2,
    borderColor: driveTheme.colors.primary,
    backgroundColor: driveTheme.colors.primarySoft,
  },
  vehicleCardArt: {
    width: 84,
    height: 64,
  },
  vehicleCardLabel: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 20,
    fontFamily: driveType.bold,
    letterSpacing: -0.3,
  },
  vehicleCardDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
  },
  vehicleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D7E3DB',
    backgroundColor: '#FFFFFF',
  },
  vehicleChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#111827',
  },
  vehicleChipText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontFamily: driveType.semibold,
  },
  vehicleChipTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: driveTheme.colors.surface,
    paddingHorizontal: 12,
  },
  colorChipActive: {
    borderColor: driveTheme.colors.primary,
    backgroundColor: driveTheme.colors.primarySoft,
  },
  colorChipSwatch: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: driveTheme.colors.lineStrong,
  },
  colorChipText: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  colorChipTextActive: {
    color: driveTheme.colors.primary,
  },
  feedbackBanner: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  feedbackSuccess: {
    backgroundColor: driveTheme.colors.onlineSoft,
  },
  feedbackError: {
    backgroundColor: driveTheme.colors.dangerSoft,
  },
  feedbackInfo: {
    backgroundColor: driveTheme.colors.infoSoft,
  },
  feedbackText: {
    flex: 1,
    minWidth: 0,
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: driveType.semibold,
    flexShrink: 1,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: driveTheme.radius.pill,
  },
  infoPillSuccess: {
    backgroundColor: driveTheme.colors.primarySoft,
  },
  infoPillInfo: {
    backgroundColor: '#DBEAFE',
  },
  infoPillMuted: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  infoPillText: {
    color: '#D7E1EA',
    fontSize: 12,
    fontWeight: '800',
  },
  infoPillTextSuccess: {
    color: driveTheme.colors.primaryDark,
  },
  infoPillTextInfo: {
    color: driveTheme.colors.info,
  },
  statusCard: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  statusCardOnline: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#BBF7D0',
  },
  statusCardOffline: {
    backgroundColor: '#F8FAFC',
    borderColor: driveTheme.colors.line,
  },
  statusCardInfo: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  statusCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusCopy: {
    flex: 1,
  },
  statusCardTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusCardText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 250,
  },
  paymentNoticeCard: {
    borderRadius: driveTheme.radius.xl,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 18,
    gap: 12,
  },
  paymentNoticeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentNoticeTitle: {
    flex: 1,
    color: '#92400E',
    fontSize: 18,
    fontWeight: '900',
  },
  paymentNoticeText: {
    color: '#92400E',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  paymentPageTopbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentBackButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentPageTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  paymentPageKicker: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentPageTitle: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  paymentDebtCard: {
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    padding: 16,
    gap: 14,
  },
  paymentDebtCardDue: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  paymentDebtTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  paymentDebtIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: driveTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentDebtCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentDebtLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentDebtAmount: {
    color: driveTheme.colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
  },
  paymentDebtMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  subscriptionCountdownCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subscriptionCountdownIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#E9FBEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscriptionCountdownCopy: {
    flex: 1,
    minWidth: 0,
  },
  subscriptionCountdownLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subscriptionCountdownValue: {
    color: driveTheme.colors.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  subscriptionCountdownCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  subscriptionFeatureList: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.26)',
    padding: 13,
    gap: 10,
  },
  subscriptionFeatureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  subscriptionFeatureText: {
    flex: 1,
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  paymentReferenceBox: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.32)',
    padding: 12,
    gap: 10,
  },
  paymentReferenceItem: {
    gap: 2,
  },
  paymentReferenceLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentReferenceValue: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentSafetyNote: {
    color: '#92400E',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  paymentCheckoutPanel: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    gap: 14,
  },
  paymentCheckoutTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  paymentProviderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  paymentProviderCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 168,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  paymentProviderCardDisabled: {
    opacity: 0.58,
  },
  paymentProviderIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  paymentProviderLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  paymentNetworkCardImage: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  paymentChosenLogo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  paymentPendingNetworkLogo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
  },
  paymentNetworkPreviewRow: {
    flexDirection: 'row',
    gap: 10,
  },
  paymentNetworkPreviewLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  paymentProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  paymentProgressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
  },
  fintechPayScreen: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
  fintechPayContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  fintechTopbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  fintechBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  fintechBackSpacer: {
    width: 40,
  },
  fintechNavTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#0B1220',
    fontFamily: driveType.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  fintechEyebrow: {
    fontFamily: driveType.semibold,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 6,
  },
  fintechHeroAmount: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: -1.2,
    textAlign: 'center',
  },
  fintechHeroPeriod: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  fintechHeroCaption: {
    fontFamily: driveType.regular,
    color: '#4B5563',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 8,
  },
  fintechHeroNote: {
    fontFamily: driveType.semibold,
    color: '#0B1220',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 6,
  },
  fintechProgressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E8EAED',
    overflow: 'hidden',
    marginTop: 20,
  },
  fintechProgressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#0B1220',
  },
  fintechProgressMeta: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
  },
  fintechStatusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
  },
  fintechStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16A34A',
    marginTop: 5,
  },
  fintechStatusDotWait: {
    backgroundColor: '#2563EB',
  },
  fintechStatusCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fintechStatusTitle: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 16,
    lineHeight: 22,
  },
  fintechStatusBody: {
    fontFamily: driveType.regular,
    color: '#4B5563',
    fontSize: 15,
    lineHeight: 22,
  },
  fintechCheckout: {
    gap: 10,
    marginBottom: 32,
  },
  fintechSectionLabel: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  fintechMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: '#EEF0F3',
  },
  fintechMethodRowSelected: {
    borderColor: '#0B1220',
    backgroundColor: '#FFFFFF',
  },
  fintechLogoTile: {
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fintechLogoTileMpesa: {
    width: 52,
    height: 52,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEEF2',
  },
  fintechLogoTileMixx: {
    width: 76,
    height: 44,
    backgroundColor: '#FFD200',
  },
  fintechLogoTileAirtel: {
    width: 76,
    height: 44,
    backgroundColor: '#ED1C24',
  },
  fintechLogoImage: {
    width: '100%',
    height: '100%',
  },
  fintechMethodCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fintechMethodName: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 16,
    lineHeight: 20,
  },
  fintechMethodProvider: {
    fontFamily: driveType.regular,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
  },
  fintechRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fintechRadioOn: {
    borderColor: '#0B1220',
  },
  fintechRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0B1220',
  },
  fintechInput: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EEF0F3',
    paddingHorizontal: 16,
    color: '#0B1220',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  fintechPrimaryButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  fintechPrimaryButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  fintechButtonDisabled: {
    opacity: 0.55,
  },
  fintechSecondaryButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#EEF0F3',
  },
  fintechSecondaryButtonText: {
    fontFamily: driveType.bold,
    color: '#0B1220',
    fontSize: 15,
  },
  fintechFootnote: {
    fontFamily: driveType.regular,
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
  },
  fintechWaitingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginBottom: 32,
  },
  fintechWaitingLogo: {
    width: 80,
    height: 64,
    marginBottom: 8,
  },
  fintechWaitingTitle: {
    color: '#0B1220',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  fintechWaitingText: {
    color: '#6B7280',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 280,
  },
  fintechReference: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  fintechEmpty: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  fintechActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F3',
  },
  fintechActivityLogo: {
    width: 48,
    height: 36,
    borderRadius: 10,
  },
  fintechActivityCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fintechActivityAmount: {
    color: '#0B1220',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  fintechActivityMeta: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  kekaOfferCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    gap: 14,
  },
  kekaOfferCardDue: {
    borderColor: '#BBF7D0',
  },
  kekaOfferTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  kekaOfferCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  kekaOfferTitle: {
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  kekaOfferMeta: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  kekaPrice: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  kekaStatusChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#DCFCE7',
  },
  kekaStatusChipActive: {
    backgroundColor: '#DCFCE7',
  },
  kekaStatusChipWait: {
    backgroundColor: '#E0F2FE',
  },
  kekaStatusChipDue: {
    backgroundColor: '#FFEDD5',
  },
  kekaStatusChipText: {
    color: '#14532D',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  kekaStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kekaStatLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  kekaStatValue: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  kekaPayButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: driveTheme.colors.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kekaPayButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  kekaClearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kekaClearText: {
    flex: 1,
    color: '#374151',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  kekaCheckoutCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    gap: 12,
  },
  kekaSectionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  kekaNetworkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  kekaNetworkRowSelected: {
    borderColor: driveTheme.colors.primary,
    backgroundColor: '#F0FDF4',
  },
  kekaNetworkLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  kekaNetworkCopy: {
    flex: 1,
    minWidth: 0,
  },
  kekaNetworkName: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  kekaNetworkProvider: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  kekaHint: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  kekaPhoneInput: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  paymentProviderName: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  paymentChosenNetwork: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  paymentChosenCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentChosenMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  paymentNetworkBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  paymentNetworkBadgeActive: {
    backgroundColor: '#DCFCE7',
  },
  paymentNetworkBadgeMuted: {
    backgroundColor: '#E2E8F0',
  },
  paymentNetworkBadgeText: {
    color: driveTheme.colors.subtext,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentNetworkBadgeTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  manualPaymentNumberCard: {
    borderRadius: 18,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
    gap: 12,
  },
  manualPaymentNumber: {
    color: driveTheme.colors.primaryDark,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
  },
  manualPaymentCopyButton: {
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  manualPaymentCopyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  paymentMiniButton: {
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  paymentMiniButtonText: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentPushIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  paymentPushTitle: {
    color: driveTheme.colors.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  paymentPushText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  paymentOrderList: {
    gap: 10,
  },
  paymentOrderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 12,
  },
  paymentOrderIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentOrderCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentOrderTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  paymentOrderMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentOrderAmounts: {
    alignItems: 'flex-end',
    gap: 2,
  },
  paymentOrderGross: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  paymentOrderCommission: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  mobileMoneyRouteList: {
    gap: 10,
  },
  mobileMoneyRouteCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 13,
    gap: 11,
  },
  mobileMoneyRouteCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  mobileMoneyRouteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileMoneyIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMoneyRouteCopy: {
    flex: 1,
    minWidth: 0,
  },
  mobileMoneyRouteName: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  mobileMoneyRouteMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  mobileMoneyRouteHint: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  mobileMoneyRouteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  mobileMoneySelectButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMoneySelectButtonActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#86EFAC',
  },
  mobileMoneySelectText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  mobileMoneySelectTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  mobileMoneyDialButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: driveTheme.colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  mobileMoneyDialText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  accountHeaderCard: {
    borderRadius: 24,
    backgroundColor: driveTheme.colors.dark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 28,
    elevation: 5,
  },
  accountAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  accountHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountHeaderKicker: {
    color: '#86EFAC',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountHeaderName: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 27,
  },
  accountHeaderMeta: {
    fontFamily: driveType.regular,
    color: '#D7E1EA',
    fontSize: 12,
    lineHeight: 17,
  },
  accountStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  accountStatusOnline: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  accountStatusOffline: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  accountStatusText: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
  },
  accountStatusTextOnline: {
    color: driveTheme.colors.primaryDark,
  },
  accountQuickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accountQuickItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    minHeight: 86,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  accountQuickValue: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    maxWidth: '100%',
    textAlign: 'center',
  },
  accountQuickLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountInfoList: {
    gap: 10,
  },
  accountInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
  },
  accountInfoCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountInfoLabel: {
    fontFamily: driveType.semibold,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
  },
  accountInfoValue: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  settingLabel: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 13,
  },
  languageRow: {
    flexDirection: 'row',
    gap: 8,
  },
  languageChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageChipActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
  },
  languageChipText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 14,
  },
  languageChipTextActive: {
    color: '#14532D',
  },
  settingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
  },
  settingToggleCopy: {
    flex: 1,
    gap: 2,
  },
  settingToggleTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
  },
  settingToggleHint: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  paymentSummaryBand: {
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentSummaryMain: {
    flex: 1,
    minWidth: 0,
  },
  paymentSummaryCaption: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 3,
  },
  paymentBreakdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paymentBreakdownItem: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 3,
  },
  paymentBreakdownLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentBreakdownValue: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  paymentHero: {
    borderRadius: 22,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentHeroLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  paymentHeroAmount: {
    color: driveTheme.colors.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  paymentStatusPill: {
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentStatusText: {
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentStatusTextDue: {
    color: '#92400E',
  },
  paymentFlowStep: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 13,
  },
  paymentFlowIndex: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentFlowIndexDone: {
    backgroundColor: driveTheme.colors.primary,
  },
  paymentFlowIndexActive: {
    backgroundColor: driveTheme.colors.warning,
  },
  paymentFlowIndexMuted: {
    backgroundColor: '#E2E8F0',
  },
  paymentFlowIndexText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentFlowIndexTextActive: {
    color: driveTheme.colors.ink,
  },
  paymentFlowCopy: {
    flex: 1,
    gap: 3,
  },
  paymentFlowTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  paymentFlowDetail: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentForm: {
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 14,
    gap: 12,
  },
  paymentFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paymentFormIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentFormHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentFormTitle: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentFormSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  paymentMethodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paymentMethodChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentMethodChipActive: {
    backgroundColor: driveTheme.colors.primarySoft,
    borderColor: '#86EFAC',
  },
  paymentMethodText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '900',
  },
  paymentMethodTextActive: {
    color: driveTheme.colors.primaryDark,
  },
  paymentInputGroup: {
    gap: 7,
  },
  paymentInputLabel: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  paymentInput: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  paymentClearState: {
    borderRadius: 20,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentClearCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentClearTitle: {
    color: driveTheme.colors.primaryDark,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  paymentClearText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  accountHealthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  accountHealthItem: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  accountSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accountSummaryItem: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 13,
    gap: 4,
  },
  accountSummaryLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  accountSummaryValue: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  disciplineRow: {
    flexDirection: 'row',
    gap: 10,
  },
  disciplineItem: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  disciplineValue: {
    color: driveTheme.colors.ink,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
  },
  disciplineLabel: {
    color: driveTheme.colors.subtext,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  emptyState: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#F8FAFC',
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyStateLarge: {
    borderRadius: driveTheme.radius.xl,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 18,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  orderCard: {
    borderRadius: driveTheme.radius.lg,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 10,
  },
  orderTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  orderCopy: {
    flex: 1,
  },
  orderTitle: {
    color: driveTheme.colors.ink,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  orderMeta: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  orderPriceWrap: {
    marginLeft: 12,
  },
  orderPrice: {
    color: driveTheme.colors.primaryDark,
    fontSize: 14,
    fontWeight: '800',
  },
  orderRoute: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  orderDetail: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  orderHint: {
    color: driveTheme.colors.info,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  infoCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    backgroundColor: driveTheme.colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  infoCalloutMuted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  infoCalloutText: {
    flex: 1,
    color: driveTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  infoCalloutTextMuted: {
    flex: 1,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  mapCard: {
    position: 'relative',
    overflow: 'hidden',
  },
  tripMapStage: {
    paddingHorizontal: 0,
    backgroundColor: driveTheme.colors.dark,
  },
  mapView: {
    width: '100%',
    height: 240,
    borderRadius: 0,
  },
  mapOverlay: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'space-between',
    padding: 18,
  },
  mapOverlayTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  mapOverlayBottom: {
    alignItems: 'flex-end',
  },
  mapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mapBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  mapBadgeMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mapBadgeMutedText: {
    color: driveTheme.colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  mapNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.cta,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 4,
  },
  mapNavButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  tripBottomSheet: {
    marginTop: -36,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: driveTheme.colors.canvas,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 16,
  },
  tripSheetHandle: {
    width: 58,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 2,
  },
  tripSheetCard: {
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 18,
    gap: 12,
  },
  tripSheetTitle: {
    color: driveTheme.colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  tripSheetSubtitle: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  tripHelperText: {
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 20,
  },
  tripActionSheet: {
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    padding: 18,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 3,
  },
  tripMessageThread: {
    gap: 10,
  },
  tripMessageRow: {
    flexDirection: 'row',
  },
  tripMessageRowSelf: {
    justifyContent: 'flex-end',
  },
  tripMessageRowOther: {
    justifyContent: 'flex-start',
  },
  tripMessageBubble: {
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  tripMessageBubbleSelf: {
    backgroundColor: driveTheme.colors.primary,
    borderBottomRightRadius: 8,
  },
  tripMessageBubbleOther: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    borderBottomLeftRadius: 8,
  },
  tripMessageSender: {
    fontSize: 12,
    fontWeight: '800',
  },
  tripMessageSenderSelf: {
    color: '#DCFCE7',
  },
  tripMessageSenderOther: {
    color: driveTheme.colors.info,
  },
  tripMessageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  tripMessageTextSelf: {
    color: '#FFFFFF',
  },
  tripMessageTextOther: {
    color: driveTheme.colors.ink,
  },
  tripMessageTime: {
    fontSize: 11,
    fontWeight: '700',
  },
  tripMessageTimeSelf: {
    color: '#DCFCE7',
  },
  tripMessageTimeOther: {
    color: driveTheme.colors.subtext,
  },
  tripMessageComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  tripMessageInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 88,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    color: driveTheme.colors.ink,
    fontSize: 14,
  },
  tripMessageSendButton: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: driveTheme.colors.cta,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tripMessageSendButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  tripMessageSendText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  mapFallbackShell: {
    gap: 12,
  },
  mapFallbackScene: {
    height: 240,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#E8F1EC',
  },
  mapFallbackGlowA: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(15, 157, 88, 0.12)',
    top: -30,
    left: -20,
  },
  mapFallbackGlowB: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    bottom: -10,
    right: -10,
  },
  mapRouteLine: {
    position: 'absolute',
    left: 72,
    top: 94,
    width: 180,
    height: 6,
    borderRadius: 999,
    backgroundColor: driveTheme.colors.primary,
    transform: [{ rotate: '28deg' }],
  },
  mapNode: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  mapNodePickup: {
    top: 82,
    left: 56,
    backgroundColor: '#F97316',
  },
  mapNodeDropoff: {
    right: 54,
    bottom: 64,
    backgroundColor: driveTheme.colors.primary,
  },
  mapNodeDriver: {
    top: 148,
    left: 160,
    backgroundColor: driveTheme.colors.info,
  },
  mapNodeInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  mapFallbackCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#F8FAFC',
    padding: 14,
    gap: 10,
  },
  mapFallbackTitle: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  mapFallbackText: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
  },
  tripStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tripStopDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    marginTop: 4,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  tripStopPickup: {
    backgroundColor: '#F97316',
  },
  tripStopDropoff: {
    backgroundColor: driveTheme.colors.primary,
  },
  tripStopCopy: {
    flex: 1,
    gap: 4,
  },
  tripStopTitle: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '800',
  },
  tripStopLabel: {
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  tripDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  tripActionPrimary: {
    gap: 12,
  },
  tripActionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 14,
    marginBottom: 4,
  },
  historyMeta: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 210,
  },
  historyTrailing: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  historyAmount: {
    color: driveTheme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  historyStatus: {
    color: driveTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '700',
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: driveTheme.colors.line,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  notificationIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationIconSuccess: {
    backgroundColor: driveTheme.colors.primarySoft,
  },
  notificationIconInfo: {
    backgroundColor: '#EFF6FF',
  },
  notificationIconWarning: {
    backgroundColor: '#FFF7ED',
  },
  notificationCopy: {
    flex: 1,
    gap: 3,
  },
  notificationTitle: {
    fontFamily: driveType.bold,
    color: driveTheme.colors.ink,
    fontSize: 15,
    lineHeight: 20,
  },
  notificationMessage: {
    fontFamily: driveType.regular,
    color: driveTheme.colors.subtext,
    fontSize: 13,
    lineHeight: 19,
  },
  notificationTime: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  tripLine: {
    color: driveTheme.colors.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: driveTheme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: driveTheme.colors.line,
    paddingTop: 2,
    paddingBottom: Platform.OS === 'android' ? 8 : 8,
    paddingHorizontal: 4,
    ...driveTheme.shadows.card,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: 16,
    position: 'relative',
  },
  bottomNavItemActive: {
    backgroundColor: 'transparent',
  },
  bottomNavBadge: {
    position: 'absolute',
    top: 2,
    right: 14,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: driveTheme.colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bottomNavBadgeText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 9,
  },
  bottomNavLabel: {
    fontFamily: driveType.semibold,
    color: '#94A3B8',
    fontSize: 10,
  },
  bottomNavLabelActive: {
    color: '#16A34A',
  },
  studioScreen: {
    backgroundColor: driveTheme.colors.canvas,
  },
  studioContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
    backgroundColor: driveTheme.colors.canvas,
  },
  studioHeader: {
    paddingTop: 4,
    paddingBottom: 2,
    gap: 4,
  },
  studioTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 28,
    lineHeight: 34,
  },
  studioSubtitle: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  studioStatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  studioStatCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  studioStatValue: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
  },
  studioStatLabel: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 11,
    textAlign: 'center',
  },
  studioCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  studioCardTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 16,
  },
  studioCardMeta: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    marginBottom: 4,
  },
  studioPrimaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioPrimaryButtonText: {
    fontFamily: driveType.bold,
    color: '#FFFFFF',
    fontSize: 16,
  },
  studioFilterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  studioFilterChip: {
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  studioFilterChipActive: {
    backgroundColor: '#0F172A',
  },
  studioFilterChipText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 13,
  },
  studioFilterChipTextActive: {
    color: '#FFFFFF',
  },
  studioEmpty: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  studioEmptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  historySectionSwitch: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    gap: 4,
  },
  historySectionChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historySectionChipActive: {
    backgroundColor: '#0B1220',
  },
  historySectionChipText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 15,
  },
  historySectionChipTextActive: {
    color: '#FFFFFF',
  },
  historySectionTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  historySubsectionTitle: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 13,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 4,
    marginBottom: 8,
  },
  historyCard: {
    backgroundColor: driveTheme.colors.surface,
    borderRadius: driveTheme.radius.xl,
    padding: driveTheme.spacing.lg,
    gap: 12,
    ...driveTheme.shadows.card,
  },
  historyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  historyCardFare: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 18,
    flex: 1,
  },
  historyStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F1F5F9',
  },
  historyStatusPillDone: {
    backgroundColor: '#DCFCE7',
  },
  historyStatusPillLive: {
    backgroundColor: '#DBEAFE',
  },
  historyStatusPillMuted: {
    backgroundColor: '#F1F5F9',
  },
  historyStatusPillText: {
    fontFamily: driveType.semibold,
    color: '#64748B',
    fontSize: 12,
  },
  historyStatusPillTextDone: {
    color: '#14532D',
  },
  historyStatusPillTextLive: {
    color: '#1D4ED8',
  },
  historyRoute: {
    flexDirection: 'row',
    gap: 12,
  },
  historyRouteRail: {
    width: 14,
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
  },
  historyRouteLine: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: '#E2E8F0',
    marginVertical: 3,
  },
  historyRouteCopy: {
    flex: 1,
    gap: 10,
  },
  historyRouteValue: {
    fontFamily: driveType.semibold,
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 20,
  },
  historyCardMeta: {
    fontFamily: driveType.regular,
    color: '#94A3B8',
    fontSize: 12,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  notifTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notifTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
    flex: 1,
  },
  notifMessage: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  notifTime: {
    fontFamily: driveType.semibold,
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  notifUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  accountHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
  },
  accountHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  accountHeroName: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 20,
    lineHeight: 26,
  },
  accountHeroMeta: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  accountMenuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
  },
  accountMenuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountMenuCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  accountMenuTitle: {
    fontFamily: driveType.bold,
    color: '#0F172A',
    fontSize: 15,
  },
  accountMenuHint: {
    fontFamily: driveType.regular,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
  accountMenuValue: {
    fontFamily: driveType.semibold,
    fontSize: 13,
  },
  accountInfoRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  accountSignOut: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountSignOutText: {
    fontFamily: driveType.semibold,
    color: '#94A3B8',
    fontSize: 15,
  },
});
