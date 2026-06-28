import { checkDoorDropBackendHealth, hasDoorDropApiBaseUrl, maskConfigSecret } from '@/lib/api-config';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo } from '@/lib/debug-logger';
import {
  createSearchSessionToken,
  fetchLocationSuggestions,
  fetchRouteEstimate,
} from '@/lib/location-search';
import { getGoogleMapsApiKey, hasGoogleMapsBuildConfig } from '@/lib/maps-config';
import type { RoutePoint } from '@/lib/route-utils';

const defaultOrigin: RoutePoint = {
  latitude: -6.7924,
  longitude: 39.2083,
};

const defaultDestination: RoutePoint = {
  latitude: -6.8172,
  longitude: 39.2897,
};

const scopesRun = new Set<string>();

type MapsDiagnosticsOptions = {
  origin?: RoutePoint;
  destination?: RoutePoint;
  placeQuery?: string;
};

export async function runMapsDiagnostics(scope: string, options?: MapsDiagnosticsOptions) {
  if (scopesRun.has(scope)) {
    return;
  }

  scopesRun.add(scope);

  const googleMapsApiKey = getGoogleMapsApiKey();
  const origin = options?.origin ?? defaultOrigin;
  const destination = options?.destination ?? defaultDestination;
  const placeQuery = options?.placeQuery ?? 'Kariakoo';

  logInfo(scope, 'maps-build-config', {
    hasApiBaseUrl: hasDoorDropApiBaseUrl(),
    hasGoogleMapsBuildConfig: hasGoogleMapsBuildConfig(),
    hasGoogleMapsKey: googleMapsApiKey.length > 0,
    googleMapsKeyMasked: maskConfigSecret(googleMapsApiKey),
  });

  await checkDoorDropBackendHealth(scope);

  if (!hasDoorDropApiBaseUrl()) {
    return;
  }

  logAsyncStart(scope, 'diagnosticPlacesAutocomplete', { query: placeQuery });
  try {
    const suggestions = await fetchLocationSuggestions(placeQuery, createSearchSessionToken(), origin, 1);
    logAsyncSuccess(scope, 'diagnosticPlacesAutocomplete', {
      query: placeQuery,
      count: suggestions.length,
      firstPlaceId: suggestions[0]?.placeId ?? null,
    });
  } catch (error) {
    logAsyncFailure(scope, 'diagnosticPlacesAutocomplete', error, { query: placeQuery });
  }

  logAsyncStart(scope, 'diagnosticRouteEstimate', { origin, destination });
  try {
    const estimate = await fetchRouteEstimate(origin, destination);
    logAsyncSuccess(scope, 'diagnosticRouteEstimate', {
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      coordinateCount: estimate.coordinates.length,
    });
  } catch (error) {
    logAsyncFailure(scope, 'diagnosticRouteEstimate', error, { origin, destination });
  }
}
