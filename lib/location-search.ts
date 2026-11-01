import {
  buildFrontendPricingEstimate,
  normalizeDoorDropVehicleType,
  roundToCustomerFare,
  type CargoSize,
  type DoorDropPricingScope,
  type DoorDropVehicleType,
} from '@/lib/cargo-pricing';
import {
  recordDoorDropApiError,
  recordDoorDropApiRequest,
  recordDoorDropApiResponse,
  syncDoorDropApiRuntimeConfig,
} from '@/lib/api-debug';
import {
  ensureDoorDropApiBaseUrl,
  getDoorDropApiRuntimeConfig,
  isDoorDropBackendCoolingDown,
  markDoorDropBackendFailure,
  markDoorDropBackendHealthy,
} from '@/lib/api-config';
import { logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import { getGoogleMapsApiKey } from '@/lib/maps-config';
import { isNetworkError } from '@/lib/network-status';
import {
  buildGooglePlaceLabel,
  formatExactCoordinateLabel,
  formatExpoGeocodedLabel,
  hasStreetLevelComponents,
  isCoordinateLikeLabel,
  isStreetLevelPrecision,
  isWeakPlaceName,
  sanitizeSuggestionPresentation,
  scoreGeocodePrecision,
  scorePlaceLabelPrecision,
} from '@/lib/place-labels';
import { fetchFallbackSuggestions, searchLocalPlaces } from '@/lib/places-fallback';
import { fetchRoadFollowingRoute } from '@/lib/road-route';
import { decodePolyline, filterValidCoordinates, getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';
import { filterSuggestionsToServiceCity } from '@/lib/service-cities';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

const screenScope = 'DoorDropLocationSearch';

export type RouteEstimateVehicleType = DoorDropVehicleType;
export type RouteEstimateCargoSize = CargoSize;
export type RouteEstimatePricingScope = DoorDropPricingScope;

export type LocationSuggestion = {
  id: string;
  placeId: string;
  name: string;
  address: string;
  featureType: string;
  fullText: string;
  types?: string[];
  coordinates?: RoutePoint;
};

export type RetrievedLocation = {
  label: string;
  address: string;
  point: RoutePoint;
  suggestion?: LocationSuggestion;
};

export type RouteEstimate = {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  polyline: string;
  coordinates: RoutePoint[];
  price?: number | null;
  pricingEstimate?: PricingEstimate | null;
};

export type PricingEstimate = {
  vehicleType: RouteEstimateVehicleType;
  distanceKm: number;
  estimatedPrice: number;
  currency: string;
  cargoSize?: RouteEstimateCargoSize | null;
  cargoMultiplier?: number;
  source?: 'backend' | 'frontend-fallback';
  warning?: string | null;
  pricing: {
    baseFare: number;
    pricePerKm: number;
    timeBufferPerKm?: number;
    sizeExtraRatePerKm?: number;
    minimumFare: number;
    rawPrice: number;
    adjustedRawPrice?: number;
  };
};

type AutocompleteResponse = {
  suggestions?: {
    id?: string;
    placeId?: string;
    name?: string;
    address?: string;
    fullText?: string;
    featureType?: string;
    types?: string[] | null;
    latitude?: number | string;
    longitude?: number | string;
    coordinates?: Partial<RoutePoint> | null;
    placePrediction?: {
      placeId?: string;
      text?: {
        text?: string;
      } | null;
      structuredFormat?: {
        mainText?: {
          text?: string;
        } | null;
        secondaryText?: {
          text?: string;
        } | null;
      } | null;
      types?: string[] | null;
    } | null;
  }[];
};

type ResolvedPlaceResponse = {
  id?: string;
  placeId?: string;
  name?: string;
  title?: string;
  address?: string;
  fullText?: string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  point?: (Partial<RoutePoint> & { lat?: number | string; lng?: number | string }) | null;
  coordinates?: (Partial<RoutePoint> & { lat?: number | string; lng?: number | string }) | null;
  location?: (Partial<RoutePoint> & { lat?: number | string; lng?: number | string }) | null;
};

type RawPricingEstimate = Partial<PricingEstimate> & {
  pricing?: Partial<PricingEstimate['pricing']> | null;
};

type RouteEstimateResponse = {
  distanceMeters?: number;
  distanceKm?: number;
  distance_km?: number | string;
  distance?: number | string;
  km?: number | string;
  durationSeconds?: number;
  duration_seconds?: number | string;
  polyline?: string;
  coordinates?: RoutePoint[];
  price?: number | null;
  pricingEstimate?: RawPricingEstimate | null;
};
type PricingEstimateResponse = RawPricingEstimate;

type FetchRouteEstimateOptions = {
  vehicleType?: RouteEstimateVehicleType;
  cargoSize?: RouteEstimateCargoSize;
  pricingScope?: RouteEstimatePricingScope;
};

type DoorDropRequestDebug = {
  kind: 'backend-health' | 'places-autocomplete' | 'place-details' | 'place-resolve' | 'routes-estimate' | 'pricing-estimate';
  requestBody?: unknown;
  timeoutMs?: number;
};

type FetchErrorDetails = {
  name: string;
  message: string;
  rawError: unknown;
  userMessage: string;
};

const REQUEST_TIMEOUT_MS = 15000;
/** Must exceed backend Routes ~30s timeout + network slack. */
const ROUTES_ESTIMATE_TIMEOUT_MS = 35000;
const PLACES_BACKEND_TIMEOUT_MS = 3000;
const REVERSE_GEOCODE_CACHE_TTL_MS = 15 * 60 * 1000;

type CachedReverseGeocode = {
  value: Omit<RetrievedLocation, 'suggestion'>;
  at: number;
};

const reverseGeocodeCache = new Map<string, CachedReverseGeocode>();

function reverseGeocodeCacheKey(point: RoutePoint) {
  return `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
}

function readReverseGeocodeCache(point: RoutePoint) {
  const cached = reverseGeocodeCache.get(reverseGeocodeCacheKey(point));
  if (!cached || Date.now() - cached.at > REVERSE_GEOCODE_CACHE_TTL_MS) {
    return null;
  }

  return cached.value;
}

function writeReverseGeocodeCache(point: RoutePoint, value: Omit<RetrievedLocation, 'suggestion'>) {
  reverseGeocodeCache.set(reverseGeocodeCacheKey(point), {
    value,
    at: Date.now(),
  });
}

export function getInstantLocationSuggestions(query: string, origin?: RoutePoint, limit = 8) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [] as LocationSuggestion[];
  }

  const localMatches = searchLocalPlaces(trimmedQuery, limit, origin).map((suggestion) => ({
    ...suggestion,
  })) as LocationSuggestion[];

  return filterSuggestionsToServiceCity(localMatches, origin, limit);
}

type LooseRoutePoint = {
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function summarizeForLog(value: unknown) {
  if (value === undefined || value === null) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 1200 ? `${serialized.slice(0, 1200)}...` : value;
  } catch {
    return String(value);
  }
}

function normalizeRawErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === 'string') {
    return error.trim();
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = String((error as { message?: unknown }).message ?? '').trim();
    if (value) {
      return value;
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error ?? '');
  }
}

function isPrivateOrLocalHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '10.0.2.2' ||
    normalizedHostname.endsWith('.local')
  ) {
    return true;
  }

  const ipv4Match = normalizedHostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) {
    return false;
  }

  const firstOctet = Number(ipv4Match[1]);
  const secondOctet = Number(ipv4Match[2]);

  return (
    firstOctet === 10 ||
    firstOctet === 127 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168) ||
    (firstOctet === 169 && secondOctet === 254)
  );
}

function getFetchErrorDetails(input: string, error: unknown): FetchErrorDetails {
  const rawMessage = normalizeRawErrorMessage(error);
  const name =
    error instanceof Error
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name ?? '').trim()
        : '';
  const hostname = (() => {
    try {
      return new URL(input).hostname;
    } catch {
      return '';
    }
  })();
  const combined = `${name} ${rawMessage}`.trim();
  const lowercase = combined.toLowerCase();

  let userMessage = rawMessage || 'Unable to reach the DoorDrop backend.';

  if (lowercase.includes('cleartext')) {
    userMessage =
      'Android blocked the HTTP request: CLEARTEXT communication not permitted. Rebuild the APK with cleartext traffic enabled.';
  } else if (name === 'AbortError' || lowercase.includes('timeout') || lowercase.includes('timed out')) {
    userMessage =
      `DoorDrop backend request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`;
  } else if (isPrivateOrLocalHostname(hostname)) {
    userMessage =
      'This APK is pointing to a private/local backend address. Deploy the DoorDrop backend to a public HTTPS URL, set EXPO_PUBLIC_API_BASE_URL to that URL, then rebuild the APK.';
  } else if (lowercase.includes('network request failed')) {
    userMessage =
      'Android native fetch failed before any HTTP response was received. Confirm EXPO_PUBLIC_API_BASE_URL is a reachable public HTTPS backend URL and rebuild the APK after changing it.';
  } else if (lowercase.includes('typeerror')) {
    userMessage = rawMessage || 'TypeError while contacting the DoorDrop backend.';
  } else if (!userMessage) {
    userMessage =
      'Unable to reach the DoorDrop backend. Check Android network security settings and confirm the backend server is reachable from the phone.';
  }

  return {
    name,
    message: rawMessage,
    rawError: error,
    userMessage,
  };
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPoint(
  value: LooseRoutePoint | null | undefined
) {
  const latitude = normalizeNumber(value?.latitude ?? value?.lat);
  const longitude = normalizeNumber(value?.longitude ?? value?.lng);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
  } satisfies RoutePoint;
}

function createFrontendEstimate(
  distanceMeters: number,
  vehicleType: RouteEstimateVehicleType,
  cargoSize?: RouteEstimateCargoSize,
  pricingScope?: RouteEstimatePricingScope,
  durationSeconds?: number | null
): PricingEstimate {
  const canonicalVehicleType = normalizeDoorDropVehicleType(vehicleType);
  const estimate = buildFrontendPricingEstimate({
    distanceMeters,
    vehicleType: canonicalVehicleType,
    cargoSize,
    pricingScope,
    durationSeconds,
  });

  return {
    ...estimate,
    cargoSize: estimate.cargoSize ?? null,
  } satisfies PricingEstimate;
}

function getPayloadDistanceMeters(payload: RouteEstimateResponse) {
  const explicitMeters = normalizeNumber(payload.distanceMeters);
  if (explicitMeters !== null && explicitMeters > 0) {
    return explicitMeters;
  }

  const kilometers =
    normalizeNumber(payload.distanceKm) ??
    normalizeNumber(payload.distance_km) ??
    normalizeNumber(payload.km) ??
    normalizeNumber(payload.distance);

  return kilometers !== null && kilometers > 0 ? Math.round(kilometers * 1000) : null;
}

function estimateDurationSecondsFromDistance(distanceMeters: number) {
  const averageMetersPerSecond = 9.7;
  return Math.max(600, Math.round(distanceMeters / averageMetersPerSecond));
}

/**
 * Geometry-only helper for map drawing. Never used for Haul pricing —
 * Directions/OSRM must not silently replace Google Routes meters/ETA.
 * distanceMeters/durationSeconds are forced to 0 so callers cannot price this.
 */
function createGeometryOnlyRouteEstimate(
  road: { coordinates: RoutePoint[]; polyline?: string; distanceMeters?: number; durationSeconds?: number }
): RouteEstimate {
  if (!road?.coordinates || road.coordinates.length < 3) {
    throw new Error('No road geometry available.');
  }

  return {
    distanceMeters: 0,
    distanceKm: 0,
    durationSeconds: 0,
    polyline: road.polyline ?? '',
    coordinates: road.coordinates,
    price: null,
    pricingEstimate: null,
  };
}

function isRouteEstimateTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(message) ||
    /ROUTES_TIMEOUT/i.test(message)
  );
}

function recordFrontendParseIssue(url: string, error: unknown, body?: unknown, status?: number | null) {
  recordDoorDropApiError({
    url,
    kind: 'frontend_parse_error',
    status: status ?? null,
    body,
    error,
  });
}

function normalizePricingEstimate(
  payload: RawPricingEstimate | null | undefined,
  fallback: PricingEstimate | null
): PricingEstimate | null {
  if (!payload) {
    return null;
  }

  const estimatedPrice = normalizeNumber(payload.estimatedPrice);
  if (estimatedPrice === null) {
    return null;
  }

  const fallbackPricing = fallback?.pricing;
  const payloadPricing: Partial<PricingEstimate['pricing']> = payload.pricing ?? {};
  const pricing = {
    baseFare: normalizeNumber(payloadPricing.baseFare) ?? fallbackPricing?.baseFare ?? 0,
    pricePerKm: normalizeNumber(payloadPricing.pricePerKm) ?? fallbackPricing?.pricePerKm ?? 0,
    timeBufferPerKm:
      normalizeNumber(payloadPricing.timeBufferPerKm) ?? fallbackPricing?.timeBufferPerKm ?? 0,
    sizeExtraRatePerKm:
      normalizeNumber(payloadPricing.sizeExtraRatePerKm) ?? fallbackPricing?.sizeExtraRatePerKm ?? 0,
    minimumFare: normalizeNumber(payloadPricing.minimumFare) ?? fallbackPricing?.minimumFare ?? 0,
    rawPrice: normalizeNumber(payloadPricing.rawPrice) ?? fallbackPricing?.rawPrice ?? Math.max(0, Math.round(estimatedPrice)),
    adjustedRawPrice:
      normalizeNumber(payloadPricing.adjustedRawPrice) ??
      fallbackPricing?.adjustedRawPrice ??
      normalizeNumber(payloadPricing.rawPrice) ??
      Math.max(0, Math.round(estimatedPrice)),
  };

  const vehicleType = normalizeDoorDropVehicleType(String(payload.vehicleType || fallback?.vehicleType || 'toyo').trim() || 'toyo');

  return {
    vehicleType,
    distanceKm: Number(
      (
        normalizeNumber(payload.distanceKm) ??
        fallback?.distanceKm ??
        0
      ).toFixed(2)
    ),
    estimatedPrice: roundToCustomerFare(estimatedPrice),
    currency: typeof payload.currency === 'string' && payload.currency.trim() ? payload.currency.trim() : fallback?.currency ?? 'TZS',
    cargoSize: (payload.cargoSize ?? fallback?.cargoSize ?? null) as RouteEstimateCargoSize | null,
    cargoMultiplier: normalizeNumber(payload.cargoMultiplier) ?? fallback?.cargoMultiplier ?? 1,
    source: 'backend',
    warning: null,
    pricing,
  } satisfies PricingEstimate;
}

function normalizeResolvedLocation(
  payload: ResolvedPlaceResponse,
  suggestion: Pick<LocationSuggestion, 'id' | 'placeId' | 'name' | 'address' | 'featureType' | 'fullText'>
): RetrievedLocation {
  const point =
    extractPoint(payload) ??
    extractPoint(payload.point) ??
    extractPoint(payload.coordinates) ??
    extractPoint(payload.location);

  if (!point) {
    throw new Error('DoorDrop place lookup returned no coordinates for this destination.');
  }

  const placeId = String(payload.placeId ?? payload.id ?? suggestion.placeId).trim() || suggestion.placeId;
  const id = String(payload.id ?? placeId).trim() || placeId;
  const rawName = String(payload.name ?? payload.title ?? suggestion.name ?? '').trim();
  const rawAddress = String(payload.address ?? payload.fullText ?? suggestion.address ?? '').trim();
  const presentation = sanitizeSuggestionPresentation(rawName, rawAddress, suggestion.fullText);
  const name = presentation.name;
  const address = presentation.address;
  const fullText = presentation.fullText || [name, address].filter(Boolean).join(', ') || suggestion.fullText;

  return {
    label: name,
    address,
    point,
    suggestion: {
      id,
      placeId,
      name,
      address,
      featureType: suggestion.featureType || 'place',
      fullText,
      coordinates: point,
    },
  } satisfies RetrievedLocation;
}

function buildRequestUrl(pathname: string, params?: Record<string, string | number | undefined | null>) {
  syncDoorDropApiRuntimeConfig(getDoorDropApiRuntimeConfig());
  const url = new URL(`${ensureDoorDropApiBaseUrl()}${pathname}`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function requestJson<T>(input: string, init?: RequestInit, debug?: DoorDropRequestDebug) {
  const requestMethod = (init?.method ?? 'GET').toUpperCase();

  if (debug) {
    recordDoorDropApiRequest({
      kind: debug.kind,
      method: requestMethod,
      url: input,
      body: debug.requestBody,
    });
  }

  logInfo(screenScope, 'backendRequest', {
    kind: debug?.kind ?? 'unknown',
    method: requestMethod,
    url: input,
    body: summarizeForLog(debug?.requestBody ?? null),
  });

  let response: Response;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = debug?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutId =
    controller && typeof setTimeout === 'function'
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    response = await fetch(input, {
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      signal: controller?.signal,
      ...init,
    });
  } catch (error) {
    const details = getFetchErrorDetails(input, error);
    const debugContext = {
      kind: debug?.kind ?? 'unknown',
      method: requestMethod,
      url: input,
      platform: Platform.OS,
      apiBaseUrl: getDoorDropApiRuntimeConfig().resolvedApiBaseUrl,
      usesHttp: /^http:\/\//i.test(input),
      hostname: (() => {
        try {
          return new URL(input).hostname;
        } catch {
          return '';
        }
      })(),
      message: details.userMessage,
      rawMessage: details.message,
      errorName: details.name,
    };

    logWarning(screenScope, 'backendRequest network failure', {
      ...debugContext,
    });

    markDoorDropBackendFailure();
    throw new Error(details.userMessage);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }

  const rawBody = await response.text();
  const trimmedRawBody = rawBody.trim();
  let payload: (T & { error?: string; message?: string }) | null = null;

  logInfo(screenScope, 'backendResponseStatus', {
    kind: debug?.kind ?? 'unknown',
    method: requestMethod,
    url: input,
    status: response.status,
    ok: response.ok,
  });

  logInfo(screenScope, 'backendResponseRawText', {
    kind: debug?.kind ?? 'unknown',
    url: input,
    status: response.status,
    rawText: summarizeForLog(trimmedRawBody || '<empty>'),
  });

  if (!trimmedRawBody) {
    recordDoorDropApiResponse({
      url: input,
      status: response.status,
      statusLabel: `${response.status} EMPTY_RESPONSE`,
      rawText: '',
      parsedBody: null,
    });

    if (response.ok) {
      logWarning(screenScope, 'backendEmptyResponse', {
        kind: debug?.kind ?? 'unknown',
        url: input,
        status: response.status,
      });
      throw new Error('LOCATION_SERVICE_UNAVAILABLE');
    }
  } else {
    try {
      payload = JSON.parse(trimmedRawBody) as T & { error?: string; message?: string };
      logInfo(screenScope, 'backendResponseParsedJson', {
        kind: debug?.kind ?? 'unknown',
        url: input,
        status: response.status,
        parsedBody: summarizeForLog(payload),
      });
      recordDoorDropApiResponse({
        url: input,
        status: response.status,
        statusLabel: response.ok ? `${response.status} OK` : `${response.status} HTTP_ERROR`,
        rawText: trimmedRawBody,
        parsedBody: payload,
      });
    } catch {
      recordDoorDropApiResponse({
        url: input,
        status: response.status,
        statusLabel: `${response.status} INVALID_JSON`,
        rawText: trimmedRawBody,
        parsedBody: null,
      });

      logWarning(screenScope, 'backendNonJsonResponse', {
        kind: debug?.kind ?? 'unknown',
        url: input,
        status: response.status,
      });
      markDoorDropBackendFailure();
      throw new Error('LOCATION_SERVICE_UNAVAILABLE');
    }
  }

  if (!response.ok) {
    const errorMessage = payload?.error || payload?.message || `DoorDrop API request failed with ${response.status}`;
    logWarning(screenScope, 'backendHttpError', {
      kind: debug?.kind ?? 'unknown',
      url: input,
      status: response.status,
      message: errorMessage,
    });
    if (response.status >= 500) {
      markDoorDropBackendFailure();
    }
    throw new Error(response.status >= 500 ? 'LOCATION_SERVICE_UNAVAILABLE' : errorMessage);
  }

  markDoorDropBackendHealthy();
  return (payload ?? {}) as T;
}

function uniqueLocationSuggestions(suggestions: LocationSuggestion[], limit: number) {
  const seen = new Set<string>();
  const unique: LocationSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.placeId}::${suggestion.name}`.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(suggestion);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function suggestionTypes(suggestion: LocationSuggestion) {
  if (Array.isArray(suggestion.types) && suggestion.types.length) {
    return suggestion.types;
  }
  return suggestion.featureType ? [suggestion.featureType] : [];
}

function isStreetLikeSuggestion(suggestion: LocationSuggestion) {
  return suggestionTypes(suggestion).some((type) =>
    ['route', 'street_address', 'intersection', 'premise', 'subpremise'].includes(type)
  );
}

function sortStreetFirst(suggestions: LocationSuggestion[]) {
  return [...suggestions].sort((left, right) => {
    const leftStreet = isStreetLikeSuggestion(left) ? 0 : 1;
    const rightStreet = isStreetLikeSuggestion(right) ? 0 : 1;
    if (leftStreet !== rightStreet) {
      return leftStreet - rightStreet;
    }
    return scoreGeocodePrecision(suggestionTypes(right)) - scoreGeocodePrecision(suggestionTypes(left));
  });
}

export function createSearchSessionToken() {
  return `dd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function geocodeQueryToSuggestions(query: string): Promise<LocationSuggestion[]> {
  try {
    const results = await Location.geocodeAsync(query);
    return results
      .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .slice(0, 4)
      .map((item, index) => {
        const placeId = `geo:${item.latitude},${item.longitude}:${index}`;
        return {
          id: placeId,
          placeId,
          name: query,
          address: query,
          fullText: query,
          featureType: 'geocode',
          coordinates: {
            latitude: item.latitude,
            longitude: item.longitude,
          },
        } satisfies LocationSuggestion;
      });
  } catch {
    return [];
  }
}

export async function fetchLocationSuggestions(query: string, sessionToken: string, origin?: RoutePoint, limit = 8) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) {
    return [];
  }

  // Soft city hint only for short/ambiguous queries — never force-append nearest city for street names.
  const hasGeoHint = /\b(tanzania|mwanza|dar|arusha|dodoma|mbeya|tanga|morogoro|mtwara|street|st\.?|road|rd\.?|avenue|ave\.?)\b/i.test(
    trimmedQuery
  );
  const cityAwareQuery =
    origin && !hasGeoHint && trimmedQuery.split(/\s+/).length <= 2
      ? `${trimmedQuery}, Tanzania`
      : trimmedQuery;

  logAsyncStart(screenScope, 'placesAutocomplete', {
    query: trimmedQuery,
    cityAwareQuery,
    sessionToken,
    hasOrigin: Boolean(origin),
  });

  const instantSuggestions = getInstantLocationSuggestions(trimmedQuery, origin, limit);
  if (instantSuggestions.length > 0 && isDoorDropBackendCoolingDown()) {
    return sortStreetFirst(instantSuggestions);
  }

  if (isDoorDropBackendCoolingDown()) {
    const fallbackSuggestions = await fetchFallbackSuggestions(cityAwareQuery, origin, limit);
    const geocodedSuggestions = fallbackSuggestions.length ? [] : await geocodeQueryToSuggestions(cityAwareQuery);
    const resolvedSuggestions = filterSuggestionsToServiceCity(
      fallbackSuggestions.length ? fallbackSuggestions : geocodedSuggestions,
      origin,
      limit
    );
    if (resolvedSuggestions.length) {
      logWarning(screenScope, 'placesAutocomplete skipping backend cooldown', {
        query: trimmedQuery,
        count: resolvedSuggestions.length,
      });
      return sortStreetFirst(resolvedSuggestions);
    }
  }

  try {
    const requestUrl = buildRequestUrl('/places/autocomplete', {
      input: trimmedQuery,
      sessionToken,
      latitude: origin?.latitude,
      longitude: origin?.longitude,
      limit,
    });
    const payload = await requestJson<AutocompleteResponse>(
      requestUrl,
      undefined,
      {
        kind: 'places-autocomplete',
        timeoutMs: PLACES_BACKEND_TIMEOUT_MS,
      }
    );

    if (payload.suggestions !== undefined && !Array.isArray(payload.suggestions)) {
      const error = new Error('DoorDrop autocomplete response did not contain a suggestions array.');
      recordFrontendParseIssue(requestUrl, error, payload, 200);
      throw error;
    }

    const suggestions = (payload.suggestions ?? [])
      .map((suggestion) => {
        const types = Array.isArray(suggestion.types)
          ? suggestion.types
          : Array.isArray(suggestion.placePrediction?.types)
            ? suggestion.placePrediction?.types
            : [];
        return {
          id: suggestion.id ?? suggestion.placeId,
          placeId: suggestion.placeId ?? suggestion.id,
          name: suggestion.name ?? suggestion.placePrediction?.structuredFormat?.mainText?.text ?? 'Selected place',
          address:
            suggestion.address ??
            suggestion.placePrediction?.structuredFormat?.secondaryText?.text ??
            suggestion.fullText ??
            '',
          fullText:
            suggestion.fullText ??
            suggestion.placePrediction?.text?.text ??
            [suggestion.name, suggestion.address].filter(Boolean).join(', '),
          featureType:
            suggestion.featureType ??
            types?.[0] ??
            suggestion.placePrediction?.types?.[0] ??
            'place',
          types: Array.isArray(types) ? types.filter((type): type is string => typeof type === 'string') : [],
          latitude: suggestion.latitude,
          longitude: suggestion.longitude,
          coordinates: suggestion.coordinates,
        };
      })
      .map((suggestion) => {
        const placeId = String(suggestion.placeId ?? '').trim();
        if (!placeId) {
          return null;
        }

        const coordinates = extractPoint(
          suggestion.coordinates ?? {
            latitude: suggestion.latitude,
            longitude: suggestion.longitude,
          }
        );

        return {
          id: String(suggestion.id ?? placeId).trim() || placeId,
          placeId,
          name: String(suggestion.name ?? 'Selected place').trim() || 'Selected place',
          address: String(suggestion.address ?? '').trim(),
          fullText:
            String(suggestion.fullText ?? '').trim() ||
            [suggestion.name, suggestion.address].filter(Boolean).join(', '),
          featureType: String(suggestion.featureType ?? 'place').trim() || 'place',
          types: Array.isArray(suggestion.types) ? suggestion.types : [],
          coordinates: coordinates ?? undefined,
        } satisfies LocationSuggestion;
      })
      .filter(Boolean) as LocationSuggestion[];

    // Google Places first; demote local Dar catalog below street/Places results (offline fill only).
    const localNearOrigin = searchLocalPlaces(trimmedQuery, 3, origin);
    const googleStreet = suggestions.filter((item) => isStreetLikeSuggestion(item));
    const googleRest = suggestions.filter((item) => !isStreetLikeSuggestion(item));
    const mergedRaw = uniqueLocationSuggestions(
      [...googleStreet, ...googleRest, ...localNearOrigin, ...instantSuggestions],
      limit * 2
    )
      .map((suggestion) => {
        const presentation = sanitizeSuggestionPresentation(
          suggestion.name,
          suggestion.address,
          suggestion.fullText,
          suggestionTypes(suggestion)
        );
        if (presentation.weak) {
          return null;
        }
        return {
          ...suggestion,
          name: presentation.name,
          address: presentation.address,
          fullText: presentation.fullText,
        } satisfies LocationSuggestion;
      })
      .filter(Boolean) as LocationSuggestion[];

    const merged = sortStreetFirst(filterSuggestionsToServiceCity(mergedRaw, origin, limit));

    logAsyncSuccess(screenScope, 'placesAutocomplete', {
      query: trimmedQuery,
      count: merged.length,
      backendUrl: requestUrl,
    });

    return merged;
  } catch (error) {
    const fallbackSuggestions = await fetchFallbackSuggestions(cityAwareQuery, origin, limit);
    const geocodedSuggestions = fallbackSuggestions.length ? [] : await geocodeQueryToSuggestions(cityAwareQuery);
    const resolvedSuggestions = sortStreetFirst(
      filterSuggestionsToServiceCity(
        fallbackSuggestions.length ? fallbackSuggestions : geocodedSuggestions,
        origin,
        limit
      )
    );
    if (resolvedSuggestions.length) {
      logWarning(screenScope, 'placesAutocomplete using fallback suggestions', {
        query: trimmedQuery,
        count: resolvedSuggestions.length,
        offline: isNetworkError(error),
      });
      return resolvedSuggestions;
    }

    logWarning(screenScope, 'placesAutocomplete:failure', { query: trimmedQuery });
    throw error;
  }
}

function pickReadablePlaceLabel(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const raw = String(candidate ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!raw || isCoordinateLikeLabel(raw)) {
      continue;
    }

    const presentation = sanitizeSuggestionPresentation(raw, raw, raw);
    if (!presentation.weak && presentation.fullText && !isWeakPlaceName(presentation.fullText)) {
      return presentation.fullText;
    }

    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !isWeakPlaceName(part) && !/^(tanzania|united republic of tanzania)$/i.test(part));

    if (parts.length > 0 && /[A-Za-z\u00C0-\u024F]/.test(parts.join(' '))) {
      return parts.slice(0, 3).join(', ');
    }
  }

  return '';
}

async function reverseGeocodeWithGooglePlacesNearby(point: RoutePoint) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return null;
  }

  const runNearby = async (includedTypes?: string[]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.types',
        },
        body: JSON.stringify({
          maxResultCount: 10,
          rankPreference: 'DISTANCE',
          languageCode: 'en',
          regionCode: 'TZ',
          ...(includedTypes?.length ? { includedTypes } : {}),
          locationRestriction: {
            circle: {
              center: {
                latitude: point.latitude,
                longitude: point.longitude,
              },
              radius: includedTypes?.length ? 250 : 500,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Google Places nearby failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        places?: Array<{
          displayName?: { text?: string };
          formattedAddress?: string;
          shortFormattedAddress?: string;
          types?: string[];
          addressComponents?: Array<{
            longText?: string;
            shortText?: string;
            types?: string[];
          }>;
        }>;
      };

      return payload.places ?? [];
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let places = await runNearby(['route']);
    if (!places.length) {
      places = await runNearby();
    }

    const ranked = [...places].sort(
      (left, right) => scoreGeocodePrecision(right.types) - scoreGeocodePrecision(left.types)
    );

    let best: {
      label: string;
      address: string;
      point: RoutePoint;
      score: number;
    } | null = null;

    for (const place of ranked) {
      const formatted = place.shortFormattedAddress || place.formattedAddress || '';
      const label = buildGooglePlaceLabel({
        displayName: place.displayName?.text,
        formattedAddress: formatted,
        addressComponents: place.addressComponents,
        resultTypes: place.types,
      });
      const resolved = pickReadablePlaceLabel(label, formatted);
      if (!resolved) {
        continue;
      }
      const score = scorePlaceLabelPrecision(
        resolved,
        place.types ?? (hasStreetLevelComponents(place.addressComponents) ? ['route'] : undefined)
      );
      if (!best || score > best.score) {
        best = {
          label: resolved,
          address: formatted || resolved,
          point,
          score,
        };
      }
      if (isStreetLevelPrecision(place.types) || score >= 90) {
        break;
      }
    }

    return best;
  } catch {
    return null;
  }
}

async function reverseGeocodeWithGoogleClient(point: RoutePoint) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return null;
  }

  const buildUrl = (streetLevelOnly: boolean) => {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${point.latitude},${point.longitude}`);
    url.searchParams.set('language', 'en');
    url.searchParams.set('region', 'tz');
    // Include APPROXIMATE so named roads still surface when rooftop data is thin.
    url.searchParams.set('location_type', 'ROOFTOP|RANGE_INTERPOLATED|GEOMETRIC_CENTER|APPROXIMATE');
    url.searchParams.set('key', apiKey);
    if (streetLevelOnly) {
      url.searchParams.set(
        'result_type',
        'street_address|premise|subpremise|route|intersection|neighborhood|sublocality|sublocality_level_1|sublocality_level_2|point_of_interest'
      );
    }
    return url;
  };

  const fetchGeocode = async (streetLevelOnly: boolean) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(buildUrl(streetLevelOnly).toString(), {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Google reverse geocode failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          formatted_address?: string;
          types?: string[];
          address_components?: Array<{
            long_name?: string;
            short_name?: string;
            types?: string[];
          }>;
        }>;
      };

      if (payload.status && payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
        throw new Error(payload.error_message || `Google geocode status ${payload.status}`);
      }

      return payload.results ?? [];
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let results = await fetchGeocode(true);
  if (!results.length) {
    results = await fetchGeocode(false);
  }

  const ranked = [...results].sort(
    (left, right) => scoreGeocodePrecision(right.types) - scoreGeocodePrecision(left.types)
  );

  let best: {
    label: string;
    address: string;
    point: RoutePoint;
    score: number;
  } | null = null;

  for (const result of ranked) {
    const mappedComponents = (result.address_components ?? []).map((item) => ({
      longText: item.long_name,
      shortText: item.short_name,
      types: item.types,
    }));

    const label = buildGooglePlaceLabel({
      displayName: result.address_components?.[0]?.long_name,
      formattedAddress: result.formatted_address,
      addressComponents: mappedComponents,
      resultTypes: result.types,
    });

    const resolved = pickReadablePlaceLabel(label, result.formatted_address);
    if (!resolved) {
      continue;
    }
    const score = Math.max(
      scoreGeocodePrecision(result.types),
      scorePlaceLabelPrecision(resolved, result.types)
    );
    if (!best || score > best.score) {
      best = {
        label: resolved,
        address: result.formatted_address || resolved,
        point,
        score,
      };
    }
    if (isStreetLevelPrecision(result.types) || score >= 90) {
      break;
    }
  }

  return best;
}

export async function reverseGeocodeLocationFast(point: RoutePoint) {
  const exactPoint = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  };

  const cached = readReverseGeocodeCache(exactPoint);
  if (cached) {
    return cached;
  }

  try {
    const reverse = await Location.reverseGeocodeAsync(exactPoint);
    const expoLabel = formatExpoGeocodedLabel(reverse[0] ?? null, exactPoint);
    if (expoLabel && !isWeakPlaceName(expoLabel) && scorePlaceLabelPrecision(expoLabel) >= 45) {
      const quickResult = {
        label: expoLabel,
        address: expoLabel,
        point: exactPoint,
      };
      writeReverseGeocodeCache(exactPoint, quickResult);
      void reverseGeocodeLocation(exactPoint)
        .then((full) => {
          writeReverseGeocodeCache(exactPoint, full);
        })
        .catch(() => undefined);
      return quickResult;
    }
  } catch {
    // Fall through to the full reverse-geocode flow.
  }

  const full = await reverseGeocodeLocation(exactPoint);
  writeReverseGeocodeCache(exactPoint, full);
  return full;
}

export async function reverseGeocodeLocation(point: RoutePoint) {
  const exactPoint = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  };
  const coordinateLabel = formatExactCoordinateLabel(exactPoint);

  type ScoredLocation = Omit<RetrievedLocation, 'suggestion'> & { score: number };

  const acceptLabel = (label?: string | null, address?: string | null, score = 0): ScoredLocation | null => {
    const resolved = pickReadablePlaceLabel(label, address);
    if (!resolved) {
      return null;
    }
    return {
      label: resolved,
      address: String(address ?? resolved).trim() || resolved,
      point: exactPoint,
      score: Math.max(score, scorePlaceLabelPrecision(resolved)),
    };
  };

  // Race providers, then pick the most street-like label (not the fastest district).
  const remoteAttempts = [
    (async () => {
      if (isDoorDropBackendCoolingDown()) {
        return null;
      }
      const requestUrl = buildRequestUrl('/places/reverse', {
        latitude: exactPoint.latitude,
        longitude: exactPoint.longitude,
      });
      const payload = await requestJson<{
        name?: string | null;
        address?: string | null;
      }>(requestUrl, undefined, { kind: 'place-resolve', timeoutMs: 4500 });
      return acceptLabel(payload.name, payload.address);
    })(),
    (async () => {
      const googleClient = await reverseGeocodeWithGoogleClient(exactPoint);
      return googleClient?.label
        ? acceptLabel(googleClient.label, googleClient.address, googleClient.score)
        : null;
    })(),
    (async () => {
      try {
        const nearby = await reverseGeocodeWithGooglePlacesNearby(exactPoint);
        return nearby?.label ? acceptLabel(nearby.label, nearby.address, nearby.score) : null;
      } catch {
        return null;
      }
    })(),
  ];

  const remoteResults = await Promise.allSettled(remoteAttempts);
  const scored = remoteResults
    .filter((result): result is PromiseFulfilledResult<ScoredLocation> => result.status === 'fulfilled' && !!result.value)
    .map((result) => result.value)
    .sort((left, right) => right.score - left.score);

  if (scored[0]) {
    const { score: _score, ...winner } = scored[0];
    writeReverseGeocodeCache(exactPoint, winner);
    return winner;
  }

  try {
    const reverse = await Location.reverseGeocodeAsync(exactPoint);
    const expoLabel = formatExpoGeocodedLabel(reverse[0] ?? null, exactPoint);
    const accepted = acceptLabel(expoLabel, expoLabel);
    if (accepted) {
      const { score: _score, ...winner } = accepted;
      writeReverseGeocodeCache(exactPoint, winner);
      return winner;
    }

    // Expo sometimes returns street/name pieces even when our formatter falls back to coords.
    const address = reverse[0];
    if (address) {
      const rawPieces = [
        [address.streetNumber, address.street].filter(Boolean).join(' '),
        address.name,
        address.district,
        address.subregion,
        address.city,
        address.region,
      ];
      const acceptedPieces = acceptLabel(rawPieces.filter(Boolean).join(', '), address.city || address.region);
      if (acceptedPieces) {
        const { score: _score, ...winner } = acceptedPieces;
        writeReverseGeocodeCache(exactPoint, winner);
        return winner;
      }
    }
  } catch {
    // fall through to exact coordinates
  }

  const coordinateResult = {
    label: coordinateLabel,
    address: '',
    point: exactPoint,
  } satisfies Omit<RetrievedLocation, 'suggestion'>;

  writeReverseGeocodeCache(exactPoint, coordinateResult);
  return coordinateResult;
}

/**
 * Prefer a human place name on orders so drivers are not shown raw GPS text.
 * Keeps a street/road label; reverse-geocodes when the label is weak, GPS-like, or district-only.
 */
export async function ensureReadablePlaceLabel(
  point: RoutePoint | null | undefined,
  currentLabel?: string | null
): Promise<string> {
  const trimmed = String(currentLabel ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  const currentScore = scorePlaceLabelPrecision(trimmed);
  if (trimmed && !isWeakPlaceName(trimmed) && currentScore >= 70) {
    return trimmed;
  }

  if (
    !point ||
    !Number.isFinite(Number(point.latitude)) ||
    !Number.isFinite(Number(point.longitude))
  ) {
    return trimmed || 'Selected place';
  }

  try {
    const reversed = await reverseGeocodeLocation({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
    });
    const nextLabel = String(reversed.label ?? '').trim();
    if (nextLabel && !isWeakPlaceName(nextLabel)) {
      const nextScore = scorePlaceLabelPrecision(nextLabel);
      if (!trimmed || isWeakPlaceName(trimmed) || nextScore > currentScore) {
        return nextLabel;
      }
    }
  } catch (error) {
    logWarning(screenScope, 'ensureReadablePlaceLabel reverse failed', {
      message: getErrorMessage(error, 'Reverse geocode failed.'),
    });
  }

  return trimmed || formatExactCoordinateLabel({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  });
}

export async function retrieveLocationSuggestion(
  suggestion: Pick<LocationSuggestion, 'id' | 'placeId' | 'name' | 'address' | 'featureType' | 'fullText' | 'coordinates'>,
  sessionToken: string,
  _origin?: RoutePoint
) {
  const resolvedPlaceId = String(suggestion.placeId || suggestion.id || '').trim();
  const presentation = sanitizeSuggestionPresentation(
    suggestion.name,
    suggestion.address,
    suggestion.fullText
  );

  if (suggestion.coordinates) {
    if (presentation.weak || isWeakPlaceName(suggestion.name)) {
      const reversed = await reverseGeocodeLocation(suggestion.coordinates);
      return {
        label: reversed.label,
        address: reversed.address,
        point: suggestion.coordinates,
        suggestion: {
          id: suggestion.id,
          placeId: resolvedPlaceId,
          name: reversed.label,
          address: reversed.address,
          featureType: suggestion.featureType ?? 'place',
          fullText: [reversed.label, reversed.address].filter(Boolean).join(', '),
          coordinates: suggestion.coordinates,
        },
      } satisfies RetrievedLocation;
    }

    const inlineResult = {
      label: presentation.name,
      address: presentation.address,
      point: suggestion.coordinates,
      suggestion: {
        id: suggestion.id,
        placeId: resolvedPlaceId,
        name: presentation.name,
        address: presentation.address,
        featureType: suggestion.featureType ?? 'place',
        fullText: presentation.fullText,
        coordinates: suggestion.coordinates,
      },
    } satisfies RetrievedLocation;

    logAsyncSuccess(screenScope, 'placeResolve', {
      placeId: suggestion.placeId,
      endpoint: 'inline',
    });

    return inlineResult;
  }

  logAsyncStart(screenScope, 'placeResolve', {
    placeId: resolvedPlaceId,
    label: suggestion.name,
  });

  try {
    const endpoints = ['/places/details', '/places/resolve'] as const;
    let lastError: unknown = null;

    for (const endpoint of endpoints) {
      try {
        const requestUrl = buildRequestUrl(endpoint, {
          placeId: resolvedPlaceId,
          sessionToken,
        });
        const payload = await requestJson<ResolvedPlaceResponse>(
          requestUrl,
          undefined,
          {
            kind: endpoint === '/places/details' ? 'place-details' : 'place-resolve',
          }
        );
        let retrieved: RetrievedLocation;

        try {
          retrieved = normalizeResolvedLocation(payload, {
            ...suggestion,
            placeId: resolvedPlaceId,
          });
        } catch (error) {
          recordFrontendParseIssue(requestUrl, error, payload, 200);
          throw error;
        }

        logAsyncSuccess(screenScope, 'placeResolve', {
          placeId: resolvedPlaceId,
          endpoint,
          label: retrieved.label,
        });

        return retrieved;
      } catch (error) {
        lastError = error;

        if (endpoint !== endpoints[endpoints.length - 1]) {
          logWarning(screenScope, 'placeResolve primary endpoint failed, trying fallback', {
            endpoint,
            fallbackEndpoint: '/places/resolve',
            placeId: resolvedPlaceId,
            message: getErrorMessage(error, 'Place resolve failed.'),
          });
        }
      }
    }

    throw lastError ?? new Error('DoorDrop could not resolve this place to coordinates.');
  } catch (error) {
    const fallbackQuery = [suggestion.fullText, suggestion.name, suggestion.address].filter(Boolean).join(', ');
    const geocoded = fallbackQuery ? await geocodeQueryToSuggestions(fallbackQuery) : [];
    const fallbackPoint = geocoded[0]?.coordinates;

    if (fallbackPoint) {
      logWarning(screenScope, 'placeResolve using device geocode fallback', {
        placeId: resolvedPlaceId,
        query: fallbackQuery,
      });
      return {
        label: suggestion.name || 'Selected place',
        address: suggestion.address || '',
        point: fallbackPoint,
        suggestion: {
          id: suggestion.id,
          placeId: resolvedPlaceId,
          name: suggestion.name,
          address: suggestion.address,
          featureType: suggestion.featureType ?? 'place',
          fullText: suggestion.fullText,
          coordinates: fallbackPoint,
        },
      } satisfies RetrievedLocation;
    }

    logWarning(screenScope, 'placeResolve:failure', { placeId: resolvedPlaceId });
    throw error instanceof Error
      ? error
      : new Error('DoorDrop could not resolve this place to coordinates.');
  }
}

export async function resolveTypedLocation(query: string, origin?: RoutePoint) {
  const trimmedQuery = query.trim();

  logAsyncStart(screenScope, 'resolveTypedLocation', {
    query: trimmedQuery,
  });

  try {
    const sessionToken = createSearchSessionToken();
    const suggestions = await fetchLocationSuggestions(trimmedQuery, sessionToken, origin, 1);
    const firstSuggestion = suggestions[0];

    if (!firstSuggestion) {
      throw new Error('We could not match that location yet. Add an area, street, junction, building, or landmark.');
    }

    const resolved = await retrieveLocationSuggestion(firstSuggestion, sessionToken, origin);

    logAsyncSuccess(screenScope, 'resolveTypedLocation', {
      query: trimmedQuery,
      label: resolved.label,
    });

    return resolved;
  } catch (error) {
    logWarning(screenScope, 'resolveTypedLocation:failure', { query: trimmedQuery });
    throw error;
  }
}

export async function fetchRouteEstimate(
  origin: RoutePoint,
  destination: RoutePoint,
  options?: FetchRouteEstimateOptions
) {
  logAsyncStart(screenScope, 'routeEstimate', {
    origin,
    destination,
    vehicleType: options?.vehicleType,
    cargoSize: options?.cargoSize,
    pricingScope: options?.pricingScope,
  });

  try {
    if (isDoorDropBackendCoolingDown()) {
      logWarning(screenScope, 'routeEstimate skipping backend cooldown', { origin, destination });
      throw new Error('LOCATION_SERVICE_UNAVAILABLE');
    }

    // /routes/estimate needs OD for Google Routes meters/ETA. Haul prices locally.
    // Older Cloud Functions reject vehicleType "toyo_electric" with HTTP 500 — omit
    // formula vehicles so geometry still succeeds; local cargo-pricing covers fare.
    const apiVehicleType = (() => {
      if (!options?.vehicleType) return undefined;
      try {
        const normalized = normalizeDoorDropVehicleType(options.vehicleType);
        if (normalized === 'toyo_electric') return undefined;
        return normalized;
      } catch {
        return undefined;
      }
    })();
    const routeRequestBody = {
      origin,
      destination,
      pickupPoint: origin,
      dropoffPoint: destination,
      ...(apiVehicleType ? { vehicleType: apiVehicleType } : {}),
      ...(options?.cargoSize && apiVehicleType ? { cargoSize: options.cargoSize } : {}),
      pricingScope: options?.pricingScope,
    };
    const requestUrl = buildRequestUrl('/routes/estimate');
    const routeRequestDebug = {
      kind: 'routes-estimate' as const,
      requestBody: routeRequestBody,
      timeoutMs: ROUTES_ESTIMATE_TIMEOUT_MS,
    };

    let payload: RouteEstimateResponse;
    try {
      payload = await requestJson<RouteEstimateResponse>(
        requestUrl,
        {
          method: 'POST',
          body: JSON.stringify(routeRequestBody),
        },
        routeRequestDebug
      );
    } catch (firstError) {
      // Retry Routes once on timeout before giving up (cold start / long OD).
      if (!isRouteEstimateTimeoutError(firstError)) {
        throw firstError;
      }
      logWarning(screenScope, 'routeEstimate timeout, retrying once', {
        origin,
        destination,
        message: getErrorMessage(firstError, 'Route estimate timed out.'),
      });
      payload = await requestJson<RouteEstimateResponse>(
        requestUrl,
        {
          method: 'POST',
          body: JSON.stringify(routeRequestBody),
        },
        routeRequestDebug
      );
    }

    let distanceMeters = getPayloadDistanceMeters(payload);
    const payloadDurationSeconds = normalizeNumber(payload.durationSeconds) ?? normalizeNumber(payload.duration_seconds);

    if (distanceMeters === null || distanceMeters <= 0) {
      const error = new Error('DoorDrop route estimate returned incomplete route data.');
      recordFrontendParseIssue(requestUrl, error, payload, 200);
      throw error;
    }

    // Keep Routes API meters/ETA as pricing truth — never overwrite from Directions/OSRM refill.
    let durationSeconds =
      payloadDurationSeconds !== null && payloadDurationSeconds > 0
        ? payloadDurationSeconds
        : estimateDurationSecondsFromDistance(distanceMeters);

    let coordinates =
      filterValidCoordinates(payload.coordinates ?? []).length > 0
        ? filterValidCoordinates(payload.coordinates ?? [])
        : payload.polyline
          ? decodePolyline(payload.polyline)
          : [origin, destination];
    let polyline = typeof payload.polyline === 'string' ? payload.polyline : '';

    // Thin polyline: refill geometry only; keep backend distanceMeters + durationSeconds.
    if (coordinates.length < 3) {
      const road = await fetchRoadFollowingRoute(origin, destination);
      if (road && road.coordinates.length > 2) {
        coordinates = road.coordinates;
        polyline = road.geometry;
      }
    }

    const routePricingFallback = options?.vehicleType
      ? createFrontendEstimate(
          distanceMeters,
          options.vehicleType,
          options?.cargoSize,
          options?.pricingScope,
          durationSeconds
        )
      : null;

    let pricingEstimate = normalizePricingEstimate(payload.pricingEstimate, routePricingFallback);
    const routePrice = normalizeNumber(payload.price);

    if (!pricingEstimate && routePrice !== null && routePricingFallback) {
      pricingEstimate = {
        ...routePricingFallback,
        estimatedPrice: roundToCustomerFare(routePrice),
        source: 'backend',
        warning: null,
      };
    }

    if (!pricingEstimate && routePricingFallback) {
      pricingEstimate = {
        ...(routePricingFallback as PricingEstimate),
        warning: 'DoorDrop backend did not return price. Showing an estimated fare from distance.',
      };

      logWarning(screenScope, 'routeEstimate missing price, using frontend fallback', {
        distanceMeters,
        vehicleType: options?.vehicleType,
        cargoSize: options?.cargoSize,
        pricingScope: options?.pricingScope,
      });
    }

    const estimate = {
      distanceMeters,
      // Always derive km from the settled road meters (may have been adopted from refill geometry).
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      durationSeconds,
      polyline,
      coordinates,
      price: routePrice ?? pricingEstimate?.estimatedPrice ?? null,
      pricingEstimate,
    } satisfies RouteEstimate;

    logAsyncSuccess(screenScope, 'routeEstimate', {
      distanceMeters: estimate.distanceMeters,
      distanceKm: estimate.distanceKm,
      durationSeconds: estimate.durationSeconds,
      coordinateCount: estimate.coordinates.length,
      pricingSource: estimate.pricingEstimate?.source ?? null,
    });

    return estimate;
  } catch (error) {
    // Do NOT return a pricable Directions/OSRM estimate as if Routes succeeded.
    logWarning(screenScope, 'routeEstimate:failure', {
      origin,
      destination,
      vehicleType: options?.vehicleType ?? null,
      message: getErrorMessage(error, 'Route estimate failed.'),
    });

    if (options?.vehicleType) {
      throw error instanceof Error
        ? error
        : new Error('Routes estimate failed. Cannot price without Google Routes distance.');
    }

    // Geometry-only for map drawing: zero meters/ETA so it cannot be treated as priced.
    const road = await fetchRoadFollowingRoute(origin, destination);
    if (road && road.coordinates.length > 2) {
      logWarning(screenScope, 'routeEstimate geometry-only fallback (not for pricing)', {
        coordinateCount: road.coordinates.length,
      });
      return createGeometryOnlyRouteEstimate({
        coordinates: road.coordinates,
        polyline: road.geometry,
      });
    }

    throw error instanceof Error
      ? error
      : new Error('Routes estimate failed. No road distance available.');
  }
}

// Backward-compatible alias for older screens that still import the removed
// Distance Matrix helper name. Internally this now uses the Routes API flow.
export async function fetchDistanceMatrix(
  origin: RoutePoint,
  destination: RoutePoint
) {
  return fetchRouteEstimate(origin, destination);
}

export async function fetchRouteEstimates(
  origin: RoutePoint,
  destination: RoutePoint
) {
  return fetchRouteEstimate(origin, destination);
}

export async function fetchPricingEstimate(
  distanceMeters: number,
  vehicleType: RouteEstimateVehicleType,
  cargoSize?: RouteEstimateCargoSize,
  pricingScope?: RouteEstimatePricingScope,
  durationSeconds?: number | null
) {
  logAsyncStart(screenScope, 'pricingEstimate', {
    vehicleType,
    distanceMeters,
    cargoSize,
    pricingScope,
    durationSeconds,
  });

  if (isDoorDropBackendCoolingDown()) {
    const fallbackEstimate = createFrontendEstimate(
      distanceMeters,
      vehicleType,
      cargoSize,
      pricingScope,
      durationSeconds
    );
    logWarning(screenScope, 'pricingEstimate skipping backend cooldown', {
      vehicleType,
      distanceMeters,
    });
    return {
      ...fallbackEstimate,
      warning: 'DoorDrop pricing endpoint failed. Showing an estimated fare from distance.',
    };
  }

  try {
    const pricingRequestBody = {
      vehicleType,
      distanceMeters,
      cargoSize,
      pricingScope,
      durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : undefined,
    };
    const requestUrl = buildRequestUrl('/pricing/estimate');
    const payload = await requestJson<PricingEstimateResponse>(requestUrl, {
      method: 'POST',
      body: JSON.stringify(pricingRequestBody),
    }, {
      kind: 'pricing-estimate',
      requestBody: pricingRequestBody,
    });

    const fallbackEstimate = createFrontendEstimate(
      distanceMeters,
      vehicleType,
      cargoSize,
      pricingScope,
      durationSeconds
    );
    const estimate = normalizePricingEstimate(payload, fallbackEstimate);

    if (!estimate) {
      recordFrontendParseIssue(
        requestUrl,
        new Error('DoorDrop pricing response did not include an estimatedPrice.'),
        payload,
        200
      );
      logWarning(screenScope, 'pricingEstimate missing estimatedPrice, using frontend fallback', {
        vehicleType,
        distanceMeters,
        cargoSize,
        pricingScope,
      });

      const fallback = {
        ...fallbackEstimate,
        warning: 'DoorDrop backend did not return price. Showing an estimated fare from distance.',
      };
      return fallback;
    }

    logAsyncSuccess(screenScope, 'pricingEstimate', {
      vehicleType,
      estimatedPrice: estimate.estimatedPrice,
      distanceKm: estimate.distanceKm,
      cargoSize: estimate.cargoSize,
      source: estimate.source ?? 'backend',
    });
    return estimate;
  } catch (error) {
    const fallbackEstimate = createFrontendEstimate(
      distanceMeters,
      vehicleType,
      cargoSize,
      pricingScope,
      durationSeconds
    );

    logWarning(screenScope, 'pricingEstimate request failed, using frontend fallback', {
      vehicleType,
      distanceMeters,
      cargoSize,
      pricingScope,
      message: getErrorMessage(error, 'Pricing estimate failed.'),
    });
    const fallback = {
      ...fallbackEstimate,
      warning: 'DoorDrop pricing endpoint failed. Showing an estimated fare from distance.',
    };
    return fallback;
  }
}

export async function fetchPricingEstimates(
  distanceMeters: number,
  vehicleTypes: RouteEstimateVehicleType[],
  cargoSize?: RouteEstimateCargoSize,
  pricingScope?: RouteEstimatePricingScope,
  durationSeconds?: number | null
) {
  const estimates = await Promise.all(
    vehicleTypes.map(async (vehicleType) => {
      const estimate = await fetchPricingEstimate(
        distanceMeters,
        vehicleType,
        cargoSize,
        pricingScope,
        durationSeconds
      );
      return [vehicleType, estimate] as const;
    })
  );

  return Object.fromEntries(estimates) as Record<RouteEstimateVehicleType, PricingEstimate>;
}
