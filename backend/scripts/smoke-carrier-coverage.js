/** Quick smoke for coverage + SMS helpers without Firebase. */
const {
  coverageForOrder,
  detectTzRegion,
  looksInternational,
  scoreCarrier,
} = require('../carrier-matching');
const { smsEventFromTransition, buildBody, maskPhone } = require('../carrier-sms');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const darAll = {
  id: 'dar-all',
  status: 'verified',
  companyName: 'Dar Nationwide',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  coverageIntraCity: false,
};
const darRegions = {
  id: 'dar-regions',
  status: 'verified',
  companyName: 'Dar Selected',
  region: 'Dar',
  coverageRegions: ['Mwanza', 'Arusha'],
  coverageAllTanzania: false,
  coverageIntraCity: false,
};
const darCity = {
  id: 'dar-city',
  status: 'verified',
  companyName: 'Dar City',
  region: 'DSM',
  coverageIntraCity: true,
  coverageAllTanzania: false,
};
const mwanzaAll = {
  id: 'mwanza-all',
  status: 'verified',
  companyName: 'Lake Nationwide',
  region: 'Mwanza',
  coverageAllTanzania: true,
};
const legacyRouteOnly = {
  id: 'legacy',
  status: 'verified',
  companyName: 'Old Route',
  region: 'Dar es Salaam',
};
const staleRoute = {
  id: 'r-old',
  origin: 'Dar es Salaam',
  destination: 'Arusha',
  cargoCapacityKg: 500,
  active: true,
  departureTime: '08:00',
  operatingDays: [],
};

assert(detectTzRegion('Dar es Salaam') === 'dar es salaam', 'detect dar full');
assert(detectTzRegion('Dar') === 'dar es salaam', 'detect dar short');
assert(detectTzRegion('DSM') === 'dar es salaam', 'detect dsm');
assert(detectTzRegion('Darajani Market, Zanzibar') === 'unguja', 'darajani is not dar');
assert(detectTzRegion('Kahama') === 'shinyanga', 'kahama region');
assert(detectTzRegion('Mwanza City') === 'mwanza', 'detect mwanza');
assert(looksInternational('Nairobi Kenya') === true, 'intl');

const darToMwanza = { outsideOriginCity: 'Dar es Salaam', outsideDestinationCity: 'Mwanza' };
const darToArusha = { outsideOriginCity: 'Dar', outsideDestinationCity: 'Arusha' };
const darToDar = { outsideOriginCity: 'Ilala', outsideDestinationCity: 'Ubungo, Dar es Salaam' };
const darToNairobi = { outsideOriginCity: 'Dar es Salaam', outsideDestinationCity: 'Nairobi' };
const mwanzaToDar = { outsideOriginCity: 'Mwanza', outsideDestinationCity: 'Dar es Salaam' };

assert(coverageForOrder(darToMwanza, darAll).ok, 'nationwide any dest');
assert(coverageForOrder(darToNairobi, darAll).ok, 'nationwide includes abroad');
assert(!coverageForOrder(mwanzaToDar, darAll).ok, 'nationwide still requires dar origin');
assert(coverageForOrder(darToMwanza, darRegions).reason === 'region', 'selected mwanza');
assert(!coverageForOrder(darToArusha, { ...darRegions, coverageRegions: ['Mwanza'] }).ok, 'arusha not selected');
assert(!coverageForOrder(mwanzaToDar, darRegions).ok, 'selected coverage does not flip origin');
assert(coverageForOrder(darToDar, darCity).reason === 'intra-city', 'within city');
assert(!coverageForOrder(darToMwanza, darCity).ok, 'city blocks other regions');
assert(!coverageForOrder(darToNairobi, darCity).ok, 'city blocks international');
assert(coverageForOrder(darToArusha, mwanzaAll).reason === 'origin-miss', 'mwanza base ignores dar pickup');
assert(!coverageForOrder(darToMwanza, legacyRouteOnly).ok, 'no coverage is not a match');

const scored = scoreCarrier(darToMwanza, darRegions, [staleRoute], [{ status: 'active' }]);
assert(scored && scored.score >= 48, 'score ignores stale route destination');
assert(scored.departureTime === '', 'no dispatch time on match');
assert(scored.routeLabel.includes('Mwanza'), 'label uses order destination');
assert(!scoreCarrier(darToArusha, { ...darRegions, coverageRegions: ['Mwanza'] }, [staleRoute], []), 'route to arusha does not fake-match');

assert(smsEventFromTransition('assigned', 'accepted') === 'accepted', 'sms accept');
assert(smsEventFromTransition('in_transit', 'arrived') === 'arrived', 'sms arrived');
assert(maskPhone('+255712345678').endsWith('5678'), 'mask');
assert(buildBody('accepted', { parcelCode: 'ABC', destination: 'Mwanza', customerName: 'Juma' }, 'x').includes('ABC'), 'body');

console.log('smoke-carrier-coverage OK');
