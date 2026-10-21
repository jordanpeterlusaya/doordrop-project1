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
assert(detectTzRegion('Makambako') === 'njombe', 'makambako is njombe');
assert(detectTzRegion('Makambako cargo') === 'njombe', 'makambako in company name');
assert(looksInternational('Nairobi Kenya') === true, 'intl');

// Legacy verified carrier with nationwide coverage but empty region — name still yields a base.
const makambakoLegacy = {
  id: 'mak-legacy',
  status: 'verified',
  companyName: 'Makambako cargo',
  region: '',
  coverageAllTanzania: true,
};
assert(coverageForOrder({ outsideOriginCity: 'Makambako', outsideDestinationCity: 'Dar es Salaam' }, makambakoLegacy).ok, 'name fallback base + nationwide');
assert(coverageForOrder({ outsideOriginCity: 'Dar es Salaam', outsideDestinationCity: 'Mwanza' }, makambakoLegacy).reason === 'origin-miss', 'name fallback still requires origin in base');

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
assert(scored.tierId === 'bronze' && scored.haulFeeRate === 0.2, 'unscored company stays bronze');
assert(scored.departureTime === '', 'no dispatch time on match');
assert(scored.routeLabel.includes('Mwanza'), 'label uses order destination');
assert(!scoreCarrier(darToArusha, { ...darRegions, coverageRegions: ['Mwanza'] }, [staleRoute], []), 'route to arusha does not fake-match');

const { carrierStanding, cashSplit } = require('../carrier-matching');
assert(carrierStanding(4, 0).tier.id === 'bronze' && carrierStanding(4, 0).points === 4, 'bronze points');
assert(carrierStanding(20, 0).tier.feeRate === 0.18, 'silver rate');
assert(carrierStanding(50, 0).tier.feeRate === 0.15, 'gold rate');
assert(carrierStanding(100, 0).tier.feeRate === 0.12, 'platinum rate');
assert(carrierStanding(70, 30).held === false && carrierStanding(70, 30).tier.id === 'gold', '30% does not hold');
assert(carrierStanding(69, 31).held === true && carrierStanding(69, 31).tier.id === 'silver', 'above 30% drops one level');
assert(carrierStanding(10, 10).tier.id === 'bronze' && carrierStanding(10, 10).held === false, 'bronze cannot drop');
assert(carrierStanding(2, 2).held === false, 'need 5 decisions');
assert(cashSplit(10000).haulFee === 2000 && cashSplit(10000, 0.12).haulFee === 1200, 'split uses the offer rate');
const goldScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'g', completedShipments: 50, rejected: 0 }, [staleRoute], [{ status: 'active' }]);
const platScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'p', completedShipments: 100, rejected: 0 }, [staleRoute], [{ status: 'active' }]);
const heldScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'h', completedShipments: 50, rejected: 30 }, [staleRoute], [{ status: 'active' }]);
assert(platScore.score > goldScore.score && goldScore.score > scored.score, 'higher tier is offered first');
assert(heldScore.tierId === 'silver' && heldScore.haulFeeRate === 0.18 && heldScore.score < goldScore.score, 'cancel rate holds the offer priority');

assert(smsEventFromTransition('assigned', 'accepted') === 'accepted', 'sms accept');
assert(smsEventFromTransition('in_transit', 'arrived') === 'arrived', 'sms arrived');
assert(maskPhone('+255712345678').endsWith('5678'), 'mask');
assert(buildBody('accepted', { parcelCode: 'ABC', destination: 'Mwanza', customerName: 'Juma' }, 'x').includes('ABC'), 'body');
assert(buildBody('arrived', { parcelCode: 'DDX-1', destination: 'Mwanza' }, 'x').includes('DDX-1'), 'arrived code');
assert(buildBody('arrived', { parcelCode: 'DDX-1', destination: 'Mwanza' }, 'x').includes('Mwanza'), 'arrived dest');
assert(buildBody('arrived', { parcelCode: 'DDX-1' }, 'x').includes('umefika'), 'arrived copy without destination');
const arrivedDetail = buildBody(
  'arrived',
  {
    parcelCode: 'DDX-1',
    pickupLabel: 'Kariakoo',
    destination: 'Mwanza',
    carrierCompanyName: 'ABC Cargo',
  },
  'x'
);
assert(arrivedDetail.includes('Kariakoo') && arrivedDetail.includes('ABC Cargo'), 'arrived route and company');
const { buildArrivalBody } = require('../carrier-sms');
const arrivedPhone = buildArrivalBody(
  { parcelCode: 'DDX-1', pickupLabel: 'Kariakoo', destination: 'Mwanza' },
  'x',
  { companyName: 'ABC Cargo', confirmPhone: '0796904849' }
);
assert(arrivedPhone.includes('0796904849') && arrivedPhone.includes('Piga'), 'arrived confirm phone');
assert(arrivedPhone.length <= 320, 'arrived sms length');

console.log('smoke-carrier-coverage OK');
