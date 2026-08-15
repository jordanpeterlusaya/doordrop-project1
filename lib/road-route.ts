import { getGoogleMapsApiKey } from '@/lib/maps-config';
import { logWarning } from '@/lib/debug-logger';
import {
  decodePolyline,
  selectBestOsrmRoute,
  type RoutePoint,
  type SelectedRoute,
} from '@/lib/route-utils';

const screenScope = 'RoadRoute';
const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOsrmRoute(origin: RoutePoint, destination: RoutePoint): Promise<SelectedRoute | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=polyline&alternatives=false`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`OSRM failed with ${response.status}`);
  }

  const payload = (await response.json()) as { routes?: { geometry?: string; distance?: number; duration?: number }[] };
  return selectBestOsrmRoute(payload.routes);
}

async function fetchGoogleDirectionsRoute(origin: RoutePoint, destination: RoutePoint): Promise<SelectedRoute | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', apiKey);

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Google Directions failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    routes?: { overview_polyline?: { points?: string }; legs?: { distance?: { value?: number }; duration?: { value?: number } }[] }[];
  };

  const route = payload.routes?.[0];
  const polyline = route?.overview_polyline?.points?.trim() || '';
  const coordinates = polyline ? decodePolyline(polyline) : [];
  if (coordinates.length < 3) {
    return null;
  }

  const distanceMeters = route?.legs?.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0) ?? 0;
  const durationSeconds = route?.legs?.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0) ?? 0;

  return {
    coordinates,
    geometry: polyline,
    distanceMeters: distanceMeters || 0,
    durationSeconds: durationSeconds || 0,
  };
}

export async function fetchRoadFollowingRoute(
  origin: RoutePoint,
  destination: RoutePoint
): Promise<SelectedRoute | null> {
  const attempts = [() => fetchOsrmRoute(origin, destination), () => fetchGoogleDirectionsRoute(origin, destination)];

  for (const attempt of attempts) {
    try {
      const route = await attempt();
      if (route && route.coordinates.length > 2) {
        return route;
      }
    } catch {
      logWarning(screenScope, 'road geometry fallback missed');
    }
  }

  return null;
}
