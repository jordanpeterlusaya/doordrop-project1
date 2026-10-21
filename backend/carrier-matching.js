const { FieldValue } = require('firebase-admin/firestore');

const OFFER_TIMEOUT_MS = 5 * 60 * 1000;
/** Bronze rate. Higher streak tiers use TIER_RULES. 20% is also the high-cancel rate. */
const HAUL_FEE_RATE = 0.2;
/**
 * Unpaid haulFee ceiling before new offers stop. Higher streak tiers can
 * owe more. The 20% cancel punishment uses the Bronze ceiling.
 * Keep identical to payCeilingTzs in haulcargo-agents-app/constants/carrier-desk.ts.
 * Active jobs are not touched.
 */
const TIER_RULES = [
  { id: 'bronze', minStreak: 0, feePercent: 20, feeRate: 0.2, priorityBonus: 0, payCeilingTzs: 30_000 },
  { id: 'silver', minStreak: 100, feePercent: 18, feeRate: 0.18, priorityBonus: 6, payCeilingTzs: 60_000 },
  { id: 'gold', minStreak: 250, feePercent: 17, feeRate: 0.17, priorityBonus: 16, payCeilingTzs: 100_000 },
  { id: 'platinum', minStreak: 500, feePercent: 15, feeRate: 0.15, priorityBonus: 40, payCeilingTzs: 150_000 },
];
const MAX_OFFERS = 3;
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
  const source = `${order.totalLabel || ''} ${order.fareLabel || ''}`.replace(/,/g, '');
  const match = source.match(/(\d+(?:\.\d+)?)/);
  if (match) return Math.round(Number(match[1]));
  const offer = Number(order.customerOffer || order.declaredValueTzs || 0);
  return Number.isFinite(offer) ? Math.round(offer) : 0;
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

function rankCarriers(order, carriers, routesByCarrier, vehiclesByCarrier, options = {}) {
  const completedByCarrier = options.completedByCarrier instanceof Map ? options.completedByCarrier : new Map();
  const standingByCarrier = options.standingByCarrier instanceof Map ? options.standingByCarrier : new Map();
  const unpaidByCarrier = options.unpaidByCarrier instanceof Map ? options.unpaidByCarrier : null;
  return (carriers || [])
    .filter((carrier) => normalize(carrier.status) === 'verified')
    .filter((carrier) => !carrier.offersPaused && !carrier.fraudHold)
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
    .slice(0, MAX_OFFERS);
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

function offerIsOpen(shipment, now = Date.now()) {
  if (!shipment || shipment.carrierId) return false;
  if (normalize(shipment.shipmentStatus) !== 'assigned' || !shipment.offeredCarrierId) return false;
  const expires = expiryMs(shipment.offerExpiresAt);
  return !expires || expires > now;
}

function declinedCarrierIds(shipment) {
  const declined = new Set(shipment?.declinedCarrierIds || []);
  if (shipment?.offeredCarrierId && !offerIsOpen(shipment)) declined.add(shipment.offeredCarrierId);
  return declined;
}

async function loadNetwork(db) {
  const [carrierSnap, routeSnap, vehicleSnap] = await Promise.all([
    db.collection('carriers').where('status', '==', 'verified').get(),
    db.collection('carrierRoutes').where('active', '==', true).get(),
    db.collection('carrierVehicles').where('status', '==', 'active').get(),
  ]);
  const carriers = carrierSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
  return { carriers, routesByCarrier, vehiclesByCarrier };
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

function shipmentPayload(order, orderId, shipment) {
  const parcelPhotoUrls = storedParcelPhotoUrls(order);
  const senderPhone = directSenderPhone(order);
  const senderName = directSenderName(order);
  const recipientName = directRecipientName(order);
  const recipientPhone = directRecipientPhone(order);
  const recipientAddress = directRecipientAddress(order);
  const cargoValue = declaredValueTzs(order);
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
    ...(parcelPhotoUrls.length ? { parcelPhotoUrls } : {}),
    quantity: 1,
    weightKg: weightKg(order),
    cashExpected: moneyFromOrder(order),
    fareLabel: String(order.totalLabel || order.fareLabel || '').trim(),
    paymentMethod: 'cash',
    cashStatus: shipment?.cashStatus || 'unpaid',
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: shipment?.createdAt || FieldValue.serverTimestamp(),
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
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists || !isBusParcel({ id: orderSnap.id, ...orderSnap.data() })) return;
  const view = customerBusView(shipment);
  const carrierContact = await resolveCustomerCarrierContact(db, shipment);
  const patch = {
    carrierShipmentId: orderId,
    carrierMatchStatus: view.matchStatus,
    carrierRouteLabel: view.routeLabel,
    carrierPickupMode: view.pickupMode || FieldValue.delete(),
    carrierTrackStep: view.trackStep || FieldValue.delete(),
    ...carrierContact,
  };
  if (view.matchStatus === 'matching') {
    patch.carrierName = FieldValue.delete();
    patch.carrierAgentName = FieldValue.delete();
    patch.carrierPhone = FieldValue.delete();
    patch.carrierBusName = FieldValue.delete();
  }
  if (view.done && orderSnap.data().status !== 'cancelled') {
    patch.status = 'delivered';
    patch.logisticsStatus = 'completed';
    patch.deliveredAt = FieldValue.serverTimestamp();
  }
  await orderSnap.ref.set(patch, { merge: true });
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
    if (String(data.cashStatus || '').toLowerCase() === 'reconciled') return;
    const fee = Math.max(0, Math.round(Number(data.haulFee) || 0));
    if (fee > 0) unpaid.set(carrierId, (unpaid.get(carrierId) || 0) + fee);
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

async function offerNext(db, orderId, order, shipmentHint) {
  const { carriers, routesByCarrier, vehiclesByCarrier } = await loadNetwork(db);
  const openCarriers = carriers.filter(
    (carrier) => normalize(carrier.status) === 'verified' && !carrier.offersPaused && !carrier.fraudHold
  );
  const stats = await loadDeskStats(db, openCarriers.map((carrier) => carrier.id));
  const standingByCarrier = new Map();
  const eligible = [];
  for (const carrier of openCarriers) {
    const standing = standingForCarrier(carrier, stats);
    if (standing.closure) {
      await persistFraudHold(db, carrier, standing).catch((error) => {
        console.error('fraud hold failed', carrier.id, error?.message || error);
      });
      continue;
    }
    const unpaidHaulFee = stats.unpaid?.get(carrier.id) || 0;
    if (unpaidHaulFee >= commissionPayCeiling(standing)) continue;
    standingByCarrier.set(carrier.id, standing);
    eligible.push(carrier);
  }
  const ranked = rankCarriers(order, eligible, routesByCarrier, vehiclesByCarrier, {
    standingByCarrier,
    unpaidByCarrier: stats.unpaid,
  });
  const ref = db.collection('carrierShipments').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const shipment = snap.exists ? snap.data() : shipmentHint || null;
    if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
    if (offerIsOpen(shipment)) return { skipped: true, reason: 'offer-open' };

    const declined = declinedCarrierIds(shipment);
    const chosen = ranked.find((entry) => !declined.has(entry.carrierId)) || null;

    const base = shipmentPayload(order, orderId, shipment);
    const split = chosen ? cashSplit(base.cashExpected, chosen.haulFeeRate) : null;
    if (!chosen) {
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
      return { matched: false };
    }

    tx.set(
      ref,
      {
        ...base,
        ...(split
          ? { haulFee: split.haulFee, carrierNet: split.carrierNet, haulFeeRate: split.haulFeeRate }
          : {}),
        shipmentStatus: 'assigned',
        pickupStatus: 'assigned',
        offeredCarrierId: chosen.carrierId,
        offerScore: chosen.score,
        routeId: null,
        routeLabel: chosen.routeLabel,
        departureTime: FieldValue.delete(),
        arrivalTime: FieldValue.delete(),
        pickupMode: FieldValue.delete(),
        trackStep: FieldValue.delete(),
        offerExpiresAt: new Date(Date.now() + OFFER_TIMEOUT_MS),
        offeredAt: FieldValue.serverTimestamp(),
        capacityReserved: false,
        declinedCarrierIds: [...declined],
        statusHistory: FieldValue.arrayUnion(historyEntry('assigned', 'system')),
      },
      { merge: true }
    );
    tx.set(db.collection('carriers').doc(chosen.carrierId), { ordersReceived: FieldValue.increment(1) }, { merge: true });
    return { matched: true, carrierId: chosen.carrierId, score: chosen.score, routeLabel: chosen.routeLabel, orderNumber: base.orderNumber, destination: base.destination };
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

    // Company + sender “kampuni imepatikana” SMS — never block matching.
    try {
      const shipSnap = await ref.get();
      const shipment = shipSnap.exists
        ? { id: orderId, ...shipSnap.data() }
        : { id: orderId, ...(shipmentPayload(order, orderId, null) || {}) };
      const { sendCompanyOfferSms, sendSenderCompanyFoundSms } = require('./carrier-sms');
      await sendCompanyOfferSms(db, {
        orderId,
        shipment,
        carrierId: result.carrierId,
        order,
      });
      await sendSenderCompanyFoundSms(db, {
        orderId,
        shipment,
        carrierId: result.carrierId,
        order,
      });
    } catch (error) {
      console.error('carrier offer SMS failed', orderId, error?.message || error);
    }
  }

  return result;
}

async function matchOrderById(db, orderId) {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { skipped: true };
  const order = { id: orderSnap.id, ...orderSnap.data() };
  if (!isBusParcel(order)) return { skipped: true };
  const shipmentSnap = await db.collection('carrierShipments').doc(orderId).get();
  const shipment = shipmentSnap.exists ? shipmentSnap.data() : null;
  await persistSenderPhone(db, orderId, order, shipment);

  // Sender + recipient SMS on place — idempotent; never blocks matching.
  try {
    const { sendOrderPlacedPartySms } = require('./carrier-sms');
    await sendOrderPlacedPartySms(db, { orderId, order, shipment });
  } catch (error) {
    console.error('order placed SMS failed', orderId, error?.message || error);
  }

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

  if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
  if (offerIsOpen(shipment)) return { skipped: true, reason: 'offer-open' };
  return offerNext(db, orderId, order, shipment);
}

async function syncCarrierShipment(db, orderId, before, after) {
  if (!after) return { skipped: true };

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
  return matchOrderById(db, orderId);
}

async function advanceCarrierOffers(db) {
  const [assignedSnap, waitingSnap] = await Promise.all([
    db.collection('carrierShipments').where('shipmentStatus', '==', 'assigned').limit(40).get(),
    db.collection('carrierShipments').where('shipmentStatus', '==', 'matching').limit(40).get(),
  ]);
  let advanced = 0;
  for (const doc of assignedSnap.docs) {
    const shipment = doc.data();
    const expires = expiryMs(shipment.offerExpiresAt);
    if (!expires || expires > Date.now() || shipment.carrierId) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    if (!orderSnap.exists) continue;
    const declined = declinedCarrierIds(shipment);
    await doc.ref.set(
      {
        declinedCarrierIds: [...declined],
        shipmentStatus: 'matching',
        offeredCarrierId: null,
        capacityReserved: false,
      },
      { merge: true }
    );
    await offerNext(db, doc.id, { id: orderSnap.id, ...orderSnap.data() }, {
      ...shipment,
      shipmentStatus: 'matching',
      offeredCarrierId: null,
      declinedCarrierIds: [...declined],
      capacityReserved: false,
    });
    advanced += 1;
  }
  for (const doc of waitingSnap.docs) {
    const shipment = doc.data();
    if (shipment.carrierId || shipment.offeredCarrierId) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    if (!orderSnap.exists || !isBusParcel(orderSnap.data())) continue;
    const result = await offerNext(db, doc.id, { id: orderSnap.id, ...orderSnap.data() }, shipment);
    if (result?.matched) advanced += 1;
  }

  // Orders whose create trigger never wrote carrierShipments stay invisible to the queries above.
  const orphanOrdersSnap = await db
    .collection('orders')
    .where('flow', '==', 'parcel')
    .where('parcelScope', '==', 'outside')
    .where('status', '==', 'pending_assignment')
    .limit(30)
    .get();
  for (const doc of orphanOrdersSnap.docs) {
    const order = { id: doc.id, ...doc.data() };
    if (!isBusParcel(order)) continue;
    const shipmentSnap = await db.collection('carrierShipments').doc(doc.id).get();
    if (shipmentSnap.exists) continue;
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

  return { advanced };
}

module.exports = {
  CAPACITY_HOLD_STATUSES,
  HAUL_FEE_RATE,
  OFFER_TIMEOUT_MS,
  SHIPMENT_FLOW,
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
  rankCarriers,
  declaredValueTzs,
  backfillOpenDeclaredValues,
  scoreCarrier,
  persistSenderPhone,
  resolveSenderPhone,
  shipmentPayload,
  storedParcelPhotoUrls,
  syncCarrierShipment,
};
