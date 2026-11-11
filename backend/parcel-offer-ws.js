#!/usr/bin/env node
/* Instant parcel offer WebSocket — customer HAUL ↔ HAUL Cargo Agents. */

const http = require('http');
const { WebSocketServer } = require('ws');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { config } = require('./config');
const {
  acceptCarrierOfferViaWs,
  isBusParcel,
  matchOrderById,
  rejectCarrierOfferViaWs,
  shipmentPayload,
} = require('./carrier-matching');

const PORT = Number(process.env.PARCEL_OFFER_WS_PORT || process.env.PORT || 4011);

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

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const customersByOrder = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const carriersById = new Map();
/** @type {WeakMap<import('ws').WebSocket, { role?: string, userId?: string, carrierId?: string, orderId?: string }>} */
const socketMeta = new WeakMap();

function send(socket, payload) {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore
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
  if (set.size === 0) map.delete(key);
}

function broadcast(map, key, payload) {
  const set = map.get(key);
  if (!set) return;
  for (const socket of set) send(socket, payload);
}

function wireShipment(orderId, shipment, order) {
  const data = shipment || {};
  const source = order || {};
  return {
    id: orderId,
    orderNumber: data.orderNumber || source.orderNumber || '',
    parcelCode: data.parcelCode || data.orderNumber || source.orderNumber || '',
    origin: data.origin || source.pickupLabel || '',
    destination: data.destination || source.outsideDestinationCity || source.dropoffLabel || '',
    routeLabel: data.routeLabel || '',
    weightKg: Number(data.weightKg) || 0,
    declaredValueTzs: Number(data.declaredValueTzs) || 0,
    haulFee: Number(data.haulFee) || 0,
    carrierNet: Number(data.carrierNet) || 0,
    cashExpected: Number(data.cashExpected) || 0,
    senderName: data.senderName || source.customerName || '',
    senderPhone: data.senderPhone || source.customerPhone || '',
    recipientName: data.recipientName || source.recipientName || '',
    recipientPhone: data.recipientPhone || source.recipientPhone || '',
    pickupLabel: data.pickupLabel || source.pickupLabel || '',
    dropoffLabel: data.dropoffLabel || source.dropoffLabel || '',
    shipmentStatus: data.shipmentStatus || 'assigned',
    offeredCarrierId: data.offeredCarrierId || '',
    offerExpiresAt: data.offerExpiresAt || null,
    carrierDispatch: 'instant',
    assignmentMode: 'parcel_ws',
  };
}

async function loadCarrierPublic(carrierId) {
  if (!carrierId) return null;
  const snap = await db.collection('carriers').doc(carrierId).get();
  if (!snap.exists) return { id: carrierId };
  const data = snap.data() || {};
  return {
    id: carrierId,
    companyName: String(data.tradingName || data.companyName || '').trim(),
    phone: String(data.phone || '').trim(),
    region: String(data.region || '').trim(),
  };
}

async function emitMatchState(orderId, result, order) {
  const shipSnap = await db.collection('carrierShipments').doc(orderId).get();
  const shipment = shipSnap.exists ? shipSnap.data() : null;
  const carrierId = String(result?.carrierId || shipment?.offeredCarrierId || shipment?.carrierId || '').trim();
  const carrier = carrierId ? await loadCarrierPublic(carrierId) : null;
  const accepted = Boolean(shipment?.carrierId) || Boolean(result?.alreadyAccepted);
  const matched = Boolean(result?.matched) || Boolean(carrierId);

  if (accepted && carrierId) {
    const payload = {
      type: 'accepted',
      orderId,
      carrierId,
      carrier,
      shipment: wireShipment(orderId, shipment, order),
    };
    broadcast(customersByOrder, orderId, payload);
    broadcast(carriersById, carrierId, payload);
    return;
  }

  if (!matched || !carrierId) {
    const payload = {
      type: 'no_company',
      orderId,
      status: 'matching',
      message: 'Hakuna kampuni iliyopo karibu sasa.',
    };
    broadcast(customersByOrder, orderId, payload);
    return;
  }

  const customerPayload = {
    type: 'offered',
    orderId,
    status: 'waiting_verify',
    carrierId,
    carrier,
    routeLabel: String(shipment?.routeLabel || result?.routeLabel || ''),
    fareLabel: String(order?.totalLabel || order?.fareLabel || ''),
  };
  broadcast(customersByOrder, orderId, customerPayload);

  broadcast(carriersById, carrierId, {
    type: 'offer',
    orderId,
    status: 'waiting_verify',
    shipment: wireShipment(orderId, shipment || shipmentPayload(order, orderId, null), order),
    carrier,
  });
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
  const order = { id: orderSnap.id, ...orderSnap.data() };
  if (String(order.userId || '') !== userId) {
    send(socket, { type: 'error', orderId, message: 'Not allowed for this order.' });
    return;
  }
  if (!isBusParcel(order)) {
    send(socket, { type: 'error', orderId, message: 'This order is not a carrier parcel.' });
    return;
  }

  const meta = socketMeta.get(socket) || {};
  meta.role = 'customer';
  meta.userId = userId;
  meta.orderId = orderId;
  socketMeta.set(socket, meta);
  addToMap(customersByOrder, orderId, socket);

  await db.collection('orders').doc(orderId).set(
    {
      carrierDispatch: 'instant',
      assignmentMode: order.assignmentMode === 'ops_desk' ? 'ops_desk' : 'parcel_ws',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const connected = new Set(carriersById.keys());
  let result = await matchOrderById(db, orderId, {
    preferCarrierIds: connected.size ? connected : null,
    carrierDispatch: 'instant',
  });
  if (!result?.matched && !result?.skipped && connected.size) {
    result = await matchOrderById(db, orderId, { carrierDispatch: 'instant' });
  }

  const fresh = await db.collection('orders').doc(orderId).get();
  await emitMatchState(orderId, result, fresh.exists ? { id: orderId, ...fresh.data() } : order);
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

  const shipSnap = await db.collection('carrierShipments').doc(orderId).get();
  const shipment = shipSnap.exists ? shipSnap.data() : null;
  if (shipment?.carrierId) {
    send(socket, { type: 'accepted', orderId, carrierId: shipment.carrierId });
    return;
  }

  const offeredId = String(shipment?.offeredCarrierId || '').trim();
  if (shipSnap.exists) {
    await shipSnap.ref.set(
      {
        shipmentStatus: 'cancelled',
        offeredCarrierId: null,
        carrierId: null,
        haulStage: 'cancelled',
        cancelledBy: 'customer',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'Customer cancelled before company verified',
      },
      { merge: true }
    );
  }
  await db.collection('orders').doc(orderId).set(
    {
      status: 'cancelled',
      haulStage: 'cancelled',
      cancellationReason: 'Customer cancelled before company verified',
      cancelledBy: 'customer',
      cancelledAt: FieldValue.serverTimestamp(),
      carrierMatchStatus: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const payload = { type: 'cancelled', orderId, by: 'customer' };
  broadcast(customersByOrder, orderId, payload);
  if (offeredId) broadcast(carriersById, offeredId, payload);
  send(socket, payload);
}

async function handleCarrierHello(socket, message) {
  const carrierId = await verifyUid(message.token);
  const meta = socketMeta.get(socket) || {};
  meta.role = 'carrier';
  meta.carrierId = carrierId;
  meta.userId = carrierId;
  socketMeta.set(socket, meta);
  addToMap(carriersById, carrierId, socket);
  send(socket, { type: 'hello_ok', role: 'carrier', carrierId });
}

async function handleCarrierAccept(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const carrierId = await verifyUid(message.token);
  if (!orderId || !carrierId) {
    send(socket, { type: 'error', message: 'orderId and token are required.' });
    return;
  }
  try {
    await acceptCarrierOfferViaWs(db, orderId, carrierId, message.actorEmail || 'carrier-ws');
    const carrier = await loadCarrierPublic(carrierId);
    const shipSnap = await db.collection('carrierShipments').doc(orderId).get();
    const payload = {
      type: 'accepted',
      orderId,
      carrierId,
      carrier,
      shipment: wireShipment(orderId, shipSnap.exists ? shipSnap.data() : null, null),
    };
    broadcast(customersByOrder, orderId, payload);
    broadcast(carriersById, carrierId, payload);
  } catch (error) {
    send(socket, {
      type: 'error',
      orderId,
      message: error instanceof Error ? error.message : 'Could not accept order.',
    });
  }
}

async function handleCarrierReject(socket, message) {
  const orderId = String(message.orderId || '').trim();
  const carrierId = await verifyUid(message.token);
  if (!orderId || !carrierId) {
    send(socket, { type: 'error', message: 'orderId and token are required.' });
    return;
  }
  try {
    broadcast(carriersById, carrierId, { type: 'offer_cleared', orderId, reason: 'rejected' });
    const result = await rejectCarrierOfferViaWs(db, orderId, carrierId, message.actorEmail || 'carrier-ws', {
      preferCarrierIds: new Set(carriersById.keys()),
      carrierDispatch: 'instant',
    });
    const fresh = await db.collection('orders').doc(orderId).get();
    await emitMatchState(orderId, result, fresh.exists ? { id: orderId, ...fresh.data() } : null);
  } catch (error) {
    send(socket, {
      type: 'error',
      orderId,
      message: error instanceof Error ? error.message : 'Could not reject order.',
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
        if (message.role === 'carrier') {
          await handleCarrierHello(socket, message);
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
      case 'carrier_accept':
      case 'accept':
        await handleCarrierAccept(socket, message);
        break;
      case 'carrier_reject':
      case 'reject':
      case 'decline':
        await handleCarrierReject(socket, message);
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
  if (meta.orderId) removeFromMap(customersByOrder, meta.orderId, socket);
  if (meta.carrierId) removeFromMap(carriersById, meta.carrierId, socket);
  socketMeta.delete(socket);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'parcel-offer-ws',
        port: PORT,
        customers: customersByOrder.size,
        carriers: carriersById.size,
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
  send(socket, { type: 'ready', service: 'parcel-offer-ws' });
  socket.on('message', (raw) => {
    void onMessage(socket, raw);
  });
  socket.on('close', () => detachSocket(socket));
  socket.on('error', () => detachSocket(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[parcel-offer-ws] listening on ws://0.0.0.0:${PORT}`);
});
