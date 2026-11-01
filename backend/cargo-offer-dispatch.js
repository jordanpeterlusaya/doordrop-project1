/**
 * Instant cargo assignment for the post-vehicle-picker screen.
 * Toyo Electric and fuel TOYO share the TOYO driver pool. Kirikuu has its own.
 * The quoted fare already on the order is left unchanged.
 */

const { FieldValue } = require('firebase-admin/firestore');
const { cellsNear } = require('./geohash');

const DRIVER_QUERY_LIMIT = 32;
const GEOHASH_PRECISION = 6;

class CargoOfferError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CargoOfferError';
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function distanceMeters(start, end) {
  const earth = 6371000;
  const dLat = ((end.latitude - start.latitude) * Math.PI) / 180;
  const dLng = ((end.longitude - start.longitude) * Math.PI) / 180;
  const lat1 = (start.latitude * Math.PI) / 180;
  const lat2 = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function orderPool(order) {
  const key = text(order.cargoVehicleKey).toLowerCase();
  return key === 'kirikuu' ? 'kirikuu' : 'toyo';
}

function driverPool(driver) {
  const key = text(driver.vehicleType).toLowerCase();
  if (key === 'kirikuu') return 'kirikuu';
  if (key === 'toyo') return 'toyo';
  return '';
}

function isVerified(driver) {
  const status = text(driver.verificationStatus).toLowerCase();
  return status !== 'pending_admin_verification' && status !== 'rejected';
}

function pickupPoint(order) {
  const latitude = Number(order.pickupLatitude);
  const longitude = Number(order.pickupLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function driverPoint(driver, livePoints) {
  const live = livePoints?.get(driver.id);
  const latitude = Number(live?.latitude ?? driver.currentLatitude);
  const longitude = Number(live?.longitude ?? driver.currentLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const heading = Number(live?.heading ?? driver.currentHeading);
  return {
    latitude,
    longitude,
    heading: Number.isFinite(heading) ? heading : undefined,
  };
}

function declinedIds(order) {
  return new Set(Array.isArray(order.declinedDriverIds) ? order.declinedDriverIds.map((id) => text(id)) : []);
}

function fareTzs(order) {
  const offer = Number(order.customerOffer);
  if (Number.isFinite(offer) && offer > 0) return Math.round(offer);
  const label = text(order.totalLabel || order.fareLabel).replace(/[^\d]/g, '');
  const parsed = Number(label);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicDriver(driver, point) {
  if (!driver || !point) return null;
  return {
    id: driver.id,
    name: text(driver.fullName),
    vehicleType: driverPool(driver),
    vehicleLabel: text(driver.vehicleLabel),
    latitude: point.latitude,
    longitude: point.longitude,
    heading: point.heading,
  };
}

function customerView(state, order, driver, point, extra = {}) {
  return {
    state,
    orderId: order.id,
    nearbyCount: Math.max(0, Number(extra.nearbyCount) || 0),
    fareLabel: text(order.totalLabel || order.fareLabel),
    fareTzs: fareTzs(order),
    vehicleKey: text(order.cargoVehicleKey),
    vehicleLabel: text(order.cargoVehicleLabel || order.serviceLabel),
    reassigned: Boolean(extra.reassigned),
    driver: publicDriver(driver, point),
  };
}

function wireOrder(order, driver) {
  return {
    id: order.id,
    orderNumber: text(order.orderNumber),
    userId: text(order.userId),
    customerName: text(order.customerName) || 'HAUL',
    customerEmail: text(order.customerEmail),
    customerPhone: text(order.customerPhone),
    serviceLabel: text(order.serviceLabel || order.cargoVehicleLabel) || 'Cargo',
    status: text(order.status) || 'driver_assigned',
    pickupLabel: text(order.pickupLabel),
    dropoffLabel: text(order.dropoffLabel),
    pickupLatitude: numberOrUndefined(order.pickupLatitude),
    pickupLongitude: numberOrUndefined(order.pickupLongitude),
    dropoffLatitude: numberOrUndefined(order.dropoffLatitude),
    dropoffLongitude: numberOrUndefined(order.dropoffLongitude),
    etaLabel: text(order.etaLabel),
    fareLabel: text(order.fareLabel),
    totalLabel: text(order.totalLabel || order.fareLabel),
    fareType: 'negotiated',
    cargoDispatch: 'instant',
    customerOffer: fareTzs(order),
    minFare: numberOrUndefined(order.minFare),
    negotiationStatus: text(order.negotiationStatus) || 'open',
    cargoVehicleKey: text(order.cargoVehicleKey),
    cargoVehicleLabel: text(order.cargoVehicleLabel),
    flow: 'cargo',
    scheduleLabel: text(order.scheduleLabel),
    recipientName: text(order.recipientName || order.customerName),
    recipientPhone: text(order.recipientPhone || order.customerPhone),
    driverId: text(driver?.id || order.driverId),
    driverName: text(driver?.fullName || order.driverName),
    acceptedByDriverAt: order.acceptedByDriverAt ? true : undefined,
  };
}

async function readOrder(db, orderId) {
  const snapshot = await db.collection('orders').doc(orderId).get();
  if (!snapshot.exists) {
    throw new CargoOfferError('not_found', 'Order was not found.');
  }
  return { id: snapshot.id, ...snapshot.data() };
}

function assertInstantCustomerOrder(order, customerUid) {
  if (text(order.userId) !== text(customerUid)) {
    throw new CargoOfferError('forbidden', 'This order belongs to another customer.');
  }
  if (text(order.flow).toLowerCase() !== 'cargo' || text(order.cargoDispatch) !== 'instant') {
    throw new CargoOfferError('invalid_order', 'This order is not an instant cargo verify.');
  }
}

async function loadCandidateDrivers(db, order, connectedIds) {
  const pickup = pickupPoint(order);
  const byId = new Map();
  const absorb = (rows) => {
    rows.forEach((driver) => {
      if (driver?.id) byId.set(driver.id, driver);
    });
  };

  if (pickup) {
    const cells = cellsNear(pickup.latitude, pickup.longitude, GEOHASH_PRECISION).slice(0, 9);
    if (cells.length) {
      try {
        const snapshot = await db
          .collection('drivers')
          .where('isAvailable', '==', true)
          .where('geohash', 'in', cells)
          .limit(DRIVER_QUERY_LIMIT)
          .get();
        absorb(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.warn('[cargo-offer] geohash driver query failed', error instanceof Error ? error.message : error);
      }
    }
  }

  if (!byId.size) {
    const snapshot = await db.collection('drivers').where('isAvailable', '==', true).limit(DRIVER_QUERY_LIMIT).get();
    absorb(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }

  const missing = [...connectedIds].filter((id) => !byId.has(id)).slice(0, 30);
  if (missing.length) {
    const snaps = await db.getAll(...missing.map((id) => db.collection('drivers').doc(id)));
    absorb(snaps.filter((item) => item.exists).map((item) => ({ id: item.id, ...item.data() })));
  }

  return [...byId.values()];
}

function rankCandidates(order, drivers, connectedIds, livePoints) {
  const pickup = pickupPoint(order);
  const pool = orderPool(order);
  const declined = declinedIds(order);
  if (!pickup) return [];

  return drivers
    .map((driver) => {
      const point = driverPoint(driver, livePoints);
      if (!point || !connectedIds.has(driver.id) || declined.has(driver.id)) return null;
      if (!isVerified(driver) || driver.isAvailable !== true || text(driver.currentOrderId)) return null;
      if (!isFresh(driver) || driverPool(driver) !== pool) return null;
      return { driver, point, distance: distanceMeters(point, pickup) };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance);
}

async function writeAssignment(db, orderId, candidate) {
  const { driver, point } = candidate;
  await db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(orderId);
    const driverRef = db.collection('drivers').doc(driver.id);
    const [orderSnap, driverSnap] = await Promise.all([transaction.get(orderRef), transaction.get(driverRef)]);
    if (!orderSnap.exists || !driverSnap.exists) {
      throw new CargoOfferError('not_found', 'Order or driver disappeared.');
    }
    const order = { id: orderSnap.id, ...orderSnap.data() };
    const freshDriver = { id: driverSnap.id, ...driverSnap.data() };
    if (text(order.status) === 'cancelled') {
      throw new CargoOfferError('cancelled', 'This order was cancelled.');
    }
    if (order.acceptedByDriverAt) {
      throw new CargoOfferError('accepted', 'The driver already verified.');
    }
    if (text(order.driverId) && text(order.driverId) !== freshDriver.id) {
      throw new CargoOfferError('taken', 'Another driver is already on this order.');
    }
    if (text(freshDriver.currentOrderId) && text(freshDriver.currentOrderId) !== orderId) {
      throw new CargoOfferError('busy', 'This driver just took another order.');
    }
    if (freshDriver.isAvailable !== true && text(freshDriver.currentOrderId) !== orderId) {
      throw new CargoOfferError('busy', 'This driver is not available.');
    }

    transaction.set(
      orderRef,
      {
        status: 'driver_assigned',
        driverId: freshDriver.id,
        driverName: text(freshDriver.fullName),
        driverPhone: text(freshDriver.phoneNumber),
        driverVehicleType: driverPool(freshDriver),
        driverVehicleLabel: text(freshDriver.vehicleLabel) || (driverPool(freshDriver) === 'kirikuu' ? 'Kirikuu' : 'TOYO'),
        driverPlateNumber: text(freshDriver.plateNumber),
        driverLatitude: point.latitude,
        driverLongitude: point.longitude,
        driverHeading: point.heading ?? FieldValue.delete(),
        assignmentMode: 'cargo_socket',
        driverSearchStatus: 'assigned',
        driverSearchMessage: 'Dereva yuko karibu, anasubiri kuthibitisha.',
        driverSearchResolvedAt: FieldValue.serverTimestamp(),
        assignedAt: order.assignedAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      driverRef,
      {
        isAvailable: false,
        currentOrderId: orderId,
        assignmentCount: FieldValue.increment(1),
        lastAssignedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

function clearDriverFields() {
  return {
    driverId: FieldValue.delete(),
    driverName: FieldValue.delete(),
    driverPhone: FieldValue.delete(),
    driverVehicleType: FieldValue.delete(),
    driverVehicleLabel: FieldValue.delete(),
    driverPlateNumber: FieldValue.delete(),
    driverLatitude: FieldValue.delete(),
    driverLongitude: FieldValue.delete(),
    driverHeading: FieldValue.delete(),
    acceptedByDriverAt: FieldValue.delete(),
    assignedAt: FieldValue.delete(),
  };
}

async function releaseDriver(db, driverId, orderId) {
  if (!driverId) return;
  await db.collection('drivers').doc(driverId).set(
    {
      isAvailable: true,
      currentOrderId: '',
      rejectionCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (orderId) {
    await db.collection('orders').doc(orderId).set(
      {
        status: 'pending_assignment',
        driverSearchStatus: 'waiting_for_driver',
        declinedDriverIds: FieldValue.arrayUnion(driverId),
        lastDeclinedByDriverId: driverId,
        lastDeclinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...clearDriverFields(),
      },
      { merge: true }
    );
  }
}

async function markNoDriver(db, order, message) {
  await db.collection('orders').doc(order.id).set(
    {
      status: 'pending_assignment',
      driverSearchStatus: 'waiting_for_driver',
      driverSearchMessage: message,
      noNearbyDriverAt: FieldValue.serverTimestamp(),
      noNearbyDriverReason: message,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function pullNearest(db, order, connectedIds, livePoints, reassigned) {
  const drivers = await loadCandidateDrivers(db, order, connectedIds);
  const ranked = rankCandidates(order, drivers, connectedIds, livePoints);
  if (!ranked.length) {
    const message = reassigned
      ? 'Dereva amekataa. Hakuna dereva mwingine mtandaoni.'
      : 'Hakuna dereva mtandaoni kwa gari hili sasa.';
    await markNoDriver(db, order, message);
    return {
      customer: customerView(reassigned ? 'declined' : 'no_driver', order, null, null, { nearbyCount: 0, reassigned }),
      offer: null,
      driverId: null,
      releasedDriverId: null,
    };
  }

  let lastError = null;
  for (const candidate of ranked.slice(0, 5)) {
    try {
      await writeAssignment(db, order.id, candidate);
      const assignedOrder = {
        ...order,
        status: 'driver_assigned',
        driverId: candidate.driver.id,
        negotiationStatus: order.negotiationStatus || 'open',
      };
      return {
        customer: customerView('assigned', assignedOrder, candidate.driver, candidate.point, {
          nearbyCount: ranked.length,
          reassigned,
        }),
        offer: wireOrder(assignedOrder, candidate.driver),
        driverId: candidate.driver.id,
        releasedDriverId: null,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof CargoOfferError && (error.code === 'cancelled' || error.code === 'accepted' || error.code === 'taken')) {
        throw error;
      }
    }
  }

  throw lastError || new CargoOfferError('busy', 'Could not hold a driver.');
}

async function assignInstantCargoOffer(db, { orderId, customerUid, connectedIds, livePoints }) {
  const order = await readOrder(db, orderId);
  assertInstantCustomerOrder(order, customerUid);
  if (text(order.status) === 'cancelled') {
    return { customer: customerView('cancelled', order, null, null), offer: null, driverId: null };
  }
  if (order.acceptedByDriverAt) {
    return {
      customer: customerView('accepted', order, null, driverPoint({ id: order.driverId, currentLatitude: order.driverLatitude, currentLongitude: order.driverLongitude, currentHeading: order.driverHeading }, livePoints)),
      offer: null,
      driverId: text(order.driverId) || null,
    };
  }
  if (text(order.status) === 'driver_assigned' && text(order.driverId)) {
    const driverSnap = await db.collection('drivers').doc(text(order.driverId)).get();
    const driver = driverSnap.exists ? { id: driverSnap.id, ...driverSnap.data() } : { id: text(order.driverId) };
    const point = driverPoint(
      {
        ...driver,
        currentLatitude: order.driverLatitude ?? driver.currentLatitude,
        currentLongitude: order.driverLongitude ?? driver.currentLongitude,
      },
      livePoints
    );
    const ranked = rankCandidates(order, await loadCandidateDrivers(db, order, connectedIds), connectedIds, livePoints);
    return {
      customer: customerView('assigned', order, driver, point, { nearbyCount: Math.max(1, ranked.length) }),
      offer: wireOrder(order, driver),
      driverId: driver.id,
    };
  }

  return pullNearest(db, order, connectedIds, livePoints, false);
}

async function verifyInstantCargoOffer(db, { orderId, driverUid }) {
  const orderRef = db.collection('orders').doc(orderId);
  let order = null;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) {
      throw new CargoOfferError('not_found', 'Order was not found.');
    }
    order = { id: snapshot.id, ...snapshot.data() };
    if (text(order.cargoDispatch) !== 'instant') {
      throw new CargoOfferError('invalid_order', 'This order is not an instant cargo verify.');
    }
    if (text(order.driverId) !== text(driverUid)) {
      throw new CargoOfferError('forbidden', 'This order is assigned to a different driver.');
    }
    if (text(order.status) === 'cancelled') {
      throw new CargoOfferError('cancelled', 'The customer cancelled this order.');
    }
    if (text(order.status) !== 'driver_assigned') {
      throw new CargoOfferError('invalid_order', 'Only a pulled driver can verify.');
    }
    if (!order.acceptedByDriverAt) {
      transaction.set(
        orderRef,
        {
          acceptedByDriverAt: FieldValue.serverTimestamp(),
          negotiationStatus: 'confirmed',
          fareConfirmedAt: FieldValue.serverTimestamp(),
          status: 'driver_assigned',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  const point = driverPoint(
    {
      id: order.driverId,
      currentLatitude: order.driverLatitude,
      currentLongitude: order.driverLongitude,
      currentHeading: order.driverHeading,
    },
    null
  );
  const confirmed = { ...order, status: 'driver_assigned', negotiationStatus: 'confirmed', acceptedByDriverAt: true };
  return {
    customer: customerView('accepted', confirmed, { id: order.driverId, fullName: order.driverName, vehicleType: order.driverVehicleType, vehicleLabel: order.driverVehicleLabel }, point),
    driverId: text(order.driverId),
  };
}

async function declineInstantCargoOffer(db, { orderId, driverUid, connectedIds, livePoints }) {
  const order = await readOrder(db, orderId);
  if (text(order.cargoDispatch) !== 'instant') {
    throw new CargoOfferError('invalid_order', 'This order is not an instant cargo verify.');
  }
  if (text(order.driverId) !== text(driverUid)) {
    throw new CargoOfferError('forbidden', 'This order is assigned to a different driver.');
  }
  if (order.acceptedByDriverAt) {
    throw new CargoOfferError('accepted', 'This order is already verified.');
  }
  if (text(order.status) === 'cancelled') {
    return { customer: customerView('cancelled', order, null, null), offer: null, driverId: null, releasedDriverId: driverUid };
  }

  await releaseDriver(db, driverUid, orderId);
  const fresh = await readOrder(db, orderId);
  const next = await pullNearest(db, fresh, connectedIds, livePoints, true);
  return { ...next, releasedDriverId: driverUid };
}

async function cancelInstantCargoOffer(db, { orderId, customerUid }) {
  const order = await readOrder(db, orderId);
  assertInstantCustomerOrder(order, customerUid);
  if (order.acceptedByDriverAt) {
    const point = driverPoint(
      { id: order.driverId, currentLatitude: order.driverLatitude, currentLongitude: order.driverLongitude },
      null
    );
    return {
      customer: customerView('accepted', order, { id: order.driverId, fullName: order.driverName, vehicleType: order.driverVehicleType }, point),
      driverId: text(order.driverId) || null,
    };
  }

  const driverId = text(order.driverId);
  await db.collection('orders').doc(orderId).set(
    {
      status: 'cancelled',
      cancelledBy: 'customer',
      cancellationReason: 'Customer cancelled before the driver verified.',
      cancelledAt: FieldValue.serverTimestamp(),
      driverSearchStatus: 'waiting_for_driver',
      driverSearchMessage: 'Mteja amesitisha.',
      updatedAt: FieldValue.serverTimestamp(),
      ...clearDriverFields(),
    },
    { merge: true }
  );
  if (driverId) {
    await db.collection('drivers').doc(driverId).set(
      {
        isAvailable: true,
        currentOrderId: '',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    customer: customerView('cancelled', { ...order, status: 'cancelled' }, null, null, { nearbyCount: 0 }),
    driverId: driverId || null,
  };
}

async function replayInstantOffer(db, driverId) {
  const driverSnap = await db.collection('drivers').doc(driverId).get();
  if (!driverSnap.exists) return null;
  const driver = { id: driverSnap.id, ...driverSnap.data() };
  const orderId = text(driver.currentOrderId);
  if (!orderId) return null;
  const order = await readOrder(db, orderId).catch(() => null);
  if (!order || text(order.cargoDispatch) !== 'instant') return null;
  if (text(order.driverId) !== driverId || text(order.status) !== 'driver_assigned' || order.acceptedByDriverAt) return null;
  return wireOrder(order, driver);
}

module.exports = {
  CargoOfferError,
  assignInstantCargoOffer,
  verifyInstantCargoOffer,
  declineInstantCargoOffer,
  cancelInstantCargoOffer,
  replayInstantOffer,
};
