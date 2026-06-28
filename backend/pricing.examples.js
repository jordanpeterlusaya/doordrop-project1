const assert = require('assert/strict');
const { config } = require('./config');
const { calculateEstimatedPrice, calculatePikipikiParcelFare } = require('./pricing');

function price(vehicleType, distanceKm, cargoSize = null, pricingScope = null) {
  return calculateEstimatedPrice({
    distanceMeters: distanceKm * 1000,
    vehicleType,
    pricingTable: config.pricing,
    cargoSize,
    pricingScope,
  }).estimatedPrice;
}

const pikipikiExamples = [
  [0.5, 1200],
  [1, 1200],
  [2, 1650],
  [3, 2100],
  [5, 3000],
  [7.7, 4755],
  [10, 6250],
  [13, 8200],
];

for (const [distanceKm, expectedFare] of pikipikiExamples) {
  assert.equal(calculatePikipikiParcelFare(distanceKm), expectedFare, `pikipiki function ${distanceKm}km`);
  assert.equal(price('bodaboda', distanceKm), expectedFare, `bodaboda ${distanceKm}km`);
}

assert.equal(price('boda', 5), 3000, 'boda alias 5km');
assert.equal(price('motorcycle', 5), 3000, 'motorcycle alias 5km');
assert.equal(price('toyo', 5, 'small'), 14000, 'toyo 5km small');
assert.equal(price('toyo', 5, 'full'), 20000, 'toyo 5km full');
assert.equal(price('toyo', 5, 'overload'), 26000, 'toyo 5km overload');
assert.equal(price('toyo', 3.9, 'small', 'city'), 12500, 'toyo city below 4km keeps standard price');
assert.equal(price('toyo', 5, 'small', 'city'), 14000, 'toyo city keeps standard price without discount');
assert.equal(price('toyo', 5, 'small', 'outside'), 14000, 'toyo outside city keeps standard price');
assert.equal(price('kirikuu', 5, 'small', 'city'), 16500, 'kirikuu city keeps standard price without discount');
assert.equal(price('bodaboda', 3.9, null, 'city-parcel'), 2505, 'city parcel below 4km keeps standard price');
assert.equal(price('bodaboda', 5, null, 'city-parcel'), 2400, 'city parcel from 4km gets 20 percent reduction');
assert.equal(price('bodaboda', 5, null, 'city'), 3000, 'generic city scope keeps bodaboda standard price');
assert.equal(price('bodaboda', 5, null, 'outside'), 3000, 'outside city keeps bodaboda standard price');

console.table(
  pikipikiExamples.map(([distanceKm, estimatedFare]) => ({
    distanceKm,
    estimatedFare,
  }))
);

console.log('DoorDrop pricing examples passed.');
