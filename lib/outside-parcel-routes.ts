import {
  type OutsideDestinationCity,
  type OutsideDestinationCityKey,
  type OutsideShippingMode,
  isOutsideCityActive,
  isOutsideExpressAvailable,
  sortOutsideDestinationCities,
} from '@/lib/outside-parcel';
import { getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';

/** Bidirectional corridors. Dar–Zanzibar air is home-delivery only (see isOutsideExpressHomeDeliveryMandatory). */
const OUTSIDE_BIDIRECTIONAL_CORRIDORS: {
  a: OutsideDestinationCityKey;
  b: OutsideDestinationCityKey;
  express?: boolean;
  standard?: boolean;
}[] = [
  { a: 'dar-es-salaam', b: 'zanzibar', express: true, standard: true },
  { a: 'dar-es-salaam', b: 'mwanza', express: true, standard: true },
  { a: 'mwanza', b: 'kahama', express: true, standard: true },
  { a: 'dar-es-salaam', b: 'arusha', express: true, standard: true },
];

function corridorSupportsMode(
  corridor: (typeof OUTSIDE_BIDIRECTIONAL_CORRIDORS)[number],
  shippingMode: OutsideShippingMode
) {
  return shippingMode === 'express' ? corridor.express === true : corridor.standard === true;
}

function corridorMatches(
  corridor: (typeof OUTSIDE_BIDIRECTIONAL_CORRIDORS)[number],
  originCityKey: OutsideDestinationCityKey,
  destinationCityKey: OutsideDestinationCityKey
) {
  return (
    (corridor.a === originCityKey && corridor.b === destinationCityKey) ||
    (corridor.b === originCityKey && corridor.a === destinationCityKey)
  );
}

export function isOutsideRouteAllowed(params: {
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  shippingMode: OutsideShippingMode;
}) {
  const { originCityKey, destinationCityKey, shippingMode } = params;

  if (originCityKey === destinationCityKey) {
    return false;
  }

  const corridorAllowed = OUTSIDE_BIDIRECTIONAL_CORRIDORS.some(
    (corridor) =>
      corridorMatches(corridor, originCityKey, destinationCityKey) && corridorSupportsMode(corridor, shippingMode)
  );
  if (corridorAllowed) {
    return true;
  }

  if (originCityKey === 'dar-es-salaam' && shippingMode === 'standard' && destinationCityKey !== 'dar-es-salaam') {
    return true;
  }

  return false;
}

export function isOutsideRouteAvailable(params: {
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  shippingMode?: OutsideShippingMode | null;
}) {
  const { originCityKey, destinationCityKey, shippingMode } = params;
  if (shippingMode === 'express' || shippingMode === 'standard') {
    return isOutsideRouteAllowed({ originCityKey, destinationCityKey, shippingMode });
  }

  return (
    isOutsideRouteAllowed({ originCityKey, destinationCityKey, shippingMode: 'express' }) ||
    isOutsideRouteAllowed({ originCityKey, destinationCityKey, shippingMode: 'standard' })
  );
}

export function getNearestOutsideCityFromList(
  point: RoutePoint,
  cities: OutsideDestinationCity[]
): OutsideDestinationCity | undefined {
  return cities.reduce((closest, city) => {
    const distance = getDistanceBetweenPoints(point, city.centerPoint);
    if (!closest || distance < closest.distance) {
      return { city, distance };
    }
    return closest;
  }, null as { city: OutsideDestinationCity; distance: number } | null)?.city;
}

export function resolveOutsideOriginCityKey(
  pickupPoint: RoutePoint | null | undefined,
  cities: OutsideDestinationCity[]
): OutsideDestinationCityKey {
  if (!pickupPoint) {
    return 'dar-es-salaam';
  }

  return getNearestOutsideCityFromList(pickupPoint, cities)?.key ?? 'dar-es-salaam';
}

export function getOutsideEligibleDestinations(params: {
  originCityKey: OutsideDestinationCityKey;
  shippingMode?: OutsideShippingMode | null;
  cities: OutsideDestinationCity[];
  expressEnabledGlobally?: boolean;
}) {
  const { originCityKey, shippingMode, cities, expressEnabledGlobally = true } = params;

  return sortOutsideDestinationCities(
    cities.filter((city) => {
      if (!isOutsideCityActive(city) || city.key === originCityKey) {
        return false;
      }

      if (shippingMode === 'express' && !isOutsideExpressAvailable({ city, expressEnabledGlobally })) {
        return false;
      }

      return isOutsideRouteAvailable({
        originCityKey,
        destinationCityKey: city.key,
        shippingMode,
      });
    })
  );
}

export function hasOutsideExpressRoutesFromOrigin(
  originCityKey: OutsideDestinationCityKey,
  cities: OutsideDestinationCity[],
  expressEnabledGlobally = true
) {
  if (!expressEnabledGlobally) {
    return false;
  }

  return getOutsideEligibleDestinations({
    originCityKey,
    shippingMode: 'express',
    cities,
    expressEnabledGlobally,
  }).length > 0;
}

export function hasOutsideStandardRoutesFromOrigin(originCityKey: OutsideDestinationCityKey, cities: OutsideDestinationCity[]) {
  return getOutsideEligibleDestinations({ originCityKey, shippingMode: 'standard', cities }).length > 0;
}

export function isDarZanzibarAirExpressRoute(params: {
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  shippingMode?: OutsideShippingMode | null;
}) {
  if (params.shippingMode !== 'express') {
    return false;
  }

  const pair = new Set([params.originCityKey, params.destinationCityKey]);
  return pair.has('dar-es-salaam') && pair.has('zanzibar');
}

/** Express air on Dar ↔ Zanzibar: home delivery only (no airport handoff option). */
export function isOutsideExpressHomeDeliveryMandatory(params: {
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  shippingMode?: OutsideShippingMode | null;
}) {
  return isDarZanzibarAirExpressRoute(params);
}

const OUTSIDE_PARCEL_SERVICE_RADIUS_METERS: Partial<Record<OutsideDestinationCityKey, number>> = {
  'dar-es-salaam': 120_000,
  mwanza: 100_000,
  arusha: 100_000,
  zanzibar: 100_000,
  kahama: 80_000,
};

/** Bus/air parcel is only offered near operating hub cities (not e.g. Morogoro). */
export function isOutsideParcelServiceAvailableAt(
  point: RoutePoint | null | undefined,
  cities: OutsideDestinationCity[] = []
) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return false;
  }

  const activeCities = cities.filter((city) => isOutsideCityActive(city));

  return activeCities.some((city) => {
    const hasRoutes =
      hasOutsideExpressRoutesFromOrigin(city.key, activeCities) ||
      hasOutsideStandardRoutesFromOrigin(city.key, activeCities);
    if (!hasRoutes) {
      return false;
    }

    const radiusMeters = OUTSIDE_PARCEL_SERVICE_RADIUS_METERS[city.key] ?? 100_000;
    return getDistanceBetweenPoints(point, city.centerPoint) <= radiusMeters;
  });
}
