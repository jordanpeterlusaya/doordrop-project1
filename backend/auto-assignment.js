const { FieldValue } = require('firebase-admin/firestore');

const DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS = 1000 * 60 * 15;
const DRIVER_SEARCH_TIMEOUT_MS = 1000 * 60 * 10;
const DRIVER_SEARCH_TIMEOUT_REASON = 'No nearby driver came online in time.';
const DRIVER_WAITING_UPDATE_THROTTLE_MS = 1000 * 15;
const AUTO_ASSIGN_BATCH_SIZE = 12;
const DRIVER_AUTO_ASSIGN_QUERY_LIMIT = 120;
const PRIORITY_DRIVER_RADIUS_METERS = 4000;
const PRIORITY_DRIVER_SCORE_BONUS = 80;

const AUTO_MATCH_SERVICES = [
  {
    key: 'bodaboda',
    aliases: ['parcel', 'package', 'pikipiki', 'boda', 'bodaboda', 'motorcycle', 'motorbike', 'bike'],
    preferredVehicleTypes: ['bodaboda'],
  },
  {
    key: 'toyo',
    aliases: ['bajaj', 'bajaji', 'toyo', 'toyo xl', 'xl', 'three wheeler', 'cargo bajaji', 'pickup', 'van', 'truck', 'lorry', 'heavy cargo'],
    preferredVehicleTypes: ['toyo'],
  },
  {
    key: 'kirikuu',
    aliases: ['kirikuu'],
    preferredVehicleTypes: ['kirikuu'],
  },
];

function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  return String(value ?? '').split('').reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 0);
}

function getGeneratedOrderNumber(documentId) {
  return `DD-${String(documentId || '').slice(0, 6).toUpperCase()}`;
}

function getOrderNumber(order) {
  return safeText(order.orderNumber || order.orderId || order.id, getGeneratedOrderNumber(order.id));
}

function getServiceLabel(order) {
  return safeText(order.serviceLabel || order.serviceType || order.vehicleLabel || order.vehicleType || order.flow, 'Delivery');
}

function getCustomerName(order) {
  return safeText(order.customerName || order.senderName || order.userName || order.name, 'DoorDrop Customer');
}

function normalizeVehicleKey(vehicleKey) {
  const normalized = normalize(vehicleKey);
  const aliases = {
    parcel: 'bodaboda',
    pikipiki: 'bodaboda',
    boda: 'bodaboda',
    bodaboda: 'bodaboda',
    motorcycle: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    kirikuu: 'kirikuu',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
  };

  return aliases[normalized] || normalized || '';
}

function isCanonicalDriverVehicleType(vehicleKey) {
  return ['bodaboda', 'toyo', 'kirikuu'].includes(normalize(vehicleKey));
}

function getVehicleLabelForKey(vehicleKey, fallback = 'Vehicle') {
  const labels = {
    bodaboda: 'Bodaboda / Motorcycle',
    toyo: 'TOYO',
    kirikuu: 'Kirikuu',
  };

  return labels[normalizeVehicleKey(vehicleKey)] || safeText(fallback, 'Vehicle');
}

function getServiceMatchConfig(order) {
  const cargoVehicleKey = normalize(order.cargoVehicleKey);
  const keyMatch = {
    motorcycle: 'bodaboda',
    pikipiki: 'bodaboda',
    boda: 'bodaboda',
    bodaboda: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    kirikuu: 'kirikuu',
    bajaj: 'toyo',
    bajaji: 'toyo',
    toyo: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
  }[cargoVehicleKey];

  if (keyMatch) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === keyMatch) || AUTO_MATCH_SERVICES[0];
  }

  const text = normalize(`${getServiceLabel(order)} ${order.flow || ''} ${order.cargoVehicleKey || ''} ${order.cargoVehicleLabel || ''}`);
  if (text.includes('toyo xl')) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === 'toyo') || AUTO_MATCH_SERVICES[0];
  }

  return AUTO_MATCH_SERVICES.find((service) => service.aliases.some((alias) => text.includes(alias))) || AUTO_MATCH_SERVICES[0];
}

function driverSupportsOrder(driver, order) {
  const service = getServiceMatchConfig(order);
  const vehicleType = normalizeVehicleKey(driver.vehicleType);
  const vehicleLabel = normalize(driver.vehicleLabel);

  if (isCanonicalDriverVehicleType(vehicleType)) {
    return service.preferredVehicleTypes.includes(vehicleType);
  }

  return service.aliases.some((alias) => vehicleLabel.includes(alias));
}

function getDriverVerificationStatus(driver) {
  const status = normalize(driver?.verificationStatus);
  if (status === 'pending_admin_verification' || status === 'rejected') {
    return status;
  }
  return 'verified';
}

function isDriverVerifiedForDispatch(driver) {
  return getDriverVerificationStatus(driver) === 'verified';
}

function getDriverLastSeenMillis(driver) {
  return Math.max(
    toMillis(driver.lastLocationUpdatedAt),
    toMillis(driver.lastActiveAt),
    toMillis(driver.updatedAt),
    toMillis(driver.appOnlineUntil)
  );
}

function isDriverAutoAssignable(driver) {
  const appOnlineUntil = toMillis(driver.appOnlineUntil);
  const lastSeenMillis = getDriverLastSeenMillis(driver);
  const freshOnline = (appOnlineUntil && appOnlineUntil > Date.now()) || (!!lastSeenMillis && Date.now() - lastSeenMillis <= DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS);

  return (
    isDriverVerifiedForDispatch(driver) &&
    driver.isAvailable === true &&
    !safeText(driver.currentOrderId) &&
    freshOnline
  );
}

function getPoint(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { latitude: lat, longitude: lng };
}

function getDriverCurrentPoint(driver) {
  return getPoint(driver.currentLatitude, driver.currentLongitude);
}

function getOrderPickupPoint(order) {
  return getPoint(order.pickupLatitude, order.pickupLongitude);
}

function getDistanceBetweenPoints(start, end) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDriverRatingAverage(driver) {
  const average = Number(driver.ratingAverage ?? driver.averageRating ?? driver.driverRatingAverage);
  if (Number.isFinite(average) && average >= 1 && average <= 5) {
    return average;
  }

  return 4.5;
}

function getDriverAutoMatchScore(order, driver, minimumAssignmentCount) {
  const pickup = getOrderPickupPoint(order);
  const currentPoint = getDriverCurrentPoint(driver);
  const supportsOrder = driverSupportsOrder(driver, order);
  const distanceMeters = pickup && currentPoint ? getDistanceBetweenPoints(currentPoint, pickup) : undefined;
  const assignmentCount = Number(driver.assignmentCount ?? 0);
  const recentAssignments = Number(driver.recentAssignments ?? 0);
  const distancePenalty = distanceMeters === undefined ? 5000 : distanceMeters / 10;
  const ratingPenalty = clamp((5 - getDriverRatingAverage(driver)) * 2, 0, 8);
  const workloadPenalty = clamp((assignmentCount - minimumAssignmentCount) * 2 + recentAssignments * 2, 0, 10);
  const lastAssignedMillis = toMillis(driver.lastAssignedAt);
  const idleBonus = lastAssignedMillis ? clamp((Date.now() - lastAssignedMillis) / (1000 * 60 * 60 * 3), 0, 5) : 5;
  const vehiclePenalty = supportsOrder ? 0 : 120;
  const isPriorityMatch = driver.isPriorityDriver === true && supportsOrder && distanceMeters !== undefined && distanceMeters <= PRIORITY_DRIVER_RADIUS_METERS;
  const tieBreaker = stableHash(`${order.id}:${driver.id}`) / 10000000000;
  const score =
    vehiclePenalty +
    distancePenalty +
    ratingPenalty +
    workloadPenalty -
    idleBonus -
    (isPriorityMatch ? PRIORITY_DRIVER_SCORE_BONUS : 0) +
    tieBreaker;

  return {
    distanceMeters,
    supportsOrder,
    isPriorityMatch,
    score,
    reason: [
      isPriorityMatch ? 'priority driver within 4 km' : '',
      supportsOrder ? 'vehicle match' : 'vehicle fallback',
      distanceMeters === undefined ? 'GPS pending' : `${Math.round(distanceMeters)}m from pickup`,
      `${getDriverRatingAverage(driver).toFixed(1)}/5 rating`,
      `${assignmentCount} total assignments`,
    ].filter(Boolean).join(' · '),
  };
}

function getAutoMatchCandidates(order, drivers) {
  const declinedDriverIds = new Set(Array.isArray(order.declinedDriverIds) ? order.declinedDriverIds : []);
  const availableDrivers = drivers.filter((driver) => isDriverAutoAssignable(driver) && !declinedDriverIds.has(driver.id));
  const assignmentCounts = availableDrivers.map((driver) => Number(driver.assignmentCount ?? 0));
  const minimumAssignmentCount = assignmentCounts.length ? Math.min(...assignmentCounts) : 0;

  return availableDrivers
    .map((driver) => ({
      driver,
      match: getDriverAutoMatchScore(order, driver, minimumAssignmentCount),
    }))
    .filter((candidate) => candidate.match.supportsOrder)
    .sort((left, right) => {
      if (left.match.isPriorityMatch !== right.match.isPriorityMatch) {
        return left.match.isPriorityMatch ? -1 : 1;
      }

      if (left.match.distanceMeters !== undefined && right.match.distanceMeters !== undefined) {
        return left.match.distanceMeters - right.match.distanceMeters;
      }

      if (left.match.distanceMeters !== undefined) {
        return -1;
      }

      if (right.match.distanceMeters !== undefined) {
        return 1;
      }

      return left.match.score - right.match.score;
    });
}

async function selectBestAssignableAutoMatch(db, order, drivers) {
  const candidates = getAutoMatchCandidates(order, drivers);
  return candidates[0] || null;
}

function buildDriverAssignmentPayload(driver) {
  const driverVehicleType = normalizeVehicleKey(driver.vehicleType);
  return compact({
    driverId: driver.id,
    driverName: driver.fullName,
    driverPhone: driver.phoneNumber,
    driverVehicleType: isCanonicalDriverVehicleType(driverVehicleType) ? driverVehicleType : driver.vehicleType,
    driverVehicleLabel: driver.vehicleLabel || getVehicleLabelForKey(driverVehicleType),
    driverPlateNumber: driver.plateNumber,
    driverLatitude: driver.currentLatitude,
    driverLongitude: driver.currentLongitude,
    driverHeading: driver.currentHeading,
    driverSpeedKph: driver.currentSpeedKph,
    driverAccuracyMeters: driver.currentAccuracyMeters,
    driverLocationUpdatedAt: driver.lastLocationUpdatedAt || FieldValue.serverTimestamp(),
    acceptedByDriverAt: FieldValue.serverTimestamp(),
    assignedAt: FieldValue.serverTimestamp(),
  });
}

async function canSendOrderNotification(db, userId) {
  const userKey = safeText(userId);
  if (!userKey || normalize(userKey).startsWith('manual:')) {
    return false;
  }

  const userSnapshot = await db.collection('users').doc(userKey).get();
  const preferences = userSnapshot.data()?.notificationPreferences;
  return preferences?.orderUpdates !== false;
}

async function createOrderStatusNotification(db, order, status, options = {}) {
  const userId = safeText(order.userId || order.customerId);
  if (!(await canSendOrderNotification(db, userId))) {
    return;
  }

  const orderNumber = getOrderNumber(order);
  const titleMap = {
    pending_assignment: 'Order received',
    driver_assigned: 'Driver assigned',
    cancelled: 'Order cancelled',
  };

  let message = `${orderNumber} is now ${status.replaceAll('_', ' ')}.`;
  if (status === 'driver_assigned') {
    message = `${safeText(options.driverName || order.driverName, 'A driver')} has been assigned to ${orderNumber}.`;
  } else if (status === 'pending_assignment') {
    message = `${orderNumber} is in dispatch and waiting for the best available driver.`;
  } else if (status === 'cancelled') {
    message = `${orderNumber} was cancelled. ${safeText(options.cancellationReason, 'Contact support if this was unexpected.')}`;
  }

  await db.collection('userNotifications').doc().set(compact({
    userId,
    orderId: order.id,
    orderNumber,
    orderStatus: status,
    title: titleMap[status] || 'Order updated',
    message,
    type: status === 'pending_assignment' ? 'order_created' : 'order_status',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }));
}

async function recordDriverSearchActivity(db, order, eventName, metadata = {}) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const featureKey = 'driver_matching';
  const payload = compact({
    userId: order.userId || order.customerId || '',
    userName: getCustomerName(order),
    userRole: 'customer',
    eventName,
    featureKey,
    featureLabel: 'Driver matching',
    screen: 'cloud_dispatch',
    route: '/track-order',
    platform: 'cloud_function',
    metadata: compact({
      orderId: order.id,
      orderNumber: getOrderNumber(order),
      serviceLabel: getServiceLabel(order),
      vehicleType: order.cargoVehicleKey || order.vehicleType || '',
      vehicleLabel: order.cargoVehicleLabel || order.vehicleLabel || '',
      ...metadata,
    }),
    dateKey,
    createdAt: FieldValue.serverTimestamp(),
  });

  await Promise.all([
    db.collection('appActivityEvents').doc().set(payload),
    db.collection('appFeatureStats').doc(`${dateKey}_${featureKey}`).set({
      dateKey,
      featureKey,
      featureLabel: 'Driver matching',
      platform: 'cloud_function',
      userRole: 'customer',
      count: FieldValue.increment(1),
      lastEventName: eventName,
      lastEventAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}

function isImmediatePendingWithoutDriver(order) {
  return order.status === 'pending_assignment' && !safeText(order.driverId) && order.timingMode !== 'later';
}

function getScheduledMillis(order) {
  if (order.timingMode !== 'later') {
    return 0;
  }

  const date = safeText(order.scheduleDate);
  const time = safeText(order.scheduleTime, '00:00');
  const millis = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function isAutoAssignableOrder(order) {
  if (order.status !== 'pending_assignment') return false;
  if (safeText(order.driverId)) return false;

  if (order.timingMode === 'later') {
    const scheduledMillis = getScheduledMillis(order);
    if (scheduledMillis && scheduledMillis - Date.now() > 1000 * 60 * 45) {
      return false;
    }
  }

  return true;
}

function getDriverSearchExpiryMillis(order) {
  const explicitExpiry = toMillis(order.driverSearchExpiresAt);
  if (explicitExpiry) {
    return explicitExpiry;
  }

  const createdAt = toMillis(order.createdAt);
  return createdAt ? createdAt + DRIVER_SEARCH_TIMEOUT_MS : 0;
}

function isDriverSearchExpired(order) {
  const expiry = getDriverSearchExpiryMillis(order);
  return !!expiry && Date.now() >= expiry;
}

async function markOrderWaitingForDriver(db, order, reason = 'No online nearby driver matched this order yet.') {
  if (!isImmediatePendingWithoutDriver(order)) {
    return false;
  }

  const lastNoDriverAt = toMillis(order.noNearbyDriverAt);
  if (lastNoDriverAt && Date.now() - lastNoDriverAt < DRIVER_WAITING_UPDATE_THROTTLE_MS) {
    return false;
  }

  await db.collection('orders').doc(order.id).set(compact({
    driverSearchStatus: 'waiting_for_driver',
    driverSearchMessage: `We are still looking for a nearby ${safeText(order.cargoVehicleLabel || order.serviceLabel, 'DoorDrop')} driver.`,
    noNearbyDriverAt: FieldValue.serverTimestamp(),
    noNearbyDriverReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true });

  await recordDriverSearchActivity(db, order, 'no_nearby_driver', { reason }).catch(() => undefined);
  return true;
}

async function autoCancelOrderIfDriverSearchExpired(db, order) {
  if (!isImmediatePendingWithoutDriver(order) || !isDriverSearchExpired(order)) {
    return false;
  }

  await db.collection('orders').doc(order.id).set(compact({
    status: 'cancelled',
    cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON,
    cancelledBy: 'dispatch',
    cancelledAt: FieldValue.serverTimestamp(),
    driverSearchStatus: 'auto_cancelled',
    driverSearchMessage: 'We could not find an online nearby driver in time, so the order was cancelled automatically.',
    autoCancelledAt: FieldValue.serverTimestamp(),
    autoCancelledReason: DRIVER_SEARCH_TIMEOUT_REASON,
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true });

  await Promise.all([
    createOrderStatusNotification(db, order, 'cancelled', { cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON }).catch(() => undefined),
    recordDriverSearchActivity(db, order, 'order_auto_cancelled_no_driver', { reason: DRIVER_SEARCH_TIMEOUT_REASON }).catch(() => undefined),
  ]);

  return true;
}

async function assignDriverToOrder(db, orderId, driverId, assignment = {}) {
  let assignedOrder = null;
  let assignedDriver = null;

  await db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(orderId);
    const driverRef = db.collection('drivers').doc(driverId);
    const [orderSnapshot, driverSnapshot] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(driverRef),
    ]);

    if (!orderSnapshot.exists) {
      throw new Error('Order was not found.');
    }

    if (!driverSnapshot.exists) {
      throw new Error('Driver was not found.');
    }

    const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
    const driver = { id: driverSnapshot.id, ...driverSnapshot.data() };
    const isSameAssignment = order.driverId === driver.id && driver.currentOrderId === orderId;

    if (order.status !== 'pending_assignment' && order.driverId !== driver.id) {
      throw new Error('This order is no longer waiting for assignment.');
    }

    if (!isSameAssignment && (!driver.isAvailable || safeText(driver.currentOrderId))) {
      throw new Error('This driver is not available for a new order.');
    }

    if (!isDriverVerifiedForDispatch(driver)) {
      throw new Error('This driver account is waiting for admin verification.');
    }

    if (!driverSupportsOrder(driver, order)) {
      throw new Error(`${getVehicleLabelForKey(driver.vehicleType, driver.vehicleLabel)} driver cannot receive ${getServiceLabel(order)} orders.`);
    }

    transaction.set(orderRef, compact({
      status: 'driver_assigned',
      ...buildDriverAssignmentPayload(driver),
      assignmentMode: safeText(assignment.mode, 'auto'),
      assignmentScore: Number.isFinite(assignment.score) ? Math.round(Number(assignment.score) * 100) / 100 : undefined,
      assignmentReason: safeText(assignment.reason),
      driverSearchStatus: 'assigned',
      driverSearchMessage: `${safeText(driver.fullName, 'A driver')} has been assigned to this order.`,
      driverSearchResolvedAt: FieldValue.serverTimestamp(),
      cancellationReason: FieldValue.delete(),
      cancelledAt: FieldValue.delete(),
      cancelledBy: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }), { merge: true });

    transaction.set(driverRef, {
      isAvailable: false,
      currentOrderId: orderId,
      assignmentCount: FieldValue.increment(1),
      lastAssignedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    assignedOrder = order;
    assignedDriver = driver;
  });

  if (assignedOrder && assignedDriver) {
    await Promise.all([
      createOrderStatusNotification(db, assignedOrder, 'driver_assigned', {
        driverName: assignedDriver.fullName,
      }).catch(() => undefined),
      recordDriverSearchActivity(db, assignedOrder, 'order_auto_assigned', {
        driverId: assignedDriver.id,
        driverName: assignedDriver.fullName || '',
        score: Number.isFinite(assignment.score) ? Math.round(Number(assignment.score) * 100) / 100 : null,
      }).catch(() => undefined),
    ]);
  }
}

async function getAllDrivers(db) {
  const snapshot = await db.collection('drivers').get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getAssignableDrivers(db) {
  const snapshot = await db
    .collection('drivers')
    .where('isAvailable', '==', true)
    .limit(DRIVER_AUTO_ASSIGN_QUERY_LIMIT)
    .get();

  const drivers = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(isDriverAutoAssignable);
  return drivers.length ? drivers : getAllDrivers(db);
}

async function getPendingOrders(db, limit = AUTO_ASSIGN_BATCH_SIZE) {
  const snapshot = await db
    .collection('orders')
    .where('status', '==', 'pending_assignment')
    .limit(limit * 4)
    .get();

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(isAutoAssignableOrder)
    .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt))
    .slice(0, limit);
}

async function autoAssignOrder(db, order, drivers = null) {
  if (!isAutoAssignableOrder(order)) {
    return { status: 'skipped', reason: 'not_auto_assignable' };
  }

  if (await autoCancelOrderIfDriverSearchExpired(db, order)) {
    return { status: 'cancelled' };
  }

  const visibleDrivers = drivers || await getAssignableDrivers(db);
  const bestMatch = await selectBestAssignableAutoMatch(db, order, visibleDrivers);

  if (!bestMatch) {
    await markOrderWaitingForDriver(db, order);
    return { status: 'waiting_for_driver' };
  }

  await assignDriverToOrder(db, order.id, bestMatch.driver.id, {
    mode: 'auto',
    score: bestMatch.match.score,
    reason: bestMatch.match.reason,
  });

  return {
    status: 'assigned',
    orderId: order.id,
    driverId: bestMatch.driver.id,
    score: bestMatch.match.score,
  };
}

async function autoAssignOrderById(db, orderId) {
  const snapshot = await db.collection('orders').doc(orderId).get();
  if (!snapshot.exists) {
    return { status: 'skipped', reason: 'order_not_found' };
  }

  return autoAssignOrder(db, { id: snapshot.id, ...snapshot.data() });
}

async function runAutoAssignmentQueue(db, limit = AUTO_ASSIGN_BATCH_SIZE) {
  const [orders, drivers] = await Promise.all([
    getPendingOrders(db, limit),
    getAssignableDrivers(db),
  ]);
  const results = [];

  for (const order of orders) {
    try {
      results.push(await autoAssignOrder(db, order, drivers));
    } catch (error) {
      results.push({
        status: 'error',
        orderId: order.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processed: results.length,
    assigned: results.filter((result) => result.status === 'assigned').length,
    waiting: results.filter((result) => result.status === 'waiting_for_driver').length,
    cancelled: results.filter((result) => result.status === 'cancelled').length,
    errors: results.filter((result) => result.status === 'error').length,
    results,
  };
}

async function maybeRunQueueForDriverChange(db, before, after) {
  const wasAssignable = before ? isDriverAutoAssignable(before) : false;
  const isAssignable = after ? isDriverAutoAssignable(after) : false;
  const cameOnline = isAssignable && !wasAssignable;
  const becameFree = isAssignable && before && safeText(before.currentOrderId) && !safeText(after.currentOrderId);
  const locationRefreshed = isAssignable && before && (
    toMillis(after.lastLocationUpdatedAt) > toMillis(before.lastLocationUpdatedAt) ||
    toMillis(after.lastActiveAt) > toMillis(before.lastActiveAt) ||
    toMillis(after.appOnlineUntil) > toMillis(before.appOnlineUntil)
  );

  if (!cameOnline && !becameFree && !locationRefreshed) {
    return { processed: 0, reason: 'driver_not_newly_assignable' };
  }

  return runAutoAssignmentQueue(db, 6);
}

module.exports = {
  autoAssignOrderById,
  maybeRunQueueForDriverChange,
  runAutoAssignmentQueue,
};
