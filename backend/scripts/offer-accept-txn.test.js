/**
 * Atomic accept + isolation fixtures (no Firestore writes).
 * Mirrors handlePortalAccept / portal writeStageFallback guards.
 * Run: node backend/scripts/offer-accept-txn.test.js
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function canAccept(current, carrierId, now = Date.now()) {
  if (!current) return { ok: false, reason: 'missing' };
  if (current.carrierId && current.carrierId !== carrierId) {
    return { ok: false, reason: 'taken-by-other' };
  }
  if (current.carrierId === carrierId) return { ok: false, reason: 'already-self', already: true };
  if (current.offeredCarrierId !== carrierId || current.shipmentStatus !== 'assigned') {
    return { ok: false, reason: 'not-offered' };
  }
  const expires = current.offerExpiresAt ? new Date(current.offerExpiresAt).getTime() : 0;
  if (expires && expires <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** Simulate two companies racing the same transactional read of one open offer. */
function raceAccept(shipment, a, b, now = Date.now()) {
  const first = canAccept(shipment, a, now);
  if (!first.ok) return { winner: null, losers: [a, b], first };
  const afterA = { ...shipment, carrierId: a, shipmentStatus: 'accepted' };
  const second = canAccept(afterA, b, now);
  return { winner: a, afterA, second };
}

const open = {
  shipmentStatus: 'assigned',
  offeredCarrierId: 'co-a',
  offerExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  carrierId: null,
};

const race = raceAccept(open, 'co-a', 'co-b');
assert(race.winner === 'co-a', 'offered company wins the race');
assert(race.second.ok === false && race.second.reason === 'taken-by-other', 'second company is rejected');

const wrong = canAccept(open, 'co-b');
assert(!wrong.ok && wrong.reason === 'not-offered', 'non-holder cannot accept');

const expired = canAccept(
  { ...open, offerExpiresAt: new Date(Date.now() - 1000).toISOString() },
  'co-a'
);
assert(!expired.ok && expired.reason === 'expired', 'expired offer cannot accept');

const already = canAccept({ ...open, carrierId: 'co-a', shipmentStatus: 'accepted' }, 'co-a');
assert(already.already === true, 'repeat accept by same company is idempotent already');

/** Desk isolation: company only sees its offered/owned rows. */
function visibleTo(shipment, carrierId) {
  return shipment.offeredCarrierId === carrierId || shipment.carrierId === carrierId;
}
const mine = { ...open, offeredCarrierId: 'co-a' };
const theirs = { ...open, offeredCarrierId: 'co-b' };
assert(visibleTo(mine, 'co-a') && !visibleTo(theirs, 'co-a'), 'transporter isolation by offeredCarrierId');
assert(visibleTo({ ...mine, carrierId: 'co-a', offeredCarrierId: 'co-a' }, 'co-a'), 'owned rows stay visible');
assert(!visibleTo({ ...mine, carrierId: 'co-b', offeredCarrierId: 'co-b' }, 'co-a'), 'other owned rows stay hidden');

/** Duplicate CF / cron: open offer short-circuits a second match. */
function offerIsOpen(shipment, now = Date.now()) {
  if (!shipment || shipment.carrierId) return false;
  if (shipment.shipmentStatus !== 'assigned' || !shipment.offeredCarrierId) return false;
  const expires = shipment.offerExpiresAt ? new Date(shipment.offerExpiresAt).getTime() : 0;
  return expires > now;
}
assert(offerIsOpen(open), 'fresh exclusive offer is open');
assert(!offerIsOpen({ ...open, offerExpiresAt: null, offeredAt: null }), 'null deadline is not forever-open');

console.log('offer-accept-txn: ok');
