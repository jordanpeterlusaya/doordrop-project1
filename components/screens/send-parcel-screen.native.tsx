import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CargoHeader, CargoScreen, PrimaryButton } from '@/components/cargo-ui';
import { LocationSuggestionsList } from '@/components/location-suggestions-list';
import { NetworkDegradedBanner } from '@/components/network-degraded-banner';
import { OutsideExpressFlightPicker } from '@/components/outside-express-flight-picker';
import {
  resolveOutsideParcelProgressStep,
  OutsideParcelWizardBar,
} from '@/components/outside-parcel-progress-bar';
import { OutsideParcelDestinationPicker, OutsideParcelStepHeader } from '@/components/outside-parcel-destination-picker';
import { MapStopPin } from '@/components/map-markers';
import { MapRouteLine } from '@/components/map-route-line';
import { buildNearbyLiveVehicles, NearbyLiveVehicleMarkers } from '@/components/nearby-live-vehicles';
import {
  OutsideParcelWizard,
  type OutsideParcelSizePreset,
} from '@/components/outside-parcel-wizard';
import { PhoneInput } from '@/components/phone-input';
import { RegionOutOfReachScreen } from '@/components/region-out-of-reach-screen';
import { ServiceNotice } from '@/components/service-notice';
import { doordropAdminHandoffLocation } from '@/constants/admin-location';
import { cargoTheme, parcelScopes, type ParcelScope } from '@/constants/cargo-theme';
import {
  CITY_PARCELS_ENABLED,
  isHiddenCityParcelRequest,
  resolveVisibleParcelScope,
} from '@/constants/parcel-features';
import { typography } from '@/constants/typography';
import { buildFrontendPricingEstimate } from '@/lib/cargo-pricing';
import { subscribeToDrivers, type DriverRecord } from '@/lib/delivery-data';
import { images } from '@/lib/images';
import { lightMapStyle } from '@/lib/light-map-style';
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
  type RouteEstimateVehicleType,
} from '@/lib/location-search';
import {
  ensureCustomerLocation,
  getCustomerLocationSnapshot,
  subscribeCustomerLocation,
} from '@/lib/customer-location';
import { formatExpoGeocodedLabel, isCoordinateLikeLabel } from '@/lib/place-labels';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logWarning } from '@/lib/debug-logger';
import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { getNativeMaps } from '@/lib/native-maps';
import {
  getDefaultDestinationHub,
  getOutsideMaxWeightKg,
  getOutsideParcelFlatFare,
  isOutsideExpressAvailable,
  isOutsideHomeDeliveryAvailable,
  isOutsideHomeNearDestinationAirport,
  isOutsideWeightValid,
  isZanzibarSeaDestination,
  outsideDestinationCities as defaultOutsideDestinationCities,
  type OutsideDestinationCity,
  type OutsideDestinationCityKey,
  type OutsideHandoffMode,
  type OutsideHub,
  type OutsideShippingMode,
} from '@/lib/outside-parcel';
import {
  isImagePickerAvailable,
  pickOrderImageFromCamera,
  pickOrderImageFromLibrary,
} from '@/lib/order-media';
import {
  clearParcelPhotoDraft,
  getParcelPhotoDraft,
  patchParcelPhotoDraft,
  setParcelPhotoDraft,
} from '@/lib/parcel-photo-draft';
import { proveParcelPhotoUploadApi, uploadParcelCargoPhoto } from '@/lib/parcel-photo-upload';
import { useAuthSession } from '@/providers/auth-provider';
import {
  formatOutsideParcelEtaLabel,
  getOutsideParcelDurationSeconds,
} from '@/lib/outside-parcel-eta';
import { subscribeOutsideExpressRoutesCatalog } from '@/lib/outside-express-routes-catalog';
import { subscribeOutsideParcelCatalog } from '@/lib/outside-parcel-catalog';
import { mergeTanzaniaBusRegions } from '@/lib/tanzania-bus-regions';
import {
  findOutsideExpressRouteSchedule,
  formatExpressFlightEtaLabel,
  getBookableExpressDepartures,
  hasScheduledExpressDepartures,
  isDarZanzibarExpressRouteSchedule,
  pickExpressNextDayFallbackSlot,
  resolveExpressFirstMileMinutes,
  type BookableExpressDeparture,
} from '@/lib/outside-express-schedule';
import {
  getNearestOutsideCityFromList,
  getOutsideEligibleDestinations,
  hasOutsideExpressRoutesFromOrigin,
  hasOutsideStandardRoutesFromOrigin,
  isOutsideExpressHomeDeliveryMandatory,
  isOutsideParcelServiceAvailableAt,
  isOutsideRouteAllowed,
  resolveOutsideOriginCityKey,
} from '@/lib/outside-parcel-routes';
import { fetchRoadFollowingRoute } from '@/lib/road-route';
import { getNearestServiceCity } from '@/lib/service-cities';
import { filterValidCoordinates, formatDistance, formatDuration, getDistanceBetweenPoints, isValidCoordinate } from '@/lib/route-utils';
import { getSavedPlaces, type SavedPlace } from '@/lib/saved-places';
import { useAppCopy } from '@/lib/app-copy';
import { classifyLocationError, type CustomerNoticeKind } from '@/lib/network-status';
import { formatScheduleSummary } from '@/lib/schedule-delivery';
import { useLanguage } from '@/providers/language-provider';

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
type OutsideRegionStatus = 'idle' | 'checking' | 'available' | 'out-of-reach';
type GeoPoint = { latitude: number; longitude: number };

const outsideSizePresets: Record<
  OutsideParcelSizePreset,
  {
    packageKey: (typeof outsideParcelTypes)[number]['key'];
    weightKg: string;
    lengthCm: string;
    widthCm: string;
    heightCm: string;
  }
> = {
  ndogo: { packageKey: 'electronics', weightKg: '2', lengthCm: '35', widthCm: '20', heightCm: '10' },
  wastani: { packageKey: 'luggage', weightKg: '15', lengthCm: '50', widthCm: '40', heightCm: '35' },
  kubwa: { packageKey: 'box-bulk', weightKg: '35', lengthCm: '80', widthCm: '60', heightCm: '50' },
  kubwa_sana: { packageKey: 'box-bulk', weightKg: '80', lengthCm: '120', widthCm: '80', heightCm: '80' },
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

const parcelVehicleOptions: ParcelVehicleOption[] = [
  {
    key: 'bodaboda',
    title: 'Bodaboda / Motorcycle',
  },
];

function formatPickupLabel(address: Location.LocationGeocodedAddress | null, point: GeoPoint) {
  return formatExpoGeocodedLabel(address, point);
}

function formatTzs(amount: number) {
  return `TZS ${Math.max(0, Math.round(amount)).toLocaleString('en-US')}`;
}

function buildLocationDisplayLabel(name?: string, address?: string) {
  return [name, address].filter(Boolean).join(', ');
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

function buildFallbackRouteEstimate(
  origin: GeoPoint,
  destination: GeoPoint,
  distanceMultiplier = 1.25,
  road?: { coordinates: GeoPoint[]; distanceMeters?: number; durationSeconds?: number; geometry?: string } | null
): RouteEstimate {
  const directDistanceMeters = getDistanceBetweenPoints(origin, destination);
  const distanceMeters = Math.max(
    1000,
    Math.round(road?.distanceMeters && road.distanceMeters > 0 ? road.distanceMeters : directDistanceMeters * distanceMultiplier)
  );
  const averageMetersPerSecond = 9.7;
  const coordinates =
    road?.coordinates && road.coordinates.length > 2 ? road.coordinates : [origin, destination];

  return {
    distanceMeters,
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    durationSeconds:
      road?.durationSeconds && road.durationSeconds > 0
        ? Math.round(road.durationSeconds)
        : Math.max(600, Math.round(distanceMeters / averageMetersPerSecond)),
    polyline: road?.geometry ?? '',
    coordinates,
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

function buildCityRouteLabel(params: {
  pickupPoint: GeoPoint;
  pickupLabel?: string;
  dropoffLabel?: string;
  vehicleLabel: string;
  language: 'sw' | 'en';
}) {
  const from = String(params.pickupLabel || '').trim();
  const to = String(params.dropoffLabel || '').trim();
  if (from && to) {
    return `${from} → ${to}`;
  }

  const city = getNearestServiceCity(params.pickupPoint);
  if (params.language === 'sw') {
    return `${city.label} mjini · ${params.vehicleLabel}`;
  }
  return `${city.label} · ${params.vehicleLabel}`;
}

function buildParcelPricing(params: {
  scope: ParcelScope;
  pickupPoint: GeoPoint;
  pickupLabel?: string;
  dropoffLabel?: string;
  routeEstimate?: RouteEstimate | null;
  pricingEstimate?: PricingEstimate | null;
  pricingPending?: boolean;
  pricingError?: boolean;
  outsideDestinationCity?: OutsideDestinationCity | null;
  outsideOriginCity?: OutsideDestinationCity | null;
  outsideOriginCityKey?: OutsideDestinationCityKey;
  shippingMode?: OutsideShippingMode | null;
  vehicleLabel: string;
  language: 'sw' | 'en';
}) {
  const {
    scope,
    pickupPoint,
    pickupLabel,
    dropoffLabel,
    routeEstimate,
    pricingEstimate,
    pricingPending,
    pricingError,
    outsideDestinationCity,
    outsideOriginCity,
    outsideOriginCityKey,
    shippingMode,
    vehicleLabel,
    language,
  } = params;

  if (scope === 'city') {
    const routeLabel = buildCityRouteLabel({
      pickupPoint,
      pickupLabel,
      dropoffLabel,
      vehicleLabel,
      language,
    });

    if (pricingPending && (!routeEstimate || !pricingEstimate)) {
      return {
        priceLabel: language === 'sw' ? 'Inahesabu...' : 'Calculating...',
        etaLabel: language === 'sw' ? 'Inahesabu...' : 'Calculating...',
        routeLabel,
      };
    }

    if (pricingError && (!routeEstimate || !pricingEstimate)) {
      return {
        priceLabel: language === 'sw' ? 'Njia haipatikani' : 'Route unavailable',
        etaLabel: language === 'sw' ? 'Njia haipatikani' : 'Route unavailable',
        routeLabel,
      };
    }

    if (!routeEstimate || !pricingEstimate) {
      return {
        priceLabel: language === 'sw' ? 'Weka mahali pa kupeleka' : 'Enter destination',
        etaLabel: language === 'sw' ? 'Inasubiri njia' : 'Waiting for route',
        routeLabel,
      };
    }

    return {
      priceLabel: formatTzs(pricingEstimate.estimatedPrice),
      etaLabel: formatCityEtaRange(routeEstimate.durationSeconds),
      routeLabel,
    };
  }

  const originCity =
    outsideOriginCity ??
    getNearestOutsideCityFromList(pickupPoint, defaultOutsideDestinationCities) ??
    defaultOutsideDestinationCities[0];
  const travelLabel =
    shippingMode === 'express'
      ? 'Express flight'
      : shippingMode === 'standard'
        ? isZanzibarSeaDestination(outsideDestinationCity)
          ? 'Ferry'
          : 'Bus'
        : vehicleLabel;
  const routeLabel = outsideDestinationCity
    ? `${originCity.label} to ${outsideDestinationCity.label}`
    : 'Intercity parcel delivery';

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
    etaLabel: formatOutsideParcelEtaLabel({
      originCityKey: outsideOriginCityKey ?? outsideOriginCity?.key,
      destinationCityKey: outsideDestinationCity?.key,
      shippingMode,
      language,
    }),
    routeLabel: `${routeLabel} · ${travelLabel}`,
  };
}

function formatDeclaredValueInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (!digits) {
    return '';
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseDeclaredValueDigits(value: string) {
  return value.replace(/\D/g, '');
}

export default function SendParcelScreen() {
  const router = useRouter();
  const copy = useAppCopy();
  const { language } = useLanguage();
  const { user } = useAuthSession();
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
    declaredValueTzs?: string;
    contentsDeclarationAccepted?: string;
    requestedDriverId?: string;
    requestedDriverName?: string;
    timing?: string;
    scheduleDate?: string;
    scheduleTime?: string;
    outsideDestinationCity?: string;
    outsideDestinationStand?: string;
    outsideDestination?: string;
    outsideDestinationLat?: string;
    outsideDestinationLng?: string;
    outsideShippingMode?: string;
    outsideHandoffMode?: string;
  }>();
  const isRepeat = params.repeat === '1';
  const initialScope = resolveVisibleParcelScope(params.scope);
  const hideCityRepeatDropoff = isRepeat && isHiddenCityParcelRequest(params.scope);
  const initialTiming = params.timing === 'later' ? 'later' : 'now';
  const initialScheduleDate = params.scheduleDate ? String(params.scheduleDate) : '';
  const initialScheduleTime = params.scheduleTime ? String(params.scheduleTime) : '';
  const repeatPickupLat = Number(params.pickupLat);
  const repeatPickupLng = Number(params.pickupLng);
  const hasRepeatPickup =
    isRepeat && Number.isFinite(repeatPickupLat) && Number.isFinite(repeatPickupLng) && Boolean(params.pickup?.trim());
  const repeatDropoffLat = Number(params.dropoffLat);
  const repeatDropoffLng = Number(params.dropoffLng);
  const hasRepeatDropoff =
    !hideCityRepeatDropoff &&
    isRepeat &&
    Number.isFinite(repeatDropoffLat) &&
    Number.isFinite(repeatDropoffLng) &&
    Boolean(params.dropoff?.trim());
  const mapRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [expressFlightListExpanded, setExpressFlightListExpanded] = useState(false);
  const [pricingRetryTick, setPricingRetryTick] = useState(0);
  const nativeMaps = useMemo(() => getNativeMaps(), []);
  const NativeMapView = nativeMaps.MapView;
  const Marker = nativeMaps.Marker;
  const MarkerAnimated = nativeMaps.MarkerAnimated;
  const AnimatedRegion = nativeMaps.AnimatedRegion;
  const Polyline = nativeMaps.Polyline;
  const mapProvider = nativeMaps.provider;
  const mapCanRender =
    nativeMaps.canRender && canRenderNativeGoogleMap() && Boolean(NativeMapView && Marker && Polyline);
  const pricingLookupIdRef = useRef(0);
  const suggestionLookupIdRef = useRef(0);
  const pickupSuggestionLookupIdRef = useRef(0);
  const dropoffSessionTokenRef = useRef(createSearchSessionToken());
  const pickupSessionTokenRef = useRef(createSearchSessionToken());
  const [liveDrivers, setLiveDrivers] = useState<DriverRecord[]>([]);
  const [selectedScope, setSelectedScope] = useState<ParcelScope>(initialScope);
  const [selectedPackage, setSelectedPackage] = useState<ParcelOption['key']>(
    (params.parcelType as ParcelOption['key']) ||
      (initialScope === 'outside' ? outsideParcelTypes[0].key : cityParcelTypes[0].key)
  );
  const [timing, setTiming] = useState<'now' | 'later'>(initialTiming);
  const cachedPickupLocation = hasRepeatPickup ? null : getCustomerLocationSnapshot();
  const [pickupLabel, setPickupLabel] = useState(
    hasRepeatPickup
      ? String(params.pickup)
      : cachedPickupLocation?.label?.trim() || copy.parcel.detecting
  );
  const [pickupInput, setPickupInput] = useState(
    hasRepeatPickup
      ? String(params.pickup)
      : cachedPickupLocation?.label?.trim() || copy.parcel.detecting
  );
  const [pickupPoint, setPickupPoint] = useState({
    latitude: hasRepeatPickup ? repeatPickupLat : cachedPickupLocation?.point?.latitude ?? defaultRegion.latitude,
    longitude: hasRepeatPickup ? repeatPickupLng : cachedPickupLocation?.point?.longitude ?? defaultRegion.longitude,
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
  const [scheduledDate, setScheduledDate] = useState(initialScheduleDate);
  const [scheduledTime, setScheduledTime] = useState(initialScheduleTime);
  const [parcelWeightKg, setParcelWeightKg] = useState(params.parcelWeightKg ? String(params.parcelWeightKg) : '');
  const [outsideSizePreset, setOutsideSizePreset] = useState<OutsideParcelSizePreset | null>(null);
  const [parcelLengthCm, setParcelLengthCm] = useState('');
  const [parcelWidthCm, setParcelWidthCm] = useState('');
  const [parcelHeightCm, setParcelHeightCm] = useState('');
  const [parcelPhotoUri, setParcelPhotoUri] = useState<string | null>(null);
  const [parcelPhotoUrl, setParcelPhotoUrl] = useState<string | null>(null);
  const [parcelPhotoUploading, setParcelPhotoUploading] = useState(false);
  const [parcelPhotoError, setParcelPhotoError] = useState<string | null>(null);
  const [declaredValueTzs, setDeclaredValueTzs] = useState(
    params.declaredValueTzs ? formatDeclaredValueInput(String(params.declaredValueTzs)) : ''
  );
  const [contentsLawAccepted, setContentsLawAccepted] = useState(params.contentsDeclarationAccepted === '1');
  const [legalTermsOpen, setLegalTermsOpen] = useState(false);
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
  const [outsideShippingMode, setOutsideShippingMode] = useState<OutsideShippingMode | null>(null);
  const [outsideWizardStep, setOutsideWizardStep] = useState<1 | 2 | 3>(1);
  const [outsideHandoffMode, setOutsideHandoffMode] = useState<OutsideHandoffMode | null>(null);
  const [outsideHomeAddressConfirmed, setOutsideHomeAddressConfirmed] = useState(false);
  const [homeAddressSheetOpen, setHomeAddressSheetOpen] = useState(false);
  const [homeAddressKeyboardHeight, setHomeAddressKeyboardHeight] = useState(0);
  const [outsideDestinationCities, setOutsideDestinationCities] = useState(() =>
    mergeTanzaniaBusRegions(defaultOutsideDestinationCities)
  );
  const [outsideExpressRoutes, setOutsideExpressRoutes] = useState<
    import('@/lib/outside-express-schedule').OutsideExpressRouteSchedule[]
  >([]);
  const [selectedExpressDeparture, setSelectedExpressDeparture] = useState<BookableExpressDeparture | null>(null);
  const [expressEnabledGlobally, setExpressEnabledGlobally] = useState(false);
  const [outsideRegionStatus, setOutsideRegionStatus] = useState<OutsideRegionStatus>(
    initialScope === 'outside' ? 'checking' : 'idle'
  );
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const nextTiming = String(params.timing || '').trim();
    const nextDate = params.scheduleDate ? String(params.scheduleDate) : '';
    const nextTime = params.scheduleTime ? String(params.scheduleTime) : '';
    if (nextTiming !== 'later' || !nextDate || !nextTime) {
      return;
    }
    setTiming('later');
    setScheduledDate(nextDate);
    setScheduledTime(nextTime);
  }, [params.scheduleDate, params.scheduleTime, params.timing]);

  useEffect(() => {
    const unsubscribe = subscribeOutsideParcelCatalog((catalog) => {
      setOutsideDestinationCities(catalog.cities);
      setExpressEnabledGlobally(catalog.expressEnabledGlobally);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOutsideExpressRoutesCatalog((catalog) => {
      setOutsideExpressRoutes(catalog.routes);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!CITY_PARCELS_ENABLED && selectedScope === 'city') {
      setSelectedScope('outside');
    }
  }, [selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'outside') {
      setOutsideRegionStatus('idle');
      return;
    }

    if (!isValidCoordinate(pickupPoint)) {
      setOutsideRegionStatus('checking');
      return;
    }

    setOutsideRegionStatus(
      isOutsideParcelServiceAvailableAt(pickupPoint, outsideDestinationCities) ? 'available' : 'out-of-reach'
    );
  }, [outsideDestinationCities, pickupPoint, selectedScope]);

  useEffect(() => {
    if (!isRepeat || params.scope !== 'outside') {
      return;
    }

    const cityLabel = String(params.outsideDestinationCity || '').trim();
    const matchedCity = outsideDestinationCities.find(
      (city) =>
        city.label.toLowerCase() === cityLabel.toLowerCase() ||
        city.key.toLowerCase() === cityLabel.toLowerCase()
    );
    if (matchedCity) {
      setSelectedOutsideCityKey(matchedCity.key);
    }

    const shippingMode = String(params.outsideShippingMode || '').trim();
    if (shippingMode === 'express' || shippingMode === 'standard') {
      setOutsideShippingMode(shippingMode);
    }

    const handoffMode = String(params.outsideHandoffMode || '').trim();
    if (handoffMode === 'bus' || handoffMode === 'airport' || handoffMode === 'home') {
      setOutsideHandoffMode(handoffMode);
    }

    if (matchedCity && handoffMode !== 'home') {
      const standLabel = String(params.outsideDestinationStand || params.outsideDestination || '').trim();
      const hubs = shippingMode === 'express' ? matchedCity.airports : matchedCity.stands;
      const matchedHub = hubs.find((hub) => hub.label.toLowerCase() === standLabel.toLowerCase());
      if (matchedHub) {
        setSelectedOutsideStandId(matchedHub.id);
      }
    }

    if (handoffMode === 'home' && hasRepeatDropoff) {
      setOutsideHomeAddressConfirmed(true);
    }
  }, [
    hasRepeatDropoff,
    isRepeat,
    outsideDestinationCities,
    params.scope,
    params.outsideDestinationCity,
    params.outsideShippingMode,
    params.outsideHandoffMode,
    params.outsideDestinationStand,
    params.outsideDestination,
  ]);

  useEffect(() => {
    if (!homeAddressSheetOpen) {
      setHomeAddressKeyboardHeight(0);
      return;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setHomeAddressKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setHomeAddressKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [homeAddressSheetOpen]);
  const validPickupPoint = isValidCoordinate(pickupPoint) ? pickupPoint : defaultRegion;
  const validDropoffPoint = isValidCoordinate(dropoffPoint) ? dropoffPoint : null;
  const validRouteCoordinates = useMemo(
    () => filterValidCoordinates(routeEstimate?.coordinates ?? []),
    [routeEstimate?.coordinates]
  );
  const nearbyLiveVehicles = useMemo(
    () =>
      buildNearbyLiveVehicles({
        drivers: liveDrivers,
        origin: validPickupPoint,
        selectedVehicleKey: 'bodaboda',
        allowedVehicleKeys: ['bodaboda', 'toyo', 'kirikuu'],
        radiusMeters: 12000,
        maxVisible: 10,
      }),
    [liveDrivers, validPickupPoint]
  );

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
    [outsideDestinationCities, selectedOutsideCityKey]
  );
  const outsideOriginCity = useMemo(() => {
    if (!pickupPoint) {
      return outsideDestinationCities.find((city) => city.key === 'dar-es-salaam') ?? null;
    }
    return getNearestOutsideCityFromList(pickupPoint, outsideDestinationCities) ?? null;
  }, [outsideDestinationCities, pickupPoint]);
  const outsideOriginCityKey = useMemo(
    () => resolveOutsideOriginCityKey(pickupPoint, outsideDestinationCities),
    [outsideDestinationCities, pickupPoint]
  );
  const eligibleOutsideDestinations = useMemo(
    () =>
      getOutsideEligibleDestinations({
        originCityKey: outsideOriginCityKey,
        shippingMode: outsideShippingMode,
        cities: outsideDestinationCities,
        expressEnabledGlobally,
      }),
    [expressEnabledGlobally, outsideDestinationCities, outsideOriginCityKey, outsideShippingMode]
  );
  const outsideExpressOriginAvailable = useMemo(
    () => hasOutsideExpressRoutesFromOrigin(outsideOriginCityKey, outsideDestinationCities, expressEnabledGlobally),
    [expressEnabledGlobally, outsideDestinationCities, outsideOriginCityKey]
  );
  const outsideStandardOriginAvailable = useMemo(
    () => hasOutsideStandardRoutesFromOrigin(outsideOriginCityKey, outsideDestinationCities),
    [outsideDestinationCities, outsideOriginCityKey]
  );
  const selectedExpressRouteSchedule = useMemo(() => {
    if (!selectedOutsideCity) {
      return null;
    }
    return findOutsideExpressRouteSchedule(
      outsideExpressRoutes,
      outsideOriginCityKey,
      selectedOutsideCity.key
    );
  }, [outsideExpressRoutes, outsideOriginCityKey, selectedOutsideCity]);
  const expressScheduleFirstMileMinutes = useMemo(
    () => resolveExpressFirstMileMinutes({ route: selectedExpressRouteSchedule ?? undefined }),
    [selectedExpressRouteSchedule]
  );
  const expressFirstMileMinutes = expressScheduleFirstMileMinutes;
  const expressCatalogSlots = useMemo(() => {
    if (!selectedExpressRouteSchedule) {
      return [];
    }
    return getBookableExpressDepartures({
      route: selectedExpressRouteSchedule,
      language,
      firstMileMinutes: expressScheduleFirstMileMinutes,
    });
  }, [expressScheduleFirstMileMinutes, language, selectedExpressRouteSchedule]);
  const expressFlightSlots = useMemo(() => {
    if (!selectedExpressRouteSchedule) {
      return [];
    }
    if (outsideShippingMode !== 'express') {
      return expressCatalogSlots;
    }
    return getBookableExpressDepartures({
      route: selectedExpressRouteSchedule,
      language,
      firstMileMinutes: expressFirstMileMinutes,
    });
  }, [expressCatalogSlots, expressFirstMileMinutes, language, outsideShippingMode, selectedExpressRouteSchedule]);
  const expressBookableSlots = useMemo(
    () => expressCatalogSlots.filter((slot) => slot.bookable),
    [expressCatalogSlots]
  );
  const expressOperationalBookableSlots = useMemo(
    () => expressFlightSlots.filter((slot) => slot.bookable),
    [expressFlightSlots]
  );
  const expressNextDayFallback = useMemo(() => {
    if (!selectedExpressRouteSchedule) {
      return null;
    }
    return pickExpressNextDayFallbackSlot(expressCatalogSlots);
  }, [expressCatalogSlots, selectedExpressRouteSchedule]);
  const outsideExpressQuoteLabel = useMemo(() => {
    if (!selectedOutsideCity) {
      return copy.parcel.expressFromPrice;
    }
    return formatTzs(
      getOutsideParcelFlatFare({
        destinationCityKey: selectedOutsideCity.key,
        destinationCity: selectedOutsideCity,
        shippingMode: 'express',
        handoffMode: 'airport',
        pickupPoint,
        pickupLabel,
      })
    );
  }, [copy.parcel.expressFromPrice, pickupLabel, pickupPoint, selectedOutsideCity]);
  const outsideStandardQuoteLabel = useMemo(() => {
    if (!selectedOutsideCity) {
      return copy.parcel.standardFromPrice;
    }
    return formatTzs(
      getOutsideParcelFlatFare({
        destinationCityKey: selectedOutsideCity.key,
        destinationCity: selectedOutsideCity,
        shippingMode: 'standard',
        handoffMode: 'bus',
        pickupPoint,
        pickupLabel,
      })
    );
  }, [copy.parcel.standardFromPrice, pickupLabel, pickupPoint, selectedOutsideCity]);
  const expressRouteScheduled = useMemo(
    () => hasScheduledExpressDepartures({ route: selectedExpressRouteSchedule, language }),
    [language, selectedExpressRouteSchedule]
  );
  const outsideExpressAvailable =
    outsideExpressOriginAvailable &&
    isOutsideExpressAvailable({
      city: selectedOutsideCity,
      expressEnabledGlobally,
    }) &&
    (!selectedOutsideCity ||
      (isOutsideRouteAllowed({
        originCityKey: outsideOriginCityKey,
        destinationCityKey: selectedOutsideCity.key,
        shippingMode: 'express',
      }) &&
        Boolean(selectedExpressRouteSchedule) &&
        expressRouteScheduled));
  const outsideExpressModeSelectable =
    expressEnabledGlobally && (outsideExpressAvailable || Boolean(expressRouteScheduled));
  const expressFlightReady =
    outsideShippingMode !== 'express' ||
    Boolean(
      selectedExpressDeparture &&
        expressOperationalBookableSlots.some((slot) => slot.departureId === selectedExpressDeparture.departureId)
    );
  const outsideHomeDeliveryAvailable = isOutsideHomeDeliveryAvailable(selectedOutsideCity);
  const outsideExpressHomeDeliveryMandatory = useMemo(
    () =>
      Boolean(
        selectedOutsideCity &&
          outsideShippingMode === 'express' &&
          isOutsideExpressHomeDeliveryMandatory({
            originCityKey: outsideOriginCityKey,
            destinationCityKey: selectedOutsideCity.key,
            shippingMode: 'express',
          })
      ),
    [outsideOriginCityKey, outsideShippingMode, selectedOutsideCity]
  );
  const selectedOutsideHub = useMemo(() => {
    if (!selectedOutsideCity || !selectedOutsideStandId) {
      return null;
    }
    if (outsideShippingMode === 'express') {
      return selectedOutsideCity.airports.find((hub) => hub.id === selectedOutsideStandId) ?? null;
    }
    return selectedOutsideCity.stands.find((stand) => stand.id === selectedOutsideStandId) ?? null;
  }, [outsideShippingMode, selectedOutsideCity, selectedOutsideStandId]);
  const expressAirportHandoffAutoReady =
    outsideShippingMode === 'express' &&
    !outsideExpressHomeDeliveryMandatory &&
    outsideHandoffMode === 'airport' &&
    Boolean(selectedOutsideHub);
  const outsideExpressNearAirportPricing = useMemo(
    () =>
      outsideExpressHomeDeliveryMandatory &&
      isOutsideHomeNearDestinationAirport({
        dropoffPoint,
        destinationCity: selectedOutsideCity,
      }),
    [dropoffPoint, outsideExpressHomeDeliveryMandatory, selectedOutsideCity]
  );
  const outsideExpressEtaHint = useMemo(() => {
    if (selectedExpressDeparture && selectedExpressRouteSchedule) {
      const pickupHours = Math.max(1, Math.ceil(selectedExpressDeparture.pickupWindowMinutes / 60));
      const base = formatExpressFlightEtaLabel({
        departureAtMs: selectedExpressDeparture.departureAtMs,
        arrivalOffsetMinutes: selectedExpressRouteSchedule.arrivalOffsetMinutes ?? 30,
        language,
      });
      return language === 'sw'
        ? `${base} · dirisha la kuchukua & airport: masaa ${pickupHours}`
        : `${base} · pickup & airport window: ${pickupHours} hr`;
    }

    if (!selectedOutsideCity) {
      return copy.parcel.expressSubtitle;
    }

    return formatOutsideParcelEtaLabel({
      originCityKey: outsideOriginCityKey,
      destinationCityKey: selectedOutsideCity.key,
      shippingMode: 'express',
      language,
    });
  }, [
    selectedExpressRouteSchedule,
    copy.parcel.expressSubtitle,
    language,
    outsideOriginCityKey,
    selectedExpressDeparture,
    selectedOutsideCity,
  ]);
  const outsideBusEtaHint =
    language === 'sw' ? 'Masaa 24 baada ya kuchukuliwa · hadi kg 50' : '24 hrs after pickup · max 50 kg';

  useEffect(() => {
    if (expressEnabledGlobally) {
      return;
    }
    if (outsideShippingMode !== 'express') {
      return;
    }
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setSelectedExpressDeparture(null);
    setOutsideHomeAddressConfirmed(false);
    clearRouteEstimateState();
  }, [expressEnabledGlobally, outsideShippingMode]);

  useEffect(() => {
    if (outsideShippingMode !== 'express' || outsideExpressAvailable) {
      return;
    }
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setOutsideHomeAddressConfirmed(false);
    clearRouteEstimateState();
  }, [outsideExpressAvailable, outsideShippingMode]);

  useEffect(() => {
    if (outsideShippingMode !== 'express' || !selectedOutsideCity) {
      return;
    }
    if (expressRouteScheduled) {
      return;
    }
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setSelectedExpressDeparture(null);
    setOutsideHomeAddressConfirmed(false);
    clearRouteEstimateState();
  }, [expressBookableSlots.length, expressRouteScheduled, outsideShippingMode, selectedOutsideCity]);

  useEffect(() => {
    if (!selectedExpressDeparture || outsideShippingMode !== 'express') {
      return;
    }
    const stillValid = expressOperationalBookableSlots.some(
      (slot) => slot.departureId === selectedExpressDeparture.departureId
    );
    if (!stillValid) {
      setSelectedExpressDeparture(null);
    }
  }, [expressOperationalBookableSlots, outsideShippingMode, selectedExpressDeparture]);

  useEffect(() => {
    if (outsideShippingMode !== 'express' || selectedExpressDeparture || expressOperationalBookableSlots.length === 0) {
      return;
    }
    setSelectedExpressDeparture(expressOperationalBookableSlots[0]);
  }, [expressOperationalBookableSlots, outsideShippingMode, selectedExpressDeparture]);

  useEffect(() => {
    if (outsideShippingMode !== 'express' || timing === 'now') {
      return;
    }
    setTiming('now');
    setScheduledDate('');
    setScheduledTime('');
  }, [outsideShippingMode, timing]);

  useEffect(() => {
    if (!selectedOutsideCityKey) {
      return;
    }
    if (outsideDestinationCities.some((city) => city.key === selectedOutsideCityKey)) {
      return;
    }
    setSelectedOutsideCityKey(null);
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setOutsideHomeAddressConfirmed(false);
  }, [outsideDestinationCities, selectedOutsideCityKey]);

  useEffect(() => {
    if (selectedScope !== 'outside' || !selectedOutsideCityKey) {
      return;
    }
    if (outsideDestinationCities.some((city) => city.key === selectedOutsideCityKey)) {
      return;
    }
    setSelectedOutsideCityKey(null);
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setOutsideHomeAddressConfirmed(false);
    clearRouteEstimateState();
  }, [outsideDestinationCities, selectedOutsideCityKey, selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'outside' || !selectedOutsideCityKey || !outsideShippingMode) {
      return;
    }
    if (
      isOutsideRouteAllowed({
        originCityKey: outsideOriginCityKey,
        destinationCityKey: selectedOutsideCityKey,
        shippingMode: outsideShippingMode,
      })
    ) {
      return;
    }
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setOutsideHomeAddressConfirmed(false);
    clearRouteEstimateState();
  }, [outsideOriginCityKey, outsideShippingMode, selectedOutsideCityKey, selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'outside' || !selectedOutsideCity || !outsideShippingMode) {
      return;
    }
    if (outsideHandoffMode === 'home') {
      return;
    }
    const hubs = outsideShippingMode === 'express' ? selectedOutsideCity.airports : selectedOutsideCity.stands;
    if (selectedOutsideStandId && hubs.some((hub) => hub.id === selectedOutsideStandId)) {
      return;
    }
    const defaultHub = getDefaultDestinationHub(selectedOutsideCity, outsideShippingMode);
    if (!defaultHub) {
      return;
    }
    setOutsideHandoffMode(outsideShippingMode === 'express' ? 'airport' : 'bus');
    setSelectedOutsideStandId(defaultHub.id);
    setDropoff(`${defaultHub.label}, ${selectedOutsideCity.label}`);
    setDropoffPoint(defaultHub.fallbackPoint);
    setOutsideHomeAddressConfirmed(false);
    setShouldFetchSuggestions(false);
  }, [
    outsideHandoffMode,
    outsideShippingMode,
    selectedOutsideCity,
    selectedOutsideStandId,
    selectedScope,
  ]);

  const recipientPhoneDigits = recipientPhone.replace(/\D/g, '');
  const scheduleReady = timing === 'now' || (scheduledDate.trim().length > 0 && scheduledTime.trim().length > 0);
  const parsedParcelWeightKg = Number(parcelWeightKg.trim());
  const outsideWeightReady =
    selectedScope === 'city' || isOutsideWeightValid(parsedParcelWeightKg, outsideShippingMode);
  const outsideWeightTooHeavy =
    selectedScope === 'outside' &&
    Number.isFinite(parsedParcelWeightKg) &&
    parsedParcelWeightKg > 0 &&
    !isOutsideWeightValid(parsedParcelWeightKg, outsideShippingMode);
  const declaredValueDigits = parseDeclaredValueDigits(declaredValueTzs);
  const declaredValueReady = declaredValueDigits.length > 0;
  const outsideHomeAddressReady =
    outsideHandoffMode !== 'home' || (outsideHomeAddressConfirmed && Boolean(dropoffPoint) && dropoff.trim().length >= 3);
  const outsideDestinationReady =
    Boolean(selectedOutsideCity) &&
    Boolean(outsideShippingMode) &&
    expressFlightReady &&
    Boolean(outsideHandoffMode) &&
    outsideHomeAddressReady &&
    (outsideHandoffMode === 'home' || Boolean(selectedOutsideHub));
  const showExpressHandoffStep =
    Boolean(selectedOutsideCity) &&
    outsideShippingMode === 'express' &&
    expressFlightReady &&
    !expressAirportHandoffAutoReady &&
    (outsideExpressHomeDeliveryMandatory || outsideHomeDeliveryAvailable);
  const showOutsideWeightPanel =
    selectedScope === 'outside' &&
    Boolean(selectedOutsideCity) &&
    Boolean(outsideShippingMode) &&
    (outsideShippingMode === 'standard'
      ? outsideDestinationReady
      : expressFlightReady &&
        (outsideExpressHomeDeliveryMandatory || outsideHandoffMode === 'home'
          ? outsideHomeAddressReady
          : Boolean(selectedOutsideHub)));
  const destinationReady = selectedScope === 'city' ? Boolean(dropoffPoint) : outsideDestinationReady;
  const outsideProgressStep = useMemo(
    () =>
      resolveOutsideParcelProgressStep({
        hasCity: Boolean(selectedOutsideCity),
        hasMode: Boolean(outsideShippingMode),
        expressFlow: outsideShippingMode === 'express',
        expressFlightReady,
        weightReady: outsideWeightReady,
        recipientReady: recipientName.trim().length >= 2 && recipientPhoneDigits.length >= 9,
      }),
    [
      expressFlightReady,
      outsideShippingMode,
      outsideWeightReady,
      recipientName,
      recipientPhoneDigits.length,
      selectedOutsideCity,
    ]
  );
  const outsideStickySummary = useMemo(() => {
    if (selectedScope !== 'outside' || !selectedOutsideCity) {
      return '';
    }
    const routeLabel = `${outsideOriginCity?.label ?? 'Origin'} → ${selectedOutsideCity.label}`;
    const modeLabel =
      outsideShippingMode === 'express'
        ? selectedExpressDeparture
          ? `${selectedExpressDeparture.dayLabel} ${selectedExpressDeparture.timeLabel}`
          : language === 'sw'
            ? 'Ndege'
            : 'Flight'
        : outsideShippingMode === 'standard'
          ? isZanzibarSeaDestination(selectedOutsideCity)
            ? 'Ferry'
            : language === 'sw'
              ? 'Basi'
              : 'Bus'
          : '';
    const weightLabel = parcelWeightKg.trim() ? `${parcelWeightKg.trim()} kg` : '';
    return [routeLabel, modeLabel, weightLabel].filter(Boolean).join(' · ');
  }, [
    language,
    outsideOriginCity?.label,
    outsideShippingMode,
    parcelWeightKg,
    selectedExpressDeparture,
    selectedOutsideCity,
    selectedScope,
  ]);
  const networkDegradedVisible =
    pricingError ||
    locationNotice === 'offline' ||
    /503|service you requested is not available/i.test(pricingErrorMessage || '');
  const scrollToWeightPanel = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);
  };
  const outsideMaxWeightKg = getOutsideMaxWeightKg(outsideShippingMode);
  const outsideHomeAddressHint = useMemo(
    () =>
      (copy.parcel.homeAddressHint || 'Exact delivery address in {city}').replace(
        '{city}',
        selectedOutsideCity?.label ?? ''
      ),
    [copy.parcel.homeAddressHint, selectedOutsideCity?.label]
  );
  const parcelVehicleType = useMemo(
    () => getParcelVehicleType(selectedScope, activePackage.key),
    [activePackage.key, selectedScope]
  );
  const activeVehicleOption = useMemo(
    () => getParcelVehicleOption(parcelVehicleType),
    [parcelVehicleType]
  );
  const routePricingReady =
    selectedScope === 'outside' ||
    (Boolean(routeEstimate) &&
      Boolean(pricingEstimate) &&
      typeof routeDistanceKm === 'number' &&
      typeof routeDurationSeconds === 'number' &&
      !pricingLoading &&
      !pricingError &&
      !pickupNeedsSelection);
  const outsideSizeReady = selectedScope === 'city' || Boolean(outsideSizePreset);
  const outsidePhotoReady =
    selectedScope !== 'outside' ||
    (Boolean(parcelPhotoUri) && !parcelPhotoUploading && (Boolean(parcelPhotoUrl) || !user?.uid));
  const legalReady = selectedScope === 'outside' || contentsLawAccepted;
  const isFormValid =
    destinationReady &&
    recipientName.trim().length >= 2 &&
    recipientPhoneDigits.length >= 9 &&
    scheduleReady &&
    outsideWeightReady &&
    outsideSizeReady &&
    outsidePhotoReady &&
    declaredValueReady &&
    legalReady &&
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
        ? outsideShippingMode === 'express' && !expressFlightReady
          ? language === 'sw'
            ? expressBookableSlots.length === 0
              ? 'Hakuna ndege zilizobaki kwa ratiba hii. Chagua basi au jaribu tena baadaye.'
              : selectedExpressRouteSchedule &&
                  isDarZanzibarExpressRouteSchedule(selectedExpressRouteSchedule)
                ? 'Chagua ndege iliyo na muda wa kutosha wa kuchukua mzigo na kuupeleka uwanjani.'
                : 'Chagua ndege iliyo wazi — tunachukua oda hadi saa 1 kabla ya ndege kuondoka.'
            : expressBookableSlots.length === 0
              ? 'No flights remain on this schedule. Choose bus or try again later.'
              : selectedExpressRouteSchedule &&
                  isDarZanzibarExpressRouteSchedule(selectedExpressRouteSchedule)
                ? 'Choose a flight with enough time to collect your parcel and deliver it to the airport.'
                : 'Choose an open flight — we take orders up to 1 hour before departure.'
          : outsideHandoffMode === 'home' && !outsideHomeAddressReady
          ? 'Enter the exact home delivery address in the selected region.'
          : 'Choose the city, Express or Bus, and where the recipient collects.'
        : 'Enter and select the delivery destination.';
    }

    if (!outsideWeightReady) {
      if (outsideWeightTooHeavy) {
        return outsideShippingMode === 'express'
          ? copy.parcel.weightTooHeavyExpress
          : copy.parcel.weightTooHeavyStandard;
      }
      return 'Enter the parcel weight in kilograms for other-region delivery.';
    }

    if (recipientName.trim().length < 2) {
      return 'Enter the recipient name.';
    }

    if (recipientPhoneDigits.length < 9) {
      return 'Enter a valid recipient phone number.';
    }

    if (!declaredValueReady) {
      return copy.parcel.nextDeclaredValue;
    }

    if (!outsideSizeReady) {
      return language === 'sw' ? 'Chagua ukubwa' : 'Choose a size';
    }

    if (!outsidePhotoReady) {
      if (parcelPhotoUploading) {
        return language === 'sw' ? 'Inapakia picha ya mzigo…' : 'Uploading cargo photo…';
      }
      if (parcelPhotoUri && user?.uid && !parcelPhotoUrl) {
        return language === 'sw' ? 'Picha haijapakiwa. Jaribu tena.' : 'Photo did not upload. Try again.';
      }
      return language === 'sw' ? 'Weka picha ya mzigo.' : 'Add a photo of the cargo.';
    }

    if (!legalReady) {
      return copy.parcel.nextLegalAccept;
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
    declaredValueReady,
    legalReady,
    outsidePhotoReady,
    outsideSizeReady,
    parcelPhotoUploading,
    parcelPhotoUri,
    parcelPhotoUrl,
    user?.uid,
    language,
    copy.parcel.nextDeclaredValue,
    copy.parcel.nextLegalAccept,
    routePricingReady,
    scheduleReady,
    selectedScope,
  ]);
  const pricing = useMemo(
    () =>
      buildParcelPricing({
        scope: selectedScope,
        pickupPoint,
        pickupLabel,
        dropoffLabel: dropoff,
        routeEstimate,
        pricingEstimate,
        pricingPending: pricingLoading,
        pricingError,
        outsideDestinationCity: selectedOutsideCity,
        outsideOriginCity,
        outsideOriginCityKey,
        shippingMode: outsideShippingMode,
        vehicleLabel: activeVehicleOption.title,
        language,
      }),
    [
      activeVehicleOption.title,
      dropoff,
      language,
      outsideOriginCity,
      outsideOriginCityKey,
      outsideShippingMode,
      pickupLabel,
      pickupPoint,
      pricingError,
      pricingEstimate,
      pricingLoading,
      routeEstimate,
      selectedOutsideCity,
      selectedScope,
    ]
  );
  const price = pricing.priceLabel;
  const eta = timing === 'later' ? 'Scheduled by your selected time' : pricing.etaLabel;
  const scheduleBannerLabel =
    timing === 'later' && scheduledDate && scheduledTime
      ? formatScheduleSummary(scheduledDate, scheduledTime, language)
      : '';

  const showRecipientStep = destinationReady && outsideWeightReady;
  const homeAddressRequiredForStep2 =
    outsideHandoffMode === 'home' || outsideExpressHomeDeliveryMandatory;
  const canLeaveOutsideStep1 =
    Boolean(selectedOutsideCity && outsideShippingMode) &&
    (outsideShippingMode === 'express' ? expressFlightReady : Boolean(selectedOutsideStandId));
  const canLeaveOutsideStep2 =
    recipientName.trim().length >= 2 &&
    recipientPhoneDigits.length >= 9 &&
    (!homeAddressRequiredForStep2 || outsideHomeAddressReady);

  const handleClearOutsideCity = () => {
    setSelectedOutsideCityKey(null);
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setOutsideHomeAddressConfirmed(false);
    setSelectedOutsideStandId(null);
    setSelectedExpressDeparture(null);
    setDropoff('');
    setDropoffPoint(null);
    setParcelWeightKg('');
    setOutsideSizePreset(null);
    setParcelLengthCm('');
    setParcelWidthCm('');
    setParcelHeightCm('');
    setParcelPhotoUri(null);
    setParcelPhotoUrl(null);
    setParcelPhotoUploading(false);
    setParcelPhotoError(null);
    clearParcelPhotoDraft();
    clearRouteEstimateState();
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    setShowMapPicker(false);
  };

  const handleOutsideWizardBack = () => {
    if (outsideWizardStep > 1) {
      setOutsideWizardStep(outsideWizardStep === 3 ? 2 : 1);
      return;
    }
    if (selectedOutsideCityKey) {
      handleClearOutsideCity();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  };

  const handleOutsideWizardContinue = () => {
    if (outsideWizardStep === 1) {
      if (canLeaveOutsideStep1) {
        setOutsideWizardStep(2);
      }
      return;
    }
    if (outsideWizardStep === 2) {
      if (canLeaveOutsideStep2) {
        setOutsideWizardStep(3);
      }
      return;
    }
    if (parcelPhotoUri && user?.uid && !parcelPhotoUrl && !parcelPhotoUploading) {
      void commitParcelPhoto(parcelPhotoUri).then(() => {
        if (getParcelPhotoDraft()?.downloadURL) {
          void handleReviewOrder();
        }
      });
      return;
    }
    handleReviewOrder();
  };

  const outsideWizardContinueEnabled =
    outsideWizardStep === 1 ? canLeaveOutsideStep1 : outsideWizardStep === 2 ? canLeaveOutsideStep2 : isFormValid;
  const outsideExpressFareLabel = formatTzs(
    getOutsideParcelFlatFare({
      destinationCityKey: selectedOutsideCity?.key,
      destinationCity: selectedOutsideCity,
      shippingMode: 'express',
      handoffMode: outsideHandoffMode,
      pickupPoint,
      pickupLabel,
      dropoffPoint: outsideHandoffMode === 'home' ? dropoffPoint : undefined,
      expressHomeDeliveryMandatory: outsideExpressHomeDeliveryMandatory,
    })
  );
  const outsideWizardContinueLabel =
    outsideWizardStep === 3
      ? outsideShippingMode === 'express'
        ? language === 'sw'
          ? `Thibitisha · ${outsideExpressFareLabel}`
          : `Confirm · ${outsideExpressFareLabel}`
        : language === 'sw'
          ? 'Tuma ombi'
          : 'Send request'
      : language === 'sw'
        ? 'Endelea'
        : 'Continue';

  const outsideSizeOptions = useMemo(() => {
    const maxKg = getOutsideMaxWeightKg(outsideShippingMode);
    const labels =
      language === 'sw'
        ? {
            ndogo: { title: 'Ndogo', subtitle: 'Hadi 5 kg' },
            wastani: { title: 'Wastani', subtitle: '5–20 kg' },
            kubwa: { title: 'Kubwa', subtitle: '20–50 kg' },
            kubwa_sana: { title: 'Kubwa sana', subtitle: '50–150 kg' },
          }
        : {
            ndogo: { title: 'Small', subtitle: 'Up to 5 kg' },
            wastani: { title: 'Medium', subtitle: '5–20 kg' },
            kubwa: { title: 'Large', subtitle: '20–50 kg' },
            kubwa_sana: { title: 'Extra large', subtitle: '50–150 kg' },
          };
    return (Object.keys(outsideSizePresets) as OutsideParcelSizePreset[]).map((key) => {
      const preset = outsideSizePresets[key];
      return {
        key,
        title: labels[key].title,
        subtitle: labels[key].subtitle,
        disabled: Number(preset.weightKg) > maxKg,
      };
    });
  }, [language, outsideShippingMode]);

  const volumetricKg = useMemo(() => {
    const length = Number(parcelLengthCm);
    const width = Number(parcelWidthCm);
    const height = Number(parcelHeightCm);
    if (![length, width, height].every((value) => Number.isFinite(value) && value > 0)) {
      return null;
    }
    return Math.round(((length * width * height) / 5000) * 10) / 10;
  }, [parcelHeightCm, parcelLengthCm, parcelWidthCm]);

  const volumetricHint =
    volumetricKg && volumetricKg > 0
      ? language === 'sw'
        ? `Kadirio kutoka vipimo ulivyoweka: ${volumetricKg} kg (si kutoka picha).`
        : `Estimate from the size you entered: ${volumetricKg} kg (not from the photo).`
      : null;

  const handleSelectOutsideSize = (key: OutsideParcelSizePreset) => {
    const preset = outsideSizePresets[key];
    if (Number(preset.weightKg) > getOutsideMaxWeightKg(outsideShippingMode)) {
      return;
    }
    setOutsideSizePreset(key);
    setSelectedPackage(preset.packageKey);
    setParcelWeightKg(preset.weightKg);
    setParcelLengthCm(preset.lengthCm);
    setParcelWidthCm(preset.widthCm);
    setParcelHeightCm(preset.heightCm);
  };

  const commitParcelPhoto = async (localUri: string) => {
    const uri = String(localUri || '').trim();
    if (!uri) return;
    setParcelPhotoUri(uri);
    setParcelPhotoUrl(null);
    setParcelPhotoError(null);
    setParcelPhotoDraft({ localUri: uri });
    if (!user?.uid) {
      return;
    }
    setParcelPhotoUploading(true);
    try {
      const uploaded = await uploadParcelCargoPhoto({
        userId: user.uid,
        localUri: uri,
        orderKey: `outside-${Date.now()}`,
      });
      if (!uploaded.downloadURL?.startsWith('http')) {
        throw new Error(language === 'sw' ? 'Picha haikupakia. Jaribu tena.' : 'Photo did not upload. Try again.');
      }
      setParcelPhotoUrl(uploaded.downloadURL);
      patchParcelPhotoDraft({ downloadURL: uploaded.downloadURL });
      setParcelPhotoError(null);
    } catch (error) {
      setParcelPhotoUrl(null);
      setParcelPhotoError(
        error instanceof Error
          ? error.message
          : language === 'sw'
            ? 'Imeshindikana kupakia picha. Jaribu tena.'
            : 'Could not upload the photo. Try again.'
      );
    } finally {
      setParcelPhotoUploading(false);
    }
  };

  const parcelUploadProbeRef = useRef(false);
  useEffect(() => {
    if (outsideWizardStep !== 3 || selectedScope !== 'outside' || !user?.uid) return;
    if (parcelUploadProbeRef.current) return;
    parcelUploadProbeRef.current = true;
    void proveParcelPhotoUploadApi(user.uid)
      .then((result) => {
        console.log('[DoorDrop][ParcelPhoto] upload-api-ok', result.downloadURL?.slice(0, 80));
      })
      .catch((error) => {
        console.warn(
          '[DoorDrop][ParcelPhoto] upload-api-failed',
          error instanceof Error ? error.message : String(error)
        );
        setParcelPhotoError(
          language === 'sw'
            ? `Upakiaji wa picha hauko tayari: ${error instanceof Error ? error.message : 'hitilafu'}`
            : `Photo upload is not ready: ${error instanceof Error ? error.message : 'error'}`
        );
      });
  }, [language, outsideWizardStep, selectedScope, user?.uid]);

  const handleCaptureParcelPhoto = async () => {
    try {
      setParcelPhotoError(null);
      const photo = await pickOrderImageFromCamera();
      if (photo?.uri) {
        await commitParcelPhoto(photo.uri);
      }
    } catch (error) {
      setParcelPhotoError(error instanceof Error ? error.message : language === 'sw' ? 'Kamera imeshindikana.' : 'Camera failed.');
    }
  };

  const handlePickParcelLibrary = async () => {
    try {
      setParcelPhotoError(null);
      const photos = await pickOrderImageFromLibrary({ selectionLimit: 1 });
      if (photos[0]?.uri) {
        await commitParcelPhoto(photos[0].uri);
      }
    } catch (error) {
      setParcelPhotoError(error instanceof Error ? error.message : language === 'sw' ? 'Gallery imeshindikana.' : 'Gallery failed.');
    }
  };

  const handleApplyVolumetricWeight = () => {
    if (!volumetricKg || volumetricKg <= 0) {
      return;
    }
    const maxKg = getOutsideMaxWeightKg(outsideShippingMode);
    const nextWeight = Math.min(volumetricKg, maxKg);
    setParcelWeightKg(String(nextWeight));
    setOutsideSizePreset(null);
  };
  const footerLabel = useMemo(() => {
    if (pickupNeedsSelection) {
      return copy.parcel.nextPickup;
    }
    if (selectedScope === 'outside' && !selectedOutsideCity) {
      return copy.parcel.nextCity;
    }
    if (selectedScope === 'outside' && !outsideShippingMode) {
      return copy.parcel.nextMode;
    }
    if (selectedScope === 'outside' && !outsideHandoffMode) {
      return copy.parcel.nextHandoff;
    }
    if (selectedScope === 'outside' && outsideHandoffMode === 'home' && !outsideHomeAddressReady) {
      return copy.parcel.nextHomeAddress;
    }
    if (selectedScope === 'outside' && outsideHandoffMode !== 'home' && !selectedOutsideHub) {
      return outsideShippingMode === 'express' ? copy.parcel.nextHandoff : copy.parcel.nextStand;
    }
    if (!destinationReady) {
      return copy.parcel.nextDropoff;
    }
    if (!outsideWeightReady) {
      return outsideWeightTooHeavy
        ? outsideShippingMode === 'express'
          ? copy.parcel.weightTooHeavyExpress
          : copy.parcel.weightTooHeavyStandard
        : copy.parcel.nextWeight;
    }
    if (recipientName.trim().length < 2 || recipientPhoneDigits.length < 9) {
      return copy.parcel.nextRecipient;
    }
    if (!declaredValueReady) {
      return copy.parcel.nextDeclaredValue;
    }
    if (!outsideSizeReady) {
      return language === 'sw' ? 'Chagua ukubwa' : 'Choose a size';
    }
    if (!outsidePhotoReady) {
      if (parcelPhotoUploading) {
        return language === 'sw' ? 'Inapakia picha ya mzigo…' : 'Uploading cargo photo…';
      }
      if (parcelPhotoUri && user?.uid && !parcelPhotoUrl) {
        return language === 'sw' ? 'Picha haijapakiwa. Jaribu tena.' : 'Photo did not upload. Try again.';
      }
      return language === 'sw' ? 'Weka picha ya mzigo.' : 'Add a photo of the cargo.';
    }
    if (!legalReady) {
      return copy.parcel.nextLegalAccept;
    }
    if (!routePricingReady) {
      return copy.parcel.calculating;
    }
    if (selectedScope === 'outside' && outsideShippingMode !== 'express') {
      return language === 'sw' ? 'Tuma ombi' : 'Send request';
    }
    return `${copy.common.continue} · ${price}`;
  }, [
    copy.common.continue,
    copy.parcel.calculating,
    copy.parcel.nextCity,
    copy.parcel.nextDropoff,
    copy.parcel.nextHandoff,
    copy.parcel.nextHomeAddress,
    copy.parcel.nextMode,
    copy.parcel.nextPickup,
    copy.parcel.nextRecipient,
    copy.parcel.nextDeclaredValue,
    copy.parcel.nextLegalAccept,
    copy.parcel.nextStand,
    copy.parcel.nextWeight,
    copy.parcel.weightTooHeavyExpress,
    copy.parcel.weightTooHeavyStandard,
    destinationReady,
    outsideHandoffMode,
    outsideHomeAddressReady,
    outsideShippingMode,
    outsideWeightReady,
    outsideWeightTooHeavy,
    pickupNeedsSelection,
    price,
    recipientName,
    recipientPhoneDigits.length,
    declaredValueReady,
    legalReady,
    outsidePhotoReady,
    outsideSizeReady,
    parcelPhotoUploading,
    parcelPhotoUri,
    parcelPhotoUrl,
    user?.uid,
    language,
    routePricingReady,
    selectedOutsideCity,
    selectedOutsideHub,
    selectedScope,
  ]);
  const routeDistanceLabel = typeof routeDistanceKm === 'number' ? formatDistance(routeDistanceKm * 1000) : '';
  const routeDurationLabel = typeof routeDurationSeconds === 'number' ? formatDuration(routeDurationSeconds) : '';
  const pricingNoticeMessage = pricingEstimate?.warning ?? routeEstimate?.pricingEstimate?.warning ?? '';

  useEffect(() => {
    void getSavedPlaces().then(setSavedPlaces);
  }, []);

  const handleReviewOrder = async () => {
    if (!isFormValid) {
      Alert.alert(copy.parcel.completeTitle, reviewBlockerMessage || copy.parcel.completeTitle);
      return;
    }

    const readablePickup = await ensureReadablePlaceLabel(pickupPoint, pickupLabel);
    const readableDropoff = dropoffPoint
      ? await ensureReadablePlaceLabel(dropoffPoint, dropoff.trim())
      : dropoff.trim();

    if (readablePickup !== pickupLabel) {
      setPickupLabel(readablePickup);
      setPickupInput(readablePickup);
    }
    if (readableDropoff && readableDropoff !== dropoff.trim()) {
      setDropoff(readableDropoff);
    }

    router.push({
      pathname: '/order-review',
      params: {
        flow: 'parcel',
        scope: selectedScope,
        parcelType: activePackage.key,
        parcelLabel:
          selectedScope === 'outside'
            ? outsideShippingMode === 'express'
              ? `${copy.parcel.expressTitle} · ${
                  outsideHandoffMode === 'home' ? copy.parcel.homeDelivery : copy.parcel.airportHub
                }`
              : `${isZanzibarSeaDestination(selectedOutsideCity) ? 'Ferry' : copy.parcel.standardTitle} · ${
                  outsideHandoffMode === 'home' ? copy.parcel.homeDelivery : copy.parcel.busStand
                }`
            : activePackage.title,
        price:
          selectedScope === 'outside'
            ? outsideShippingMode === 'express'
              ? outsideExpressFareLabel
              : language === 'sw'
                ? 'Bei baada ya kampuni'
                : 'Price after the company'
            : price,
        outsideParcelSize: selectedScope === 'outside' ? outsideSizePreset ?? '' : '',
        parcelPhotoUri: selectedScope === 'outside' ? parcelPhotoUri ?? '' : '',
        parcelPhotoUrl: selectedScope === 'outside' ? parcelPhotoUrl ?? getParcelPhotoDraft()?.downloadURL ?? '' : '',
        eta,
        pricingRoute: pricing.routeLabel,
        timing,
        pickup: readablePickup,
        pickupLat: String(pickupPoint.latitude),
        pickupLng: String(pickupPoint.longitude),
        dropoff: readableDropoff,
        dropoffLat: dropoffPoint ? String(dropoffPoint.latitude) : '',
        dropoffLng: dropoffPoint ? String(dropoffPoint.longitude) : '',
        driverDropoff: selectedScope === 'outside' ? doordropAdminHandoffLocation.label : '',
        driverDropoffLat: selectedScope === 'outside' ? String(doordropAdminHandoffLocation.latitude) : '',
        driverDropoffLng: selectedScope === 'outside' ? String(doordropAdminHandoffLocation.longitude) : '',
        outsideDestinationCity: selectedOutsideCity?.label ?? '',
        outsideDestinationStand:
          outsideHandoffMode === 'home'
            ? copy.parcel.homeDelivery
            : selectedOutsideHub?.label ?? '',
        outsideDestination: selectedScope === 'outside' ? readableDropoff : '',
        outsideDestinationLat: selectedScope === 'outside' && dropoffPoint ? String(dropoffPoint.latitude) : '',
        outsideDestinationLng: selectedScope === 'outside' && dropoffPoint ? String(dropoffPoint.longitude) : '',
        outsideShippingMode: selectedScope === 'outside' ? outsideShippingMode ?? '' : '',
        outsideHandoffMode: selectedScope === 'outside' ? outsideHandoffMode ?? '' : '',
        distance: routeDistanceLabel,
        duration: routeDurationLabel,
        distanceMeters: typeof routeDistanceKm === 'number' ? String(Math.round(routeDistanceKm * 1000)) : '',
        durationSeconds: typeof routeDurationSeconds === 'number' ? String(Math.round(routeDurationSeconds)) : '',
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        notifyRecipient: '0',
        parcelWeightKg: selectedScope === 'outside' ? parcelWeightKg.trim() : '',
        declaredValueTzs: declaredValueDigits,
        contentsDeclarationAccepted: selectedScope === 'outside' || contentsLawAccepted ? '1' : '0',
        scheduleDate: scheduledDate.trim(),
        scheduleTime: scheduledTime.trim(),
        outsideExpressRouteId: selectedExpressDeparture?.routeId ?? '',
        outsideExpressDepartureId: selectedExpressDeparture?.departureId ?? '',
        outsideExpressDepartureAtMs: selectedExpressDeparture
          ? String(selectedExpressDeparture.departureAtMs)
          : '',
        outsideExpressDepartureLabel: selectedExpressDeparture
          ? `${selectedExpressDeparture.dayLabel} ${selectedExpressDeparture.timeLabel}`
          : '',
        outsideExpressBookingCutoffAtMs: selectedExpressDeparture
          ? String(selectedExpressDeparture.bookingCutoffAtMs)
          : '',
        outsideExpressAirportHandoffAtMs: selectedExpressDeparture
          ? String(selectedExpressDeparture.airportHandoffAtMs)
          : '',
        outsideExpressFirstMileDeadlineAtMs: selectedExpressDeparture
          ? String(selectedExpressDeparture.firstMileDeadlineAtMs)
          : '',
        outsideExpressArrivalOffsetMinutes: selectedExpressRouteSchedule?.arrivalOffsetMinutes
          ? String(selectedExpressRouteSchedule.arrivalOffsetMinutes)
          : '',
        requestedDriverId: String(params.requestedDriverId || ''),
        requestedDriverName: String(params.requestedDriverName || ''),
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
    if (selectedScope === 'outside' && outsideHandoffMode === 'home') {
      setOutsideHomeAddressConfirmed(true);
      setHomeAddressSheetOpen(false);
    }
    animateMapToPoint(point);
  };

  useEffect(() => {
    if (hasRepeatPickup) {
      return;
    }

    let isMounted = true;

    const applyPickupFromCache = (next: ReturnType<typeof getCustomerLocationSnapshot>) => {
      if (!isMounted || !next.point || !next.label.trim() || next.status !== 'ready') {
        return;
      }

      setPickupPoint(next.point);
      setPickupLabel(next.label);
      setPickupInput(next.label);
      setPickupNeedsSelection(false);
      animateMapToPoint(next.point);
    };

    applyPickupFromCache(getCustomerLocationSnapshot());
    const unsubscribe = subscribeCustomerLocation(applyPickupFromCache);

    void ensureCustomerLocation({ source: 'initial' })
      .then(async (next) => {
        if (!isMounted) {
          return;
        }

        if (next.status === 'ready' && next.point && next.label.trim()) {
          setHasLocationPermission(true);
          return;
        }

        if (next.status === 'permission-denied') {
          setHasLocationPermission(false);
          if (!next.point) {
            const fallbackLabel = 'Location access is off. Using Dar es Salaam pickup preview.';
            setPickupLabel(fallbackLabel);
            setPickupInput(fallbackLabel);
            setPickupNeedsSelection(false);
          }
          return;
        }

        if (!next.point) {
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
      })
      .catch(() => {
        if (!isMounted || getCustomerLocationSnapshot().point) {
          return;
        }

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
      });

    return () => {
      isMounted = false;
      unsubscribe();
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
    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setOutsideHomeAddressConfirmed(false);
    setParcelWeightKg('');
    dropoffSessionTokenRef.current = createSearchSessionToken();
    pickupSessionTokenRef.current = createSearchSessionToken();
  }, [selectedScope]);

  useEffect(() => {
    const searchingCityDropoff = selectedScope === 'city' && shouldFetchSuggestions;
    const searchingOutsideHome =
      selectedScope === 'outside' &&
      outsideHandoffMode === 'home' &&
      shouldFetchSuggestions &&
      !outsideHomeAddressConfirmed;

    if ((!searchingCityDropoff && !searchingOutsideHome) || dropoff.trim().length < 3) {
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const originBias =
      searchingOutsideHome && selectedOutsideCity ? selectedOutsideCity.centerPoint : pickupPoint;

    const instantSuggestions = getInstantLocationSuggestions(dropoff, originBias, 8);
    if (instantSuggestions.length > 0) {
      setDropoffSuggestions(instantSuggestions);
    }

    const lookupId = suggestionLookupIdRef.current + 1;
    suggestionLookupIdRef.current = lookupId;
    setLoadingSuggestions(true);

    const timeout = setTimeout(() => {
      void fetchLocationSuggestions(dropoff, dropoffSessionTokenRef.current, originBias)
        .then((suggestions) => {
          if (lookupId !== suggestionLookupIdRef.current) {
            return;
          }

          setDropoffSuggestions(suggestions);
          setLocationNotice(null);
          logAsyncSuccess(screenScope, 'loadDropoffSuggestions', {
            query: dropoff,
            results: suggestions.length,
            scope: selectedScope,
            handoff: outsideHandoffMode,
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
    }, 160);

    return () => {
      clearTimeout(timeout);
    };
  }, [
    dropoff,
    outsideHandoffMode,
    outsideHomeAddressConfirmed,
    pickupPoint,
    selectedOutsideCity,
    selectedScope,
    shouldFetchSuggestions,
  ]);

  useEffect(() => {
    if (pickupInput.trim().length < 3 || !pickupNeedsSelection) {
      setPickupSuggestions([]);
      setLoadingPickupSuggestions(false);
      return;
    }

    const lookupId = pickupSuggestionLookupIdRef.current + 1;
    pickupSuggestionLookupIdRef.current = lookupId;
    const instantSuggestions = getInstantLocationSuggestions(
      pickupInput,
      pickupPoint ?? dropoffPoint ?? undefined,
      8
    );
    if (instantSuggestions.length > 0) {
      setPickupSuggestions(instantSuggestions);
    }
    setLoadingPickupSuggestions(true);

    const timeout = setTimeout(() => {
      void fetchLocationSuggestions(pickupInput, pickupSessionTokenRef.current, pickupPoint ?? dropoffPoint ?? undefined)
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
    }, 160);

    return () => {
      clearTimeout(timeout);
    };
  }, [dropoffPoint, pickupInput, pickupNeedsSelection, pickupPoint]);

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

    const debounceMs = dropoffPoint ? 80 : 220;

    const timeout = setTimeout(() => {
      void (async () => {
        let destinationPoint: GeoPoint | null = dropoffPoint;
        try {
          logAsyncStart(screenScope, 'cityRouteEstimate', {
            dropoff: trimmedDropoff,
            hasDropoffPoint: Boolean(dropoffPoint),
            vehicleType: parcelVehicleType,
          });

          if (!destinationPoint) {
            destinationPoint = (await resolveTypedLocation(trimmedDropoff, pickupPoint)).point;
          }

          const quickRoute = buildFallbackRouteEstimate(pickupPoint, destinationPoint, 1.28);
          const quickPricing = buildFrontendPricingEstimate({
            distanceMeters: quickRoute.distanceMeters,
            vehicleType: parcelVehicleType,
            pricingScope: 'city-parcel',
          });
          if (lookupId === pricingLookupIdRef.current) {
            setRouteEstimate(quickRoute);
            setPricingEstimate(quickPricing);
            setRouteDistanceKm(quickRoute.distanceMeters / 1000);
            setRouteDurationSeconds(quickRoute.durationSeconds);
          }

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
            const road = await fetchRoadFollowingRoute(pickupPoint, destinationPoint);
            const fallbackRoute = buildFallbackRouteEstimate(
              pickupPoint,
              destinationPoint,
              1.25,
              road
                ? {
                    coordinates: road.coordinates,
                    distanceMeters: road.distanceMeters,
                    durationSeconds: road.durationSeconds,
                    geometry: road.geometry,
                  }
                : null
            );
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
              roadFollowing: Boolean(road && road.coordinates.length > 2),
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
    }, debounceMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [dropoff, dropoffPoint, parcelVehicleType, pickupNeedsSelection, pickupPoint, selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'outside') {
      return;
    }

    if (!selectedOutsideCity || !outsideShippingMode || !outsideHandoffMode) {
      clearRouteEstimateState();
      return;
    }

    if (outsideShippingMode === 'express' && !expressFlightReady) {
      clearRouteEstimateState();
      return;
    }

    if (outsideHandoffMode === 'home') {
      if (!outsideHomeAddressConfirmed || !dropoffPoint) {
        clearRouteEstimateState();
        return;
      }
    } else if (!selectedOutsideHub) {
      clearRouteEstimateState();
      return;
    }

    const outsideCity = selectedOutsideCity;
    const destinationPoint =
      outsideHandoffMode === 'home'
        ? dropoffPoint!
        : selectedOutsideHub?.fallbackPoint ?? outsideCity.centerPoint;
    const destinationLabel =
      outsideHandoffMode === 'home'
        ? dropoff.trim()
        : `${selectedOutsideHub?.label ?? copy.parcel.airportHub}, ${outsideCity.label}`;

    pricingLookupIdRef.current += 1;
    const fallbackRoute = buildFallbackRouteEstimate(pickupPoint, destinationPoint, 1.35);
    const fallbackPricing = buildFlatPricingEstimate(
      fallbackRoute.distanceMeters,
      parcelVehicleType,
      getOutsideParcelFlatFare({
        destinationCityKey: outsideCity.key,
        destinationCity: outsideCity,
        shippingMode: outsideShippingMode,
        handoffMode: outsideHandoffMode,
        pickupPoint,
        pickupLabel,
        dropoffPoint: outsideHandoffMode === 'home' ? dropoffPoint : undefined,
        expressHomeDeliveryMandatory: outsideExpressHomeDeliveryMandatory,
      })
    );

    if (outsideHandoffMode !== 'home') {
      setDropoff(destinationLabel);
      setDropoffPoint(destinationPoint);
    }

    setRouteEstimate({
      ...fallbackRoute,
      price: fallbackPricing.estimatedPrice,
      pricingEstimate: fallbackPricing,
    });
    setPricingEstimate(fallbackPricing);
    setRouteDistanceKm(fallbackRoute.distanceMeters / 1000);
    // Corridor ETA, not the live countdown until airport handoff. That countdown
    // changed flight bookability and retriggered this effect without stopping.
    setRouteDurationSeconds(
      getOutsideParcelDurationSeconds({
        originCityKey: outsideOriginCityKey,
        destinationCityKey: outsideCity.key,
        shippingMode: outsideShippingMode,
      })
    );
    setPricingLoading(false);
    setPricingError(false);
    setPricingErrorMessage('');
    setLocationNotice(null);
    logAsyncSuccess(screenScope, 'outsideFlatPricingReady', {
      city: outsideCity.label,
      mode: outsideShippingMode,
      handoff: outsideHandoffMode,
      hub: outsideHandoffMode === 'home' ? destinationLabel : selectedOutsideHub?.label ?? 'hub',
      distanceMeters: fallbackRoute.distanceMeters,
      durationSeconds: fallbackRoute.durationSeconds,
      price: fallbackPricing.estimatedPrice,
      source: 'frontend-flat',
    });
  }, [
    copy.parcel.airportHub,
    dropoff,
    dropoffPoint,
    outsideExpressHomeDeliveryMandatory,
    outsideHandoffMode,
    outsideHomeAddressConfirmed,
    outsideShippingMode,
    outsideOriginCityKey,
    expressFlightReady,
    parcelVehicleType,
    pickupLabel,
    pickupPoint,
    selectedExpressDeparture,
    selectedOutsideCity,
    selectedOutsideHub,
    selectedScope,
    pricingRetryTick,
  ]);

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
    const loadingLabel = language === 'sw' ? 'Inatafuta eneo...' : 'Finding place...';

    if (mapSelectionTarget === 'pickup') {
      setPickupLabel(loadingLabel);
      setPickupInput(loadingLabel);
    } else {
      setDropoff(loadingLabel);
    }

    try {
      const reverse = await reverseGeocodeLocation(point);
      const label =
        reverse.label && !isCoordinateLikeLabel(reverse.label)
          ? reverse.label
          : reverse.label?.trim() || loadingLabel;

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
      setDropoff(label);
      return;
    } catch {
      // Keep loading text only briefly — reverseGeocodeLocation already tries Google + backend.
    }

    if (mapSelectionTarget === 'pickup') {
      setPickupPoint(point);
      setPickupLabel(language === 'sw' ? 'Eneo halikupatikana' : 'Place unavailable');
      setPickupInput(language === 'sw' ? 'Eneo halikupatikana' : 'Place unavailable');
      setPickupNeedsSelection(false);
      pickupSessionTokenRef.current = createSearchSessionToken();
      return;
    }

    setDropoffPoint(point);
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShouldFetchSuggestions(false);
    setDropoff(language === 'sw' ? 'Eneo halikupatikana' : 'Place unavailable');
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
    if (selectedScope === 'outside' && outsideHandoffMode === 'home') {
      setOutsideHomeAddressConfirmed(false);
    }
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
      const biasPoint =
        selectedScope === 'outside' && outsideHandoffMode === 'home' && selectedOutsideCity
          ? selectedOutsideCity.centerPoint
          : pickupPoint;
      const resolved = await retrieveLocationSuggestion(suggestion, dropoffSessionTokenRef.current, biasPoint);
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

  const applyOutsideHubDestination = (
    city: OutsideDestinationCity,
    hub: OutsideHub | null,
    handoff: OutsideHandoffMode
  ) => {
    if (handoff === 'home') {
      setSelectedOutsideStandId(null);
      setOutsideHomeAddressConfirmed(false);
      setDropoff('');
      setDropoffPoint(null);
      setShouldFetchSuggestions(true);
      dropoffSessionTokenRef.current = createSearchSessionToken();
    } else if (hub) {
      setOutsideHomeAddressConfirmed(false);
      setSelectedOutsideStandId(hub.id);
      setDropoff(`${hub.label}, ${city.label}`);
      setDropoffPoint(hub.fallbackPoint);
      setShouldFetchSuggestions(false);
    } else {
      setOutsideHomeAddressConfirmed(false);
      setSelectedOutsideStandId(null);
      setDropoff('');
      setDropoffPoint(null);
      setShouldFetchSuggestions(false);
    }

    clearRouteEstimateState();
    setDropoffSuggestions([]);
    setLoadingSuggestions(false);
    setShowMapPicker(false);
  };

  const applyDefaultOutsideHandoff = (city: OutsideDestinationCity, mode: OutsideShippingMode) => {
    if (mode === 'express') {
      if (
        isOutsideExpressHomeDeliveryMandatory({
          originCityKey: outsideOriginCityKey,
          destinationCityKey: city.key,
          shippingMode: 'express',
        })
      ) {
        setOutsideHandoffMode('home');
        applyOutsideHubDestination(city, null, 'home');
        return;
      }

      const airport = getDefaultDestinationHub(city, 'express');
      setOutsideHandoffMode('airport');
      applyOutsideHubDestination(city, airport, 'airport');
      return;
    }

    const stand = getDefaultDestinationHub(city, 'standard');
    setOutsideHandoffMode('bus');
    applyOutsideHubDestination(city, stand, 'bus');
  };

  const handleSelectOutsideCity = (cityKey: OutsideDestinationCityKey) => {
    const city = outsideDestinationCities.find((item) => item.key === cityKey) ?? null;
    if (!city) {
      return;
    }

    const hubsForCurrentMode =
      outsideShippingMode === 'express' ? city.airports : city.stands;
    if (
      cityKey === selectedOutsideCityKey &&
      selectedOutsideStandId &&
      hubsForCurrentMode.some((hub) => hub.id === selectedOutsideStandId)
    ) {
      return;
    }

    if (cityKey !== selectedOutsideCityKey) {
      setSelectedOutsideCityKey(cityKey);
      setOutsideHomeAddressConfirmed(false);
      setSelectedExpressDeparture(null);
      setParcelWeightKg('');
      setOutsideSizePreset(null);
      setParcelLengthCm('');
      setParcelWidthCm('');
      setParcelHeightCm('');
      setParcelPhotoUri(null);
      setParcelPhotoUrl(null);
      setParcelPhotoUploading(false);
      setParcelPhotoError(null);
      clearParcelPhotoDraft();
      clearRouteEstimateState();
      setDropoffSuggestions([]);
      setLoadingSuggestions(false);
      setShouldFetchSuggestions(false);
      setShowMapPicker(false);
    }

    const standardAllowed = isOutsideRouteAllowed({
      originCityKey: outsideOriginCityKey,
      destinationCityKey: city.key,
      shippingMode: 'standard',
    });
    const expressAllowed = isOutsideRouteAllowed({
      originCityKey: outsideOriginCityKey,
      destinationCityKey: city.key,
      shippingMode: 'express',
    });

    if (standardAllowed) {
      setOutsideShippingMode('standard');
      applyDefaultOutsideHandoff(city, 'standard');
      return;
    }

    if (expressAllowed) {
      setOutsideShippingMode('express');
      applyDefaultOutsideHandoff(city, 'express');
      return;
    }

    setOutsideShippingMode(null);
    setOutsideHandoffMode(null);
    setSelectedOutsideStandId(null);
    setDropoff('');
    setDropoffPoint(null);
  };

  const handleSelectOutsideShippingMode = (mode: OutsideShippingMode) => {
    if (!selectedOutsideCity) {
      return;
    }

    if (mode === 'express' && !outsideExpressModeSelectable) {
      return;
    }

    if (
      !isOutsideRouteAllowed({
        originCityKey: outsideOriginCityKey,
        destinationCityKey: selectedOutsideCity.key,
        shippingMode: mode,
      })
    ) {
      return;
    }

    setOutsideShippingMode(mode);
    setSelectedExpressDeparture(null);
    applyDefaultOutsideHandoff(selectedOutsideCity, mode);
  };

  const handleSelectOutsideHandoff = (handoff: OutsideHandoffMode) => {
    if (!selectedOutsideCity || !outsideShippingMode) {
      return;
    }

    if (handoff === 'home' && !outsideHomeDeliveryAvailable) {
      return;
    }

    if (outsideShippingMode === 'express' && handoff === 'bus') {
      return;
    }
    if (
      outsideShippingMode === 'express' &&
      handoff === 'airport' &&
      selectedOutsideCity &&
      isOutsideExpressHomeDeliveryMandatory({
        originCityKey: outsideOriginCityKey,
        destinationCityKey: selectedOutsideCity.key,
        shippingMode: 'express',
      })
    ) {
      return;
    }
    if (outsideShippingMode === 'standard' && handoff === 'airport') {
      return;
    }

    setOutsideHandoffMode(handoff);

    if (handoff === 'home') {
      applyOutsideHubDestination(selectedOutsideCity, null, 'home');
      return;
    }

    applyDefaultOutsideHandoff(selectedOutsideCity, outsideShippingMode);
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

  const handleSelectOutsideHub = (city: OutsideDestinationCity, hub: OutsideHub) => {
    const handoff: OutsideHandoffMode = outsideShippingMode === 'express' ? 'airport' : 'bus';
    setOutsideHandoffMode(handoff);
    applyOutsideHubDestination(city, hub, handoff);
  };

  if (
    selectedScope === 'outside' &&
    (outsideRegionStatus === 'checking' || outsideRegionStatus === 'out-of-reach')
  ) {
    return (
      <RegionOutOfReachScreen
        avatar={images.outsideParcelOutOfReachAvatar}
        title={copy.parcel.outOfReachTitle}
        text={copy.parcel.outOfReachText}
        hint={copy.parcel.outOfReachHint}
        backLabel={copy.parcel.outOfReachBack}
        checkingLabel={copy.parcel.checkingRegion}
        status={outsideRegionStatus === 'checking' ? 'checking' : 'out-of-reach'}
        glowColor="#E0F2FE"
      />
    );
  }

  return (
    <>
    {selectedScope === 'outside' ? (
      <OutsideParcelWizard
        language={language}
        step={outsideWizardStep}
        onBack={handleOutsideWizardBack}
        onContinue={handleOutsideWizardContinue}
        continueLabel={outsideWizardContinueLabel}
        continueEnabled={outsideWizardContinueEnabled}
        pickupLabel={pickupLabel}
        originLabel={outsideOriginCity?.label ?? 'Dar es Salaam'}
        destinations={eligibleOutsideDestinations}
        selectedCityKey={selectedOutsideCityKey}
        selectedCityLabel={selectedOutsideCity?.label ?? null}
        onSelectCity={handleSelectOutsideCity}
        onClearCity={handleClearOutsideCity}
        shippingMode={outsideShippingMode}
        onSelectMode={handleSelectOutsideShippingMode}
        expressAvailable={outsideExpressModeSelectable}
        expressPrice={outsideExpressQuoteLabel}
        expressEta={selectedExpressDeparture ? selectedExpressDeparture.timeLabel : '~2h'}
        busAvailable={outsideStandardOriginAvailable}
        busPrice={outsideStandardQuoteLabel}
        busEta="24h"
        sizeOptions={outsideSizeOptions}
        sizePreset={outsideSizePreset}
        onSelectSize={handleSelectOutsideSize}
        weightKg={parcelWeightKg}
        onChangeWeight={(value) => {
          setParcelWeightKg(value);
          setOutsideSizePreset(null);
        }}
        weightHint={
          outsideShippingMode === 'express' ? copy.parcel.weightHintExpress : copy.parcel.weightHintStandard
        }
        weightError={
          outsideWeightTooHeavy
            ? outsideShippingMode === 'express'
              ? copy.parcel.weightTooHeavyExpress
              : copy.parcel.weightTooHeavyStandard
            : null
        }
        lengthCm={parcelLengthCm}
        widthCm={parcelWidthCm}
        heightCm={parcelHeightCm}
        onChangeLength={(value) => {
          setParcelLengthCm(value);
          setOutsideSizePreset(null);
        }}
        onChangeWidth={(value) => {
          setParcelWidthCm(value);
          setOutsideSizePreset(null);
        }}
        onChangeHeight={(value) => {
          setParcelHeightCm(value);
          setOutsideSizePreset(null);
        }}
        volumetricHint={volumetricHint}
        onApplyVolumetric={volumetricKg ? handleApplyVolumetricWeight : null}
        photoUri={parcelPhotoUri}
        photoError={parcelPhotoError}
        photoUploaded={Boolean(parcelPhotoUrl)}
        photoUploading={parcelPhotoUploading}
        cameraAvailable={isImagePickerAvailable()}
        onCapturePhoto={() => void handleCaptureParcelPhoto()}
        onPickLibrary={() => void handlePickParcelLibrary()}
        onClearPhoto={() => {
          setParcelPhotoUri(null);
          setParcelPhotoUrl(null);
          setParcelPhotoUploading(false);
          setParcelPhotoError(null);
          clearParcelPhotoDraft();
        }}
        recipientName={recipientName}
        onChangeName={setRecipientName}
        recipientPhone={recipientPhone}
        onChangePhone={setRecipientPhone}
        notifyRecipient={notifyRecipient}
        onToggleNotify={() => setNotifyRecipient((current) => !current)}
        notifyLabel={copy.parcel.notifyRecipient}
        declaredValue={declaredValueTzs}
        onChangeDeclaredValue={(text) => setDeclaredValueTzs(formatDeclaredValueInput(text))}
        homeAddressRequired={homeAddressRequiredForStep2}
        homeAddressReady={outsideHomeAddressReady}
        homeAddressLabel={dropoff}
        onOpenHomeAddress={() => {
          setHomeAddressSheetOpen(true);
          setShouldFetchSuggestions(true);
        }}
        flightLabel={
          selectedExpressDeparture
            ? `${selectedExpressDeparture.dayLabel} · ${selectedExpressDeparture.timeLabel}`
            : null
        }
        flightPicker={
          outsideShippingMode === 'express' && selectedOutsideCity && selectedExpressRouteSchedule ? (
            <OutsideExpressFlightPicker
              language={language}
              route={selectedExpressRouteSchedule}
              selectedDepartureId={selectedExpressDeparture?.departureId ?? null}
              firstMileMinutes={expressFirstMileMinutes}
              compactSelected={expressFlightReady && !expressFlightListExpanded}
              loading={outsideRegionStatus === 'checking'}
              onChangeFlight={() => {
                setExpressFlightListExpanded(true);
                setSelectedExpressDeparture(null);
              }}
              onSelect={(slot) => {
                setSelectedExpressDeparture(slot);
                setExpressFlightListExpanded(false);
                clearRouteEstimateState();
              }}
            />
          ) : null
        }
        stands={selectedOutsideCity?.stands ?? []}
        airports={selectedOutsideCity?.airports ?? []}
        selectedStandId={selectedOutsideStandId}
        onSelectStand={(standId) => {
          const hub =
            selectedOutsideCity?.stands.find((stand) => stand.id === standId) ??
            selectedOutsideCity?.airports.find((airport) => airport.id === standId) ??
            null;
          if (selectedOutsideCity && hub) {
            handleSelectOutsideHub(selectedOutsideCity, hub);
          }
        }}
        summaryLine={outsideStickySummary || `${outsideOriginCity?.label ?? ''} → ${selectedOutsideCity?.label ?? ''}`}
        legalAccepted={contentsLawAccepted}
        onToggleLegal={() => setContentsLawAccepted((current) => !current)}
        onOpenLegal={() => setLegalTermsOpen(true)}
        legalBody={copy.parcel.legalBody}
        legalCheckbox={copy.parcel.legalCheckbox}
      />
    ) : (
    <CargoScreen
      keyboardAvoiding
      scrollRef={scrollRef}
      backgroundColor="#FFFFFF"
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          {selectedScope === 'outside' && outsideStickySummary && outsideWizardStep > 1 ? (
            <Text style={styles.footerSummary} numberOfLines={2}>
              {outsideStickySummary}
            </Text>
          ) : null}
          {selectedScope !== 'outside' && isFormValid ? <Text style={styles.footerEta}>{eta}</Text> : null}
          {selectedScope === 'outside' && outsideWizardStep === 1 ? (
            <PrimaryButton
              label={
                canLeaveOutsideStep1
                  ? language === 'sw'
                    ? 'Endelea'
                    : 'Continue'
                  : selectedOutsideCity
                    ? copy.parcel.nextMode
                    : copy.parcel.nextCity
              }
              icon={canLeaveOutsideStep1 ? 'arrow-right' : undefined}
              onPress={() => {
                if (canLeaveOutsideStep1) {
                  setOutsideWizardStep(2);
                }
              }}
              style={!canLeaveOutsideStep1 ? styles.reviewButtonDisabled : undefined}
            />
          ) : selectedScope === 'outside' && outsideWizardStep === 2 ? (
            <PrimaryButton
              label={
                canLeaveOutsideStep2
                  ? language === 'sw'
                    ? 'Endelea'
                    : 'Continue'
                  : footerLabel
              }
              icon={canLeaveOutsideStep2 ? 'arrow-right' : undefined}
              onPress={() => {
                if (canLeaveOutsideStep2) {
                  setOutsideWizardStep(3);
                }
              }}
              style={!canLeaveOutsideStep2 ? styles.reviewButtonDisabled : undefined}
            />
          ) : (
            <PrimaryButton
              label={footerLabel}
              icon={isFormValid ? 'arrow-right' : undefined}
              onPress={handleReviewOrder}
              style={!isFormValid ? styles.reviewButtonDisabled : undefined}
            />
          )}
        </View>
      }>
      <CargoHeader
        title={copy.parcel.title}
        onLeftPress={() => {
          if (selectedScope === 'outside' && outsideWizardStep > 1) {
            setOutsideWizardStep(outsideWizardStep === 3 ? 2 : 1);
            return;
          }
          if (router.canGoBack()) {
            router.back();
            return;
          }
          router.replace('/home');
        }}
      />
      {scheduleBannerLabel ? (
        <View style={styles.scheduleBanner}>
          <MaterialCommunityIcons name="calendar-clock" size={18} color={cargoTheme.colors.primaryDark} />
          <View style={styles.scheduleBannerCopy}>
            <Text style={styles.scheduleBannerTitle}>
              {language === 'sw' ? 'Imepangwa' : 'Scheduled'}
            </Text>
            <Text style={styles.scheduleBannerText}>{scheduleBannerLabel}</Text>
          </View>
        </View>
      ) : null}
      {params.requestedDriverId ? (
        <View style={styles.requestedDriverCard}>
          <Text style={styles.requestedDriverTitle}>
            {params.requestedDriverName || 'Dereva'} yuko karibu
          </Text>
          <Text style={styles.requestedDriverText}>
            Kamilisha oda ili apewe safari hii kwanza.
          </Text>
        </View>
      ) : null}
      <NetworkDegradedBanner
        language={language}
        visible={networkDegradedVisible}
        onRetry={() => setPricingRetryTick((value) => value + 1)}
      />

      {CITY_PARCELS_ENABLED && (selectedScope === 'city' || outsideWizardStep === 1) ? (
      <View style={styles.segment}>
        {parcelScopes.map((scope) => {
          const isActive = scope.key === selectedScope;
          return (
            <TouchableOpacity
              key={scope.key}
              style={[styles.segmentItem, isActive && styles.segmentItemActive]}
              activeOpacity={0.88}
              onPress={() => {
                if (!CITY_PARCELS_ENABLED && scope.key === 'city') {
                  return;
                }
                setSelectedScope(scope.key);
                if (scope.key === 'outside') {
                  setOutsideWizardStep(1);
                }
              }}>
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                {scope.key === 'city' ? copy.parcel.inCity : copy.parcel.outsideCity}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      ) : null}

      <View style={styles.routeCard}>
        {selectedScope === 'outside' && outsideWizardStep > 1 ? (
          <View style={styles.outsideRouteSummary}>
            <View style={styles.outsideRouteSummaryCopy}>
              <Text style={styles.outsideRouteSummaryEyebrow}>
                {language === 'sw' ? 'Njia' : 'Route'}
              </Text>
              <Text numberOfLines={1} style={styles.outsideRouteSummaryText}>
                {pickupLabel || (language === 'sw' ? 'Mahali pa kuchukua' : 'Pickup')}
                {'  →  '}
                {selectedOutsideCity?.label ?? (language === 'sw' ? 'Chagua mkoa' : 'Choose region')}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => setOutsideWizardStep(1)}
              accessibilityRole="button"
              accessibilityLabel={language === 'sw' ? 'Badilisha mkoa' : 'Change region'}>
              <Text style={styles.changeLink}>{copy.common.change}</Text>
            </TouchableOpacity>
          </View>
        ) : editingPickup || pickupNeedsSelection ? (
          <View style={styles.routeRow}>
            <View style={[styles.routeIconWrap, { backgroundColor: '#FFF9CC' }]}>
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
              {loadingPickupSuggestions || pickupSuggestions.length > 0 ? (
                <LocationSuggestionsList
                  tone="pickup"
                  loading={loadingPickupSuggestions}
                  loadingLabel={copy.parcel.searching}
                  headerLabel={language === 'sw' ? 'Maeneo' : 'Places'}
                  suggestions={pickupSuggestions}
                  onSelect={(suggestion) => {
                    void handleSelectPickupSuggestion(suggestion);
                    setEditingPickup(false);
                  }}
                />
              ) : null}
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.compactStop} activeOpacity={0.88} onPress={() => setEditingPickup(true)}>
            <View style={[styles.routeIconWrap, { backgroundColor: '#FFF9CC' }]}>
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

            {loadingSuggestions || dropoffSuggestions.length > 0 ? (
              <LocationSuggestionsList
                tone="dropoff"
                loading={loadingSuggestions}
                loadingLabel={copy.parcel.searching}
                headerLabel={language === 'sw' ? 'Maeneo' : 'Places'}
                suggestions={dropoffSuggestions}
                showEmpty={dropoff.trim().length >= 3 && !loadingSuggestions}
                emptyLabel={
                  language === 'sw'
                    ? 'Hakuna eneo lililopatikana karibu. Jaribu jina la mtaa, eneo, au landmark.'
                    : 'No nearby places found. Try a street, area, or landmark name.'
                }
                onSelect={(suggestion) => {
                  void handleSelectDropoffSuggestion(suggestion);
                }}
              />
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
                    <NearbyLiveVehicleMarkers
                      vehicles={nearbyLiveVehicles}
                      Marker={Marker}
                      MarkerAnimated={MarkerAnimated}
                      AnimatedRegion={AnimatedRegion}
                    />
                    <MapRouteLine
                      Polyline={Polyline}
                      coordinates={validRouteCoordinates}
                      fallback={validRouteCoordinates.length > 0 && validRouteCoordinates.length < 3}
                    />
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
            <OutsideParcelWizardBar language={language} step={outsideWizardStep} />
            {outsideWizardStep === 1 ? (
            <OutsideParcelDestinationPicker
              language={language}
              originCity={outsideOriginCity}
              originCityKey={outsideOriginCityKey}
              destinations={eligibleOutsideDestinations}
              selectedCityKey={selectedOutsideCityKey}
              onSelectCity={handleSelectOutsideCity}
            />
            ) : null}

            {outsideWizardStep === 1 && selectedOutsideCity ? (
              <View style={styles.outsideSection}>
                <OutsideParcelStepHeader
                  step={2}
                  title={language === 'sw' ? 'Chagua njia ya usafirishaji' : 'Choose shipping method'}
                />
                <View style={[styles.modeRow, { marginTop: 4 }]}>
                  {outsideExpressModeSelectable ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => handleSelectOutsideShippingMode('express')}
                      style={({ pressed }) => [
                        styles.modeCard,
                        outsideShippingMode === 'express' && styles.modeCardActive,
                        pressed && styles.pressablePressed,
                      ]}>
                      <View style={styles.expressBadge}>
                        <Image source={images.parcelExpressFastBadge} style={styles.expressBadgeIcon} resizeMode="contain" />
                        <Text style={styles.expressBadgeText}>{copy.parcel.expressSpeedBadge}</Text>
                      </View>
                      <View style={styles.modeAvatarWell}>
                        <Image source={images.parcelExpressPlane} style={styles.modeAvatar} resizeMode="contain" />
                      </View>
                      <Text style={styles.modeTitle}>{copy.parcel.expressTitle}</Text>
                      <Text style={styles.modeSubtitle}>{outsideExpressEtaHint}</Text>
                      <View style={styles.modeMetaRow}>
                        <Text style={styles.modePrice}>{outsideExpressQuoteLabel}</Text>
                        <View
                          style={[
                            styles.modeRadio,
                            outsideShippingMode === 'express' && styles.modeRadioActive,
                          ]}>
                          {outsideShippingMode === 'express' ? <View style={styles.modeRadioDot} /> : null}
                        </View>
                      </View>
                    </Pressable>
                  ) : (
                    <View style={[styles.modeCard, styles.modeCardUnavailable]} accessibilityState={{ disabled: true }}>
                      <View style={styles.modeAvatarWell}>
                        <Image source={images.expressUnavailableAvatar} style={styles.modeAvatar} resizeMode="contain" />
                      </View>
                      <Text style={styles.modeTitle}>{copy.parcel.expressUnavailableTitle}</Text>
                      <Text style={styles.modeSubtitle}>
                        {expressNextDayFallback
                          ? language === 'sw'
                            ? `Ndege zote za leo zimefungwa. Inayofuata: ${expressNextDayFallback.dayLabel} ${expressNextDayFallback.timeLabel}.`
                            : `All flights today are closed. Next: ${expressNextDayFallback.dayLabel} ${expressNextDayFallback.timeLabel}.`
                          : expressRouteScheduled
                            ? language === 'sw'
                              ? 'Ratiba ipo lakini hakuna ndege wazi sasa. Jaribu tena baadaye au chagua basi.'
                              : 'Flights are scheduled but none are open now. Try again later or choose bus.'
                            : copy.parcel.expressUnavailableText}
                      </Text>
                      {expressNextDayFallback ? (
                        <Pressable
                          accessibilityRole="button"
                          style={styles.unavailableAction}
                          onPress={() => {
                            handleSelectOutsideShippingMode('express');
                            setSelectedExpressDeparture(expressNextDayFallback);
                            scrollToWeightPanel();
                          }}>
                          <Text style={styles.unavailableActionText}>
                            {language === 'sw'
                              ? `Chagua ndege ya ${expressNextDayFallback.timeLabel}`
                              : `Pick ${expressNextDayFallback.timeLabel} flight`}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.modeUnavailableHint}>{copy.parcel.expressTitle}</Text>
                      )}
                    </View>
                  )}

                  {outsideStandardOriginAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSelectOutsideShippingMode('standard')}
                    style={({ pressed }) => [
                      styles.modeCard,
                      outsideShippingMode === 'standard' && styles.modeCardActive,
                      pressed && styles.pressablePressed,
                    ]}>
                    <View style={styles.modeAvatarWell}>
                      <Image source={images.parcelRoadBus} style={styles.modeAvatar} resizeMode="contain" />
                    </View>
                    <Text style={styles.modeTitle}>{copy.parcel.standardTitle}</Text>
                    <Text style={styles.modeSubtitle}>{outsideBusEtaHint}</Text>
                    <View style={styles.modeMetaRow}>
                      <Text style={styles.modePrice}>{outsideStandardQuoteLabel}</Text>
                      <View
                        style={[
                          styles.modeRadio,
                          outsideShippingMode === 'standard' && styles.modeRadioActive,
                        ]}>
                        {outsideShippingMode === 'standard' ? <View style={styles.modeRadioDot} /> : null}
                      </View>
                    </View>
                  </Pressable>
                  ) : (
                    <View style={[styles.modeCard, styles.modeCardUnavailable]} accessibilityState={{ disabled: true }}>
                      <View style={styles.modeAvatarWell}>
                        <Image source={images.offlineSadAvatar} style={styles.modeAvatar} resizeMode="contain" />
                      </View>
                      <Text style={styles.modeTitle}>{copy.parcel.standardTitle}</Text>
                      <Text style={styles.modeSubtitle}>
                        {language === 'sw'
                          ? 'Basi haipatikani kutoka mkoa huu.'
                          : 'Bus shipping is not available from this region.'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : null}

            {outsideWizardStep === 2 && selectedOutsideCity && outsideShippingMode === 'express' && expressFlightReady && !expressFlightListExpanded ? (
              <View style={styles.expressCompactSummary}>
                <MaterialCommunityIcons name="airplane" size={18} color={cargoTheme.colors.primaryDark} />
                <Text style={styles.expressCompactSummaryText}>
                  {selectedExpressDeparture
                    ? `${selectedExpressDeparture.dayLabel} · ${selectedExpressDeparture.timeLabel}`
                    : copy.parcel.expressTitle}
                </Text>
              </View>
            ) : null}

            {outsideWizardStep === 2 && selectedOutsideCity &&
            outsideShippingMode === 'express' &&
            selectedExpressRouteSchedule &&
            (!expressFlightReady || expressFlightListExpanded) ? (
              <View style={styles.outsideSection}>
                <OutsideParcelStepHeader
                  step={3}
                  title={language === 'sw' ? 'Chagua ratiba ya ndege' : 'Choose flight schedule'}
                />
                <OutsideExpressFlightPicker
                  language={language}
                  route={selectedExpressRouteSchedule}
                  selectedDepartureId={selectedExpressDeparture?.departureId ?? null}
                  firstMileMinutes={expressFirstMileMinutes}
                  compactSelected={expressFlightReady && !expressFlightListExpanded}
                  loading={outsideRegionStatus === 'checking'}
                  onChangeFlight={() => {
                    setExpressFlightListExpanded(true);
                    setSelectedExpressDeparture(null);
                  }}
                  onSelect={(slot) => {
                    setSelectedExpressDeparture(slot);
                    setExpressFlightListExpanded(false);
                    clearRouteEstimateState();
                    scrollToWeightPanel();
                  }}
                />
              </View>
            ) : null}

            {outsideWizardStep === 2 && showExpressHandoffStep ? (
              <View style={styles.outsideSection}>
                <OutsideParcelStepHeader
                  step={selectedExpressRouteSchedule ? 4 : 3}
                  title={
                    outsideExpressHomeDeliveryMandatory
                      ? language === 'sw'
                        ? 'Anwani ya mpokeaji (nyumbani)'
                        : 'Recipient home address'
                      : copy.parcel.handoffTitle
                  }
                />
                {outsideExpressHomeDeliveryMandatory ? (
                  <View style={styles.mandatoryHomeNotice}>
                    <MaterialCommunityIcons
                      name="home-map-marker"
                      size={18}
                      color={cargoTheme.colors.primaryDark}
                    />
                    <Text style={styles.mandatoryHomeNoticeText}>
                      {language === 'sw'
                        ? 'Ndege Dar–Zanzibar: utoaji ni nyumbani tu. Eneo ndani ya km 1 kutoka uwanja wa ndege linachaji TZS 15,000.'
                        : 'Dar–Zanzibar air: home delivery only. Addresses within 1 km of the airport are charged TZS 15,000.'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={[styles.optionList, { marginTop: 4 }]}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => handleSelectOutsideHandoff('airport')}
                        style={({ pressed }) => [
                          styles.optionRow,
                          outsideHandoffMode === 'airport' && styles.optionRowActive,
                          pressed && styles.pressablePressed,
                        ]}>
                        <Image source={images.parcelHubAirport} style={styles.optionAvatar} resizeMode="contain" />
                        <View style={styles.optionCopy}>
                          <Text style={styles.optionTitle}>{copy.parcel.airportHub}</Text>
                          <Text style={styles.optionMeta}>{formatTzs(15000)}</Text>
                        </View>
                        <View
                          style={[
                            styles.modeRadio,
                            outsideHandoffMode === 'airport' && styles.modeRadioActive,
                          ]}>
                          {outsideHandoffMode === 'airport' ? <View style={styles.modeRadioDot} /> : null}
                        </View>
                      </Pressable>

                      {outsideHomeDeliveryAvailable ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleSelectOutsideHandoff('home')}
                          style={({ pressed }) => [
                            styles.optionRow,
                            outsideHandoffMode === 'home' && styles.optionRowActive,
                            pressed && styles.pressablePressed,
                          ]}>
                          <Image source={images.parcelHomeDelivery} style={styles.optionAvatar} resizeMode="contain" />
                          <View style={styles.optionCopy}>
                            <Text style={styles.optionTitle}>{copy.parcel.homeDelivery}</Text>
                            <Text style={styles.optionMeta}>{formatTzs(18000)}</Text>
                          </View>
                          <View
                            style={[
                              styles.modeRadio,
                              outsideHandoffMode === 'home' && styles.modeRadioActive,
                            ]}>
                            {outsideHandoffMode === 'home' ? <View style={styles.modeRadioDot} /> : null}
                          </View>
                        </Pressable>
                      ) : (
                        <Text style={styles.outsideHint}>{copy.parcel.airportOnlyHint}</Text>
                      )}
                    </View>

                    {outsideHandoffMode === 'airport' ? (
                      <View style={styles.hubList}>
                        {selectedOutsideCity.airports.map((hub) => {
                          const isActive = hub.id === selectedOutsideStandId;
                          return (
                            <Pressable
                              key={hub.id}
                              accessibilityRole="button"
                              onPress={() => handleSelectOutsideHub(selectedOutsideCity, hub)}
                              style={({ pressed }) => [
                                styles.hubRow,
                                isActive && styles.hubRowActive,
                                pressed && styles.pressablePressed,
                              ]}>
                              <View style={[styles.hubIconWell, isActive && styles.hubIconWellActive]}>
                                <MaterialCommunityIcons
                                  name="airplane"
                                  size={16}
                                  color={isActive ? cargoTheme.colors.primaryDark : '#64748B'}
                                />
                              </View>
                              <Text style={[styles.hubRowText, isActive && styles.hubRowTextActive]}>{hub.label}</Text>
                              {isActive ? (
                                <MaterialCommunityIcons name="check" size={18} color={cargoTheme.colors.primaryDark} />
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {outsideWizardStep === 2 && selectedOutsideCity && outsideShippingMode === 'standard' ? (
              <View style={styles.outsideSection}>
                <OutsideParcelStepHeader
                  step={3}
                  title={copy.parcel.handoffTitle}
                />
                <View style={[styles.optionList, { marginTop: 4 }]}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSelectOutsideHandoff('bus')}
                    style={({ pressed }) => [
                      styles.optionRow,
                      outsideHandoffMode === 'bus' && styles.optionRowActive,
                      pressed && styles.pressablePressed,
                    ]}>
                    <Image source={images.parcelRoadBus} style={styles.optionAvatar} resizeMode="contain" />
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{copy.parcel.busStand}</Text>
                      <Text style={styles.optionMeta}>
                        {formatTzs(
                          getOutsideParcelFlatFare({
                            destinationCityKey: selectedOutsideCity.key,
                            shippingMode: 'standard',
                            handoffMode: 'bus',
                            pickupPoint,
                            pickupLabel,
                          })
                        )}
                      </Text>
                    </View>
                    <View
                      style={[styles.modeRadio, outsideHandoffMode === 'bus' && styles.modeRadioActive]}>
                      {outsideHandoffMode === 'bus' ? <View style={styles.modeRadioDot} /> : null}
                    </View>
                  </Pressable>

                  {outsideHomeDeliveryAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSelectOutsideHandoff('home')}
                    style={({ pressed }) => [
                      styles.optionRow,
                      outsideHandoffMode === 'home' && styles.optionRowActive,
                      pressed && styles.pressablePressed,
                    ]}>
                    <Image source={images.parcelHomeDelivery} style={styles.optionAvatar} resizeMode="contain" />
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{copy.parcel.homeDelivery}</Text>
                      <Text style={styles.optionMeta}>
                        {formatTzs(
                          getOutsideParcelFlatFare({
                            destinationCityKey: selectedOutsideCity.key,
                            shippingMode: 'standard',
                            handoffMode: 'home',
                            pickupPoint,
                            pickupLabel,
                          })
                        )}
                      </Text>
                    </View>
                    <View
                      style={[styles.modeRadio, outsideHandoffMode === 'home' && styles.modeRadioActive]}>
                      {outsideHandoffMode === 'home' ? <View style={styles.modeRadioDot} /> : null}
                    </View>
                  </Pressable>
                  ) : (
                    <Text style={styles.outsideHint}>{copy.parcel.airportOnlyHint}</Text>
                  )}
                </View>

                {outsideHandoffMode === 'bus' ? (
                  <View style={styles.hubList}>
                    {selectedOutsideCity.stands.map((stand) => {
                      const isActive = stand.id === selectedOutsideStandId;
                      return (
                        <Pressable
                          key={stand.id}
                          accessibilityRole="button"
                          onPress={() => handleSelectOutsideHub(selectedOutsideCity, stand)}
                          style={({ pressed }) => [
                            styles.hubRow,
                            isActive && styles.hubRowActive,
                            pressed && styles.pressablePressed,
                          ]}>
                          <View style={[styles.hubIconWell, isActive && styles.hubIconWellActive]}>
                            <MaterialCommunityIcons
                              name="bus-stop"
                              size={16}
                              color={isActive ? cargoTheme.colors.primaryDark : '#64748B'}
                            />
                          </View>
                          <Text style={[styles.hubRowText, isActive && styles.hubRowTextActive]}>{stand.label}</Text>
                          {isActive ? (
                            <MaterialCommunityIcons name="check" size={18} color={cargoTheme.colors.primaryDark} />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            {outsideWizardStep === 2 && outsideHandoffMode === 'home' ? (
              <View style={styles.homeAddressPanel}>
                <Text style={styles.outsideEyebrow}>{copy.parcel.homeAddress}</Text>
                <Text style={styles.homeAddressHint}>{outsideHomeAddressHint}</Text>
                {outsideExpressNearAirportPricing ? (
                  <Text style={styles.nearAirportFareHint}>
                    {language === 'sw'
                      ? `Karibu na uwanja wa ndege — bei ${formatTzs(15000)}`
                      : `Near airport — ${formatTzs(15000)}`}
                  </Text>
                ) : outsideExpressHomeDeliveryMandatory && outsideHomeAddressReady ? (
                  <Text style={styles.nearAirportFareHint}>
                    {language === 'sw'
                      ? `Utoaji nyumbani — bei ${formatTzs(18000)}`
                      : `Home delivery — ${formatTzs(18000)}`}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setHomeAddressSheetOpen(true);
                    setShouldFetchSuggestions(true);
                  }}
                  style={({ pressed }) => [
                    styles.homeAddressTrigger,
                    outsideHomeAddressReady ? styles.homeAddressTriggerReady : null,
                    pressed && styles.pressablePressed,
                  ]}>
                  <View
                    style={[
                      styles.homeAddressIconWell,
                      outsideHomeAddressReady ? styles.homeAddressIconWellReady : null,
                    ]}>
                    <MaterialCommunityIcons
                      name={outsideHomeAddressReady ? 'map-marker-check' : 'map-search-outline'}
                      size={20}
                      color={outsideHomeAddressReady ? cargoTheme.colors.primary : '#64748B'}
                    />
                  </View>
                  <View style={styles.homeAddressTriggerCopy}>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.homeAddressTriggerText,
                        !outsideHomeAddressReady ? styles.homeAddressTriggerPlaceholder : null,
                      ]}>
                      {outsideHomeAddressReady ? dropoff : copy.parcel.homeAddressSearch}
                    </Text>
                    {outsideHomeAddressReady ? (
                      <Text style={styles.homeAddressChangeLabel}>{copy.parcel.homeAddressChange}</Text>
                    ) : (
                      <Text style={styles.homeAddressTriggerMeta}>{copy.parcel.homeAddressPlaceholder}</Text>
                    )}
                  </View>
                  <MaterialCommunityIcons
                    name={outsideHomeAddressReady ? 'pencil-outline' : 'chevron-right'}
                    size={20}
                    color="#94A3B8"
                  />
                </Pressable>
              </View>
            ) : null}

            {outsideWizardStep === 2 && showOutsideWeightPanel ? (
              <View style={styles.weightPanel}>
                <View style={styles.weightHeader}>
                  <View style={styles.weightAvatarWell}>
                    <Image source={images.parcelWeightBox} style={styles.weightAvatar} resizeMode="contain" />
                  </View>
                  <View style={styles.weightCopy}>
                    <Text style={styles.outsideEyebrow}>{copy.parcel.weight}</Text>
                    <Text style={styles.weightHint}>
                      {outsideShippingMode === 'express'
                        ? copy.parcel.weightHintExpress
                        : copy.parcel.weightHintStandard}
                    </Text>
                  </View>
                </View>
                <View style={[styles.weightInputShell, outsideWeightTooHeavy ? styles.inputError : null]}>
                  <TextInput
                    value={parcelWeightKg}
                    onChangeText={setParcelWeightKg}
                    placeholder={outsideShippingMode === 'express' ? '2.5' : '12'}
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                    style={styles.weightInput}
                  />
                  <Text style={styles.weightUnit}>kg</Text>
                </View>
                {outsideWeightTooHeavy ? (
                  <Text style={styles.weightError}>
                    {outsideShippingMode === 'express'
                      ? copy.parcel.weightTooHeavyExpress
                      : copy.parcel.weightTooHeavyStandard}
                  </Text>
                ) : (
                  <Text style={styles.weightCap}>
                    {outsideShippingMode === 'express'
                      ? `Up to ${outsideMaxWeightKg} kg`
                      : `Max ${outsideMaxWeightKg} kg`}
                  </Text>
                )}
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

      {showRecipientStep && (selectedScope === 'city' || outsideWizardStep === 2) ? (
        <View style={styles.recipientPanel}>
          <View style={styles.recipientHeader}>
            <View style={styles.recipientAvatarWell}>
              <Image source={images.parcelRecipientPerson} style={styles.recipientAvatar} resizeMode="contain" />
            </View>
            <View style={styles.recipientCopy}>
              <Text style={styles.outsideEyebrow}>{copy.parcel.recipient}</Text>
              <Text style={styles.weightHint}>{copy.parcel.recipientName}</Text>
            </View>
          </View>
          <View style={styles.nameRow}>
            <TextInput
              value={recipientName}
              onChangeText={setRecipientName}
              placeholder={copy.parcel.recipientName}
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.nameInput, styles.premiumInput]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (showContacts) {
                  setShowContacts(false);
                  return;
                }
                void openContactsPicker();
              }}
              style={({ pressed }) => [styles.contactIconButton, pressed && styles.pressablePressed]}>
              <MaterialCommunityIcons name="account-plus-outline" size={20} color={cargoTheme.colors.primaryDark} />
            </Pressable>
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

      {showRecipientStep && (selectedScope === 'city' || outsideWizardStep === 2) ? (
        <View style={styles.valueLegalStack}>
          <View style={styles.weightPanel}>
            <View style={styles.weightHeader}>
              <View style={styles.weightAvatarWell}>
                <Image source={images.parcelWeightBox} style={styles.weightAvatar} resizeMode="contain" />
              </View>
              <View style={styles.weightCopy}>
                <Text style={styles.outsideEyebrow}>{copy.parcel.declaredValue}</Text>
                <Text style={styles.weightHint}>{copy.parcel.declaredValueHint}</Text>
              </View>
            </View>
            <View style={styles.weightInputShell}>
              <Text style={styles.weightUnit}>TZS</Text>
              <TextInput
                value={declaredValueTzs}
                onChangeText={(text) => setDeclaredValueTzs(formatDeclaredValueInput(text))}
                placeholder={copy.parcel.declaredValuePlaceholder}
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                style={styles.weightInput}
              />
            </View>
          </View>

          {selectedScope === 'city' ? (
          <View style={styles.legalPanel}>
            <Text style={styles.legalTitle}>{copy.parcel.legalTitle}</Text>
            <Text style={styles.legalBody}>{copy.parcel.legalBody}</Text>
            <Text style={styles.legalExamples}>{copy.parcel.legalExamples}</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: contentsLawAccepted }}
              onPress={() => setContentsLawAccepted((current) => !current)}
              style={({ pressed }) => [
                styles.legalCheckboxRow,
                contentsLawAccepted ? styles.legalCheckboxRowOn : null,
                pressed && styles.pressablePressed,
              ]}>
              <View style={[styles.legalCheckbox, contentsLawAccepted ? styles.legalCheckboxOn : null]}>
                {contentsLawAccepted ? (
                  <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
                ) : null}
              </View>
              <Text style={styles.legalCheckboxLabel}>{copy.parcel.legalCheckbox}</Text>
            </Pressable>
          </View>
          ) : null}
        </View>
      ) : null}

      {selectedScope === 'outside' && outsideWizardStep === 3 ? (
        <View style={styles.legalConfirmPage}>
          <Text style={styles.legalConfirmKicker}>
            {language === 'sw' ? 'Hatua ya mwisho' : 'Final step'}
          </Text>
          <Text style={styles.legalConfirmTitle}>
            {language === 'sw' ? 'Thibitisha masharti' : 'Accept the terms'}
          </Text>
          <Text style={styles.legalConfirmLead}>{copy.parcel.legalBody}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => setLegalTermsOpen(true)}
            style={({ pressed }) => [styles.legalTermsLink, pressed && styles.pressablePressed]}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={cargoTheme.colors.primaryDark} />
            <Text style={styles.legalTermsLinkText}>
              {language === 'sw' ? 'Soma masharti kamili' : 'Read full terms'}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" />
          </Pressable>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: contentsLawAccepted }}
            onPress={() => setContentsLawAccepted((current) => !current)}
            style={({ pressed }) => [
              styles.legalCheckboxRow,
              styles.legalConfirmCheck,
              contentsLawAccepted ? styles.legalCheckboxRowOn : null,
              pressed && styles.pressablePressed,
            ]}>
            <View style={[styles.legalCheckbox, contentsLawAccepted ? styles.legalCheckboxOn : null]}>
              {contentsLawAccepted ? (
                <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
              ) : null}
            </View>
            <Text style={styles.legalCheckboxLabel}>{copy.parcel.legalCheckbox}</Text>
          </Pressable>
        </View>
      ) : null}
    </CargoScreen>
    )}

    <Modal
      visible={homeAddressSheetOpen}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={() => {
        setHomeAddressSheetOpen(false);
        setShouldFetchSuggestions(false);
      }}>
      <View style={styles.homeAddressSheetRoot}>
        <Pressable
          accessibilityRole="button"
          style={styles.homeAddressSheetBackdrop}
          onPress={() => {
            setHomeAddressSheetOpen(false);
            setShouldFetchSuggestions(false);
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          style={styles.homeAddressSheetAvoider}>
          <View
            style={[
              styles.homeAddressSheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                marginBottom: Platform.OS === 'android' ? homeAddressKeyboardHeight : 0,
              },
            ]}>
            <View style={styles.homeAddressSheetHandle} />
            <View style={styles.homeAddressSheetHeader}>
              <View style={styles.homeAddressSheetHeaderCopy}>
                <Text style={styles.homeAddressSheetTitle}>{copy.parcel.homeAddress}</Text>
                <Text style={styles.homeAddressSheetSubtitle}>{outsideHomeAddressHint}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  setHomeAddressSheetOpen(false);
                  setShouldFetchSuggestions(false);
                }}
                style={({ pressed }) => [styles.homeAddressSheetClose, pressed && styles.pressablePressed]}>
                <MaterialCommunityIcons name="close" size={20} color="#475569" />
              </Pressable>
            </View>

            <View style={styles.homeAddressSheetInputShell}>
              <MaterialCommunityIcons name="magnify" size={20} color="#64748B" />
              <TextInput
                value={dropoff}
                onChangeText={handleDropoffChange}
                placeholder={copy.parcel.homeAddressPlaceholder}
                placeholderTextColor="#94A3B8"
                style={styles.homeAddressSheetInput}
                autoFocus
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.homeAddressSheetResults}
              contentContainerStyle={styles.homeAddressSheetResultsContent}>
              <LocationSuggestionsList
                suggestions={dropoffSuggestions}
                loading={loadingSuggestions}
                loadingLabel={copy.parcel.homeAddressSearching}
                emptyLabel={copy.parcel.homeAddressEmpty}
                showEmpty={dropoff.trim().length >= 3 && !loadingSuggestions}
                embedded
                headerLabel={copy.parcel.homeAddress}
                onSelect={(suggestion) => {
                  void handleSelectDropoffSuggestion(suggestion);
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>

    <Modal
      visible={legalTermsOpen}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={() => setLegalTermsOpen(false)}>
      <View style={styles.legalSheetRoot}>
        <Pressable
          accessibilityRole="button"
          style={styles.legalSheetBackdrop}
          onPress={() => setLegalTermsOpen(false)}
        />
        <View style={styles.legalSheetCard}>
          <View style={styles.legalSheetHandle} />
          <View style={styles.legalSheetHeader}>
            <Text style={styles.legalSheetTitle}>
              {language === 'sw' ? 'Masharti ya mzigo' : 'Parcel terms'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setLegalTermsOpen(false)}
              hitSlop={10}
              style={({ pressed }) => [styles.homeAddressSheetClose, pressed && styles.pressablePressed]}>
              <MaterialCommunityIcons name="close" size={20} color="#475569" />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.legalSheetBody}>
            <Text style={styles.legalSheetHeading}>{copy.parcel.legalTitle}</Text>
            <Text style={styles.legalSheetParagraph}>{copy.parcel.legalBody}</Text>
            <Text style={styles.legalSheetHeading}>{copy.parcel.legalExamplesTitle}</Text>
            <Text style={styles.legalSheetParagraph}>{copy.parcel.legalExamples}</Text>
            <Text style={styles.legalSheetHeading}>
              {language === 'sw' ? 'Jukumu la mtumaji' : 'Sender responsibility'}
            </Text>
            <Text style={styles.legalSheetParagraph}>{copy.parcel.legalCheckbox}</Text>
            <Text style={styles.legalSheetParagraph}>
              {language === 'sw'
                ? 'DoorDrop inaweza kukagua mzigo unaoshukiwa na kuwasiliana na mamlaka inapohitajika. Usitume dawa za kulevya, silaha, milipuko, kemikali hatari, au bidhaa bandia.'
                : 'DoorDrop may inspect suspicious parcels and contact the authorities if needed. Do not send drugs, weapons, explosives, hazardous chemicals, or counterfeit goods.'}
            </Text>
          </ScrollView>
          <PrimaryButton
            label={language === 'sw' ? 'Sawa, nimeelewa' : 'Got it'}
            onPress={() => setLegalTermsOpen(false)}
          />
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 12,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8EEF3',
  },
  footerSummary: {
    marginBottom: 6,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
    textAlign: 'center',
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
    gap: 22,
  },
  outsideSection: {
    gap: 10,
  },
  expressCompactSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#FFF9CC',
    borderWidth: 1,
    borderColor: '#FFE500',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expressCompactSummaryText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  outsideEyebrow: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: typography.semibold,
    color: '#94A3B8',
  },
  outsideHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#64748B',
    paddingHorizontal: 4,
  },
  mandatoryHomeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: '#FFF9CC',
    borderWidth: 1,
    borderColor: '#FFE500',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mandatoryHomeNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.body,
    color: '#111827',
  },
  nearAirportFareHint: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  pressablePressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  modeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  contentWithSuggestions: {
    paddingBottom: 48,
  },
  expressBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  expressBadgeIcon: {
    width: 14,
    height: 14,
  },
  expressBadgeText: {
    fontSize: 9,
    letterSpacing: 0.6,
    fontFamily: typography.bold,
    color: '#FFFFFF',
  },
  expressSpeedValue: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
    textAlign: 'center',
    marginTop: 2,
  },
  modeCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8EEF2',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 14,
    gap: 6,
    overflow: 'visible',
  },
  modeCardActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#FFF9CC',
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  modeCardUnavailable: {
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    opacity: 0.94,
  },
  modeUnavailableHint: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  unavailableAction: {
    marginTop: 10,
    alignSelf: 'stretch',
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  unavailableActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.bold,
    color: '#1D4ED8',
    textAlign: 'center',
  },
  modeAvatarWell: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    marginBottom: 4,
  },
  modeAvatar: {
    width: 48,
    height: 48,
  },
  modeTitle: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: '#0F172A',
    textAlign: 'center',
  },
  modeSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
    textAlign: 'center',
    minHeight: 32,
  },
  modeMetaRow: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EEF2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modePrice: {
    flex: 1,
    fontSize: 11,
    fontFamily: typography.semibold,
    color: '#475569',
  },
  modeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  modeRadioActive: {
    borderColor: cargoTheme.colors.primary,
  },
  modeRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: cargoTheme.colors.primary,
  },
  homeAddressPanel: {
    marginBottom: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF2',
    padding: 14,
    gap: 8,
  },
  homeAddressHint: {
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#64748B',
    marginBottom: 4,
  },
  homeAddressTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  homeAddressTriggerReady: {
    borderColor: '#FFE500',
    backgroundColor: '#FFF9CC',
  },
  homeAddressIconWell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  homeAddressIconWellReady: {
    borderColor: '#FFE500',
    backgroundColor: '#FFF9CC',
  },
  homeAddressTriggerCopy: {
    flex: 1,
    gap: 2,
  },
  homeAddressTriggerText: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  homeAddressTriggerPlaceholder: {
    color: '#0F172A',
  },
  homeAddressTriggerMeta: {
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#94A3B8',
  },
  homeAddressChangeLabel: {
    fontSize: 12,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primary,
  },
  homeAddressSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  homeAddressSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  homeAddressSheetAvoider: {
    width: '100%',
  },
  homeAddressSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: '88%',
  },
  homeAddressSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    marginBottom: 12,
  },
  homeAddressSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  homeAddressSheetHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  homeAddressSheetTitle: {
    fontSize: 18,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  homeAddressSheetSubtitle: {
    fontSize: 13,
    fontFamily: typography.medium,
    color: '#64748B',
  },
  homeAddressSheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  homeAddressSheetInputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  homeAddressSheetInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: typography.medium,
    color: '#0F172A',
    paddingVertical: 12,
  },
  homeAddressSheetResults: {
    maxHeight: 360,
  },
  homeAddressSheetResultsContent: {
    paddingBottom: 8,
  },
  optionList: {
    gap: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EEF2',
    backgroundColor: '#FFFFFF',
  },
  optionRowActive: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#FFF9CC',
  },
  optionAvatar: {
    width: 40,
    height: 40,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 14,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  optionMeta: {
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#64748B',
  },
  hubList: {
    gap: 8,
    marginTop: 4,
  },
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  hubRowActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFE500',
  },
  hubIconWell: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  hubIconWellActive: {
    backgroundColor: '#FFF9CC',
  },
  hubRowText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.medium,
    color: '#334155',
  },
  hubRowTextActive: {
    color: '#0F172A',
    fontFamily: typography.semibold,
  },
  weightPanel: {
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    padding: 14,
    gap: 4,
  },
  weightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  weightAvatarWell: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  weightAvatar: {
    width: 34,
    height: 34,
  },
  weightCopy: {
    flex: 1,
    gap: 2,
  },
  weightHint: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.body,
    color: '#64748B',
  },
  weightInputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF2',
    paddingHorizontal: 14,
  },
  weightInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: typography.semibold,
    color: '#0F172A',
    paddingVertical: 12,
  },
  weightUnit: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: '#94A3B8',
    marginLeft: 8,
  },
  weightCap: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: typography.medium,
    color: '#94A3B8',
  },
  weightError: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: typography.semibold,
    color: '#DC2626',
  },
  valueLegalStack: {
    gap: 12,
    marginBottom: 12,
  },
  legalPanel: {
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 8,
  },
  legalTitle: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: '#0F172A',
  },
  legalBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: typography.body,
    color: '#475569',
  },
  legalExamplesTitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: typography.bold,
    color: '#64748B',
  },
  legalExamples: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: typography.body,
    color: '#64748B',
  },
  legalCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  legalCheckboxRowOn: {
    borderColor: cargoTheme.colors.primary,
    backgroundColor: '#FFF9CC',
  },
  legalCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginTop: 1,
  },
  legalCheckboxOn: {
    backgroundColor: cargoTheme.colors.primary,
    borderColor: cargoTheme.colors.primary,
  },
  legalCheckboxLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#0F172A',
  },
  inputError: {
    borderColor: '#FCA5A5',
  },
  recipientPanel: {
    marginBottom: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EEF2',
    padding: 14,
  },
  recipientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  recipientAvatarWell: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  recipientAvatar: {
    width: 32,
    height: 32,
  },
  recipientCopy: {
    flex: 1,
    gap: 2,
  },
  premiumInput: {
    borderWidth: 1,
    borderColor: '#E8EEF2',
    backgroundColor: '#FFFFFF',
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
    borderColor: '#FFE500',
    backgroundColor: '#FFF9CC',
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
    borderColor: '#FFE500',
    backgroundColor: '#FFF9CC',
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
    borderColor: '#FFF9CC',
    backgroundColor: '#FFF9CC',
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
    borderColor: '#FFE500',
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
    backgroundColor: '#FFF9CC',
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
    backgroundColor: '#FFF9CC',
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
    backgroundColor: '#FFF9CC',
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
  requestedDriverCard: {
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: '#FFF9CC',
    borderWidth: 1,
    borderColor: '#FFE500',
    padding: 14,
    gap: 4,
  },
  scheduleBanner: {
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: '#FFF9CC',
    borderWidth: 1,
    borderColor: '#FFE500',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scheduleBannerCopy: {
    flex: 1,
  },
  scheduleBannerTitle: {
    fontFamily: typography.bold,
    color: '#111827',
    fontSize: 13,
    lineHeight: 18,
  },
  scheduleBannerText: {
    marginTop: 2,
    fontFamily: typography.semibold,
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
  },
  requestedDriverTitle: {
    fontFamily: typography.bold,
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
  },
  requestedDriverText: {
    fontFamily: typography.body,
    color: '#111827',
    fontSize: 13,
    lineHeight: 18,
  },
  outsideRouteSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  outsideRouteSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  outsideRouteSummaryEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.medium,
    color: '#6B7280',
  },
  outsideRouteSummaryText: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.bold,
    color: '#111827',
  },
  legalConfirmPage: {
    marginTop: 8,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    gap: 12,
  },
  legalConfirmKicker: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  legalConfirmTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: typography.extrabold,
    color: '#111827',
    letterSpacing: -0.4,
  },
  legalConfirmLead: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: typography.body,
    color: '#4B5563',
  },
  legalTermsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#F3F5F4',
    paddingHorizontal: 14,
  },
  legalTermsLinkText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: typography.semibold,
    color: cargoTheme.colors.primaryDark,
  },
  legalConfirmCheck: {
    marginTop: 4,
  },
  legalSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  legalSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.4)',
  },
  legalSheetCard: {
    maxHeight: '82%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  legalSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 12,
  },
  legalSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  legalSheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: typography.extrabold,
    color: '#111827',
  },
  legalSheetBody: {
    paddingBottom: 20,
    gap: 10,
  },
  legalSheetHeading: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: typography.bold,
    color: '#111827',
  },
  legalSheetParagraph: {
    fontSize: 15,
    lineHeight: 23,
    fontFamily: typography.body,
    color: '#4B5563',
  },
});
