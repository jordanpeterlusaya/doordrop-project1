import { getGoogleMapsApiKey } from '@/lib/maps-config';
import { logWarning } from '@/lib/debug-logger';
import {
  decodePolyline,
  selectBestOsrmRoute,
  type RoutePoint,
  type SelectedRoute,
} from '@/lib/route-utils';

const screenScope = 'RoadRoute';
const REQUEST_TIMEOUT_MS = 10000;

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
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=polyline&alternatives=true`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`OSRM failed with ${response.status}`);
  }

  const payload = (await response.json()) as { routes?: { geometry?: string; distance?: number; duration?: number }[] };
  const selected = selectBestOsrmRoute(payload.routes);
  return selected ? { ...selected, source: 'osrm' } : null;
}

function selectPreferredDirectionsRoute(
  routes:
    | {
        overview_polyline?: { points?: string };
        legs?: {
          distance?: { value?: number };
          duration?: { value?: number };
          duration_in_traffic?: { value?: number };
        }[];
      }[]
    | undefined
): SelectedRoute | null {
  const candidates = (routes ?? [])
    .map((route) => {
      const polyline = route?.overview_polyline?.points?.trim() || '';
      const coordinates = polyline ? decodePolyline(polyline) : [];
      if (coordinates.length < 3) {
        return null;
      }
      const distanceMeters = route?.legs?.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0) ?? 0;
      // Prefer live traffic duration when Directions returns it (departure_time=now).
      const durationSeconds =
        route?.legs?.reduce(
          (sum, leg) => sum + (leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0),
          0
        ) ?? 0;
      if (!(distanceMeters > 0) || !(durationSeconds > 0)) {
        return null;
      }
      return {
        coordinates,
        geometry: polyline,
        distanceMeters,
        durationSeconds,
      };
    })
    .filter((route): route is SelectedRoute => route !== null);

  if (!candidates.length) {
    return null;
  }

  // Duration-optimal (Bolt-like), not pure min-distance alley cuts.
  candidates.sort((left, right) => {
    if (left.durationSeconds !== right.durationSeconds) {
      return left.durationSeconds - right.durationSeconds;
    }
    return left.distanceMeters - right.distanceMeters;
  });

  return candidates[0];
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
  url.searchParams.set('region', 'tz');
  url.searchParams.set('language', 'en');
  url.searchParams.set('alternatives', 'true');
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('key', apiKey);

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Google Directions failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    routes?: {
      overview_polyline?: { points?: string };
      legs?: {
        distance?: { value?: number };
        duration?: { value?: number };
        duration_in_traffic?: { value?: number };
      }[];
    }[];
  };

  if (payload.status && payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Directions status ${payload.status}`);
  }

  const selected = selectPreferredDirectionsRoute(payload.routes);
  return selected ? { ...selected, source: 'directions' } : null;
}

/**
 * Road-following geometry for any region in Tanzania.
 * Prefer Google Directions (nationwide coverage) over public OSRM.
 */
export async function fetchRoadFollowingRoute(
  origin: RoutePoint,
  destination: RoutePoint
): Promise<SelectedRoute | null> {
  const attempts = [() => fetchGoogleDirectionsRoute(origin, destination), () => fetchOsrmRoute(origin, destination)];

  for (const attempt of attempts) {
    try {
      const route = await attempt();
      if (route && route.coordinates.length > 2) {
        return route;
      }
    } catch (error) {
      logWarning(screenScope, 'road geometry fallback missed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}
