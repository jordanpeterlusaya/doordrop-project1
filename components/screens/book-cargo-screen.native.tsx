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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
  { key: 'small', label: 'Kidogo', subtitle: 'Mzigo mdogo unaochukua nafasi ndogo.' },
  { key: 'half', label: 'Nusu chombo', subtitle: 'Mzigo unachukua karibu nusu nafasi.' },
  { key: 'full', label: 'Inajaa', subtitle: 'Mzigo unajaza nafasi ya chombo.' },
  { key: 'overload', label: 'Inazidi', subtitle: 'Mzigo ni mkubwa au mzito zaidi.' },
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function getCustomerFacingCargoError(error: unknown, fallback: string) {
  const message = getErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('expo_public') ||
    normalized.includes('api_base_url') ||
    normalized.includes('backend') ||
    normalized.includes('apk') ||
    normalized.includes('cleartext') ||
    normalized.includes('network request failed') ||
    normalized.includes('private/local')
  ) {
    return 'Location service is unavailable right now. Please try again shortly.';
  }

  return message;
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
const vehicleSheetMaxHeight = Math.min(screenHeight * 0.72, 540);

export default function BookCargoScreen() {
  const router = useRouter();
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
  const pickupInputRef = useRef<TextInput | null>(null);
  const dropoffInputRef = useRef<TextInput | null>(null);
  const liveCarrierAnimatedCoordinatesRef = useRef<Record<string, any>>({});
  const liveCarrierCoordinateSnapshotRef = useRef<Record<string, RoutePoint>>({});
  const defaultVehicleKey = cargoVehicles[0]?.key ?? 'toyo';

  // State
  const [pickupPoint, setPickupPoint] = useState<RoutePoint | null>(null);
  const [pickupLabel, setPickupLabel] = useState('Detecting your current location...');
  const [pickupInput, setPickupInput] = useState('Detecting your current location...');
  const [pickupState, setPickupState] = useState<PickupState>('loading');
  const [pickupHint, setPickupHint] = useState('Checking your current GPS pickup point...');
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([]);
  const [pickupNeedsSelection, setPickupNeedsSelection] = useState(false);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const [dropoffInput, setDropoffInput] = useState('');
  const [dropoffPoint, setDropoffPoint] = useState<RoutePoint | null>(null);
  const [dropoffLabel, setDropoffLabel] = useState('');
  const [mapSelectionTarget, setMapSelectionTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [destinationState, setDestinationState] = useState<DestinationState>('idle');
  const [destinationHint, setDestinationHint] = useState('Enter the drop-off location to see place suggestions and pricing.');
  const [routeMetrics, setRouteMetrics] = useState<RouteMetrics | null>(null);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [routeError, setRouteError] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState(defaultVehicleKey);
  const [selectedCargoType, setSelectedCargoType] = useState<CargoLoadType>('small');
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

  const mapTopEdgePadding = routeEditorExpanded ? 236 : 96;
  const mapBottomEdgePadding = routeEditorExpanded
    ? 84
    : Math.max(180, Math.min(vehicleSheetMaxHeight - 100, 236));
  const mapSideEdgePadding = routeEditorExpanded ? 56 : 44;

  const fitMapToPoints = useCallback((points: RoutePoint[]) => {
    const validPoints = filterValidCoordinates(points);

    if (!validPoints.length) {
      return;
    }

    if (validPoints.length === 1) {
      focusMapOnPoint(validPoints[0], 600);
      return;
    }

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
    } catch {}
  }, [focusMapOnPoint, mapBottomEdgePadding, mapSideEdgePadding, mapTopEdgePadding]);

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
    setRouteError('');
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
      setRouteError('');
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
        setRouteError('');
        setDestinationHint(nextHint);
        setRouteEditorExpanded(false);
        setActiveSearchField('dropoff');
        setCargoSheetStep('cargo-details');
        dropoffSessionTokenRef.current = createSearchSessionToken();
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

        const fitPoints = nextRoute.coordinates.length >= 2 ? nextRoute.coordinates : [pickupPoint, dropoff];
        fitMapToPoints(fitPoints);
      } catch (err) {
        if (lookupId !== dropoffLookupIdRef.current) return;
        const message = getCustomerFacingCargoError(
          err,
          'We could not place that drop-off yet. Try a different area, street, or landmark.'
        );
        logAsyncFailure(screenScope, 'resolveAndRouteDropoff', err, {
          manual,
          query,
          suggestionId: suggestion?.id,
          message,
        });
        setDropoffPoint(null);
        setRouteEstimate(null);
        setRouteMetrics(null);
        setVehicleEstimates({});
        setVehiclePricingLoading(false);
        setShouldFetchSuggestions(true);
        if (manual) {
          setDestinationState('error');
          setRouteError(message);
          setDestinationHint('Search for a landmark, street, or area');
        } else {
          setDestinationState('idle');
          setRouteError(message);
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
    [dropoffInput, fitMapToPoints, pickupNeedsSelection, pickupPoint, selectedCargoType, selectedVehicle, trackCargoActivity]
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
          setRouteError('');
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
          const message = getCustomerFacingCargoError(
            error,
            'Could not load destination suggestions. Please try again.'
          );
          setDropoffSuggestions([]);
          setLoadingSuggestions(false);
          setDestinationState('error');
          setRouteError(message);
          setDestinationHint(message);
          logAsyncFailure(screenScope, 'loadDropoffSuggestions', error, {
            query: dropoffInput,
            message,
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
          setRouteError('');
          setPickupHint(
            suggestions.length > 0
              ? 'Choose the exact pickup suggestion to refresh the route.'
              : 'No pickup matches yet. Try a more specific area, street, or landmark.'
          );
        }
      } catch (error) {
        if (lookupId === pickupSuggestionLookupIdRef.current) {
          const message = getCustomerFacingCargoError(
            error,
            'Could not load pickup suggestions. Please try again.'
          );
          setPickupSuggestions([]);
          setLoadingPickupSuggestions(false);
          setPickupHint(message);
          setRouteError(message);
          logAsyncFailure(screenScope, 'loadPickupSuggestions', error, {
            query: pickupInput,
            message,
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
      setRouteError('');
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
      const message = getCustomerFacingCargoError(
        error,
        'Choose one of the pickup suggestions or refine the text.'
      );
      logAsyncFailure(screenScope, 'handleSelectPickupSuggestion', error, {
        suggestionId: suggestion.id,
        placeId: suggestion.placeId,
        message,
      });
      setRouteError(message);
      Alert.alert('Pickup not found', message);
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
  const activeSearchError = activeSearchField === 'pickup' ? '' : routeError;
  const locationChipsTitle = activeSearchField === 'pickup' ? 'Saved pickup places' : 'Quick destinations';
  const shouldShowSuggestionCard =
    routeEditorExpanded &&
    (activeSearchSuggestions.length > 0 ||
      activeSearchLoading ||
      savedPlaces.length > 0 ||
      Boolean(activeSearchError) ||
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

  const fallbackActiveVehicleEstimate = useMemo(() => {
    if (!routeMetrics) {
      return null;
    }

    return buildFrontendPricingEstimates(
      routeMetrics.distanceMeters,
      [selectedVehicle],
      selectedCargoType as RouteEstimateCargoSize
    )[selectedVehicle];
  }, [routeMetrics, selectedCargoType, selectedVehicle]);
  const activeVehiclePrice = vehicleQuotes[selectedVehicle] || fallbackActiveVehicleEstimate?.estimatedPrice || 0;
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
    if (routePoints.length >= 2) {
      fitMapToPoints(routePoints);
      return;
    }

    if (pickupPoint) {
      focusMapOnPoint(pickupPoint, 500);
    }
  }, [fitMapToPoints, focusMapOnPoint, pickupPoint, routePoints]);

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
    focusMapOnPoint(point, 500);

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
              title="Pickup"
              description={pickupLabel}
              pinColor={cargoTheme.colors.primaryDark}
            />
          ) : null}
          {validDropoffPoint ? (
            <Marker
              coordinate={validDropoffPoint}
              title="Drop-off"
              description={dropoffLabel || dropoffInput}
              pinColor="#2563EB"
            />
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
          {routePoints.length >= 2 ? (
            <Polyline
              coordinates={routePoints}
              strokeColor={routeMetrics?.source === 'fallback' ? '#60A5FA' : cargoTheme.colors.primaryDark}
              strokeWidth={5}
            />
          ) : null}
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

      {showVehicleSheet ? (
        <View pointerEvents="none" style={[styles.mapInfoCard, routeEditorExpanded && styles.mapInfoCardRaised]}>
          <Text style={styles.mapInfoEyebrow}>
            {routeEstimate?.polyline
              ? 'Live polyline route'
              : routeMetrics?.source === 'fallback'
                ? 'Estimated route preview'
                : 'Live route preview'}
          </Text>
          <Text style={styles.mapInfoTitle}>
            {routeMetrics ? 'Route ready' : 'Set pickup and drop-off'}
          </Text>
          <Text style={styles.mapInfoText}>
            {`${activeVehicleTitle} selected. Review the final fare on the next page.`}
          </Text>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.topOverlay}>
        <View style={styles.chromeRow}>
          <TouchableOpacity style={styles.chromeButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={cargoTheme.colors.text} />
          </TouchableOpacity>
          <View style={styles.titleChip}>
            <Text style={styles.titleChipText}>
              {showVehicleSheet ? (showCarrierStep ? 'Choose carrier' : 'Cargo details') : 'Book cargo carrier'}
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
                  <Text style={styles.searchCardTitle}>Pickup and destination</Text>
                  <Text style={styles.searchCardSubtitle}>Keep the map visible while you search.</Text>
                </View>
                {showVehicleSheet ? (
                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={styles.searchCollapseButton}
                    onPress={() => setRouteEditorExpanded(false)}>
                    <MaterialCommunityIcons name="chevron-up" size={18} color={cargoTheme.colors.text} />
                    <Text style={styles.searchCollapseButtonText}>Hide</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.searchFieldShell}>
                <View style={styles.searchFieldRow}>
                  <View style={[styles.routeIconWrap, styles.pickupIconWrap]}>
                    <View style={styles.pickupDot} />
                  </View>
                  <View style={styles.routeCopy}>
                    <Text style={styles.routeLabel}>Pickup</Text>
                    <TextInput
                      ref={pickupInputRef}
                      value={pickupInput}
                      onChangeText={handlePickupChange}
                      onFocus={() => reopenRouteEditor('pickup')}
                      placeholder="Start typing pickup location"
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

                <View style={styles.searchFieldDivider} />

                <View style={styles.searchFieldRow}>
                  <View style={[styles.routeIconWrap, styles.dropoffIconWrap]}>
                    <MaterialCommunityIcons name="flag-checkered" size={18} color="#2563EB" />
                  </View>
                  <View style={styles.routeCopy}>
                    <Text style={styles.routeLabel}>Drop-off</Text>
                    <TextInput
                      ref={dropoffInputRef}
                      value={dropoffInput}
                      onChangeText={resetDropoffSelection}
                      onFocus={() => reopenRouteEditor('dropoff')}
                      placeholder="Enter delivery destination"
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

              <View style={styles.mapModeRow}>
                {[
                  { key: 'pickup', label: 'Place pickup pin' },
                  { key: 'dropoff', label: 'Place destination pin' },
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
                {activeSearchError ? (
                  <View style={styles.errorBanner}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#B91C1C" />
                    <Text style={styles.errorBannerText}>{activeSearchError}</Text>
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

                <Text style={[styles.routeHint, activeSearchError && styles.routeHintError]}>{activeSearchHint}</Text>
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
              <Text style={styles.vehicleSheetSubtitle}>
                Chagua ukubwa wa mzigo kabla ya kuchagua usafiri.
              </Text>

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
                  label="Endelea kuchagua usafiri"
                  icon="arrow-right"
                  onPress={handleCargoDetailsContinue}
                  style={styles.ctaButton}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.vehicleSheetTitle}>Choose cargo carrier</Text>
              <Text style={styles.vehicleSheetSubtitle}>
                {`Select the carrier type. Fare and route summary appear on the next page.`}
              </Text>

              <View style={styles.vehicleStepHeaderRow}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  style={styles.editCargoDetailsButton}
                  onPress={() => setCargoSheetStep('cargo-details')}>
                  <MaterialCommunityIcons name="pencil-outline" size={15} color={cargoTheme.colors.primaryDark} />
                  <Text style={styles.editCargoDetailsButtonText}>Edit details</Text>
                </TouchableOpacity>
                <Text numberOfLines={1} style={styles.vehicleStepSummary}>
                  {`Ukubwa: ${activeCargoSizeLabel}`}
                </Text>
              </View>

              {nearbyCarrierSummary ? (
                <View style={styles.liveCarrierBanner}>
                  <MaterialCommunityIcons name="map-marker-multiple-outline" size={16} color={cargoTheme.colors.primaryDark} />
                  <Text style={styles.liveCarrierBannerText}>{nearbyCarrierSummary}</Text>
                </View>
              ) : null}

              <View style={styles.vehicleGrid}>
                {cargoVehicles.map((vehicle) => {
                  const isActive = vehicle.key === selectedVehicle;
                  return (
                    <TouchableOpacity
                      key={vehicle.key}
                      activeOpacity={0.9}
                      style={[styles.vehicleGridCard, isActive && styles.vehicleGridCardActive]}
                      onPress={() => handleVehicleSelect(vehicle.key)}>
                      <View style={styles.vehicleGridImageWrap}>
                        <Image source={vehicleImages[vehicle.key]} style={styles.vehicleGridImage} resizeMode="contain" />
                      </View>
                      <Text numberOfLines={1} style={styles.vehicleGridTitle}>{vehicle.title}</Text>
                      <Text numberOfLines={2} style={styles.vehicleGridMeta}>{vehicle.capacity}</Text>
                      <View style={[styles.vehicleSelectBadge, styles.vehicleGridBadge, isActive && styles.vehicleSelectBadgeActive]}>
                        {isActive ? <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" /> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.vehicleActionBar}>
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <PrimaryButton
                  label="Continue"
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
    fontWeight: '800',
    color: cargoTheme.colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  mapUnavailableText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    textAlign: 'center',
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
    fontWeight: '800',
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
  mapInfoCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: vehicleSheetMaxHeight + 18,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.94)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  mapInfoCardRaised: {
    bottom: vehicleSheetMaxHeight + 96,
  },
  mapInfoEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: cargoTheme.colors.primaryDark,
    marginBottom: 6,
  },
  mapInfoTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: cargoTheme.colors.ink,
    marginBottom: 6,
  },
  mapInfoText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
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
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  titleChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.94)',
  },
  titleChipText: {
    fontSize: 15,
    fontWeight: '800',
    color: cargoTheme.colors.ink,
  },
  searchCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  searchCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  searchCardTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  searchCardSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginTop: 2,
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
    fontWeight: '800',
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
    minHeight: 62,
  },
  searchFieldDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginLeft: 54,
    marginVertical: 2,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  pickupIconWrap: {
    backgroundColor: '#ECFDF3',
  },
  pickupDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: cargoTheme.colors.primary,
  },
  dropoffIconWrap: {
    backgroundColor: '#EFF6FF',
  },
  routeCopy: {
    flex: 1,
  },
  routeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
    marginBottom: 4,
  },
  routeValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: cargoTheme.colors.text,
  },
  routeInput: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: cargoTheme.colors.text,
    paddingVertical: 0,
    minHeight: 24,
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 10,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#B91C1C',
    fontWeight: '600',
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
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 17,
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
    fontWeight: '800',
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
    fontWeight: '700',
    color: cargoTheme.colors.text,
  },
  routeHint: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
    marginTop: 12,
  },
  routeHintError: {
    color: '#B91C1C',
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
    fontWeight: '800',
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
    fontWeight: '800',
    color: cargoTheme.colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  collapsedRouteTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  collapsedRouteMeta: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginTop: 4,
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
    fontSize: 18,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  vehicleSheetSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: cargoTheme.colors.subtext,
    marginTop: 4,
    marginBottom: 10,
  },
  liveCarrierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    backgroundColor: '#ECFDF3',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  liveCarrierBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.primaryDark,
    fontWeight: '700',
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
    fontSize: 12,
    fontWeight: '800',
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
    gap: 8,
  },
  cargoSizeCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  cargoSizeCardActive: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  cargoSizeTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    color: cargoTheme.colors.text,
    marginBottom: 5,
  },
  cargoSizeTitleActive: {
    color: '#FFFFFF',
  },
  cargoSizeSubtitle: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
  },
  cargoSizeSubtitleActive: {
    color: '#DCFCE7',
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
    fontSize: 11,
    fontWeight: '900',
    color: cargoTheme.colors.primaryDark,
  },
  vehicleStepSummary: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
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
    flexGrow: 0,
  },
  vehicleListContent: {
    gap: 10,
    paddingBottom: 6,
  },
  vehicleGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  vehicleGridCard: {
    flex: 1,
    minHeight: 168,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    position: 'relative',
  },
  vehicleGridCardActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#F0FDF4',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  vehicleGridImageWrap: {
    width: '100%',
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  vehicleGridImage: {
    width: '82%',
    height: '82%',
  },
  vehicleGridTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  vehicleGridPrice: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '900',
    color: cargoTheme.colors.primaryDark,
    textAlign: 'center',
  },
  vehicleGridMeta: {
    marginTop: 5,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: cargoTheme.colors.subtext,
    textAlign: 'center',
  },
  vehicleGridEta: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '900',
    color: cargoTheme.colors.text,
    textAlign: 'center',
  },
  vehicleGridBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
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
    fontWeight: '700',
  },
});
