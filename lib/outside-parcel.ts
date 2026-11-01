import { getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';

export type OutsideShippingMode = 'standard' | 'express';
export type OutsideHandoffMode = 'bus' | 'airport' | 'home';

export type OutsideHub = {
  id: string;
  label: string;
  query: string;
  fallbackPoint: RoutePoint;
};

export type OutsideDestinationCity = {
  key: string;
  label: string;
  centerPoint: RoutePoint;
  stands: OutsideHub[];
  airports: OutsideHub[];
  /** When false, Express/air is hidden as unavailable for this city. Defaults to true. */
  expressEnabled?: boolean;
  /** When false, home delivery handoff is hidden. Defaults from OUTSIDE_HOME_DELIVERY_CITY_KEYS. */
  homeDeliveryEnabled?: boolean;
  /** When false, city is hidden from customer destination list. Defaults to true. */
  active?: boolean;
  sortOrder?: number;
};

export const OUTSIDE_EXPRESS_AIRPORT_FARE = 15000;
export const OUTSIDE_EXPRESS_HOME_FARE = 18000;
export const OUTSIDE_BUS_STAND_FARE = 13000;
export const OUTSIDE_BUS_STAND_FARE_KARIAKOO = 12000;
export const OUTSIDE_BUS_HOME_FARE = 15000;
/** Kariakoo market area — cheaper bus-stand handoff from this pickup zone. */
export const KARIAKOO_PICKUP_CENTER: RoutePoint = { latitude: -6.8219, longitude: 39.2764 };
export const KARIAKOO_PICKUP_RADIUS_METERS = 2500;
/** Express (flight) parcels: small and medium only. Large cargo goes by company. */
export const OUTSIDE_EXPRESS_MAX_KG = 20;
export const OUTSIDE_STANDARD_MAX_KG = 150;
/** Home within this radius of destination airport bills as airport handoff on Dar–Zanzibar air. */
export const OUTSIDE_EXPRESS_NEAR_AIRPORT_RADIUS_METERS = 1000;

export const outsideDestinationCities: OutsideDestinationCity[] = [
  {
    key: 'dar-es-salaam',
    label: 'Dar es Salaam',
    sortOrder: 10,
    homeDeliveryEnabled: true,
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
    airports: [
      {
        id: 'jnia',
        label: 'Julius Nyerere International Airport',
        query: 'Julius Nyerere International Airport, Dar es Salaam, Tanzania',
        fallbackPoint: { latitude: -6.8781, longitude: 39.2026 },
      },
    ],
  },
  {
    key: 'zanzibar',
    label: 'Zanzibar',
    sortOrder: 15,
    homeDeliveryEnabled: true,
    centerPoint: { latitude: -6.1659, longitude: 39.2026 },
    stands: [
      {
        id: 'ferry',
        label: 'Malindi Ferry Terminal',
        query: 'Malindi Ferry Terminal, Zanzibar, Tanzania',
        fallbackPoint: { latitude: -6.1598, longitude: 39.1925 },
      },
      {
        id: 'darajani',
        label: 'Darajani Market',
        query: 'Darajani Market, Stone Town, Zanzibar, Tanzania',
        fallbackPoint: { latitude: -6.1629, longitude: 39.1912 },
      },
    ],
    airports: [
      {
        id: 'znz',
        label: 'Abeid Amani Karume International Airport',
        query: 'Abeid Amani Karume International Airport, Zanzibar, Tanzania',
        fallbackPoint: { latitude: -6.222, longitude: 39.2249 },
      },
    ],
  },
  {
    key: 'mwanza',
    label: 'Mwanza',
    sortOrder: 20,
    homeDeliveryEnabled: true,
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
    airports: [
      {
        id: 'mwanza-airport',
        label: 'Mwanza Airport',
        query: 'Mwanza Airport, Mwanza, Tanzania',
        fallbackPoint: { latitude: -2.4445, longitude: 32.9327 },
      },
    ],
  },
  {
    key: 'arusha',
    label: 'Arusha',
    sortOrder: 30,
    homeDeliveryEnabled: true,
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
    airports: [
      {
        id: 'arusha-airport',
        label: 'Arusha Airport',
        query: 'Arusha Airport, Arusha, Tanzania',
        fallbackPoint: { latitude: -3.3678, longitude: 36.6333 },
      },
      {
        id: 'kilimanjaro',
        label: 'Kilimanjaro International Airport',
        query: 'Kilimanjaro International Airport, Tanzania',
        fallbackPoint: { latitude: -3.4294, longitude: 37.0745 },
      },
    ],
  },
  {
    key: 'dodoma',
    label: 'Dodoma',
    sortOrder: 40,
    homeDeliveryEnabled: true,
    centerPoint: { latitude: -6.163, longitude: 35.7516 },
    stands: [
      {
        id: 'jamatini',
        label: 'Jamatini Bus Stand',
        query: 'Jamatini Bus Stand, Dodoma, Tanzania',
        fallbackPoint: { latitude: -6.175, longitude: 35.745 },
      },
    ],
    airports: [
      {
        id: 'dodoma-airport',
        label: 'Dodoma Airport',
        query: 'Dodoma Airport, Dodoma, Tanzania',
        fallbackPoint: { latitude: -6.17, longitude: 35.7526 },
      },
    ],
  },
  {
    key: 'kahama',
    label: 'Kahama',
    sortOrder: 50,
    homeDeliveryEnabled: false,
    centerPoint: { latitude: -3.5922, longitude: 32.0089 },
    stands: [
      {
        id: 'central',
        label: 'Kahama Bus Stand',
        query: 'Kahama Bus Stand, Kahama, Tanzania',
        fallbackPoint: { latitude: -3.5922, longitude: 32.0089 },
      },
    ],
    airports: [],
  },
  {
    key: 'mtwara',
    label: 'Mtwara',
    sortOrder: 60,
    homeDeliveryEnabled: false,
    centerPoint: { latitude: -10.2667, longitude: 40.1833 },
    stands: [
      {
        id: 'central',
        label: 'Mtwara Bus Stand',
        query: 'Mtwara Bus Stand, Mtwara, Tanzania',
        fallbackPoint: { latitude: -10.2706, longitude: 40.1822 },
      },
      {
        id: 'mikindani',
        label: 'Mikindani Bus Stand',
        query: 'Mikindani Bus Stand, Mtwara, Tanzania',
        fallbackPoint: { latitude: -10.2816, longitude: 40.1185 },
      },
    ],
    airports: [
      {
        id: 'mtwara-airport',
        label: 'Mtwara Airport',
        query: 'Mtwara Airport, Mtwara, Tanzania',
        fallbackPoint: { latitude: -10.3391, longitude: 40.1818 },
      },
    ],
  },
];

export type OutsideDestinationCityKey = OutsideDestinationCity['key'];

const ZANZIBAR_SEA_CITY_KEYS = new Set(['zanzibar', 'unguja', 'pemba']);

/** Zanzibar / Unguja / Pemba use the existing standard (road/sea) fare as ferry, not bus. */
export function isZanzibarSeaDestination(
  city?: { key?: string | null; label?: string | null } | string | null
) {
  if (!city) {
    return false;
  }

  const key = (typeof city === 'string' ? city : city.key || '').trim().toLowerCase();
  const label = (typeof city === 'string' ? '' : city.label || '').trim().toLowerCase();

  if (
    ZANZIBAR_SEA_CITY_KEYS.has(key) ||
    key.includes('zanzibar') ||
    key.includes('unguja') ||
    key.includes('pemba')
  ) {
    return true;
  }

  return /\b(zanzibar|unguja|pemba)\b/.test(label);
}

function isFerryHub(hub: OutsideHub) {
  return /ferry|malindi|bandari/i.test(`${hub.id} ${hub.label} ${hub.query}`);
}

/** Primary destination stand / airport for a mkoa. First real hub already stored for that mode. */
export function getDefaultDestinationHub(
  city: OutsideDestinationCity | null | undefined,
  shippingMode?: OutsideShippingMode | null
): OutsideHub | null {
  if (!city) {
    return null;
  }

  if (shippingMode === 'express') {
    return city.airports[0] ?? null;
  }

  if (isZanzibarSeaDestination(city)) {
    return city.stands.find(isFerryHub) ?? city.stands[0] ?? null;
  }

  return city.stands[0] ?? null;
}

/** Regions where express/standard home delivery is offered. Others are hub/airport pickup only. */
export const OUTSIDE_HOME_DELIVERY_CITY_KEYS: OutsideDestinationCityKey[] = [
  'mwanza',
  'dar-es-salaam',
  'arusha',
  'dodoma',
  'zanzibar',
];

export function getOutsideMaxWeightKg(mode: OutsideShippingMode | null | undefined) {
  return mode === 'express' ? OUTSIDE_EXPRESS_MAX_KG : OUTSIDE_STANDARD_MAX_KG;
}

export function isOutsideWeightValid(weightKg: number, mode: OutsideShippingMode | null | undefined) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return false;
  }

  if (mode === 'express') {
    return weightKg <= OUTSIDE_EXPRESS_MAX_KG;
  }

  return weightKg <= OUTSIDE_STANDARD_MAX_KG;
}

export function isOutsideHomeNearDestinationAirport(params: {
  dropoffPoint?: RoutePoint | null;
  destinationCity?: OutsideDestinationCity | null;
}) {
  if (!params.dropoffPoint || !params.destinationCity) {
    return false;
  }

  return params.destinationCity.airports.some(
    (airport) =>
      getDistanceBetweenPoints(params.dropoffPoint!, airport.fallbackPoint) <=
      OUTSIDE_EXPRESS_NEAR_AIRPORT_RADIUS_METERS
  );
}

export function getOutsideParcelFlatFare(params: {
  destinationCityKey?: OutsideDestinationCityKey | null;
  destinationCity?: OutsideDestinationCity | null;
  shippingMode?: OutsideShippingMode | null;
  handoffMode?: OutsideHandoffMode | null;
  pickupPoint?: RoutePoint | null;
  pickupLabel?: string | null;
  dropoffPoint?: RoutePoint | null;
  /** Dar ↔ Zanzibar express: home only; near-airport home uses airport fare. */
  expressHomeDeliveryMandatory?: boolean;
}) {
  const { shippingMode, handoffMode, pickupPoint, pickupLabel, dropoffPoint, destinationCity, expressHomeDeliveryMandatory } =
    params;

  if (shippingMode === 'express') {
    if (
      expressHomeDeliveryMandatory &&
      isOutsideHomeNearDestinationAirport({ dropoffPoint, destinationCity })
    ) {
      return OUTSIDE_EXPRESS_AIRPORT_FARE;
    }

    return handoffMode === 'home' ? OUTSIDE_EXPRESS_HOME_FARE : OUTSIDE_EXPRESS_AIRPORT_FARE;
  }

  if (handoffMode === 'home') {
    return OUTSIDE_BUS_HOME_FARE;
  }

  if (isPickupInKariakoo(pickupPoint, pickupLabel)) {
    return OUTSIDE_BUS_STAND_FARE_KARIAKOO;
  }

  return OUTSIDE_BUS_STAND_FARE;
}

export function isPickupInKariakoo(point?: RoutePoint | null, label?: string | null) {
  if (typeof label === 'string' && /kariakoo/i.test(label)) {
    return true;
  }

  if (
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    getDistanceBetweenPoints(point, KARIAKOO_PICKUP_CENTER) <= KARIAKOO_PICKUP_RADIUS_METERS
  ) {
    return true;
  }

  return false;
}

export function getNearestOutsideCity(point: RoutePoint): OutsideDestinationCity | undefined {
  return outsideDestinationCities.reduce((closest, city) => {
    const distance = getDistanceBetweenPoints(point, city.centerPoint);
    if (!closest || distance < closest.distance) {
      return { city, distance };
    }
    return closest;
  }, null as { city: OutsideDestinationCity; distance: number } | null)?.city;
}

export function findOutsideCityByLabel(label?: string | null) {
  const normalized = String(label || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    outsideDestinationCities.find(
      (city) => city.key === normalized || city.label.toLowerCase() === normalized
    ) ?? null
  );
}

export function isOutsideCityActive(city: OutsideDestinationCity | null | undefined) {
  return Boolean(city) && city?.active !== false;
}

export function isOutsideExpressAvailable(params: {
  city?: OutsideDestinationCity | null;
  expressEnabledGlobally?: boolean;
}) {
  const { city, expressEnabledGlobally = true } = params;
  if (!expressEnabledGlobally) {
    return false;
  }
  if (!isOutsideCityActive(city)) {
    return false;
  }
  return city?.expressEnabled !== false;
}

export function isOutsideHomeDeliveryAvailable(city?: OutsideDestinationCity | null) {
  if (!isOutsideCityActive(city) || !city) {
    return false;
  }
  if (city.homeDeliveryEnabled === true) {
    return true;
  }
  if (city.homeDeliveryEnabled === false) {
    return false;
  }
  return OUTSIDE_HOME_DELIVERY_CITY_KEYS.includes(city.key);
}

export function normalizeOutsideDestinationCity(
  raw: Partial<OutsideDestinationCity> & { key?: string; id?: string },
  index = 0
): OutsideDestinationCity | null {
  const key = String(raw.key || raw.id || '').trim();
  const label = String(raw.label || '').trim();
  if (!key || !label) {
    return null;
  }

  const latitude = Number(raw.centerPoint?.latitude ?? raw.center?.latitude);
  const longitude = Number(raw.centerPoint?.longitude ?? raw.center?.longitude);
  const centerPoint =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : { latitude: -6.369, longitude: 34.8888 };

  const stands = Array.isArray(raw.stands)
    ? raw.stands
        .map((stand, standIndex) => normalizeOutsideHub(stand, `${key}-stand-${standIndex}`, label, centerPoint))
        .filter(Boolean) as OutsideHub[]
    : [];
  const airports = Array.isArray(raw.airports)
    ? raw.airports
        .map((airport, airportIndex) =>
          normalizeOutsideHub(airport, `${key}-airport-${airportIndex}`, label, centerPoint)
        )
        .filter(Boolean) as OutsideHub[]
    : [];

  return {
    key,
    label,
    centerPoint,
    stands,
    airports,
    expressEnabled: raw.expressEnabled !== false,
    homeDeliveryEnabled:
      typeof raw.homeDeliveryEnabled === 'boolean'
        ? raw.homeDeliveryEnabled
        : OUTSIDE_HOME_DELIVERY_CITY_KEYS.includes(key as OutsideDestinationCityKey),
    active: raw.active !== false,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : (index + 1) * 10,
  };
}

function normalizeOutsideHub(
  raw: Partial<OutsideHub> | null | undefined,
  fallbackId: string,
  cityLabel: string,
  cityCenter: RoutePoint
): OutsideHub | null {
  if (!raw) {
    return null;
  }

  const id = String(raw.id || fallbackId).trim();
  const label = String(raw.label || '').trim();
  if (!id || !label) {
    return null;
  }
  const query = String(raw.query || '').trim() || `${label}, ${cityLabel}, Tanzania`;
  const latitude = Number(raw.fallbackPoint?.latitude);
  const longitude = Number(raw.fallbackPoint?.longitude);
  const fallbackPoint =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : cityCenter;

  return { id, label, query, fallbackPoint };
}

export function sortOutsideDestinationCities(cities: OutsideDestinationCity[]) {
  return [...cities].sort((left, right) => {
    const sortDelta = (left.sortOrder ?? 999) - (right.sortOrder ?? 999);
    if (sortDelta !== 0) {
      return sortDelta;
    }
    return left.label.localeCompare(right.label);
  });
}
