#!/usr/bin/env node
/* Instant cargo offer WebSocket — customer HAUL ↔ HAUL Pilots (doordropdrive). */

const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { config } = require('./config');
const {
  instantAssignCargoOffer,
  releaseCargoOfferDriver,
  acceptCargoOfferViaWs,
  declineCargoOfferViaWs,
} = require('./auto-assignment');

const PORT = Number(process.env.CARGO_OFFER_WS_PORT || process.env.PORT || 4010);

function ensureFirebase() {
  if (getApps().length) {
    return getFirestore();
  }
  const options = {
    projectId: config.firebaseProjectId || undefined,
  };
  if (config.firebaseServiceAccount) {
    options.credential = cert(config.firebaseServiceAccount);
  }
  initializeApp(options);
  return getFirestore();
}

const db = ensureFirebase();

async function verifyUid(token) {
  const value = String(token || '').trim();
  if (!value) {
    throw new Error('Missing auth token.');
  }
  const decoded = await getAuth().verifyIdToken(value);
  return decoded.uid;
}

function wireOrder(orderId, order, driverId) {
  const data = order || {};
  return {
    id: orderId,
    orderNumber: data.orderNumber || '',
    userId: data.userId || '',
    customerName: data.customerName || 'HAUL',
    customerEmail: data.customerEmail || '',
    customerPhone: data.customerPhone || '',
    serviceLabel: data.serviceLabel || data.cargoVehicleLabel || 'Cargo',
    status: 'driver_assigned',
    pickupLabel: data.pickupLabel || '',
    dropoffLabel: data.dropoffLabel || '',
    pickupLatitude: data.pickupLatitude,
    pickupLongitude: data.pickupLongitude,
    dropoffLatitude: data.dropoffLatitude,
    dropoffLongitude: data.dropoffLongitude,
    etaLabel: data.etaLabel || '',
    fareLabel: data.fareLabel || '',
    totalLabel: data.totalLabel || data.fareLabel || '',
    fareType: data.fareType || 'negotiated',
    cargoDispatch: 'instant',
    assignmentMode: 'cargo_ws',
    customerOffer: data.customerOffer,
    minFare: data.minFare,
    negotiationStatus: 'open',
    cargoVehicleKey: data.cargoVehicleKey || '',
    cargoVehicleLabel: data.cargoVehicleLabel || '',
    flow: 'cargo',
    scheduleLabel: data.scheduleLabel || '',
    recipientName: data.recipientName || data.customerName || '',
    recipientPhone: data.recipientPhone || data.customerPhone || '',
    driverId: driverId || data.driverId || '',
    driverName: data.driverName || '',
  };
}

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const customersByOrder = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const driversById = new Map();
/** @type {WeakMap<import('ws').WebSocket, { role?: string, userId?: string, driverId?: string, orderId?: string }>} */
const socketMeta = new WeakMap();

function send(socket, payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore closed sockets
  }
}

function addToMap(map, key, socket) {
  if (!key) return;
  const set = map.get(key) || new Set();
  set.add(socket);
  map.set(key, set);
}

function removeFromMap(map, key, socket) {
  if (!key) return;
  const set = map.get(key);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) {
    map.delete(key);
  }
}

function broadcast(map, key, payload) {
  const set = map.get(key);
  if (!set) return;
  for (const socket of set) {
    send(socket, payload);
  }
}

function publicDriver(driver) {
  if (!driver) return null;
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    vehicleType: driver.vehicleType,
    vehicleLabel: driver.vehicleLabel,
    plateNumber: driver.plateNumber,
    photoURL: driver.photoURL,
    latitude: driver.latitude,
    longitude: driver.longitude,
    heading: driver.heading,
    distanceMeters: driver.distanceMeters,
    etaMinutes: driver.etaMinutes,
  };
}

function customerEventType(status) {
  if (status === 'no_driver') return 'no_driver';
  if (status === 'declined') return 'declined';
  if (status === 'cancelled') return 'cancelled';
  return 'assigned';
}

function emitAssignment(orderId, result, order) {
  const payload = {
    type: customerEventType(result.status),
    orderId,
    status: result.status,
    reassigned: Boolean(result.reassigned),
    driver: publicDriver(result.driver),
    nearbyCount: Number(result.nearbyCount || (result.driver ? 1 : 0)),
    fareLabel: String(order?.totalLabel || order?.fareLabel || ''),
    vehicleKey: String(order?.cargoVehicleKey || ''),
    vehicleLabel: String(order?.cargoVehicleLabel || order?.serviceLabel || ''),
    nearbyDrivers: Array.isArray(result.nearbyDrivers)
      ? result.nearbyDrivers.map(publicDriver).filter(Boolean)
      : [],
  };
  broadcast(customersByOrder, orderId, payload);

  if (result.driver?.id && (result.status === 'assigned' || result.status === 'already_assigned')) {
    broadcast(driversById, result.driver.id, {
      type: 'offer',
      orderId,
      status: 'waiting_verify',
      order: wireOrder(orderId, order, result.driver.id),
      driver: publicDriver(result.driver),
      nearbyCount: payload.nearbyCount,
    });
  }
}

async function handleCustomerRequest(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const userId = await verifyUid(message.token);
  if (!orderId) {
    send(socket, { type: 'error', message: 'orderId is required.' });
    return;
  }

  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) {
    send(socket, { type: 'error', orderId, message: 'Order was not found.' });
    return;
  }
  const order = orderSnap.data() || {};
  if (String(order.userId || '') !== userId) {
    send(socket, { type: 'error', orderId, message: 'Not allowed for this order.' });
    return;
  }
  if (String(order.cargoDispatch || '') !== 'instant') {
    send(socket, { type: 'error', orderId, message: 'This order is not an instant cargo verify.' });
    return;
  }

  const meta = socketMeta.get(socket) || {};
  meta.role = 'customer';
  meta.userId = userId;
  meta.orderId = orderId;
  socketMeta.set(socket, meta);
  addToMap(customersByOrder, orderId, socket);

  const connected = new Set(driversById.keys());
  let result = await instantAssignCargoOffer(db, orderId, {
    mode: 'cargo_ws',
    connectedDriverIds: connected.size ? connected : null,
  });
  // If nobody is on the socket yet, still assign the nearest online driver (push + Firestore).
  if (result.status === 'no_driver' && connected.size) {
    result = await instantAssignCargoOffer(db, orderId, { mode: 'cargo_ws' });
  }
  const fresh = await db.collection('orders').doc(orderId).get();
  emitAssignment(orderId, result, fresh.data() || order);
}

async function handleCustomerCancel(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const userId = await verifyUid(message.token);
  if (!orderId) {
    send(socket, { type: 'error', message: 'orderId is required.' });
    return;
  }

  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) {
    send(socket, { type: 'error', orderId, message: 'Order was not found.' });
    return;
  }
  const order = orderSnap.data() || {};
  if (String(order.userId || '') !== userId) {
    send(socket, { type: 'error', orderId, message: 'Not allowed for this order.' });
    return;
  }
  if (order.acceptedByDriverAt) {
    send(socket, { type: 'accepted', orderId, driverId: order.driverId || '' });
    return;
  }

  const result = await releaseCargoOfferDriver(db, orderId, 'Customer cancelled before the driver verified');
  const payload = { type: 'cancelled', orderId, by: 'customer' };
  broadcast(customersByOrder, orderId, payload);
  if (result.driverId) {
    broadcast(driversById, result.driverId, payload);
  }
  send(socket, payload);
}

async function handleDriverHello(socket, message) {
  const driverId = await verifyUid(message.token);
  if (!driverId) {
    send(socket, { type: 'error', message: 'driverId is required.' });
    return;
  }
  const meta = socketMeta.get(socket) || {};
  meta.role = 'driver';
  meta.driverId = driverId;
  meta.userId = driverId;
  socketMeta.set(socket, meta);
  addToMap(driversById, driverId, socket);
  send(socket, { type: 'hello_ok', role: 'driver', driverId });
}

async function handleDriverAccept(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const driverId = await verifyUid(message.token);
  if (!orderId || !driverId) {
    send(socket, { type: 'error', message: 'orderId and driverId are required.' });
    return;
  }

  try {
    const orderSnap = await db.collection('orders').doc(orderId).get();
    const alreadyAccepted = orderSnap.exists && Boolean(orderSnap.data()?.acceptedByDriverAt);
    if (!alreadyAccepted) {
      await acceptCargoOfferViaWs(db, orderId, driverId);
    }
    const payload = { type: 'accepted', orderId, driverId };
    broadcast(customersByOrder, orderId, payload);
    broadcast(driversById, driverId, payload);
  } catch (error) {
    const orderSnap = await db.collection('orders').doc(orderId).get().catch(() => null);
    if (orderSnap?.exists && orderSnap.data()?.acceptedByDriverAt) {
      const payload = { type: 'accepted', orderId, driverId };
      broadcast(customersByOrder, orderId, payload);
      broadcast(driversById, driverId, payload);
      return;
    }
    send(socket, {
      type: 'error',
      orderId,
      message: error instanceof Error ? error.message : 'Could not accept order.',
    });
  }
}

async function handleDriverDecline(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const driverId = await verifyUid(message.token);
  if (!orderId || !driverId) {
    send(socket, { type: 'error', message: 'orderId and driverId are required.' });
    return;
  }

  try {
    broadcast(driversById, driverId, { type: 'offer_cleared', orderId, reason: 'declined' });
    const result = await declineCargoOfferViaWs(db, orderId, driverId, message.reason || 'Driver declined', {
      connectedDriverIds: new Set(driversById.keys()),
    });
    const fresh = await db.collection('orders').doc(orderId).get();
    emitAssignment(orderId, result, fresh.data() || null);
  } catch (error) {
    send(socket, {
      type: 'error',
      orderId,
      message: error instanceof Error ? error.message : 'Could not decline order.',
    });
  }
}

async function onMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    send(socket, { type: 'error', message: 'Invalid JSON.' });
    return;
  }

  const type = String(message.type || '').trim();
  try {
    switch (type) {
      case 'hello':
        if (message.role === 'driver') {
          await handleDriverHello(socket, message);
        } else {
          const meta = socketMeta.get(socket) || {};
          meta.role = 'customer';
          meta.userId = String(message.userId || '').trim();
          socketMeta.set(socket, meta);
          send(socket, { type: 'hello_ok', role: 'customer', userId: meta.userId });
        }
        break;
      case 'customer_request':
      case 'request':
        await handleCustomerRequest(socket, message);
        break;
      case 'customer_cancel':
      case 'cancel':
        await handleCustomerCancel(socket, message);
        break;
      case 'driver_accept':
      case 'accept':
        await handleDriverAccept(socket, message);
        break;
      case 'driver_decline':
      case 'decline':
        await handleDriverDecline(socket, message);
        break;
      case 'ping':
        send(socket, { type: 'pong', at: Date.now() });
        break;
      default:
        send(socket, { type: 'error', message: `Unknown type: ${type}` });
    }
  } catch (error) {
    send(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : 'Server error.',
    });
  }
}

function detachSocket(socket) {
  const meta = socketMeta.get(socket);
  if (!meta) return;
  if (meta.orderId) {
    removeFromMap(customersByOrder, meta.orderId, socket);
  }
  if (meta.driverId) {
    removeFromMap(driversById, meta.driverId, socket);
  }
  socketMeta.delete(socket);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'cargo-offer-ws',
        port: PORT,
        customers: customersByOrder.size,
        drivers: driversById.size,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  socketMeta.set(socket, {});
  send(socket, { type: 'ready', service: 'cargo-offer-ws' });
  socket.on('message', (raw) => {
    void onMessage(socket, raw);
  });
  socket.on('close', () => detachSocket(socket));
  socket.on('error', () => detachSocket(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[cargo-offer-ws] listening on ws://0.0.0.0:${PORT}`);
});
