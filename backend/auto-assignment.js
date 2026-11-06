const { FieldValue } = require('firebase-admin/firestore');
const { cellsNear } = require('./geohash');
const DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS = 1000 * 60 * 15;
const DRIVER_SEARCH_TIMEOUT_MS = 1000 * 60 * 10;
const DRIVER_SEARCH_TIMEOUT_REASON = 'No nearby driver came online in time.';
const DRIVER_WAITING_UPDATE_THROTTLE_MS = 1000 * 15;
const AUTO_ASSIGN_BATCH_SIZE = 80;
const DRIVER_AUTO_ASSIGN_QUERY_LIMIT = 32;
const DRIVER_GEOHASH_PRECISION = 6;
const PRIORITY_DRIVER_RADIUS_METERS = 4000;
const PRIORITY_DRIVER_SCORE_BONUS = 80;
const USER_NOTIFICATION_PREF_CACHE_TTL_MS = 5 * 60 * 1000;

const userNotificationPrefCache = new Map();

const AUTO_MATCH_SERVICES = [
  {
    key: 'bodaboda',
    aliases: ['parcel', 'package', 'pikipiki', 'boda', 'bodaboda', 'motorcycle', 'motorbike', 'bike'],
    preferredVehicleTypes: ['bodaboda'],
  },
  {
    key: 'toyo_electric',
    aliases: ['toyo electric', 'electric toyo', 'toyoelectric'],
    preferredVehicleTypes: ['toyo_electric'],
  },
  {
    key: 'toyo',
    aliases: ['bajaj', 'bajaji', 'toyo', 'toyo xl', 'three wheeler', 'cargo bajaji', 'pickup', 'van'],
    preferredVehicleTypes: ['toyo'],
  },
  {
    key: 'kirikuu',
    aliases: ['kirikuu'],
    preferredVehicleTypes: ['kirikuu'],
  },
  {
    key: 'canter',
    aliases: ['canter', 'center', 'fuso', 'truck', 'lorry', 'heavy cargo'],
    preferredVehicleTypes: ['canter'],
  },
];

function compact(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

const { queueDriverIncomingOrderSms, sendDriverIncomingOrderPush } = require('./driver-push');
const { isDriverCommissionLocked } = require('./driver-commission');

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

async function resolveCustomerPhone(db, order) {
  const direct = safeText(order.customerPhone || order.phoneNumber || order.senderPhone);
  if (direct) {
    return direct;
  }

  const userId = safeText(order.userId);
  if (!userId || userId.startsWith('manual:')) {
    return '';
  }

  try {
    const snapshot = await db.collection('users').doc(userId).get();
    if (!snapshot.exists) {
      return '';
    }
    const data = snapshot.data() || {};
    return safeText(data.phoneNumber || data.phone);
  } catch {
    return '';
  }
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
    toyo_electric: 'toyo_electric',
    'toyo-electric': 'toyo_electric',
    toyoelectric: 'toyo_electric',
    electric_toyo: 'toyo_electric',
    kirikuu: 'kirikuu',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
    truck: 'canter',
  };

  return aliases[normalized] || '';
}

function isCanonicalDriverVehicleType(vehicleKey) {
  return ['bodaboda', 'toyo_electric', 'toyo', 'kirikuu', 'canter'].includes(normalizeVehicleKey(vehicleKey) || normalize(vehicleKey));
}

function getVehicleLabelForKey(vehicleKey, fallback = 'Vehicle') {
  const key = normalizeVehicleKey(vehicleKey) || normalize(vehicleKey);
  const labels = {
    bodaboda: 'TOYO',
    toyo_electric: 'Toyo Electric',
    toyo: 'TOYO',
    kirikuu: 'Kirikuu',
    canter: 'Canter',
  };

  return labels[key] || safeText(fallback, 'Vehicle');
}

function getOrderVehicleKey(order) {
  return (
    normalizeVehicleKey(order?.cargoVehicleKey) ||
    normalizeVehicleKey(order?.vehicleType) ||
    normalizeVehicleKey(order?.serviceType) ||
    ''
  );
}

function getServiceMatchConfig(order) {
  const orderKey = getOrderVehicleKey(order);
  if (orderKey) {
    const byKey = AUTO_MATCH_SERVICES.find((service) => service.key === orderKey);
    if (byKey) {
      return byKey;
    }
  }

  const text = normalize(
    `${getServiceLabel(order)} ${order.flow || ''} ${order.cargoVehicleKey || ''} ${order.cargoVehicleLabel || ''}`
  );
  // Prefer electric before plain "toyo" so "Toyo Electric" does not collapse to fuel TOYO.
  if (text.includes('toyo electric') || text.includes('electric toyo') || text.includes('toyoelectric')) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === 'toyo_electric') || null;
  }
  if (text.includes('canter') || text.includes('center') || text.includes('fuso')) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === 'canter') || null;
  }
  if (text.includes('kirikuu')) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === 'kirikuu') || null;
  }
  if (text.includes('toyo') || text.includes('bajaj')) {
    return AUTO_MATCH_SERVICES.find((service) => service.key === 'toyo') || null;
  }

  return AUTO_MATCH_SERVICES.find((service) => service.aliases.some((alias) => text.includes(alias))) || null;
}

function driverSupportsOrder(driver, order) {
  const orderKey = getOrderVehicleKey(order);
  const driverKey =
    normalizeVehicleKey(driver.vehicleType) || normalizeVehicleKey(driver.vehicleLabel);

  // Strict class match: customer-selected vehicle must equal driver registration key.
  if (orderKey && driverKey) {
    return orderKey === driverKey;
  }

  const service = getServiceMatchConfig(order);
  if (!service || !driverKey) {
    return false;
  }

  return service.preferredVehicleTypes.includes(driverKey);
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
    !isDriverCommissionLocked(driver) &&
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
      const leftRequested = Boolean(order.requestedDriverId) && left.driver.id === order.requestedDriverId;
      const rightRequested = Boolean(order.requestedDriverId) && right.driver.id === order.requestedDriverId;
      if (leftRequested !== rightRequested) {
        return leftRequested ? -1 : 1;
      }

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
    assignedAt: FieldValue.serverTimestamp(),
  });
}

async function canSendOrderNotification(db, userId) {
  const userKey = safeText(userId);
  if (!userKey || normalize(userKey).startsWith('manual:')) {
    return false;
  }

  const cached = userNotificationPrefCache.get(userKey);
  if (cached && Date.now() - cached.storedAt < USER_NOTIFICATION_PREF_CACHE_TTL_MS) {
    return cached.value;
  }

  const userSnapshot = await db.collection('users').doc(userKey).get();
  const preferences = userSnapshot.data()?.notificationPreferences;
  const value = preferences?.orderUpdates !== false;
  userNotificationPrefCache.set(userKey, { value, storedAt: Date.now() });
  return value;
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
  if (isOutsideParcelOrder(order)) {
    return false;
  }
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

function isOutsideParcelOrder(order) {
  if (!order) return false;
  if (String(order.parcelScope || '').trim().toLowerCase() === 'outside') return true;
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

function isCompanyDeskOrder(order) {
  if (!order) return false;
  if (isOutsideParcelOrder(order)) return true;
  if (safeText(order.driverSearchStatus) === 'ops_desk') return true;
  if (safeText(order.assignmentMode) === 'ops_desk') return true;
  const quote = safeText(order.quoteStatus);
  if (['awaiting_company', 'offered', 'confirmed', 'declined'].includes(quote)) return true;
  if (safeText(order.carrierMatchStatus) || safeText(order.carrierShipmentId) || safeText(order.haulStage)) return true;
  return false;
}

function isAutoAssignableOrder(order) {
  if (isOutsideParcelOrder(order)) return false;
  if (safeText(order.fareType) === 'negotiated') return false;
  if (safeText(order.flow).toLowerCase() === 'ninunulie') return false;
  if (safeText(order.serviceLabel).toLowerCase() === 'ninunulie') return false;
  if (safeText(order.assignmentMode) === 'ops_desk') return false;
  if (safeText(order.driverSearchStatus) === 'ops_desk') return false;
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
  if (isOutsideParcelOrder(order) || safeText(order.driverSearchStatus) === 'ops_desk') {
    return 0;
  }
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
  if (isCompanyDeskOrder(order)) {
    return false;
  }
  if (!isImmediatePendingWithoutDriver(order) || !isDriverSearchExpired(order)) {
    return false;
  }
  const shipmentSnap = await db.collection('carrierShipments').doc(order.id).get();
  if (shipmentSnap.exists) {
    const shipmentStatus = safeText(shipmentSnap.data()?.shipmentStatus);
    if (shipmentStatus && shipmentStatus !== 'cancelled') return false;
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
    const customerPhone = await resolveCustomerPhone(db, assignedOrder);
    if (customerPhone && !safeText(assignedOrder.customerPhone)) {
      await db.collection('orders').doc(orderId).set({ customerPhone }, { merge: true });
      assignedOrder = { ...assignedOrder, customerPhone };
    }

    await Promise.all([
      createOrderStatusNotification(db, assignedOrder, 'driver_assigned', {
        driverName: assignedDriver.fullName,
      }).catch(() => undefined),
      sendDriverIncomingOrderPush(assignedDriver, assignedOrder).catch(() => undefined),
      recordDriverSearchActivity(db, assignedOrder, 'order_auto_assigned', {
        driverId: assignedDriver.id,
        driverName: assignedDriver.fullName || '',
        score: Number.isFinite(assignment.score) ? Math.round(Number(assignment.score) * 100) / 100 : null,
      }).catch(() => undefined),
    ]);
    // Assignment is already committed. Queue only — Mambo runs on smsJobs, never here.
    await queueDriverIncomingOrderSms(db, assignedDriver, assignedOrder);
  }
}

async function getAssignableDrivers(db, order = null) {
  const pickup = order ? getOrderPickupPoint(order) : null;
  const cells = pickup ? cellsNear(pickup.latitude, pickup.longitude, DRIVER_GEOHASH_PRECISION).slice(0, 9) : [];
  const driversRef = db.collection('drivers');

  const snapshot = cells.length
    ? await driversRef
      .where('isAvailable', '==', true)
      .where('geohash', 'in', cells)
      .limit(DRIVER_AUTO_ASSIGN_QUERY_LIMIT)
      .get()
    : await driversRef
      .where('isAvailable', '==', true)
      .limit(DRIVER_AUTO_ASSIGN_QUERY_LIMIT)
      .get();

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(isDriverAutoAssignable);
}

async function getPendingOrders(db, limit = AUTO_ASSIGN_BATCH_SIZE) {
  const snapshot = await db
    .collection('orders')
    .where('status', '==', 'pending_assignment')
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();

  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(isAutoAssignableOrder);
}

function buildDriverLookupKey(order) {
  const pickup = getOrderPickupPoint(order);
  if (!pickup) {
    return '__global__';
  }

  return cellsNear(pickup.latitude, pickup.longitude, DRIVER_GEOHASH_PRECISION)
    .slice(0, 9)
    .sort()
    .join(',');
}

async function autoAssignOrder(db, order, drivers = null) {
  if (!isAutoAssignableOrder(order)) {
    return { status: 'skipped', reason: 'not_auto_assignable' };
  }

  if (await autoCancelOrderIfDriverSearchExpired(db, order)) {
    return { status: 'cancelled' };
  }

  const visibleDrivers = drivers || await getAssignableDrivers(db, order);
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
  const orders = await getPendingOrders(db, limit);
  const results = [];
  const driverCache = new Map();

  async function driversForOrder(order) {
    const lookupKey = buildDriverLookupKey(order);
    if (!driverCache.has(lookupKey)) {
      driverCache.set(lookupKey, await getAssignableDrivers(db, order));
    }
    return driverCache.get(lookupKey);
  }

  for (const order of orders) {
    try {
      const nearbyDrivers = await driversForOrder(order);
      results.push(await autoAssignOrder(db, order, nearbyDrivers));
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

  if (!cameOnline && !becameFree) {
    return { processed: 0, reason: 'driver_not_newly_assignable' };
  }

  return runAutoAssignmentQueue(db, 20);
}

/**
 * Instant nearest-driver assign for HAUL cargo verify (WebSocket flow).
 * Works for negotiated cargo offers; Toyo Electric + TOYO share the TOYO pool.
 */
async function instantAssignCargoOffer(db, orderId, options = {}) {
  const orderSnapshot = await db.collection('orders').doc(orderId).get();
  if (!orderSnapshot.exists) {
    return { status: 'error', reason: 'order_not_found' };
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (order.status === 'cancelled') {
    return { status: 'cancelled', orderId };
  }

  if (order.status === 'driver_assigned' && safeText(order.driverId)) {
    const driverSnap = await db.collection('drivers').doc(order.driverId).get();
    const driver = driverSnap.exists ? { id: driverSnap.id, ...driverSnap.data() } : null;
    const nearby = await listNearbyCargoDrivers(db, order);
    return {
      status: 'already_assigned',
      orderId,
      driver: driver ? summarizeCargoDriver(driver, order) : null,
      nearbyCount: Math.max(nearby.length, driver ? 1 : 0),
      nearbyDrivers: nearby.slice(0, 8),
    };
  }

  if (order.status !== 'pending_assignment' || safeText(order.driverId)) {
    return { status: 'skipped', reason: 'not_pending', orderId };
  }

  const connectedDriverIds = options.connectedDriverIds instanceof Set ? options.connectedDriverIds : null;
  let drivers = await getAssignableDrivers(db, order);
  if (connectedDriverIds) {
    drivers = drivers.filter((driver) => connectedDriverIds.has(driver.id));
  }
  const nearby = getAutoMatchCandidates(order, drivers).map((candidate) =>
    summarizeCargoDriver(candidate.driver, order, candidate.match.distanceMeters)
  );
  const bestMatch = await selectBestAssignableAutoMatch(db, order, drivers);

  if (!bestMatch) {
    const declined = Boolean(options.reassigned);
    await db.collection('orders').doc(orderId).set(
      compact({
        driverSearchStatus: 'waiting_for_driver',
        driverSearchMessage: declined
          ? 'Dereva amekataa. Hakuna dereva mwingine mtandaoni.'
          : 'Hakuna dereva mtandaoni kwa gari hili sasa.',
        noNearbyDriverAt: FieldValue.serverTimestamp(),
        noNearbyDriverReason: declined ? 'Driver declined and nobody else is online.' : 'No online driver for this vehicle class.',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      { merge: true }
    );
    return { status: declined ? 'declined' : 'no_driver', orderId, nearbyCount: 0, nearbyDrivers: [], reassigned: declined };
  }

  await assignDriverToOrder(db, order.id, bestMatch.driver.id, {
    mode: safeText(options.mode, 'cargo_ws'),
    score: bestMatch.match.score,
    reason: bestMatch.match.reason,
  });

  await db.collection('orders').doc(orderId).set(
    compact({
      assignmentMode: safeText(options.mode, 'cargo_ws'),
      driverSearchStatus: 'waiting_verify',
      driverSearchMessage: 'Dereva amepangiwa. Anasubiri kuthibitisha.',
      updatedAt: FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );

  return {
    status: 'assigned',
    orderId,
    driver: summarizeCargoDriver(bestMatch.driver, order, bestMatch.match.distanceMeters),
    nearbyCount: Math.max(nearby.length, 1),
    nearbyDrivers: nearby.slice(0, 8),
  };
}

async function listNearbyCargoDrivers(db, order) {
  const drivers = await getAssignableDrivers(db, order);
  return getAutoMatchCandidates(order, drivers)
    .map((candidate) => summarizeCargoDriver(candidate.driver, order, candidate.match.distanceMeters))
    .slice(0, 8);
}

function summarizeCargoDriver(driver, order, distanceMeters) {
  const etaMinutes =
    Number.isFinite(distanceMeters) && distanceMeters >= 0
      ? Math.max(1, Math.round(distanceMeters / 250))
      : null;
  return compact({
    id: driver.id,
    name: safeText(driver.fullName, 'Dereva'),
    phone: safeText(driver.phoneNumber),
    vehicleType: normalizeVehicleKey(driver.vehicleType) || driver.vehicleType,
    vehicleLabel: safeText(driver.vehicleLabel, getVehicleLabelForKey(driver.vehicleType)),
    plateNumber: safeText(driver.plateNumber),
    photoURL: safeText(driver.driverPhotoURL),
    latitude: Number(driver.currentLatitude),
    longitude: Number(driver.currentLongitude),
    heading: Number(driver.currentHeading),
    distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : undefined,
    etaMinutes,
    orderId: order?.id,
  });
}

async function releaseCargoOfferDriver(db, orderId, reason = 'Customer cancelled') {
  const orderSnapshot = await db.collection('orders').doc(orderId).get();
  if (!orderSnapshot.exists) {
    return { status: 'error', reason: 'order_not_found' };
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (order.status === 'cancelled') {
    return { status: 'cancelled', orderId, driverId: safeText(order.driverId) || null };
  }

  const driverId = safeText(order.driverId);
  const batch = db.batch();
  batch.set(
    db.collection('orders').doc(orderId),
    compact({
      status: 'cancelled',
      cancellationReason: safeText(reason, 'Customer cancelled'),
      cancelledBy: 'customer',
      cancelledAt: FieldValue.serverTimestamp(),
      driverSearchStatus: 'cancelled',
      driverSearchMessage: 'Mteja amesitisha.',
      driverSearchResolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );

  if (driverId) {
    batch.set(
      db.collection('drivers').doc(driverId),
      {
        isAvailable: true,
        currentOrderId: '',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { status: 'cancelled', orderId, driverId: driverId || null };
}

async function acceptCargoOfferViaWs(db, orderId, driverId) {
  const orderRef = db.collection('orders').doc(orderId);
  const driverRef = db.collection('drivers').doc(driverId);

  await db.runTransaction(async (transaction) => {
    const [orderSnap, driverSnap] = await Promise.all([transaction.get(orderRef), transaction.get(driverRef)]);
    if (!orderSnap.exists) {
      throw new Error('Order was not found.');
    }
    if (!driverSnap.exists) {
      throw new Error('Driver was not found.');
    }

    const order = { id: orderSnap.id, ...orderSnap.data() };
    const driver = { id: driverSnap.id, ...driverSnap.data() };

    if (order.driverId !== driverId) {
      throw new Error('This order is assigned to a different driver.');
    }
    if (order.status !== 'driver_assigned') {
      throw new Error('Only newly assigned orders can be accepted.');
    }
    if (!isDriverVerifiedForDispatch(driver)) {
      throw new Error('This driver account is waiting for admin verification.');
    }

    const agreedFare =
      typeof order.customerOffer === 'number' && order.customerOffer > 0
        ? order.customerOffer
        : undefined;
    const agreedFareLabel =
      typeof agreedFare === 'number' ? `TZS ${Math.round(agreedFare).toLocaleString('en-US')}` : undefined;

    transaction.set(
      orderRef,
      compact({
        acceptedByDriverAt: FieldValue.serverTimestamp(),
        status: 'driver_assigned',
        negotiationStatus: 'confirmed',
        customerOffer: agreedFare,
        driverOffer: agreedFare,
        lastOfferBy: 'driver',
        fareConfirmedAt: FieldValue.serverTimestamp(),
        fareLabel: agreedFareLabel || order.fareLabel,
        totalLabel: agreedFareLabel || order.totalLabel,
        driverName: driver.fullName || order.driverName,
        driverPhone: driver.phoneNumber || order.driverPhone,
        driverVehicleLabel: driver.vehicleLabel || order.driverVehicleLabel,
        driverPlateNumber: driver.plateNumber || order.driverPlateNumber,
        driverSearchStatus: 'accepted',
        driverSearchMessage: 'Dereva amethibitisha.',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      { merge: true }
    );

    transaction.set(
      driverRef,
      {
        isAvailable: false,
        currentOrderId: orderId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { status: 'accepted', orderId, driverId };
}

async function declineCargoOfferViaWs(db, orderId, driverId, reason = 'Driver declined', options = {}) {
  const orderSnapshot = await db.collection('orders').doc(orderId).get();
  if (!orderSnapshot.exists) {
    return { status: 'error', reason: 'order_not_found' };
  }

  const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
  if (order.driverId !== driverId) {
    return { status: 'error', reason: 'wrong_driver' };
  }

  await db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(orderId);
    const driverRef = db.collection('drivers').doc(driverId);
    const [orderSnap, driverSnap] = await Promise.all([transaction.get(orderRef), transaction.get(driverRef)]);
    if (!orderSnap.exists) {
      throw new Error('Order was not found.');
    }

    const current = { id: orderSnap.id, ...orderSnap.data() };
    if (current.driverId !== driverId || current.status !== 'driver_assigned') {
      throw new Error('Order is not waiting for this driver.');
    }

    transaction.set(
      orderRef,
      compact({
        status: 'pending_assignment',
        driverSearchStatus: 'waiting_for_driver',
        driverSearchMessage: 'Dereva amekataa.',
        driverSearchStartedAt: FieldValue.serverTimestamp(),
        declinedDriverIds: FieldValue.arrayUnion(driverId),
        lastDeclinedByDriverId: driverId,
        lastDeclinedReason: safeText(reason, 'Driver declined'),
        lastDeclinedAt: FieldValue.serverTimestamp(),
        driverId: FieldValue.delete(),
        driverName: FieldValue.delete(),
        driverPhone: FieldValue.delete(),
        driverVehicleType: FieldValue.delete(),
        driverVehicleLabel: FieldValue.delete(),
        driverPlateNumber: FieldValue.delete(),
        driverLatitude: FieldValue.delete(),
        driverLongitude: FieldValue.delete(),
        assignedAt: FieldValue.delete(),
        assignmentMode: 'cargo_ws',
        updatedAt: FieldValue.serverTimestamp(),
      }),
      { merge: true }
    );

    if (driverSnap.exists) {
      transaction.set(
        driverRef,
        {
          isAvailable: true,
          currentOrderId: '',
          rejectionCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  const next = await instantAssignCargoOffer(db, orderId, {
    mode: 'cargo_ws',
    connectedDriverIds: options.connectedDriverIds,
    reassigned: true,
  });
  if (next.status === 'assigned' || next.status === 'already_assigned') {
    return { ...next, reassigned: true };
  }
  return next;
}

module.exports = {
  autoAssignOrderById,
  maybeRunQueueForDriverChange,
  runAutoAssignmentQueue,
  instantAssignCargoOffer,
  listNearbyCargoDrivers,
  releaseCargoOfferDriver,
  acceptCargoOfferViaWs,
  declineCargoOfferViaWs,
  summarizeCargoDriver,
};
