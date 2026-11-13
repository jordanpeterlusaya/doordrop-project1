/**
 * Eligibility fixtures for new transporters. No Firestore writes.
 * Run: node backend/scripts/offer-eligibility.test.js
 */
const {
  accountBlockReason,
  accountCanTakeOffers,
  coverageForOrder,
  FRESH_ORDER_MATCH_MS,
  isBusParcel,
  isCarrierLive,
  isFreshForOffer,
  MAX_OFFERS,
  OFFER_TIMEOUT_MS,
  offerIsOpen,
  offerTimedOut,
  pickExclusiveCarrier,
  rankCarriers,
  shouldReleaseOpenOffer,
} = require('../carrier-matching');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = Date.now();
const fresh = new Date(now - 30 * 1000).toISOString();
const stale = new Date(now - 10 * 60 * 1000).toISOString();

const darOrder = {
  id: 'order-dar-mwanza',
  flow: 'parcel',
  parcelScope: 'outside',
  outsideShippingMode: 'standard',
  status: 'pending_assignment',
  outsideOriginCity: 'Dar es Salaam',
  outsideDestinationCity: 'Mwanza',
};

const approvedLive = {
  id: 'approved-live',
  status: 'verified',
  companyName: 'New Approved Cargo',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  portalOnlineAt: fresh,
};
const approvedOffline = {
  id: 'approved-offline',
  status: 'verified',
  companyName: 'Approved Offline',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  portalOnlineAt: stale,
};
const approvedNoCoverage = {
  id: 'approved-nyamagana',
  status: 'verified',
  companyName: 'Lake Cargo',
  region: '',
  location: 'Nyamagana,',
  portalOnlineAt: fresh,
};
const pendingLive = {
  id: 'pending-live',
  status: 'pending',
  companyName: 'Just Registered',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  portalOnlineAt: fresh,
};
const rejectedLive = {
  id: 'rejected-live',
  status: 'rejected',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  portalOnlineAt: fresh,
};
const pausedLive = {
  id: 'paused-live',
  status: 'verified',
  region: 'Dar es Salaam',
  coverageAllTanzania: true,
  offersPaused: true,
  portalOnlineAt: fresh,
};

assert(accountCanTakeOffers(approvedLive), 'approved company can take offers');
assert(!accountCanTakeOffers(pendingLive), 'pending company is not offered');
assert(accountBlockReason(pendingLive) === 'unapproved', 'pending reason is unapproved');
assert(accountBlockReason(rejectedLive) === 'rejected', 'rejected reason');
assert(accountBlockReason(pausedLive) === 'paused', 'paused reason');
assert(!accountCanTakeOffers(pausedLive), 'paused verified stays out');

assert(isCarrierLive(approvedLive, now), 'fresh heartbeat is live');
assert(!isCarrierLive(approvedOffline, now), 'stale heartbeat is offline');
assert(!isCarrierLive(pendingLive, now) || accountBlockReason(pendingLive) === 'unapproved', 'live pending is still unapproved');

const mwanzaOrder = {
  ...darOrder,
  id: 'order-mwanza-dar',
  outsideOriginCity: 'Mwanza',
  outsideDestinationCity: 'Dar es Salaam',
};
assert(coverageForOrder(darOrder, approvedLive).ok, 'approved nationwide matches Dar to Mwanza');
assert(coverageForOrder(mwanzaOrder, approvedNoCoverage).reason === 'no-coverage', 'approved Nyamagana company with no coverage flag is skipped');
assert(coverageForOrder(mwanzaOrder, { ...approvedNoCoverage, coverageAllTanzania: true }).ok, 'same company matches once approval backfills nationwide coverage');
assert(!coverageForOrder(darOrder, { ...approvedNoCoverage, coverageAllTanzania: true }).ok, 'Mwanza base still does not take a Dar pickup');

const liveApproved = [approvedLive, approvedOffline].filter((carrier) => accountCanTakeOffers(carrier) && isCarrierLive(carrier, now));
const ranked = rankCarriers(darOrder, liveApproved, new Map(), new Map());
assert(ranked.length === 1 && ranked[0].carrierId === 'approved-live', 'only the live approved company is ranked');
assert(!rankCarriers(darOrder, [pendingLive, rejectedLive, pausedLive], new Map(), new Map()).length, 'ineligible companies produce no rank');

const second = {
  ...approvedLive,
  id: 'approved-live-2',
  companyName: 'Second Approved',
};
const both = rankCarriers(darOrder, [approvedLive, second], new Map(), new Map());
const firstOffer = pickExclusiveCarrier(both, new Set());
assert(firstOffer && firstOffer.carrierId, 'exclusive offer picks one company');
const holders = new Set([firstOffer.carrierId]);
assert(holders.size === 1, 'one offer has one holder');
const other = pickExclusiveCarrier(both, holders);
assert(other && other.carrierId !== firstOffer.carrierId, 'the next company is offered only after the first declines');
assert(pickExclusiveCarrier([firstOffer, other], new Set([firstOffer.carrierId, other.carrierId])) === null, 'both declined leaves nobody holding it');

const openPending = {
  shipmentStatus: 'assigned',
  offeredCarrierId: pendingLive.id,
  offerExpiresAt: new Date(now + OFFER_TIMEOUT_MS).toISOString(),
  offeredAt: fresh,
};
assert(shouldReleaseOpenOffer(openPending, pendingLive), 'open offer to a pending company is released');
assert(!shouldReleaseOpenOffer({ ...openPending, carrierId: pendingLive.id }, pendingLive), 'accepted work is not released');
assert(!shouldReleaseOpenOffer(openPending, approvedLive), 'open offer to an approved company stays while not timed out');
assert(!shouldReleaseOpenOffer({ shipmentStatus: 'cancelled', cancelledBy: 'customer', offeredCarrierId: pendingLive.id }, pendingLive), 'cancelled shipment is not an open offer');

const openFresh = {
  shipmentStatus: 'assigned',
  offeredCarrierId: approvedLive.id,
  offerExpiresAt: new Date(now + OFFER_TIMEOUT_MS).toISOString(),
  offeredAt: fresh,
};
assert(offerIsOpen(openFresh, now), 'fresh offer with expiry is open');
assert(!offerTimedOut(openFresh, now), 'fresh offer is not timed out');

const silentNull = {
  shipmentStatus: 'assigned',
  offeredCarrierId: approvedLive.id,
  offerExpiresAt: null,
  offeredAt: new Date(now - OFFER_TIMEOUT_MS - 5_000).toISOString(),
};
assert(!offerIsOpen(silentNull, now), 'null offerExpiresAt past offeredAt+timeout is closed');
assert(offerTimedOut(silentNull, now), 'silent approved holder past timeout is expired');

const foreverNull = {
  shipmentStatus: 'assigned',
  offeredCarrierId: approvedLive.id,
  offerExpiresAt: null,
};
assert(offerTimedOut(foreverNull, now), 'assigned hold with no deadline is treated as timed out');

const cancelled = { ...darOrder, status: 'cancelled', cancelledBy: 'customer' };
assert(isBusParcel(cancelled) === false, 'customer-cancelled order is not matched');
assert(isBusParcel(darOrder) === true, 'open bus parcel is matched');

const newDesk = { ...approvedLive, id: 'new-desk', ordersReceived: 0 };
const platinum = {
  ...approvedLive,
  id: 'platinum-desk',
  ordersReceived: 600,
  deliveries: 500,
  streak: 500,
  deskStanding: { tier: { id: 'platinum' }, feeRate: 0.06, priorityBonus: 40, closure: false },
};
const fair = rankCarriers(darOrder, [newDesk, platinum], new Map(), new Map());
assert(fair.length === 2, 'both live desks stay in the ranked pool');
assert(fair.some((entry) => entry.carrierId === 'new-desk'), 'new verified desk is ranked alongside platinum');

const freshOrder = { ...darOrder, createdAt: new Date(now - 5 * 60 * 1000).toISOString() };
const staleOrder = { ...darOrder, createdAt: new Date(now - FRESH_ORDER_MATCH_MS - 60_000).toISOString() };
assert(isFreshForOffer(freshOrder, { shipmentStatus: 'matching' }, now), 'recent order is fresh for offer');
assert(!isFreshForOffer(staleOrder, { shipmentStatus: 'matching' }, now), 'old matching order is not re-offered');
assert(!isFreshForOffer(freshOrder, { shipmentStatus: 'matching', carrierId: 'x' }, now), 'accepted shipment is not re-offered');
assert(!isFreshForOffer({ ...freshOrder, status: 'cancelled', cancelledBy: 'customer' }, { shipmentStatus: 'matching' }, now), 'cancelled order is not offered');
assert(!isFreshForOffer(staleOrder, { shipmentStatus: 'assigned', offeredCarrierId: approvedLive.id }, now), 'stale exclusive hold is not reoffered');
assert(!isFreshForOffer(freshOrder, { shipmentStatus: 'expired', matchClosedReason: 'stale-matching' }, now), 'parked shipment is not reoffered');

assert(OFFER_TIMEOUT_MS === 75 * 1000, 'OFFER_TIMEOUT_MS is the exclusive hold window');
assert(MAX_OFFERS >= 50, 'decline chain is not capped at a tiny MAX_OFFERS');

const timed = {
  shipmentStatus: 'assigned',
  offeredCarrierId: approvedLive.id,
  offerExpiresAt: new Date(now - 1).toISOString(),
  offeredAt: fresh,
};
assert(offerTimedOut(timed, now), 'past offerExpiresAt is timed out for rematch');
assert(!offerIsOpen(timed, now), 'timed out offer is not open');

console.log('offer-eligibility: ok');
