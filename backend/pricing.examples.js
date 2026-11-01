const assert = require('assert/strict');
const { config } = require('./config');
const {
  calculateEstimatedPrice,
  calculateFuelTuktukFare,
  calculatePikipikiParcelFare,
  calculateToyoElectricFare,
} = require('./pricing');

function price(vehicleType, distanceKm, cargoSize = null, pricingScope = null, durationMinutes = null) {
  return calculateEstimatedPrice({
    distanceMeters: distanceKm * 1000,
    vehicleType,
    pricingTable: config.pricing,
    cargoSize,
    pricingScope,
    durationMinutes,
  }).estimatedPrice;
}

// Raw pikipiki ladder (before nearest-100 customer rounding).
const pikipikiRawExamples = [
  [0.5, 1200],
  [1, 1200],
  [2, 1650],
  [3, 2100],
  [5, 3000],
  [7.7, 4755],
  [10, 6250],
  [13, 8200],
];
// Customer-facing bodaboda fares (rounded to nearest TZS 100).
const bodabodaCustomerExamples = [
  [0.5, 1200],
  [1, 1200],
  [2, 1700],
  [3, 2100],
  [5, 3000],
  [7.7, 4800],
  [10, 6300],
  [13, 8200],
];

for (const [distanceKm, expectedFare] of pikipikiRawExamples) {
  assert.equal(calculatePikipikiParcelFare(distanceKm), expectedFare, `pikipiki function ${distanceKm}km`);
}
for (const [distanceKm, expectedFare] of bodabodaCustomerExamples) {
  assert.equal(price('bodaboda', distanceKm), expectedFare, `bodaboda ${distanceKm}km`);
}

assert.equal(price('boda', 5), 3000, 'boda alias 5km');
assert.equal(price('motorcycle', 5), 3000, 'motorcycle alias 5km');

// Toyo Electric — linear: Base 5000 + chargeableKm × 1200 (profit 1000 + time 100 + energy 100)
// Chargeable = distance when alreadyRoundTrip; else one-way × 2 (never double-count).
const electricAlreadyRtCases = [
  [1.5, 6800],
  [21, 30200],
  [42, 55400],
];
for (const [chargeableKm, expectedFare] of electricAlreadyRtCases) {
  const sample = calculateToyoElectricFare({
    distanceKm: chargeableKm,
    alreadyRoundTrip: true,
  });
  assert.equal(sample.formula, 'toyo_electric_linear', `electric formula ${chargeableKm}km`);
  assert.equal(sample.totalDistanceKm, chargeableKm, `electric chargeable distance ${chargeableKm}km`);
  assert.equal(sample.estimatedPrice, expectedFare, `electric alreadyRT ${chargeableKm}km → ${expectedFare}`);
}
// One-way 21 km → chargeable 42 km → 5000 + 42×1200 = 55400
assert.equal(
  calculateToyoElectricFare({ distanceKm: 21, alreadyRoundTrip: false }).estimatedPrice,
  55400,
  'electric one-way 21 doubles to chargeable 42 → 55400'
);
assert.equal(
  calculateToyoElectricFare({ distanceKm: 0.75, alreadyRoundTrip: false }).estimatedPrice,
  6800,
  'electric one-way 0.75 → chargeable 1.5'
);
assert.equal(price('toyo_electric', 21, 'small', null, null), 55400, 'toyo electric via calculateEstimatedPrice');
assert.equal(price('toyo-electric', 21, null, null, null), 55400, 'toyo-electric alias');

// Fuel Formula A — one-way 4.4 km → RT 8.8 × 2,080 + 5,000 = 23,304 → payable 23,300
const fuelA = calculateFuelTuktukFare({
  distanceKm: 4.4,
  durationMinutes: 12,
  alreadyRoundTrip: false,
});
assert.equal(fuelA.formula, 'fuel_tuktuk_a_short', 'fuel A short band');
assert.equal(fuelA.estimatedPrice, 23300, 'fuel A example fare');
assert.equal(price('toyo', 4.4, 'small', null, 12), 23300, 'toyo fuel Formula A');
assert.equal(price('kirikuu', 4.4, 'small', null, 12), 23300, 'kirikuu uses same fuel formula');

// Boundary: RT 19 km (one-way 9.5) still short rate; RT 20 (one-way 10) medium rate
assert.equal(
  calculateFuelTuktukFare({ distanceKm: 9.5, durationMinutes: 20, alreadyRoundTrip: false }).formula,
  'fuel_tuktuk_a_short',
  'RT 19 short'
);
assert.equal(
  calculateFuelTuktukFare({ distanceKm: 10, durationMinutes: 22, alreadyRoundTrip: false }).formula,
  'fuel_tuktuk_a_medium',
  'RT 20 medium'
);
assert.equal(
  calculateFuelTuktukFare({ distanceKm: 19.5, durationMinutes: 40, alreadyRoundTrip: false }).formula,
  'fuel_tuktuk_a_medium',
  'RT 39 medium'
);

// Formula B — round-trip 42 km / 44 min (one-way 21 km / 22 min)
const fuelB = calculateFuelTuktukFare({
  distanceKm: 21,
  durationMinutes: 22,
  alreadyRoundTrip: false,
});
assert.equal(fuelB.formula, 'fuel_tuktuk_b_long', 'fuel B long band');
assert.equal(fuelB.totalDistanceKm, 42, 'fuel B RT distance');
assert.equal(fuelB.totalTimeMinutes, 44, 'fuel B RT time');
assert.equal(fuelB.estimatedPrice, 56700, 'fuel B example fare');
assert.equal(price('toyo', 21, 'small', null, 22), 56700, 'toyo Formula B');
assert.equal(price('kirikuu', 21, null, null, 22), 56700, 'kirikuu Formula B');

// Already round-trip inputs must not be doubled again
assert.equal(
  calculateFuelTuktukFare({ distanceKm: 42, durationMinutes: 44, alreadyRoundTrip: true }).estimatedPrice,
  56700,
  'already round-trip Formula B'
);
assert.equal(
  calculateToyoElectricFare({ distanceKm: 42, alreadyRoundTrip: true }).estimatedPrice,
  55400,
  'already round-trip electric must not double again'
);

// Legacy canter still prices with size
assert.equal(price('canter', 5, 'small'), 20500, 'legacy canter quotes still price');

// 3.9 km raw = 2505, customer rounding → 2500 (below 4 km: no 20% cut).
assert.equal(price('bodaboda', 3.9, null, 'city-parcel'), 2500, 'city parcel below 4km keeps standard price');
assert.equal(price('bodaboda', 5, null, 'city-parcel'), 2400, 'city parcel from 4km gets 20 percent reduction');
assert.equal(price('bodaboda', 5, null, 'city'), 3000, 'generic city scope keeps bodaboda standard price');
assert.equal(price('bodaboda', 5, null, 'outside'), 3000, 'outside city keeps bodaboda standard price');

console.table(
  bodabodaCustomerExamples.map(([distanceKm, estimatedFare]) => ({
    distanceKm,
    estimatedFare,
  }))
);

console.log('DoorDrop pricing examples passed.');
console.log('Toyo Electric: Fare = 5000 + chargeableKm × 1200 (toyo_electric_linear; distance once).');
console.log('Threshold note: Formula A uses round-trip ≤ 39 km; Formula B when round-trip > 39 km.');
console.log('Formula B uses the same round-trip distance and time as Formula A (one-way × 2).');
