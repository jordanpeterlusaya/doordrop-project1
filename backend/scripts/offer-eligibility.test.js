/**
 * Eligibility fixtures for new transporters. No Firestore writes.
 * Run: node backend/scripts/offer-eligibility.test.js
 */
const {
  accountBlockReason,
  accountCanTakeOffers,
  coverageForOrder,
  isBusParcel,
  isCarrierLive,
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
  offerExpiresAt: null,
};
assert(shouldReleaseOpenOffer(openPending, pendingLive), 'open offer to a pending company is released');
assert(!shouldReleaseOpenOffer({ ...openPending, carrierId: pendingLive.id }, pendingLive), 'accepted work is not released');
assert(!shouldReleaseOpenOffer(openPending, approvedLive), 'open offer to an approved company stays');
assert(!shouldReleaseOpenOffer({ shipmentStatus: 'cancelled', cancelledBy: 'customer', offeredCarrierId: pendingLive.id }, pendingLive), 'cancelled shipment is not an open offer');

const cancelled = { ...darOrder, status: 'cancelled', cancelledBy: 'customer' };
assert(isBusParcel(cancelled) === false, 'customer-cancelled order is not matched');
assert(isBusParcel(darOrder) === true, 'open bus parcel is matched');

console.log('offer-eligibility: ok');
