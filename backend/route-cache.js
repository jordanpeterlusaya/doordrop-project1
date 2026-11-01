const ROUTE_CACHE_TTL_MS = 1000 * 60 * 10;
const ROUTE_CACHE_MAX = 8000;
/** ~11m at equator — tighter than 0.005° (~555m) to avoid wrong-trip cache hits. */
const COORD_ROUND_FACTOR = 1e4;

const routeCache = new Map();

function roundCoord(value) {
  return Math.round(Number(value) * COORD_ROUND_FACTOR) / COORD_ROUND_FACTOR;
}

/**
 * Geometry cache key is OD only — vehicle/cargo do not change road meters/polyline.
 * Optional vehicleType/cargoSize args kept for call-site compatibility but ignored.
 */
function routeCacheKey(origin, destination, _vehicleType, _cargoSize) {
  return [
    roundCoord(origin.latitude),
    roundCoord(origin.longitude),
    roundCoord(destination.latitude),
    roundCoord(destination.longitude),
  ].join(':');
}

function readRouteCache(key) {
  const hit = routeCache.get(key);
  if (!hit) {
    return null;
  }

  if (Date.now() - hit.storedAt > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }

  return hit.value;
}

function writeRouteCache(key, value) {
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest) {
      routeCache.delete(oldest);
    }
  }

  routeCache.set(key, { value, storedAt: Date.now() });
}

module.exports = {
  COORD_ROUND_FACTOR,
  readRouteCache,
  routeCacheKey,
  roundCoord,
  writeRouteCache,
};
