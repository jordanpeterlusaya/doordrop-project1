const ROUTE_CACHE_TTL_MS = 1000 * 60 * 10;
const ROUTE_CACHE_MAX = 8000;

const routeCache = new Map();

function roundCoord(value) {
  return Math.round(Number(value) * 200) / 200;
}

function routeCacheKey(origin, destination, vehicleType, cargoSize) {
  return [
    roundCoord(origin.latitude),
    roundCoord(origin.longitude),
    roundCoord(destination.latitude),
    roundCoord(destination.longitude),
    vehicleType || '',
    cargoSize || '',
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
  readRouteCache,
  routeCacheKey,
  writeRouteCache,
};
