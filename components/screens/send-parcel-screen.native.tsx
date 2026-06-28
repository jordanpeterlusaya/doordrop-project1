import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton, SectionHeader, SummaryRow } from '@/components/cargo-ui';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, parcelScopes, type ParcelScope } from '@/constants/cargo-theme';
import { buildFrontendPricingEstimate } from '@/lib/cargo-pricing';
import { lightMapStyle } from '@/lib/light-map-style';
import {
  createSearchSessionToken,
  fetchLocationSuggestions,
  fetchRouteEstimate,
  resolveTypedLocation,
  retrieveLocationSuggestion,
  type LocationSuggestion,
  type PricingEstimate,
  type RouteEstimate,
  type RouteEstimateVehicleType,
} from '@/lib/location-search';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { runMapsDiagnostics } from '@/lib/maps-diagnostics';
import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { filterValidCoordinates, formatDistance, formatDuration, isValidCoordinate } from '@/lib/route-utils';
import { getSavedPlaces, type SavedPlace } from '@/lib/saved-places';

const cityParcelTypes = [
  {
    key: 'document',
    title: 'Documents',
    subtitle: 'Contracts, IDs and paperwork for fast local delivery',
    icon: 'file-document-outline' as const,
  },
  {
    key: 'food',
    title: 'Food',
    subtitle: 'Meals, bakery items and takeaway orders',
    icon: 'silverware-fork-knife' as const,
  },
  {
    key: 'box',
    title: 'Small box',
    subtitle: 'Gifts, gadgets or daily essentials',
    icon: 'archive-outline' as const,
  },
  {
    key: 'fragile',
    title: 'Fragile item',
    subtitle: 'Handled carefully with added delivery notes',
    icon: 'glass-fragile' as const,
  },
] as const;

const outsideParcelTypes = [
  {
    key: 'luggage',
    title: 'Luggage',
    subtitle: 'Travel bags, suitcases and personal cargo',
    icon: 'bag-suitcase-outline' as const,
  },
  {
    key: 'box-bulk',
    title: 'Boxed goods',
    subtitle: 'Packed goods for regional or intercity delivery',
    icon: 'package-variant-closed' as const,
  },
  {
    key: 'electronics',
    title: 'Electronics',
    subtitle: 'Phones, devices and protected valuables',
    icon: 'laptop' as const,
  },
] as const;

type ParcelOption = (typeof cityParcelTypes)[number] | (typeof outsideParcelTypes)[number];
type GeoPoint = { latitude: number; longitude: number };
type OutsideDestinationStand = {
  id: string;
  label: string;
  query: string;
  fallbackPoint: GeoPoint;
};
type OutsideDestinationCity = {
  key: string;
  label: string;
  centerPoint: GeoPoint;
  stands: OutsideDestinationStand[];
};

type ParcelVehicleOption = {
  key: RouteEstimateVehicleType;
  title: string;
};

const defaultRegion = {
  latitude: -6.7924,
  longitude: 39.2083,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};
const screenScope = 'SendParcelScreen';

const outsideDestinationCities: OutsideDestinationCity[] = [
  {
    key: 'dar-es-salaam',
    label: 'Dar es Salaam',
    centerPoint: { latitude: -6.7924, longitude: 39.2083 },
    stands: [
      {
        id: 'ubungo',
        label: 'Ubungo Bus Terminal',
        query: 'Ubungo Bus Terminal, Dar es Salaam, Tanzania',
        fallbackPoint: { latitude: -6.7867, longitude: 39.2078 },
      },
      {
        id: 'magufuli',
        label: 'Magufuli Bus Terminal',
        query: 'Magufuli Bus Terminal, Dar es Salaam, Tanzania',
        fallbackPoint: { latitude: -6.8124, longitude: 39.1538 },
      },
    ],
  },
  {
    key: 'mwanza',
    label: 'Mwanza',
    centerPoint: { latitude: -2.5164, longitude: 32.9175 },
    stands: [
      {
        id: 'nyegezi',
        label: 'Nyegezi Bus Terminal',
        query: 'Nyegezi Bus Terminal, Mwanza, Tanzania',
        fallbackPoint: { latitude: -2.5732, longitude: 32.8709 },
      },
      {
        id: 'nyakato',
        label: 'Nyakato Bus Stand',
        query: 'Nyakato Bus Stand, Mwanza, Tanzania',
        fallbackPoint: { latitude: -2.5418, longitude: 32.9316 },
      },
    ],
  },
  {
    key: 'mtwara',
    label: 'Mtwara',
    centerPoint: { latitude: -10.2667, longitude: 40.1833 },
    stands: [
      {
        id: 'central',
        label: 'Mtwara Central Bus Stand',
        query: 'Mtwara Central Bus Stand, Mtwara, Tanzania',
        fallbackPoint: { latitude: -10.2706, longitude: 40.1822 },
      },
      {
        id: 'mikindani',
        label: 'Mikindani Bus Stand',
        query: 'Mikindani Bus Stand, Mtwara, Tanzania',
        fallbackPoint: { latitude: -10.2816, longitude: 40.1185 },
      },
    ],
  },
  {
    key: 'morogoro',
    label: 'Morogoro',
    centerPoint: { latitude: -6.8235, longitude: 37.6613 },
    stands: [
      {
        id: 'msamvu',
        label: 'Msamvu Bus Terminal',
        query: 'Msamvu Bus Terminal, Morogoro, Tanzania',
        fallbackPoint: { latitude: -6.8074, longitude: 37.6513 },
      },
      {
        id: 'town',
        label: 'Morogoro Main Bus Stand',
        query: 'Morogoro Main Bus Stand, Morogoro, Tanzania',
        fallbackPoint: { latitude: -6.8235, longitude: 37.6613 },
      },
    ],
  },
  {
    key: 'arusha',
    label: 'Arusha',
    centerPoint: { latitude: -3.3869, longitude: 36.683 },
    stands: [
      {
        id: 'central',
        label: 'Arusha Central Bus Terminal',
        query: 'Arusha Central Bus Terminal, Arusha, Tanzania',
        fallbackPoint: { latitude: -3.3733, longitude: 36.6842 },
      },
      {
        id: 'kilombero',
        label: 'Kilombero Bus Stand',
        query: 'Kilombero Bus Stand, Arusha, Tanzania',
        fallbackPoint: { latitude: -3.3817, longitude: 36.6924 },
      },
    ],
  },
] ;

const parcelVehicleOptions: ParcelVehicleOption[] = [
  {
    key: 'bodaboda',
    title: 'Bodaboda / Motorcycle',
  },
];

type OutsideDestinationCityKey = OutsideDestinationCity['key'];

function formatPickupLabel(address: Location.LocationGeocodedAddress | null, point: GeoPoint) {
  if (address) {
    const parts = [address.name, address.street, address.district, address.city].filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length > 0) {
      return unique.slice(0, 3).join(', ');
    }
  }

  return `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
}

function getDistanceBetweenPoints(start: GeoPoint, end: GeoPoint) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTzs(amount: number) {
  return `TZS ${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`;
}

function buildLocationDisplayLabel(name?: string, address?: string) {
  return [name, address].filter(Boolean).join(', ');
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

function getCustomerFacingLocationError(error: unknown, fallback: string) {
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

function getOutsideParcelFlatFare(destinationCityKey?: OutsideDestinationCityKey | null) {
  if (destinationCityKey === 'morogoro') {
    return 6000;
  }

  return 13000;
}

function buildFlatPricingEstimate(
  distanceMeters: number,
  vehicleType: RouteEstimateVehicleType,
  estimatedPrice: number
): PricingEstimate {
  const roundedPrice = Math.max(0, Math.round(estimatedPrice));

  return {
    vehicleType,
    distanceKm: Number((Math.max(0, distanceMeters) / 1000).toFixed(2)),
    estimatedPrice: roundedPrice,
    currency: 'TZS',
    pricing: {
      baseFare: roundedPrice,
      pricePerKm: 0,
      timeBufferPerKm: 0,
      minimumFare: roundedPrice,
      rawPrice: roundedPrice,
    },
  };
}

function buildFallbackRouteEstimate(origin: GeoPoint, destination: GeoPoint, distanceMultiplier = 1.25): RouteEstimate {
  const directDistanceMeters = getDistanceBetweenPoints(origin, destination);
  const distanceMeters = Math.max(1000, Math.round(directDistanceMeters * distanceMultiplier));
  const averageMetersPerSecond = 9.7;

  return {
    distanceMeters,
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    durationSeconds: Math.max(600, Math.round(distanceMeters / averageMetersPerSecond)),
    polyline: '',
    coordinates: [origin, destination],
    price: null,
    pricingEstimate: null,
  };
}

function getParcelVehicleType(scope: ParcelScope, parcelTypeKey: string): RouteEstimateVehicleType {
  return 'bodaboda';
}

function getParcelVehicleOption(vehicleType: RouteEstimateVehicleType) {
  return parcelVehicleOptions.find((option) => option.key === vehicleType) ?? parcelVehicleOptions[0];
}

function formatCityEtaRange(durationSeconds: number) {
  const minimumMinutes = Math.max(10, Math.ceil(durationSeconds / 60));
  const bufferMinutes = minimumMinutes <= 20 ? 10 : minimumMinutes <= 40 ? 15 : 20;
  return `${minimumMinutes}-${minimumMinutes + bufferMinutes} min`;
}

function formatIntercityEtaRange(durationSeconds: number) {
  const minimumHours = Math.max(2, durationSeconds / 3600);
  const low = Math.max(2, Math.floor(minimumHours));
  const high = Math.max(low + 1, Math.ceil(minimumHours + (minimumHours < 6 ? 1 : 2)));
  return `${low}-${high} hrs`;
}

function getNearestOutsideCity(point: GeoPoint): OutsideDestinationCity | undefined {
  return outsideDestinationCities.reduce((closest, city) => {
    const distance = getDistanceBetweenPoints(point, city.centerPoint);
    if (!closest || distance < closest.distance) {
      return { city, distance };
    }
    return closest;
  }, null as { city: OutsideDestinationCity; distance: number } | null)?.city;
}

function buildParcelPricing(params: {
  scope: ParcelScope;
  pickupPoint: GeoPoint;
  routeEstimate?: RouteEstimate | null;
  pricingEstimate?: PricingEstimate | null;
  pricingPending?: boolean;
  pricingError?: boolean;
  outsideDestinationCity?: OutsideDestinationCity | null;
  vehicleLabel: string;
}) {
  const { scope, pickupPoint, routeEstimate, pricingEstimate, pricingPending, pricingError, outsideDestinationCity, vehicleLabel } =
    params;

  if (scope === 'city') {
    if (pricingPending && (!routeEstimate || !pricingEstimate)) {
      return {
        priceLabel: 'Calculating...',
        etaLabel: 'Calculating...',
        routeLabel: 'Dar es Salaam local delivery',
      };
    }

    if (pricingError && (!routeEstimate || !pricingEstimate)) {
      return {
        priceLabel: 'Route unavailable',
        etaLabel: 'Route unavailable',
        routeLabel: 'Dar es Salaam local delivery',
      };
    }

    if (!routeEstimate || !pricingEstimate) {
      return {
        priceLabel: 'Enter destination',
        etaLabel: 'Waiting for route',
        routeLabel: `Dar es Salaam local delivery by ${vehicleLabel}`,
      };
    }

    return {
      priceLabel: formatTzs(pricingEstimate.estimatedPrice),
      etaLabel: formatCityEtaRange(routeEstimate.durationSeconds),
      routeLabel: `Dar es Salaam local delivery by ${vehicleLabel}`,
    };
  }

  const originCity = getNearestOutsideCity(pickupPoint) ?? outsideDestinationCities[0];
  const routeLabel = outsideDestinationCity ? `${originCity.label} to ${outsideDestinationCity.label}` : 'Intercity parcel delivery';

  if (pricingPending && (!routeEstimate || !pricingEstimate)) {
    return {
      priceLabel: 'Calculating...',
      etaLabel: 'Calculating...',
      routeLabel,
    };
  }

  if (pricingError && (!routeEstimate || !pricingEstimate)) {
    return {
      priceLabel: 'Route unavailable',
      etaLabel: 'Route unavailable',
      routeLabel,
    };
  }

  if (!outsideDestinationCity || !routeEstimate || !pricingEstimate) {
    return {
      priceLabel: 'Choose destination',
      etaLabel: 'Waiting for route',
      routeLabel,
    };
  }

  return {
    priceLabel: formatTzs(pricingEstimate.estimatedPrice),
    etaLabel: formatIntercityEtaRange(routeEstimate.durationSeconds),
    routeLabel: `${routeLabel} by ${vehicleLabel}`,
  };
}

export default function SendParcelScreen() {
  const router = useRouter();
  const mapRef = useRef<any>(null);
  const nativeMaps = useMemo(() => getNativeMaps(), []);
  const NativeMapView = nativeMaps.MapView;
  const Marker = nativeMaps.Marker;
  const Polyline = nativeMaps.Polyline;
  const mapProvider = nativeMaps.provider;
  const mapCanRender =
    nativeMaps.canRender && canRenderNativeGoogleMap() && Boolean(NativeMapView && Marker && Polyline);
  const pricingLookupIdRef = useRef(0);
  const suggestionLookupIdRef = useRef(0);
  const pickupSuggestionLookupIdRef = useRef(0);
  const dropoffSessionTokenRef = useRef(createSearchSessionToken());
  const pickupSessionTokenRef = useRef(createSearchSessionToken());
  const [selectedScope, setSelectedScope] = useState<ParcelScope>('city');
  const [selectedPackage, setSelectedPackage] = useState<ParcelOption['key']>(cityParcelTypes[0].key);
  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [pickupLabel, setPickupLabel] = useState('Detecting your current location...');
  const [pickupInput, setPickupInput] = useState('Detecting your current location...');
  const [pickupPoint, setPickupPoint] = useState({
    latitude: defaultRegion.latitude,
    longitude: defaultRegion.longitude,
  });
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const [pickupNeedsSelection, setPickupNeedsSelection] = useState(false);
  const [dropoff, setDropoff] = useState('');
  const [dropoffPoint, setDropoffPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapSelectionTarget, setMapSelectionTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [parcelWeightKg, setParcelWeightKg] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [pricingEstimate, setPricingEstimate] = useState<PricingEstimate | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState<number | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState(false);
  const [pricingErrorMessage, setPricingErrorMessage] = useState('');
  const [lookupErrorMessage, setLookupErrorMessage] = useState('');
  const [dropoffSuggestions, setDropoffSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [shouldFetchSuggestions, setShouldFetchSuggestions] = useState(true);
  const [selectedOutsideCityKey, setSelectedOutsideCityKey] = useState<OutsideDestinationCityKey | null>(null);
  const [selectedOutsideStandId, setSelectedOutsideStandId] = useState<string | null>(null);
  const validPickupPoint = isValidCoordinate(pickupPoint) ? pickupPoint : defaultRegion;
  const validDropoffPoint = isValidCoordinate(dropoffPoint) ? dropoffPoint : null;
  const validRouteCoordinates = useMemo(
    () => filterValidCoordinates(routeEstimate?.coordinates ?? []),
    [routeEstimate?.coordinates]
  );

  const animateMapToPoint = (point: GeoPoint, duration = 700) => {
    if (!isValidCoordinate(point)) {
      return;
    }

    mapRef.current?.animateToRegion(
      {
        latitude: point.latitude,
        longitude: point.longitude,
        latitudeDelta: defaultRegion.latitudeDelta,
        longitudeDelta: defaultRegion.longitudeDelta,
      },
      duration
    );
  };

  const availablePackages = selectedScope === 'city' ? cityParcelTypes : outsideParcelTypes;
  const activePackage = availablePackages.find((item) => item.key === selectedPackage) ?? availablePackages[0];
  const selectedOutsideCity = useMemo(
    () => outsideDestinationCities.find((city) => city.key === selectedOutsideCityKey) ?? null,
    [selectedOutsideCityKey]
  );
  const selectedOutsideStand = useMemo(
    () => selectedOutsideCity?.stands.find((stand) => stand.id === selectedOutsideStandId) ?? null,
    [selectedOutsideCity, selectedOutsideStandId]
  );
  const recipientPhoneDigits = recipientPhone.replace(/\D/g, '');
  const scheduleReady = timing === 'now' || (scheduledDate.trim().length > 0 && scheduledTime.trim().length > 0);
  const parsedParcelWeightKg = Number(parcelWeightKg.trim());
  const outsideWeightReady = selectedScope === 'city' || (Number.isFinite(parsedParcelWeightKg) && parsedParcelWeightKg > 0);
  const destinationReady = selectedScope === 'city' ? Boolean(dropoffPoint) || dropoff.trim().length >= 3 : Boolean(selectedOutsideStand);
  const parcelVehicleType = useMemo(
    () => getParcelVehicleType(selectedScope, activePackage.key),
    [activePackage.key, selectedScope]
  );
  const activeVehicleOption = useMemo(
    () => getParcelVehicleOption(parcelVehicleType),
    [parcelVehicleType]
  );
  const routePricingReady =
    Boolean(routeEstimate) &&
    Boolean(pricingEstimate) &&
    typeof routeDistanceKm === 'number' &&
    typeof routeDurationSeconds === 'number' &&
    !pricingLoading &&
    !pricingError &&
    !pickupNeedsSelection;
  const isFormValid =
    destinationReady &&
    recipientName.trim().length >= 2 &&
    recipientPhoneDigits.length >= 9 &&
    scheduleReady &&
    outsideWeightReady &&
    routePricingReady;
  const reviewBlockerMessage = useMemo(() => {
    if (isFormValid) {
      return '';
    }

    if (pickupNeedsSelection) {
      return 'Choose a pickup suggestion or use GPS before reviewing this order.';
    }

    if (!destinationReady) {
      return selectedScope === 'outside'
        ? 'Choose the destination city and bus stand.'
        : 'Enter and select the delivery destination.';
    }

    if (!outsideWeightReady) {
      return 'Enter the parcel weight in kilograms for outside-city delivery.';
    }

    if (recipientName.trim().length < 2) {
      return 'Enter the recipient name.';
    }

    if (recipientPhoneDigits.length < 9) {
      return 'Enter a valid recipient phone number.';
    }

    if (!scheduleReady) {
      return 'Enter the scheduled date and time, or choose deliver now.';
    }

    if (!routePricingReady) {
      return selectedScope === 'outside'
        ? 'Outside-city flat fare is preparing. Try again in a moment.'
        : 'Wait for the route fare to finish calculating.';
    }

    return 'Complete the missing order details before reviewing.';
  }, [
    destinationReady,
    isFormValid,
    outsideWeightReady,
    pickupNeedsSelection,
    recipientName,
    recipientPhoneDigits.length,
    routePricingReady,
    scheduleReady,
    selectedScope,
  ]);
  const pricing = useMemo(
    () =>
      buildParcelPricing({
        scope: selectedScope,
        pickupPoint,
        routeEstimate,
        pricingEstimate,
        pricingPending: pricingLoading,
        pricingError,
        outsideDestinationCity: selectedOutsideCity,
        vehicleLabel: activeVehicleOption.title,
      }),
    [activeVehicleOption.title, pickupPoint, pricingError, pricingEstimate, pricingLoading, routeEstimate, selectedOutsideCity, selectedScope]
  );
  const price = pricing.priceLabel;
  const eta = timing === 'later' ? 'Scheduled by your selected time' : pricing.etaLabel;
  const routeDistanceLabel = typeof routeDistanceKm === 'number' ? formatDistance(routeDistanceKm * 1000) : '';
  const routeDurationLabel = typeof routeDurationSeconds === 'number' ? formatDuration(routeDurationSeconds) : '';
  const pricingNoticeMessage = pricingEstimate?.warning ?? routeEstimate?.pricingEstimate?.warning ?? '';

  useEffect(() => {
    void getSavedPlaces().then(setSavedPlaces);
  }, []);

  useEffect(() => {
    void runMapsDiagnostics(screenScope);
  }, []);

  const handleReviewOrder = () => {
    if (!isFormValid) {
      Alert.alert('Complete order details', reviewBlockerMessage || 'Complete the missing order details before reviewing.');
      return;
    }

    router.push({
      pathname: '/order-review',
      params: {
        flow: 'parcel',
        scope: selectedScope,
        parcelType: activePackage.key,
        parcelLabel: activePackage.title,
        price,
        eta,
        pricingRoute: pricing.routeLabel,
        timing,
        pickup: pickupLabel,
        pickupLat: String(pickupPoint.latitude),
        pickupLng: String(pickupPoint.longitude),
        dropoff: dropoff.trim(),
        dropoffLat: dropoffPoint ? String(dropoffPoint.latitude) : '',
        dropoffLng: dropoffPoint ? String(dropoffPoint.longitude) : '',
        driverDropoff: selectedScope === 'outside' ? doordropAdminHandoffLocation.label : '',
        driverDropoffLat: selectedScope === 'outside' ? String(doordropAdminHandoffLocation.latitude) : '',
        driverDropoffLng: selectedScope === 'outside' ? String(doordropAdminHandoffLocation.longitude) : '',
        outsideDestinationCity: selectedOutsideCity?.label ?? '',
        outsideDestinationStand: selectedOutsideStand?.label ?? '',
        outsideDestination: selectedScope === 'outside' ? dropoff.trim() : '',
        outsideDestinationLat: selectedScope === 'outside' && dropoffPoint ? String(dropoffPoint.latitude) : '',
        outsideDestinationLng: selectedScope === 'outside' && dropoffPoint ? String(dropoffPoint.longitude) : '',
        distance: routeDistanceLabel,
        duration: routeDurationLabel,
        distanceMeters: typeof routeDistanceKm === 'number' ? String(Math.round(routeDistanceKm * 1000)) : '',
        durationSeconds: typeof routeDurationSeconds === 'number' ? String(Math.round(routeDurationSeconds)) : '',
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        parcelWeightKg: selectedScope === 'outside' ? parcelWeightKg.trim() : '',
        scheduleDate: scheduledDate.trim(),
        scheduleTime: scheduledTime.trim(),
      },
    });
  };

  const clearRouteEstimateState = () => {
    pricingLookupIdRef.current += 1;
    setRouteEstimate(null);
    setPricingEstimate(null);
    setRouteDistanceKm(null);
    setRouteDurationSeconds(null);
    setPricingLoading(false);
    setPricingError(false);
    setPricingErrorMessage('');
    setLookupErrorMessage('');
  };

  const applySavedPlaceToPickup = async (place: SavedPlace) => {
    try {
      const resolved = await resolveTypedLocation(place.address, dropoffPoint ?? undefined);
      const point = resolved.point;

      setPickupPoint(point);
      setPickupLabel(resolved.label);
      setPickupInput([resolved.label, resolved.address].filter(Boolean).join(', ') || place.address);
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      setPickupNeedsSelection(false);
      clearRouteEstimateState();
      animateMapToPoint(point);
    } catch (error) {
      const message = getCustomerFacingLocationError(
        error,
        'We could not place this saved pickup on the map. Try a clearer address.'
      );
      logAsyncFailure(screenScope, 'applySavedPlaceToPickup', error, {
        placeId: place.id,
        address: place.address,
        message,
      });
      setLookupErrorMessage(message);
      Alert.alert('Location not found', message);
    }
  };

  const applySavedPlaceToDropoff = async (place: SavedPlace) => {
    setDropoff(place.address);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    clearRouteEstimateState();

    try {
      const resolved = await resolveTypedLocation(place.address, pickupPoint);
      const point = resolved.point;

      setDropoffPoint(point);
      setDropoff([resolved.label, resolved.address].filter(Boolean).join(', ') || place.address);
      animateMapToPoint(point);
      setLookupErrorMessage('');
    } catch (error) {
      const message = getCustomerFacingLocationError(
        error,
        'We could not place this saved destination on the map. Try a clearer address.'
      );
      logAsyncFailure(screenScope, 'applySavedPlaceToDropoff', error, {
        placeId: place.id,
        address: place.address,
        message,
      });
      setDropoffPoint(null);
      setLookupErrorMessage(message);
      Alert.alert('Location not found', message);
    }
  };

  const applyResolvedDropoff = (label: string, point: GeoPoint) => {
    setDropoff(label);
    setDropoffPoint(point);
    clearRouteEstimateState();
    setPricingError(false);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    dropoffSessionTokenRef.current = createSearchSessionToken();
    setLookupErrorMessage('');
    animateMapToPoint(point);
  };

  useEffect(() => {
    let isMounted = true;

    const loadPickupLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setHasLocationPermission(status === 'granted');
        if (status !== 'granted') {
          if (isMounted) {
            const fallbackLabel = 'Location access is off. Using Dar es Salaam pickup preview.';
            setPickupLabel(fallbackLabel);
            setPickupInput(fallbackLabel);
            setPickupNeedsSelection(false);
          }
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        const point = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        };
        const reverse = await Location.reverseGeocodeAsync(point);

        if (isMounted) {
          setPickupPoint(point);
          const nextLabel = formatPickupLabel(reverse[0] ?? null, point);
          setPickupLabel(nextLabel);
          setPickupInput(nextLabel);
          setPickupNeedsSelection(false);
          animateMapToPoint(point);
        }
      } catch {
        if (isMounted) {
          setHasLocationPermission(false);
          const fallbackPoint = {
            latitude: defaultRegion.latitude,
            longitude: defaultRegion.longitude,
          };
          const fallbackLabel = formatPickupLabel(null, defaultRegion);
          setPickupPoint(fallbackPoint);
          setPickupLabel(fallbackLabel);
          setPickupInput(fallbackLabel);
          setPickupNeedsSelection(false);
        }
      }
    };

    const loadContacts = async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') {
          if (isMounted) {
            setContactsLoaded(true);
          }
          return;
        }

        const result = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
          pageSize: 1000,
        });

        if (isMounted) {
          setContacts(result.data.filter((contact) => (contact.phoneNumbers?.length ?? 0) > 0));
          setContactsLoaded(true);
        }
      } catch {
        if (isMounted) {
          setContactsLoaded(true);
        }
      }
    };

    loadPickupLocation();
    loadContacts();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!availablePackages.some((item) => item.key === selectedPackage)) {
      setSelectedPackage(availablePackages[0].key);
    }
  }, [availablePackages, selectedPackage]);

  useEffect(() => {
    clearRouteEstimateState();
    suggestionLookupIdRef.current += 1;
    pickupSuggestionLookupIdRef.current += 1;
    setDropoff('');
    setDropoffPoint(null);
    setRouteEstimate(null);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setPickupSuggestions([]);
    setLoadingPickupSuggestions(false);
    setShouldFetchSuggestions(selectedScope === 'city');
    setShowMapPicker(false);
    setSelectedOutsideCityKey(null);
    setSelectedOutsideStandId(null);
    dropoffSessionTokenRef.current = createSearchSessionToken();
    pickupSessionTokenRef.current = createSearchSessionToken();
  }, [selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'city' || dropoff.trim().length < 3 || !shouldFetchSuggestions) {
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const lookupId = suggestionLookupIdRef.current + 1;
    suggestionLookupIdRef.current = lookupId;
    setLoadingSuggestions(true);

    const timeout = setTimeout(() => {
      void fetchLocationSuggestions(dropoff, dropoffSessionTokenRef.current, pickupPoint)
        .then((suggestions) => {
          if (lookupId !== suggestionLookupIdRef.current) {
            return;
          }

          setDropoffSuggestions(suggestions);
          setLookupErrorMessage('');
          logAsyncSuccess(screenScope, 'loadDropoffSuggestions', {
            query: dropoff,
            results: suggestions.length,
          });
        })
        .catch((error) => {
          if (lookupId !== suggestionLookupIdRef.current) {
            return;
          }

          setDropoffSuggestions([]);
          const message = getCustomerFacingLocationError(
            error,
            'Could not load destination suggestions. Please try again.'
          );
          setLookupErrorMessage(message);
          logAsyncFailure(screenScope, 'loadDropoffSuggestions', error, {
            query: dropoff,
            message,
          });
        })
        .finally(() => {
          if (lookupId !== suggestionLookupIdRef.current) {
            return;
          }

          setLoadingSuggestions(false);
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [dropoff, pickupPoint, selectedScope, shouldFetchSuggestions]);

  useEffect(() => {
    if (pickupInput.trim().length < 3 || !pickupNeedsSelection) {
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      return;
    }

    const lookupId = pickupSuggestionLookupIdRef.current + 1;
    pickupSuggestionLookupIdRef.current = lookupId;
    setLoadingPickupSuggestions(true);

    const timeout = setTimeout(() => {
      void fetchLocationSuggestions(pickupInput, pickupSessionTokenRef.current, dropoffPoint ?? undefined)
        .then((suggestions) => {
          if (lookupId !== pickupSuggestionLookupIdRef.current) {
            return;
          }

          setPickupSuggestions(suggestions);
          setLookupErrorMessage('');
          logAsyncSuccess(screenScope, 'loadPickupSuggestions', {
            query: pickupInput,
            results: suggestions.length,
          });
        })
        .catch((error) => {
          if (lookupId !== pickupSuggestionLookupIdRef.current) {
            return;
          }

          setPickupSuggestions([]);
          const message = getCustomerFacingLocationError(
            error,
            'Could not load pickup suggestions. Please try again.'
          );
          setLookupErrorMessage(message);
          logAsyncFailure(screenScope, 'loadPickupSuggestions', error, {
            query: pickupInput,
            message,
          });
        })
        .finally(() => {
          if (lookupId !== pickupSuggestionLookupIdRef.current) {
            return;
          }

          setLoadingPickupSuggestions(false);
        });
    }, 350);

    return () => {
      clearTimeout(timeout);
    };
  }, [dropoffPoint, pickupInput, pickupNeedsSelection]);

  useEffect(() => {
    if (selectedScope !== 'city') {
      clearRouteEstimateState();
      return;
    }

    const trimmedDropoff = dropoff.trim();

    if ((!dropoffPoint && trimmedDropoff.length < 3) || pickupNeedsSelection) {
      clearRouteEstimateState();
      return;
    }

    const lookupId = pricingLookupIdRef.current + 1;
    pricingLookupIdRef.current = lookupId;
    setPricingLoading(true);
    setPricingError(false);
    setPricingErrorMessage('');
    setLookupErrorMessage('');

    const timeout = setTimeout(() => {
      void (async () => {
        let destinationPoint: GeoPoint | null = null;
        try {
          logAsyncStart(screenScope, 'cityRouteEstimate', {
            dropoff: trimmedDropoff,
            hasDropoffPoint: Boolean(dropoffPoint),
            vehicleType: parcelVehicleType,
          });
          destinationPoint =
            dropoffPoint ??
            (await resolveTypedLocation(trimmedDropoff, pickupPoint)).point;
          const nextRoute = await fetchRouteEstimate(pickupPoint, destinationPoint, {
            vehicleType: parcelVehicleType,
            pricingScope: 'city-parcel',
          });
          const nextPricing = buildFrontendPricingEstimate({
            distanceMeters: nextRoute.distanceMeters,
            vehicleType: parcelVehicleType,
            pricingScope: 'city-parcel',
          });

          if (lookupId !== pricingLookupIdRef.current) {
            return;
          }

          setRouteEstimate(nextRoute);
          setPricingEstimate(nextPricing);
          setRouteDistanceKm(nextRoute.distanceMeters / 1000);
          setRouteDurationSeconds(nextRoute.durationSeconds);
          setPricingLoading(false);
          setPricingError(false);
          setPricingErrorMessage('');
          setLookupErrorMessage('');
          if (!dropoffPoint) {
            setDropoffPoint(destinationPoint);
          }
          logAsyncSuccess(screenScope, 'cityRouteEstimate', {
            distanceMeters: nextRoute.distanceMeters,
            durationSeconds: nextRoute.durationSeconds,
            price: nextPricing.estimatedPrice,
            priceSource: 'frontend',
          });
        } catch (error) {
          if (lookupId !== pricingLookupIdRef.current) {
            return;
          }

          setPricingLoading(false);
          const message = getCustomerFacingLocationError(
            error,
            'We could not calculate this city route yet. Pick a suggestion or refine the address.'
          );
          if (destinationPoint) {
            const fallbackRoute = buildFallbackRouteEstimate(pickupPoint, destinationPoint);
            const fallbackPricing = buildFrontendPricingEstimate({
              distanceMeters: fallbackRoute.distanceMeters,
              vehicleType: parcelVehicleType,
              pricingScope: 'city-parcel',
            });

            setRouteEstimate({
              ...fallbackRoute,
              price: fallbackPricing.estimatedPrice,
              pricingEstimate: fallbackPricing,
            });
            setPricingEstimate({
              ...fallbackPricing,
              warning: 'Route service is unavailable. Showing DoorDrop estimated bodaboda fare.',
            });
            setRouteDistanceKm(fallbackRoute.distanceMeters / 1000);
            setRouteDurationSeconds(fallbackRoute.durationSeconds);
            setPricingError(false);
            setPricingErrorMessage('');
            setLookupErrorMessage('');
            if (!dropoffPoint) {
              setDropoffPoint(destinationPoint);
            }
            logWarning(screenScope, 'cityRouteEstimate using fallback route', {
              dropoff: trimmedDropoff,
              distanceMeters: fallbackRoute.distanceMeters,
              price: fallbackPricing.estimatedPrice,
              message,
            });
            return;
          }

          setRouteEstimate(null);
          setPricingEstimate(null);
          setRouteDistanceKm(null);
          setRouteDurationSeconds(null);
          setPricingError(true);
          setPricingErrorMessage(message);
          logAsyncFailure(screenScope, 'cityRouteEstimate', error, {
            dropoff: trimmedDropoff,
            hasDropoffPoint: Boolean(dropoffPoint),
            vehicleType: parcelVehicleType,
            message,
          });
        }
      })();
    }, 350);

    return () => {
      clearTimeout(timeout);
    };
  }, [dropoff, dropoffPoint, parcelVehicleType, pickupNeedsSelection, pickupPoint, selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'outside') {
      return;
    }

    if (!selectedOutsideCity || !selectedOutsideStand) {
      clearRouteEstimateState();
      return;
    }

    const outsideCity = selectedOutsideCity;
    const outsideStand = selectedOutsideStand;
    pricingLookupIdRef.current += 1;
    const fallbackDestination = outsideStand.fallbackPoint;
    const fallbackRoute = buildFallbackRouteEstimate(pickupPoint, fallbackDestination, 1.35);
    const fallbackPricing = buildFlatPricingEstimate(
      fallbackRoute.distanceMeters,
      parcelVehicleType,
      getOutsideParcelFlatFare(outsideCity.key)
    );

    setDropoffPoint(fallbackDestination);
    setRouteEstimate({
      ...fallbackRoute,
      price: fallbackPricing.estimatedPrice,
      pricingEstimate: fallbackPricing,
    });
    setPricingEstimate(fallbackPricing);
    setRouteDistanceKm(fallbackRoute.distanceMeters / 1000);
    setRouteDurationSeconds(fallbackRoute.durationSeconds);
    setPricingLoading(false);
    setPricingError(false);
    setPricingErrorMessage('');
    setLookupErrorMessage('');
    logAsyncSuccess(screenScope, 'outsideFlatPricingReady', {
      city: outsideCity.label,
      stand: outsideStand.label,
      distanceMeters: fallbackRoute.distanceMeters,
      durationSeconds: fallbackRoute.durationSeconds,
      price: fallbackPricing.estimatedPrice,
      source: 'frontend-flat',
    });
  }, [parcelVehicleType, pickupPoint, selectedOutsideCity, selectedOutsideStand, selectedScope]);

  const contactPreviewText = useMemo(() => {
    if (!contactsLoaded) {
      return 'Loading contacts for quick recipient selection...';
    }

    if (!contacts.length) {
      return 'No contact shortcuts available. You can still enter recipient details manually.';
    }

    return 'Tap a contact below to autofill the recipient name and phone number.';
  }, [contacts, contactsLoaded]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();

    if (!query) {
      return contacts;
    }

    return contacts.filter((contact) => {
      const firstPhone = contact.phoneNumbers?.[0]?.number?.toLowerCase() ?? '';
      const name = contact.name?.toLowerCase() ?? '';
      return name.includes(query) || firstPhone.includes(query);
    });
  }, [contactSearch, contacts]);

  const handleMapPress = async (event: any) => {
    const point = event.nativeEvent.coordinate;
    if (!isValidCoordinate(point)) {
      return;
    }

    clearRouteEstimateState();

    try {
      const reverse = await Location.reverseGeocodeAsync(point);
      const address = reverse[0];
      const parts = address
        ? [address.name, address.street, address.district, address.city, address.region].filter(Boolean)
        : [];
      const label = parts.length ? [...new Set(parts)].slice(0, 3).join(', ') : `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;

      if (mapSelectionTarget === 'pickup') {
        setPickupPoint(point);
        setPickupLabel(label);
        setPickupInput(label);
        setPickupSuggestions([]);
        setLoadingPickupSuggestions(false);
        setPickupNeedsSelection(false);
        pickupSessionTokenRef.current = createSearchSessionToken();
        return;
      }

      setDropoffPoint(point);
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      setShouldFetchSuggestions(false);
      if (address) {
        setDropoff(label);
        return;
      }
    } catch {
      // Fall back to coordinates if reverse geocoding fails.
    }

    if (mapSelectionTarget === 'pickup') {
      const coordinateLabel = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
      setPickupPoint(point);
      setPickupLabel(coordinateLabel);
      setPickupInput(coordinateLabel);
      setPickupNeedsSelection(false);
      pickupSessionTokenRef.current = createSearchSessionToken();
      return;
    }

    setDropoffPoint(point);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    setDropoff(`${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`);
  };

  const handlePickupChange = (value: string) => {
    pickupSuggestionLookupIdRef.current += 1;
    setPickupInput(value);
    setPickupLabel(value.trim() || 'Enter pickup location');
    setPickupNeedsSelection(true);
    setPickupSuggestions([]);
    setLoadingPickupSuggestions(false);
    setLookupErrorMessage('');
    setPricingErrorMessage('');
    clearRouteEstimateState();

    if (!value.trim()) {
      pickupSessionTokenRef.current = createSearchSessionToken();
    }
  };

  const handleSelectPickupSuggestion = async (suggestion: LocationSuggestion) => {
    try {
      const resolved = await retrieveLocationSuggestion(suggestion, pickupSessionTokenRef.current, dropoffPoint ?? undefined);
      const displayLabel = suggestion.fullText || [suggestion.name, suggestion.address].filter(Boolean).join(', ');
      setPickupPoint(resolved.point);
      setPickupLabel(displayLabel);
      setPickupInput(displayLabel);
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      setPickupNeedsSelection(false);
      pickupSessionTokenRef.current = createSearchSessionToken();
      setLookupErrorMessage('');
      clearRouteEstimateState();
      animateMapToPoint(resolved.point);
    } catch (error) {
      const message = getCustomerFacingLocationError(
        error,
        'Choose one of the pickup suggestions or refine the location text.'
      );
      logAsyncFailure(screenScope, 'handleSelectPickupSuggestion', error, {
        placeId: suggestion.placeId,
        message,
      });
      setLookupErrorMessage(message);
      Alert.alert('Pickup not found', message);
    }
  };

  const handleDropoffChange = (value: string) => {
    suggestionLookupIdRef.current += 1;
    setDropoff(value);
    setDropoffPoint(null);
    clearRouteEstimateState();
    setPricingError(false);
    setPricingErrorMessage('');
    setLookupErrorMessage('');
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(true);

    if (!value.trim()) {
      dropoffSessionTokenRef.current = createSearchSessionToken();
    }
  };

  const handleSelectDropoffSuggestion = async (suggestion: LocationSuggestion) => {
    try {
      const resolved = await retrieveLocationSuggestion(suggestion, dropoffSessionTokenRef.current, pickupPoint);
      applyResolvedDropoff(
        suggestion.fullText || buildLocationDisplayLabel(suggestion.name, suggestion.address),
        resolved.point
      );
      setLookupErrorMessage('');
    } catch (error) {
      const message = getCustomerFacingLocationError(
        error,
        'We could not resolve that destination. Pick a suggestion or refine the address.'
      );
      logAsyncFailure(screenScope, 'handleSelectDropoffSuggestion', error, {
        placeId: suggestion.placeId,
        message,
      });
      setLookupErrorMessage(message);
      setShouldFetchSuggestions(true);
    }
  };

  const handleSubmitDropoff = async () => {
    if (selectedScope !== 'city') {
      return;
    }

    const trimmedDropoff = dropoff.trim();
    if (trimmedDropoff.length < 3) {
      return;
    }

    if (dropoffSuggestions.length > 0) {
      await handleSelectDropoffSuggestion(dropoffSuggestions[0]);
      return;
    }

    try {
      const resolved = await resolveTypedLocation(trimmedDropoff, pickupPoint);
      applyResolvedDropoff(buildLocationDisplayLabel(resolved.label, resolved.address) || trimmedDropoff, resolved.point);
      setLookupErrorMessage('');
    } catch (error) {
      const message = getCustomerFacingLocationError(
        error,
        'We could not resolve that destination. Pick a suggestion or refine the address.'
      );
      logAsyncFailure(screenScope, 'handleSubmitDropoff', error, {
        query: trimmedDropoff,
        message,
      });
      setLookupErrorMessage(message);
      setShouldFetchSuggestions(true);
    }
  };

  const handleSelectOutsideCity = (cityKey: OutsideDestinationCityKey) => {
    if (cityKey !== selectedOutsideCityKey) {
      setSelectedOutsideCityKey(cityKey);
      setSelectedOutsideStandId(null);
      setDropoff('');
      setDropoffPoint(null);
      clearRouteEstimateState();
    }
  };

  const handleSelectOutsideStand = (city: OutsideDestinationCity, stand: OutsideDestinationStand) => {
    setSelectedOutsideCityKey(city.key);
    setSelectedOutsideStandId(stand.id);
    setDropoff(`${stand.label}, ${city.label}`);
    setDropoffPoint(stand.fallbackPoint);
    clearRouteEstimateState();
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    setShowMapPicker(false);
  };

  return (
    <CargoScreen
      keyboardAvoiding
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            label="Review parcel order"
            icon="arrow-right"
            onPress={handleReviewOrder}
            style={!isFormValid ? styles.reviewButtonDisabled : undefined}
          />
        </View>
      }>
      <CargoHeader
        title="Send parcel"
        subtitle="Use your current pickup point, enter the destination, choose parcel type and set the right delivery time."
        onLeftPress={() => router.back()}
        rightIcon="bell-outline"
        onRightPress={() => router.push('/notifications')}
      />

      <SectionHeader title="Delivery area" />
      <View style={styles.scopeRow}>
        {parcelScopes.map((scope) => {
          const isActive = scope.key === selectedScope;
          return (
            <TouchableOpacity
              key={scope.key}
              style={[styles.scopeCard, isActive && styles.scopeCardActive]}
              activeOpacity={0.88}
              onPress={() => setSelectedScope(scope.key)}>
              <Text style={[styles.scopeTitle, isActive && styles.scopeTitleActive]}>{scope.label}</Text>
              <Text style={[styles.scopeSubtitle, isActive && styles.scopeSubtitleActive]}>{scope.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SectionHeader title="Route" />
      <View style={styles.routeCard}>
        <View style={styles.routeRow}>
          <View style={[styles.routeIconWrap, { backgroundColor: '#ECFDF3' }]}>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={cargoTheme.colors.primary} />
          </View>
          <View style={styles.routeCopy}>
            <Text style={styles.routeLabel}>Pickup point</Text>
            <TextInput
              value={pickupInput}
              onChangeText={handlePickupChange}
              placeholder="Start typing pickup location"
              placeholderTextColor="#94A3B8"
              style={styles.routeInput}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Text style={styles.routeInlineHint}>
              Search for a Tanzanian pickup address or use GPS to load your live location.
            </Text>
          </View>
        </View>

        {loadingPickupSuggestions ? <Text style={styles.helperText}>Loading pickup suggestions...</Text> : null}

        {pickupSuggestions.length > 0 ? (
          <View style={styles.suggestionList}>
            {pickupSuggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion.id}
                activeOpacity={0.88}
                style={styles.suggestionRow}
                onPress={() => {
                  void handleSelectPickupSuggestion(suggestion);
                }}>
                <View style={styles.suggestionIconWrap}>
                  <MaterialCommunityIcons name="crosshairs-gps" size={16} color={cargoTheme.colors.primaryDark} />
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
        ) : null}

        {savedPlaces.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlacesRow}>
            {savedPlaces.map((place) => (
              <TouchableOpacity
                key={place.id}
                activeOpacity={0.88}
                style={styles.savedPlaceChip}
                onPress={() => {
                  void applySavedPlaceToPickup(place);
                }}>
                <MaterialCommunityIcons name={place.icon} size={16} color={cargoTheme.colors.primaryDark} />
                <Text style={styles.savedPlaceChipText}>Use {place.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.routeDivider} />

        <View style={styles.destinationBlock}>
          <View style={styles.routeRow}>
            <View style={[styles.routeIconWrap, { backgroundColor: '#EFF6FF' }]}>
              <MaterialCommunityIcons name="flag-checkered" size={20} color="#2563EB" />
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeLabel}>Destination</Text>
              <Text style={styles.routeHint}>
                {selectedScope === 'city'
                  ? 'Type where the parcel should be delivered and pick a Google suggestion.'
                  : 'Select the destination city, then choose its bus stand.'}
              </Text>
            </View>
          </View>

          {selectedScope === 'city' ? (
            <>
              <TextInput
                value={dropoff}
                onChangeText={handleDropoffChange}
                placeholder="Masaki, Haile Selassie Road"
                placeholderTextColor="#94A3B8"
                style={styles.routeInput}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  void handleSubmitDropoff();
                }}
              />

              {dropoffSuggestions.length > 0 ? (
                <View style={styles.suggestionList}>
                  {dropoffSuggestions.map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion.id}
                      activeOpacity={0.88}
                      style={styles.suggestionRow}
                      onPress={() => {
                        void handleSelectDropoffSuggestion(suggestion);
                      }}>
                      <View style={styles.suggestionIconWrap}>
                        <MaterialCommunityIcons name="map-marker-radius-outline" size={16} color="#1D4ED8" />
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
              ) : null}

              {savedPlaces.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlacesRow}>
                  {savedPlaces.map((place) => (
                    <TouchableOpacity
                      key={place.id}
                      activeOpacity={0.88}
                      style={styles.savedPlaceChip}
                      onPress={() => {
                        void applySavedPlaceToDropoff(place);
                      }}>
                      <MaterialCommunityIcons name={place.icon} size={16} color="#1D4ED8" />
                      <Text style={styles.savedPlaceChipText}>{place.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.88}
                style={[styles.mapToggleButton, showMapPicker && styles.mapToggleButtonActive]}
                onPress={() => setShowMapPicker((value) => !value)}>
                <MaterialCommunityIcons
                  name={showMapPicker ? 'keyboard-close-outline' : 'map-marker-plus-outline'}
                  size={18}
                  color={showMapPicker ? cargoTheme.colors.primaryDark : cargoTheme.colors.info}
                />
                <Text style={[styles.mapToggleText, showMapPicker && styles.mapToggleTextActive]}>
                  {showMapPicker ? 'Hide map picker' : 'Pick destination on map'}
                </Text>
              </TouchableOpacity>

              {showMapPicker ? (
                <View style={styles.mapCard}>
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

                  {mapCanRender && NativeMapView && Marker && Polyline ? (
                    <NativeMapView
                      ref={mapRef}
                      provider={mapProvider}
                      style={styles.map}
                      customMapStyle={lightMapStyle}
                      showsUserLocation={hasLocationPermission}
                      initialRegion={{
                        latitude: validPickupPoint.latitude,
                        longitude: validPickupPoint.longitude,
                        latitudeDelta: defaultRegion.latitudeDelta,
                        longitudeDelta: defaultRegion.longitudeDelta,
                      }}
                      onPress={handleMapPress}>
                      <Marker coordinate={validPickupPoint} title="Your location" description="Current pickup point" pinColor="#16A34A" />
                      {validDropoffPoint ? <Marker coordinate={validDropoffPoint} title="Destination" pinColor="#2563EB" /> : null}
                      {validRouteCoordinates.length >= 2 ? (
                        <Polyline coordinates={validRouteCoordinates} strokeColor={cargoTheme.colors.primaryDark} strokeWidth={4} />
                      ) : null}
                    </NativeMapView>
                  ) : (
                    <View style={[styles.map, { alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ color: '#94A3B8', textAlign: 'center', paddingHorizontal: 16 }}>
                        Map preview is unavailable right now. You can still choose a suggestion or type the destination.
                      </Text>
                    </View>
                  )}
                  <Text style={styles.mapCaption}>
                    Tap the map to place the {mapSelectionTarget === 'pickup' ? 'pickup' : 'destination'} pin, then we will redraw the route.
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.outsideDestinationFlow}>
              <Text style={styles.selectionTitle}>Choose destination city</Text>
              <View style={styles.selectionGrid}>
                {outsideDestinationCities.map((city) => {
                  const isActive = city.key === selectedOutsideCityKey;
                  return (
                    <TouchableOpacity
                      key={city.key}
                      activeOpacity={0.88}
                      style={[styles.selectionCard, isActive && styles.selectionCardActive]}
                      onPress={() => handleSelectOutsideCity(city.key)}>
                      <Text style={[styles.selectionCardTitle, isActive && styles.selectionCardTitleActive]}>{city.label}</Text>
                      <Text style={[styles.selectionCardSubtitle, isActive && styles.selectionCardSubtitleActive]}>
                        Select bus stand
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedOutsideCity ? (
                <View style={styles.standSelectorCard}>
                  <Text style={styles.selectionTitle}>Choose bus stand in {selectedOutsideCity.label}</Text>
                  <View style={styles.standList}>
                    {selectedOutsideCity.stands.map((stand) => {
                      const isActive = stand.id === selectedOutsideStandId;
                      return (
                        <TouchableOpacity
                          key={stand.id}
                          activeOpacity={0.88}
                          style={[styles.standChip, isActive && styles.standChipActive]}
                          onPress={() => handleSelectOutsideStand(selectedOutsideCity, stand)}>
                          <MaterialCommunityIcons
                            name="bus-stop"
                            size={18}
                            color={isActive ? '#FFFFFF' : cargoTheme.colors.primaryDark}
                          />
                          <Text style={[styles.standChipText, isActive && styles.standChipTextActive]}>{stand.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {selectedOutsideStand && selectedOutsideCity ? (
                <View style={styles.selectedDestinationCard}>
                  <Text style={styles.selectedDestinationLabel}>Selected destination</Text>
                  <Text style={styles.selectedDestinationValue}>{dropoff}</Text>
                </View>
              ) : (
                <Text style={styles.cardCaption}>
                  Choose one of the listed destination cities, then select the matching bus stand for pricing.
                </Text>
              )}
            </View>
          )}
        </View>
      </View>

      <SectionHeader title="Parcel type" />
      <View style={styles.packageGrid}>
        {availablePackages.map((item) => {
          const isActive = item.key === selectedPackage;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.packageCard, isActive && styles.packageCardActive]}
              activeOpacity={0.88}
              onPress={() => setSelectedPackage(item.key)}>
              <View style={[styles.packageIconWrap, isActive && styles.packageIconWrapActive]}>
                <MaterialCommunityIcons name={item.icon} size={22} color={isActive ? '#FFFFFF' : cargoTheme.colors.text} />
              </View>
              <Text style={[styles.packageTitle, isActive && styles.packageTitleActive]}>{item.title}</Text>
              <Text style={[styles.packageSubtitle, isActive && styles.packageSubtitleActive]}>{item.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.vehicleNoticeCard}>
        <Text style={styles.cardTitle}>Vehicle matching</Text>
        <Text style={styles.cardCaption}>
          All send parcel orders are assigned to Bodaboda/Motorcycle drivers, including outside-city handoff trips.
        </Text>
      </View>

      {selectedScope === 'outside' ? (
        <View style={styles.weightCard}>
          <Text style={styles.cardTitle}>Parcel weight</Text>
          <TextInput
            value={parcelWeightKg}
            onChangeText={setParcelWeightKg}
            placeholder="Enter weight in kg"
            placeholderTextColor="#94A3B8"
            keyboardType="numeric"
            style={styles.input}
          />
          <Text style={styles.cardCaption}>Enter the parcel weight in kilograms for outside-city delivery.</Text>
        </View>
      ) : null}

      <SectionHeader title="Delivery timing" />
      <View style={styles.timingRow}>
        {[
          { key: 'now', label: 'Deliver now' },
          { key: 'later', label: 'Schedule for later' },
        ].map((item) => {
          const isActive = item.key === timing;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.timingChip, isActive && styles.timingChipActive]}
              onPress={() => setTiming(item.key as 'now' | 'later')}>
              <Text style={[styles.timingText, isActive && styles.timingTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {timing === 'later' ? (
        <View style={styles.scheduleCard}>
          <Text style={styles.cardTitle}>Scheduled time</Text>
          <View style={styles.scheduleRow}>
            <TextInput
              value={scheduledDate}
              onChangeText={setScheduledDate}
              placeholder="Apr 18, 2026"
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.scheduleInput]}
            />
            <TextInput
              value={scheduledTime}
              onChangeText={setScheduledTime}
              placeholder="14:30"
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.scheduleInput]}
            />
          </View>
          <Text style={styles.cardCaption}>Enter the preferred delivery date and time for dispatch.</Text>
        </View>
      ) : null}

      <SectionHeader title="Recipient details" />
      <View style={styles.recipientCard}>
        <Text style={styles.cardTitle}>Recipient</Text>
        <TextInput
          value={recipientName}
          onChangeText={setRecipientName}
          placeholder="Recipient name"
          placeholderTextColor="#94A3B8"
          style={[styles.input, styles.inputSpacing]}
        />
        <TextInput
          value={recipientPhone}
          onChangeText={setRecipientPhone}
          keyboardType="phone-pad"
          placeholder="+255 744 123 222"
          placeholderTextColor="#94A3B8"
          style={styles.input}
        />
        <Text style={styles.cardCaption}>{contactPreviewText}</Text>

        {contacts.length ? (
          <View style={styles.contactList}>
            <TextInput
              value={contactSearch}
              onChangeText={setContactSearch}
              placeholder="Search contacts by name or phone"
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
            />
            <ScrollView nestedScrollEnabled style={styles.contactScrollArea} showsVerticalScrollIndicator={false}>
              {filteredContacts.map((contact) => {
              const firstPhone = contact.phoneNumbers?.[0]?.number?.trim();
              if (!firstPhone) {
                return null;
              }

              return (
                <Pressable
                  key={`${contact.name ?? 'contact'}-${firstPhone}`}
                  onPress={() => {
                    setRecipientName(contact.name ?? '');
                    setRecipientPhone(firstPhone);
                  }}
                  style={({ pressed }) => [styles.contactChip, pressed && styles.contactChipPressed]}>
                  <MaterialCommunityIcons name="account-circle-outline" size={18} color={cargoTheme.colors.primaryDark} />
                  <View style={styles.contactCopy}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactPhone}>{firstPhone}</Text>
                  </View>
                </Pressable>
              );
              })}
              {!filteredContacts.length ? (
                <View style={styles.emptyContactsState}>
                  <Text style={styles.emptyContactsText}>No contacts match your search yet.</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Live estimate</Text>
        <SummaryRow label="Service" value={selectedScope === 'city' ? 'In-city parcel' : 'Outside-city parcel'} />
        <SummaryRow label="Parcel type" value={activePackage.title} />
        <SummaryRow label="Vehicle match" value={activeVehicleOption.title} />
        {selectedScope === 'outside' && parcelWeightKg.trim() ? <SummaryRow label="Weight" value={`${parcelWeightKg.trim()} kg`} /> : null}
        <SummaryRow label="Pricing lane" value={pricing.routeLabel} />
        {routeDistanceLabel ? <SummaryRow label="Route distance" value={routeDistanceLabel} /> : null}
        {routeDurationLabel ? <SummaryRow label="Travel time" value={routeDurationLabel} /> : null}
        <SummaryRow label="Estimated time" value={eta} />
        <SummaryRow label="Estimated fare" value={price} emphasis />
        {reviewBlockerMessage ? <Text style={styles.helperText}>{reviewBlockerMessage}</Text> : null}
        {selectedScope === 'city' && loadingSuggestions ? <Text style={styles.helperText}>Loading destination suggestions...</Text> : null}
        {loadingPickupSuggestions ? <Text style={styles.helperText}>Loading pickup suggestions...</Text> : null}
        {pricingLoading ? <Text style={styles.helperText}>Using Google route distance to calculate your fare...</Text> : null}
        {pricingNoticeMessage && !pricingLoading && !pricingError ? (
          <Text style={styles.helperText}>{pricingNoticeMessage}</Text>
        ) : null}
        {selectedScope === 'outside' && !selectedOutsideStand ? (
          <Text style={styles.helperText}>Choose the city and bus stand to calculate an outside-city route.</Text>
        ) : null}
        {selectedScope === 'outside' && selectedOutsideStand && pricingEstimate && !pricingLoading && !pricingError ? (
          <Text style={styles.helperText}>
            Fixed outside-city fare is ready. Review the order to send it to DoorDrop dispatch.
          </Text>
        ) : null}
        {lookupErrorMessage ? <Text style={styles.helperTextError}>{lookupErrorMessage}</Text> : null}
        {pricingError ? (
          <Text style={styles.helperTextError}>
            {pricingErrorMessage ||
              (selectedScope === 'city'
                ? 'We could not price this route yet. Select a suggested destination or refine the address.'
                : 'We could not price this intercity route yet. Choose another listed bus stand or confirm the API key is active.')}
          </Text>
        ) : null}
      </View>
    </CargoScreen>
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
  reviewButtonDisabled: {
    opacity: 0.65,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  scopeCard: {
    flex: 1,
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    borderRadius: 22,
    padding: 16,
  },
  scopeCardActive: {
    backgroundColor: cargoTheme.colors.primaryDark,
    borderColor: cargoTheme.colors.primaryDark,
  },
  scopeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 6,
  },
  scopeTitleActive: {
    color: '#FFFFFF',
  },
  scopeSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  scopeSubtitleActive: {
    color: '#D6E0EA',
  },
  routeCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    borderRadius: 24,
    padding: 16,
    marginBottom: 22,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
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
    fontSize: 15,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  routeInlineHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  routeHint: {
    fontSize: 13,
    color: cargoTheme.colors.subtext,
  },
  routeDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 14,
    marginLeft: 58,
  },
  destinationBlock: {
    gap: 12,
  },
  outsideDestinationFlow: {
    gap: 14,
  },
  savedPlacesRow: {
    gap: 10,
  },
  savedPlaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: '#F0FDF4',
  },
  savedPlaceChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: cargoTheme.colors.primaryDark,
  },
  routeInput: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 16,
    fontSize: 15,
    color: cargoTheme.colors.text,
  },
  suggestionList: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    gap: 8,
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
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
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
  selectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  selectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  selectionCard: {
    width: '48%',
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  selectionCardActive: {
    borderColor: '#BBF7D0',
    backgroundColor: '#ECFDF3',
  },
  selectionCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  selectionCardTitleActive: {
    color: cargoTheme.colors.primaryDark,
  },
  selectionCardSubtitle: {
    fontSize: 12,
    color: cargoTheme.colors.subtext,
  },
  selectionCardSubtitleActive: {
    color: cargoTheme.colors.primaryDark,
  },
  standSelectorCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    backgroundColor: '#F8FFF9',
    padding: 14,
    gap: 12,
  },
  standList: {
    gap: 10,
  },
  standChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  standChipActive: {
    borderColor: cargoTheme.colors.primaryDark,
    backgroundColor: cargoTheme.colors.primaryDark,
  },
  standChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: cargoTheme.colors.primaryDark,
  },
  standChipTextActive: {
    color: '#FFFFFF',
  },
  selectedDestinationCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  selectedDestinationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 5,
  },
  selectedDestinationValue: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
  },
  mapToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  mapToggleButtonActive: {
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
  },
  mapToggleText: {
    color: cargoTheme.colors.info,
    fontSize: 14,
    fontWeight: '700',
  },
  mapToggleTextActive: {
    color: cargoTheme.colors.primaryDark,
  },
  mapCard: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: cargoTheme.colors.card,
  },
  mapModeRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  mapModeChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  mapModeChipActive: {
    borderColor: cargoTheme.colors.primaryDark,
    backgroundColor: '#ECFDF5',
  },
  mapModeChipText: {
    color: cargoTheme.colors.subtext,
    fontSize: 12,
    fontWeight: '700',
  },
  mapModeChipTextActive: {
    color: cargoTheme.colors.primaryDark,
  },
  map: {
    width: '100%',
    height: 220,
  },
  mapCaption: {
    color: cargoTheme.colors.subtext,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  packageGrid: {
    gap: 12,
    marginBottom: 16,
  },
  packageCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    padding: 16,
  },
  packageCardActive: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  packageIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: cargoTheme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  packageIconWrapActive: {
    backgroundColor: cargoTheme.colors.primary,
  },
  packageTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 4,
  },
  packageTitleActive: {
    color: cargoTheme.colors.primaryDark,
  },
  packageSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  packageSubtitleActive: {
    color: cargoTheme.colors.primaryDark,
  },
  vehicleNoticeCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 22,
  },
  timingRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  timingChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: cargoTheme.colors.surface,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
  },
  timingChipActive: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  timingText: {
    fontSize: 13,
    fontWeight: '700',
    color: cargoTheme.colors.text,
  },
  timingTextActive: {
    color: cargoTheme.colors.primaryDark,
  },
  scheduleCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 22,
  },
  weightCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 22,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  scheduleInput: {
    flex: 1,
  },
  recipientCard: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: 22,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: cargoTheme.colors.text,
    marginBottom: 10,
  },
  input: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: cargoTheme.colors.card,
    paddingHorizontal: 16,
    fontSize: 15,
    color: cargoTheme.colors.text,
  },
  inputSpacing: {
    marginBottom: 10,
  },
  cardCaption: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
    marginTop: 10,
  },
  contactList: {
    gap: 10,
    marginTop: 12,
  },
  searchInput: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cargoTheme.colors.line,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    fontSize: 14,
    color: cargoTheme.colors.text,
  },
  contactScrollArea: {
    maxHeight: 260,
    gap: 10,
  },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  contactChipPressed: {
    opacity: 0.92,
  },
  contactCopy: {
    flex: 1,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '700',
    color: cargoTheme.colors.text,
    marginBottom: 2,
  },
  contactPhone: {
    fontSize: 12,
    color: cargoTheme.colors.subtext,
  },
  emptyContactsState: {
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyContactsText: {
    color: cargoTheme.colors.subtext,
    fontSize: 13,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: cargoTheme.colors.darkSurface,
    borderRadius: 24,
    padding: 18,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 14,
  },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#DCE3EC',
  },
  helperTextError: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#FECACA',
  },
});
