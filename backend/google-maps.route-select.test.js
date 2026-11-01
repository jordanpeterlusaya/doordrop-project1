const assert = require('assert/strict');
const { selectPreferredDriveRoute, parseDurationSeconds } = require('./google-maps');
const { roundCoord, routeCacheKey } = require('./route-cache');

function route(distanceMeters, durationSeconds, polyline = 'poly') {
  return {
    distanceMeters,
    duration: `${durationSeconds}s`,
    polyline: { encodedPolyline: polyline },
  };
}

// Prefer Google's ranked order (route[0]) under TRAFFIC_AWARE_OPTIMAL — do not re-sort.
const chosen = selectPreferredDriveRoute([
  route(4200, 900, 'first'),
  route(5100, 620, 'second'),
  route(4800, 700, 'third'),
]);
assert.ok(chosen, 'selects a route');
assert.equal(chosen.polyline, 'first', 'keeps Google ranked route[0]');
assert.equal(chosen.distanceMeters, 4200);
assert.equal(chosen.durationSeconds, 900);

assert.equal(selectPreferredDriveRoute([{ distanceMeters: 1000 }]), null);
assert.equal(selectPreferredDriveRoute([]), null);
assert.equal(selectPreferredDriveRoute(undefined), null);

assert.equal(parseDurationSeconds('3720s'), 3720);
assert.equal(parseDurationSeconds('bad'), 0);

// Unit conversions used by clients/UI.
assert.equal(Number((5100 / 1000).toFixed(2)), 5.1);
assert.equal(Math.round(3720 / 60), 62);

// Cache rounding ~1e-4°.
assert.equal(roundCoord(-6.82349), -6.8235);
assert.equal(roundCoord(39.26951), 39.2695);

const keyA = routeCacheKey(
  { latitude: -6.8234, longitude: 39.2695 },
  { latitude: -6.76, longitude: 39.25 },
  'toyo',
  'full'
);
const keyB = routeCacheKey(
  { latitude: -6.8234, longitude: 39.2695 },
  { latitude: -6.76, longitude: 39.25 },
  'kirikuu',
  'half'
);
assert.equal(keyA, keyB, 'geometry cache key ignores vehicle/cargo');

console.log('google-maps / route-cache unit tests passed.');
