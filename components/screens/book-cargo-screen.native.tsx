// app/book-cargo.tsx
// Complete crash-proof cargo booking screen with all dependencies handled safely

import { buildFrontendPricingEstimates } from '@/lib/cargo-pricing';
import { images } from '@/lib/images';
import { lightMapStyle } from '@/lib/light-map-style';
import { recordAppActivity } from '@/lib/app-analytics';
import { recordCargoDiagnostic } from '@/lib/cargo-diagnostics';
import {
  createSearchSessionToken,
  fetchLocationSuggestions,
  fetchRouteEstimate,
  resolveTypedLocation,
  retrieveLocationSuggestion,
  type LocationSuggestion,
  type PricingEstimate,
  type RouteEstimate,
  type RouteEstimateCargoSize,
  type RouteEstimateVehicleType,
  type RetrievedLocation,
} from '@/lib/location-search';
import { runMapsDiagnostics } from '@/lib/maps-diagnostics';
import { canRenderNativeGoogleMap, hasGoogleMapsBuildConfig } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { filterValidCoordinates, isValidCoordinate } from '@/lib/route-utils';
import { getSavedPlaces as getStoredSavedPlaces, type SavedPlace } from '@/lib/saved-places';
import { subscribeToDrivers, type DriverRecord, type DriverVehicleType } from '@/lib/delivery-data';
import {
  logAsyncFailure,
  logAsyncStart,
  logAsyncSuccess,
  logInfo,
  logWarning,
} from '@/lib/debug-logger';
import { tryRequire } from '@/lib/safety';
import { useAuthSession } from '@/providers/auth-provider';
import { useAppCopy } from '@/lib/app-copy';
import { classifyLocationError, type CustomerNoticeKind } from '@/lib/network-status';
import { MapStopPin } from '@/components/map-markers';
import { ServiceNotice } from '@/components/service-notice';
import { typography } from '@/constants/typography';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

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
type RouteSource = 'google' | 'fallback';
type CargoSheetStep = 'cargo-details' | 'carrier';

type RouteMetrics = {
  coordinates: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
  source: RouteSource;
};

type CargoVehicle = {
  key: RouteEstimateVehicleType;
  title: string;
  capacity: string;
  price: string;
  eta: string;
};

type CargoSizeOption = {
  key: CargoLoadType;
  label: string;
  subtitle: string;
};

type LiveCarrierMarker = {
  id: string;
  coordinate: RoutePoint;
  title: string;
  description: string;
  iconName: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  mappedVehicleKey: RouteEstimateVehicleType;
  isSelectedType: boolean;
  nearestDistanceMeters: number;
};

// Theme constants (fallback)
const cargoTheme = {
  colors: {
    primary: '#10B981',
    primaryDark: '#059669',
    text: '#1E293B',
    subtext: '#64748B',
    ink: '#0F172A',
  },
};

// Default vehicles
const cargoVehicles: CargoVehicle[] = [
  { key: 'toyo', title: 'TOYO', capacity: 'Up to 1 ton', price: 'Route required', eta: '14-24 min' },
  { key: 'kirikuu', title: 'Kirikuu', capacity: 'Up to 1 ton', price: 'Route required', eta: '10-18 min' },
];

const cargoLoadOptions: CargoSizeOption[] = [
  { key: 'small', label: 'Kidogo', subtitle: 'Nafasi ndogo' },
  { key: 'half', label: 'Nusu', subtitle: 'Karibu nusu' },
  { key: 'full', label: 'Inajaa', subtitle: 'Nafasi imejaa' },
  { key: 'overload', label: 'Inazidi', subtitle: 'Mzigo mkubwa' },
];

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

const vehicleEtaBufferMinutes: Record<string, number> = {
  toyo: 10,
  kirikuu: 6,
};
const LIVE_CARRIER_RADIUS_METERS = 12000;
const LIVE_CARRIER_MAX_VISIBLE_COUNT = 8;
const LIVE_CARRIER_MARKER_ANIMATION_DURATION_MS = 900;

// Vehicle images from our safe import
const vehicleImages: Record<string, any> = {
  toyo: images.toyoMedium,
  kirikuu: images.kirikuu,
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

function formatDurationFromMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(1, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours === 0) return `${safeMinutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
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

function areSameRoutePoint(left?: RoutePoint | null, right?: RoutePoint | null) {
  if (!left || !right) {
    return false;
  }

  return Math.abs(left.latitude - right.latitude) < 0.000001 && Math.abs(left.longitude - right.longitude) < 0.000001;
}

function buildRouteCameraRegion(pickup: RoutePoint, dropoff: RoutePoint, sheetVisible: boolean) {
  const minLat = Math.min(pickup.latitude, dropoff.latitude);
  const maxLat = Math.max(pickup.latitude, dropoff.latitude);
  const minLng = Math.min(pickup.longitude, dropoff.longitude);
  const maxLng = Math.max(pickup.longitude, dropoff.longitude);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01);
  const latitudeDelta = latSpan * (sheetVisible ? 2.4 : 1.85);
  const longitudeDelta = lngSpan * 1.9;
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;

  return {
    latitude: sheetVisible ? midLat - latitudeDelta * 0.22 : midLat,
    longitude: midLng,
    latitudeDelta,
    longitudeDelta,
  };
}

function mapEstimateToRouteMetrics(estimate: RouteEstimate): RouteMetrics {
  return {
    coordinates: estimate.coordinates.length ? estimate.coordinates : [],
    distanceMeters: estimate.distanceMeters,
    durationSeconds: estimate.durationSeconds,
    source: 'google',
  };
}

function buildVehicleEtaRange(durationSeconds: number, vehicleKey: string): string {
  const minimumTravelMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const bufferMinutes = vehicleEtaBufferMinutes[vehicleKey] ?? 8;
  const maximumEtaMinutes = minimumTravelMinutes + bufferMinutes;
  return `${formatDurationFromMinutes(minimumTravelMinutes)}-${formatDurationFromMinutes(maximumEtaMinutes)}`;
}

function buildFallbackRoute(pickupPoint: RoutePoint, dropoffPoint: RoutePoint): RouteMetrics {
  const distanceMeters = Math.max(getDistanceBetweenPoints(pickupPoint, dropoffPoint), 500);
  const averageSpeedKph = distanceMeters > 30000 ? 52 : 28;
  const durationSeconds = Math.max(Math.round(((distanceMeters / 1000) / averageSpeedKph) * 3600), 6 * 60);
  return {
    coordinates: [pickupPoint, dropoffPoint],
    distanceMeters,
    durationSeconds,
    source: 'fallback',
  };
}

function mapDriverVehicleTypeToCarrier(vehicleType?: DriverVehicleType): RouteEstimateVehicleType | null {
  switch (vehicleType) {
    case 'kirikuu':
      return 'kirikuu';
    case 'toyo':
    case 'pickup':
    case 'toyo_xl':
    case 'van':
    case 'truck':
      return 'toyo';
    default:
      return null;
  }
}

function getDriverMarkerIcon(vehicleType?: DriverVehicleType): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (vehicleType) {
    case 'kirikuu':
      return 'truck-fast-outline';
    case 'toyo':
    case 'pickup':
    case 'toyo_xl':
    case 'van':
    case 'truck':
      return 'truck-outline';
    default:
      return 'truck-fast-outline';
  }
}

function formatLocationLabel(
  address: any,
  point: RoutePoint | null,
  fallbackText?: string
): string {
  if (address) {
    const parts = [address.name, address.street, address.district, address.city, address.region].filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length > 0) return unique.slice(0, 3).join(', ');
  }
  if (fallbackText?.trim()) return fallbackText.trim();
  if (point) return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
  return 'Detecting your current location...';
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
const ROUTE_LINE_FILL = '#16A34A';
const ROUTE_LINE_FALLBACK = '#34D399';

function MapRouteLine({
  Polyline,
  coordinates,
  fallback = false,
}: {
  Polyline: any;
  coordinates: RoutePoint[];
  fallback?: boolean;
}) {
  if (!Polyline || coordinates.length < 2) {
    return null;
  }

  return (
    <>
      <Polyline
        coordinates={coordinates}
        strokeColor="rgba(15, 23, 42, 0.20)"
        strokeWidth={12}
        lineCap="round"
        lineJoin="round"
        zIndex={1}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor="#FFFFFF"
        strokeWidth={8}
        lineCap="round"
        lineJoin="round"
        zIndex={2}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor={fallback ? ROUTE_LINE_FALLBACK : ROUTE_LINE_FILL}
        strokeWidth={5}
        lineCap="round"
        lineJoin="round"
        zIndex={3}
      />
    </>
  );
}

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
const vehicleSheetMaxHeight = Math.min(screenHeight * 0.78, 580);

export default function BookCargoScreen() {
  const router = useRouter();
  const copy = useAppCopy();
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
  }>();
  const isRepeat = params.repeat === '1';
  const repeatPickupLat = Number(params.pickupLat);
  const repeatPickupLng = Number(params.pickupLng);
  const hasRepeatPickup =
    isRepeat && Number.isFinite(repeatPickupLat) && Number.isFinite(repeatPickupLng) && Boolean(params.pickup?.trim());
  const repeatDropoffLat = Number(params.dropoffLat);
  const repeatDropoffLng = Number(params.dropoffLng);
  const hasRepeatDropoff =
    isRepeat && Number.isFinite(repeatDropoffLat) && Number.isFinite(repeatDropoffLng) && Boolean(params.dropoff?.trim());
  const { profile, user } = useAuthSession();
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
  const liveCarrierAnimatedCoordinatesRef = useRef<Record<string, any>>({});
  const liveCarrierCoordinateSnapshotRef = useRef<Record<string, RoutePoint>>({});
  const defaultVehicleKey = cargoVehicles[0]?.key ?? 'toyo';

  // State
  const [pickupPoint, setPickupPoint] = useState<RoutePoint | null>(
    hasRepeatPickup ? { latitude: repeatPickupLat, longitude: repeatPickupLng } : null
  );
  const [pickupLabel, setPickupLabel] = useState(
    hasRepeatPickup ? String(params.pickup) : 'Detecting your current location...'
  );
  const [pickupInput, setPickupInput] = useState(
    hasRepeatPickup ? String(params.pickup) : 'Detecting your current location...'
  );
  const [pickupState, setPickupState] = useState<PickupState>(hasRepeatPickup ? 'ready' : 'loading');
  const [pickupHint, setPickupHint] = useState('Checking your current GPS pickup point...');
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
  const [selectedVehicle, setSelectedVehicle] = useState(
    params.vehicle === 'toyo' || params.vehicle === 'kirikuu' ? params.vehicle : defaultVehicleKey
  );
  const [selectedCargoType, setSelectedCargoType] = useState<CargoLoadType>(
    cargoLoadOptions.find((option) => option.label === params.cargoSize)?.key ?? 'small'
  );
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
  const [cargoSheetStep, setCargoSheetStep] = useState<CargoSheetStep>('cargo-details');
  const [, setLiveCarrierAnimationVersion] = useState(0);

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

  const mapTopEdgePadding = routeEditorExpanded ? 236 : 130;
  const mapBottomEdgePadding = routeEditorExpanded
    ? 100
    : Math.round(vehicleSheetMaxHeight + 28);
  const mapSideEdgePadding = 52;

  const fitMapToPoints = useCallback((points: RoutePoint[]) => {
    const validPoints = filterValidCoordinates(points);

    if (!validPoints.length) {
      return;
    }

    if (validPoints.length === 1) {
      focusMapOnPoint(validPoints[0], 600);
      return;
    }

    const pickup = validPoints[0];
    const dropoff = validPoints[validPoints.length - 1];
    const region = buildRouteCameraRegion(pickup, dropoff, !routeEditorExpanded);

    try {
      mapRef.current?.animateToRegion(region, 700);
      mapRef.current?.fitToCoordinates([pickup, dropoff], {
        edgePadding: {
          top: mapTopEdgePadding,
          right: mapSideEdgePadding,
          bottom: mapBottomEdgePadding,
          left: mapSideEdgePadding,
        },
        animated: true,
      });
    } catch {}
  }, [focusMapOnPoint, mapBottomEdgePadding, mapSideEdgePadding, mapTopEdgePadding, routeEditorExpanded]);

  const fitMapToPickupAndDropoff = useCallback(
    (pickup?: RoutePoint | null, dropoff?: RoutePoint | null, delay = 380) => {
      if (!isValidCoordinate(pickup) || !isValidCoordinate(dropoff)) {
        return;
      }

      if (fitCameraTimeoutRef.current) {
        clearTimeout(fitCameraTimeoutRef.current);
      }

      fitCameraTimeoutRef.current = setTimeout(() => {
        fitMapToPoints([pickup, dropoff]);
      }, delay);
    },
    [fitMapToPoints]
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
    const unsubscribe = subscribeToDrivers(
      (drivers) => {
        setLiveDrivers(drivers);
      },
      (error) => {
        logWarning(screenScope, 'live drivers subscription failed', {
          message: error.message,
        });
      }
    );

    return unsubscribe;
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

  // Load a safe preview pickup first, then upgrade to live GPS when permission is available.
  useEffect(() => {
    let isMounted = true;
    const loadPickup = async () => {
      logAsyncStart(screenScope, 'loadPickup');
      recordCargoDiagnostic('book-cargo-native:pickup:load-start');
      try {
        if (!isMounted) return;
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
        const fallbackLabel = 'Dar es Salaam pickup preview';
        setPickupPoint(defaultPickupPoint);
        setPickupLabel(fallbackLabel);
        setPickupInput(fallbackLabel);
        setPickupState('ready');
        setPickupNeedsSelection(false);
        setPickupHint('Pickup ready. Tap GPS if you want to refresh your current location.');
        recordCargoDiagnostic('book-cargo-native:pickup:load-success', {
          latitude: defaultPickupPoint.latitude,
          longitude: defaultPickupPoint.longitude,
          source: 'default-preview',
        });
        trackCargoActivity('pickup_ready', 'cargo_pickup', {
          source: 'default_preview',
          hasGps: false,
        });
        logAsyncSuccess(screenScope, 'loadPickup', {
          point: defaultPickupPoint,
          source: 'default-preview',
        });

        if (!Location) {
          return;
        }

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isMounted) return;

        setHasLocationPermission(status === 'granted');
        if (status !== 'granted') {
          setPickupHint('Pickup preview loaded. Tap GPS anytime if you later enable location access.');
          trackCargoActivity('location_permission_denied', 'cargo_pickup', {
            source: 'initial_load',
          });
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted) return;

        const livePoint: RoutePoint = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        };
        const reverse = await Location.reverseGeocodeAsync(livePoint);
        if (!isMounted) return;

        const liveLabel = formatLocationLabel(reverse[0] ?? null, livePoint, 'Current location');
        setPickupPoint(livePoint);
        setPickupLabel(liveLabel);
        setPickupInput(liveLabel);
        setPickupState('ready');
        setPickupNeedsSelection(false);
        setPickupHint('Pickup updated to your live GPS location.');
        trackCargoActivity('pickup_ready', 'cargo_pickup', {
          source: 'gps',
          hasGps: true,
        });
        focusMapOnPoint(livePoint, 700);
      } catch (err) {
        if (!isMounted) return;
        logAsyncFailure(screenScope, 'loadPickup', err);
        recordCargoDiagnostic('book-cargo-native:pickup:load-failure');
        const fallbackLabel = 'Dar es Salaam pickup preview';
        setPickupState('error');
        setPickupLabel(fallbackLabel);
        setPickupInput(fallbackLabel);
        setPickupNeedsSelection(false);
        setPickupHint('Enter drop-off location to continue.');
        trackCargoActivity('pickup_failed', 'cargo_pickup', {
          source: 'initial_load',
        });
      }
    };
    loadPickup();
    return () => {
      isMounted = false;
    };
  }, [Location, focusMapOnPoint, trackCargoActivity]);

  const clearRouteState = useCallback(() => {
    dropoffLookupIdRef.current += 1;
    setRouteEstimate(null);
    setRouteMetrics(null);
    setRouteNotice(null);
    setVehicleEstimates({});
    setVehiclePricingLoading(false);
    setCargoSheetStep('cargo-details');
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
        let nextHint = 'Route ready. Select cargo size and vehicle.';
        try {
          setVehiclePricingLoading(true);
          const nextRouteEstimate = await fetchRouteEstimate(pickupPoint, dropoff, {
            vehicleType: selectedVehicle,
            cargoSize: selectedCargoType as RouteEstimateCargoSize,
          });
          const nextPricingEstimates: Partial<Record<RouteEstimateVehicleType, PricingEstimate>> = buildFrontendPricingEstimates(
            nextRouteEstimate.distanceMeters,
            cargoVehicles.map((vehicle) => vehicle.key),
            selectedCargoType as RouteEstimateCargoSize
          );
          const selectedVehiclePricing = nextRouteEstimate.pricingEstimate;
          if (selectedVehiclePricing) {
            nextPricingEstimates[selectedVehicle] = selectedVehiclePricing;
          }
          trackCargoActivity('cargo_pricing_ready', 'cargo_pricing', {
            source: 'route_api',
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
          nextRoute = buildFallbackRoute(pickupPoint, dropoff);
          nextVehicleEstimates = buildFrontendPricingEstimates(
            nextRoute.distanceMeters,
            cargoVehicles.map((vehicle) => vehicle.key),
            selectedCargoType as RouteEstimateCargoSize
          );
          nextHint = 'Live route lookup failed. Showing approximate distance and duration from the selected points.';
          trackCargoActivity('cargo_pricing_fallback', 'cargo_pricing', {
            distanceMeters: Math.round(nextRoute.distanceMeters),
            durationSeconds: Math.round(nextRoute.durationSeconds),
            vehicleType: selectedVehicle,
            cargoSize: selectedCargoType,
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
        setCargoSheetStep('cargo-details');
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
    [dropoffInput, fitMapToPickupAndDropoff, pickupNeedsSelection, pickupPoint, selectedCargoType, selectedVehicle, trackCargoActivity]
  );

  const pricingDistanceMeters = routeEstimate?.distanceMeters ?? routeMetrics?.distanceMeters;

  useEffect(() => {
    if (!pricingDistanceMeters) {
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
          selectedCargoType as RouteEstimateCargoSize
        );

        if (routeEstimate?.pricingEstimate?.cargoSize === selectedCargoType) {
          nextVehicleEstimates[selectedVehicle] = routeEstimate.pricingEstimate;
        }

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
    }, 350);
    return () => clearTimeout(timer);
  }, [dropoffInput, pickupPoint, shouldFetchSuggestions]);

  useEffect(() => {
    if (!pickupNeedsSelection || pickupInput.trim().length < 3) {
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      return;
    }

    const lookupId = ++pickupSuggestionLookupIdRef.current;
    setLoadingPickupSuggestions(true);

    const timer = setTimeout(async () => {
      try {
        const suggestions = await fetchLocationSuggestions(
          pickupInput,
          pickupSessionTokenRef.current,
          dropoffPoint ?? undefined
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
    }, 350);

    return () => clearTimeout(timer);
  }, [dropoffPoint, pickupInput, pickupNeedsSelection]);

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

  // Handle continue navigation
  const handleContinue = useCallback(() => {
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
    const activeEstimate =
      vehicleEstimates[selectedVehicle] ??
      buildFrontendPricingEstimates(
        routeMetrics.distanceMeters,
        [selectedVehicle],
        selectedCargoType as RouteEstimateCargoSize
      )[selectedVehicle];
    const priceValue = activeEstimate?.estimatedPrice ?? 0;
    const etaString = buildVehicleEtaRange(routeMetrics.durationSeconds, selectedVehicle);
    const cargoLabel = cargoLoadOptions.find(o => o.key === selectedCargoType)?.label ?? 'Half';
    const vehicleTitle = cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title ?? 'Carrier';
    const distanceLabel = formatDistance(routeMetrics.distanceMeters);
    const dropoffDisplay = dropoffLabel || dropoffInput;

    try {
      logAsyncStart(screenScope, 'navigateToOrderReview', {
        vehicle: selectedVehicle,
        cargoType: selectedCargoType,
      });
      trackCargoActivity('checkout_started', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        vehicleLabel: vehicleTitle,
        cargoSize: selectedCargoType,
        distanceMeters: Math.round(routeMetrics.distanceMeters),
        durationSeconds: Math.round(routeMetrics.durationSeconds),
        estimatedPrice: priceValue,
      });
      router.push({
        pathname: '/order-review',
        params: {
          flow: 'cargo',
          vehicle: selectedVehicle,
          timing: 'now',
          pickup: pickupLabel,
          pickupLat: String(pickupPoint.latitude),
          pickupLng: String(pickupPoint.longitude),
          dropoff: dropoffDisplay,
          dropoffLat: String(dropoffPoint.latitude),
          dropoffLng: String(dropoffPoint.longitude),
          distance: distanceLabel,
          duration: etaString,
          distanceMeters: String(Math.round(routeMetrics.distanceMeters)),
          durationSeconds: String(Math.round(routeMetrics.durationSeconds)),
          cargoSize: cargoLabel,
          price: formatTzs(priceValue || 0),
        },
      });
      logAsyncSuccess(screenScope, 'navigateToOrderReview', {
        vehicle: selectedVehicle,
        cargoType: selectedCargoType,
      });
    } catch (navErr) {
      Alert.alert('Navigation Error', 'Could not proceed to review. Please try again.');
      logAsyncFailure(screenScope, 'navigateToOrderReview', navErr);
      trackCargoActivity('checkout_failed', 'cargo_checkout', {
        vehicleType: selectedVehicle,
        cargoSize: selectedCargoType,
      });
    }
  }, [dropoffInput, dropoffLabel, dropoffPoint, pickupLabel, pickupNeedsSelection, pickupPoint, routeMetrics, router, selectedCargoType, selectedVehicle, trackCargoActivity, vehicleEstimates]);

  const handleEditRoute = useCallback(() => {
    focusDropoffField();
  }, [focusDropoffField]);

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
      const reverse = await Location.reverseGeocodeAsync(point);
      const nextLabel = formatLocationLabel(reverse[0] ?? null, point);
      setPickupLabel(nextLabel);
      setPickupInput(nextLabel);
      setPickupState('ready');
      setPickupHint('Pickup refreshed.');
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
  const showVehicleSheet = !!pickupPoint && !!dropoffPoint && !!routeMetrics;
  const showCargoDetailsStep = showVehicleSheet && cargoSheetStep === 'cargo-details';
  const showCarrierStep = showVehicleSheet && cargoSheetStep === 'carrier';
  const showCollapsedRouteChip = showVehicleSheet && !routeEditorExpanded;
  const activeSearchSuggestions = activeSearchField === 'pickup' ? pickupSuggestions : dropoffSuggestions;
  const activeSearchLoading = activeSearchField === 'pickup' ? loadingPickupSuggestions : loadingSuggestions;
  const activeSearchHint =
    activeSearchField === 'pickup'
      ? pickupNeedsSelection
        ? 'Choose the exact pickup point from suggestions or use GPS.'
        : pickupHint
      : destinationHint;
  const activeSearchNotice = routeNotice && routeNotice !== 'offline' ? routeNotice : null;
  const locationChipsTitle = activeSearchField === 'pickup' ? 'Saved pickup places' : 'Quick destinations';
  const shouldShowSuggestionCard =
    routeEditorExpanded &&
    (activeSearchSuggestions.length > 0 ||
      activeSearchLoading ||
      savedPlaces.length > 0 ||
      Boolean(activeSearchNotice) ||
      (activeSearchField === 'pickup' ? pickupNeedsSelection : Boolean(dropoffInput.trim())));
  const routePoints = useMemo(() => {
    if (routeMetrics?.coordinates.length) {
      return filterValidCoordinates(routeMetrics.coordinates);
    }

    return filterValidCoordinates([pickupPoint, dropoffPoint]);
  }, [routeMetrics, pickupPoint, dropoffPoint]);
  const validPickupPoint = isValidCoordinate(pickupPoint) ? pickupPoint : null;
  const validDropoffPoint = isValidCoordinate(dropoffPoint) ? dropoffPoint : null;
  const nearbyCarrierMarkers = useMemo<LiveCarrierMarker[]>(() => {
    if (!validPickupPoint) {
      return [];
    }

    return liveDrivers
      .filter((driver) => driver.isAvailable)
      .map((driver) => {
        const coordinate = {
          latitude: driver.currentLatitude ?? Number.NaN,
          longitude: driver.currentLongitude ?? Number.NaN,
        };

        if (!isValidCoordinate(coordinate)) {
          return null;
        }

        const nearestDistanceMeters = getDistanceBetweenPoints(validPickupPoint, coordinate);

        if (nearestDistanceMeters > LIVE_CARRIER_RADIUS_METERS) {
          return null;
        }

        const mappedVehicleKey = mapDriverVehicleTypeToCarrier(driver.vehicleType);
        if (!mappedVehicleKey) {
          return null;
        }

        return {
          id: driver.id,
          coordinate,
          title: driver.fullName || driver.vehicleLabel || 'DoorDrop carrier',
          description: `${driver.vehicleLabel || 'DoorDrop carrier'} • ${formatDistance(nearestDistanceMeters)} away`,
          iconName: getDriverMarkerIcon(driver.vehicleType),
          mappedVehicleKey,
          isSelectedType: mappedVehicleKey === selectedVehicle,
          nearestDistanceMeters,
        };
      })
      .filter((driver): driver is LiveCarrierMarker => Boolean(driver))
      .sort((left, right) => {
        if (left.isSelectedType !== right.isSelectedType) {
          return left.isSelectedType ? -1 : 1;
        }

        return left.nearestDistanceMeters - right.nearestDistanceMeters;
      })
      .slice(0, LIVE_CARRIER_MAX_VISIBLE_COUNT);
  }, [liveDrivers, selectedVehicle, validPickupPoint]);
  const nearbyCarrierSummary = useMemo(() => {
    if (!pickupPoint && !dropoffPoint) {
      return '';
    }

    if (!liveDrivers.length) {
      return 'Waiting for live carrier locations from DoorDrive.';
    }

    if (!nearbyCarrierMarkers.length) {
      return 'No nearby carriers visible on the map yet.';
    }

    const matchingCarrierCount = nearbyCarrierMarkers.filter((driver) => driver.isSelectedType).length;
    if (matchingCarrierCount > 0) {
      const selectedVehicleTitle =
        cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title.toLowerCase() ?? 'selected';
      return `${matchingCarrierCount} ${selectedVehicleTitle} carrier${matchingCarrierCount === 1 ? '' : 's'} within ${(LIVE_CARRIER_RADIUS_METERS / 1000).toFixed(0)} km of pickup visible on the map.`;
    }

    return `${nearbyCarrierMarkers.length} nearby carrier${nearbyCarrierMarkers.length === 1 ? '' : 's'} within ${(LIVE_CARRIER_RADIUS_METERS / 1000).toFixed(0)} km of pickup visible on the map.`;
  }, [dropoffPoint, liveDrivers.length, nearbyCarrierMarkers, pickupPoint, selectedVehicle]);
  useEffect(() => {
    if (!AnimatedRegion) {
      liveCarrierAnimatedCoordinatesRef.current = {};
      liveCarrierCoordinateSnapshotRef.current = {};
      return;
    }

    let hasStructuralChange = false;
    const visibleIds = new Set(nearbyCarrierMarkers.map((driver) => driver.id));

    Object.keys(liveCarrierAnimatedCoordinatesRef.current).forEach((driverId) => {
      if (visibleIds.has(driverId)) {
        return;
      }

      delete liveCarrierAnimatedCoordinatesRef.current[driverId];
      delete liveCarrierCoordinateSnapshotRef.current[driverId];
      hasStructuralChange = true;
    });

    nearbyCarrierMarkers.forEach((driver) => {
      const existingCoordinate = liveCarrierAnimatedCoordinatesRef.current[driver.id];
      const previousCoordinate = liveCarrierCoordinateSnapshotRef.current[driver.id];

      if (!existingCoordinate) {
        liveCarrierAnimatedCoordinatesRef.current[driver.id] = new AnimatedRegion({
          latitude: driver.coordinate.latitude,
          longitude: driver.coordinate.longitude,
          latitudeDelta: 0,
          longitudeDelta: 0,
        });
        liveCarrierCoordinateSnapshotRef.current[driver.id] = driver.coordinate;
        hasStructuralChange = true;
        return;
      }

      if (areSameRoutePoint(previousCoordinate, driver.coordinate)) {
        return;
      }

      existingCoordinate
        .timing({
          latitude: driver.coordinate.latitude,
          longitude: driver.coordinate.longitude,
          latitudeDelta: 0,
          longitudeDelta: 0,
          duration: LIVE_CARRIER_MARKER_ANIMATION_DURATION_MS,
          toValue: 0,
          useNativeDriver: false,
        })
        .start();
      liveCarrierCoordinateSnapshotRef.current[driver.id] = driver.coordinate;
    });

    if (hasStructuralChange) {
      setLiveCarrierAnimationVersion((value) => value + 1);
    }
  }, [AnimatedRegion, nearbyCarrierMarkers]);

  // Compute quotes for vehicles
  const vehicleQuotes = useMemo(() => {
    const quotes: Record<string, number> = {};
    for (const vehicle of cargoVehicles) {
      quotes[vehicle.key] = vehicleEstimates[vehicle.key]?.estimatedPrice ?? 0;
    }
    return quotes;
  }, [vehicleEstimates]);

  const fallbackVehicleQuotes = useMemo(() => {
    if (!routeMetrics) {
      return {} as Record<string, number>;
    }

    const estimates = buildFrontendPricingEstimates(
      routeMetrics.distanceMeters,
      cargoVehicles.map((vehicle) => vehicle.key),
      selectedCargoType as RouteEstimateCargoSize
    );

    return Object.fromEntries(
      cargoVehicles.map((vehicle) => [vehicle.key, estimates[vehicle.key]?.estimatedPrice ?? 0])
    ) as Record<string, number>;
  }, [routeMetrics, selectedCargoType]);
  const displayVehicleQuotes = useMemo(() => {
    const quotes: Record<string, number> = {};
    for (const vehicle of cargoVehicles) {
      quotes[vehicle.key] = vehicleQuotes[vehicle.key] || fallbackVehicleQuotes[vehicle.key] || 0;
    }
    return quotes;
  }, [fallbackVehicleQuotes, vehicleQuotes]);
  const activeVehiclePrice = displayVehicleQuotes[selectedVehicle] || 0;
  const activeVehicleTitle = cargoVehicles.find((vehicle) => vehicle.key === selectedVehicle)?.title ?? 'Carrier';
  const activeCargoSizeLabel = cargoLoadOptions.find((option) => option.key === selectedCargoType)?.label ?? 'Small';

  const handleCargoSizeSelect = useCallback((cargoType: CargoLoadType) => {
    setSelectedCargoType(cargoType);
    trackCargoActivity('cargo_size_selected', 'cargo_size', {
      cargoSize: cargoType,
      vehicleType: selectedVehicle,
      hasRoute: Boolean(routeMetrics),
      distanceMeters: routeMetrics ? Math.round(routeMetrics.distanceMeters) : undefined,
    });
  }, [routeMetrics, selectedVehicle, trackCargoActivity]);

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
      matchingCarrierCount: nearbyCarrierMarkers.filter((driver) => driver.mappedVehicleKey === vehicleKey).length,
    });
  }, [nearbyCarrierMarkers, routeMetrics, selectedCargoType, trackCargoActivity, vehicleQuotes]);

  const handleCargoDetailsContinue = useCallback(() => {
    setFormError('');
    setCargoSheetStep('carrier');
    trackCargoActivity('cargo_details_confirmed', 'cargo_handling', {
      cargoSize: selectedCargoType,
      distanceMeters: routeMetrics ? Math.round(routeMetrics.distanceMeters) : undefined,
    });
  }, [routeMetrics, selectedCargoType, trackCargoActivity]);

  useEffect(() => {
    if (pickupPoint && dropoffPoint) {
      fitMapToPickupAndDropoff(pickupPoint, dropoffPoint, 420);
      return;
    }

    if (pickupPoint) {
      focusMapOnPoint(pickupPoint, 500);
    }
  }, [dropoffPoint, fitMapToPickupAndDropoff, focusMapOnPoint, pickupPoint]);

  const handleMapPress = useCallback(async (event: any) => {
    const point: RoutePoint | undefined = event?.nativeEvent?.coordinate;
    if (!isValidCoordinate(point)) {
      return;
    }

    const coordinateLabel = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
    let resolvedLabel = coordinateLabel;

    if (Location?.reverseGeocodeAsync) {
      try {
        const reverse = await Location.reverseGeocodeAsync(point);
        const address = reverse?.[0];
        const parts = address
          ? [address.name, address.street, address.district, address.city, address.region].filter(Boolean)
          : [];

        if (parts.length) {
          resolvedLabel = [...new Set(parts)].slice(0, 3).join(', ');
        }
      } catch {}
    }

    if (mapSelectionTarget === 'pickup') {
      reopenRouteEditor('dropoff');
      setPickupPoint(point);
      setPickupLabel(resolvedLabel);
      setPickupInput(resolvedLabel);
      setPickupState('ready');
      setPickupHint('Pickup pin placed on the map. Set the drop-off to redraw pricing.');
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
  }, [Location, clearRouteState, focusDropoffField, focusMapOnPoint, mapSelectionTarget, reopenRouteEditor, resolveAndRouteDropoff]);

  // ============================================
  // RENDER
  // ============================================

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Real Google Map */}
      {mapCanRender && NativeMapView && Marker && Polyline ? (
        <NativeMapView
          ref={mapRef}
          provider={mapProvider}
          style={styles.map}
          customMapStyle={lightMapStyle}
          showsUserLocation={hasLocationPermission}
          showsMyLocationButton={hasLocationPermission}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          initialRegion={{
            latitude: validPickupPoint?.latitude ?? defaultPickupPoint.latitude,
            longitude: validPickupPoint?.longitude ?? defaultPickupPoint.longitude,
            latitudeDelta: 0.045,
            longitudeDelta: 0.04,
          }}
          onPress={handleMapPress}>
          {validPickupPoint ? (
            <Marker
              coordinate={validPickupPoint}
              title={copy.cargo.pickup}
              description={pickupLabel}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              zIndex={8}
            >
              <MapStopPin kind="pickup" label={copy.cargo.pickup} />
            </Marker>
          ) : null}
          {validDropoffPoint ? (
            <Marker
              coordinate={validDropoffPoint}
              title={copy.cargo.dropoff}
              description={dropoffLabel || dropoffInput}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              zIndex={9}
            >
              <MapStopPin kind="dropoff" label={copy.cargo.dropoff} />
            </Marker>
          ) : null}
          {nearbyCarrierMarkers.map((driver) => {
            const markerImage = vehicleImages[driver.mappedVehicleKey];
            const animatedCoordinate = liveCarrierAnimatedCoordinatesRef.current[driver.id];
            const markerChild = (
              <View
                collapsable={false}
                style={[
                  styles.liveCarrierMarkerShell,
                  driver.isSelectedType ? styles.liveCarrierMarkerShellActive : styles.liveCarrierMarkerShellMuted,
                ]}
              >
                {driver.isSelectedType ? (
                  <View style={styles.liveCarrierMarkerLabel}>
                    <Text style={styles.liveCarrierMarkerLabelText}>
                      {cargoVehicles.find((vehicle) => vehicle.key === driver.mappedVehicleKey)?.title ?? 'Selected'}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.liveCarrierMarkerCard,
                    driver.isSelectedType ? styles.liveCarrierMarkerCardActive : styles.liveCarrierMarkerCardMuted,
                  ]}
                >
                  {driver.isSelectedType ? <View style={styles.liveCarrierMarkerHalo} /> : null}
                  {markerImage ? (
                    <Image
                      source={markerImage}
                      resizeMode="contain"
                      fadeDuration={0}
                      style={[
                        styles.liveCarrierMarkerImage,
                        driver.isSelectedType
                          ? styles.liveCarrierMarkerImageActive
                          : styles.liveCarrierMarkerImageMuted,
                      ]}
                    />
                  ) : (
                    <MaterialCommunityIcons name={driver.iconName} size={18} color={cargoTheme.colors.primaryDark} />
                  )}
                </View>
              </View>
            );

            if (animatedCoordinate && MarkerAnimated) {
              return (
                <MarkerAnimated
                  key={driver.id}
                  coordinate={animatedCoordinate as unknown as RoutePoint}
                  title={driver.title}
                  description={driver.description}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges
                >
                  {markerChild}
                </MarkerAnimated>
              );
            }

            return (
              <Marker
                key={driver.id}
                coordinate={driver.coordinate}
                title={driver.title}
                description={driver.description}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges
              >
                {markerChild}
              </Marker>
            );
          })}
          <MapRouteLine
            Polyline={Polyline}
            coordinates={routePoints}
            fallback={routeMetrics?.source === 'fallback'}
          />
        </NativeMapView>
      ) : (
        <View style={[styles.map, styles.mapUnavailableCard]}>
          <Text style={styles.mapUnavailableTitle}>Google Map not ready</Text>
          <Text style={styles.mapUnavailableText}>
            Add `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to the Expo app config so the real Google map renders in the APK.
          </Text>
        </View>
      )}

      <View pointerEvents="none" style={styles.mapShade} />

      <View pointerEvents="box-none" style={styles.topOverlay}>
        <View style={styles.chromeRow}>
          <TouchableOpacity style={styles.chromeButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
          <View style={styles.titleChip}>
            <Text style={styles.titleChipText}>
              {showVehicleSheet ? (showCarrierStep ? copy.cargo.carrier : copy.cargo.details) : copy.cargo.book}
            </Text>
          </View>
          <TouchableOpacity style={styles.chromeButton} onPress={() => router.push('/menu')}>
            <MaterialCommunityIcons name="menu" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
        </View>

        {routeEditorExpanded ? (
          <>
            <View style={styles.searchCard}>
              <View style={styles.searchCardHeader}>
                <View>
                  <Text style={styles.searchCardTitle}>{copy.cargo.route}</Text>
                </View>
                {showVehicleSheet ? (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={styles.searchCollapseButton}
                    onPress={() => setRouteEditorExpanded(false)}>
                    <MaterialCommunityIcons name="chevron-up" size={18} color={cargoTheme.colors.text} />
                    <Text style={styles.searchCollapseButtonText}>{copy.cargo.hide}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.searchFieldShell}>
                <View style={styles.routeTimeline}>
                  <View style={styles.routeSpineCol}>
                    <View style={styles.pickupDot} />
                    <View style={styles.routeSpine}>
                      <View style={styles.routeSpineFill} />
                    </View>
                    <View style={styles.dropoffSquare} />
                  </View>
                  <View style={styles.routeFields}>
                    <View style={styles.searchFieldRow}>
                      <View style={styles.routeCopy}>
                        <Text style={styles.routeLabel}>{copy.cargo.pickup}</Text>
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
                      <View style={styles.routeCopy}>
                        <Text style={styles.routeLabel}>{copy.cargo.dropoff}</Text>
                        <TextInput
                          ref={dropoffInputRef}
                          value={dropoffInput}
                          onChangeText={resetDropoffSelection}
                          onFocus={() => reopenRouteEditor('dropoff')}
                          placeholder={copy.parcel.dropoffPlaceholder}
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
              </View>

              <View style={styles.mapModeRow}>
                    {[
                      { key: 'pickup', label: 'Pickup pin' },
                      { key: 'dropoff', label: 'Drop-off pin' },
                    ].map((item) => {
                  const isActive = mapSelectionTarget === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.88}
                      style={[styles.mapModeChip, isActive && styles.mapModeChipActive]}
                      onPress={() => setMapSelectionTarget(item.key as 'pickup' | 'dropoff')}>
                      <Text style={[styles.mapModeChipText, isActive && styles.mapModeChipTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {shouldShowSuggestionCard ? (
              <View style={styles.searchResultsCard}>
                {activeSearchNotice ? (
                  <View style={styles.noticeWrap}>
                    <ServiceNotice kind={activeSearchNotice} />
                  </View>
                ) : null}

                {activeSearchLoading ? (
                  <View style={styles.resultsLoadingRow}>
                    <ActivityIndicator size="small" color={cargoTheme.colors.primaryDark} />
                    <Text style={styles.resultsLoadingText}>
                      {activeSearchField === 'pickup' ? 'Loading pickup suggestions...' : 'Loading destination suggestions...'}
                    </Text>
                  </View>
                ) : null}

                {activeSearchSuggestions.length > 0 ? (
                  <View style={styles.suggestionListCompact}>
                    {activeSearchSuggestions.map((suggestion) => (
                      <TouchableOpacity
                        key={suggestion.id}
                        activeOpacity={0.88}
                        style={styles.suggestionRow}
                        onPress={() => {
                          if (activeSearchField === 'pickup') {
                            void handleSelectPickupSuggestion(suggestion);
                            return;
                          }

                          void resolveAndRouteDropoff({
                            query: suggestion.fullText,
                            suggestion,
                            manual: true,
                          });
                        }}>
                        <View
                          style={[
                            styles.suggestionIconWrap,
                            activeSearchField === 'dropoff' && styles.suggestionIconWrapBlue,
                          ]}>
                          <MaterialCommunityIcons
                            name={activeSearchField === 'pickup' ? 'crosshairs-gps' : 'map-marker-radius-outline'}
                            size={16}
                            color={activeSearchField === 'pickup' ? cargoTheme.colors.primaryDark : '#1D4ED8'}
                          />
                        </View>
                        <View style={styles.suggestionCopy}>
                          <Text style={styles.suggestionTitle}>{suggestion.name}</Text>
                          <Text numberOfLines={2} style={styles.suggestionText}>
                            {suggestion.address || suggestion.fullText}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : activeSearchField === 'dropoff' && dropoffInput.trim().length >= 3 && !activeSearchLoading ? (
                  <Text style={styles.emptySearchText}>
                    No places matched yet. Try a more specific street, landmark, or area.
                  </Text>
                ) : null}

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
                      <MaterialCommunityIcons
                        name={place.icon}
                        size={16}
                        color={activeSearchField === 'pickup' ? cargoTheme.colors.primaryDark : '#1D4ED8'}
                      />
                      <Text style={styles.savedPlaceChipText}>{place.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.routeHint}>{activeSearchHint}</Text>
              </View>
            ) : null}
          </>
        ) : showCollapsedRouteChip ? (
          <TouchableOpacity activeOpacity={0.9} style={styles.collapsedRouteChip} onPress={handleEditRoute}>
            <View style={styles.collapsedRouteCopy}>
              <Text style={styles.collapsedRouteEyebrow}>Edit route</Text>
              <Text style={styles.collapsedRouteTitle}>
                {formatCompactLocationLabel(pickupLabel, 'Pickup')} to{' '}
                {formatCompactLocationLabel(dropoffLabel || dropoffInput, 'Destination')}
              </Text>
              <Text style={styles.collapsedRouteMeta}>
                {`${activeVehicleTitle} • ${activeCargoSizeLabel}`}
              </Text>
            </View>
            <View style={styles.editRouteChipButton}>
              <MaterialCommunityIcons name="pencil-outline" size={18} color={cargoTheme.colors.text} />
            </View>
          </TouchableOpacity>
        ) : null}
      </View>

      {showVehicleSheet ? (
        <View style={styles.vehicleSheet}>
          <View style={styles.vehicleSheetHandle} />
          {showCargoDetailsStep ? (
            <>
              <Text style={styles.vehicleSheetTitle}>Maelezo ya mzigo</Text>
              <Text style={styles.vehicleSheetSubtitle}>Chagua ukubwa, kisha usafiri.</Text>

              <View style={styles.cargoTypeRowWrap}>
                <Text style={styles.cargoTypeRowLabel}>Ukubwa wa mzigo</Text>
                <View style={styles.cargoSizeGrid}>
                  {cargoLoadOptions.map((option) => {
                    const isActive = selectedCargoType === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        activeOpacity={0.9}
                        style={[styles.cargoSizeCard, isActive && styles.cargoSizeCardActive]}
                        onPress={() => handleCargoSizeSelect(option.key)}>
                        <Text style={[styles.cargoSizeTitle, isActive && styles.cargoSizeTitleActive]}>
                          {option.label}
                        </Text>
                        <Text numberOfLines={2} style={[styles.cargoSizeSubtitle, isActive && styles.cargoSizeSubtitleActive]}>
                          {option.subtitle}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.vehicleActionBar}>
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <PrimaryButton
                  label={copy.common.continue}
                  icon="arrow-right"
                  onPress={handleCargoDetailsContinue}
                  style={styles.ctaButton}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.vehicleSheetTitle}>Choose carrier</Text>
              <Text style={styles.vehicleSheetSubtitle}>Chagua TOYO au Kirikuu</Text>

              {nearbyCarrierSummary ? (
                <View style={styles.liveCarrierBanner}>
                  <MaterialCommunityIcons name="map-marker-multiple-outline" size={16} color={cargoTheme.colors.primaryDark} />
                  <Text style={styles.liveCarrierBannerText}>{nearbyCarrierSummary}</Text>
                </View>
              ) : null}

              <View style={styles.vehicleList}>
                {cargoVehicles.map((vehicle) => {
                  const isActive = vehicle.key === selectedVehicle;
                  const vehiclePrice = displayVehicleQuotes[vehicle.key] || 0;
                  return (
                    <TouchableOpacity
                      key={vehicle.key}
                      activeOpacity={0.9}
                      style={[styles.vehicleRow, isActive && styles.vehicleRowActive]}
                      onPress={() => handleVehicleSelect(vehicle.key)}>
                      <View style={styles.vehiclePhotoWrap}>
                        <Image source={vehicleImages[vehicle.key]} style={styles.vehiclePhoto} resizeMode="contain" />
                      </View>
                      <View style={styles.vehicleCopy}>
                        <Text numberOfLines={1} style={styles.vehicleRowTitle}>{vehicle.title}</Text>
                        <Text numberOfLines={1} style={styles.vehicleRowMeta}>{vehicle.capacity}</Text>
                      </View>
                      <View style={styles.vehiclePriceCol}>
                        <Text style={styles.vehicleRowPrice}>{vehiclePrice ? formatTzs(vehiclePrice) : '—'}</Text>
                        {isActive ? (
                          <View style={styles.vehicleRowCheck}>
                            <MaterialCommunityIcons name="check" size={12} color="#FFFFFF" />
                          </View>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.vehicleActionBar}>
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <PrimaryButton
                  label={activeVehiclePrice ? `${copy.common.continue} · ${formatTzs(activeVehiclePrice)}` : copy.common.continue}
                  icon="arrow-right"
                  onPress={handleContinue}
                  style={styles.ctaButton}
                  disabled={!activeVehiclePrice}
                />
              </View>
            </>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// ============================================
// STYLES (unchanged)
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
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
  mapPickupPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  mapPickupPinCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ROUTE_LINE_FILL,
  },
  mapDropoffPin: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  mapDropoffPinCore: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: cargoTheme.colors.ink,
  },
  liveCarrierMarkerShell: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  liveCarrierMarkerShellActive: {
    opacity: 1,
    transform: [{ scale: 1.06 }],
  },
  liveCarrierMarkerShellMuted: {
    opacity: 0.62,
    transform: [{ scale: 0.84 }],
  },
  liveCarrierMarkerLabel: {
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: cargoTheme.colors.primaryDark,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  liveCarrierMarkerLabelText: {
    fontSize: 10,
    fontFamily: typography.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  liveCarrierMarkerCard: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  liveCarrierMarkerCardActive: {
    borderColor: cargoTheme.colors.primaryDark,
  },
  liveCarrierMarkerCardMuted: {
    borderColor: 'rgba(226, 232, 240, 0.96)',
  },
  liveCarrierMarkerHalo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  liveCarrierMarkerImage: {
    width: 34,
    height: 34,
  },
  liveCarrierMarkerImageActive: {
    width: 36,
    height: 36,
  },
  liveCarrierMarkerImageMuted: {
    width: 28,
    height: 28,
  },
  mapShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  topOverlay: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
  },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  chromeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  titleChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  titleChipText: {
    fontSize: 14,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.2,
  },
  searchCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 22,
    padding: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 7,
  },
  searchCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  searchCardTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.2,
  },
  searchCollapseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchCollapseButtonText: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  searchFieldShell: {
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E8EEF4',
  },
  searchFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
  },
  searchFieldHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  routeTimeline: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  routeSpineCol: {
    width: 18,
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
    marginRight: 12,
  },
  routeSpine: {
    flex: 1,
    width: 2,
    marginVertical: 6,
    alignItems: 'center',
  },
  routeSpineFill: {
    flex: 1,
    width: 2,
    borderRadius: 999,
    backgroundColor: '#86EFAC',
  },
  routeFields: {
    flex: 1,
    minWidth: 0,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ROUTE_LINE_FILL,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dropoffSquare: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: cargoTheme.colors.ink,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  routeCopy: {
    flex: 1,
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
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  routeInput: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    paddingVertical: 0,
    minHeight: 22,
  },
  routeInlineHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  routeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 12,
  },
  suggestionList: {
    marginTop: 10,
    marginLeft: 54,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    gap: 8,
  },
  searchResultsCard: {
    marginTop: 10,
    maxHeight: 310,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.86)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 7,
  },
  noticeWrap: {
    marginBottom: 10,
  },
  resultsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  resultsLoadingText: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  suggestionListCompact: {
    gap: 10,
    marginBottom: 12,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  suggestionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  suggestionIconWrapBlue: {
    backgroundColor: '#EFF6FF',
  },
  suggestionCopy: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginTop: 2,
  },
  emptySearchText: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginBottom: 12,
  },
  searchResultsSectionLabel: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  savedPlacesRow: {
    gap: 10,
    paddingBottom: 2,
    flexDirection: 'row',
  },
  savedPlaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FAFC',
  },
  savedPlaceChipText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
  },
  routeHint: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
    marginTop: 12,
  },
  mapModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  mapModeChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  mapModeChipActive: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  mapModeChipText: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  mapModeChipTextActive: {
    color: '#FFFFFF',
  },
  collapsedRouteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.92)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 7,
  },
  collapsedRouteCopy: {
    flex: 1,
  },
  collapsedRouteEyebrow: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  collapsedRouteTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.2,
  },
  collapsedRouteMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginTop: 2,
  },
  editRouteChipButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  vehicleSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    maxHeight: vehicleSheetMaxHeight,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 20,
  },
  vehicleSheetHandle: {
    alignSelf: 'center',
    width: 52,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    marginBottom: 12,
  },
  vehicleSheetTitle: {
    fontSize: 20,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    letterSpacing: -0.4,
  },
  vehicleSheetSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
    marginTop: 4,
    marginBottom: 12,
  },
  liveCarrierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  liveCarrierBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  routeStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  routeStatCard: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  routeStatLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: cargoTheme.colors.subtext,
    marginBottom: 6,
  },
  routeStatValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  cargoTypeRowWrap: {
    marginBottom: 12,
  },
  cargoTypeRowLabel: {
    fontSize: 11,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cargoTypeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cargoSizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cargoSizeCard: {
    width: '47.5%',
    minHeight: 68,
    borderRadius: 16,
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  cargoSizeCardActive: {
    backgroundColor: '#0F172A',
  },
  cargoSizeTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  cargoSizeTitleActive: {
    color: '#FFFFFF',
  },
  cargoSizeSubtitle: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  cargoSizeSubtitleActive: {
    color: '#CBD5E1',
  },
  cargoTypeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  cargoTypeButtonActive: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  cargoTypeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
  },
  cargoTypeLabelActive: {
    color: '#FFFFFF',
  },
  vehicleStepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  editCargoDetailsButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  editCargoDetailsButtonText: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  vehicleStepSummary: {
    flex: 1,
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
    textAlign: 'right',
  },
  vehicleLoadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginBottom: 12,
  },
  vehicleLoadingText: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
    fontWeight: '700',
  },
  vehicleList: {
    gap: 10,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 108,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  vehicleRowActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#F0FDF4',
  },
  vehiclePhotoWrap: {
    width: 118,
    height: 88,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  vehiclePhoto: {
    width: '108%',
    height: '108%',
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
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: cargoTheme.colors.subtext,
  },
  vehiclePriceCol: {
    alignItems: 'flex-end',
    gap: 8,
    paddingRight: 2,
  },
  vehicleRowPrice: {
    fontSize: 14,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.ink,
    letterSpacing: -0.3,
  },
  vehicleRowCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cargoTheme.colors.primary,
  },
  vehicleOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  vehicleOptionCardActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#F0FDF4',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 4,
  },
  vehicleImageWrap: {
    width: 76,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
  },
  vehicleImage: {
    width: '82%',
    height: '82%',
  },
  vehicleOptionCopy: {
    flex: 1,
  },
  vehicleOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  vehicleTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  vehiclePrice: {
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
  },
  vehicleMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: cargoTheme.colors.subtext,
    marginTop: 4,
  },
  vehicleOptionMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  vehicleMetaPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  vehicleMetaPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: cargoTheme.colors.text,
  },
  vehicleSelectBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleSelectBadgeActive: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  vehicleActionBar: {
    alignItems: 'stretch',
    marginTop: 14,
  },
  formError: {
    fontSize: 12,
    lineHeight: 18,
    color: '#B91C1C',
    marginBottom: 8,
  },
  ctaButton: {
    width: '100%',
  },
  primaryButton: {
    backgroundColor: cargoTheme.colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: typography.extrabold,
    letterSpacing: -0.2,
  },
});
