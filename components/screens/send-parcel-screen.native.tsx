import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { MapStopPin } from '@/components/map-markers';
import { PhoneInput } from '@/components/phone-input';
import { ServiceNotice } from '@/components/service-notice';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, parcelScopes, type ParcelScope } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
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
import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import { filterValidCoordinates, formatDistance, formatDuration, isValidCoordinate } from '@/lib/route-utils';
import { getSavedPlaces, type SavedPlace } from '@/lib/saved-places';
import { useAppCopy } from '@/lib/app-copy';
import { classifyLocationError, type CustomerNoticeKind } from '@/lib/network-status';

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
    key: 'tanga',
    label: 'Tanga',
    centerPoint: { latitude: -5.0889, longitude: 39.1023 },
    stands: [
      {
        id: 'central',
        label: 'Tanga Bus Stand',
        query: 'Tanga Bus Stand, Tanga, Tanzania',
        fallbackPoint: { latitude: -5.0692, longitude: 39.0988 },
      },
      {
        id: 'korogwe',
        label: 'Korogwe Bus Stand',
        query: 'Korogwe Bus Stand, Tanga, Tanzania',
        fallbackPoint: { latitude: -5.1556, longitude: 38.5167 },
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
  const copy = useAppCopy();
  const params = useLocalSearchParams<{
    repeat?: string;
    scope?: string;
    parcelType?: string;
    pickup?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropoff?: string;
    dropoffLat?: string;
    dropoffLng?: string;
    recipientName?: string;
    recipientPhone?: string;
    parcelWeightKg?: string;
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
  const [selectedScope, setSelectedScope] = useState<ParcelScope>(params.scope === 'outside' ? 'outside' : 'city');
  const [selectedPackage, setSelectedPackage] = useState<ParcelOption['key']>(
    (params.parcelType as ParcelOption['key']) || cityParcelTypes[0].key
  );
  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [pickupLabel, setPickupLabel] = useState(
    hasRepeatPickup ? String(params.pickup) : copy.parcel.detecting
  );
  const [pickupInput, setPickupInput] = useState(
    hasRepeatPickup ? String(params.pickup) : copy.parcel.detecting
  );
  const [pickupPoint, setPickupPoint] = useState({
    latitude: hasRepeatPickup ? repeatPickupLat : defaultRegion.latitude,
    longitude: hasRepeatPickup ? repeatPickupLng : defaultRegion.longitude,
  });
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const [pickupNeedsSelection, setPickupNeedsSelection] = useState(false);
  const [dropoff, setDropoff] = useState(hasRepeatDropoff ? String(params.dropoff) : '');
  const [dropoffPoint, setDropoffPoint] = useState<{ latitude: number; longitude: number } | null>(
    hasRepeatDropoff ? { latitude: repeatDropoffLat, longitude: repeatDropoffLng } : null
  );
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapSelectionTarget, setMapSelectionTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [parcelWeightKg, setParcelWeightKg] = useState(params.parcelWeightKg ? String(params.parcelWeightKg) : '');
  const [recipientName, setRecipientName] = useState(params.recipientName ? String(params.recipientName) : '');
  const [recipientPhone, setRecipientPhone] = useState(params.recipientPhone ? String(params.recipientPhone) : '');
  const [notifyRecipient, setNotifyRecipient] = useState(true);
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [editingPickup, setEditingPickup] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [pricingEstimate, setPricingEstimate] = useState<PricingEstimate | null>(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState<number | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState(false);
  const [pricingErrorMessage, setPricingErrorMessage] = useState('');
  const [locationNotice, setLocationNotice] = useState<CustomerNoticeKind | null>(null);
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
  const destinationReady = selectedScope === 'city' ? Boolean(dropoffPoint) : Boolean(selectedOutsideStand);
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
      return 'Enter the parcel weight in kilograms for other-region delivery.';
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
        ? 'Regional fare is preparing. Try again in a moment.'
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
  const showRecipientStep = destinationReady && outsideWeightReady;
  const footerLabel = useMemo(() => {
    if (pickupNeedsSelection) {
      return copy.parcel.nextPickup;
    }
    if (selectedScope === 'outside' && !selectedOutsideCity) {
      return copy.parcel.nextCity;
    }
    if (selectedScope === 'outside' && !selectedOutsideStand) {
      return copy.parcel.nextStand;
    }
    if (!destinationReady) {
      return copy.parcel.nextDropoff;
    }
    if (!outsideWeightReady) {
      return copy.parcel.nextWeight;
    }
    if (recipientName.trim().length < 2 || recipientPhoneDigits.length < 9) {
      return copy.parcel.nextRecipient;
    }
    if (!routePricingReady) {
      return copy.parcel.calculating;
    }
    return `${copy.common.continue} · ${price}`;
  }, [
    copy.common.continue,
    copy.parcel.calculating,
    copy.parcel.nextCity,
    copy.parcel.nextDropoff,
    copy.parcel.nextPickup,
    copy.parcel.nextRecipient,
    copy.parcel.nextStand,
    copy.parcel.nextWeight,
    destinationReady,
    outsideWeightReady,
    pickupNeedsSelection,
    price,
    recipientName,
    recipientPhoneDigits.length,
    routePricingReady,
    selectedOutsideCity,
    selectedOutsideStand,
    selectedScope,
  ]);
  const routeDistanceLabel = typeof routeDistanceKm === 'number' ? formatDistance(routeDistanceKm * 1000) : '';
  const routeDurationLabel = typeof routeDurationSeconds === 'number' ? formatDuration(routeDurationSeconds) : '';
  const pricingNoticeMessage = pricingEstimate?.warning ?? routeEstimate?.pricingEstimate?.warning ?? '';

  useEffect(() => {
    void getSavedPlaces().then(setSavedPlaces);
  }, []);

  const handleReviewOrder = () => {
    if (!isFormValid) {
      Alert.alert(copy.parcel.completeTitle, reviewBlockerMessage || copy.parcel.completeTitle);
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
        notifyRecipient: notifyRecipient ? '1' : '0',
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
    setLocationNotice(null);
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
      logWarning(screenScope, 'applySavedPlaceToPickup', { placeId: place.id });
      setLocationNotice(classifyLocationError(error));
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
      setLocationNotice(null);
    } catch (error) {
      logWarning(screenScope, 'applySavedPlaceToDropoff', { placeId: place.id });
      setDropoffPoint(null);
      setLocationNotice(classifyLocationError(error));
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
    setLocationNotice(null);
    animateMapToPoint(point);
  };

  useEffect(() => {
    let isMounted = true;

    const loadPickupLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setHasLocationPermission(status === 'granted');
        if (hasRepeatPickup) {
          return;
        }
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

    loadPickupLocation();

    return () => {
      isMounted = false;
    };
  }, [hasRepeatPickup]);

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
          setLocationNotice(null);
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
          setLocationNotice(classifyLocationError(error));
          logWarning(screenScope, 'loadDropoffSuggestions', { query: dropoff });
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
          setLocationNotice(null);
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
          setLocationNotice(classifyLocationError(error));
          logWarning(screenScope, 'loadPickupSuggestions', { query: pickupInput });
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
    setLocationNotice(null);

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
          setLocationNotice(null);
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
            setLocationNotice(null);
            if (!dropoffPoint) {
              setDropoffPoint(destinationPoint);
            }
            logWarning(screenScope, 'cityRouteEstimate using fallback route', {
              dropoff: trimmedDropoff,
              distanceMeters: fallbackRoute.distanceMeters,
              price: fallbackPricing.estimatedPrice,
            });
            return;
          }

          setRouteEstimate(null);
          setPricingEstimate(null);
          setRouteDistanceKm(null);
          setRouteDurationSeconds(null);
          setPricingError(true);
          setPricingErrorMessage('');
          setLocationNotice(classifyLocationError(error));
          logWarning(screenScope, 'cityRouteEstimate', {
            dropoff: trimmedDropoff,
            hasDropoffPoint: Boolean(dropoffPoint),
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
    setLocationNotice(null);
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
    setLocationNotice(null);
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
      setLocationNotice(null);
      clearRouteEstimateState();
      animateMapToPoint(resolved.point);
    } catch (error) {
      logWarning(screenScope, 'handleSelectPickupSuggestion', { placeId: suggestion.placeId });
      setLocationNotice(classifyLocationError(error));
    }
  };

  const handleDropoffChange = (value: string) => {
    suggestionLookupIdRef.current += 1;
    setDropoff(value);
    setDropoffPoint(null);
    clearRouteEstimateState();
    setPricingError(false);
    setPricingErrorMessage('');
    setLocationNotice(null);
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
      setLocationNotice(null);
    } catch (error) {
      logWarning(screenScope, 'handleSelectDropoffSuggestion', { placeId: suggestion.placeId });
      setLocationNotice(classifyLocationError(error));
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
      setLocationNotice(null);
    } catch (error) {
      logWarning(screenScope, 'handleSubmitDropoff', { query: trimmedDropoff });
      setLocationNotice(classifyLocationError(error));
      setShouldFetchSuggestions(true);
    }
  };

  const handleSelectOutsideCity = (cityKey: OutsideDestinationCityKey) => {
    if (cityKey === selectedOutsideCityKey) {
      return;
    }

    const city = outsideDestinationCities.find((item) => item.key === cityKey);
    const firstStand = city?.stands[0];
    setSelectedOutsideCityKey(cityKey);

    if (city && firstStand) {
      setSelectedOutsideStandId(firstStand.id);
      setDropoff(`${firstStand.label}, ${city.label}`);
      setDropoffPoint(firstStand.fallbackPoint);
      clearRouteEstimateState();
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      setShouldFetchSuggestions(false);
      setShowMapPicker(false);
      return;
    }

    setSelectedOutsideStandId(null);
    setDropoff('');
    setDropoffPoint(null);
    clearRouteEstimateState();
  };

  const openContactsPicker = async () => {
    setShowContacts(true);
    if (contactsLoaded) {
      return;
    }

    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setContactsLoaded(true);
        return;
      }

      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        pageSize: 1000,
      });
      setContacts(result.data.filter((contact) => (contact.phoneNumbers?.length ?? 0) > 0));
      setContactsLoaded(true);
    } catch {
      setContactsLoaded(true);
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
      backgroundColor="#FFFFFF"
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          {isFormValid ? <Text style={styles.footerEta}>{eta}</Text> : null}
          <PrimaryButton
            label={footerLabel}
            icon={isFormValid ? 'arrow-right' : undefined}
            onPress={handleReviewOrder}
            style={!isFormValid ? styles.reviewButtonDisabled : undefined}
          />
        </View>
      }>
      <CargoHeader title={copy.parcel.title} onLeftPress={() => router.back()} />

      <View style={styles.segment}>
        {parcelScopes.map((scope) => {
          const isActive = scope.key === selectedScope;
          return (
            <TouchableOpacity
              key={scope.key}
              style={[styles.segmentItem, isActive && styles.segmentItemActive]}
              activeOpacity={0.88}
              onPress={() => setSelectedScope(scope.key)}>
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                {scope.key === 'city' ? copy.parcel.inCity : copy.parcel.outsideCity}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.routeCard}>
        {editingPickup || pickupNeedsSelection ? (
          <View style={styles.routeRow}>
            <View style={[styles.routeIconWrap, { backgroundColor: '#ECFDF3' }]}>
              <MaterialCommunityIcons name="crosshairs-gps" size={18} color={cargoTheme.colors.primary} />
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeLabel}>{copy.common.from}</Text>
              <TextInput
                value={pickupInput}
                onChangeText={handlePickupChange}
                placeholder={copy.parcel.pickupPlaceholder}
                placeholderTextColor="#94A3B8"
                style={styles.routeInput}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
              />
              {loadingPickupSuggestions ? <Text style={styles.helperText}>{copy.parcel.searching}</Text> : null}
              {pickupSuggestions.length > 0 ? (
                <View style={styles.suggestionList}>
                  {pickupSuggestions.map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion.id}
                      activeOpacity={0.88}
                      style={styles.suggestionRow}
                      onPress={() => {
                        void handleSelectPickupSuggestion(suggestion);
                        setEditingPickup(false);
                      }}>
                      <View style={styles.suggestionCopy}>
                        <Text style={styles.suggestionTitle}>{suggestion.name}</Text>
                        <Text numberOfLines={1} style={styles.suggestionText}>
                          {suggestion.address || suggestion.fullText}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.compactStop} activeOpacity={0.88} onPress={() => setEditingPickup(true)}>
            <View style={[styles.routeIconWrap, { backgroundColor: '#ECFDF3' }]}>
              <MaterialCommunityIcons name="crosshairs-gps" size={18} color={cargoTheme.colors.primary} />
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeLabel}>{copy.common.from}</Text>
              <Text numberOfLines={1} style={styles.compactStopValue}>{pickupLabel}</Text>
            </View>
            <Text style={styles.changeLink}>{copy.common.change}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.routeDivider} />

        {selectedScope === 'city' ? (
          <>
            <View style={styles.routeRow}>
              <View style={[styles.routeIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="map-marker" size={18} color="#2563EB" />
              </View>
              <View style={styles.routeCopy}>
                <Text style={styles.routeLabel}>{copy.common.to}</Text>
                <TextInput
                  value={dropoff}
                  onChangeText={handleDropoffChange}
                  placeholder={copy.parcel.dropoffPlaceholder}
                  placeholderTextColor="#94A3B8"
                  style={styles.routeInput}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    void handleSubmitDropoff();
                  }}
                />
              </View>
              <TouchableOpacity
                hitSlop={10}
                onPress={() => {
                  setMapSelectionTarget('dropoff');
                  setShowMapPicker((value) => !value);
                }}>
                <MaterialCommunityIcons
                  name={showMapPicker ? 'map-check-outline' : 'map-outline'}
                  size={20}
                  color={cargoTheme.colors.primaryDark}
                />
              </TouchableOpacity>
            </View>

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
                    <View style={styles.suggestionCopy}>
                      <Text style={styles.suggestionTitle}>{suggestion.name}</Text>
                      <Text numberOfLines={1} style={styles.suggestionText}>
                        {suggestion.address || suggestion.fullText}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {savedPlaces.length > 0 && !dropoffPoint && !dropoff.trim() ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedPlacesRow}>
                {savedPlaces.map((place) => (
                  <TouchableOpacity
                    key={place.id}
                    activeOpacity={0.88}
                    style={styles.savedPlaceChip}
                    onPress={() => {
                      void applySavedPlaceToDropoff(place);
                    }}>
                    <MaterialCommunityIcons name={place.icon} size={15} color={cargoTheme.colors.primaryDark} />
                    <Text style={styles.savedPlaceChipText}>{place.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            {showMapPicker ? (
              <View style={styles.mapCard}>
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
                    <Marker
                      coordinate={validPickupPoint}
                      title={copy.cargo.pickup}
                      anchor={{ x: 0.5, y: 1 }}
                      tracksViewChanges={false}
                      zIndex={8}>
                      <MapStopPin kind="pickup" label={copy.cargo.pickup} />
                    </Marker>
                    {validDropoffPoint ? (
                      <Marker
                        coordinate={validDropoffPoint}
                        title={copy.cargo.dropoff}
                        anchor={{ x: 0.5, y: 1 }}
                        tracksViewChanges={false}
                        zIndex={9}>
                        <MapStopPin kind="dropoff" label={copy.cargo.dropoff} />
                      </Marker>
                    ) : null}
                    {validRouteCoordinates.length >= 2 ? (
                      <Polyline coordinates={validRouteCoordinates} strokeColor={cargoTheme.colors.primaryDark} strokeWidth={4} />
                    ) : null}
                  </NativeMapView>
                ) : (
                  <View style={[styles.map, styles.mapFallback]}>
                    <Text style={styles.mapFallbackText}>{copy.parcel.mapUnavailable}</Text>
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.outsideDestinationFlow}>
            <Text style={styles.routeLabel}>{copy.parcel.destinationCity}</Text>
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
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedOutsideCity ? (
              <View style={styles.standSelectorCard}>
                <Text style={styles.routeLabel}>{copy.parcel.busStand}</Text>
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
                          size={16}
                          color={isActive ? '#FFFFFF' : cargoTheme.colors.primaryDark}
                        />
                        <Text style={[styles.standChipText, isActive && styles.standChipTextActive]}>{stand.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {selectedOutsideStand ? (
              <View style={styles.weightCard}>
                <Text style={styles.routeLabel}>{copy.parcel.weight}</Text>
                <TextInput
                  value={parcelWeightKg}
                  onChangeText={setParcelWeightKg}
                  placeholder="e.g. 8"
                  placeholderTextColor="#94A3B8"
                  keyboardType="numeric"
                  style={styles.input}
                />
              </View>
            ) : null}
          </View>
        )}
      </View>

      {locationNotice && locationNotice !== 'offline' ? (
        <View style={styles.noticeWrap}>
          <ServiceNotice kind={locationNotice} />
        </View>
      ) : null}
      {pricingError && !locationNotice ? (
        <View style={styles.noticeWrap}>
          <ServiceNotice kind="service" />
        </View>
      ) : null}

      {showRecipientStep ? (
        <View style={styles.recipientCard}>
          <Text style={styles.sectionLabel}>{copy.parcel.recipient}</Text>
          <View style={styles.nameRow}>
            <TextInput
              value={recipientName}
              onChangeText={setRecipientName}
              placeholder={copy.parcel.recipientName}
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.nameInput]}
            />
            <TouchableOpacity
              style={styles.contactIconButton}
              activeOpacity={0.88}
              onPress={() => {
                if (showContacts) {
                  setShowContacts(false);
                  return;
                }
                void openContactsPicker();
              }}>
              <MaterialCommunityIcons name="account-plus-outline" size={20} color={cargoTheme.colors.primaryDark} />
            </TouchableOpacity>
          </View>
          <PhoneInput value={recipientPhone} onChangeText={setRecipientPhone} style={styles.recipientPhone} />

          {showContacts ? (
            <View style={styles.contactList}>
              <TextInput
                value={contactSearch}
                onChangeText={setContactSearch}
                placeholder={copy.parcel.searchContacts}
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
              />
              <ScrollView nestedScrollEnabled style={styles.contactScrollArea} showsVerticalScrollIndicator={false}>
                {filteredContacts.slice(0, 12).map((contact) => {
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
                        setShowContacts(false);
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
                    <Text style={styles.emptyContactsText}>{copy.parcel.noContacts}</Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 12,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  footerEta: {
    marginBottom: 8,
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#64748B',
    textAlign: 'center',
  },
  reviewButtonDisabled: {
    opacity: 0.72,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.subtext,
  },
  segmentTextActive: {
    color: cargoTheme.colors.text,
    fontFamily: typography.bold,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  scopeCard: {
    flex: 1,
    minHeight: 44,
    backgroundColor: '#F4F5F7',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  scopeCardActive: {
    backgroundColor: '#0F172A',
  },
  scopeTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  scopeTitleActive: {
    color: '#FFFFFF',
  },
  routeCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    padding: 14,
    marginBottom: 18,
  },
  compactStop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactStopValue: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  changeLink: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
    marginLeft: 8,
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
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  routeInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: typography.medium,
    color: '#0F172A',
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
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
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
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  selectionCardActive: {
    borderColor: '#BBF7D0',
    backgroundColor: '#ECFDF3',
  },
  selectionCardTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
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
  mapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
  },
  mapLinkText: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  mapFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  mapFallbackText: {
    color: '#64748B',
    textAlign: 'center',
    fontFamily: typography.body,
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#64748B',
    marginBottom: 10,
  },
  quietHint: {
    fontSize: 12,
    fontFamily: typography.body,
    color: '#94A3B8',
    marginTop: -6,
    marginBottom: 16,
  },
  contactsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  contactsToggleText: {
    fontSize: 13,
    fontFamily: typography.semibold,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F4F5F7',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minWidth: '47%',
    flexGrow: 1,
  },
  packageCardActive: {
    backgroundColor: '#ECFDF3',
  },
  packageTitle: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  packageTitleActive: {
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
    gap: 8,
    marginBottom: 16,
  },
  timingChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F4F5F7',
  },
  timingChipActive: {
    backgroundColor: '#0F172A',
  },
  timingText: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  timingTextActive: {
    color: '#FFFFFF',
  },
  scheduleCard: {
    marginBottom: 16,
  },
  weightCard: {
    marginTop: 4,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  scheduleInput: {
    flex: 1,
  },
  recipientCard: {
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  nameInput: {
    flex: 1,
    marginBottom: 0,
  },
  contactIconButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: typography.medium,
    color: '#0F172A',
  },
  recipientPhone: {
    marginBottom: 0,
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingVertical: 4,
  },
  notifyBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifyBoxChecked: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: cargoTheme.colors.primary,
  },
  notifyText: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.semibold,
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
  noticeWrap: {
    marginTop: 10,
    marginBottom: 4,
  },
});
