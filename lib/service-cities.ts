import { getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';

export type ServiceCityKey =
  | 'dar-es-salaam'
  | 'mwanza'
  | 'arusha'
  | 'dodoma'
  | 'mbeya'
  | 'tanga'
  | 'morogoro'
  | 'mtwara';

export type ServiceCity = {
  key: ServiceCityKey;
  label: string;
  center: RoutePoint;
  /** Soft/hard search radius in meters for Places city lock */
  searchRadiusMeters: number;
  aliases: string[];
};

/** Cities where DoorDrop city-delivery search should stay locked. */
export const SERVICE_CITIES: ServiceCity[] = [
  {
    key: 'dar-es-salaam',
    label: 'Dar es Salaam',
    center: { latitude: -6.7924, longitude: 39.2083 },
    searchRadiusMeters: 120_000,
    aliases: ['dar es salaam', 'dar', 'dsm', 'ilala', 'kinondoni', 'temeke', 'ubungo', 'kigamboni'],
  },
  {
    key: 'mwanza',
    label: 'Mwanza',
    center: { latitude: -2.5164, longitude: 32.9175 },
    searchRadiusMeters: 120_000,
    aliases: ['mwanza', 'ilemela', 'nyamagana', 'nyegezi', 'nyakato', 'igoma', 'buhongwa'],
  },
  {
    key: 'arusha',
    label: 'Arusha',
    center: { latitude: -3.3869, longitude: 36.683 },
    searchRadiusMeters: 100_000,
    aliases: ['arusha'],
  },
  {
    key: 'dodoma',
    label: 'Dodoma',
    center: { latitude: -6.163, longitude: 35.7516 },
    searchRadiusMeters: 100_000,
    aliases: ['dodoma'],
  },
  {
    key: 'mbeya',
    label: 'Mbeya',
    center: { latitude: -8.9094, longitude: 33.4608 },
    searchRadiusMeters: 100_000,
    aliases: ['mbeya'],
  },
  {
    key: 'tanga',
    label: 'Tanga',
    center: { latitude: -5.0889, longitude: 39.1023 },
    searchRadiusMeters: 100_000,
    aliases: ['tanga'],
  },
  {
    key: 'morogoro',
    label: 'Morogoro',
    center: { latitude: -6.8278, longitude: 37.6591 },
    searchRadiusMeters: 100_000,
    aliases: ['morogoro'],
  },
  {
    key: 'mtwara',
    label: 'Mtwara',
    center: { latitude: -10.2667, longitude: 40.1833 },
    searchRadiusMeters: 100_000,
    aliases: ['mtwara'],
  },
];

const DEFAULT_CITY_RADIUS_METERS = 120_000;

export function getNearestServiceCity(point: RoutePoint): ServiceCity {
  return SERVICE_CITIES.reduce((closest, city) => {
    const distance = getDistanceBetweenPoints(point, city.center);
    if (!closest || distance < closest.distance) {
      return { city, distance };
    }
    return closest;
  }, null as { city: ServiceCity; distance: number } | null)!.city;
}

function normalizePlaceText(value: string) {
  return value.toLowerCase().replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim();
}

function textMentionsCity(text: string, city: ServiceCity) {
  const haystack = normalizePlaceText(text);
  return city.aliases.some((alias) => haystack.includes(alias));
}

function textMentionsOtherCity(text: string, activeCity: ServiceCity) {
  return SERVICE_CITIES.some((city) => {
    if (city.key === activeCity.key) {
      return false;
    }
    return textMentionsCity(text, city);
  });
}

export type CityLockableSuggestion = {
  name: string;
  address?: string;
  fullText?: string;
  coordinates?: RoutePoint | null;
};

/**
 * Keep autocomplete results inside the user's active city/region.
 * Uses coordinates when present, otherwise filters by city names in the address text.
 */
export function filterSuggestionsToServiceCity<T extends CityLockableSuggestion>(
  suggestions: T[],
  origin?: RoutePoint | null,
  maxResults = 8
): T[] {
  if (!origin || !suggestions.length) {
    return suggestions.slice(0, maxResults);
  }

  const activeCity = getNearestServiceCity(origin);
  const maxMeters = activeCity.searchRadiusMeters || DEFAULT_CITY_RADIUS_METERS;

  const filtered = suggestions.filter((suggestion) => {
    const label = [suggestion.name, suggestion.address, suggestion.fullText].filter(Boolean).join(' ');

    if (suggestion.coordinates) {
      const distanceMeters = getDistanceBetweenPoints(origin, suggestion.coordinates);
      if (distanceMeters > maxMeters) {
        return false;
      }
    }

    if (textMentionsOtherCity(label, activeCity) && !textMentionsCity(label, activeCity)) {
      return false;
    }

    return true;
  });

  return (filtered.length ? filtered : suggestions).slice(0, maxResults);
}

export function isPointNearServiceCity(point: RoutePoint, city: ServiceCity, radiusMeters = city.searchRadiusMeters) {
  return getDistanceBetweenPoints(point, city.center) <= radiusMeters;
}

/** Cargo (TOYO/Kirikuu) is Dar es Salaam metro only. */
export const CARGO_SERVICE_RADIUS_METERS = 55_000;

export function getDarEsSalaamServiceCity() {
  return SERVICE_CITIES.find((city) => city.key === 'dar-es-salaam')!;
}

export function isCargoServiceAvailableAt(point: RoutePoint | null | undefined) {
  if (!point) {
    return false;
  }
  const dar = getDarEsSalaamServiceCity();
  return isPointNearServiceCity(point, dar, CARGO_SERVICE_RADIUS_METERS);
}
