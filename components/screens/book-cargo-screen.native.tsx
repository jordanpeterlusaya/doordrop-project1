// app/book-cargo.tsx
// Complete crash-proof cargo booking screen with all dependencies handled safely

import { CARGO_CALLOUT_LAYOUT, CargoBullseyePin, CargoRouteCallout } from '@/components/map-markers';
import { MapRouteLine } from '@/components/map-route-line';
import {
  buildNearbyLiveVehicles,
  NearbyLiveVehicleMarkers,
  projectMapCoordinate,
  spaceNearbyVehicles,
  type MapViewportRegion,
} from '@/components/nearby-live-vehicles';
import {
  buildFrontendPricingEstimates,
  distanceKmFromMeters,
  minFareFromDistanceMeters,
  roundPayableTzs,
} from '@/lib/cargo-pricing';
import { nyerereBridgeTollTzs, routeCrossesNyerereBridge } from '@/lib/nyerere-bridge-toll';
import { FirebaseError } from 'firebase/app';
import { getFirebaseDataErrorMessage } from '@/lib/auth-errors';
import { images } from '@/lib/images';
import { cargoMapStyle } from '@/lib/light-map-style';
import { recordAppActivity } from '@/lib/app-analytics';
import { recordCargoDiagnostic } from '@/lib/cargo-diagnostics';
import {
  createSearchSessionToken,
  ensureReadablePlaceLabel,
  fetchLocationSuggestions,
  fetchRouteEstimate,
  getInstantLocationSuggestions,
  resolveTypedLocation,
  retrieveLocationSuggestion,
  reverseGeocodeLocation,
  type LocationSuggestion,
  type PricingEstimate,
  type RouteEstimate,
  type RouteEstimateCargoSize,
  type RouteEstimateVehicleType,
  type RetrievedLocation,
} from '@/lib/location-search';
import {
  ensureCustomerLocation,
  getCustomerLocationSnapshot,
  subscribeCustomerLocation,
} from '@/lib/customer-location';
import { formatExpoGeocodedLabel, isCoordinateLikeLabel } from '@/lib/place-labels';
import { runMapsDiagnostics } from '@/lib/maps-diagnostics';
import { canRenderNativeGoogleMap, hasGoogleMapsBuildConfig } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { fetchRoadFollowingRoute } from '@/lib/road-route';
import { filterValidCoordinates, isValidCoordinate } from '@/lib/route-utils';
import { getSavedPlaces as getStoredSavedPlaces, type SavedPlace } from '@/lib/saved-places';
import {
  cancelDeliveryOrderByUser,
  createDeliveryOrder,
  mergeDriverLivePositions,
  subscribeToDriverLocations,
  subscribeToDrivers,
  subscribeToOrder,
  updateCargoNegotiation,
  type DeliveryOrder,
  type DriverLocationRecord,
  type DriverRecord,
} from '@/lib/delivery-data';
import {
  connectCargoOfferSocket,
  type CargoOfferSocketClient,
  type CargoOfferSocketDriver,
} from '@/lib/cargo-offer-socket';
import {
  logAsyncFailure,
  logAsyncStart,
  logAsyncSuccess,
  logInfo,
  logWarning,
} from '@/lib/debug-logger';
import { tryRequire } from '@/lib/safety';
import { isCargoServiceAvailableAt } from '@/lib/service-cities';
import { openPhoneDialer, readablePhone } from '@/lib/phone-link';
import { getUserProfile } from '@/lib/user-profile';
import { auth } from '@/lib/firebase';
import { useAuthSession } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';
import { useAppCopy } from '@/lib/app-copy';
import { classifyLocationError, type CustomerNoticeKind } from '@/lib/network-status';
import { formatScheduleSummary } from '@/lib/schedule-delivery';
import { CargoDriverVerifySheet, CargoDriversFoundPill } from '@/components/cargo-driver-verify-sheet';
import { LocationSuggestionsList } from '@/components/location-suggestions-list';
import { ServiceNotice } from '@/components/service-notice';
import { typography } from '@/constants/typography';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ============================================
// TYPES & CONSTANTS (self-contained)
// ============================================

type RoutePoint = {
  latitude: number;
  longitude: number;
};

type PickupState = 'loading' | 'ready' | 'error';
type DestinationState = 'idle' | 'searching' | 'resolved' | 'error';
type CargoLoadType = 'small' | 'half' | 'full' | 'overload';
type RouteSource = 'google' | 'directions' | 'osrm' | 'fallback';
type CargoSheetStep = 'choose' | 'verify';

type RouteMetrics = {
  coordinates: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
  source: RouteSource;
};

/** Only Google Routes /routes/estimate may drive Haul fare meters. */
function isPricableRouteSource(source: RouteSource | undefined): boolean {
  return source === 'google';
}

type CargoVehicle = {
  key: RouteEstimateVehicleType;
  title: string;
  capacity: string;
  price: string;
  eta: string;
};

// Theme constants (fallback)
const cargoTheme = {
  colors: {
    primary: '#FFE500',
    primaryDark: '#111827',
    text: '#111827',
    subtext: '#6B7280',
    ink: '#111827',
  },
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    paddingHorizontal: 20,
    labelSize: 17,
    labelLineHeight: 22,
    labelColor: '#FFFFFF',
    letterSpacing: -0.2,
  },
};

const DEFAULT_CARGO_SIZE: CargoLoadType = 'small';

function getCargoVehicles(language: 'en' | 'sw'): CargoVehicle[] {
  if (language === 'sw') {
    return [
      { key: 'toyo_electric', title: 'Toyo Electric', capacity: 'Ndogo kuliko TOYO · hadi kilo 400', price: 'Toa bei', eta: '' },
      { key: 'toyo', title: 'TOYO', capacity: 'Bajaji · hadi tani 1', price: 'Toa bei', eta: '' },
      { key: 'kirikuu', title: 'Kirikuu', capacity: 'Pickup · hadi tani 1', price: 'Toa bei', eta: '' },
    ];
  }

  return [
    { key: 'toyo_electric', title: 'Toyo Electric', capacity: 'Smaller than TOYO · up to 400 kg', price: 'Offer a fare', eta: '' },
    { key: 'toyo', title: 'TOYO', capacity: 'Bajaji · up to 1 ton', price: 'Offer a fare', eta: '' },
    { key: 'kirikuu', title: 'Kirikuu', capacity: 'Pickup · up to 1 ton', price: 'Offer a fare', eta: '' },
  ];
}

function offeredCargoVehicleKey(value?: string | null): RouteEstimateVehicleType {
  const normalized = String(value || '').trim().toLowerCase();
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
  if (
    normalized === 'toyo' ||
    normalized === 'bajaj' ||
    normalized === 'bajaji' ||
    normalized === 'toyo_xl' ||
    normalized === 'toyo-xl' ||
    normalized === 'pickup' ||
    normalized === 'van' ||
    normalized === 'canter' ||
    normalized === 'center' ||
    normalized === 'fuso'
  ) {
    return 'toyo';
  }
  return 'toyo_electric';
}

function normalizeCargoVehicleKey(value?: string | null): RouteEstimateVehicleType {
  const normalized = String(value || '').trim().toLowerCase();
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
  return 'toyo';
}

const fallbackSavedPlaces: SavedPlace[] = [
  { id: 'home', label: 'Home', address: 'Mikocheni, Dar es Salaam', icon: 'home' },
  { id: 'work', label: 'Work', address: 'Posta, Dar es Salaam', icon: 'briefcase' },
  { id: 'market', label: 'Market', address: 'Kariakoo Market, Dar es Salaam', icon: 'storefront-outline' },
  {
    id: 'airport',
    label: 'Airport',
    address: 'Julius Nyerere International Airport, Dar es Salaam',
    icon: 'airplane',
  },
];

const LIVE_CARRIER_RADIUS_METERS = 12000;
const LIVE_CARRIER_MAX_VISIBLE_COUNT = 8;
const vehicleImages: Record<string, any> = {
  toyo_electric: images.cargoAvatarToyoElectric,
  toyo: images.cargoAvatarToyo,
  kirikuu: images.cargoAvatarKirikuu,
  canter: images.cargoAvatarCanter,
  center: images.cargoAvatarCanter,
};
const screenScope = 'BookCargoScreen';
const defaultPickupPoint: RoutePoint = {
  latitude: -6.7924,
  longitude: 39.2083,
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatTzs(amount: number): string {
  return `TZS ${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`;
}

function parseOfferTzs(value: string): number {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) {
    return 0;
  }
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : 0;
}

function formatOfferInput(value: string): string {
  const amount = parseOfferTzs(value);
  return amount > 0 ? amount.toLocaleString('en-US') : '';
}

const OFFER_STEP_TZS = 1000;

function cargoVehicleBadge(value?: string | null) {
  const key = normalizeCargoVehicleKey(value);
  if (key === 'toyo_electric') {
    return 'Toyo Electric';
  }
  if (key === 'kirikuu') {
    return 'Kirikuu';
  }
  if (key === 'canter') {
    return 'Canter';
  }
  return 'TOYO';
}

function formatPickupWait(minutes: number, language: 'en' | 'sw') {
  const safe = Math.max(0, Math.round(minutes));
  if (safe <= 0) {
    return language === 'sw' ? 'Sasa' : 'Now';
  }
  return language === 'sw' ? `~${safe} dak` : `~${safe} min`;
}

function formatTripDistanceLabel(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return '';
  }
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m`;
  }
  const km = meters / 1000;
  // One decimal for Maps comparison (including ≥10 km); whole km only at ≥100 km.
  if (km >= 100) {
    return `${Math.round(km)} km`;
  }
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} km`;
}

function formatDurationFromMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(1, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours === 0) return `${safeMinutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatArrivalClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hours % 12 || 12;
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function estimateMinutesFromMeters(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((meters / 1000 / 22) * 60));
}

function estimateDurationSecondsFromMeters(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return 0;
  }
  const speedKph = meters > 30000 ? 52 : meters > 8000 ? 34 : 22;
  return Math.max(60, Math.round((meters / 1000 / speedKph) * 3600));
}

function measurePolylineMeters(points: RoutePoint[] | undefined) {
  if (!points || points.length < 2) {
    return 0;
  }
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += getDistanceBetweenPoints(points[index - 1], points[index]);
  }
  return total;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function getDistanceBetweenPoints(p1: RoutePoint, p2: RoutePoint): number {
  const R = 6371000;
  const lat1 = (p1.latitude * Math.PI) / 180;
  const lat2 = (p2.latitude * Math.PI) / 180;
  const deltaLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
  const deltaLon = ((p2.longitude - p1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ROUTE_CAMERA_PAD = 1.28;
const ROUTE_CAMERA_MAX_PAD = 1.4;
const MIN_ROUTE_LAT_DELTA = 0.012;
const MIN_ROUTE_LNG_DELTA = 0.012;

function routeCoordinateBounds(points: RoutePoint[]) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }

  return { minLat, maxLat, minLng, maxLng };
}

function buildCorridorCameraRegion(points: RoutePoint[]) {
  const validPoints = filterValidCoordinates(points);
  if (!validPoints.length) {
    return null;
  }

  if (validPoints.length === 1) {
    return {
      latitude: validPoints[0].latitude,
      longitude: validPoints[0].longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.018,
    };
  }

  const bounds = routeCoordinateBounds(validPoints);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.006);
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.006);

  return {
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    longitude: (bounds.minLng + bounds.maxLng) / 2,
    latitudeDelta: Math.max(latSpan * ROUTE_CAMERA_PAD, MIN_ROUTE_LAT_DELTA),
    longitudeDelta: Math.max(lngSpan * ROUTE_CAMERA_PAD, MIN_ROUTE_LNG_DELTA),
  };
}

const MAX_CALLOUT_LATERAL_NUDGE = 14;

type ClampedMapCallout = {
  x: number;
  y: number;
  placement: 'above' | 'below';
  stemOffset: number;
};

function attachMapCallout(
  pin: { x: number; y: number },
  mapSize: { width: number; height: number },
  inset: { top: number; right: number; bottom: number; left: number }
): ClampedMapCallout {
  const width = CARGO_CALLOUT_LAYOUT.width;
  const height = CARGO_CALLOUT_LAYOUT.overlayHeight;
  const ring = CARGO_CALLOUT_LAYOUT.bullseye / 2;
  const gap = 2;
  const centeredX = pin.x - width / 2;
  const aboveY = pin.y - height - ring + gap;
  const belowY = pin.y + ring + gap;
  const minX = inset.left;
  const maxX = mapSize.width - inset.right - width;
  const minY = inset.top;
  const maxBottom = mapSize.height - inset.bottom;

  const aboveFits = aboveY >= minY;
  const belowFits = belowY + height <= maxBottom;
  const placement: 'above' | 'below' = !aboveFits && belowFits ? 'below' : 'above';
  const attachedY = placement === 'below' ? belowY : aboveY;

  const overflow =
    centeredX < minX ? minX - centeredX : centeredX > maxX ? maxX - centeredX : 0;
  const nudge = Math.max(-MAX_CALLOUT_LATERAL_NUDGE, Math.min(MAX_CALLOUT_LATERAL_NUDGE, overflow));

  return {
    x: centeredX + nudge,
    y: attachedY,
    placement,
    stemOffset: -nudge,
  };
}

function isCameraOverZoomed(region: { latitudeDelta: number; longitudeDelta: number }, points: RoutePoint[]) {
  const validPoints = filterValidCoordinates(points);
  if (validPoints.length < 2) {
    return false;
  }

  const bounds = routeCoordinateBounds(validPoints);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.006);
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.006);
  return (
    region.latitudeDelta > latSpan * ROUTE_CAMERA_MAX_PAD ||
    region.longitudeDelta > lngSpan * ROUTE_CAMERA_MAX_PAD
  );
}

function mapEstimateToRouteMetrics(estimate: RouteEstimate): RouteMetrics {
  const distanceMeters = Number(estimate.distanceMeters) || 0;
  const durationSeconds = Number(estimate.durationSeconds) || 0;
  // Only treat as pricable Google Routes when meters/ETA are present.
  // Geometry-only / zero-meter payloads must not unlock fare pricing.
  const isPricable = distanceMeters > 0 && durationSeconds > 0;
  return {
    coordinates: estimate.coordinates.length ? estimate.coordinates : [],
    distanceMeters: isPricable ? distanceMeters : 0,
    durationSeconds: isPricable ? durationSeconds : 0,
    source: isPricable ? 'google' : 'fallback',
  };
}

function formatRouteTravelTime(durationSeconds: number): string | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return formatDurationFromMinutes(durationSeconds / 60);
}

async function buildFallbackRoute(pickupPoint: RoutePoint, dropoffPoint: RoutePoint): Promise<RouteMetrics> {
  const road = await fetchRoadFollowingRoute(pickupPoint, dropoffPoint);
  if (road && road.coordinates.length > 2 && road.distanceMeters > 0) {
    return {
      coordinates: road.coordinates,
      distanceMeters: Math.max(Math.round(road.distanceMeters), 500),
      durationSeconds:
        road.durationSeconds > 0
          ? road.durationSeconds
          : estimateDurationSecondsFromMeters(road.distanceMeters),
      // Map geometry only — never claim Google Routes / pricing truth.
      source: road.source === 'osrm' ? 'osrm' : 'directions',
    };
  }

  // No real road route — never invent haversine km for pricing.
  return {
    coordinates: [pickupPoint, dropoffPoint],
    distanceMeters: 0,
    durationSeconds: 0,
    source: 'fallback',
  };
}

function formatLocationLabel(
  address: any,
  point: RoutePoint | null,
  fallbackText?: string,
  language: 'en' | 'sw' = 'en'
): string {
  const fromExpo = formatExpoGeocodedLabel(address, point);
  if (fromExpo && !isCoordinateLikeLabel(fromExpo)) {
    return fromExpo;
  }
  if (fallbackText?.trim() && !isCoordinateLikeLabel(fallbackText)) {
    return fallbackText.trim();
  }
  return language === 'sw' ? 'Inatafuta eneo lako...' : 'Finding your area...';
}

function formatCompactLocationLabel(value: string, fallback: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    return fallback;
  }

  const [first, second] = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  return [first, second].filter(Boolean).join(', ') || cleaned;
}

function mergeSavedPlaces(savedPlaces: SavedPlace[]) {
  const merged = [...savedPlaces, ...fallbackSavedPlaces];
  const seen = new Set<string>();

  return merged.filter((place) => {
    const dedupeKey = `${place.label.toLowerCase()}::${place.address.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return false;
    }

    seen.add(dedupeKey);
    return true;
  });
}

// ============================================
// PRIMARY BUTTON COMPONENT
// ============================================

type PrimaryButtonProps = {
  label: string;
  icon?: string;
  onPress: () => void;
  style?: any;
  disabled?: boolean;
};

const PRIMARY_BUTTON_PRESS_GUARD_MS = 650;

const PrimaryButton: React.FC<PrimaryButtonProps> = ({ label, icon, onPress, style, disabled = false }) => {
  const lastPressRef = useRef(0);
  const handlePress = useCallback(() => {
    if (disabled) {
      return;
    }

    const now = Date.now();
    if (now - lastPressRef.current < PRIMARY_BUTTON_PRESS_GUARD_MS) {
      return;
    }

    lastPressRef.current = now;
    onPress();
  }, [disabled, onPress]);

  return (
    <TouchableOpacity
      style={[styles.primaryButton, disabled && styles.primaryButtonDisabled, style]}
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
      {icon && <MaterialCommunityIcons name={icon as any} size={20} color="#FFFFFF" style={{ marginLeft: 8 }} />}
    </TouchableOpacity>
  );
};

// ============================================
// MAIN SCREEN COMPONENT
// ============================================

const { height: screenHeight } = Dimensions.get('window');
const SHEET_ANIMATION_MS = 340;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {}
}

export default function BookCargoScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const params = useLocalSearchParams<{
    repeat?: string;
    pickup?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoff?: string;
    dropoffLat?: string;
    dropoffLng?: string;
    vehicle?: string;
    cargoSize?: string;
    requestedDriverId?: string;
    requestedDriverName?: string;
    timing?: string;
    scheduleDate?: string;
    scheduleTime?: string;
    outOfReach?: string;
  }>();
  const forcedOutOfReach = params.outOfReach === '1';
  const isRepeat = params.repeat === '1';
  const timingMode = params.timing === 'later' ? 'later' : 'now';
  const scheduleDate = params.scheduleDate ? String(params.scheduleDate) : '';
  const scheduleTime = params.scheduleTime ? String(params.scheduleTime) : '';
  const scheduleBannerLabel =
    timingMode === 'later' && scheduleDate && scheduleTime
      ? formatScheduleSummary(scheduleDate, scheduleTime, language)
      : '';
  const repeatPickupLat = Number(params.pickupLat);
  const repeatPickupLng = Number(params.pickupLng);
  const hasRepeatPickup =
    isRepeat && Number.isFinite(repeatPickupLat) && Number.isFinite(repeatPickupLng) && Boolean(params.pickup?.trim());
  const repeatDropoffLat = Number(params.dropoffLat);
  const repeatDropoffLng = Number(params.dropoffLng);
  const hasRepeatDropoff =
    isRepeat && Number.isFinite(repeatDropoffLat) && Number.isFinite(repeatDropoffLng) && Boolean(params.dropoff?.trim());
  const { profile, profileLoading, refreshProfile, user } = useAuthSession();
  const Location = useMemo(() => tryRequire<any>('expo-location'), []);
  const nativeMaps = useMemo(() => getNativeMaps(), []);
  const AnimatedRegion = nativeMaps.AnimatedRegion;
  const NativeMapView = nativeMaps.MapView;
  const Marker = nativeMaps.Marker;
  const MarkerAnimated = nativeMaps.MarkerAnimated;
  const Polyline = nativeMaps.Polyline;
  const mapProvider = nativeMaps.provider;
  const mapCanRender =
    nativeMaps.canRender && canRenderNativeGoogleMap() && Boolean(NativeMapView && Marker && Polyline);
  const bootLoggedRef = useRef(false);
  const dropoffLookupIdRef = useRef(0);
  const suggestionLookupIdRef = useRef(0);
  const pickupSuggestionLookupIdRef = useRef(0);
  const dropoffSessionTokenRef = useRef(createSearchSessionToken());
  const pickupSessionTokenRef = useRef(createSearchSessionToken());
  const mapRef = useRef<any>(null);
  const fitCameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickupInputRef = useRef<TextInput | null>(null);
  const dropoffInputRef = useRef<TextInput | null>(null);
  const cargoVehicles = useMemo(() => getCargoVehicles(language), [language]);

  const cachedPickupLocation = hasRepeatPickup ? null : getCustomerLocationSnapshot();
  const hasCachedPickup =
    Boolean(cachedPickupLocation?.point) &&
    Boolean(cachedPickupLocation?.label?.trim()) &&
    cachedPickupLocation?.status === 'ready';

  // State
  const [pickupPoint, setPickupPoint] = useState<RoutePoint | null>(
    hasRepeatPickup
      ? { latitude: repeatPickupLat, longitude: repeatPickupLng }
      : cachedPickupLocation?.point ?? null
  );
  const [pickupLabel, setPickupLabel] = useState(
    hasRepeatPickup
      ? String(params.pickup)
      : cachedPickupLocation?.label?.trim() ||
        (language === 'sw' ? 'Inatafuta eneo lako...' : 'Finding your area...')
  );
  const [pickupInput, setPickupInput] = useState(
    hasRepeatPickup
      ? String(params.pickup)
      : cachedPickupLocation?.label?.trim() ||
        (language === 'sw' ? 'Inatafuta eneo lako...' : 'Finding your area...')
  );
  const [pickupState, setPickupState] = useState<PickupState>(
    hasRepeatPickup || hasCachedPickup ? 'ready' : 'loading'
  );
  const [cargoRegionStatus, setCargoRegionStatus] = useState<'checking' | 'available' | 'out-of-reach'>(
    forcedOutOfReach
      ? 'out-of-reach'
      : hasRepeatPickup || hasCachedPickup
        ? 'available'
        : 'checking'
  );
  const [pickupHint, setPickupHint] = useState(
    hasCachedPickup
      ? language === 'sw'
        ? 'Pickup imesasishwa kutoka GPS yako.'
        : 'Pickup updated to your live GPS location.'
      : 'Checking your current GPS pickup point...'
  );
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([]);
  const [pickupNeedsSelection, setPickupNeedsSelection] = useState(false);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const [dropoffInput, setDropoffInput] = useState(hasRepeatDropoff ? String(params.dropoff) : '');
  const [dropoffPoint, setDropoffPoint] = useState<RoutePoint | null>(
    hasRepeatDropoff ? { latitude: repeatDropoffLat, longitude: repeatDropoffLng } : null
  );
  const [dropoffLabel, setDropoffLabel] = useState(hasRepeatDropoff ? String(params.dropoff) : '');
  const [mapSelectionTarget, setMapSelectionTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [destinationState, setDestinationState] = useState<DestinationState>('idle');
  const [destinationHint, setDestinationHint] = useState('Enter the drop-off location to see place suggestions and pricing.');
  const [routeMetrics, setRouteMetrics] = useState<RouteMetrics | null>(null);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [routeNotice, setRouteNotice] = useState<CustomerNoticeKind | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<RouteEstimateVehicleType>(offeredCargoVehicleKey(params.vehicle));
  const selectedCargoType: CargoLoadType = DEFAULT_CARGO_SIZE;
  const [formError, setFormError] = useState('');
  const [dropoffSuggestions, setDropoffSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [shouldFetchSuggestions, setShouldFetchSuggestions] = useState(true);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [vehicleEstimates, setVehicleEstimates] = useState<Partial<Record<RouteEstimateVehicleType, PricingEstimate>>>({});
  const [, setVehiclePricingLoading] = useState(false);
  const [routeEditorExpanded, setRouteEditorExpanded] = useState(true);
  const [activeSearchField, setActiveSearchField] = useState<'pickup' | 'dropoff'>('dropoff');
  const [liveDrivers, setLiveDrivers] = useState<DriverRecord[]>([]);
  const [driverLocations, setDriverLocations] = useState<Record<string, DriverLocationRecord>>({});
  const [pickupScreenPoint, setPickupScreenPoint] = useState<{ x: number; y: number } | null>(null);
  const [dropoffScreenPoint, setDropoffScreenPoint] = useState<{ x: number; y: number } | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [mapRegion, setMapRegion] = useState<MapViewportRegion>({
    latitude: defaultPickupPoint.latitude,
    longitude: defaultPickupPoint.longitude,
    latitudeDelta: 0.045,
    longitudeDelta: 0.04,
  });
  const [cargoSheetStep, setCargoSheetStep] = useState<CargoSheetStep>('choose');
  const [customerOfferInput, setCustomerOfferInput] = useState('');
  const [customerOfferNote, setCustomerOfferNote] = useState('');
  useEffect(() => {
    setCustomerOfferNote((current) => {
      const trimmed = current.trim();
      if (!trimmed || trimmed.length > 20) {
        return copy.cargo.offerNoteDefault;
      }
      return trimmed;
    });
  }, [copy.cargo.offerNoteDefault]);
  const [liveCargoOrder, setLiveCargoOrder] = useState<DeliveryOrder | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyCancelBusy, setVerifyCancelBusy] = useState(false);
  const [verifyPhase, setVerifyPhase] = useState<'connecting' | 'waiting' | 'no_driver' | 'error'>('connecting');
  const [verifyDriversFound, setVerifyDriversFound] = useState(0);
  const [verifyAssignedDriver, setVerifyAssignedDriver] = useState<CargoOfferSocketDriver | null>(null);
  const [verifyNearbyDrivers, setVerifyNearbyDrivers] = useState<CargoOfferSocketDriver[]>([]);
  const [verifyError, setVerifyError] = useState('');
  const cargoSocketRef = useRef<CargoOfferSocketClient | null>(null);
  const mapSizeRef = useRef(mapSize);
  const mapRegionRef = useRef(mapRegion);
  const pickupPointRef = useRef<RoutePoint | null>(pickupPoint);
  const dropoffPointRef = useRef<RoutePoint | null>(dropoffPoint);
  mapSizeRef.current = mapSize;
  mapRegionRef.current = mapRegion;
  pickupPointRef.current = pickupPoint;
  dropoffPointRef.current = dropoffPoint;
  const sheetHeightAnim = useRef(new Animated.Value(0)).current;
  const lastFitPointsRef = useRef<RoutePoint[]>([]);
  const pendingCameraFitRef = useRef(false);
  const pullingCameraInRef = useRef(false);

  const handleGoBack = useCallback(() => {
    if (cargoSheetStep === 'verify') {
      // Pop verify → vehicle choose. Order cancel stays on the sheet Ghairi button.
      cargoSocketRef.current?.close();
      cargoSocketRef.current = null;
      setCargoSheetStep('choose');
      setVerifyPhase('connecting');
      setVerifyError('');
      setVerifyAssignedDriver(null);
      return;
    }
    if (pickupPoint && dropoffPoint && routeMetrics && !routeEditorExpanded) {
      setRouteEditorExpanded(true);
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  }, [cargoSheetStep, dropoffPoint, pickupPoint, routeEditorExpanded, routeMetrics, router]);

  const trackCargoActivity = useCallback(
    (eventName: string, featureKey: string, metadata?: Record<string, string | number | boolean | null | undefined>) => {
      void recordAppActivity({
        userId: user?.uid,
        userName: profile?.fullName || user?.displayName || user?.email || 'DoorDrop User',
        userRole: 'customer',
        eventName,
        featureKey,
        featureLabel: 'Cargo booking',
        screen: 'book_cargo',
        route: '/book-cargo',
        metadata,
      });
    },
    [profile?.fullName, user?.displayName, user?.email, user?.uid]
  );

  const focusMapOnPoint = useCallback((point: RoutePoint, duration = 700) => {
    if (!isValidCoordinate(point)) {
      return;
    }

    try {
      mapRef.current?.animateToRegion(
        {
          latitude: point.latitude,
          longitude: point.longitude,
          latitudeDelta: 0.045,
          longitudeDelta: 0.04,
        },
        duration
      );
    } catch {}
  }, []);

  const safeSheetBottom = Math.max(insets.bottom, 12);
  // Roomier vehicle list + CTA; still leave map visible above (~28%+).
  const chooseSheetHeight = Math.round(
    Math.min(Math.max(580 + safeSheetBottom, screenHeight * 0.60), screenHeight * 0.72)
  );
  const showVehicleSheet = !!pickupPoint && !!dropoffPoint && !!routeMetrics;
  // Tall enough for status + vehicle + nearby + Ghairi/cancel above the home indicator.
  const verifySheetHeight = Math.round(
    Math.min(Math.max(480 + safeSheetBottom, screenHeight * 0.52), screenHeight * 0.64)
  );
  const cargoLayoutStep =
    !showVehicleSheet || routeEditorExpanded
      ? 'locations'
      : cargoSheetStep === 'verify'
        ? 'verify'
        : 'choose';
  const targetSheetHeight =
    cargoLayoutStep === 'choose' ? chooseSheetHeight : cargoLayoutStep === 'verify' ? verifySheetHeight : 0;
  const mapTopEdgePadding = cargoLayoutStep === 'locations' ? 200 : 120;
  const mapBottomEdgePadding =
    cargoLayoutStep === 'locations'
      ? 56
      : cargoLayoutStep === 'verify'
        ? verifySheetHeight + 24
        : chooseSheetHeight + 24;
  const mapSideEdgePadding = 60;

  const pullCameraToCorridor = useCallback((points: RoutePoint[]) => {
    const corridor = buildCorridorCameraRegion(points);
    if (!corridor) {
      return;
    }
    pullingCameraInRef.current = true;
    try {
      mapRef.current?.animateToRegion(corridor, 280);
    } catch {
      pullingCameraInRef.current = false;
    }
  }, []);

  const fitMapToPoints = useCallback((points: RoutePoint[]) => {
    const validPoints = filterValidCoordinates(points);

    if (!validPoints.length) {
      return;
    }

    if (validPoints.length === 1) {
      focusMapOnPoint(validPoints[0], 560);
      return;
    }

    lastFitPointsRef.current = validPoints;
    pendingCameraFitRef.current = true;
    pullingCameraInRef.current = false;

    try {
      mapRef.current?.fitToCoordinates(validPoints, {
        edgePadding: {
          top: mapTopEdgePadding,
          right: mapSideEdgePadding,
          bottom: mapBottomEdgePadding,
          left: mapSideEdgePadding,
        },
        animated: true,
      });
    } catch {
      pullCameraToCorridor(validPoints);
    }
  }, [focusMapOnPoint, mapBottomEdgePadding, mapSideEdgePadding, mapTopEdgePadding, pullCameraToCorridor]);

  const fitMapToPickupAndDropoff = useCallback(
    (pickup?: RoutePoint | null, dropoff?: RoutePoint | null, delay = 380) => {
      if (!isValidCoordinate(pickup) || !isValidCoordinate(dropoff)) {
        return;
      }

      if (fitCameraTimeoutRef.current) {
        clearTimeout(fitCameraTimeoutRef.current);
      }

      const extras = filterValidCoordinates(routeMetrics?.coordinates ?? []);
      const points = extras.length > 2 ? extras : [pickup, dropoff];

      fitCameraTimeoutRef.current = setTimeout(() => {
        fitMapToPoints(points);
      }, delay);
    },
    [fitMapToPoints, routeMetrics?.coordinates]
  );

  useEffect(() => {
    if (bootLoggedRef.current) {
      return;
    }

    bootLoggedRef.current = true;
    recordCargoDiagnostic('book-cargo-native:function-entered');
    logInfo(screenScope, 'native function entered');
  }, []);

  useEffect(() => {
    recordCargoDiagnostic('book-cargo-native:mounted');
    logInfo(screenScope, 'native screen mounted');
    void recordCargoDiagnostic('book-cargo-native:map-runtime-check', {
      hasGoogleMapsBuildConfig: hasGoogleMapsBuildConfig(),
      hasLocationModule: Boolean(Location),
      hasMapViewModule: Boolean(NativeMapView),
      mapCanRender,
      platform: Platform.OS,
      provider: mapProvider ? 'google' : 'default',
    });

    return () => {
      if (fitCameraTimeoutRef.current) {
        clearTimeout(fitCameraTimeoutRef.current);
      }
      recordCargoDiagnostic('book-cargo-native:unmounted');
      logInfo(screenScope, 'native screen unmounted');
    };
  }, [Location, NativeMapView, mapCanRender, mapProvider]);

  useEffect(() => {
    void runMapsDiagnostics(screenScope);
  }, []);

  useEffect(() => {
    const unsubscribeDrivers = subscribeToDrivers(
      (drivers) => {
        setLiveDrivers(drivers);
      },
      (error) => {
        logWarning(screenScope, 'live drivers subscription failed', {
          message: error.message,
        });
      }
    );
    const unsubscribeLocations = subscribeToDriverLocations(
      (locations) => {
        setDriverLocations(locations);
      },
      (error) => {
        logWarning(screenScope, 'live driver locations subscription failed', {
          message: error.message,
        });
      }
    );

    return () => {
      unsubscribeDrivers();
      unsubscribeLocations();
    };
  }, []);

  // Load saved places
  useEffect(() => {
    recordCargoDiagnostic('book-cargo-native:saved-places:load-start');
    getStoredSavedPlaces()
      .then((places) => {
        const mergedPlaces = mergeSavedPlaces(places || []);
        setSavedPlaces(mergedPlaces);
        recordCargoDiagnostic('book-cargo-native:saved-places:load-success', {
          count: mergedPlaces.length,
        });
      })
      .catch((error) => {
        logAsyncFailure(screenScope, 'loadSavedPlacesEffect', error);
        setSavedPlaces(fallbackSavedPlaces);
        recordCargoDiagnostic('book-cargo-native:saved-places:load-failure');
      });
  }, []);

  // Load cached pickup first, then refresh quietly in the background when needed.
  useEffect(() => {
    if (forcedOutOfReach) {
      return;
    }

    let isMounted = true;

    const applyLivePickup = (livePoint: RoutePoint, liveLabel: string, source: 'cache' | 'gps') => {
      const resolvedLabel =
        liveLabel && !isCoordinateLikeLabel(liveLabel)
          ? liveLabel
          : formatLocationLabel(null, livePoint, liveLabel, language);

      setPickupPoint(livePoint);
      setPickupLabel(resolvedLabel);
      setPickupInput(resolvedLabel);
      setPickupState('ready');
      setPickupNeedsSelection(false);
      setCargoRegionStatus(isCargoServiceAvailableAt(livePoint) ? 'available' : 'out-of-reach');
      setPickupHint(
        source === 'gps'
          ? language === 'sw'
            ? 'Pickup imesasishwa kutoka GPS yako.'
            : 'Pickup updated to your live GPS location.'
          : language === 'sw'
            ? 'Pickup imetumika kutoka eneo lililohifadhiwa.'
            : 'Pickup restored from your last known location.'
      );
      focusMapOnPoint(livePoint, source === 'cache' ? 0 : 700);
    };

    const applyFromSnapshot = (next: ReturnType<typeof getCustomerLocationSnapshot>, source: 'cache' | 'gps') => {
      if (!next.point || !next.label.trim() || next.status !== 'ready') {
        return;
      }

      applyLivePickup(next.point, next.label, source);
    };

    const loadPickup = async () => {
      logAsyncStart(screenScope, 'loadPickup');
      recordCargoDiagnostic('book-cargo-native:pickup:load-start');

      try {
        if (!isMounted) {
          return;
        }

        if (hasRepeatPickup) {
          setPickupPoint({ latitude: repeatPickupLat, longitude: repeatPickupLng });
          setPickupLabel(String(params.pickup));
          setPickupInput(String(params.pickup));
          setPickupState('ready');
          setPickupNeedsSelection(false);
          if (Location) {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (isMounted) {
              setHasLocationPermission(status === 'granted');
            }
          }
          return;
        }

        applyFromSnapshot(getCustomerLocationSnapshot(), 'cache');

        const next = await ensureCustomerLocation({ source: 'initial' });
        if (!isMounted) {
          return;
        }

        setHasLocationPermission(next.status !== 'permission-denied');

        if (next.status === 'ready' && next.point && next.label.trim()) {
          applyFromSnapshot(next, 'gps');
          trackCargoActivity('pickup_ready', 'cargo_pickup', {
            source: 'gps',
            hasGps: true,
          });
          logAsyncSuccess(screenScope, 'loadPickup', {
            point: next.point,
            source: 'shared-cache',
          });
          return;
        }

        if (next.status === 'permission-denied' || !next.point) {
          const fallbackLabel = 'Dar es Salaam pickup preview';
          setPickupPoint(defaultPickupPoint);
          setPickupLabel(fallbackLabel);
          setPickupInput(fallbackLabel);
          setPickupState('ready');
          setPickupNeedsSelection(false);
          setCargoRegionStatus('available');
          setPickupHint('Pickup preview loaded. Tap GPS anytime if you later enable location access.');
          trackCargoActivity('location_permission_denied', 'cargo_pickup', {
            source: 'initial_load',
          });
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }

        logAsyncFailure(screenScope, 'loadPickup', err);
        recordCargoDiagnostic('book-cargo-native:pickup:load-failure');
        const fallbackLabel = 'Dar es Salaam pickup preview';
        setPickupState('error');
        setPickupLabel(fallbackLabel);
        setPickupInput(fallbackLabel);
        setPickupNeedsSelection(false);
        setCargoRegionStatus('available');
        setPickupHint('Enter drop-off location to continue.');
        trackCargoActivity('pickup_failed', 'cargo_pickup', {
          source: 'initial_load',
        });
      }
    };

    if (!hasRepeatPickup) {
      applyFromSnapshot(getCustomerLocationSnapshot(), 'cache');
    }

    const unsubscribe = hasRepeatPickup
      ? () => undefined
      : subscribeCustomerLocation((next) => {
          if (!isMounted) {
            return;
          }
          applyFromSnapshot(next, 'gps');
        });

    void loadPickup();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [Location, focusMapOnPoint, forcedOutOfReach, language, trackCargoActivity]);

  const clearRouteState = useCallback(() => {
    dropoffLookupIdRef.current += 1;
    setRouteEstimate(null);
    setRouteMetrics(null);
    setRouteNotice(null);
    setVehicleEstimates({});
    setVehiclePricingLoading(false);
    setCargoSheetStep('choose');
    setCustomerOfferInput('');
  }, []);

  const reopenRouteEditor = useCallback((field: 'pickup' | 'dropoff') => {
    setRouteEditorExpanded(true);
    setActiveSearchField(field);
  }, []);

  const focusDropoffField = useCallback(() => {
    reopenRouteEditor('dropoff');
    setTimeout(() => {
      dropoffInputRef.current?.focus();
    }, 60);
  }, [reopenRouteEditor]);

  // Reset dropoff selection
  const resetDropoffSelection = useCallback((value: string) => {
    reopenRouteEditor('dropoff');
    suggestionLookupIdRef.current += 1;
    setDropoffInput(value);
    setDropoffPoint(null);
    setDropoffLabel('');
    clearRouteState();
    setDestinationState('idle');
    setFormError('');
    setDropoffSuggestions([]);
    setShouldFetchSuggestions(true);
    setLoadingSuggestions(false);
    if (!value.trim()) {
      dropoffSessionTokenRef.current = createSearchSessionToken();
    }
    setDestinationHint(
      value.trim()
        ? 'Typing... Choose a suggestion to see route'
        : 'Enter drop-off location to see suggestions'
    );
  }, [clearRouteState, reopenRouteEditor]);

  const clearDropoffSelection = useCallback(() => {
    resetDropoffSelection('');
    Keyboard.dismiss();
    if (pickupPoint) {
      focusMapOnPoint(pickupPoint, 500);
    }
  }, [focusMapOnPoint, pickupPoint, resetDropoffSelection]);

  // Resolve dropoff and get route
  const resolveAndRouteDropoff = useCallback(
    async (options?: { query?: string; suggestion?: LocationSuggestion; manual?: boolean; point?: RoutePoint }) => {
      const suggestion = options?.suggestion;
      const query = options?.query?.trim() ?? dropoffInput.trim();
      const providedPoint = options?.point;
      const manual = options?.manual ?? true;
      logAsyncStart(screenScope, 'resolveAndRouteDropoff', {
        manual,
        query,
        suggestionId: suggestion?.id,
      });

      if (!pickupPoint) {
        if (manual) setFormError('Waiting for pickup location...');
        logWarning(screenScope, 'resolveAndRouteDropoff waiting for pickup');
        return;
      }
      if (pickupNeedsSelection) {
        if (manual) setFormError('Choose one of the pickup suggestions or tap GPS first.');
        logWarning(screenScope, 'resolveAndRouteDropoff pickup requires confirmation');
        return;
      }
      if (!query && !suggestion) {
        if (manual) setDestinationState('error');
        logWarning(screenScope, 'resolveAndRouteDropoff missing destination');
        return;
      }

      const lookupId = ++dropoffLookupIdRef.current;
      Keyboard.dismiss();
      setDestinationState('searching');
      setRouteNotice(null);
      setFormError('');
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      setShouldFetchSuggestions(false);
      setDestinationHint('Getting route information...');
      trackCargoActivity('destination_search_started', 'cargo_destination_search', {
        source: suggestion ? 'suggestion' : providedPoint ? 'map_pin' : 'typed_search',
        manual,
        queryLength: query.length,
        vehicleType: selectedVehicle,
        cargoSize: selectedCargoType,
      });

      try {
        let resolvedLocation: RetrievedLocation | null = null;
        if (suggestion) {
          resolvedLocation = await retrieveLocationSuggestion(
            suggestion,
            dropoffSessionTokenRef.current,
            pickupPoint
          );
        } else if (providedPoint) {
          resolvedLocation = {
            label: query || 'Selected destination',
            address: '',
            point: providedPoint,
          };
        } else {
          resolvedLocation = await resolveTypedLocation(query, pickupPoint);
        }
        if (!resolvedLocation || !resolvedLocation.point) {
          throw new Error('Could not find location');
        }
        if (lookupId !== dropoffLookupIdRef.current) return;

        const dropoff = resolvedLocation.point;
        let nextRoute: RouteMetrics;
        let nextVehicleEstimates: Partial<Record<RouteEstimateVehicleType, PricingEstimate>> = {};
        let nextHint = 'Route ready. Choose a vehicle.';
        try {
          setVehiclePricingLoading(true);
          const nextRouteEstimate = await fetchRouteEstimate(pickupPoint, dropoff, {
            vehicleType: selectedVehicle,
            cargoSize: selectedCargoType as RouteEstimateCargoSize,
          });
          // Always price tuk-tuks with the local round-trip formulas + live ETA/km.
          // Do not let a stale Cloud Function quote overwrite Toyo Electric / TOYO / Kirikuu.
          const nextPricingEstimates: Partial<Record<RouteEstimateVehicleType, PricingEstimate>> = buildFrontendPricingEstimates(
            nextRouteEstimate.distanceMeters,
            cargoVehicles.map((vehicle) => vehicle.key),
            selectedCargoType as RouteEstimateCargoSize,
            undefined,
            nextRouteEstimate.durationSeconds
          );
          const selectedVehiclePricing = nextPricingEstimates[selectedVehicle] ?? nextRouteEstimate.pricingEstimate;
          trackCargoActivity('cargo_pricing_ready', 'cargo_pricing', {
            source: 'route_api_local_formula',
            distanceMeters: Math.round(nextRouteEstimate.distanceMeters),
            durationSeconds: Math.round(nextRouteEstimate.durationSeconds),
            vehicleType: selectedVehicle,
            cargoSize: selectedCargoType,
            estimatedPrice: selectedVehiclePricing?.estimatedPrice,
          });

          setRouteEstimate(nextRouteEstimate);
          nextRoute = mapEstimateToRouteMetrics(nextRouteEstimate);
          nextVehicleEstimates = nextPricingEstimates;
          const pricingWarning = Object.values(nextPricingEstimates).find((estimate) => estimate?.warning)?.warning;
          if (pricingWarning) {
            nextHint = pricingWarning;
          } else if (nextRouteEstimate.pricingEstimate?.warning) {
            nextHint = nextRouteEstimate.pricingEstimate.warning;
          }
        } catch (error) {
          logAsyncFailure(screenScope, 'resolveAndRouteDropoff.fetchRouteAndPricing', error, {
            fallback: true,
          });
          setRouteEstimate(null);
          nextRoute = await buildFallbackRoute(pickupPoint, dropoff);
          // Directions/OSRM/fallback geometry must never price Haul — need Routes estimate.
          // Never promote fallback to source 'google' even if meters look real.
          if (nextRoute.source === 'google') {
            nextRoute = { ...nextRoute, source: 'directions', distanceMeters: 0, durationSeconds: 0 };
          }
          nextVehicleEstimates = {};
          nextHint =
            language === 'sw'
              ? 'Imeshindikana kupata njia ya bei. Jaribu tena au chagua sehemu nyingine.'
              : 'Could not get a priced route. Try again or pick different points.';
          setFormError(nextHint);
          trackCargoActivity('cargo_pricing_fallback', 'cargo_pricing', {
            distanceMeters: Math.round(nextRoute.distanceMeters),
            durationSeconds: Math.round(nextRoute.durationSeconds),
            vehicleType: selectedVehicle,
            cargoSize: selectedCargoType,
            source: nextRoute.source,
            priced: false,
          });
        } finally {
          setVehiclePricingLoading(false);
        }

        if (lookupId !== dropoffLookupIdRef.current) return;

        const resolvedLabel = [resolvedLocation.label, resolvedLocation.address].filter(Boolean).join(', ');
        setDropoffInput(suggestion?.fullText || query);
        setDropoffPoint(dropoff);
        setDropoffLabel(resolvedLabel || query);
        setRouteMetrics(nextRoute);
        setVehicleEstimates(nextVehicleEstimates);
        setDestinationState('resolved');
        setRouteNotice(null);
        setDestinationHint(nextHint);
        setRouteEditorExpanded(false);
        setActiveSearchField('dropoff');
        setCargoSheetStep('choose');
        dropoffSessionTokenRef.current = createSearchSessionToken();
        Keyboard.dismiss();
        logAsyncSuccess(screenScope, 'resolveAndRouteDropoff', {
          source: nextRoute.source,
          distanceMeters: nextRoute.distanceMeters,
          durationSeconds: nextRoute.durationSeconds,
          dropoff,
        });
        trackCargoActivity('destination_search_success', 'cargo_destination_search', {
          source: nextRoute.source,
          distanceMeters: Math.round(nextRoute.distanceMeters),
          durationSeconds: Math.round(nextRoute.durationSeconds),
          vehicleType: selectedVehicle,
          cargoSize: selectedCargoType,
        });

        fitMapToPickupAndDropoff(pickupPoint, dropoff, 420);
      } catch (err) {
        if (lookupId !== dropoffLookupIdRef.current) return;
        logWarning(screenScope, 'resolveAndRouteDropoff', {
          manual,
          query,
          suggestionId: suggestion?.id,
        });
        setDropoffPoint(null);
        setRouteEstimate(null);
        setRouteMetrics(null);
        setVehicleEstimates({});
        setVehiclePricingLoading(false);
        setShouldFetchSuggestions(true);
        setRouteNotice(classifyLocationError(err));
        if (manual) {
          setDestinationState('error');
          setDestinationHint('Search for a landmark, street, or area');
        } else {
          setDestinationState('idle');
          setDestinationHint('Keep typing to see suggestions');
        }
        trackCargoActivity('destination_search_failed', 'cargo_destination_search', {
          source: suggestion ? 'suggestion' : providedPoint ? 'map_pin' : 'typed_search',
          manual,
          queryLength: query.length,
          vehicleType: selectedVehicle,
          cargoSize: selectedCargoType,
        });
      }
    },
    [
      dropoffInput,
      fitMapToPickupAndDropoff,
      language,
      pickupNeedsSelection,
      pickupPoint,
      selectedCargoType,
      selectedVehicle,
      trackCargoActivity,
    ]
  );

  // Price only from a successful /routes/estimate (source 'google'). Block directions|osrm|fallback.
  const pricingDistanceMeters =
    routeEstimate &&
    routeEstimate.distanceMeters > 0 &&
    isPricableRouteSource(routeMetrics?.source)
      ? routeEstimate.distanceMeters
      : undefined;

  useEffect(() => {
    if (!pricingDistanceMeters || !(pricingDistanceMeters > 0)) {
      return;
    }

    if (vehicleEstimates[selectedVehicle]?.cargoSize === selectedCargoType) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setVehiclePricingLoading(true);
        const nextVehicleEstimates: Partial<Record<RouteEstimateVehicleType, PricingEstimate>> = buildFrontendPricingEstimates(
          pricingDistanceMeters,
          cargoVehicles.map((vehicle) => vehicle.key),
          selectedCargoType as RouteEstimateCargoSize,
          undefined,
          routeEstimate?.durationSeconds
        );

        if (!cancelled) {
          setVehicleEstimates(nextVehicleEstimates);
        }
      } catch (error) {
        if (!cancelled) {
          logAsyncFailure(screenScope, 'refreshVehiclePricing', error, {
            distanceMeters: pricingDistanceMeters,
            cargoType: selectedCargoType,
          });
        }
      } finally {
        if (!cancelled) {
          setVehiclePricingLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pricingDistanceMeters, routeEstimate?.pricingEstimate, selectedCargoType, selectedVehicle, vehicleEstimates]);

  // Fetch suggestions as user types
  useEffect(() => {
    if (!pickupPoint || !shouldFetchSuggestions || dropoffInput.trim().length < 3) {
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    const lookupId = ++suggestionLookupIdRef.current;
    const instantSuggestions = getInstantLocationSuggestions(dropoffInput, pickupPoint, 8);
    if (instantSuggestions.length > 0) {
      setDropoffSuggestions(instantSuggestions);
    }
    setLoadingSuggestions(true);
    const timer = setTimeout(async () => {
      try {
        const suggestions = await fetchLocationSuggestions(
          dropoffInput,
          dropoffSessionTokenRef.current,
          pickupPoint
        );
        if (lookupId === suggestionLookupIdRef.current) {
          setDropoffSuggestions(suggestions);
          setLoadingSuggestions(false);
          setRouteNotice(null);
          setDestinationHint(
            suggestions.length > 0
              ? 'Choose a suggestion to resolve the drop-off and load pricing.'
              : 'No destination matches yet. Try a more specific area, street, or landmark.'
          );
          logAsyncSuccess(screenScope, 'loadDropoffSuggestions', {
            query: dropoffInput,
            results: suggestions.length,
          });
        }
      } catch (error) {
        if (lookupId === suggestionLookupIdRef.current) {
          setDropoffSuggestions([]);
          setLoadingSuggestions(false);
          setDestinationState('error');
          setRouteNotice(classifyLocationError(error));
          setDestinationHint('Search for a landmark, street, or area');
          logWarning(screenScope, 'loadDropoffSuggestions', {
            query: dropoffInput,
          });
        }
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [dropoffInput, pickupPoint, shouldFetchSuggestions]);

  useEffect(() => {
    if (!pickupNeedsSelection || pickupInput.trim().length < 3) {
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      return;
    }

    const lookupId = ++pickupSuggestionLookupIdRef.current;
    const instantSuggestions = getInstantLocationSuggestions(
      pickupInput,
      pickupPoint ?? dropoffPoint ?? undefined,
      8
    );
    if (instantSuggestions.length > 0) {
      setPickupSuggestions(instantSuggestions);
    }
    setLoadingPickupSuggestions(true);

    const timer = setTimeout(async () => {
      try {
        const suggestions = await fetchLocationSuggestions(
          pickupInput,
          pickupSessionTokenRef.current,
          pickupPoint ?? dropoffPoint ?? undefined
        );

        if (lookupId === pickupSuggestionLookupIdRef.current) {
          setPickupSuggestions(suggestions);
          setLoadingPickupSuggestions(false);
          setRouteNotice(null);
          setPickupHint(
            suggestions.length > 0
              ? 'Choose the exact pickup suggestion to refresh the route.'
              : 'No pickup matches yet. Try a more specific area, street, or landmark.'
          );
        }
      } catch (error) {
        if (lookupId === pickupSuggestionLookupIdRef.current) {
          setPickupSuggestions([]);
          setLoadingPickupSuggestions(false);
          setPickupHint('Choose a pickup suggestion or refine the text.');
          setRouteNotice(classifyLocationError(error));
          logWarning(screenScope, 'loadPickupSuggestions', {
            query: pickupInput,
          });
        }
      }
    }, 160);

    return () => clearTimeout(timer);
  }, [dropoffPoint, pickupInput, pickupNeedsSelection, pickupPoint]);

  const handlePickupChange = useCallback((value: string) => {
    reopenRouteEditor('pickup');
    setPickupInput(value);
    setPickupLabel(value.trim() || 'Enter pickup location');
    setPickupNeedsSelection(true);
    setPickupSuggestions([]);
    setLoadingPickupSuggestions(false);
    setPickupHint('Choose one of the pickup suggestions to refresh routing.');
    clearRouteState();
    setDropoffPoint(null);
    setDropoffLabel('');
    setDestinationState('idle');
    setDestinationHint('Enter drop-off location to see place suggestions and pricing.');

    if (!value.trim()) {
      pickupSessionTokenRef.current = createSearchSessionToken();
    }
  }, [clearRouteState, reopenRouteEditor]);

  const handleSelectPickupSuggestion = useCallback(async (suggestion: LocationSuggestion) => {
    try {
      const resolved = await retrieveLocationSuggestion(
        suggestion,
        pickupSessionTokenRef.current,
        dropoffPoint ?? undefined
      );
      const displayLabel = suggestion.fullText || [suggestion.name, suggestion.address].filter(Boolean).join(', ');
      setPickupPoint(resolved.point);
      setPickupLabel(displayLabel);
      setPickupInput(displayLabel);
      setPickupState('ready');
      setPickupNeedsSelection(false);
      setCargoRegionStatus(isCargoServiceAvailableAt(resolved.point) ? 'available' : 'out-of-reach');
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      setPickupHint('Pickup updated. Enter drop-off to load cargo quotes.');
      setRouteNotice(null);
      clearRouteState();
      setDropoffPoint(null);
      setDropoffLabel('');
      setDestinationState('idle');
      setDestinationHint('Enter drop-off location to see place suggestions and pricing.');
      pickupSessionTokenRef.current = createSearchSessionToken();
      focusDropoffField();

      try {
        focusMapOnPoint(resolved.point, 700);
      } catch {}
    } catch (error) {
      logWarning(screenScope, 'handleSelectPickupSuggestion', {
        suggestionId: suggestion.id,
        placeId: suggestion.placeId,
      });
      setRouteNotice(classifyLocationError(error));
    }
  }, [clearRouteState, dropoffPoint, focusDropoffField, focusMapOnPoint]);

  const handleOfferPrimary = useCallback(async () => {
    if (offerBusy) {
      return;
    }
    if (!pickupPoint) {
      setFormError('Pickup location not ready. Please wait or refresh.');
      return;
    }
    if (pickupNeedsSelection) {
      setFormError('Choose a pickup suggestion or tap GPS before continuing.');
      return;
    }
    if (!dropoffPoint || !routeMetrics) {
      setFormError('Please select a valid drop-off location first.');
      return;
    }
    if (
      !isPricableRouteSource(routeMetrics.source) ||
      !routeEstimate?.distanceMeters ||
      !(routeEstimate.distanceMeters > 0)
    ) {
      setFormError(
        language === 'sw'
          ? 'Hakuna njia ya barabara ya bei. Jaribu tena au chagua sehemu nyingine.'
          : 'No road route for pricing. Try again or pick different points.'
      );
      return;
    }
    if (!user) {
      router.push('/login');
      return;
    }

    const minFare = minFareFromDistanceMeters(routeEstimate.distanceMeters);
    const distanceKm = distanceKmFromMeters(routeEstimate.distanceMeters);
    const offerAmount = parseOfferTzs(customerOfferInput);
    if (offerAmount < minFare) {
      setFormError(copy.cargo.offerTooLow.replace('{amount}', minFare.toLocaleString('en-US')));
      setCustomerOfferInput(String(minFare));
      return;
    }

    let sharedPhone =
      readablePhone(profile?.phoneNumber) || readablePhone(user.phoneNumber) || '';
    if (!sharedPhone) {
      try {
        const freshProfile = await getUserProfile(user.uid);
        sharedPhone = readablePhone(freshProfile?.phoneNumber) || '';
        if (sharedPhone) {
          void refreshProfile();
        }
      } catch {
        // Proceed without phone — do not block the CTA.
      }
    }

    const driverCounter =
      typeof liveCargoOrder?.driverOffer === 'number' && liveCargoOrder.driverOffer > 0
        ? liveCargoOrder.driverOffer
        : 0;
    const acceptingDriver = Boolean(liveCargoOrder?.id) && driverCounter > 0 && offerAmount === driverCounter;

    const etaString = formatRouteTravelTime(routeMetrics.durationSeconds) || formatDistance(routeMetrics.distanceMeters);
    const vehicleTitle = cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title ?? 'Carrier';
    const distanceLabel = formatDistance(routeMetrics.distanceMeters);
    const dropoffDisplay = dropoffLabel || dropoffInput;
    const fareLabel = formatTzs(offerAmount);

    setOfferBusy(true);
    setFormError('');

    try {
      if (liveCargoOrder?.id) {
        logAsyncStart(screenScope, acceptingDriver ? 'acceptCargoDriverOffer' : 'updateCargoOffer', {
          orderId: liveCargoOrder.id,
          customerOffer: offerAmount,
          driverOffer: driverCounter || undefined,
        });
        await updateCargoNegotiation(liveCargoOrder.id, {
          customerOffer: offerAmount,
          lastOfferBy: 'customer',
          customerOfferNote: customerOfferNote.trim().slice(0, 140) || copy.cargo.offerNoteDefault,
          fareLabel,
          totalLabel: fareLabel,
          cargoVehicleKey: selectedVehicle,
          cargoVehicleLabel: vehicleTitle,
          serviceLabel: vehicleTitle,
          customerPhone: sharedPhone,
          recipientPhone: sharedPhone,
        });
        trackCargoActivity(acceptingDriver ? 'cargo_fare_accepted' : 'cargo_offer_updated', 'cargo_checkout', {
          vehicleType: selectedVehicle,
          cargoSize: selectedCargoType,
          customerOffer: offerAmount,
          minFare,
          distanceKm,
        });
        return;
      }

      logAsyncStart(screenScope, 'createCargoOffer', {
        vehicle: selectedVehicle,
        cargoType: selectedCargoType,
        customerOffer: offerAmount,
        minFare,
        distanceKm,
      });
      const [readablePickup, readableDropoff] = await Promise.all([
        ensureReadablePlaceLabel(pickupPoint, pickupLabel),
        ensureReadablePlaceLabel(dropoffPoint, dropoffDisplay),
      ]);
      if (readablePickup !== pickupLabel) {
        setPickupLabel(readablePickup);
        setPickupInput(readablePickup);
      }
      if (readableDropoff !== dropoffDisplay) {
        setDropoffLabel(readableDropoff);
      }

      const customerName = profile?.fullName?.trim() || user.displayName?.trim() || 'DoorDrop Customer';
      const customerPhone = sharedPhone;
      const scheduleLabel =
        timingMode === 'later' && scheduleDate && scheduleTime
          ? formatScheduleSummary(scheduleDate, scheduleTime, language)
          : language === 'sw'
            ? 'Sasa'
            : 'Dispatch now';

      const order = await createDeliveryOrder({
        userId: user.uid,
        customerName,
        customerEmail: user.email?.trim().toLowerCase() || '',
        customerPhone,
        flow: 'cargo',
        serviceLabel: vehicleTitle,
        pickupLabel: readablePickup,
        dropoffLabel: readableDropoff,
        pickupLatitude: pickupPoint.latitude,
        pickupLongitude: pickupPoint.longitude,
        dropoffLatitude: dropoffPoint.latitude,
        dropoffLongitude: dropoffPoint.longitude,
        etaLabel: etaString,
        fareLabel,
        totalLabel: fareLabel,
        fareType: 'negotiated',
        customerOffer: offerAmount,
        minFare,
        distanceKm,
        lastOfferBy: 'customer',
        negotiationStatus: 'open',
        driverNegotiationUsed: 0,
        customerOfferNote: customerOfferNote.trim().slice(0, 140) || copy.cargo.offerNoteDefault,
        routeLabel: `${readablePickup} → ${readableDropoff}`,
        timingMode,
        scheduleDate,
        scheduleTime,
        scheduleLabel,
        recipientName: customerName,
        recipientPhone: customerPhone,
        cargoVehicleKey: selectedVehicle,
        cargoVehicleLabel: vehicleTitle,
        cargoCapacityLabel: cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.capacity,
        cargoSizeLabel: undefined,
        distanceLabel,
        durationLabel: etaString,
        distanceMeters: Math.round(routeMetrics.distanceMeters),
        durationSeconds: Math.round(routeMetrics.durationSeconds),
        requestedDriverId: String(params.requestedDriverId || ''),
        requestedDriverName: String(params.requestedDriverName || ''),
      });

      setLiveCargoOrder(order);
      trackCargoActivity('cargo_offer_sent', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        vehicleLabel: vehicleTitle,
        cargoSize: selectedCargoType,
        distanceMeters: Math.round(routeMetrics.distanceMeters),
        durationSeconds: Math.round(routeMetrics.durationSeconds),
        customerOffer: offerAmount,
        minFare,
        distanceKm,
        orderId: order.id,
      });
      logAsyncSuccess(screenScope, 'createCargoOffer', {
        orderId: order.id,
        vehicle: selectedVehicle,
      });
    } catch (error) {
      const message =
        error instanceof FirebaseError
          ? getFirebaseDataErrorMessage(error.code, 'Could not send this fare. Try again.')
          : error instanceof Error
            ? error.message
            : 'Could not send this fare. Try again.';
      setFormError(message);
      logAsyncFailure(screenScope, liveCargoOrder?.id ? 'updateCargoOffer' : 'createCargoOffer', error);
      trackCargoActivity('checkout_failed', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        cargoSize: selectedCargoType,
      });
    } finally {
      setOfferBusy(false);
    }
  }, [
    copy.cargo.offerNoteDefault,
    copy.cargo.offerTooLow,
    customerOfferInput,
    customerOfferNote,
    dropoffInput,
    dropoffLabel,
    dropoffPoint,
    language,
    liveCargoOrder,
    offerBusy,
    params.requestedDriverId,
    params.requestedDriverName,
    pickupLabel,
    pickupNeedsSelection,
    pickupPoint,
    profile?.fullName,
    profile?.phoneNumber,
    refreshProfile,
    routeMetrics,
    router,
    scheduleDate,
    scheduleTime,
    selectedCargoType,
    selectedVehicle,
    timingMode,
    trackCargoActivity,
    user,
  ]);

  const handleConfirmCargoOffer = useCallback(async () => {
    if (offerBusy || !liveCargoOrder?.id) {
      return;
    }
    if (!user) {
      router.push('/login');
      return;
    }

    const driverCounter =
      typeof liveCargoOrder.driverOffer === 'number' && liveCargoOrder.driverOffer > 0
        ? liveCargoOrder.driverOffer
        : 0;
    const minFare = minFareFromDistanceMeters(routeMetrics?.distanceMeters ?? 0);
    const agreedAmount =
      driverCounter > 0 ? driverCounter : liveCargoOrder.customerOffer || parseOfferTzs(customerOfferInput);
    if (agreedAmount < minFare) {
      setFormError(copy.cargo.offerTooLow.replace('{amount}', minFare.toLocaleString('en-US')));
      return;
    }

    const fareLabel = formatTzs(agreedAmount);
    setOfferBusy(true);
    setFormError('');

    try {
      logAsyncStart(screenScope, 'confirmCargoOffer', {
        orderId: liveCargoOrder.id,
        agreedAmount,
        driverOffer: driverCounter || undefined,
      });
      await updateCargoNegotiation(liveCargoOrder.id, {
        customerOffer: agreedAmount,
        lastOfferBy: 'customer',
        fareLabel,
        totalLabel: fareLabel,
        negotiationStatus: 'confirmed',
      });
      trackCargoActivity('cargo_fare_confirmed', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        cargoSize: selectedCargoType,
        customerOffer: agreedAmount,
        orderId: liveCargoOrder.id,
      });
      router.replace({
        pathname: '/track-order',
        params: {
          orderId: liveCargoOrder.id,
        },
      });
    } catch (error) {
      const message =
        error instanceof FirebaseError
          ? getFirebaseDataErrorMessage(error.code, 'Could not confirm this fare. Try again.')
          : error instanceof Error
            ? error.message
            : 'Could not confirm this fare. Try again.';
      setFormError(message);
      logAsyncFailure(screenScope, 'confirmCargoOffer', error);
    } finally {
      setOfferBusy(false);
    }
  }, [
    copy.cargo.offerTooLow,
    customerOfferInput,
    liveCargoOrder,
    offerBusy,
    routeMetrics?.distanceMeters,
    router,
    selectedCargoType,
    selectedVehicle,
    trackCargoActivity,
    user,
  ]);

  const applySavedPlaceToPickup = useCallback(async (place: SavedPlace) => {
    logAsyncStart(screenScope, 'applySavedPlaceToPickup', place);
    try {
      reopenRouteEditor('pickup');
      const resolved = await resolveTypedLocation(place.address, dropoffPoint ?? undefined);
      const point: RoutePoint = resolved.point;
      const displayLabel = [resolved.label, resolved.address].filter(Boolean).join(', ') || place.address;
      setPickupPoint(point);
      setPickupLabel(displayLabel);
      setPickupInput(displayLabel);
      setPickupState('ready');
      setPickupNeedsSelection(false);
      setCargoRegionStatus(isCargoServiceAvailableAt(point) ? 'available' : 'out-of-reach');
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      setPickupHint('Saved pickup loaded. Enter drop-off.');
      setDropoffPoint(null);
      setDropoffLabel('');
      clearRouteState();
      setDestinationState('idle');
      setDropoffSuggestions([]);
      setShouldFetchSuggestions(true);
      pickupSessionTokenRef.current = createSearchSessionToken();
      dropoffSessionTokenRef.current = createSearchSessionToken();
      setDestinationHint('Enter drop-off location to see pricing.');
      focusDropoffField();
      try {
        focusMapOnPoint(point, 700);
      } catch {}
      logAsyncSuccess(screenScope, 'applySavedPlaceToPickup', { placeId: place.id, point });
    } catch (error) {
      logAsyncFailure(screenScope, 'applySavedPlaceToPickup', error, { placeId: place.id });
      setFormError('Could not locate that saved address. Try a more specific one.');
    }
  }, [clearRouteState, dropoffPoint, focusDropoffField, focusMapOnPoint, reopenRouteEditor]);

  const applySavedPlaceToDropoff = useCallback(async (place: SavedPlace) => {
    reopenRouteEditor('dropoff');
    resetDropoffSelection(place.address);

    try {
      await resolveAndRouteDropoff({
        query: place.address,
        manual: true,
      });
    } catch {}
  }, [reopenRouteEditor, resetDropoffSelection, resolveAndRouteDropoff]);

  const refreshPickup = useCallback(async () => {
    logAsyncStart(screenScope, 'refreshPickup');
    reopenRouteEditor('pickup');
    setPickupState('loading');
    setPickupHint('Refreshing GPS...');
    setPickupSuggestions([]);
    setLoadingPickupSuggestions(false);
    setPickupNeedsSelection(false);
    setDropoffPoint(null);
    setDropoffLabel('');
    clearRouteState();
    setDestinationState('idle');
    setDropoffSuggestions([]);
    setShouldFetchSuggestions(true);
    pickupSessionTokenRef.current = createSearchSessionToken();
    dropoffSessionTokenRef.current = createSearchSessionToken();
    setDestinationHint('Enter drop-off location to see suggestions.');

    try {
      if (!Location) {
        throw new Error('Location module unavailable');
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(status === 'granted');
      if (status !== 'granted') {
        logWarning(screenScope, 'refreshPickup permission denied', { status });
        setPickupState('error');
        setPickupLabel('Permission denied');
        setPickupInput('Permission denied');
        setPickupHint('Enable location in settings');
        trackCargoActivity('location_permission_denied', 'cargo_pickup', {
          source: 'manual_refresh',
        });
        return;
      }
      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point: RoutePoint = { latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude };
      setPickupPoint(point);
      const reverse = await reverseGeocodeLocation(point);
      const nextLabel =
        reverse.label && !isCoordinateLikeLabel(reverse.label)
          ? reverse.label
          : formatLocationLabel(null, point, reverse.label, language);
      setPickupLabel(nextLabel);
      setPickupInput(nextLabel);
      setPickupState('ready');
      setCargoRegionStatus(isCargoServiceAvailableAt(point) ? 'available' : 'out-of-reach');
      setPickupHint(language === 'sw' ? 'Pickup imesasishwa.' : 'Pickup refreshed.');
      logAsyncSuccess(screenScope, 'refreshPickup', {
        point,
        label: nextLabel,
      });
      trackCargoActivity('pickup_ready', 'cargo_pickup', {
        source: 'manual_gps_refresh',
        hasGps: true,
      });
      try {
        focusMapOnPoint(point, 700);
      } catch {}
    } catch (error) {
      logAsyncFailure(screenScope, 'refreshPickup', error);
      setPickupState('error');
      setPickupLabel('GPS unavailable');
      setPickupInput('GPS unavailable');
      setPickupHint('Check location services');
      trackCargoActivity('pickup_failed', 'cargo_pickup', {
        source: 'manual_refresh',
      });
    }
  }, [Location, clearRouteState, focusMapOnPoint, reopenRouteEditor, trackCargoActivity]);

  // Derived state for UI
  const showChooseStep = cargoLayoutStep === 'choose';
  const showVerifyStep = cargoLayoutStep === 'verify';
  // Choose step: map is route-line only — no on-map distance/ETA chips.
  const showRouteSummary = showVehicleSheet && !routeEditorExpanded && !showChooseStep && !showVerifyStep;
  const calloutInset = useMemo(
    () =>
      cargoLayoutStep === 'locations'
        ? { top: 196, right: 12, bottom: 72, left: 12 }
        : { top: 56, right: 64, bottom: 68, left: 10 },
    [cargoLayoutStep]
  );
  const pickupCallout = useMemo(
    () => (pickupScreenPoint ? attachMapCallout(pickupScreenPoint, mapSize, calloutInset) : null),
    [calloutInset, mapSize, pickupScreenPoint]
  );
  const dropoffCallout = useMemo(
    () => (dropoffScreenPoint ? attachMapCallout(dropoffScreenPoint, mapSize, calloutInset) : null),
    [calloutInset, dropoffScreenPoint, mapSize]
  );
  const activeSearchSuggestions = activeSearchField === 'pickup' ? pickupSuggestions : dropoffSuggestions;
  const activeSearchLoading = activeSearchField === 'pickup' ? loadingPickupSuggestions : loadingSuggestions;
  const activeSearchHint =
    activeSearchField === 'pickup'
      ? pickupNeedsSelection
        ? 'Choose the exact pickup point from suggestions or use GPS.'
        : pickupHint
      : destinationHint;
  const activeSearchNotice = routeNotice && routeNotice !== 'offline' ? routeNotice : null;
  const locationChipsTitle =
    activeSearchField === 'pickup' ? copy.cargo.savedPlacesShort : copy.cargo.quickPlaces;
  const shouldShowSuggestionCard =
    routeEditorExpanded &&
    (activeSearchSuggestions.length > 0 ||
      activeSearchLoading ||
      savedPlaces.length > 0 ||
      Boolean(activeSearchNotice) ||
      (activeSearchField === 'pickup' ? pickupNeedsSelection : Boolean(dropoffInput.trim())));
  const routePoints = useMemo(() => {
    if (routeMetrics?.coordinates && routeMetrics.coordinates.length > 2) {
      return filterValidCoordinates(routeMetrics.coordinates);
    }
    if (routeMetrics?.source === 'fallback') {
      return filterValidCoordinates(routeMetrics.coordinates);
    }
    return [];
  }, [routeMetrics]);
  const validPickupPoint = isValidCoordinate(pickupPoint) ? pickupPoint : null;
  const validDropoffPoint = isValidCoordinate(dropoffPoint) ? dropoffPoint : null;
  const positionedCargoDrivers = useMemo(
    () => mergeDriverLivePositions(liveDrivers, driverLocations),
    [driverLocations, liveDrivers]
  );
  const nearbyCarrierMarkers = useMemo(
    () =>
      spaceNearbyVehicles(
        buildNearbyLiveVehicles({
          drivers: positionedCargoDrivers,
          origin: validPickupPoint,
          selectedVehicleKey: selectedVehicle === 'kirikuu' ? 'kirikuu' : 'toyo',
          allowedVehicleKeys: ['toyo', 'kirikuu'],
          radiusMeters: LIVE_CARRIER_RADIUS_METERS,
          maxVisible: LIVE_CARRIER_MAX_VISIBLE_COUNT,
        }),
        mapRegion,
        mapSize
      ),
    [mapRegion, mapSize, positionedCargoDrivers, selectedVehicle, validPickupPoint]
  );
  const pickupEtaMinutes = useMemo(() => {
    const nearest = nearbyCarrierMarkers.find((vehicle) => vehicle.isSelectedType) ?? nearbyCarrierMarkers[0];
    if (nearest) {
      return estimateMinutesFromMeters(nearest.nearestDistanceMeters);
    }

    const userPoint = getCustomerLocationSnapshot().point;
    if (validPickupPoint && userPoint && isValidCoordinate(userPoint)) {
      const meters = getDistanceBetweenPoints(userPoint, validPickupPoint);
      return meters < 80 ? 0 : estimateMinutesFromMeters(meters);
    }

    return 0;
  }, [nearbyCarrierMarkers, validPickupPoint]);
  const pickupEtaLabel = formatPickupWait(pickupEtaMinutes, language);
  const tripDistanceMeters = useMemo(() => {
    // Trip km label: only Google Routes meters. Never Directions/OSRM/polyline/haversine.
    if (routeMetrics?.source === 'google' && routeMetrics.distanceMeters > 0) {
      return routeMetrics.distanceMeters;
    }
    return 0;
  }, [routeMetrics?.distanceMeters, routeMetrics?.source]);
  const tripDistanceLabel =
    tripDistanceMeters > 0 ? formatTripDistanceLabel(tripDistanceMeters) || '—' : '—';
  const bridgeOnRoute = useMemo(
    () =>
      routeCrossesNyerereBridge(
        routePoints.length >= 2
          ? routePoints
          : validPickupPoint && validDropoffPoint
            ? [validPickupPoint, validDropoffPoint]
            : [],
        { pickup: pickupLabel, dropoff: dropoffLabel || dropoffInput }
      ),
    [dropoffInput, dropoffLabel, pickupLabel, routePoints, validDropoffPoint, validPickupPoint]
  );
  const selectedToll = bridgeOnRoute ? nyerereBridgeTollTzs(selectedVehicle) : 0;
  const dropoffArrivalLabel = useMemo(() => {
    if (!validPickupPoint || !validDropoffPoint) {
      return undefined;
    }

    const polylineMeters = measurePolylineMeters(routeMetrics?.coordinates);
    const durationSeconds =
      (routeMetrics?.durationSeconds && routeMetrics.durationSeconds > 0
        ? routeMetrics.durationSeconds
        : 0) ||
      estimateDurationSecondsFromMeters(
        polylineMeters ||
          routeMetrics?.distanceMeters ||
          getDistanceBetweenPoints(validPickupPoint, validDropoffPoint)
      );
    return formatArrivalClock(new Date(Date.now() + durationSeconds * 1000));
  }, [routeMetrics?.coordinates, routeMetrics?.distanceMeters, routeMetrics?.durationSeconds, validDropoffPoint, validPickupPoint]);
  // Choose-sheet clocks: only real Routes duration — never invent pickup wait.
  const chooseDepartureLabel = formatArrivalClock(new Date());
  const chooseArrivalLabel = useMemo(() => {
    const durationSeconds = routeMetrics?.durationSeconds ?? 0;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return undefined;
    }
    return formatArrivalClock(new Date(Date.now() + durationSeconds * 1000));
  }, [routeMetrics?.durationSeconds]);
  const tripTravelLabel = formatRouteTravelTime(routeMetrics?.durationSeconds ?? 0) || '';
  const chooseTimingSummary = useMemo(() => {
    const hasGoogleDistance = tripDistanceLabel && tripDistanceLabel !== '—';
    const distancePart = hasGoogleDistance
      ? language === 'sw'
        ? `Umbali ${tripDistanceLabel}`
        : `Distance ${tripDistanceLabel}`
      : '';
    const safariPart = tripTravelLabel
      ? language === 'sw'
        ? `Safari ${tripTravelLabel}`
        : `Trip ${tripTravelLabel}`
      : '';
    return [distancePart, safariPart].filter(Boolean).join(' · ');
  }, [language, tripDistanceLabel, tripTravelLabel]);

  const projectMapCallouts = useCallback((region?: MapViewportRegion) => {
    const viewport = region ?? mapRegionRef.current;
    const size = mapSizeRef.current;
    const pickup = pickupPointRef.current;
    const dropoff = dropoffPointRef.current;

    if (isValidCoordinate(pickup)) {
      const point = projectMapCoordinate(pickup, viewport, size);
      setPickupScreenPoint(point);
    } else {
      setPickupScreenPoint(null);
    }

    if (isValidCoordinate(dropoff)) {
      const point = projectMapCoordinate(dropoff, viewport, size);
      setDropoffScreenPoint(point);
    } else {
      setDropoffScreenPoint(null);
    }
  }, []);

  const handleMapRegionChange = useCallback((region: MapViewportRegion) => {
    if (!region || !Number.isFinite(region.latitude) || !Number.isFinite(region.longitudeDelta)) {
      return;
    }
    mapRegionRef.current = region;
    projectMapCallouts(region);
  }, [projectMapCallouts]);

  const handleMapRegionComplete = useCallback((region: MapViewportRegion) => {
    if (!region || !Number.isFinite(region.latitude) || !Number.isFinite(region.longitudeDelta)) {
      return;
    }
    mapRegionRef.current = region;
    setMapRegion(region);
    projectMapCallouts(region);

    if (pullingCameraInRef.current) {
      pullingCameraInRef.current = false;
      pendingCameraFitRef.current = false;
      return;
    }

    if (pendingCameraFitRef.current && isCameraOverZoomed(region, lastFitPointsRef.current)) {
      pullCameraToCorridor(lastFitPointsRef.current);
      return;
    }

    pendingCameraFitRef.current = false;
  }, [projectMapCallouts, pullCameraToCorridor]);

  useEffect(() => {
    projectMapCallouts();
  }, [projectMapCallouts, routeMetrics?.distanceMeters, showVehicleSheet, validDropoffPoint, validPickupPoint]);
  // Compute quotes for vehicles (payable nearest-100 TZS)
  const vehicleQuotes = useMemo(() => {
    const quotes: Record<string, number> = {};
    for (const vehicle of cargoVehicles) {
      const raw = vehicleEstimates[vehicle.key]?.estimatedPrice ?? 0;
      quotes[vehicle.key] = raw > 0 ? roundPayableTzs(raw) : 0;
    }
    return quotes;
  }, [vehicleEstimates]);

  const routeMinFare = minFareFromDistanceMeters(routeMetrics?.distanceMeters ?? 0);
  const routeDistanceKm = distanceKmFromMeters(routeMetrics?.distanceMeters ?? 0);
  const activeVehicleTitle = cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title ?? 'Carrier';
  const currentOfferAmount = parseOfferTzs(customerOfferInput) || routeMinFare;
  const liveDriverName = liveCargoOrder?.driverName?.trim() || '';
  const liveDriverVehicle = cargoVehicleBadge(
    liveCargoOrder?.driverVehicleType || liveCargoOrder?.driverVehicleLabel || liveCargoOrder?.cargoVehicleKey || selectedVehicle
  );
  const liveDriverOffer =
    typeof liveCargoOrder?.driverOffer === 'number' && liveCargoOrder.driverOffer > 0
      ? liveCargoOrder.driverOffer
      : 0;
  const hasLiveDriver = Boolean(liveCargoOrder?.driverId || liveDriverName || liveDriverOffer);
  const driverPriceWaiting = hasLiveDriver && liveDriverOffer > 0 && liveCargoOrder?.lastOfferBy === 'driver';
  const driverChancesUsed = Math.max(0, Math.round(Number(liveCargoOrder?.driverNegotiationUsed) || 0));
  const driverChancesLeft = Math.max(0, 3 - driverChancesUsed);
  const driverOfferNote = liveCargoOrder?.driverOfferNote?.trim() || '';
  const lastSentOffer = liveCargoOrder?.customerOffer ?? 0;
  const canAcceptDriverOffer = hasLiveDriver && liveDriverOffer > 0 && currentOfferAmount === liveDriverOffer;
  const offerDirty = !liveCargoOrder || currentOfferAmount !== lastSentOffer;
  const offerPrimaryLabel = offerBusy
    ? copy.confirm.creating
    : !liveCargoOrder
      ? copy.cargo.findOffers
      : canAcceptDriverOffer
        ? copy.cargo.acceptFare
        : offerDirty
          ? copy.cargo.sendPrice
          : copy.cargo.findOffers;
  const offerPrimaryDisabled =
    offerBusy || currentOfferAmount < routeMinFare || (Boolean(liveCargoOrder) && !offerDirty && !canAcceptDriverOffer);

  const bumpOffer = useCallback(
    (delta: number) => {
      setFormError('');
      const next = Math.max(routeMinFare, currentOfferAmount + delta);
      setCustomerOfferInput(String(next));
    },
    [currentOfferAmount, routeMinFare]
  );

  useEffect(() => {
    if (cargoSheetStep !== 'choose') {
      return;
    }
    const quoted = vehicleQuotes[selectedVehicle] || 0;
    const toll = bridgeOnRoute ? nyerereBridgeTollTzs(selectedVehicle) : 0;
    const listedFare = roundPayableTzs(Math.max(routeMinFare, quoted) + toll);
    if (listedFare > 0) {
      setCustomerOfferInput(String(listedFare));
    }
  }, [bridgeOnRoute, cargoSheetStep, routeMinFare, selectedVehicle, vehicleQuotes]);

  useEffect(() => {
    const orderId = liveCargoOrder?.id;
    if (!orderId) {
      return;
    }
    const unsubscribe = subscribeToOrder(
      orderId,
      (next) => {
        if (next) {
          setLiveCargoOrder(next);
        }
      },
      (error) => {
        logWarning(screenScope, 'subscribeToCargoOffer', { orderId, message: error.message });
      }
    );
    return () => unsubscribe();
  }, [liveCargoOrder?.id]);

  useEffect(() => {
    if (!liveCargoOrder?.id) {
      return;
    }
    if (liveCargoOrder.negotiationStatus === 'confirmed' || liveCargoOrder.acceptedByDriverAt) {
      router.replace({
        pathname: '/track-order',
        params: {
          orderId: liveCargoOrder.id,
        },
      });
    }
  }, [liveCargoOrder?.acceptedByDriverAt, liveCargoOrder?.id, liveCargoOrder?.negotiationStatus, router]);

  const handleVehicleSelect = useCallback((vehicleKey: RouteEstimateVehicleType) => {
    const vehicle = cargoVehicles.find((item) => item.key === vehicleKey);
    setSelectedVehicle(vehicleKey);
    trackCargoActivity('cargo_vehicle_selected', 'cargo_vehicle', {
      vehicleType: vehicleKey,
      vehicleLabel: vehicle?.title,
      cargoSize: selectedCargoType,
      hasRoute: Boolean(routeMetrics),
      distanceMeters: routeMetrics ? Math.round(routeMetrics.distanceMeters) : undefined,
      estimatedPrice: vehicleQuotes[vehicleKey],
      matchingCarrierCount: nearbyCarrierMarkers.filter((driver) => driver.vehicleKey === vehicleKey).length,
    });
  }, [nearbyCarrierMarkers, routeMetrics, selectedCargoType, trackCargoActivity, vehicleQuotes]);

  const closeCargoSocket = useCallback(() => {
    cargoSocketRef.current?.close();
    cargoSocketRef.current = null;
  }, []);

  const startCargoVerifySocket = useCallback(
    (orderId: string, userId: string) => {
      closeCargoSocket();
      setVerifyPhase('connecting');
      setVerifyError('');
      try {
        const client = connectCargoOfferSocket({
          onOpen: () => {
            void (async () => {
              const token = await auth.currentUser?.getIdToken().catch(() => '');
              if (!token) {
                setVerifyPhase('error');
                setVerifyError(copy.cargo.verifyConnectionError);
                return;
              }
              client.send({ type: 'hello', role: 'customer', userId, token });
              client.send({ type: 'customer_request', orderId, userId, token });
            })();
          },
          onEvent: (event) => {
            if (event.type === 'assigned') {
              const found = Math.max(
                Number(event.nearbyCount || 0),
                Array.isArray(event.nearbyDrivers) ? event.nearbyDrivers.length : 0,
                event.driver ? 1 : 0
              );
              setVerifyAssignedDriver(event.driver || null);
              setVerifyNearbyDrivers(Array.isArray(event.nearbyDrivers) ? event.nearbyDrivers : []);
              setVerifyDriversFound(found);
              // Zero candidates must never show "waiting to confirm" / nearby copy.
              setVerifyPhase(found >= 1 ? 'waiting' : 'no_driver');
              setVerifyError('');
              return;
            }
            if (event.type === 'no_driver' || event.type === 'declined') {
              setVerifyAssignedDriver(null);
              setVerifyNearbyDrivers([]);
              setVerifyDriversFound(0);
              setVerifyPhase('no_driver');
              return;
            }
            if (event.type === 'accepted') {
              closeCargoSocket();
              router.replace({
                pathname: '/track-order',
                params: { orderId },
              });
              return;
            }
            if (event.type === 'cancelled') {
              closeCargoSocket();
              setLiveCargoOrder(null);
              setCargoSheetStep('choose');
              setVerifyPhase('connecting');
              return;
            }
            if (event.type === 'error') {
              const raw = String(event.message || '');
              const looksDev =
                /websocket|ws url|ws is|EXPO_PUBLIC_CARGO|ensure ws|cargo-offer-ws/i.test(raw);
              setVerifyPhase('error');
              setVerifyError(looksDev || !raw ? copy.cargo.verifyConnectionError : raw);
            }
          },
          onError: () => {
            setVerifyPhase('error');
            setVerifyError(copy.cargo.verifyConnectionError);
          },
        });
        cargoSocketRef.current = client;
      } catch (error) {
        setVerifyPhase('error');
        const raw = error instanceof Error ? error.message : '';
        const looksDev =
          /websocket|ws url|EXPO_PUBLIC_CARGO|Missing cargo offer/i.test(raw);
        setVerifyError(looksDev || !raw ? copy.cargo.verifyConnectionError : raw);
      }
    },
    [closeCargoSocket, copy.cargo.verifyConnectionError, router]
  );

  useEffect(() => {
    return () => {
      closeCargoSocket();
    };
  }, [closeCargoSocket]);

  const handleCancelVerify = useCallback(async () => {
    if (verifyCancelBusy) {
      return;
    }
    setVerifyCancelBusy(true);
    setVerifyError('');
    try {
      const orderId = liveCargoOrder?.id;
      const userId = user?.uid;
      if (orderId && userId) {
        const token = await auth.currentUser?.getIdToken().catch(() => '');
        const sent =
          token &&
          cargoSocketRef.current?.send({
            type: 'customer_cancel',
            orderId,
            userId,
            token,
          });
        if (!sent) {
          await cancelDeliveryOrderByUser(orderId, language === 'sw' ? 'Mteja ameghairi' : 'Customer cancelled');
        }
      }
      closeCargoSocket();
      setLiveCargoOrder(null);
      setVerifyAssignedDriver(null);
      setVerifyNearbyDrivers([]);
      setVerifyDriversFound(0);
      setVerifyPhase('connecting');
      setCargoSheetStep('choose');
      trackCargoActivity('cargo_verify_cancelled', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        orderId: orderId || undefined,
      });
    } catch (error) {
      setVerifyError(
        error instanceof Error
          ? error.message
          : language === 'sw'
            ? 'Imeshindikana kughairi.'
            : 'Could not cancel.'
      );
    } finally {
      setVerifyCancelBusy(false);
    }
  }, [
    closeCargoSocket,
    language,
    liveCargoOrder?.id,
    selectedVehicle,
    trackCargoActivity,
    user?.uid,
    verifyCancelBusy,
  ]);

  const handleChooseVehicle = useCallback(async () => {
    if (verifyBusy || offerBusy) {
      return;
    }
    setFormError('');

    if (!pickupPoint || !dropoffPoint || !routeMetrics) {
      setFormError(language === 'sw' ? 'Weka pickup na drop-off kwanza.' : 'Set pickup and drop-off first.');
      return;
    }
    if (
      !isPricableRouteSource(routeMetrics.source) ||
      !routeEstimate?.distanceMeters ||
      !(routeEstimate.distanceMeters > 0)
    ) {
      setFormError(
        language === 'sw'
          ? 'Hakuna njia ya barabara ya bei. Jaribu tena au chagua sehemu nyingine.'
          : 'No road route for pricing. Try again or pick different points.'
      );
      return;
    }
    if (!user) {
      router.push('/login');
      return;
    }

    const quoted = vehicleQuotes[selectedVehicle] || 0;
    const toll = bridgeOnRoute ? nyerereBridgeTollTzs(selectedVehicle) : 0;
    const listedFare = roundPayableTzs(Math.max(routeMinFare, quoted) + toll);
    setCustomerOfferInput(String(listedFare));

    let sharedPhone =
      readablePhone(profile?.phoneNumber) || readablePhone(user.phoneNumber) || '';
    if (!sharedPhone) {
      try {
        const freshProfile = await getUserProfile(user.uid);
        sharedPhone = readablePhone(freshProfile?.phoneNumber) || '';
        if (sharedPhone) {
          void refreshProfile();
        }
      } catch {
        // Proceed without phone — do not block the CTA.
      }
    }

    const vehicleTitle = cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title ?? 'Carrier';
    const distanceKm = distanceKmFromMeters(routeMetrics.distanceMeters);
    const etaString = formatRouteTravelTime(routeMetrics.durationSeconds) || formatDistance(routeMetrics.distanceMeters);
    const distanceLabel = formatDistance(routeMetrics.distanceMeters);
    const fareLabel = formatTzs(listedFare);
    const dropoffDisplay = dropoffLabel || dropoffInput;
    const scheduleLabel =
      timingMode === 'later' && scheduleDate && scheduleTime
        ? formatScheduleSummary(scheduleDate, scheduleTime, language)
        : language === 'sw'
          ? 'Sasa'
          : 'Dispatch now';
    const customerName = profile?.fullName?.trim() || user.displayName?.trim() || 'DoorDrop Customer';

    setVerifyBusy(true);
    setOfferBusy(true);
    try {
      const [readablePickup, readableDropoff] = await Promise.all([
        ensureReadablePlaceLabel(pickupPoint, pickupLabel),
        ensureReadablePlaceLabel(dropoffPoint, dropoffDisplay),
      ]);

      let order = liveCargoOrder;
      if (order?.id && order.negotiationStatus !== 'confirmed' && !order.acceptedByDriverAt) {
        await updateCargoNegotiation(order.id, {
          customerOffer: listedFare,
          lastOfferBy: 'customer',
          customerOfferNote: copy.cargo.offerNoteDefault,
          fareLabel,
          totalLabel: fareLabel,
          cargoVehicleKey: selectedVehicle,
          cargoVehicleLabel: vehicleTitle,
          serviceLabel: vehicleTitle,
          customerPhone: sharedPhone,
          recipientPhone: sharedPhone,
          negotiationStatus: 'open',
          assignmentMode: 'cargo_ws',
          cargoDispatch: 'instant',
        });
      } else {
        order = await createDeliveryOrder({
          userId: user.uid,
          customerName,
          customerEmail: user.email?.trim().toLowerCase() || '',
          customerPhone: sharedPhone,
          flow: 'cargo',
          serviceLabel: vehicleTitle,
          pickupLabel: readablePickup,
          dropoffLabel: readableDropoff,
          pickupLatitude: pickupPoint.latitude,
          pickupLongitude: pickupPoint.longitude,
          dropoffLatitude: dropoffPoint.latitude,
          dropoffLongitude: dropoffPoint.longitude,
          etaLabel: etaString,
          fareLabel,
          totalLabel: fareLabel,
          fareType: 'negotiated',
          customerOffer: listedFare,
          minFare: routeMinFare,
          distanceKm,
          lastOfferBy: 'customer',
          negotiationStatus: 'open',
          driverNegotiationUsed: 0,
          customerOfferNote: copy.cargo.offerNoteDefault,
          routeLabel: `${readablePickup} → ${readableDropoff}`,
          timingMode,
          scheduleDate,
          scheduleTime,
          scheduleLabel,
          recipientName: customerName,
          recipientPhone: sharedPhone,
          cargoVehicleKey: selectedVehicle,
          cargoVehicleLabel: vehicleTitle,
          cargoCapacityLabel: cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.capacity,
          cargoSizeLabel: undefined,
          distanceLabel,
          durationLabel: etaString,
          distanceMeters: Math.round(routeMetrics.distanceMeters),
          durationSeconds: Math.round(routeMetrics.durationSeconds),
          requestedDriverId: String(params.requestedDriverId || ''),
          requestedDriverName: String(params.requestedDriverName || ''),
          assignmentMode: 'cargo_ws',
          cargoDispatch: 'instant',
        });
        setLiveCargoOrder(order);
      }

      const orderId = order?.id || liveCargoOrder?.id;
      if (!orderId) {
        throw new Error(language === 'sw' ? 'Imeshindikana kuunda oda.' : 'Could not create order.');
      }

      setVerifyAssignedDriver(null);
      setVerifyNearbyDrivers([]);
      setVerifyDriversFound(
        nearbyCarrierMarkers.filter((marker) => marker.vehicleKey === selectedVehicle).length
      );
      setVerifyPhase('connecting');
      setCargoSheetStep('verify');
      startCargoVerifySocket(orderId, user.uid);

      trackCargoActivity('cargo_carrier_confirmed', 'cargo_vehicle', {
        vehicleType: selectedVehicle,
        cargoSize: selectedCargoType,
        minFare: routeMinFare,
        distanceKm: routeDistanceKm,
        customerOffer: listedFare,
        orderId,
      });
    } catch (error) {
      const message =
        error instanceof FirebaseError
          ? getFirebaseDataErrorMessage(error.code, 'Could not start driver verify.')
          : error instanceof Error
            ? error.message
            : 'Could not start driver verify.';
      setFormError(message);
      setCargoSheetStep('choose');
    } finally {
      setVerifyBusy(false);
      setOfferBusy(false);
    }
  }, [
    bridgeOnRoute,
    copy.cargo.offerNoteDefault,
    dropoffInput,
    dropoffLabel,
    dropoffPoint,
    language,
    liveCargoOrder,
    nearbyCarrierMarkers,
    offerBusy,
    params.requestedDriverId,
    params.requestedDriverName,
    pickupLabel,
    pickupPoint,
    profile?.fullName,
    profile?.phoneNumber,
    refreshProfile,
    routeDistanceKm,
    routeMetrics,
    routeMinFare,
    router,
    scheduleDate,
    scheduleTime,
    selectedCargoType,
    selectedVehicle,
    startCargoVerifySocket,
    timingMode,
    trackCargoActivity,
    user,
    vehicleQuotes,
    verifyBusy,
  ]);

  useEffect(() => {
    LayoutAnimation.configureNext({
      duration: SHEET_ANIMATION_MS,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    Animated.timing(sheetHeightAnim, {
      toValue: targetSheetHeight,
      duration: SHEET_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    if (pickupPoint && dropoffPoint) {
      fitMapToPickupAndDropoff(pickupPoint, dropoffPoint, 200);
      return;
    }

    if (pickupPoint) {
      focusMapOnPoint(pickupPoint, 500);
    }
  }, [
    cargoLayoutStep,
    dropoffPoint,
    fitMapToPickupAndDropoff,
    focusMapOnPoint,
    pickupPoint,
    sheetHeightAnim,
    targetSheetHeight,
  ]);

  const handleMapPress = useCallback(async (event: any) => {
    const point: RoutePoint | undefined = event?.nativeEvent?.coordinate;
    if (!isValidCoordinate(point)) {
      return;
    }

    let resolvedLabel = language === 'sw' ? 'Inatafuta eneo...' : 'Finding place...';

    try {
      const reverse = await reverseGeocodeLocation(point);
      if (reverse.label && !isCoordinateLikeLabel(reverse.label)) {
        resolvedLabel = reverse.label;
      } else if (reverse.label?.trim()) {
        resolvedLabel = reverse.label.trim();
      }
    } catch {}

    if (mapSelectionTarget === 'pickup') {
      reopenRouteEditor('dropoff');
      setPickupPoint(point);
      setPickupLabel(resolvedLabel);
      setPickupInput(resolvedLabel);
      setPickupState('ready');
      setCargoRegionStatus(isCargoServiceAvailableAt(point) ? 'available' : 'out-of-reach');
      setPickupHint(
        language === 'sw'
          ? 'Pickup imewekwa kwenye ramani. Weka drop-off.'
          : 'Pickup pin placed on the map. Set the drop-off to redraw pricing.'
      );
      setPickupNeedsSelection(false);
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      setFormError('');
      clearRouteState();
      setDropoffPoint(null);
      setDropoffLabel('');
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      setShouldFetchSuggestions(true);
      setDestinationState('idle');
      setDestinationHint('Pickup set from the map. Search or place the drop-off pin next.');
      pickupSessionTokenRef.current = createSearchSessionToken();
      dropoffSessionTokenRef.current = createSearchSessionToken();
      focusMapOnPoint(point, 600);
      focusDropoffField();
      return;
    }

    reopenRouteEditor('dropoff');
    clearRouteState();
    setDropoffPoint(point);
    setDropoffLabel(resolvedLabel);
    setDropoffInput(resolvedLabel);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    setDestinationState('searching');
    setDestinationHint('Destination pin placed. Calculating route and live vehicle pricing...');
    setFormError('');

    await resolveAndRouteDropoff({
      query: resolvedLabel,
      point,
      manual: false,
    });
  }, [Location, clearRouteState, focusDropoffField, focusMapOnPoint, language, mapSelectionTarget, reopenRouteEditor, resolveAndRouteDropoff]);

  // ============================================
  // RENDER
  // ============================================

  if (cargoRegionStatus === 'checking' || cargoRegionStatus === 'out-of-reach') {
    const isOutOfReach = cargoRegionStatus === 'out-of-reach';
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.outOfReachScreen}>
        <StatusBar barStyle="dark-content" backgroundColor="#F7F7F5" />
        <View style={styles.outOfReachGlow} />
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.outOfReachBack}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace('/home');
          }}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.outOfReachBody}>
          {isOutOfReach ? (
            <>
              <View style={styles.outOfReachArtWell}>
                <Image
                  source={images.cargoOutOfReachAvatar}
                  style={styles.outOfReachAvatar}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.outOfReachTitle}>{copy.cargo.outOfReachTitle}</Text>
              <Text style={styles.outOfReachText}>{copy.cargo.outOfReachText}</Text>
              <Text style={styles.outOfReachHint}>{copy.cargo.outOfReachHint}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.outOfReachButton}
                onPress={() => router.replace('/home')}>
                <Text style={styles.outOfReachButtonText}>{copy.cargo.outOfReachBack}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={cargoTheme.colors.primary} />
              <Text style={styles.outOfReachChecking}>{copy.cargo.checkingRegion}</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <View style={styles.mapPane}>
      {/* Real Google Map */}
      {mapCanRender && NativeMapView && Marker && Polyline ? (
        <View
          style={styles.mapStage}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            if (width < 8 || height < 8) {
              return;
            }
            const heightChanged = Math.abs(height - mapSizeRef.current.height) > 24;
            const nextSize = { width, height };
            mapSizeRef.current = nextSize;
            setMapSize(nextSize);
            projectMapCallouts();
            if (
              heightChanged &&
              isValidCoordinate(pickupPointRef.current) &&
              isValidCoordinate(dropoffPointRef.current)
            ) {
              fitMapToPickupAndDropoff(pickupPointRef.current, dropoffPointRef.current, 80);
            }
          }}>
          <NativeMapView
            ref={mapRef}
            provider={mapProvider}
            style={styles.map}
            customMapStyle={cargoMapStyle}
            showsUserLocation={hasLocationPermission}
            showsMyLocationButton={false}
            showsCompass={false}
            showsScale={false}
            showsTraffic={false}
            showsIndoors={false}
            showsBuildings={false}
            showsPointsOfInterest={false}
            toolbarEnabled={false}
            moveOnMarkerPress={false}
            initialRegion={{
              latitude: validPickupPoint?.latitude ?? defaultPickupPoint.latitude,
              longitude: validPickupPoint?.longitude ?? defaultPickupPoint.longitude,
              latitudeDelta: 0.045,
              longitudeDelta: 0.04,
            }}
            onMapReady={() => projectMapCallouts()}
            onRegionChange={handleMapRegionChange}
            onRegionChangeComplete={handleMapRegionComplete}
            onPress={handleMapPress}>
            {validPickupPoint ? (
              <Marker
                key="cargo-pickup-pin"
                coordinate={validPickupPoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges
                draggable={mapSelectionTarget === 'pickup'}
                onDragEnd={(event) => {
                  void handleMapPress(event);
                }}
                zIndex={8}>
                <CargoBullseyePin kind="pickup" />
              </Marker>
            ) : null}
            {validDropoffPoint ? (
              <Marker
                key="cargo-dropoff-pin"
                coordinate={validDropoffPoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges
                draggable={mapSelectionTarget === 'dropoff'}
                onDragEnd={(event) => {
                  void handleMapPress(event);
                }}
                zIndex={9}>
                <CargoBullseyePin kind="dropoff" />
              </Marker>
            ) : null}
            {!showChooseStep ? (
              <NearbyLiveVehicleMarkers
                vehicles={nearbyCarrierMarkers}
                Marker={Marker}
                MarkerAnimated={MarkerAnimated}
                AnimatedRegion={AnimatedRegion}
                pinStyle="silhouette"
              />
            ) : null}
            <MapRouteLine
              Polyline={Polyline}
              coordinates={routePoints}
              fallback={routeMetrics?.source === 'fallback'}
            />
          </NativeMapView>
          {!showChooseStep && pickupCallout ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCalloutLayer,
                {
                  width: CARGO_CALLOUT_LAYOUT.width,
                  height: CARGO_CALLOUT_LAYOUT.overlayHeight,
                  transform: [{ translateX: pickupCallout.x }, { translateY: pickupCallout.y }],
                },
              ]}>
              <CargoRouteCallout
                kind="pickup"
                title={copy.cargo.mapPickup}
                detail={pickupEtaLabel}
                showPin={false}
                placement={pickupCallout.placement}
                stemOffset={pickupCallout.stemOffset}
              />
            </View>
          ) : null}
          {!showChooseStep && dropoffCallout && dropoffArrivalLabel ? (
            <View
              pointerEvents="none"
              style={[
                styles.mapCalloutLayer,
                {
                  width: CARGO_CALLOUT_LAYOUT.width,
                  height: CARGO_CALLOUT_LAYOUT.overlayHeight,
                  transform: [{ translateX: dropoffCallout.x }, { translateY: dropoffCallout.y }],
                },
              ]}>
              <CargoRouteCallout
                kind="dropoff"
                title={copy.cargo.mapDropoff}
                detail={dropoffArrivalLabel}
                showPin={false}
                placement={dropoffCallout.placement}
                stemOffset={dropoffCallout.stemOffset}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.map, styles.mapUnavailableCard]}>
          <Text style={styles.mapUnavailableTitle}>Google Map not ready</Text>
          <Text style={styles.mapUnavailableText}>
            Add `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to the Expo app config so the real Google map renders in the APK.
          </Text>
        </View>
      )}

      <View pointerEvents="box-none" style={styles.topOverlay}>
        <View style={styles.chromeRow}>
          <TouchableOpacity style={styles.chromeButton} onPress={handleGoBack}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
        </View>

        {scheduleBannerLabel ? (
          <View style={styles.scheduleBannerChip}>
            <MaterialCommunityIcons name="calendar-clock" size={16} color={cargoTheme.colors.primaryDark} />
            <Text style={styles.scheduleBannerChipText}>{scheduleBannerLabel}</Text>
          </View>
        ) : null}

        {routeEditorExpanded ? (
          <View style={styles.searchStack}>
            <View style={[styles.searchCard, shouldShowSuggestionCard && styles.searchCardJoined]}>
              <View style={styles.searchFieldShell}>
                <View style={styles.searchFieldRow}>
                  <View style={styles.pickupDot} />
                  <View style={styles.routeCopy}>
                    <TextInput
                      ref={pickupInputRef}
                      value={pickupInput}
                      onChangeText={handlePickupChange}
                      onFocus={() => reopenRouteEditor('pickup')}
                      placeholder={copy.cargo.pickupPlaceholder}
                      placeholderTextColor="#94A3B8"
                      style={styles.routeInput}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                  </View>
                  {pickupState === 'loading' ? (
                    <ActivityIndicator size="small" color={cargoTheme.colors.primaryDark} />
                  ) : (
                    <Pressable hitSlop={10} onPress={refreshPickup}>
                      <MaterialCommunityIcons name="crosshairs-gps" size={22} color={cargoTheme.colors.primaryDark} />
                    </Pressable>
                  )}
                </View>

                <View style={styles.searchFieldHairline} />

                <View style={styles.searchFieldRow}>
                  <View style={styles.dropoffSquare} />
                  <View style={styles.routeCopy}>
                    <TextInput
                      ref={dropoffInputRef}
                      value={dropoffInput}
                      onChangeText={resetDropoffSelection}
                      onFocus={() => reopenRouteEditor('dropoff')}
                      placeholder={copy.cargo.dropoffPlaceholder}
                      placeholderTextColor="#94A3B8"
                      style={styles.routeInput}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => resolveAndRouteDropoff({ manual: true })}
                    />
                  </View>
                  <View style={styles.routeActions}>
                    {dropoffInput ? (
                      <Pressable hitSlop={10} onPress={clearDropoffSelection}>
                        <MaterialCommunityIcons name="close" size={20} color="#94A3B8" />
                      </Pressable>
                    ) : null}
                    {destinationState === 'searching' || loadingSuggestions ? (
                      <ActivityIndicator size="small" color={cargoTheme.colors.primaryDark} />
                    ) : (
                      <Pressable hitSlop={10} onPress={() => resolveAndRouteDropoff({ manual: true })}>
                        <MaterialCommunityIcons name="magnify" size={22} color={cargoTheme.colors.primaryDark} />
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {shouldShowSuggestionCard ? (
              <View style={styles.searchResultsCard}>
                {activeSearchNotice ? (
                  <View style={styles.noticeWrap}>
                    <ServiceNotice kind={activeSearchNotice} />
                  </View>
                ) : null}

                {savedPlaces.length ? (
                  <>
                    <Text style={styles.searchResultsSectionLabel}>{locationChipsTitle}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlacesRow}>
                      {savedPlaces.map((place) => (
                        <TouchableOpacity
                          key={place.id}
                          activeOpacity={0.88}
                          style={styles.savedPlaceChip}
                          onPress={() => {
                            if (activeSearchField === 'pickup') {
                              void applySavedPlaceToPickup(place);
                              return;
                            }

                            void applySavedPlaceToDropoff(place);
                          }}>
                          <MaterialCommunityIcons name={place.icon} size={15} color="#111827" />
                          <Text style={styles.savedPlaceChipText}>{place.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                ) : null}

                <ScrollView
                  style={styles.suggestionScroll}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}>
                  <LocationSuggestionsList
                    embedded
                    variant="haul"
                    tone={activeSearchField === 'pickup' ? 'pickup' : 'dropoff'}
                    loading={activeSearchLoading}
                    loadingLabel={copy.cargo.suggestionSearching}
                    suggestions={activeSearchSuggestions}
                    showEmpty={
                      activeSearchField === 'dropoff' && dropoffInput.trim().length >= 3 && !activeSearchLoading
                    }
                    emptyLabel={copy.cargo.suggestionEmpty}
                    onSelect={(suggestion) => {
                      if (activeSearchField === 'pickup') {
                        void handleSelectPickupSuggestion(suggestion);
                        return;
                      }

                      void resolveAndRouteDropoff({
                        query: suggestion.fullText,
                        suggestion,
                        manual: true,
                      });
                    }}
                  />
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : showVerifyStep ? (
          <View style={styles.verifyPillWrap} pointerEvents="box-none">
            <CargoDriversFoundPill
              count={verifyDriversFound}
              label={
                verifyPhase === 'no_driver' || verifyDriversFound <= 0
                  ? copy.cargo.verifyDriversNone
                  : verifyDriversFound === 1
                    ? copy.cargo.verifyDriversOne
                    : copy.cargo.verifyDriversFound
              }
            />
          </View>
        ) : showRouteSummary ? (
          <View style={styles.routeSummaryStack}>
            <TouchableOpacity activeOpacity={0.9} style={styles.routeSummaryBar} onPress={() => reopenRouteEditor('dropoff')}>
              <Text numberOfLines={1} style={styles.routeSummaryText}>
                {formatCompactLocationLabel(pickupLabel, copy.cargo.pickup)}
              </Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#111827" />
              <Text numberOfLines={1} style={styles.routeSummaryText}>
                {formatCompactLocationLabel(dropoffLabel || dropoffInput, copy.cargo.dropoff)}
              </Text>
            </TouchableOpacity>
            <View style={styles.routeFactRow}>
              <View style={styles.routeFactChip}>
                <Text style={styles.routeFactKicker}>ETA</Text>
                <Text style={styles.routeFactValue}>
                  {formatRouteTravelTime(routeMetrics?.durationSeconds ?? 0) || dropoffArrivalLabel || '—'}
                </Text>
              </View>
              <View style={styles.routeFactChip}>
                <Text style={styles.routeFactKicker}>{copy.cargo.distance}</Text>
                <Text style={styles.routeFactValue}>{tripDistanceLabel}</Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.88}
        style={[
          styles.recenterFab,
          { bottom: 16 },
        ]}
        onPress={() => {
          if (validPickupPoint && validDropoffPoint) {
            fitMapToPickupAndDropoff(validPickupPoint, validDropoffPoint, 0);
            return;
          }
          if (validPickupPoint) {
            focusMapOnPoint(validPickupPoint, 500);
          }
        }}>
        <MaterialCommunityIcons name="crosshairs-gps" size={22} color={cargoTheme.colors.ink} />
      </TouchableOpacity>

      </View>

      <Animated.View
        style={[
          styles.vehicleSheet,
          showVerifyStep && styles.vehicleSheetVerify,
          {
            height: sheetHeightAnim,
            paddingHorizontal: targetSheetHeight > 0 && !showVerifyStep ? 18 : 0,
            paddingTop: targetSheetHeight > 0 && !showVerifyStep ? 10 : 0,
          },
        ]}>
        {targetSheetHeight > 0 ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.vehicleSheetInner}>
          {showChooseStep ? <View style={styles.vehicleSheetHandle} /> : null}
          {showChooseStep ? (
            <>
              {chooseArrivalLabel ? (
                <View style={styles.sheetFacts}>
                  <View style={styles.sheetFact}>
                    <Text style={styles.sheetFactLabel}>
                      {language === 'sw' ? 'Kutoka' : 'Depart'}
                    </Text>
                    <Text style={styles.sheetFactValue}>{chooseDepartureLabel}</Text>
                  </View>
                  <View style={styles.sheetFactRule} />
                  <View style={styles.sheetFact}>
                    <Text style={styles.sheetFactLabel}>
                      {language === 'sw' ? 'Kufika' : 'Arrive'}
                    </Text>
                    <Text style={styles.sheetFactValue}>{chooseArrivalLabel}</Text>
                  </View>
                </View>
              ) : null}
              {chooseTimingSummary ? (
                <Text style={styles.sheetTimingSummary}>{chooseTimingSummary}</Text>
              ) : null}
              {selectedToll > 0 ? (
                <View style={styles.tollNotice}>
                  <View style={styles.tollMark}>
                    <MaterialCommunityIcons name="bridge" size={16} color="#111827" />
                  </View>
                  <View style={styles.tollCopy}>
                    <Text style={styles.tollTitle}>
                      {copy.cargo.tollIncluded.replace('{amount}', selectedToll.toLocaleString('en-US'))}
                    </Text>
                    <Text style={styles.tollHint}>{copy.cargo.tollNoExtra}</Text>
                  </View>
                </View>
              ) : null}

              <ScrollView
                style={styles.vehicleListScroll}
                contentContainerStyle={styles.vehicleList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                {cargoVehicles.map((vehicle) => {
                  const isActive = vehicle.key === selectedVehicle;
                  const tripEta =
                    formatRouteTravelTime(routeMetrics?.durationSeconds ?? 0) || dropoffArrivalLabel || '';
                  const quoted = vehicleQuotes[vehicle.key] || 0;
                  const toll = bridgeOnRoute ? nyerereBridgeTollTzs(vehicle.key) : 0;
                  const listedFare = roundPayableTzs((quoted > 0 ? quoted : routeMinFare) + toll);
                  return (
                    <TouchableOpacity
                      key={vehicle.key}
                      activeOpacity={0.9}
                      style={[styles.vehicleRow, isActive && styles.vehicleRowActive]}
                      onPress={() => handleVehicleSelect(vehicle.key)}>
                      <View style={styles.vehicleAvatarWrap}>
                        <Image source={vehicleImages[vehicle.key]} style={styles.vehicleAvatar} resizeMode="contain" />
                      </View>
                      <View style={styles.vehicleCopy}>
                        <Text numberOfLines={1} style={styles.vehicleRowTitle}>{vehicle.title}</Text>
                        <Text numberOfLines={1} style={styles.vehicleRowMeta}>
                          {tripEta ? `${tripEta} · ${vehicle.capacity}` : vehicle.capacity}
                        </Text>
                      </View>
                      <Text style={styles.vehicleRowPrice}>{formatTzs(listedFare)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={[styles.vehicleSheetFooter, { paddingBottom: safeSheetBottom + 6 }]}>
                <View style={styles.paymentRow}>
                  <MaterialCommunityIcons name="cash" size={22} color={cargoTheme.colors.ink} />
                  <Text style={styles.paymentRowLabel}>{copy.cargo.cash}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
                </View>

                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <PrimaryButton
                  label={
                    verifyBusy || offerBusy
                      ? copy.confirm.creating
                      : copy.cargo.chooseVehicle.replace('{vehicle}', activeVehicleTitle)
                  }
                  onPress={() => void handleChooseVehicle()}
                  style={styles.ctaButton}
                  disabled={verifyBusy || offerBusy}
                />
              </View>
            </>
          ) : showVerifyStep ? (
            <CargoDriverVerifySheet
              phase={
                verifyPhase === 'waiting' && verifyDriversFound <= 0 ? 'no_driver' : verifyPhase
              }
              statusTitle={
                verifyPhase === 'error'
                  ? copy.cargo.verifyConnectionTitle
                  : verifyPhase === 'no_driver' ||
                      (verifyPhase === 'waiting' && verifyDriversFound <= 0)
                    ? copy.cargo.verifyNoDriverTitle
                    : verifyPhase === 'waiting' && verifyDriversFound >= 1
                      ? copy.cargo.verifyTitle
                      : copy.cargo.verifyConnecting
              }
              statusHint={
                verifyPhase === 'error'
                  ? copy.cargo.verifyConnectionError
                  : verifyPhase === 'no_driver' ||
                      (verifyPhase === 'waiting' && verifyDriversFound <= 0)
                    ? copy.cargo.verifyNoDriverHint.replace('{vehicle}', activeVehicleTitle)
                    : verifyPhase === 'waiting' && verifyDriversFound >= 1
                      ? copy.cargo.verifyHint.replace('{vehicle}', activeVehicleTitle)
                      : copy.cargo.verifyConnectingHint.replace('{vehicle}', activeVehicleTitle)
              }
              vehicleTitle={activeVehicleTitle}
              vehicleImage={vehicleImages[selectedVehicle]}
              fareLabel={formatTzs(
                roundPayableTzs(
                  Math.max(routeMinFare, vehicleQuotes[selectedVehicle] || 0) + selectedToll
                )
              )}
              nearbyLine={
                verifyPhase === 'waiting' && verifyDriversFound >= 1
                  ? verifyDriversFound === 1
                    ? copy.cargo.verifyNearbyOne
                    : copy.cargo.verifyNearbyLine.replace('{count}', String(verifyDriversFound))
                  : verifyPhase === 'connecting'
                    ? copy.cargo.verifyConnectingHint.replace('{vehicle}', activeVehicleTitle)
                    : copy.cargo.verifyDriversNone
              }
              nearbyPhotos={verifyNearbyDrivers.map((driver) => driver.photoURL)}
              cancelLabel={
                verifyCancelBusy
                  ? language === 'sw'
                    ? 'Inaghairi...'
                    : 'Cancelling...'
                  : copy.cargo.verifyCancel
              }
              onCancel={() => void handleCancelVerify()}
              cancelDisabled={verifyCancelBusy}
              bottomInset={safeSheetBottom}
              errorText={verifyError || formError || undefined}
            />
          ) : null}
        </KeyboardAvoidingView>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  offerScreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  offerScreenInner: {
    flex: 1,
  },
  offerScreenHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  offerScreenBody: {
    flex: 1,
  },
  offerScreenContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  offerScreenTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  offerScreenSubtitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginBottom: 8,
  },
  offerHint: {
    fontSize: 15,
    lineHeight: 21,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
    marginBottom: 26,
  },
  offerScreenFooter: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  outOfReachScreen: {
    flex: 1,
    backgroundColor: '#F7F7F5',
  },
  outOfReachGlow: {
    position: 'absolute',
    top: -80,
    alignSelf: 'center',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#FFE500',
    opacity: 0.22,
  },
  outOfReachBack: {
    width: 44,
    height: 44,
    marginLeft: 18,
    marginTop: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3EEE7',
    zIndex: 2,
  },
  outOfReachBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 56,
  },
  outOfReachArtWell: {
    width: 280,
    height: 280,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: '#14532D',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
    overflow: 'hidden',
  },
  outOfReachAvatar: {
    width: 240,
    height: 240,
  },
  outOfReachTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: typography.extrabold,
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  outOfReachText: {
    fontSize: 17,
    lineHeight: 25,
    fontFamily: typography.semibold,
    color: '#334155',
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: 10,
  },
  outOfReachHint: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: typography.medium,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 30,
  },
  outOfReachChecking: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.semibold,
    color: '#475569',
    textAlign: 'center',
  },
  outOfReachButton: {
    minHeight: cargoTheme.cta.minHeight,
    minWidth: 220,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
    borderRadius: cargoTheme.cta.borderRadius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cargoTheme.cta.backgroundColor,
  },
  outOfReachButtonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
  mapPane: {
    flex: 1,
    minHeight: 180,
  },
  mapStage: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapCalloutLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  mapUnavailableCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#F8FAFC',
  },
  mapUnavailableTitle: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  mapUnavailableText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: typography.body,
    color: '#334155',
    textAlign: 'center',
  },
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
  },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.98)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  scheduleBannerChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  scheduleBannerChipText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  searchStack: {
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 7,
  },
  searchCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 10,
  },
  searchCardJoined: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  searchFieldShell: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#F8FAFC',
  },
  searchFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    gap: 10,
  },
  searchFieldHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E2E8F0',
    marginLeft: 22,
  },
  pickupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16A34A',
  },
  dropoffSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#111827',
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeInput: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    paddingVertical: 0,
    minHeight: 22,
  },
  routeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchResultsCard: {
    maxHeight: 280,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    paddingBottom: 6,
  },
  suggestionScroll: {
    maxHeight: 220,
  },
  noticeWrap: {
    marginHorizontal: 14,
    marginBottom: 8,
  },
  searchResultsSectionLabel: {
    marginLeft: 14,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.bold,
    color: '#6B7280',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  savedPlacesRow: {
    gap: 8,
    paddingLeft: 14,
    paddingRight: 14,
    paddingBottom: 8,
  },
  savedPlaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#FFF6B0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  savedPlaceChipText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  locationChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  locationChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  locationChipText: {
    flex: 1,
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  recenterFab: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
  },
  vehicleSheet: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 16,
  },
  vehicleSheetVerify: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  verifyPillWrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  vehicleSheetInner: {
    flex: 1,
  },
  vehicleSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginBottom: 10,
  },
  sheetFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
  },
  sheetFact: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  sheetFactRule: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#E5E7EB',
  },
  sheetFactLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: typography.semibold,
    color: '#6B7280',
    textAlign: 'center',
  },
  sheetFactValue: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  sheetTimingSummary: {
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#374151',
    textAlign: 'center',
  },
  tollNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#FFFBEA',
    borderWidth: 1,
    borderColor: '#F3E7A1',
  },
  tollMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tollCopy: {
    flex: 1,
  },
  tollTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: typography.bold,
    color: '#111827',
  },
  tollHint: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#6B7280',
  },
  routeSummaryStack: {
    gap: 8,
  },
  routeSummaryBar: {
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  routeSummaryText: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.bold,
    color: '#111827',
  },
  routeFactRow: {
    flexDirection: 'row',
    gap: 8,
  },
  routeFactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#111827',
  },
  routeFactKicker: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#FDE68A',
  },
  routeFactValue: {
    fontSize: 13,
    fontFamily: typography.extrabold,
    color: '#FFFFFF',
  },
  vehicleSheetTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  vehicleSheetSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
    marginBottom: 8,
  },
  vehicleListScroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  vehicleSheetFooter: {
    flexShrink: 0,
    marginTop: 'auto',
    paddingTop: 4,
  },
  vehicleList: {
    paddingBottom: 4,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  vehicleRowActive: {
    borderColor: '#111827',
    backgroundColor: '#FFFBEA',
  },
  vehicleAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  vehicleAvatar: {
    width: 52,
    height: 52,
  },
  vehicleCopy: {
    flex: 1,
    minWidth: 0,
  },
  vehicleRowTitle: {
    fontSize: 16,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.3,
  },
  vehicleRowMeta: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  vehicleRowPrice: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.3,
    textAlign: 'right',
    maxWidth: 118,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    marginTop: 2,
    marginBottom: 8,
  },
  paymentRowLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.ink,
  },
  travelWithDriverBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: cargoTheme.colors.ink,
    backgroundColor: cargoTheme.colors.primary,
  },
  travelWithDriverCopy: {
    flex: 1,
    gap: 4,
  },
  travelWithDriverTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.2,
  },
  travelWithDriverText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.ink,
  },
  offerInputBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  offerStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 12,
  },
  offerStepButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerStepButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  offerStepButtonText: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 32,
    fontFamily: typography.extrabold,
    marginTop: -2,
  },
  offerAmountWrap: {
    flex: 1,
    alignItems: 'center',
  },
  offerCurrency: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  offerInput: {
    width: '100%',
    minHeight: 52,
    fontSize: 40,
    lineHeight: 46,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -1,
    paddingVertical: 0,
    textAlign: 'center',
  },
  offerUnderline: {
    height: 2,
    backgroundColor: '#E5E7EB',
    marginTop: 10,
    marginBottom: 16,
  },
  offerLooking: {
    marginTop: 18,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  offerDriverCard: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  offerDriverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFE500',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerDriverCopy: {
    flex: 1,
  },
  offerDriverName: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
  },
  offerDriverVehicle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  offerDriverFare: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.ink,
  },
  driverPriceCard: {
    backgroundColor: '#FFE500',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginBottom: 22,
  },
  driverPriceCurrency: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#111827',
    letterSpacing: 1.2,
  },
  driverPriceAmount: {
    marginTop: 2,
    fontSize: 44,
    lineHeight: 50,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -1.2,
  },
  driverPriceNote: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: typography.semibold,
    color: '#111827',
    textAlign: 'center',
  },
  chanceLine: {
    marginTop: -8,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#111827',
    textAlign: 'center',
  },
  offerNoteLabel: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: '#6B7280',
  },
  offerNoteChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  offerNoteChip: {
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offerNoteChipActive: {
    backgroundColor: '#FFE500',
  },
  offerNoteChipText: {
    fontFamily: typography.semibold,
    color: '#6B7280',
    fontSize: 13,
  },
  offerNoteChipTextActive: {
    color: '#111827',
  },
  offerPhone: {
    marginTop: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingVertical: 10,
    fontFamily: typography.semibold,
    fontSize: 16,
    color: '#111827',
  },
  offerCallRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  offerCallNumber: {
    fontFamily: typography.semibold,
    fontSize: 16,
    color: '#111827',
  },
  offerCallAction: {
    fontFamily: typography.bold,
    fontSize: 15,
    color: '#111827',
  },
  offerNoteInput: {
    marginTop: 6,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
    paddingVertical: 8,
  },
  driverPriceMeta: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#111827',
  },
  yourFareLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: cargoTheme.colors.subtext,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
  },
  offerSuggested: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: cargoTheme.colors.subtext,
    marginBottom: 16,
    textAlign: 'center',
  },
  formError: {
    fontSize: 12,
    lineHeight: 18,
    color: '#B91C1C',
    marginBottom: 8,
  },
  ctaButton: {
    width: '100%',
    minHeight: 54,
    flexShrink: 0,
  },
  offerSecondaryButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: cargoTheme.cta.borderRadius,
    borderWidth: 1.5,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  offerSecondaryButtonText: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.bold,
  },
  primaryButton: {
    minHeight: cargoTheme.cta.minHeight,
    backgroundColor: '#111827',
    borderRadius: cargoTheme.cta.borderRadius,
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});
