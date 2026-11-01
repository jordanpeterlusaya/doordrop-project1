/**
 * Regression gates for Haul trip distance display / pricing.
 * Mirrors book-cargo-screen.native.tsx contracts (no Directions/OSRM/haversine as trip km).
 */
const assert = require('assert/strict');

/** Only Google Routes /routes/estimate may drive Haul fare meters. */
function isPricableRouteSource(source) {
  return source === 'google';
}

/** Display label from backend meters (/1000). One decimal below 100 km. */
function formatTripDistanceLabel(meters) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return '';
  }
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m`;
  }
  const km = meters / 1000;
  if (km >= 100) {
    return `${Math.round(km)} km`;
  }
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} km`;
}

function mapEstimateToRouteMetrics(estimate) {
  const distanceMeters = Number(estimate.distanceMeters) || 0;
  const durationSeconds = Number(estimate.durationSeconds) || 0;
  const isPricable = distanceMeters > 0 && durationSeconds > 0;
  return {
    coordinates: Array.isArray(estimate.coordinates) ? estimate.coordinates : [],
    distanceMeters: isPricable ? distanceMeters : 0,
    durationSeconds: isPricable ? durationSeconds : 0,
    source: isPricable ? 'google' : 'fallback',
  };
}

/** Trip km UI: only when source==='google' && distanceMeters>0. */
function tripDistanceLabelFromRoute(routeMetrics) {
  if (routeMetrics?.source === 'google' && routeMetrics.distanceMeters > 0) {
    return formatTripDistanceLabel(routeMetrics.distanceMeters) || '—';
  }
  return '—';
}

// --- displayed distance derives from backend meters (/1000) ---
assert.equal(formatTripDistanceLabel(5100), '5.1 km');
assert.equal(formatTripDistanceLabel(12500), '12.5 km'); // one decimal above 10 km
assert.equal(formatTripDistanceLabel(100000), '100 km');
assert.equal(formatTripDistanceLabel(850), '850 m');
assert.equal(Number((15340 / 1000).toFixed(1)), 15.3);

// --- source !== google cannot price ---
assert.equal(isPricableRouteSource('google'), true);
assert.equal(isPricableRouteSource('directions'), false);
assert.equal(isPricableRouteSource('osrm'), false);
assert.equal(isPricableRouteSource('fallback'), false);
assert.equal(isPricableRouteSource(undefined), false);

// Pricing distance gate used by book-cargo
function pricingDistanceMeters(routeMetrics) {
  return isPricableRouteSource(routeMetrics?.source) && routeMetrics.distanceMeters > 0
    ? routeMetrics.distanceMeters
    : 0;
}
assert.equal(pricingDistanceMeters({ source: 'google', distanceMeters: 8200 }), 8200);
assert.equal(pricingDistanceMeters({ source: 'directions', distanceMeters: 8200 }), 0);
assert.equal(pricingDistanceMeters({ source: 'osrm', distanceMeters: 9100 }), 0);
assert.equal(pricingDistanceMeters({ source: 'fallback', distanceMeters: 5000 }), 0);

// --- mapEstimateToRouteMetrics gates ---
const ok = mapEstimateToRouteMetrics({
  distanceMeters: 6400,
  durationSeconds: 720,
  coordinates: [{ latitude: 1, longitude: 2 }],
});
assert.equal(ok.source, 'google');
assert.equal(ok.distanceMeters, 6400);
assert.equal(ok.durationSeconds, 720);

const zeroMeters = mapEstimateToRouteMetrics({
  distanceMeters: 0,
  durationSeconds: 720,
  coordinates: [],
});
assert.equal(zeroMeters.source, 'fallback');
assert.equal(zeroMeters.distanceMeters, 0);

const geometryOnly = mapEstimateToRouteMetrics({
  distanceMeters: 0,
  durationSeconds: 0,
  coordinates: [
    { latitude: -6.8, longitude: 39.2 },
    { latitude: -6.7, longitude: 39.3 },
  ],
});
assert.equal(geometryOnly.source, 'fallback');
assert.equal(geometryOnly.distanceMeters, 0);

// Trip label never shows Directions/OSRM/polyline meters
assert.equal(tripDistanceLabelFromRoute({ source: 'google', distanceMeters: 12500 }), '12.5 km');
assert.equal(tripDistanceLabelFromRoute({ source: 'directions', distanceMeters: 12500 }), '—');
assert.equal(tripDistanceLabelFromRoute({ source: 'osrm', distanceMeters: 9900 }), '—');
assert.equal(tripDistanceLabelFromRoute({ source: 'fallback', distanceMeters: 0 }), '—');
assert.equal(tripDistanceLabelFromRoute(null), '—');

console.log('haul-route-distance-gates unit tests passed.');
