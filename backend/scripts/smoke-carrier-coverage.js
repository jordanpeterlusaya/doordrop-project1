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

const { carrierStanding, cashSplit, completionStreak } = require('../carrier-matching');
assert(completionStreak([10, 20, 30], [15], false) === 2, 'streak keeps jobs after the last cancel');
assert(completionStreak([10, 20, 0], [], false) === 3, 'no cancel keeps the whole run');
assert(completionStreak([10, 40], [5], true) === 0, 'undated cancel resets the streak');
assert(carrierStanding({ streak: 4, completed: 4, rejects: 0 }).tier.id === 'bronze', 'streak 4 is bronze');
assert(carrierStanding({ streak: 4, completed: 4, rejects: 0 }).feeRate === 0.2, 'bronze pays 20%');
assert(carrierStanding({ streak: 100, completed: 100, rejects: 0 }).tier.id === 'silver' && carrierStanding({ streak: 100, completed: 100, rejects: 0 }).feeRate === 0.18, 'silver 18%');
assert(carrierStanding({ streak: 250, completed: 250, rejects: 0 }).feeRate === 0.17, 'gold 17%');
assert(carrierStanding({ streak: 500, completed: 500, rejects: 0 }).feeRate === 0.15, 'platinum 15%');
assert(carrierStanding({ streak: 99, completed: 99, rejects: 0 }).tier.id === 'bronze', '99 stays bronze');
const punished = carrierStanding({ streak: 100, completed: 20, rejects: 10, postAcceptCancels: 0 });
assert(punished.tier.id === 'silver' && punished.highCommission && punished.feeRate === 0.2, 'high cancel pays 20%');
assert(carrierStanding({ streak: 6, completed: 6, rejects: 2 }).highCommission === false, '25% does not punish');
assert(carrierStanding({ streak: 0, completed: 6, rejects: 4 }).closure === true, '40% can close offers');
assert(carrierStanding({ streak: 0, completed: 3, rejects: 2 }).closure === false, '40% needs 8 decisions');
assert(carrierStanding({ streak: 10, completed: 10, rejects: 3, postAcceptCancels: 3 }).closure === true, '3 post-accept cancels close offers');
assert(cashSplit(10000).haulFee === 2000 && cashSplit(10000, 0.17).haulFee === 1700 && cashSplit(10000, 0.15).haulFee === 1500, 'split uses 15 to 20');
const goldScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'g', streak: 250, completedShipments: 250, rejected: 0 }, [staleRoute], [{ status: 'active' }]);
const platScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'p', streak: 500, completedShipments: 500, rejected: 0 }, [staleRoute], [{ status: 'active' }]);
const punishedScore = scoreCarrier(darToMwanza, { ...darRegions, id: 'h', streak: 250, completedShipments: 20, rejected: 10 }, [staleRoute], [{ status: 'active' }]);
assert(platScore.score > goldScore.score && goldScore.score > scored.score, 'longer streak is offered first');
assert(goldScore.haulFeeRate === 0.17 && platScore.haulFeeRate === 0.15, 'offer rate follows the streak');
assert(punishedScore.haulFeeRate === 0.2 && punishedScore.score < goldScore.score, 'high cancel loses the discount and the priority');
assert(!scoreCarrier(darToMwanza, { ...darRegions, id: 'paused', streak: 500, offersPaused: true }, [staleRoute], [{ status: 'active' }]), 'paused carrier gets no offer');
assert(!scoreCarrier(darToMwanza, { ...darRegions, id: 'strikes', streak: 10, completedShipments: 10, rejected: 3, postAcceptCancels: 3 }, [staleRoute], [{ status: 'active' }]), 'three post-accept cancels get no offer');

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
