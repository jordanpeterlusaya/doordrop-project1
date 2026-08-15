import { logWarning } from '@/lib/debug-logger';
import { getGoogleMapsApiKey } from '@/lib/maps-config';
import type { RoutePoint } from '@/lib/route-utils';

export type FallbackSuggestion = {
  id: string;
  placeId: string;
  name: string;
  address: string;
  featureType: string;
  fullText: string;
  coordinates?: RoutePoint;
};

const screenScope = 'PlacesFallback';
const FALLBACK_TIMEOUT_MS = 4500;

type LocalPlace = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

const darPlaces: LocalPlace[] = [
  { name: 'Kariakoo', address: 'Kariakoo, Ilala, Dar es Salaam', latitude: -6.8219, longitude: 39.2764 },
  { name: 'Kariakoo Market', address: 'Kariakoo Market, Dar es Salaam', latitude: -6.8228, longitude: 39.2752 },
  { name: 'Posta', address: 'Posta, City Centre, Dar es Salaam', latitude: -6.8163, longitude: 39.2895 },
  { name: 'Askari Monument', address: 'Askari Monument, Dar es Salaam', latitude: -6.8161, longitude: 39.2899 },
  { name: 'Ferry', address: 'Kivukoni Ferry, Dar es Salaam', latitude: -6.8218, longitude: 39.2924 },
  { name: 'Kivukoni', address: 'Kivukoni, Ilala, Dar es Salaam', latitude: -6.8196, longitude: 39.2942 },
  { name: 'Upanga', address: 'Upanga, Ilala, Dar es Salaam', latitude: -6.8078, longitude: 39.2748 },
  { name: 'Kisutu', address: 'Kisutu, Ilala, Dar es Salaam', latitude: -6.8142, longitude: 39.2836 },
  { name: 'Gerezani', address: 'Gerezani, Ilala, Dar es Salaam', latitude: -6.8184, longitude: 39.2711 },
  { name: 'Ilala', address: 'Ilala, Dar es Salaam', latitude: -6.8244, longitude: 39.2583 },
  { name: 'Buguruni', address: 'Buguruni, Ilala, Dar es Salaam', latitude: -6.8306, longitude: 39.2608 },
  { name: 'Vingunguti', address: 'Vingunguti, Ilala, Dar es Salaam', latitude: -6.8351, longitude: 39.2454 },
  { name: 'Tabata', address: 'Tabata, Ilala, Dar es Salaam', latitude: -6.8302, longitude: 39.2298 },
  { name: 'Segerea', address: 'Segerea, Ilala, Dar es Salaam', latitude: -6.8386, longitude: 39.2174 },
  { name: 'Ukonga', address: 'Ukonga, Ilala, Dar es Salaam', latitude: -6.8724, longitude: 39.1726 },
  { name: 'Gongolamboto', address: 'Gongolamboto, Ilala, Dar es Salaam', latitude: -6.8758, longitude: 39.1582 },
  { name: 'Pugu', address: 'Pugu, Ilala, Dar es Salaam', latitude: -6.8984, longitude: 39.1168 },
  { name: 'Mikocheni', address: 'Mikocheni, Kinondoni, Dar es Salaam', latitude: -6.7654, longitude: 39.2502 },
  { name: 'Mikocheni B', address: 'Mikocheni B, Dar es Salaam', latitude: -6.7588, longitude: 39.2416 },
  { name: 'Masaki', address: 'Masaki, Kinondoni, Dar es Salaam', latitude: -6.7462, longitude: 39.2794 },
  { name: 'Oyster Bay', address: 'Oyster Bay, Kinondoni, Dar es Salaam', latitude: -6.7684, longitude: 39.2771 },
  { name: 'Msasani', address: 'Msasani, Kinondoni, Dar es Salaam', latitude: -6.7541, longitude: 39.2692 },
  { name: 'Slipway', address: 'Msasani Slipway, Dar es Salaam', latitude: -6.7488, longitude: 39.2756 },
  { name: 'Coco Beach', address: 'Coco Beach, Kawe, Dar es Salaam', latitude: -6.7386, longitude: 39.2384 },
  { name: 'Kawe', address: 'Kawe, Kinondoni, Dar es Salaam', latitude: -6.7308, longitude: 39.2296 },
  { name: 'Mbezi Beach', address: 'Mbezi Beach, Kinondoni, Dar es Salaam', latitude: -6.6994, longitude: 39.2188 },
  { name: 'Tegeta', address: 'Tegeta, Kinondoni, Dar es Salaam', latitude: -6.6612, longitude: 39.1834 },
  { name: 'Bunju', address: 'Bunju, Kinondoni, Dar es Salaam', latitude: -6.6284, longitude: 39.1482 },
  { name: 'Mwenge', address: 'Mwenge, Kinondoni, Dar es Salaam', latitude: -6.7718, longitude: 39.2294 },
  { name: 'Mlimani City', address: 'Mlimani City Mall, Ubungo, Dar es Salaam', latitude: -6.7732, longitude: 39.2406 },
  { name: 'Sinza', address: 'Sinza, Kinondoni, Dar es Salaam', latitude: -6.7784, longitude: 39.2302 },
  { name: 'Kijitonyama', address: 'Kijitonyama, Kinondoni, Dar es Salaam', latitude: -6.7756, longitude: 39.2408 },
  { name: 'Mwananyamala', address: 'Mwananyamala, Kinondoni, Dar es Salaam', latitude: -6.7782, longitude: 39.2604 },
  { name: 'Kinondoni', address: 'Kinondoni, Dar es Salaam', latitude: -6.7874, longitude: 39.2652 },
  { name: 'Magomeni', address: 'Magomeni, Kinondoni, Dar es Salaam', latitude: -6.8052, longitude: 39.2556 },
  { name: 'Tandale', address: 'Tandale, Kinondoni, Dar es Salaam', latitude: -6.7908, longitude: 39.2402 },
  { name: 'Manzese', address: 'Manzese, Kinondoni, Dar es Salaam', latitude: -6.8004, longitude: 39.2321 },
  { name: 'Ubungo', address: 'Ubungo, Dar es Salaam', latitude: -6.7924, longitude: 39.2083 },
  { name: 'Kimara', address: 'Kimara, Ubungo, Dar es Salaam', latitude: -6.7842, longitude: 39.1664 },
  { name: 'Goba', address: 'Goba, Ubungo, Dar es Salaam', latitude: -6.7408, longitude: 39.1806 },
  { name: 'Mbezi Louis', address: 'Mbezi Louis, Ubungo, Dar es Salaam', latitude: -6.7106, longitude: 39.1608 },
  { name: 'Saranga', address: 'Saranga, Ubungo, Dar es Salaam', latitude: -6.7624, longitude: 39.1882 },
  { name: 'Kibo', address: 'Kibo, Ubungo, Dar es Salaam', latitude: -6.7688, longitude: 39.2014 },
  { name: 'University of Dar es Salaam', address: 'UDSM, Ubungo, Dar es Salaam', latitude: -6.7806, longitude: 39.2052 },
  { name: 'Muhimbili', address: 'Muhimbili National Hospital, Upanga', latitude: -6.8084, longitude: 39.2732 },
  { name: 'Shoppers Plaza', address: 'Shoppers Plaza, Mikocheni, Dar es Salaam', latitude: -6.7658, longitude: 39.2696 },
  { name: 'Quality Centre', address: 'Quality Centre Mall, Changombe, Dar es Salaam', latitude: -6.8452, longitude: 39.2754 },
  { name: 'Mbagala', address: 'Mbagala, Temeke, Dar es Salaam', latitude: -6.8998, longitude: 39.266 },
  { name: 'Mbagala Kuu', address: 'Mbagala Kuu, Temeke, Dar es Salaam', latitude: -6.9124, longitude: 39.2718 },
  { name: 'Mbagala Rangi Tatu', address: 'Mbagala Rangi Tatu, Temeke, Dar es Salaam', latitude: -6.9186, longitude: 39.2584 },
  { name: 'Temeke', address: 'Temeke, Dar es Salaam', latitude: -6.8502, longitude: 39.2634 },
  { name: "Chang'ombe", address: "Chang'ombe, Temeke, Dar es Salaam", latitude: -6.8456, longitude: 39.2702 },
  { name: 'Keko', address: 'Keko, Temeke, Dar es Salaam', latitude: -6.8354, longitude: 39.2806 },
  { name: 'Kurasini', address: 'Kurasini, Temeke, Dar es Salaam', latitude: -6.8508, longitude: 39.2904 },
  { name: 'Mtoni', address: 'Mtoni, Temeke, Dar es Salaam', latitude: -6.8702, longitude: 39.2808 },
  { name: 'Kigamboni', address: 'Kigamboni, Dar es Salaam', latitude: -6.8214, longitude: 39.3256 },
  { name: 'Kigamboni Ferry', address: 'Kigamboni Ferry Terminal, Dar es Salaam', latitude: -6.8226, longitude: 39.3184 },
  { name: 'Tandika', address: 'Tandika, Temeke, Dar es Salaam', latitude: -6.8624, longitude: 39.2586 },
  { name: 'Mjimwema', address: 'Mjimwema, Kigamboni, Dar es Salaam', latitude: -6.8348, longitude: 39.3482 },
  { name: 'Kibada', address: 'Kibada, Kigamboni, Dar es Salaam', latitude: -6.8586, longitude: 39.3524 },
  { name: 'Julius Nyerere International Airport', address: 'JNIA, Dar es Salaam', latitude: -6.8781, longitude: 39.2026 },
  { name: 'Airport', address: 'Julius Nyerere International Airport, Dar es Salaam', latitude: -6.8781, longitude: 39.2026 },
  { name: 'Nyerere Square', address: 'Nyerere Square, Dar es Salaam', latitude: -6.8148, longitude: 39.2864 },
  { name: 'Village Museum', address: 'Makumbusho Village Museum, Dar es Salaam', latitude: -6.7688, longitude: 39.2362 },
  { name: 'Makumbusho', address: 'Makumbusho, Kinondoni, Dar es Salaam', latitude: -6.7704, longitude: 39.2378 },
  { name: 'Namanga', address: 'Namanga, Kinondoni, Dar es Salaam', latitude: -6.7602, longitude: 39.2734 },
  { name: 'Regent Estate', address: 'Regent Estate, Mikocheni, Dar es Salaam', latitude: -6.7614, longitude: 39.2586 },
  { name: 'Ada Estate', address: 'Ada Estate, Kinondoni, Dar es Salaam', latitude: -6.7726, longitude: 39.2688 },
  { name: 'Wazo Hill', address: 'Wazo Hill, Kinondoni, Dar es Salaam', latitude: -6.6784, longitude: 39.1982 },
  { name: 'Salasala', address: 'Salasala, Kinondoni, Dar es Salaam', latitude: -6.6886, longitude: 39.2084 },
  { name: 'Kunduchi', address: 'Kunduchi, Kinondoni, Dar es Salaam', latitude: -6.6628, longitude: 39.2086 },
  { name: 'Boko', address: 'Boko, Kinondoni, Dar es Salaam', latitude: -6.6482, longitude: 39.1684 },
  { name: 'Mbezi Mwisho', address: 'Mbezi Mwisho, Ubungo, Dar es Salaam', latitude: -6.7048, longitude: 39.1426 },
  { name: 'Kimara Stop Over', address: 'Kimara Stop Over, Ubungo, Dar es Salaam', latitude: -6.7868, longitude: 39.1548 },
  { name: 'Shekilango', address: 'Shekilango, Sinza, Dar es Salaam', latitude: -6.7764, longitude: 39.2246 },
  { name: 'Morocco', address: 'Morocco, Kinondoni, Dar es Salaam', latitude: -6.7926, longitude: 39.2684 },
  { name: 'Hananasif', address: 'Hananasif, Kinondoni, Dar es Salaam', latitude: -6.7984, longitude: 39.2722 },
  { name: 'Kigogo', address: 'Kigogo, Kinondoni, Dar es Salaam', latitude: -6.8088, longitude: 39.2464 },
  { name: 'Mchikichini', address: 'Mchikichini, Ilala, Dar es Salaam', latitude: -6.8186, longitude: 39.2668 },
  { name: 'Jangwani', address: 'Jangwani, Ilala, Dar es Salaam', latitude: -6.8124, longitude: 39.2612 },
  { name: 'Kivule', address: 'Kivule, Ilala, Dar es Salaam', latitude: -6.8584, longitude: 39.1886 },
  { name: 'Chanika', address: 'Chanika, Ilala, Dar es Salaam', latitude: -6.9186, longitude: 39.1424 },
  { name: 'Kitunda', address: 'Kitunda, Ilala, Dar es Salaam', latitude: -6.8588, longitude: 39.2082 },
  { name: 'Kinyerezi', address: 'Kinyerezi, Ilala, Dar es Salaam', latitude: -6.8482, longitude: 39.1884 },
  { name: 'Yombo Vituka', address: 'Yombo Vituka, Temeke, Dar es Salaam', latitude: -6.8784, longitude: 39.2486 },
  { name: 'Yombo', address: 'Yombo, Temeke, Dar es Salaam', latitude: -6.8686, longitude: 39.2524 },
  { name: 'Charambe', address: 'Charambe, Temeke, Dar es Salaam', latitude: -6.9284, longitude: 39.2482 },
  { name: 'Mbagala Kijichi', address: 'Kijichi, Mbagala, Dar es Salaam', latitude: -6.9088, longitude: 39.2786 },
  { name: 'Somangila', address: 'Somangila, Kigamboni, Dar es Salaam', latitude: -6.8486, longitude: 39.3784 },
];

let googlePlacesDenied = false;

function toSuggestion(place: LocalPlace, index: number): FallbackSuggestion {
  return {
    id: `local:${place.name}:${index}`,
    placeId: `local:${place.name}`,
    name: place.name,
    address: place.address,
    fullText: `${place.name}, ${place.address}`,
    featureType: 'locality',
    coordinates: {
      latitude: place.latitude,
      longitude: place.longitude,
    },
  };
}

function normalizeHaystack(value: string) {
  return value.toLowerCase().replace(/['’]/g, '');
}

export function searchLocalPlaces(query: string, limit = 6): FallbackSuggestion[] {
  const needle = normalizeHaystack(query.trim());
  if (needle.length < 2) {
    return [];
  }

  const ranked = darPlaces
    .map((place, index) => {
      const name = normalizeHaystack(place.name);
      const address = normalizeHaystack(place.address);
      const starts = name.startsWith(needle) || address.startsWith(needle);
      const includes = name.includes(needle) || address.includes(needle);
      if (!starts && !includes) {
        return null;
      }

      return {
        suggestion: toSuggestion(place, index),
        rank: starts ? 0 : 1,
        name,
      };
    })
    .filter(Boolean) as { suggestion: FallbackSuggestion; rank: number; name: string }[];

  ranked.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  return ranked.slice(0, limit).map((item) => item.suggestion);
}

function mergeSuggestions(lists: FallbackSuggestion[][], limit: number) {
  const seen = new Set<string>();
  const merged: FallbackSuggestion[] = [];

  for (const list of lists) {
    for (const suggestion of list) {
      const key = normalizeHaystack(suggestion.placeId || suggestion.fullText || suggestion.name);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(suggestion);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }

  return merged;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FALLBACK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

type PhotonFeature = {
  geometry?: { coordinates?: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_value?: string;
  };
};

async function fetchPhotonSuggestions(query: string, origin?: RoutePoint, limit = 6): Promise<FallbackSuggestion[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(Math.max(limit, 8)));
  url.searchParams.set('lang', 'en');
  if (origin) {
    url.searchParams.set('lat', String(origin.latitude));
    url.searchParams.set('lon', String(origin.longitude));
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Photon search failed with ${response.status}`);
  }

  const payload = (await response.json()) as { features?: PhotonFeature[] };
  return (payload.features ?? [])
    .map((feature, index) => {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      const properties = feature.properties ?? {};
      const countryCode = String(properties.countrycode ?? '').toUpperCase();
      if (countryCode && countryCode !== 'TZ') {
        return null;
      }

      const name = properties.name?.trim() || properties.street?.trim() || query;
      const address = [
        properties.housenumber && properties.street ? `${properties.street} ${properties.housenumber}` : properties.street,
        properties.district,
        properties.city || properties.county,
        properties.state,
        properties.country,
      ]
        .filter(Boolean)
        .join(', ');

      return {
        id: `photon:${name}:${latitude}:${longitude}:${index}`,
        placeId: `photon:${latitude},${longitude}`,
        name,
        address: address || 'Tanzania',
        fullText: [name, address].filter(Boolean).join(', '),
        featureType: properties.osm_value || 'place',
        coordinates: { latitude, longitude },
      } satisfies FallbackSuggestion;
    })
    .filter(Boolean)
    .slice(0, limit) as FallbackSuggestion[];
}

type NominatimHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: {
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

async function fetchNominatimSuggestions(query: string, limit = 6): Promise<FallbackSuggestion[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('countrycodes', 'tz');

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DoorDrop/1.0 (customer-app)',
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim search failed with ${response.status}`);
  }

  const payload = (await response.json()) as NominatimHit[];
  return (Array.isArray(payload) ? payload : [])
    .map((hit, index) => {
      const latitude = Number(hit.lat);
      const longitude = Number(hit.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      const name =
        hit.name?.trim() ||
        hit.address?.suburb ||
        hit.address?.neighbourhood ||
        hit.address?.city ||
        query;
      const address = hit.display_name?.trim() || [hit.address?.city, hit.address?.state, hit.address?.country].filter(Boolean).join(', ');

      return {
        id: `osm:${name}:${latitude}:${longitude}:${index}`,
        placeId: `osm:${latitude},${longitude}`,
        name,
        address,
        fullText: address || name,
        featureType: 'place',
        coordinates: { latitude, longitude },
      } satisfies FallbackSuggestion;
    })
    .filter(Boolean)
    .slice(0, limit) as FallbackSuggestion[];
}

type GooglePrediction = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    types?: string[];
  };
};

async function fetchGooglePlacesSuggestions(query: string, origin?: RoutePoint, limit = 6): Promise<FallbackSuggestion[]> {
  if (googlePlacesDenied) {
    return [];
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    googlePlacesDenied = true;
    return [];
  }

  const response = await fetchWithTimeout('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      input: query,
      languageCode: 'en',
      regionCode: 'TZ',
      includedRegionCodes: ['TZ'],
      origin: origin ? { latitude: origin.latitude, longitude: origin.longitude } : undefined,
      locationBias: origin
        ? {
            circle: {
              center: { latitude: origin.latitude, longitude: origin.longitude },
              radius: 50000,
            },
          }
        : undefined,
    }),
  });

  if (response.status === 403 || response.status === 401) {
    googlePlacesDenied = true;
    throw new Error(`Google Places denied (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`Google Places autocomplete failed with ${response.status}`);
  }

  const payload = (await response.json()) as { suggestions?: GooglePrediction[] };
  return (payload.suggestions ?? [])
    .map((item) => item.placePrediction)
    .filter((prediction): prediction is NonNullable<GooglePrediction['placePrediction']> => Boolean(prediction?.placeId))
    .map((prediction) => {
      const fullText = prediction.text?.text?.trim() || '';
      const name = prediction.structuredFormat?.mainText?.text?.trim() || fullText || query;
      const address = prediction.structuredFormat?.secondaryText?.text?.trim() || '';
      const placeId = String(prediction.placeId);

      return {
        id: placeId,
        placeId,
        name,
        address,
        fullText: fullText || [name, address].filter(Boolean).join(', '),
        featureType: prediction.types?.[0] || 'place',
      } satisfies FallbackSuggestion;
    })
    .slice(0, limit);
}

export async function fetchFallbackSuggestions(
  query: string,
  origin?: RoutePoint,
  limit = 6
): Promise<FallbackSuggestion[]> {
  const local = searchLocalPlaces(query, limit);
  if (local.length >= 2) {
    return local;
  }

  const remoteResults = await Promise.allSettled([
    fetchGooglePlacesSuggestions(query, origin, limit),
    fetchPhotonSuggestions(query, origin, limit),
    fetchNominatimSuggestions(query, limit),
  ]);

  remoteResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      const source = index === 0 ? 'google' : index === 1 ? 'photon' : 'nominatim';
      logWarning(screenScope, `${source} fallback failed`, {
        query,
      });
    }
  });

  const remote = remoteResults
    .filter((result): result is PromiseFulfilledResult<FallbackSuggestion[]> => result.status === 'fulfilled')
    .flatMap((result) => result.value);

  return mergeSuggestions([local, remote], limit);
}
