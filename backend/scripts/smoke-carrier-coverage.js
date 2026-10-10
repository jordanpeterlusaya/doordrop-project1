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

const legacyCarrier = { id: 'c1', status: 'verified', companyName: 'Legacy' };
const mwanzaCarrier = {
  id: 'c2',
  status: 'verified',
  companyName: 'Lake Bus',
  coverageRegions: ['Mwanza'],
  coverageAllTanzania: false,
  coverageInternational: false,
};
const allTzCarrier = {
  id: 'c3',
  status: 'verified',
  companyName: 'Nationwide',
  coverageAllTanzania: true,
};
const intlCarrier = {
  id: 'c4',
  status: 'verified',
  companyName: 'Cross Border',
  coverageInternational: true,
};

assert(detectTzRegion('Mwanza City') === 'mwanza', 'detect mwanza');
assert(looksInternational('Nairobi Kenya') === true, 'intl');
assert(coverageForOrder({ outsideDestinationCity: 'Mwanza' }, mwanzaCarrier).ok, 'mwanza ok');
assert(!coverageForOrder({ outsideDestinationCity: 'Arusha' }, mwanzaCarrier).ok, 'arusha miss');
assert(coverageForOrder({ outsideDestinationCity: 'Arusha' }, allTzCarrier).ok, 'all tz');
assert(coverageForOrder({ outsideDestinationCity: 'Nairobi' }, intlCarrier).ok, 'intl ok');
assert(!coverageForOrder({ outsideDestinationCity: 'Nairobi' }, mwanzaCarrier).ok, 'intl blocked');
assert(coverageForOrder({ outsideDestinationCity: 'Mwanza' }, legacyCarrier).ok, 'legacy ok');

const route = {
  id: 'r1',
  origin: 'Dar es Salaam',
  destination: 'Mwanza',
  cargoCapacityKg: 500,
  active: true,
  departureTime: '08:00',
  arrivalTime: '20:00',
  operatingDays: [],
};
const scored = scoreCarrier(
  {
    outsideDestinationCity: 'Mwanza',
    outsideOriginCity: 'Dar es Salaam',
    outsideParcelWeightKg: 10,
    totalLabel: 'TZS 50000',
  },
  mwanzaCarrier,
  [route],
  [{ status: 'active' }],
  { usedByRoute: new Map() }
);
assert(scored && scored.score >= 48, 'score with coverage');

assert(smsEventFromTransition('assigned', 'accepted') === 'accepted', 'sms accept');
assert(smsEventFromTransition('in_transit', 'arrived') === 'arrived', 'sms arrived');
assert(maskPhone('+255712345678').endsWith('5678'), 'mask');
assert(buildBody('accepted', { parcelCode: 'ABC', destination: 'Mwanza', customerName: 'Juma' }, 'x').includes('ABC'), 'body');

console.log('smoke-carrier-coverage OK');
