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

function scoreCarrier(order, carrier, routes, vehicles, options = {}) {
  const destination = orderDestination(order);
  const origin = orderOrigin(order);
  if (!normalize(destination)) return null;
  const weight = weightKg(order);
  const dayName = serviceDayName(order, options.now);
  const usedByRoute = options.usedByRoute || new Map();
  const activeRoutes = (routes || []).filter((route) => route.active !== false);
  const fitting = activeRoutes.filter((route) => {
    if (!placesMatch(route.destination, destination)) return false;
    if (origin && !placesMatch(route.origin, origin)) return false;
    if (!routeOperatesOn(route, dayName)) return false;
    return routeCanTake(route, weight, usedByRoute);
  });
  if (!fitting.length) return null;
  fitting.sort((left, right) => remainingCapacityKg(right, usedByRoute) - remainingCapacityKg(left, usedByRoute));
  const matchingRoute = fitting[0];
  const remaining = remainingCapacityKg(matchingRoute, usedByRoute);
  const limit = Number(matchingRoute.cargoCapacityKg) || 0;

  let score = 48;
  if (origin && placesMatch(matchingRoute.origin, origin)) score += 18;
  if (isDarHub(origin) && (matchingRoute.pickupKariakoo || isDarHub(matchingRoute.origin) || isDarHub(carrier.location))) {
    score += 12;
  }
  score += 10;
  score += 8;
  if (matchingRoute.departureTime) score += 4;
  if (limit > 0) score += Math.min(6, Math.round((remaining / limit) * 6));
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
    routeId: matchingRoute.id,
    routeLabel: `${matchingRoute.origin} → ${matchingRoute.destination}`,
    remainingKg: remaining,
    departureTime: matchingRoute.departureTime || '',
    arrivalTime: matchingRoute.arrivalTime || '',
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

function shipmentPayload(order, orderId, shipment) {
  const split = cashSplit(moneyFromOrder(order));
  return {
    orderId,
    orderNumber: order.orderNumber || order.parcelCode || orderId.slice(0, 6).toUpperCase(),
    parcelCode: order.parcelCode || order.orderNumber || '',
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    recipientName: order.recipientName || '',
    recipientPhone: order.recipientPhone || '',
    declaredValueTzs: declaredValueTzs(order),
    pickupLabel: order.pickupLabel || '',
    pickupLatitude: order.pickupLatitude || null,
    pickupLongitude: order.pickupLongitude || null,
    origin: orderOrigin(order),
    destination: orderDestination(order),
    parcelDescription: order.parcelTypeLabel || order.serviceLabel || 'Parcel',
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

async function mirrorBusOnOrder(db, orderId, shipment) {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists || !isBusParcel({ id: orderSnap.id, ...orderSnap.data() })) return;
  const view = customerBusView(shipment);
  const patch = {
    carrierShipmentId: orderId,
    carrierMatchStatus: view.matchStatus,
    carrierRouteLabel: view.routeLabel,
    carrierPickupMode: view.pickupMode || FieldValue.delete(),
    carrierTrackStep: view.trackStep || FieldValue.delete(),
  };
  if (view.done && orderSnap.data().status !== 'cancelled') {
    patch.status = 'delivered';
    patch.logisticsStatus = 'completed';
    patch.deliveredAt = FieldValue.serverTimestamp();
  }
  await orderSnap.ref.set(patch, { merge: true });
}

async function offerNext(db, orderId, order, shipmentHint) {
  const weight = weightKg(order);
  const { carriers, routesByCarrier, vehiclesByCarrier } = await loadNetwork(db);
  const usedByRoute = await loadHeldWeight(db, orderId);
  const ranked = rankCarriers(order, carriers, routesByCarrier, vehiclesByCarrier, { usedByRoute });
  const ref = db.collection('carrierShipments').doc(orderId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const shipment = snap.exists ? snap.data() : shipmentHint || null;
    if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
    if (offerIsOpen(shipment)) return { skipped: true, reason: 'offer-open' };

    const declined = declinedCarrierIds(shipment);
    const candidates = ranked.filter((entry) => !declined.has(entry.carrierId));
    const routeSnaps = [];
    for (const entry of candidates) {
      routeSnaps.push(await tx.get(db.collection('carrierRoutes').doc(entry.routeId)));
    }

    let chosen = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const routeSnap = routeSnaps[index];
      const route = routeSnap.exists ? { id: routeSnap.id, ...routeSnap.data() } : null;
      if (!route || route.active === false) continue;
      const summed = usedByRoute.get(route.id) || 0;
      if (!routeCanTake(route, weight, new Map([[route.id, summed]]))) continue;
      chosen = { ...candidates[index], routeLabel: `${route.origin} → ${route.destination}` };
      break;
    }

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
        routeId: chosen.routeId,
        routeLabel: chosen.routeLabel,
        departureTime: chosen.departureTime || '',
        arrivalTime: chosen.arrivalTime || '',
        pickupMode: FieldValue.delete(),
        trackStep: FieldValue.delete(),
        offerExpiresAt: new Date(Date.now() + OFFER_TIMEOUT_MS),
        offeredAt: FieldValue.serverTimestamp(),
        capacityReserved: true,
        declinedCarrierIds: [...declined],
        statusHistory: FieldValue.arrayUnion(historyEntry('assigned', 'system')),
      },
      { merge: true }
    );
    tx.set(db.collection('carriers').doc(chosen.carrierId), { ordersReceived: FieldValue.increment(1) }, { merge: true });
    tx.set(db.collection('carriers').doc(chosen.carrierId).collection('notifications').doc(), {
      title: 'New assignment',
      body: `${base.orderNumber} · ${base.destination} · ${chosen.score}% match`,
      orderId,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
    });
    return { matched: true, carrierId: chosen.carrierId, score: chosen.score, routeLabel: chosen.routeLabel };
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
  return result;
}

async function matchOrderById(db, orderId) {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) return { skipped: true };
  const order = { id: orderSnap.id, ...orderSnap.data() };
  if (!isBusParcel(order)) return { skipped: true };
  const shipmentSnap = await db.collection('carrierShipments').doc(orderId).get();
  const shipment = shipmentSnap.exists ? shipmentSnap.data() : null;
  if (shipment?.carrierId) return { skipped: true, reason: 'accepted' };
  if (offerIsOpen(shipment)) return { skipped: true, reason: 'offer-open' };
  return offerNext(db, orderId, order, shipment);
}

async function syncCarrierShipment(db, orderId, before, after) {
  if (!after) return { skipped: true };
  await mirrorBusOnOrder(db, orderId, after);
  const beforeStatus = normalize(before?.shipmentStatus);
  const afterStatus = normalize(after.shipmentStatus);

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
  heldWeightByRoute,
  isBusParcel,
  matchOrderById,
  rankCarriers,
  declaredValueTzs,
  scoreCarrier,
  shipmentPayload,
  syncCarrierShipment,
};
