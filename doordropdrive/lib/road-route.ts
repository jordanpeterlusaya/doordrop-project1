import { ensureDoorDriveApiBaseUrl, getDoorDriveApiBaseUrls } from './api-config';

export type MapPoint = {
  latitude: number;
  longitude: number;
};

const REQUEST_TIMEOUT_MS = 10000;

function decodePolyline(encoded: string): MapPoint[] {
  if (!encoded) {
    return [];
  }

  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates: MapPoint[] = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    latitude += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    longitude += deltaLng;

    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchBackendRoadRoute(origin: MapPoint, destination: MapPoint): Promise<MapPoint[] | null> {
  const body = JSON.stringify({
    origin,
    destination,
    pickupPoint: origin,
    dropoffPoint: destination,
  });

  for (const baseUrl of getDoorDriveApiBaseUrls()) {
    try {
      const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/routes/estimate`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      });
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        coordinates?: MapPoint[];
        polyline?: string;
      };
      const fromPayload = Array.isArray(payload.coordinates) ? payload.coordinates : [];
      if (fromPayload.length > 2) {
        return fromPayload;
      }
      const fromPolyline = typeof payload.polyline === 'string' ? decodePolyline(payload.polyline) : [];
      if (fromPolyline.length > 2) {
        return fromPolyline;
      }
    } catch {
      // Try next base URL.
    }
  }

  try {
    ensureDoorDriveApiBaseUrl();
  } catch {
    // Missing API URL is fine; other providers may still work.
  }

  return null;
}

async function fetchGoogleDirectionsRoute(origin: MapPoint, destination: MapPoint): Promise<MapPoint[] | null> {
  const apiKey = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`);
  url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('region', 'tz');
  url.searchParams.set('key', apiKey);

  const response = await fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    routes?: { overview_polyline?: { points?: string } }[];
  };
  const polyline = payload.routes?.[0]?.overview_polyline?.points?.trim() || '';
  const coordinates = polyline ? decodePolyline(polyline) : [];
  return coordinates.length > 2 ? coordinates : null;
}

async function fetchOsrmRoute(origin: MapPoint, destination: MapPoint): Promise<MapPoint[] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=polyline&alternatives=false`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { routes?: { geometry?: string }[] };
  const polyline = payload.routes?.[0]?.geometry?.trim() || '';
  const coordinates = polyline ? decodePolyline(polyline) : [];
  return coordinates.length > 2 ? coordinates : null;
}

/** Road-following path for any Tanzania city (not Dar-only). */
export async function fetchRoadFollowingCoordinates(
  origin: MapPoint,
  destination: MapPoint
): Promise<MapPoint[]> {
  const attempts = [
    () => fetchBackendRoadRoute(origin, destination),
    () => fetchGoogleDirectionsRoute(origin, destination),
    () => fetchOsrmRoute(origin, destination),
  ];

  for (const attempt of attempts) {
    try {
      const coordinates = await attempt();
      if (coordinates && coordinates.length > 2) {
        return coordinates;
      }
    } catch {
      // Try next provider.
    }
  }

  return [origin, destination];
}
