const { FieldValue } = require('firebase-admin/firestore');

const OFFER_TIMEOUT_MS = 5 * 60 * 1000;
const HAUL_FEE_RATE = 0.2;
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

function scoreCarrier(order, carrier, routes, vehicles) {
  void routes;
  const coverage = coverageForOrder(order, carrier);
  if (!coverage.ok) return null;

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
  score = Math.max(1, Math.min(99, score));
  return {
    carrierId: carrier.id,
    companyName: carrier.companyName || '',
    score,
    routeId: '',
    routeLabel: `${origin} → ${destination}`,
    remainingKg: 0,
    departureTime: '',
    arrivalTime: '',
    coverageReason: coverage.reason,
  };
}

function rankCarriers(order, carriers, routesByCarrier, vehiclesByCarrier, options = {}) {
  return (carriers || [])
    .filter((carrier) => normalize(carrier.status) === 'verified')
    .map((carrier) =>
      scoreCarrier(
        order,
        carrier,
        routesByCarrier.get(carrier.id) || [],
        vehiclesByCarrier.get(carrier.id) || [],
        options
      )
    )
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.carrierId.localeCompare(right.carrierId))
    .slice(0, MAX_OFFERS);
}

function cashSplit(amount) {
  const haulFee = Math.round(amount * HAUL_FEE_RATE);
  return {
    amount,
    haulFee,
    carrierNet: amount - haulFee,
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
  const parsed = Number(String(order?.declaredValueTzs ?? order?.declaredValue ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
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

/** Profile phone when the parcel order was saved without the sender number. */
async function resolveSenderPhone(db, order) {
  const direct = directSenderPhone(order);
  if (direct) return direct;
  const userId = String(order?.userId || '').trim();
  if (!userId || userId.startsWith('manual:')) return '';
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return '';
    const data = snap.data() || {};
    return String(data.phoneNumber || data.phone || '').trim();
  } catch {
    return '';
  }
}

/**
 * Write the cargo sender number onto the customer order and the carrier shipment.
 * SMS and the agents order screen both read senderPhone / customerPhone.
 */
async function persistSenderPhone(db, orderId, order, shipment) {
  const phone = await resolveSenderPhone(db, order);
  if (!phone) return '';

  const orderCustomer = String(order?.customerPhone || '').trim();
  const orderSender = String(order?.senderPhone || '').trim();
  if (!orderCustomer || !orderSender) {
    await db.collection('orders').doc(orderId).set(
      {
        customerPhone: orderCustomer || phone,
        senderPhone: orderSender || phone,
      },
      { merge: true }
    );
    order.customerPhone = orderCustomer || phone;
    order.senderPhone = orderSender || phone;
  }

  if (shipment) {
    const shipCustomer = String(shipment.customerPhone || '').trim();
    const shipSender = String(shipment.senderPhone || '').trim();
    if (!shipCustomer || !shipSender) {
      const customerPhone = shipCustomer || phone;
      const senderPhone = shipSender || phone;
      await db.collection('carrierShipments').doc(orderId).set(
        {
          customerPhone,
          senderPhone,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      shipment.customerPhone = customerPhone;
      shipment.senderPhone = senderPhone;
    }
  }

  return phone;
}

function shipmentPayload(order, orderId, shipment) {
  const split = cashSplit(moneyFromOrder(order));
  const parcelPhotoUrls = storedParcelPhotoUrls(order);
  const senderPhone = directSenderPhone(order);
  return {
    orderId,
    orderNumber: order.orderNumber || order.parcelCode || orderId.slice(0, 6).toUpperCase(),
    parcelCode: order.parcelCode || order.orderNumber || '',
    customerName: order.customerName || '',
    customerPhone: senderPhone,
    senderPhone,
    recipientName: order.recipientName || '',
    recipientPhone: order.recipientPhone || '',
    declaredValueTzs: declaredValueTzs(order),
    pickupLabel: order.pickupLabel || '',
    pickupLatitude: order.pickupLatitude || null,
    pickupLongitude: order.pickupLongitude || null,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    parcelDescription: order.parcelTypeLabel || order.serviceLabel || 'Parcel',
    ...(parcelPhotoUrls.length ? { parcelPhotoUrls } : {}),
    quantity: 1,
    weightKg: weightKg(order),
    cashExpected: split.amount,
    haulFee: split.haulFee,
    carrierNet: split.carrierNet,
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

async function offerNext(db, orderId, order, shipmentHint) {
  const { carriers, routesByCarrier, vehiclesByCarrier } = await loadNetwork(db);
  const ranked = rankCarriers(order, carriers, routesByCarrier, vehiclesByCarrier);
  const ref = db.collection('carrierShipments').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const shipment = snap.exists ? snap.data() : shipmentHint || null;
    if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
    if (offerIsOpen(shipment)) return { skipped: true, reason: 'offer-open' };

    const declined = declinedCarrierIds(shipment);
    const chosen = ranked.find((entry) => !declined.has(entry.carrierId)) || null;

    const base = shipmentPayload(order, orderId, shipment);
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

  const rejectedOrReleased = beforeStatus === 'assigned' && afterStatus === 'matching' && !after.carrierId;
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

  return { advanced };
}

module.exports = {
  CAPACITY_HOLD_STATUSES,
  HAUL_FEE_RATE,
  OFFER_TIMEOUT_MS,
  SHIPMENT_FLOW,
  advanceCarrierOffers,
  cashSplit,
  coverageForOrder,
  detectTzRegion,
  heldWeightByRoute,
  isBusParcel,
  looksInternational,
  matchOrderById,
  rankCarriers,
  declaredValueTzs,
  scoreCarrier,
  persistSenderPhone,
  resolveSenderPhone,
  shipmentPayload,
  storedParcelPhotoUrls,
  syncCarrierShipment,
};
