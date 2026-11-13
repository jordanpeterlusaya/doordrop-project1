const { FieldValue, Timestamp } = require('firebase-admin/firestore');

/** Exclusive offer window. Silent / non-responding desks lose the hold after this. */
const OFFER_TIMEOUT_MS = 75 * 1000;
/** Company portal must pulse portalOnlineAt within this window to receive new offers. */
const PORTAL_ONLINE_MS = 3 * 60 * 1000;
/**
 * Only freshly created customer orders may be offered / claimed / rematched.
 * Stale matching rows must not flood live desks as if they were new.
 */
const FRESH_ORDER_MATCH_MS = 2 * 60 * 60 * 1000;
/** High-cancel penalty. Normal streak tiers are lower. */
const HAUL_FEE_RATE = 0.15;
/**
 * Unpaid haulFee ceiling before new offers stop. Higher streak tiers can
 * owe more. The 20% cancel punishment uses the Bronze ceiling.
 * Keep identical to payCeilingTzs in haulcargo-agents-app/constants/carrier-desk.ts.
 * Active jobs are not touched.
 */
const TIER_RULES = [
  { id: 'bronze', minStreak: 0, feePercent: 12, feeRate: 0.12, priorityBonus: 0, payCeilingTzs: 30_000 },
  { id: 'silver', minStreak: 100, feePercent: 10, feeRate: 0.1, priorityBonus: 6, payCeilingTzs: 60_000 },
  { id: 'gold', minStreak: 250, feePercent: 8, feeRate: 0.08, priorityBonus: 16, payCeilingTzs: 100_000 },
  { id: 'platinum', minStreak: 500, feePercent: 6, feeRate: 0.06, priorityBonus: 40, payCeilingTzs: 150_000 },
];
/** Soft safety cap only — decline chain walks the full eligible ranked list. */
const MAX_OFFERS = 50;
/** Modest boost so brand-new verified desks are not stuck forever behind platinum. */
const NEW_DESK_FAIRNESS_BONUS = 12;
const NEW_DESK_RECEIVED_CAP = 5;
const DAR_TIME_ZONE = 'Africa/Dar_es_Salaam';

const SHIPMENT_FLOW = [
  'new',
  'matching',
  'assigned',
  'accepted',
  'contacted',
  'pickup_scheduled',
  'picked_up',
  'at_bus',
  'in_transit',
  'arrived',
  'delivered',
];

const CAPACITY_HOLD_STATUSES = new Set([
  'assigned',
  'accepted',
  'contacted',
  'pickup_scheduled',
  'picked_up',
  'at_bus',
  'in_transit',
  'arrived',
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function moneyFromOrder(order) {
  // Shipping fee only. declaredValueTzs is goods value and must not become the fare.
  const declared = declaredValueTzs(order);
  const quoted = Math.round(Number(order?.carrierQuoteTzs || order?.shippingFeeTzs) || 0);
  const status = String(order?.quoteStatus || '').trim();
  if (status === 'awaiting_company') return 0;
  if (status === 'offered' || status === 'confirmed') return quoted > 0 ? quoted : 0;
  if (quoted > 0 && quoted !== declared) return quoted;
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''}`.replace(/,/g, '');
  if (/baada|awaiting|kampuni|quote/i.test(source)) return 0;
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Math.round(Number(match[1]));
  return parsed > 0 && parsed !== declared ? parsed : 0;
}

function weightKg(order) {
  const parsed = Number(String(order.outsideParcelWeightKg ?? order.weightKg ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBusParcel(order) {
  if (!order || order.status === 'cancelled') return false;
  if (normalize(order.flow) !== 'parcel') return false;
  const mode = normalize(order.outsideShippingMode);
  if (mode === 'express' || mode === 'air' || mode === 'flight' || mode === 'ndege') return false;
  if (normalize(order.parcelScope) === 'outside') return true;
  if (String(order.outsideDestinationCity || order.outsideDestinationLabel || '').trim()) return true;
  return mode === 'road' || mode === 'bus' || mode === 'ferry' || mode === 'standard';
}

function isDarHub(value) {
  const text = normalize(value);
  if (!text) return false;
  return text.includes('kariakoo') || text.includes('dar') || text.includes('salaam') || text.includes('dsm');
}

function placesMatch(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (isDarHub(a) && isDarHub(b)) return true;
  const aParts = a.split(' ').filter((part) => part.length > 2);
  const bParts = new Set(b.split(' ').filter((part) => part.length > 2));
  return aParts.some((part) => bParts.has(part));
}

function orderDestination(order) {
  return order.outsideDestinationCity || order.outsideDestinationLabel || order.dropoffLabel || order.destination || '';
}

function orderOrigin(order) {
  return order.outsideOriginCity || order.pickupLabel || order.origin || '';
}

/**
 * Canonical region id is aliases[0]. Short names match whole tokens only so
 * "Dar" matches Dar es Salaam and "Darajani" does not.
 */
const TZ_REGION_ALIASES = [
  ['dar es salaam', 'dar', 'dsm', 'salaam', 'kariakoo', 'ilala', 'kinondoni', 'temeke', 'ubungo', 'kigamboni'],
  ['mwanza', 'ilemela', 'nyamagana', 'nyegezi', 'nyakato'],
  ['arusha'],
  ['dodoma'],
  ['mbeya'],
  ['morogoro'],
  ['tanga'],
  ['kilimanjaro', 'moshi'],
  ['kigoma'],
  ['tabora'],
  ['shinyanga', 'kahama'],
  ['singida'],
  ['iringa'],
  ['mtwara', 'mikindani'],
  ['lindi'],
  ['ruvuma', 'songea'],
  ['pwani', 'coast', 'kibaha', 'bagamoyo'],
  ['geita'],
  ['kagera', 'bukoba'],
  ['mara', 'musoma'],
  ['manyara', 'babati'],
  // Makambako is the main cargo/bus town in Njombe region.
  ['njombe', 'makambako'],
  ['katavi', 'mpanda'],
  ['rukwa', 'sumbawanga'],
  ['simiyu'],
  ['songwe'],
  ['unguja', 'zanzibar', 'stone town'],
  ['pemba'],
];

const INTL_HINTS = [
  'kenya',
  'nairobi',
  'mombasa',
  'uganda',
  'kampala',
  'rwanda',
  'kigali',
  'burundi',
  'bujumbura',
  'zambia',
  'malawi',
  'mozambique',
  'congo',
  'drc',
  'south africa',
  'dubai',
  'abroad',
  'nje ya nchi',
  'international',
];

function looksInternational(value) {
  const text = normalize(value);
  if (!text) return false;
  return INTL_HINTS.some((hint) => text.includes(hint));
}

function detectTzRegion(value) {
  const text = normalize(value);
  if (!text) return '';
  const tokens = new Set(text.split(' ').filter(Boolean));
  let bestId = '';
  let bestLen = 0;
  for (const aliases of TZ_REGION_ALIASES) {
    const id = aliases[0];
    for (const alias of aliases) {
      const key = normalize(alias);
      if (!key) continue;
      const hit = key.includes(' ') ? text.includes(key) : tokens.has(key);
      if (!hit || key.length <= bestLen) continue;
      bestLen = key.length;
      bestId = id;
    }
  }
  return bestId;
}

/** Home region from registration. Location / address are fallbacks when region is empty. */
function carrierBaseRegion(carrier) {
  if (!carrier) return '';
  return (
    detectTzRegion(carrier.region) ||
    detectTzRegion(carrier.location) ||
    detectTzRegion(carrier.physicalAddress) ||
    // Legacy profiles created before region was required sometimes only have a town in the name.
    detectTzRegion(carrier.companyName) ||
    detectTzRegion(carrier.tradingName) ||
    detectTzRegion(carrier.name) ||
    ''
  );
}

function carrierHasCoverageDeclared(carrier) {
  if (!carrier) return false;
  if (carrier.coverageIntraCity === true) return true;
  if (carrier.coverageAllTanzania === true) return true;
  if (carrier.coverageInternational === true) return true;
  return Array.isArray(carrier.coverageRegions) && carrier.coverageRegions.length > 0;
}

function selectedDestinationRegions(carrier) {
  return (carrier.coverageRegions || []).map((region) => detectTzRegion(region)).filter(Boolean);
}

/**
 * Origin must be the carrier's base region. Destination follows coverage:
 * nationwide = any destination, selected regions = those regions only,
 * within-city = destination region equals the base region.
 * Stored routes and dispatch times are ignored.
 */
function coverageForOrder(order, carrier) {
  const base = carrierBaseRegion(carrier);
  if (!base) return { ok: false, bonus: 0, reason: 'no-base-region' };

  const originRegion = detectTzRegion(orderOrigin(order));
  if (!originRegion || originRegion !== base) {
    return { ok: false, bonus: 0, reason: 'origin-miss' };
  }

  const destination = orderDestination(order);
  if (!normalize(destination)) return { ok: false, bonus: 0, reason: 'no-destination' };

  const destRegion = detectTzRegion(destination);
  const international = looksInternational(destination) && !destRegion;

  if (carrier.coverageIntraCity === true) {
    if (international || !destRegion || destRegion !== base) {
      return { ok: false, bonus: 0, reason: 'city-miss' };
    }
    return { ok: true, bonus: 14, reason: 'intra-city' };
  }

  if (carrier.coverageAllTanzania === true) {
    return { ok: true, bonus: 8, reason: 'all-tanzania' };
  }

  if (international) {
    if (carrier.coverageInternational === true) return { ok: true, bonus: 10, reason: 'international' };
    return { ok: false, bonus: 0, reason: 'no-international' };
  }

  const selected = selectedDestinationRegions(carrier);
  if (!selected.length) return { ok: false, bonus: 0, reason: 'no-coverage' };
  if (destRegion && selected.includes(destRegion)) {
    return { ok: true, bonus: 12, reason: 'region' };
  }
  return { ok: false, bonus: 0, reason: 'region-miss' };
}

function dayNameInDar(date) {
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: DAR_TIME_ZONE });
  return fmt.format(date).slice(0, 3).toLowerCase();
}

function serviceDayName(order, now) {
  if (normalize(order?.timingMode) === 'later' && order?.scheduleDate) {
    const parsed = new Date(`${order.scheduleDate}T12:00:00+03:00`);
    if (!Number.isNaN(parsed.getTime())) return dayNameInDar(parsed);
  }
  return dayNameInDar(now || new Date());
}

function routeOperatesOn(route, dayName) {
  const days = Array.isArray(route.operatingDays)
    ? route.operatingDays.map((day) => normalize(day).slice(0, 3)).filter(Boolean)
    : [];
  if (!days.length) return true;
  return days.includes(dayName);
}

function holdsCapacity(status) {
  return CAPACITY_HOLD_STATUSES.has(normalize(status));
}

function heldWeightByRoute(shipments, excludeOrderId) {
  const used = new Map();
  for (const shipment of shipments || []) {
    if (!shipment?.routeId) continue;
    if (excludeOrderId && (shipment.id === excludeOrderId || shipment.orderId === excludeOrderId)) continue;
    if (!holdsCapacity(shipment.shipmentStatus)) continue;
    const kg = Number(shipment.weightKg) || 0;
    used.set(shipment.routeId, (used.get(shipment.routeId) || 0) + kg);
  }
  return used;
}

function remainingCapacityKg(route, usedByRoute) {
  const limit = Number(route.cargoCapacityKg) || 0;
  const used = usedByRoute?.get(route.id) || 0;
  return limit - used;
}

function routeCanTake(route, weight, usedByRoute) {
  const limit = Number(route.cargoCapacityKg) || 0;
  if (limit <= 0) return false;
  const used = usedByRoute?.get(route.id) || 0;
  if (used >= limit) return false;
  return used + (Number(weight) || 0) <= limit;
}

/**
 * Streak tier, then a 20% commission if cancels are too high.
 * Keep thresholds identical to haulcargo-agents-app/constants/carrier-desk.ts.
 */
function completionStreak(completionTimes, breakTimes, undatedBreak) {
  if (undatedBreak) return 0;
  const latestBreak = (breakTimes || []).reduce((max, ms) => Math.max(max, Math.floor(Number(ms) || 0)), 0);
  if (latestBreak <= 0) return (completionTimes || []).length;
  return (completionTimes || []).filter((ms) => Math.floor(Number(ms) || 0) > latestBreak).length;
}

function carrierStanding(input) {
  const source = input && typeof input === 'object' ? input : { streak: input };
  const streak = Math.max(0, Math.floor(Number(source.streak) || 0));
  const completed = Math.max(0, Math.floor(Number(source.completed) || 0));
  const rejects = Math.max(0, Math.floor(Number(source.rejects) || 0));
  const postAcceptCancels = Math.max(0, Math.floor(Number(source.postAcceptCancels) || 0));
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  let tier = TIER_RULES[0];
  for (const rule of TIER_RULES) {
    if (streak >= rule.minStreak) tier = rule;
  }
  const highCancel = cancelRate > 0.25 && decisions >= 8;
  const closure = postAcceptCancels >= 3 || (cancelRate >= 0.4 && decisions >= 8);
  const punished = highCancel || closure;
  return {
    streak,
    completed,
    rejects,
    postAcceptCancels,
    decisions,
    cancelRate,
    cancelPercent: Math.round(cancelRate * 100),
    highCommission: punished,
    closure,
    feeRate: punished ? HAUL_FEE_RATE : tier.feeRate,
    priorityBonus: punished ? 0 : tier.priorityBonus,
    tier,
  };
}

/** Streak-tier ceiling. The 20% cancel punishment group uses Bronze. */
function commissionPayCeiling(standing) {
  if (!standing || standing.highCommission) return TIER_RULES[0].payCeilingTzs;
  return Number(standing.tier?.payCeilingTzs) || TIER_RULES[0].payCeilingTzs;
}

function scoreCarrier(order, carrier, routes, vehicles) {
  void routes;
  const coverage = coverageForOrder(order, carrier);
  if (!coverage.ok) return null;
  if (carrier.offersPaused || carrier.fraudHold) return null;

  const origin = orderOrigin(order);
  const destination = orderDestination(order);
  let score = 60 + coverage.bonus;
  const activeVehicle = (vehicles || []).some((vehicle) => normalize(vehicle.status) === 'active');
  if (activeVehicle) score += 6;
  else score -= 10;
  const received = Number(carrier.ordersReceived) || 0;
  const delivered = Number(carrier.deliveries) || 0;
  const rejected = Number(carrier.rejected) || 0;
  if (received > 0) {
    const reliability = delivered / received - rejected / (received * 4);
    score += Math.round(Math.max(-8, Math.min(8, reliability * 12)));
  }
  const standing =
    carrier.deskStanding ||
    carrierStanding({
      streak: carrier.streak,
      completed: carrier.completedShipments,
      rejects: rejected,
      postAcceptCancels: carrier.postAcceptCancels,
    });
  if (standing.closure) return null;
  if ((Number(carrier.unpaidHaulFee) || 0) >= commissionPayCeiling(standing)) return null;
  score += standing.priorityBonus;
  // New verified desks: small fairness bump so platinum live desks do not lock them out forever.
  if (received < NEW_DESK_RECEIVED_CAP) {
    score += Math.round(NEW_DESK_FAIRNESS_BONUS * ((NEW_DESK_RECEIVED_CAP - received) / NEW_DESK_RECEIVED_CAP));
  }
  score = Math.max(1, Math.min(199, score));
  return {
    carrierId: carrier.id,
    companyName: carrier.companyName || '',
    score,
    tierId: standing.tier.id,
    haulFeeRate: standing.feeRate,
    routeId: '',
    routeLabel: `${origin} → ${destination}`,
    remainingKg: 0,
    departureTime: '',
    arrivalTime: '',
    coverageReason: coverage.reason,
  };
}

/**
 * Why this company cannot be offered an order.
 * Only status `verified` is approved. Pending stays registered but unapproved.
 */
function accountBlockReason(carrier) {
  if (!carrier) return 'missing';
  if (carrier.offersPaused) return 'paused';
  if (carrier.fraudHold) return 'fraud-hold';
  const status = normalize(carrier.status);
  if (status === 'verified') return '';
  if (status === 'rejected') return 'rejected';
  if (status === 'suspended') return 'suspended';
  if (status === 'pending') return 'unapproved';
  return 'unapproved';
}

function accountCanTakeOffers(carrier) {
  return accountBlockReason(carrier) === '';
}

/**
 * Approved companies registered before coverage was stored have a base region
 * and zero coverage flags, so every order skips them as no-coverage.
 * New registration already writes coverageAllTanzania. Fill that same default
 * once, only after approval, and only when a base region exists.
 */
async function withVerifiedCoverage(db, carrier) {
  if (!carrier?.id || normalize(carrier.status) !== 'verified') return carrier;
  if (carrierHasCoverageDeclared(carrier)) return carrier;
  if (!carrierBaseRegion(carrier)) return carrier;
  try {
    await db.collection('carriers').doc(carrier.id).set(
      {
        coverageAllTanzania: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.info('carrier coverage backfill', { carrierId: carrier.id, reason: 'verified-without-coverage' });
  } catch (error) {
    console.error('carrier coverage backfill failed', carrier.id, error?.message || error);
    return carrier;
  }
  return { ...carrier, coverageAllTanzania: true };
}

function rankCarriers(order, carriers, routesByCarrier, vehiclesByCarrier, options = {}) {
  const completedByCarrier = options.completedByCarrier instanceof Map ? options.completedByCarrier : new Map();
  const standingByCarrier = options.standingByCarrier instanceof Map ? options.standingByCarrier : new Map();
  const unpaidByCarrier = options.unpaidByCarrier instanceof Map ? options.unpaidByCarrier : null;
  return (carriers || [])
    .filter((carrier) => accountCanTakeOffers(carrier))
    .map((carrier) =>
      scoreCarrier(
        order,
        {
          ...carrier,
          completedShipments: completedByCarrier.get(carrier.id) || carrier.completedShipments || 0,
          deskStanding: standingByCarrier.get(carrier.id) || carrier.deskStanding,
          unpaidHaulFee: unpaidByCarrier ? unpaidByCarrier.get(carrier.id) || 0 : carrier.unpaidHaulFee,
        },
        routesByCarrier.get(carrier.id) || [],
        vehiclesByCarrier.get(carrier.id) || []
      )
    )
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.carrierId.localeCompare(right.carrierId))
    .slice(0, MAX_OFFERS); // high cap — never dead-end matching after a few declines
}

function cashSplit(amount, feeRate) {
  const rate = Number.isFinite(Number(feeRate)) ? Number(feeRate) : HAUL_FEE_RATE;
  const safeAmount = Math.round(Number(amount) || 0);
  const percent = Math.round(rate * 100);
  const haulFee = Math.round((safeAmount * percent) / 100);
  return {
    amount: safeAmount,
    haulFee,
    carrierNet: safeAmount - haulFee,
    haulFeeRate: percent / 100,
  };
}

function historyEntry(status, actor) {
  return {
    status,
    at: new Date().toISOString(),
    actor: actor || 'system',
  };
}

function expiryMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Absolute deadline for an exclusive offer. Null offerExpiresAt falls back to offeredAt + timeout. */
function offerDeadlineMs(shipment) {
  const expires = expiryMs(shipment?.offerExpiresAt);
  if (expires) return expires;
  const offered = expiryMs(shipment?.offeredAt);
  if (offered) return offered + OFFER_TIMEOUT_MS;
  const updated = expiryMs(shipment?.updatedAt);
  if (updated) return updated + OFFER_TIMEOUT_MS;
  return 0;
}

function offerIsOpen(shipment, now = Date.now()) {
  if (!shipment || shipment.carrierId) return false;
  if (normalize(shipment.shipmentStatus) !== 'assigned' || !shipment.offeredCarrierId) return false;
  const deadline = offerDeadlineMs(shipment);
  // Never treat missing expiry as forever — that left silent approved desks blocking forever.
  return deadline > now;
}

/** True when an exclusive hold has expired or was left with no usable deadline. */
function offerTimedOut(shipment, now = Date.now()) {
  if (!shipment || shipment.carrierId) return false;
  if (normalize(shipment.shipmentStatus) !== 'assigned' || !shipment.offeredCarrierId) return false;
  const deadline = offerDeadlineMs(shipment);
  return !deadline || deadline <= now;
}

/** Prefer the customer order createdAt; shipment timestamps are fallback only. */
function orderCreatedMs(order, shipment) {
  return (
    expiryMs(order?.createdAt) ||
    expiryMs(shipment?.orderCreatedAt) ||
    expiryMs(shipment?.createdAt) ||
    0
  );
}

/**
 * True when this order is still eligible to be offered to companies.
 * Cancelled / accepted work never qualifies. Missing createdAt is treated as
 * not fresh for claim/cron (create-trigger match still runs for the new id).
 */
function isFreshForOffer(order, shipment, now = Date.now()) {
  const { isCustomerCancelledRecord } = require('./carrier-cancel');
  if (isCustomerCancelledRecord(order) || isCustomerCancelledRecord(shipment)) return false;
  if (shipment?.carrierId) return false;
  const status = normalize(shipment?.shipmentStatus);
  if (status === 'expired' || status === 'delivered' || status === 'cancelled') return false;
  const created = orderCreatedMs(order, shipment);
  if (!created) return false;
  return now - created <= FRESH_ORDER_MATCH_MS;
}

/** Park a never-accepted stale row so desks and cron stop seeing it. */
async function parkStaleShipment(db, orderId, shipment, reason = 'stale') {
  const status = normalize(shipment?.shipmentStatus);
  if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
  if (status === 'expired' || status === 'delivered' || status === 'cancelled') {
    return { skipped: true, reason: status || 'closed' };
  }
  if (!['matching', 'assigned', 'new'].includes(status) && status) {
    return { skipped: true, reason: 'active-flow' };
  }
  const { idempotencyDocId, queueDeliveryEvent, staleIdempotencyKey } = require('./order-reliability');
  const staleKey = staleIdempotencyKey(orderId);
  const closedReason = String(reason || 'stale').slice(0, 64);
  await db.runTransaction(async (tx) => {
    const liveSnap = await tx.get(db.collection('carrierShipments').doc(orderId));
    const live = liveSnap.exists ? liveSnap.data() : shipment;
    if (live?.carrierId) return;
    const liveStatus = normalize(live?.shipmentStatus);
    if (liveStatus === 'expired' || liveStatus === 'delivered' || liveStatus === 'cancelled') return;
    const idemSnap = await tx.get(db.collection('idempotency').doc(idempotencyDocId(staleKey)));
    tx.set(
      db.collection('carrierShipments').doc(orderId),
      {
        shipmentStatus: 'expired',
        offeredCarrierId: null,
        offerExpiresAt: null,
        matchClosedReason: closedReason,
        matchClosedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion(historyEntry('expired', `system-${closedReason}`)),
      },
      { merge: true }
    );
    if (!idemSnap.exists) {
      queueDeliveryEvent(tx, db, {
        eventId: `stale_${orderId}`,
        type: 'shipment.parked',
        idempotencyKey: staleKey,
        orderId,
        payload: { reason: closedReason },
      });
    }
  });
  console.info('carrier shipment parked', { orderId, reason: reason || 'stale' });
  return { parked: true, reason: reason || 'stale' };
}

/** True when the company portal (or live offer socket) is active right now. */
function isCarrierLive(carrier, now = Date.now(), preferCarrierIds = null) {
  if (!carrier) return false;
  const id = String(carrier.id || '').trim();
  if (preferCarrierIds && id && preferCarrierIds.has(id)) return true;
  const onlineAt = expiryMs(carrier.portalOnlineAt);
  return onlineAt > 0 && now - onlineAt <= PORTAL_ONLINE_MS;
}

function declinedCarrierIds(shipment) {
  const declined = new Set(shipment?.declinedCarrierIds || []);
  if (shipment?.offeredCarrierId && !offerIsOpen(shipment)) declined.add(shipment.offeredCarrierId);
  return declined;
}

/** One company per offer. The shipment transaction is what makes the write exclusive. */
function pickExclusiveCarrier(ranked, declined) {
  const skip = declined instanceof Set ? declined : new Set(declined || []);
  return (ranked || []).find((entry) => entry?.carrierId && !skip.has(entry.carrierId)) || null;
}

/** Open offers stay with an approved company. Unapproved or ineligible holders are released. */
function shouldReleaseOpenOffer(shipment, holder) {
  if (!shipment || shipment.carrierId) return false;
  if (!offerIsOpen(shipment)) return false;
  return !accountCanTakeOffers(holder);
}

async function loadNetwork(db, options = {}) {
  const prefer =
    options.preferCarrierIds instanceof Set
      ? options.preferCarrierIds
      : options.preferCarrierIds
        ? new Set([...options.preferCarrierIds].map((id) => String(id || '').trim()).filter(Boolean))
        : new Set();
  const since = Timestamp.fromMillis(Date.now() - PORTAL_ONLINE_MS);
  const [verifiedSnap, liveSnap, routeSnap, vehicleSnap] = await Promise.all([
    db.collection('carriers').where('status', '==', 'verified').get(),
    db.collection('carriers').where('portalOnlineAt', '>=', since).get(),
    db.collection('carrierRoutes').where('active', '==', true).get(),
    db.collection('carrierVehicles').where('status', '==', 'active').get(),
  ]);
  const byId = new Map();
  const addDoc = (doc) => {
    if (!doc?.exists) return;
    byId.set(doc.id, { id: doc.id, ...doc.data() });
  };
  verifiedSnap.docs.forEach(addDoc);
  liveSnap.docs.forEach(addDoc);
  const missing = [...prefer].filter((id) => id && !byId.has(id));
  if (missing.length) {
    const extras = await Promise.all(missing.map((id) => db.collection('carriers').doc(id).get()));
    extras.forEach(addDoc);
  }
  // Load verified companies and anyone with a fresh heartbeat so a new desk is visible.
  // Unapproved, rejected, suspended, and paused companies are reported, then left out.
  const carriers = [];
  const skipped = [];
  for (const carrier of byId.values()) {
    const reason = accountBlockReason(carrier);
    if (reason) skipped.push({ id: carrier.id, reason });
    else carriers.push(carrier);
  }
  const routesByCarrier = new Map();
  routeSnap.docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() };
    const list = routesByCarrier.get(data.carrierId) || [];
    list.push(data);
    routesByCarrier.set(data.carrierId, list);
  });
  const vehiclesByCarrier = new Map();
  vehicleSnap.docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() };
    const list = vehiclesByCarrier.get(data.carrierId) || [];
    list.push(data);
    vehiclesByCarrier.set(data.carrierId, list);
  });
  return { carriers, skipped, routesByCarrier, vehiclesByCarrier };
}

async function loadHeldWeight(db, excludeOrderId) {
  const snap = await db.collection('carrierShipments').where('shipmentStatus', 'in', [...CAPACITY_HOLD_STATUSES]).get();
  return heldWeightByRoute(
    snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    excludeOrderId
  );
}

function declaredValueTzs(order) {
  const raw = order?.declaredValueTzs ?? order?.declaredValue;
  if (raw == null || String(raw).trim() === '') return 0;
  const parsed = Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

const OPEN_VALUE_STATUSES = [
  'matching',
  'assigned',
  'accepted',
  'contacted',
  'pickup_scheduled',
  'picked_up',
  'at_bus',
  'in_transit',
];

/** Copy a real declared value onto a shipment. Never writes 0. */
async function copyDeclaredValue(db, orderId, order, shipment) {
  if (declaredValueTzs(shipment) > 0) return false;
  const value = declaredValueTzs(order);
  if (!value) return false;
  await db.collection('carrierShipments').doc(orderId).set(
    {
      declaredValueTzs: value,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (shipment && typeof shipment === 'object') shipment.declaredValueTzs = value;
  return true;
}

async function backfillOpenDeclaredValues(db) {
  const snap = await db.collection('carrierShipments').where('shipmentStatus', 'in', OPEN_VALUE_STATUSES).get();
  let filled = 0;
  for (const doc of snap.docs) {
    const shipment = doc.data() || {};
    if (declaredValueTzs(shipment) > 0) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    if (!orderSnap.exists) continue;
    const wrote = await copyDeclaredValue(db, doc.id, orderSnap.data(), shipment);
    if (wrote) filled += 1;
  }
  return filled;
}

/** Copy the customer cargo photo onto the shipment the portal reads. */
async function syncParcelPhotos(db, orderId, order, shipmentHint) {
  const photos = storedParcelPhotoUrls(order);
  if (!photos.length || !orderId) return false;
  const ref = db.collection('carrierShipments').doc(orderId);
  const current = shipmentHint || null;
  const existing = storedParcelPhotoUrls(current || {});
  if (existing.length === photos.length && existing[0] === photos[0]) return false;
  const snap = current ? null : await ref.get();
  if (!current && (!snap || !snap.exists)) return false;
  const already = current ? existing : storedParcelPhotoUrls(snap.data() || {});
  if (already.length === photos.length && already[0] === photos[0]) return false;
  await ref.set(
    {
      parcelPhotoUrls: photos,
      parcelPhotoUrl: photos[0],
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (shipmentHint) {
    shipmentHint.parcelPhotoUrls = photos;
    shipmentHint.parcelPhotoUrl = photos[0];
  }
  return true;
}

/** Only URLs the customer order actually stored. Never invent a photo list. */
function storedParcelPhotoUrls(order) {
  const raw = order?.parcelPhotoUrls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((url) => String(url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
}

function directSenderPhone(order) {
  return String(order?.senderPhone || order?.customerPhone || order?.phoneNumber || '').trim();
}

function directSenderName(order) {
  return String(order?.senderName || order?.customerName || order?.fullName || '').trim();
}

function directRecipientName(order) {
  return String(order?.recipientName || order?.receiverName || '').trim();
}

function directRecipientPhone(order) {
  return String(order?.recipientPhone || order?.receiverPhone || '').trim();
}

function directRecipientAddress(order) {
  return String(
    order?.recipientAddress ||
      order?.dropoffLabel ||
      order?.outsideDestinationStand ||
      order?.outsideDestinationLabel ||
      order?.outsideDestinationCity ||
      ''
  ).trim();
}

/** Profile phone/name when the parcel order was saved without sender fields. */
async function resolveSenderProfile(db, order) {
  const phone = directSenderPhone(order);
  const name = directSenderName(order);
  if (phone && name) return { phone, name };
  const userId = String(order?.userId || '').trim();
  if (!userId || userId.startsWith('manual:')) return { phone, name };
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return { phone, name };
    const data = snap.data() || {};
    return {
      phone: phone || String(data.phoneNumber || data.phone || '').trim(),
      name: name || String(data.fullName || data.displayName || data.name || '').trim(),
    };
  } catch {
    return { phone, name };
  }
}

async function resolveSenderPhone(db, order) {
  const profile = await resolveSenderProfile(db, order);
  return profile.phone;
}

/**
 * Write mtumaji + mpokeaji details onto the customer order and carrier shipment.
 * Agents inbox/detail and SMS both read these fields.
 */
async function persistSenderPhone(db, orderId, order, shipment) {
  const profile = await resolveSenderProfile(db, order);
  const phone = profile.phone;
  const senderName = profile.name;
  const recipientName = directRecipientName(order);
  const recipientPhone = directRecipientPhone(order);
  const recipientAddress = directRecipientAddress(order);
  if (!phone && !senderName && !recipientName && !recipientPhone) return '';

  const orderPatch = {};
  if (phone && !String(order?.customerPhone || '').trim()) orderPatch.customerPhone = phone;
  if (phone && !String(order?.senderPhone || '').trim()) orderPatch.senderPhone = phone;
  if (senderName && !String(order?.customerName || '').trim()) orderPatch.customerName = senderName;
  if (senderName && !String(order?.senderName || '').trim()) orderPatch.senderName = senderName;
  if (recipientName && !String(order?.recipientName || '').trim()) orderPatch.recipientName = recipientName;
  if (recipientPhone && !String(order?.recipientPhone || '').trim()) orderPatch.recipientPhone = recipientPhone;
  if (Object.keys(orderPatch).length) {
    await db.collection('orders').doc(orderId).set(orderPatch, { merge: true });
    Object.assign(order, orderPatch);
  }

  const shipPatch = {
    customerName: String(shipment?.customerName || order.customerName || senderName || '').trim(),
    senderName: String(shipment?.senderName || order.senderName || senderName || order.customerName || '').trim(),
    customerPhone: String(shipment?.customerPhone || order.customerPhone || phone || '').trim(),
    senderPhone: String(shipment?.senderPhone || order.senderPhone || phone || '').trim(),
    recipientName: String(shipment?.recipientName || recipientName || '').trim(),
    recipientPhone: String(shipment?.recipientPhone || recipientPhone || '').trim(),
    recipientAddress: String(shipment?.recipientAddress || recipientAddress || '').trim(),
    dropoffLabel: String(shipment?.dropoffLabel || order.dropoffLabel || recipientAddress || '').trim(),
    userId: String(shipment?.userId || order.userId || '').trim(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('carrierShipments').doc(orderId).set(shipPatch, { merge: true });
  if (shipment) Object.assign(shipment, shipPatch);

  return phone;
}

function distanceFieldsFromOrder(order) {
  const metersRaw = Number(order?.distanceMeters);
  const distanceMeters = Number.isFinite(metersRaw) && metersRaw > 0 ? Math.round(metersRaw) : 0;
  const kmRaw = Number(order?.distanceKm);
  const distanceKm =
    Number.isFinite(kmRaw) && kmRaw > 0
      ? Math.round(kmRaw * 10) / 10
      : distanceMeters > 0
        ? Math.round((distanceMeters / 1000) * 10) / 10
        : 0;
  const durationRaw = Number(order?.durationSeconds);
  const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : 0;
  const labeled = String(order?.distanceLabel || '').trim();
  const distanceLabel =
    labeled ||
    (distanceKm >= 1
      ? `${distanceKm} km`
      : distanceMeters > 0
        ? `${distanceMeters} m`
        : '');
  return {
    ...(distanceMeters > 0 ? { distanceMeters } : {}),
    ...(distanceKm > 0 ? { distanceKm } : {}),
    ...(durationSeconds > 0 ? { durationSeconds } : {}),
    ...(distanceLabel ? { distanceLabel } : {}),
  };
}

function shipmentPayload(order, orderId, shipment) {
  const parcelPhotoUrls = storedParcelPhotoUrls(order);
  const senderPhone = directSenderPhone(order);
  const senderName = directSenderName(order);
  const recipientName = directRecipientName(order);
  const recipientPhone = directRecipientPhone(order);
  const recipientAddress = directRecipientAddress(order);
  const cargoValue = declaredValueTzs(order);
  const distance = distanceFieldsFromOrder(order);
  return {
    orderId,
    orderNumber: order.orderNumber || order.parcelCode || orderId.slice(0, 6).toUpperCase(),
    parcelCode: order.parcelCode || order.orderNumber || '',
    userId: String(order.userId || '').trim(),
    customerName: senderName || order.customerName || '',
    senderName: senderName || order.customerName || '',
    customerPhone: senderPhone,
    senderPhone,
    recipientName,
    recipientPhone,
    recipientAddress,
    dropoffLabel: String(order.dropoffLabel || recipientAddress || '').trim(),
    ...(cargoValue > 0 ? { declaredValueTzs: cargoValue } : {}),
    pickupLabel: order.pickupLabel || '',
    pickupLatitude: order.pickupLatitude || null,
    pickupLongitude: order.pickupLongitude || null,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    parcelDescription: order.parcelTypeLabel || order.serviceLabel || 'Parcel',
    outsideParcelSize: String(order.outsideParcelSize || '').trim(),
    outsideShippingMode: String(order.outsideShippingMode || '').trim(),
    quoteStatus: String(order.quoteStatus || '').trim(),
    ...(parcelPhotoUrls.length ? { parcelPhotoUrls } : {}),
    ...distance,
    quantity: 1,
    weightKg: weightKg(order),
    cashExpected: moneyFromOrder(order),
    fareLabel: String(order.totalLabel || order.fareLabel || '').trim(),
    paymentMethod: 'cash',
    cashStatus: shipment?.cashStatus || 'unpaid',
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: shipment?.createdAt || FieldValue.serverTimestamp(),
    // Keep customer create time on the shipment so freshness checks survive order reads failing.
    orderCreatedAt:
      shipment?.orderCreatedAt ||
      order?.createdAt ||
      shipment?.createdAt ||
      FieldValue.serverTimestamp(),
  };
}

function customerBusView(shipment) {
  const status = normalize(shipment?.shipmentStatus);
  const step = String(shipment?.trackStep || '').trim();
  const pickupMode = String(shipment?.pickupMode || '').trim();
  const routeLabel = String(shipment?.routeLabel || '').trim();
  const done = step === 'handed' || status === 'delivered';
  const accepted =
    done ||
    Boolean(shipment?.carrierId) ||
    ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'].includes(status);
  const matchStatus = accepted ? 'accepted' : shipment?.offeredCarrierId || status === 'assigned' ? 'offered' : 'matching';
  return { matchStatus, routeLabel, pickupMode, trackStep: step, done };
}

async function resolveCustomerBusLabel(db, shipment) {
  let carrierBusName = String(shipment?.routeLabel || '').trim();
  const routeId = String(shipment?.routeId || '').trim();
  if (routeId) {
    const routeSnap = await db.collection('carrierRoutes').doc(routeId).get();
    if (routeSnap.exists) {
      const route = routeSnap.data() || {};
      const named = String(route.routeName || route.label || route.busName || '').trim();
      if (named) {
        carrierBusName = named;
      } else if (!carrierBusName && route.origin && route.destination) {
        carrierBusName = `${route.origin} → ${route.destination}`;
      }
    }
  }
  const carrierId = String(shipment?.carrierId || shipment?.offeredCarrierId || '').trim();
  if (!carrierBusName && carrierId) {
    const vehiclesSnap = await db
      .collection('carrierVehicles')
      .where('carrierId', '==', carrierId)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (!vehiclesSnap.empty) {
      const vehicle = vehiclesSnap.docs[0].data() || {};
      carrierBusName = String(vehicle.registration || vehicle.vehicleType || '').trim();
    }
  }
  return carrierBusName || FieldValue.delete();
}

async function resolveCustomerCarrierContact(db, shipment) {
  const carrierId = String(shipment?.carrierId || shipment?.offeredCarrierId || '').trim();
  const carrierBusName = await resolveCustomerBusLabel(db, shipment);
  if (!carrierId) {
    return {
      carrierName: FieldValue.delete(),
      carrierAgentName: FieldValue.delete(),
      carrierPhone: FieldValue.delete(),
      carrierBusName,
    };
  }
  const carrierSnap = await db.collection('carriers').doc(carrierId).get();
  if (!carrierSnap.exists) {
    return {
      carrierName: FieldValue.delete(),
      carrierAgentName: FieldValue.delete(),
      carrierPhone: FieldValue.delete(),
      carrierBusName,
    };
  }
  const carrier = carrierSnap.data() || {};
  const carrierName = String(carrier.companyName || '').trim();
  const carrierAgentName = String(carrier.contactPerson || carrier.companyName || '').trim();
  const carrierPhone = String(carrier.phone || '').trim();
  return {
    carrierName: carrierName || FieldValue.delete(),
    carrierAgentName: carrierAgentName || FieldValue.delete(),
    carrierPhone: carrierPhone || FieldValue.delete(),
    carrierBusName,
  };
}

async function mirrorBusOnOrder(db, orderId, shipment) {
  const orderRef = db.collection('orders').doc(orderId);
  const carrierContact = await resolveCustomerCarrierContact(db, shipment);
  const { forwardStage, trackStepForStage } = require('./order-stage');
  const { isCustomerCancelledRecord } = require('./carrier-cancel');
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return;
    const order = orderSnap.data() || {};
    if (isCustomerCancelledRecord(order) || isCustomerCancelledRecord(shipment)) {
      tx.set(
        orderRef,
        {
          haulStage: 'cancelled',
          carrierMatchStatus: 'cancelled',
          carrierTrackStep: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }
    if (!isBusParcel({ id: orderSnap.id, ...order })) return;
    const view = customerBusView(shipment);
    const stage = forwardStage(order, shipment);
    const trackStep = trackStepForStage(stage.haulStage, shipment);
    const patch = {
      carrierShipmentId: orderId,
      carrierMatchStatus: view.matchStatus,
      carrierRouteLabel: view.routeLabel,
      carrierPickupMode: view.pickupMode || FieldValue.delete(),
      haulStage: stage.haulStage,
      statusVersion: stage.statusVersion,
      stageUpdatedAt: FieldValue.serverTimestamp(),
      ...carrierContact,
    };
    if (trackStep) patch.carrierTrackStep = trackStep;
    if (view.matchStatus === 'matching' && stage.haulStage === 'new') {
      patch.carrierName = FieldValue.delete();
      patch.carrierAgentName = FieldValue.delete();
      patch.carrierPhone = FieldValue.delete();
      patch.carrierBusName = FieldValue.delete();
    }
    if (stage.haulStage === 'delivered' && order.status !== 'cancelled') {
      patch.status = 'delivered';
      patch.logisticsStatus = 'completed';
      patch.deliveredAt = FieldValue.serverTimestamp();
    }
    tx.set(orderRef, patch, { merge: true });
  });
}

let deskCache = { at: 0, stats: null };

function shipmentEventMs(data) {
  return expiryMs(data?.arrivedAt) || expiryMs(data?.deliveredAt) || 0;
}

/** Finished shipments and company reject/cancel decisions used for streak and fraud. */
async function loadDeskStats(db, carrierIds) {
  const now = Date.now();
  if (deskCache.stats && now - deskCache.at < 5000) return deskCache.stats;
  const [byStatus, byStep] = await Promise.all([
    db.collection('carrierShipments').where('shipmentStatus', 'in', ['arrived', 'delivered']).get(),
    db.collection('carrierShipments').where('trackStep', 'in', ['arrived', 'handed']).get(),
  ]);
  const times = new Map();
  const unpaid = new Map();
  const seen = new Set();
  const add = (doc) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    const data = doc.data() || {};
    const carrierId = String(data.carrierId || '');
    if (!carrierId) return;
    const list = times.get(carrierId) || [];
    list.push(shipmentEventMs(data));
    times.set(carrierId, list);
    const fee = Math.max(0, Math.round(Number(data.haulFee) || 0));
    if (fee <= 0) return;
    const reconciled = String(data.cashStatus || '').toLowerCase() === 'reconciled';
    const paid = reconciled
      ? fee
      : Math.min(fee, Math.max(0, Math.round(Number(data.commissionPaidTzs) || 0)));
    const due = fee - paid;
    if (due > 0) unpaid.set(carrierId, (unpaid.get(carrierId) || 0) + due);
  };
  byStatus.docs.forEach(add);
  byStep.docs.forEach(add);

  const breaks = new Map();
  await Promise.all(
    (carrierIds || []).map(async (id) => {
      const snap = await db
        .collection('carriers')
        .doc(id)
        .collection('decisions')
        .where('decision', 'in', ['rejected', 'cancelled_after_accept'])
        .get();
      const breakTimes = [];
      let postAccept = 0;
      let undated = false;
      snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        if (String(data.decision || '') === 'cancelled_after_accept') postAccept += 1;
        const ms = expiryMs(data.at) || Date.parse(String(data.atIso || '')) || 0;
        if (ms > 0) breakTimes.push(ms);
        else undated = true;
      });
      breaks.set(id, { breakTimes, postAccept, undated, docs: snap.size });
    })
  );
  const stats = { times, breaks, unpaid };
  deskCache = { at: now, stats };
  return stats;
}

function standingForCarrier(carrier, stats) {
  const completionTimes = stats.times.get(carrier.id) || [];
  const info = stats.breaks.get(carrier.id) || { breakTimes: [], postAccept: 0, undated: false, docs: 0 };
  const rejects = Math.max(info.docs, Math.floor(Number(carrier.rejected) || 0));
  return carrierStanding({
    streak: completionStreak(completionTimes, info.breakTimes, info.undated || rejects > info.docs),
    completed: completionTimes.length,
    rejects,
    postAcceptCancels: Math.max(info.postAccept, Math.floor(Number(carrier.postAcceptCancels) || 0)),
  });
}

async function persistFraudHold(db, carrier, standing) {
  const reason =
    standing.postAcceptCancels >= 3
      ? `${standing.postAcceptCancels} kufuta baada ya kukubali`
      : `Cancel ${standing.cancelPercent}%`;
  await db.collection('carriers').doc(carrier.id).set(
    {
      offersPaused: true,
      fraudHold: {
        reason,
        cancelPercent: standing.cancelPercent,
        postAcceptCancels: standing.postAcceptCancels,
        at: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
  try {
    const { config } = require('./config');
    const company = carrier.tradingName || carrier.companyName || carrier.name || carrier.id;
    await db.collection('adminNotifications').doc(`fraud_hold_${carrier.id}`).set(
      {
        type: 'carrier_fraud_hold',
        email: config.adminEmail,
        title: 'Akaunti ya kampuni isimame',
        message: `${company}: ofa zimesimamishwa. ${reason}. Akaunti haijafutwa. Ondoa fraudHold na offersPaused kuendelea.`,
        carrierId: carrier.id,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('fraud hold notice failed', carrier.id, error?.message || error);
  }
}

async function evaluateCarrierFraudHold(db, carrierId) {
  const id = String(carrierId || '').trim();
  if (!id) return { skipped: true };
  deskCache.at = 0;
  const snap = await db.collection('carriers').doc(id).get();
  if (!snap.exists) return { skipped: true };
  const carrier = { id, ...snap.data() };
  if (carrier.offersPaused || carrier.fraudHold) return { already: true };
  const stats = await loadDeskStats(db, [id]);
  const standing = standingForCarrier(carrier, stats);
  if (!standing.closure) return { held: false };
  await persistFraudHold(db, carrier, standing);
  return { held: true };
}

async function offerNext(db, orderId, order, shipmentHint, options = {}) {
  const started = Date.now();
  const preferCarrierIds =
    options.preferCarrierIds instanceof Set
      ? options.preferCarrierIds
      : options.preferCarrierIds
        ? new Set([...options.preferCarrierIds].map(String))
        : null;
  const loaded = await loadNetwork(db, { preferCarrierIds });
  const routesByCarrier = loaded.routesByCarrier;
  const vehiclesByCarrier = loaded.vehiclesByCarrier;
  const skipped = [...(loaded.skipped || [])];
  const openCarriers = [];
  for (const carrier of loaded.carriers || []) {
    openCarriers.push(await withVerifiedCoverage(db, carrier));
  }
  const evaluated = skipped.length + openCarriers.length;
  const stats = await loadDeskStats(db, openCarriers.map((carrier) => carrier.id));
  const standingByCarrier = new Map();
  const eligible = [];
  const now = Date.now();
  for (const carrier of openCarriers) {
    const standing = standingForCarrier(carrier, stats);
    if (standing.closure) {
      skipped.push({ id: carrier.id, reason: 'closure' });
      await persistFraudHold(db, carrier, standing).catch((error) => {
        console.error('fraud hold failed', carrier.id, error?.message || error);
      });
      continue;
    }
    const unpaidHaulFee = stats.unpaid?.get(carrier.id) || 0;
    if (unpaidHaulFee >= commissionPayCeiling(standing)) {
      skipped.push({ id: carrier.id, reason: 'commission-ceiling' });
      continue;
    }
    // Offers only reach companies with an active portal/session right now.
    if (!isCarrierLive(carrier, now, preferCarrierIds)) {
      skipped.push({ id: carrier.id, reason: 'offline' });
      continue;
    }
    standingByCarrier.set(carrier.id, standing);
    eligible.push(carrier);
  }
  let ranked = rankCarriers(order, eligible, routesByCarrier, vehiclesByCarrier, {
    standingByCarrier,
    unpaidByCarrier: stats.unpaid,
  });
  const rankedIds = new Set(ranked.map((entry) => entry.carrierId));
  for (const carrier of eligible) {
    if (rankedIds.has(carrier.id)) continue;
    const coverage = coverageForOrder(order, carrier);
    skipped.push({ id: carrier.id, reason: coverage.ok ? 'not-ranked' : coverage.reason });
  }
  if (preferCarrierIds && preferCarrierIds.size) {
    const live = ranked.filter((entry) => preferCarrierIds.has(entry.carrierId));
    if (live.length) ranked = live;
  }
  const ref = db.collection('carrierShipments').doc(orderId);
  const orderRef = db.collection('orders').doc(orderId);
  const { isCustomerCancelledRecord, customerCancelShipmentPatch } = require('./carrier-cancel');
  const {
    cancelIdempotencyKey,
    idempotencyDocId,
    offerIdempotencyKey,
    queueDeliveryEvent,
    shipmentBlocksOffer,
    waitIdempotencyKey,
  } = require('./order-reliability');

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const orderSnap = await tx.get(orderRef);
    const shipment = snap.exists ? snap.data() : shipmentHint || null;
    const liveOrder = orderSnap.exists ? { id: orderId, ...orderSnap.data() } : order;
    if (isCustomerCancelledRecord(liveOrder) || isCustomerCancelledRecord(shipment)) {
      const cancelKey = cancelIdempotencyKey(orderId);
      const cancelIdem = await tx.get(db.collection('idempotency').doc(idempotencyDocId(cancelKey)));
      const { patch } = customerCancelShipmentPatch(shipment, liveOrder);
      patch.reassignBlocked = true;
      patch.assignmentLocked = 'customer-cancel';
      if (cancelIdem.exists) delete patch.statusHistory;
      tx.set(ref, patch, { merge: true });
      if (!cancelIdem.exists) {
        const notifyCarrierId = String(shipment?.offeredCarrierId || shipment?.carrierId || '');
        queueDeliveryEvent(tx, db, {
          eventId: `cancel_${orderId}`,
          type: 'shipment.cancelled',
          idempotencyKey: cancelKey,
          orderId,
          carrierId: notifyCarrierId,
          payload: {
            carrierId: notifyCarrierId,
            orderNumber: String(liveOrder?.orderNumber || shipment?.orderNumber || ''),
          },
        });
      }
      return { skipped: true, reason: 'customer-cancelled' };
    }
    const blocked = shipmentBlocksOffer(shipment);
    if (blocked) return { skipped: true, reason: blocked === 'accepted' ? 'accepted' : blocked };
    if (offerIsOpen(shipment)) {
      return { skipped: true, reason: 'offer-open', carrierId: shipment.offeredCarrierId || null };
    }

    const declined = declinedCarrierIds(shipment);
    const chosen = pickExclusiveCarrier(ranked, declined);

    const base = shipmentPayload(order, orderId, shipment);
    const split = chosen ? cashSplit(base.cashExpected, chosen.haulFeeRate) : null;
    if (!chosen) {
      const alreadyWaiting =
        normalize(shipment?.shipmentStatus) === 'matching' &&
        !shipment?.offeredCarrierId &&
        !shipment?.carrierId;
      if (alreadyWaiting) {
        // Idempotent: cron / retries must not spam statusHistory or desk listeners.
        return { matched: false, skipped: true, reason: 'waiting-for-carrier' };
      }
      const waitKey = waitIdempotencyKey(orderId);
      const waitIdem = await tx.get(db.collection('idempotency').doc(idempotencyDocId(waitKey)));
      tx.set(
        ref,
        {
          ...base,
          shipmentStatus: 'matching',
          offeredCarrierId: null,
          offerExpiresAt: null,
          offerScore: null,
          routeId: null,
          routeLabel: '',
          capacityReserved: false,
          statusHistory: FieldValue.arrayUnion(historyEntry('matching', 'system')),
        },
        { merge: true }
      );
      if (!waitIdem.exists) {
        queueDeliveryEvent(tx, db, {
          eventId: `wait_${orderId}`,
          type: 'shipment.waiting',
          idempotencyKey: waitKey,
          orderId,
          payload: { orderNumber: String(base.orderNumber || '') },
        });
      }
      return { matched: false };
    }

    const epoch = Math.max(1, Math.round(Number(shipment?.offerEpoch) || 0) + 1);
    const offerKey = offerIdempotencyKey(orderId, epoch);
    const offerIdem = await tx.get(db.collection('idempotency').doc(idempotencyDocId(offerKey)));
    if (offerIdem.exists) {
      return {
        skipped: true,
        reason: 'duplicate-event',
        carrierId: String(offerIdem.data()?.carrierId || chosen.carrierId || ''),
      };
    }

    const expiresAt = Timestamp.fromMillis(Date.now() + OFFER_TIMEOUT_MS);
    tx.set(
      ref,
      {
        ...base,
        // Draft rate only — haulFee counts when the company accepts/takes the order.
        ...(split
          ? { haulFee: 0, carrierNet: split.amount || base.cashExpected || 0, haulFeeRate: split.haulFeeRate }
          : {}),
        shipmentStatus: 'assigned',
        pickupStatus: 'assigned',
        offerEpoch: epoch,
        offeredCarrierId: chosen.carrierId,
        offerScore: chosen.score,
        routeId: null,
        routeLabel: chosen.routeLabel,
        departureTime: FieldValue.delete(),
        arrivalTime: FieldValue.delete(),
        pickupMode: FieldValue.delete(),
        trackStep: FieldValue.delete(),
        offerExpiresAt: expiresAt,
        offeredAt: FieldValue.serverTimestamp(),
        capacityReserved: false,
        declinedCarrierIds: [...declined],
        statusHistory: FieldValue.arrayUnion(historyEntry('assigned', 'system')),
      },
      { merge: true }
    );
    tx.set(db.collection('carriers').doc(chosen.carrierId), { ordersReceived: FieldValue.increment(1) }, { merge: true });
    queueDeliveryEvent(tx, db, {
      eventId: `offer_${orderId}_${epoch}`,
      type: 'shipment.offered',
      idempotencyKey: offerKey,
      orderId,
      carrierId: chosen.carrierId,
      payload: {
        carrierId: chosen.carrierId,
        orderNumber: base.orderNumber || '',
        destination: base.destination || '',
        score: chosen.score || null,
      },
    });
    return {
      matched: true,
      carrierId: chosen.carrierId,
      score: chosen.score,
      routeLabel: chosen.routeLabel,
      orderNumber: base.orderNumber,
      destination: base.destination,
      offerExpiresAtMs: expiresAt.toMillis(),
    };
  });

  if (!result?.skipped && isBusParcel(order)) {
    await mirrorBusOnOrder(
      db,
      orderId,
      result.matched
        ? { shipmentStatus: 'assigned', offeredCarrierId: result.carrierId, routeLabel: result.routeLabel || '' }
        : { shipmentStatus: 'matching' }
    );
  }

  if (result?.matched && result.carrierId) {
    try {
      const { notifyCarrierNewOffer } = require('./carrier-push');
      await notifyCarrierNewOffer(db, {
        carrierId: result.carrierId,
        orderId,
        orderNumber: result.orderNumber,
        destination: result.destination,
        score: result.score,
      });
    } catch (error) {
      console.error('carrier offer push failed', orderId, error?.message || error);
    }

    // Offer is already saved. Persist smsJobs only — Mambo runs on the smsJobs trigger.
    const shipSnap = await ref.get().catch(() => null);
    const shipment = shipSnap?.exists
      ? { id: orderId, ...shipSnap.data() }
      : { id: orderId, ...(shipmentPayload(order, orderId, null) || {}) };
    const { sendCompanyOfferSms, sendSenderCompanyFoundSms } = require('./carrier-sms');
    await Promise.all([
      sendCompanyOfferSms(db, {
        orderId,
        shipment,
        carrierId: result.carrierId,
        order,
      }).catch((error) => {
        console.error('sms enqueue failed', {
          orderId,
          event: 'company_offer',
          reason: error?.message || String(error),
        });
      }),
      sendSenderCompanyFoundSms(db, {
        orderId,
        shipment,
        carrierId: result.carrierId,
        order,
      }).catch((error) => {
        console.error('sms enqueue failed', {
          orderId,
          event: 'company_found',
          reason: error?.message || String(error),
        });
      }),
    ]);
  }

  console.info('carrier match', {
    orderId,
    evaluated,
    live: eligible.length,
    skipped,
    assigned: result?.carrierId || null,
    reason: result?.reason || (result?.matched ? 'assigned' : 'none'),
    durationMs: Date.now() - started,
  });

  return result;
}

async function matchOrderById(db, orderId, options = {}) {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { skipped: true };
  const order = { id: orderSnap.id, ...orderSnap.data() };
  const shipmentSnap = await db.collection('carrierShipments').doc(orderId).get();
  const shipment = shipmentSnap.exists ? shipmentSnap.data() : null;
  const { isCustomerCancelledRecord, clearCarrierOfferOnCustomerCancel } = require('./carrier-cancel');
  if (isCustomerCancelledRecord(order) || isCustomerCancelledRecord(shipment)) {
    await clearCarrierOfferOnCustomerCancel(
      db,
      orderId,
      isCustomerCancelledRecord(order) ? order : { ...order, status: 'cancelled', cancelledBy: 'customer' },
      shipment
    );
    console.info('carrier match result', { orderId, matched: false, reason: 'customer-cancelled', carrierId: null, durationMs: 0 });
    return { skipped: true, reason: 'customer-cancelled' };
  }
  if (!isBusParcel(order)) return { skipped: true };
  const started = Date.now();
  console.info('order match start', {
    orderId,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    status: String(order.status || ''),
  });
  const finish = (result) => {
    console.info('carrier match result', {
      orderId,
      matched: Boolean(result?.matched),
      reason: result?.reason || (result?.matched ? 'assigned' : 'none'),
      carrierId: result?.carrierId || null,
      durationMs: Date.now() - started,
    });
    return result;
  };
  await persistSenderPhone(db, orderId, order, shipment);

  // Order document already exists. Queue party SMS; do not call Mambo or fail the match.
  await require('./carrier-sms')
    .sendOrderPlacedPartySms(db, { orderId, order, shipment })
    .catch((error) => {
      console.error('sms enqueue failed', {
        orderId,
        event: 'order_placed',
        reason: error?.message || String(error),
      });
    });

  await syncParcelPhotos(db, orderId, order, shipment);

  // Backfill party fields on any open / owned shipment that is missing them.
  if (shipment) {
    await copyDeclaredValue(db, orderId, order, shipment);
    const missingParty =
      !String(shipment.senderPhone || shipment.customerPhone || '').trim() ||
      !String(shipment.recipientName || '').trim() ||
      !String(shipment.recipientPhone || '').trim() ||
      !String(shipment.senderName || shipment.customerName || '').trim();
    if (missingParty) {
      const base = shipmentPayload(order, orderId, shipment);
      await db.collection('carrierShipments').doc(orderId).set(
        {
          customerName: base.customerName,
          senderName: base.senderName,
          customerPhone: base.customerPhone,
          senderPhone: base.senderPhone,
          recipientName: base.recipientName,
          recipientPhone: base.recipientPhone,
          recipientAddress: base.recipientAddress,
          dropoffLabel: base.dropoffLabel,
          userId: base.userId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      Object.assign(shipment, base);
    }
  }

  if (shipment?.carrierId) {
    return finish({ skipped: true, reason: 'accepted', carrierId: shipment.carrierId, matched: true, alreadyAccepted: true });
  }
  if (offerIsOpen(shipment)) {
    const holderId = String(shipment.offeredCarrierId || '').trim();
    const holderSnap = holderId ? await db.collection('carriers').doc(holderId).get() : null;
    const holder = holderSnap?.exists ? { id: holderId, ...holderSnap.data() } : null;
    if (!shouldReleaseOpenOffer(shipment, holder)) {
      return finish({
        skipped: true,
        reason: 'offer-open',
        matched: true,
        carrierId: holderId || null,
        orderNumber: shipment.orderNumber || order.orderNumber || '',
        destination: shipment.destination || '',
      });
    }
    console.info('carrier offer release', {
      orderId,
      carrierId: holderId,
      reason: accountBlockReason(holder) || 'ineligible',
    });
    await db.collection('carrierShipments').doc(orderId).set(
      {
        shipmentStatus: 'matching',
        offeredCarrierId: null,
        offerExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    shipment.offeredCarrierId = null;
    shipment.shipmentStatus = 'matching';
    shipment.offerExpiresAt = null;
  }
  return finish(await offerNext(db, orderId, order, shipment, options));
}

/** Pull only fresh waiting orders onto one approved desk that is live right now. */
async function claimOpenOffersForCarrier(db, carrierId) {
  const id = String(carrierId || '').trim();
  if (!id) return { claimed: 0, reason: 'missing' };
  const snap = await db.collection('carriers').doc(id).get();
  if (!snap.exists) return { claimed: 0, reason: 'missing' };
  const carrier = await withVerifiedCoverage(db, { id, ...snap.data() });
  const block = accountBlockReason(carrier);
  if (block) return { claimed: 0, reason: block };
  if (!isCarrierLive(carrier)) return { claimed: 0, reason: 'offline' };
  const waiting = await db.collection('carrierShipments').where('shipmentStatus', 'in', ['matching', 'assigned']).limit(30).get();
  let claimed = 0;
  let skippedStale = 0;
  for (const doc of waiting.docs) {
    const shipment = doc.data() || {};
    if (shipment.carrierId) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    const order = orderSnap.exists ? { id: orderSnap.id, ...orderSnap.data() } : null;
    if (!isFreshForOffer(order, shipment)) {
      skippedStale += 1;
      if (normalize(shipment.shipmentStatus) === 'matching' || (normalize(shipment.shipmentStatus) === 'assigned' && !shipment.carrierId)) {
        await parkStaleShipment(db, doc.id, shipment, 'stale-claim');
      }
      continue;
    }
    if (offerIsOpen(shipment)) {
      const holderId = String(shipment.offeredCarrierId || '').trim();
      if (!holderId || holderId === id) continue;
      const holderSnap = await db.collection('carriers').doc(holderId).get();
      const holder = holderSnap.exists ? { id: holderId, ...holderSnap.data() } : null;
      if (!shouldReleaseOpenOffer(shipment, holder)) continue;
    }
    const result = await matchOrderById(db, doc.id, { preferCarrierIds: new Set([id]) });
    if (result?.matched && String(result.carrierId || '') === id) claimed += 1;
    if (claimed >= 5) break;
  }
  console.info('carrier approval claim', { carrierId: id, claimed, skippedStale });
  return { claimed, skippedStale };
}

/** Accept an open parcel offer from the carrier WebSocket (same write as the agents desk). */
async function acceptCarrierOfferViaWs(db, orderId, carrierId, actorEmail = 'carrier-ws') {
  const ref = db.collection('carrierShipments').doc(orderId);
  const orderRef = db.collection('orders').doc(orderId);
  const {
    acceptDecision,
    acceptIdempotencyKey,
    cancelIdempotencyKey,
    idempotencyDocId,
    queueDeliveryEvent,
  } = require('./order-reliability');
  const { clearCarrierOfferOnCustomerCancel, customerCancelShipmentPatch } = require('./carrier-cancel');
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const missing = new Error('Mzigo haupatikani.');
      missing.code = 'missing';
      throw missing;
    }
    const current = snap.data() || {};
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.exists ? { id: orderId, ...orderSnap.data() } : null;
    const decision = acceptDecision(current, carrierId, Date.now(), order);
    if (!decision.ok && decision.reason === 'cancelled') {
      const cancelKey = cancelIdempotencyKey(orderId);
      const cancelIdem = await tx.get(db.collection('idempotency').doc(idempotencyDocId(cancelKey)));
      const { patch } = customerCancelShipmentPatch(current, order || { cancelledBy: 'customer', status: 'cancelled' });
      patch.reassignBlocked = true;
      patch.assignmentLocked = 'customer-cancel';
      if (cancelIdem.exists) delete patch.statusHistory;
      tx.set(ref, patch, { merge: true });
      if (!cancelIdem.exists) {
        const notifyCarrierId = String(current.offeredCarrierId || current.carrierId || '');
        queueDeliveryEvent(tx, db, {
          eventId: `cancel_${orderId}`,
          type: 'shipment.cancelled',
          idempotencyKey: cancelKey,
          orderId,
          carrierId: notifyCarrierId,
          payload: {
            carrierId: notifyCarrierId,
            orderNumber: String(order?.orderNumber || current.orderNumber || ''),
          },
        });
      }
      return { cancel: true, current, order };
    }
    if (!decision.ok && decision.already) return { already: true };
    if (!decision.ok && decision.reason === 'expired') {
      const expired = new Error('Muda umeisha.');
      expired.code = 'expired';
      throw expired;
    }
    if (!decision.ok) {
      const taken = new Error('Oda hii si yako tena.');
      taken.code = 'taken';
      throw taken;
    }
    const acceptKey = acceptIdempotencyKey(orderId);
    const idemSnap = await tx.get(db.collection('idempotency').doc(idempotencyDocId(acceptKey)));
    if (idemSnap.exists) {
      const prevCarrier = String(idemSnap.data()?.carrierId || '');
      if (prevCarrier && prevCarrier !== String(carrierId)) {
        const taken = new Error('Oda hii si yako tena.');
        taken.code = 'taken';
        throw taken;
      }
      return { already: true };
    }
    tx.set(
      ref,
      {
        carrierId,
        shipmentStatus: 'accepted',
        trackStep: 'received',
        pickupStatus: 'assigned',
        acceptedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'received',
          label: 'Imekubaliwa',
          at: new Date().toISOString(),
          actor: actorEmail || 'carrier-ws',
        }),
      },
      { merge: true }
    );
    tx.set(db.collection('carriers').doc(carrierId), { accepted: FieldValue.increment(1) }, { merge: true });
    queueDeliveryEvent(tx, db, {
      eventId: `accept_${orderId}`,
      type: 'shipment.accepted',
      idempotencyKey: acceptKey,
      orderId,
      carrierId,
      payload: { carrierId },
    });
    return { accepted: true, current };
  });
  if (outcome?.cancel) {
    await clearCarrierOfferOnCustomerCancel(
      db,
      orderId,
      outcome.order || { id: orderId, status: 'cancelled', cancelledBy: 'customer' },
      outcome.current
    );
    throw new Error('Mteja amefuta oda.');
  }
  if (outcome?.already) return { already: true };
  const fresh = await ref.get();
  await mirrorBusOnOrder(
    db,
    orderId,
    fresh.exists ? fresh.data() : { carrierId, shipmentStatus: 'accepted', trackStep: 'received' }
  );
  return { accepted: true, carrierId };
}

/** Reject an open parcel offer from the carrier WebSocket, then offer the next company. */
async function rejectCarrierOfferViaWs(db, orderId, carrierId, actorEmail = 'carrier-ws', options = {}) {
  const ref = db.collection('carrierShipments').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Mzigo haupatikani.');
  const current = snap.data() || {};
  if (current.carrierId) throw new Error('Oda imeshakubaliwa.');
  if (String(current.offeredCarrierId || '') !== String(carrierId) || normalize(current.shipmentStatus) !== 'assigned') {
    throw new Error('Oda hii si yako tena.');
  }

  const decisionRef = db.collection('carriers').doc(carrierId).collection('decisions').doc(orderId);
  const orderRef = db.collection('orders').doc(orderId);
  const {
    idempotencyDocId,
    queueDeliveryEvent,
    releaseIdempotencyKey,
    shipmentBlocksOffer,
  } = require('./order-reliability');
  const { isCustomerCancelledRecord } = require('./carrier-cancel');
  const released = await db.runTransaction(async (tx) => {
    const liveSnap = await tx.get(ref);
    if (!liveSnap.exists) throw new Error('Mzigo haupatikani.');
    const live = liveSnap.data() || {};
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.exists ? { id: orderId, ...orderSnap.data() } : null;
    if (isCustomerCancelledRecord(order) || isCustomerCancelledRecord(live) || shipmentBlocksOffer(live) === 'customer-cancelled') {
      return { cancelled: true, order, live };
    }
    if (live.carrierId) throw new Error('Oda imeshakubaliwa.');
    if (String(live.offeredCarrierId || '') !== String(carrierId) || normalize(live.shipmentStatus) !== 'assigned') {
      throw new Error('Oda hii si yako tena.');
    }
    const releaseKey = releaseIdempotencyKey(orderId, carrierId);
    const idemSnap = await tx.get(db.collection('idempotency').doc(idempotencyDocId(releaseKey)));
    if (idemSnap.exists) return { duplicate: true, order };
    tx.update(ref, {
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      pickupMode: FieldValue.delete(),
      trackStep: FieldValue.delete(),
      declinedCarrierIds: FieldValue.arrayUnion(carrierId),
      statusHistory: FieldValue.arrayUnion({
        status: 'matching',
        label: 'Imekataliwa',
        at: new Date().toISOString(),
        actor: actorEmail || 'carrier-ws',
      }),
    });
    tx.set(decisionRef, {
      shipmentId: orderId,
      decision: 'rejected',
      parcelCode: String(live.parcelCode || live.orderNumber || ''),
      destination: String(live.destination || ''),
      weightKg: Number(live.weightKg) || 0,
      actor: actorEmail || 'carrier-ws',
      atIso: new Date().toISOString(),
      at: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('carriers').doc(carrierId), { rejected: FieldValue.increment(1) }, { merge: true });
    queueDeliveryEvent(tx, db, {
      eventId: `release_${orderId}_${carrierId}`,
      type: 'shipment.released',
      idempotencyKey: releaseKey,
      orderId,
      carrierId,
      payload: { carrierId },
    });
    return { released: true, order };
  });
  if (released?.cancelled) {
    const { clearCarrierOfferOnCustomerCancel } = require('./carrier-cancel');
    await clearCarrierOfferOnCustomerCancel(
      db,
      orderId,
      released.order || { id: orderId, status: 'cancelled', cancelledBy: 'customer' },
      released.live
    );
    return { matched: false, rejected: false, reason: 'customer-cancelled' };
  }

  const order = released?.order || null;
  if (!order) return { matched: false, rejected: true };
  const next = await offerNext(db, orderId, order, { ...current, offeredCarrierId: null, shipmentStatus: 'matching' }, options);
  return { ...next, rejected: true, previousCarrierId: carrierId };
}

async function syncCarrierShipment(db, orderId, before, after) {
  if (!after) return { skipped: true };

  const { isCustomerCancelledRecord, clearCarrierOfferOnCustomerCancel } = require('./carrier-cancel');
  const cancelOrderSnap = await db.collection('orders').doc(orderId).get();
  const cancelOrder = cancelOrderSnap.exists ? { id: orderId, ...cancelOrderSnap.data() } : null;
  if (isCustomerCancelledRecord(cancelOrder) || isCustomerCancelledRecord(after)) {
    await clearCarrierOfferOnCustomerCancel(
      db,
      orderId,
      cancelOrder || {
        id: orderId,
        status: 'cancelled',
        cancelledBy: 'customer',
        cancellationReason: after.cancelReason || 'Customer cancelled',
      },
      after
    );
    return { skipped: true, reason: 'customer-cancelled' };
  }

  const beforeStatus = normalize(before?.shipmentStatus);
  const afterStatus = normalize(after.shipmentStatus);
  if (beforeStatus !== 'delivered' && afterStatus === 'delivered') {
    const { hasDeliveryProof } = require('./carrier-delivery-proof');
    const receipt = await db.collection('deliveryProofReceipts').doc(orderId).get();
    const proof = after.proofOfDelivery || {};
    const receiptOk = receipt.exists && String(receipt.data()?.method || '') === String(proof.method || '');
    if (!hasDeliveryProof({ ...after, id: orderId }) || !receiptOk) {
      await db.collection('carrierShipments').doc(orderId).set(
        {
          shipmentStatus: 'arrived',
          trackStep: 'arrived',
          deliveredAt: FieldValue.delete(),
          proofOfDelivery: FieldValue.delete(),
        },
        { merge: true }
      );
      return { reverted: true, reason: 'delivered-without-proof' };
    }
  }

  await mirrorBusOnOrder(db, orderId, after);

  try {
    const { maybeNotifyRecipientOnShipmentChange } = require('./carrier-sms');
    await maybeNotifyRecipientOnShipmentChange(db, orderId, before, after);
  } catch (error) {
    console.error('carrier recipient SMS hook failed', orderId, error?.message || error);
    const { isSmsBalanceError } = require('./sms-provider');
    const afterStep = normalize(after?.trackStep);
    const becameArrived = beforeStatus !== 'arrived' && (afterStatus === 'arrived' || afterStep === 'arrived');
    if (becameArrived && isSmsBalanceError(error)) {
      return { skipped: true, reason: 'sms_balance' };
    }
    if (becameArrived) {
      try {
        await db.collection('carrierShipments').doc(orderId).set(
          {
            arrivalSmsError: String(error?.message || 'Imeshindwa kutuma SMS.').slice(0, 180),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (writeError) {
        console.error('carrier arrival SMS error write failed', orderId, writeError?.message || writeError);
      }
    }
  }

  const previousCarrierId = String(before?.carrierId || before?.offeredCarrierId || '').trim();
  const droppedAccepted =
    String(before?.carrierId || '').trim() &&
    !after.carrierId &&
    afterStatus === 'matching' &&
    String(after.cancelledBy || '') !== 'customer';
  const rejectedOrReleased =
    (beforeStatus === 'assigned' && afterStatus === 'matching' && !after.carrierId) || droppedAccepted;
  if (rejectedOrReleased && previousCarrierId) {
    try {
      await evaluateCarrierFraudHold(db, previousCarrierId);
    } catch (error) {
      console.error('carrier fraud check failed', previousCarrierId, error?.message || error);
    }
  }
  if (!rejectedOrReleased) return { skipped: true };
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const liveOrder = orderSnap.exists ? { id: orderSnap.id, ...orderSnap.data() } : null;
  if (!isFreshForOffer(liveOrder, after)) {
    await parkStaleShipment(db, orderId, after, 'stale-rematch');
    return { skipped: true, reason: 'stale' };
  }
  return matchOrderById(db, orderId);
}

async function advanceCarrierOffers(db) {
  const [assignedSnap, waitingSnap] = await Promise.all([
    db.collection('carrierShipments').where('shipmentStatus', '==', 'assigned').limit(80).get(),
    db.collection('carrierShipments').where('shipmentStatus', '==', 'matching').limit(80).get(),
  ]);
  let advanced = 0;
  let swept = 0;
  const { isCustomerCancelledRecord, clearCarrierOfferOnCustomerCancel, releaseOpenCustomerCancelledOffers } = require('./carrier-cancel');
  const released = await releaseOpenCustomerCancelledOffers(db);
  // Expire silent/expired exclusive holds (including approved desks with null offerExpiresAt).
  // Unapproved holders are released without counting as a decline.
  for (const doc of assignedSnap.docs) {
    const shipment = { id: doc.id, ...(doc.data() || {}) };
    if (shipment.carrierId) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    const waitingOrder = orderSnap.exists ? { id: orderSnap.id, ...orderSnap.data() } : null;
    if (isCustomerCancelledRecord(waitingOrder) || isCustomerCancelledRecord(shipment)) {
      const cleared = await clearCarrierOfferOnCustomerCancel(
        db,
        doc.id,
        waitingOrder || {
          id: doc.id,
          status: 'cancelled',
          cancelledBy: 'customer',
          cancellationReason: shipment.cancelReason || 'Customer cancelled',
        },
        shipment
      );
      if (cleared?.cleared) swept += 1;
      continue;
    }
    const offeredNow = String(shipment.offeredCarrierId || '');
    const fresh = isFreshForOffer(waitingOrder, shipment);
    if (!fresh) {
      // Drop stale exclusive holds from desks; do not rematch / resurrect.
      const parked = await parkStaleShipment(db, doc.id, shipment, 'stale-assigned');
      if (parked?.parked) swept += 1;
      continue;
    }
    if (offeredNow && offerTimedOut(shipment)) {
      const declined = new Set((shipment.declinedCarrierIds || []).map((id) => String(id || '')));
      declined.add(offeredNow);
      console.info('carrier offer expired', {
        orderId: doc.id,
        carrierId: offeredNow,
        reason: 'offer-timeout',
        deadlineMs: offerDeadlineMs(shipment) || null,
      });
      await doc.ref.set(
        {
          shipmentStatus: 'matching',
          offeredCarrierId: null,
          offerExpiresAt: null,
          declinedCarrierIds: [...declined],
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion(historyEntry('matching', 'system-timeout')),
        },
        { merge: true }
      );
      swept += 1;
      // Timeout rematch only for fresh customer orders — never revive old piles.
      if (waitingOrder && isBusParcel(waitingOrder) && isFreshForOffer(waitingOrder, { ...shipment, offeredCarrierId: null })) {
        const result = await offerNext(db, doc.id, waitingOrder, {
          ...shipment,
          shipmentStatus: 'matching',
          offeredCarrierId: null,
          declinedCarrierIds: [...declined],
        });
        if (result?.matched) advanced += 1;
      }
      continue;
    }
    if (offeredNow && offerIsOpen(shipment)) {
      const holderSnap = await db.collection('carriers').doc(offeredNow).get();
      const holder = holderSnap.exists ? { id: offeredNow, ...holderSnap.data() } : null;
      if (shouldReleaseOpenOffer(shipment, holder)) {
        console.info('carrier offer release', {
          orderId: doc.id,
          carrierId: offeredNow,
          reason: accountBlockReason(holder) || 'ineligible',
        });
        await doc.ref.set(
          {
            shipmentStatus: 'matching',
            offeredCarrierId: null,
            offerExpiresAt: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        swept += 1;
        if (waitingOrder && isBusParcel(waitingOrder) && isFreshForOffer(waitingOrder, { ...shipment, offeredCarrierId: null })) {
          const result = await offerNext(db, doc.id, waitingOrder, {
            ...shipment,
            shipmentStatus: 'matching',
            offeredCarrierId: null,
          });
          if (result?.matched) advanced += 1;
        }
        continue;
      }
    }
    const declined = new Set((shipment.declinedCarrierIds || []).map((id) => String(id || '')));
    const offered = String(shipment.offeredCarrierId || '');
    if (!offered || !declined.has(offered)) continue;
    await doc.ref.set(
      {
        shipmentStatus: 'matching',
        offeredCarrierId: null,
        offerExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    swept += 1;
    if (!waitingOrder || !isBusParcel(waitingOrder) || !isFreshForOffer(waitingOrder, { ...shipment, offeredCarrierId: null })) continue;
    const result = await offerNext(db, doc.id, waitingOrder, {
      ...shipment,
      shipmentStatus: 'matching',
      offeredCarrierId: null,
    });
    if (result?.matched) advanced += 1;
  }
  for (const doc of waitingSnap.docs) {
    const shipment = { id: doc.id, ...(doc.data() || {}) };
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    if (!orderSnap.exists) continue;
    const waitingOrder = { id: orderSnap.id, ...orderSnap.data() };
    if (isCustomerCancelledRecord(waitingOrder) || isCustomerCancelledRecord(shipment)) {
      await clearCarrierOfferOnCustomerCancel(db, doc.id, waitingOrder, shipment);
      swept += 1;
      continue;
    }
    if (!isBusParcel(waitingOrder)) continue;
    let current = shipment;
    if (current.carrierId) continue;
    if (!isFreshForOffer(waitingOrder, current)) {
      const parked = await parkStaleShipment(db, doc.id, current, 'stale-matching');
      if (parked?.parked) swept += 1;
      continue;
    }
    if (current.offeredCarrierId && !offerIsOpen(current)) {
      const declined = new Set((current.declinedCarrierIds || []).map((id) => String(id || '')));
      declined.add(String(current.offeredCarrierId));
      current = { ...current, shipmentStatus: 'matching', offeredCarrierId: null, declinedCarrierIds: [...declined] };
      await doc.ref.set(
        {
          offeredCarrierId: null,
          offerExpiresAt: null,
          declinedCarrierIds: [...declined],
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      swept += 1;
    }
    if (current.offeredCarrierId) continue;
    const result = await offerNext(db, doc.id, waitingOrder, current);
    if (result?.matched) advanced += 1;
  }

  // Only fresh orphan creates (trigger miss) — never scan old pending_assignment piles.
  const orphanSince = Timestamp.fromMillis(Date.now() - FRESH_ORDER_MATCH_MS);
  const orphanOrdersSnap = await db
    .collection('orders')
    .where('flow', '==', 'parcel')
    .where('parcelScope', '==', 'outside')
    .where('status', '==', 'pending_assignment')
    .where('createdAt', '>=', orphanSince)
    .limit(30)
    .get()
    .catch(async () =>
      // Fallback if composite index is missing: scan a small page and filter in memory.
      db.collection('orders').where('flow', '==', 'parcel').where('parcelScope', '==', 'outside').where('status', '==', 'pending_assignment').limit(30).get()
    );
  const { shipmentAwaitingFirstOffer } = require('./order-reliability');
  for (const doc of orphanOrdersSnap.docs) {
    const order = { id: doc.id, ...doc.data() };
    if (!isBusParcel(order) || !isFreshForOffer(order, null)) continue;
    const shipmentSnap = await db.collection('carrierShipments').doc(doc.id).get();
    // A party-field shell is not an offer. Skipping every existing doc dropped orders
    // when the create trigger died after persistSenderPhone and before offerNext.
    if (shipmentSnap.exists && !shipmentAwaitingFirstOffer(shipmentSnap.data())) continue;
    const result = await matchOrderById(db, doc.id);
    if (result?.matched) advanced += 1;
  }

  // Backfill mtumaji/mpokeaji on open offers missing party fields.
  for (const doc of assignedSnap.docs) {
    const shipment = doc.data() || {};
    const missing =
      !String(shipment.senderPhone || shipment.customerPhone || '').trim() ||
      !String(shipment.recipientPhone || '').trim() ||
      !String(shipment.senderName || shipment.customerName || '').trim() ||
      !String(shipment.recipientName || '').trim();
    if (!missing) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    if (!orderSnap.exists) continue;
    const order = { id: orderSnap.id, ...orderSnap.data() };
    await persistSenderPhone(db, doc.id, order, shipment);
    advanced += 1;
  }

  advanced += await backfillOpenDeclaredValues(db);

  let outbox = { checked: 0, done: 0, dead: 0, failed: 0, skipped: 0 };
  try {
    const { drainOutbox } = require('./order-reliability');
    outbox = await drainOutbox(db);
  } catch (error) {
    console.error('outbox drain failed', error?.message || error);
  }

  return { advanced, swept, releasedCustomerCancels: released, outbox };
}

module.exports = {
  CAPACITY_HOLD_STATUSES,
  FRESH_ORDER_MATCH_MS,
  HAUL_FEE_RATE,
  MAX_OFFERS,
  NEW_DESK_FAIRNESS_BONUS,
  OFFER_TIMEOUT_MS,
  PORTAL_ONLINE_MS,
  SHIPMENT_FLOW,
  acceptCarrierOfferViaWs,
  accountBlockReason,
  accountCanTakeOffers,
  claimOpenOffersForCarrier,
  isCarrierLive,
  isFreshForOffer,
  offerDeadlineMs,
  offerIsOpen,
  offerTimedOut,
  parkStaleShipment,
  pickExclusiveCarrier,
  shouldReleaseOpenOffer,
  advanceCarrierOffers,
  cashSplit,
  carrierStanding,
  commissionPayCeiling,
  completionStreak,
  coverageForOrder,
  detectTzRegion,
  heldWeightByRoute,
  isBusParcel,
  looksInternational,
  matchOrderById,
  syncParcelPhotos,
  offerNext,
  rankCarriers,
  rejectCarrierOfferViaWs,
  declaredValueTzs,
  backfillOpenDeclaredValues,
  scoreCarrier,
  persistSenderPhone,
  resolveSenderPhone,
  shipmentPayload,
  storedParcelPhotoUrls,
  syncCarrierShipment,
};
