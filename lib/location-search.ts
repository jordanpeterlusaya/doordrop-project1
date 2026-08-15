import {
  buildFrontendPricingEstimate,
  normalizeDoorDropVehicleType,
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
import { isNetworkError } from '@/lib/network-status';
import { fetchFallbackSuggestions, searchLocalPlaces } from '@/lib/places-fallback';
import { fetchRoadFollowingRoute } from '@/lib/road-route';
import { decodePolyline, filterValidCoordinates, getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';
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
const PLACES_BACKEND_TIMEOUT_MS = 4000;

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
  pricingScope?: RouteEstimatePricingScope
): PricingEstimate {
  const canonicalVehicleType = normalizeDoorDropVehicleType(vehicleType);
  const estimate = buildFrontendPricingEstimate({
    distanceMeters,
    vehicleType: canonicalVehicleType,
    cargoSize,
    pricingScope,
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

function createFallbackRouteEstimate(
  origin: RoutePoint,
  destination: RoutePoint,
  vehicleType: RouteEstimateVehicleType,
  cargoSize?: RouteEstimateCargoSize,
  pricingScope?: RouteEstimatePricingScope,
  warning = 'DoorDrop route endpoint failed. Showing an estimated fare from map distance.',
  road?: { coordinates: RoutePoint[]; polyline?: string; distanceMeters?: number; durationSeconds?: number } | null
): RouteEstimate {
  const directDistanceMeters = getDistanceBetweenPoints(origin, destination);
  const distanceMeters = Math.max(
    1000,
    Math.round(road?.distanceMeters && road.distanceMeters > 0 ? road.distanceMeters : directDistanceMeters * 1.25)
  );
  const averageMetersPerSecond = 9.7;
  const durationSeconds =
    road?.durationSeconds && road.durationSeconds > 0
      ? Math.round(road.durationSeconds)
      : Math.max(600, Math.round(distanceMeters / averageMetersPerSecond));
  const pricingEstimate = {
    ...createFrontendEstimate(distanceMeters, vehicleType, cargoSize, pricingScope),
    warning,
  };
  const coordinates =
    road?.coordinates && road.coordinates.length > 2 ? road.coordinates : [origin, destination];

  return {
    distanceMeters,
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    durationSeconds,
    polyline: road?.polyline ?? '',
    coordinates,
    price: pricingEstimate.estimatedPrice,
    pricingEstimate,
  };
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
    estimatedPrice: Math.max(0, Math.round(estimatedPrice)),
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
  const name =
    String(payload.name ?? payload.title ?? suggestion.name ?? 'Selected place').trim() || 'Selected place';
  const address = String(payload.address ?? payload.fullText ?? suggestion.address ?? '').trim();
  const fullText = [name, address].filter(Boolean).join(', ') || suggestion.fullText;

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

export async function fetchLocationSuggestions(query: string, sessionToken: string, origin?: RoutePoint, limit = 6) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) {
    return [];
  }

  logAsyncStart(screenScope, 'placesAutocomplete', {
    query: trimmedQuery,
    sessionToken,
    hasOrigin: Boolean(origin),
  });

  if (isDoorDropBackendCoolingDown()) {
    const fallbackSuggestions = await fetchFallbackSuggestions(trimmedQuery, origin, limit);
    const geocodedSuggestions = fallbackSuggestions.length ? [] : await geocodeQueryToSuggestions(trimmedQuery);
    const resolvedSuggestions = fallbackSuggestions.length ? fallbackSuggestions : geocodedSuggestions;
    if (resolvedSuggestions.length) {
      logWarning(screenScope, 'placesAutocomplete skipping backend cooldown', {
        query: trimmedQuery,
        count: resolvedSuggestions.length,
      });
      return resolvedSuggestions;
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
      .map((suggestion) => ({
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
          suggestion.placePrediction?.types?.[0] ??
          'place',
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        coordinates: suggestion.coordinates,
      }))
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
          coordinates: coordinates ?? undefined,
        } satisfies LocationSuggestion;
      })
      .filter(Boolean) as LocationSuggestion[];

    logAsyncSuccess(screenScope, 'placesAutocomplete', {
      query: trimmedQuery,
      count: suggestions.length,
      backendUrl: requestUrl,
    });

    return uniqueLocationSuggestions([...suggestions, ...searchLocalPlaces(trimmedQuery, limit)], limit);
  } catch (error) {
    const fallbackSuggestions = await fetchFallbackSuggestions(trimmedQuery, origin, limit);
    const geocodedSuggestions = fallbackSuggestions.length ? [] : await geocodeQueryToSuggestions(trimmedQuery);
    const resolvedSuggestions = fallbackSuggestions.length ? fallbackSuggestions : geocodedSuggestions;
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

export async function retrieveLocationSuggestion(
  suggestion: Pick<LocationSuggestion, 'id' | 'placeId' | 'name' | 'address' | 'featureType' | 'fullText' | 'coordinates'>,
  sessionToken: string,
  _origin?: RoutePoint
) {
  const resolvedPlaceId = String(suggestion.placeId || suggestion.id || '').trim();

  if (suggestion.coordinates) {
    const inlineResult = {
      label: suggestion.name || 'Selected place',
      address: suggestion.address || '',
      point: suggestion.coordinates,
      suggestion: {
        id: suggestion.id,
        placeId: resolvedPlaceId,
        name: suggestion.name,
        address: suggestion.address,
        featureType: suggestion.featureType ?? 'place',
        fullText: suggestion.fullText,
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

    const routeRequestBody = {
      origin,
      destination,
      pickupPoint: origin,
      dropoffPoint: destination,
      vehicleType: options?.vehicleType,
      cargoSize: options?.cargoSize,
      pricingScope: options?.pricingScope,
    };
    const requestUrl = buildRequestUrl('/routes/estimate');
    const payload = await requestJson<RouteEstimateResponse>(requestUrl, {
      method: 'POST',
      body: JSON.stringify(routeRequestBody),
    }, {
      kind: 'routes-estimate',
      requestBody: routeRequestBody,
    });

    const distanceMeters = getPayloadDistanceMeters(payload);
    const payloadDurationSeconds = normalizeNumber(payload.durationSeconds) ?? normalizeNumber(payload.duration_seconds);

    if (distanceMeters === null || distanceMeters <= 0) {
      const error = new Error('DoorDrop route estimate returned incomplete route data.');
      recordFrontendParseIssue(requestUrl, error, payload, 200);
      throw error;
    }

    const durationSeconds =
      payloadDurationSeconds !== null && payloadDurationSeconds > 0
        ? payloadDurationSeconds
        : estimateDurationSecondsFromDistance(distanceMeters);

    const routePricingFallback = options?.vehicleType
      ? createFrontendEstimate(distanceMeters, options.vehicleType, options?.cargoSize, options?.pricingScope)
      : null;

    let coordinates =
      filterValidCoordinates(payload.coordinates ?? []).length > 0
        ? filterValidCoordinates(payload.coordinates ?? [])
        : payload.polyline
          ? decodePolyline(payload.polyline)
          : [origin, destination];
    let polyline = typeof payload.polyline === 'string' ? payload.polyline : '';

    if (coordinates.length < 3) {
      const road = await fetchRoadFollowingRoute(origin, destination);
      if (road && road.coordinates.length > 2) {
        coordinates = road.coordinates;
        polyline = road.geometry;
      }
    }

    let pricingEstimate = normalizePricingEstimate(payload.pricingEstimate, routePricingFallback);
    const routePrice = normalizeNumber(payload.price);

    if (!pricingEstimate && routePrice !== null && routePricingFallback) {
      pricingEstimate = {
        ...routePricingFallback,
        estimatedPrice: Math.max(0, Math.round(routePrice)),
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
      distanceKm:
        normalizeNumber(payload.distanceKm) ??
        normalizeNumber(payload.distance_km) ??
        normalizeNumber(payload.km) ??
        Number((distanceMeters / 1000).toFixed(2)),
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
    logWarning(screenScope, 'routeEstimate:failure', { origin, destination });
    const road = await fetchRoadFollowingRoute(origin, destination);
    const roadShape = road
      ? {
          coordinates: road.coordinates,
          polyline: road.geometry,
          distanceMeters: road.distanceMeters,
          durationSeconds: road.durationSeconds,
        }
      : null;

    if (options?.vehicleType) {
      const fallback = createFallbackRouteEstimate(
        origin,
        destination,
        options.vehicleType,
        options.cargoSize,
        options.pricingScope,
        'DoorDrop route endpoint failed. Showing an estimated fare from map distance.',
        roadShape
      );
      logWarning(screenScope, 'routeEstimate request failed, using frontend fallback route', {
        vehicleType: options.vehicleType,
        cargoSize: options.cargoSize,
        pricingScope: options.pricingScope,
        distanceMeters: fallback.distanceMeters,
        coordinateCount: fallback.coordinates.length,
        message: getErrorMessage(error, 'Route estimate failed.'),
      });
      return fallback;
    }

    if (roadShape && roadShape.coordinates.length > 2) {
      return {
        distanceMeters: Math.max(1, Math.round(roadShape.distanceMeters || getDistanceBetweenPoints(origin, destination))),
        distanceKm: Number(((roadShape.distanceMeters || getDistanceBetweenPoints(origin, destination)) / 1000).toFixed(2)),
        durationSeconds: Math.max(60, Math.round(roadShape.durationSeconds || 0)),
        polyline: roadShape.polyline ?? '',
        coordinates: roadShape.coordinates,
        price: null,
        pricingEstimate: null,
      } satisfies RouteEstimate;
    }

    throw error;
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
  pricingScope?: RouteEstimatePricingScope
) {
  logAsyncStart(screenScope, 'pricingEstimate', {
    vehicleType,
    distanceMeters,
    cargoSize,
    pricingScope,
  });

  if (isDoorDropBackendCoolingDown()) {
    const fallbackEstimate = createFrontendEstimate(distanceMeters, vehicleType, cargoSize, pricingScope);
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
    };
    const requestUrl = buildRequestUrl('/pricing/estimate');
    const payload = await requestJson<PricingEstimateResponse>(requestUrl, {
      method: 'POST',
      body: JSON.stringify(pricingRequestBody),
    }, {
      kind: 'pricing-estimate',
      requestBody: pricingRequestBody,
    });

    const fallbackEstimate = createFrontendEstimate(distanceMeters, vehicleType, cargoSize, pricingScope);
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
    const fallbackEstimate = createFrontendEstimate(distanceMeters, vehicleType, cargoSize, pricingScope);

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
  pricingScope?: RouteEstimatePricingScope
) {
  const estimates = await Promise.all(
    vehicleTypes.map(async (vehicleType) => {
      const estimate = await fetchPricingEstimate(distanceMeters, vehicleType, cargoSize, pricingScope);
      return [vehicleType, estimate] as const;
    })
  );

  return Object.fromEntries(estimates) as Record<RouteEstimateVehicleType, PricingEstimate>;
}
