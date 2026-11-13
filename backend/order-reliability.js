/**
 * Cargo delivery reliability.
 *
 * Customer-app limitation (do not change the client): the customer app creates
 * orders by writing orders/{orderId} itself. Cloud Functions cannot join that
 * client transaction. Arrival functions are onParcelOrderMatchCarrier (create)
 * and onParcelOrderMatchCarrierUpdate (later match / customer cancel). This
 * module writes outbox + orderEvents + idempotency in the SAME transaction as
 * the carrierShipments / orders updates the backend does own.
 *
 * Missed-order cause: persistSenderPhone can create carrierShipments/{orderId}
 * before the exclusive offer commits. onParcelOrderMatchCarrier has a short
 * timeout and, historically, retry disabled. advanceCarrierOffers then skipped
 * any order that already had a shipment doc, including a status-less shell,
 * so the offer was never retried.
 *
 * Pub/Sub is optional. CARGO_OUTBOX_TOPIC empty means the consumer is the
 * Cloud Functions worker (onCargoOutboxCreated + advanceCarrierOffers). Do not
 * treat Pub/Sub as live unless a publish actually succeeds.
 */

const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const MAX_OUTBOX_ATTEMPTS = 8;
const EFFECT_LOCK_MS = 60_000;
const PROCESSING_STUCK_MS = 2 * 60_000;

function idempotencyDocId(key) {
  const clean = String(key || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 700);
  if (!clean) throw new Error('idempotency key required');
  return clean;
}

function offerIdempotencyKey(orderId, epoch) {
  return `offer_${orderId}_${Math.max(1, Math.round(Number(epoch) || 1))}`;
}

function acceptIdempotencyKey(orderId) {
  return `accept_${orderId}`;
}

function cancelIdempotencyKey(orderId) {
  return `cancel_${orderId}`;
}

function waitIdempotencyKey(orderId) {
  return `wait_${orderId}`;
}

function staleIdempotencyKey(orderId) {
  return `stale_${orderId}`;
}

function releaseIdempotencyKey(orderId, carrierId) {
  return `release_${orderId}_${carrierId}`;
}

function expiryMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function backoffMs(attempts) {
  const n = Math.max(1, Math.round(Number(attempts) || 1));
  return Math.min(60_000 * 2 ** (n - 1), 15 * 60_000);
}

/** Pure transition used by the drain and by tests. */
function nextOutboxState(event, { now = Date.now(), error = '', max = MAX_OUTBOX_ATTEMPTS } = {}) {
  const attempts = (Number(event?.attempts) || 0) + 1;
  const lastError = String(error || event?.lastError || '').slice(0, 240);
  if (attempts >= max) {
    return { status: 'dead', attempts, lastError: lastError || 'max attempts' };
  }
  return {
    status: 'pending',
    attempts,
    availableAtMs: now + backoffMs(attempts),
    lastError,
  };
}

/**
 * Why this shipment must not be offered again.
 * null means the matcher may still assign it.
 */
function shipmentBlocksOffer(shipment) {
  if (!shipment) return null;
  if (shipment.reassignBlocked || shipment.assignmentLocked === 'customer-cancel') return 'customer-cancelled';
  const status = String(shipment.shipmentStatus || '').toLowerCase();
  if (status === 'expired' || String(shipment.matchClosedReason || '').startsWith('stale')) return 'stale';
  if (status === 'cancelled' || status === 'canceled') return 'customer-cancelled';
  if (status === 'delivered') return 'delivered';
  if (shipment.carrierId) return 'accepted';
  return null;
}

/**
 * True when a carrierShipments doc is only a partial shell (party fields, no
 * offer). The reconcile sweep must still offer these. Real matching/assigned
 * rows and closed rows are not shells.
 */
function shipmentAwaitingFirstOffer(shipment) {
  if (!shipment) return true;
  if (shipmentBlocksOffer(shipment)) return false;
  if (shipment.carrierId || shipment.offeredCarrierId) return false;
  const status = String(shipment.shipmentStatus || '').toLowerCase();
  if (
    [
      'matching',
      'assigned',
      'accepted',
      'contacted',
      'pickup_scheduled',
      'picked_up',
      'at_bus',
      'in_transit',
      'arrived',
    ].includes(status)
  ) {
    return false;
  }
  return !status || status === 'new';
}

function visibleToCarrier(shipment, carrierId) {
  if (!shipment || !carrierId) return false;
  return shipment.offeredCarrierId === carrierId || shipment.carrierId === carrierId;
}

function acceptDecision(current, carrierId, now = Date.now(), order = null) {
  if (!current) return { ok: false, reason: 'missing' };
  const { isCustomerCancelledRecord } = require('./carrier-cancel');
  if (
    current.reassignBlocked ||
    current.assignmentLocked === 'customer-cancel' ||
    isCustomerCancelledRecord(order) ||
    isCustomerCancelledRecord(current)
  ) {
    return { ok: false, reason: 'cancelled' };
  }
  const holder = String(current.carrierId || '');
  const mine = String(carrierId || '');
  if (holder && holder !== mine) return { ok: false, reason: 'taken-by-other' };
  if (holder && holder === mine) return { ok: false, reason: 'already-self', already: true };
  if (String(current.offeredCarrierId || '') !== mine || String(current.shipmentStatus || '') !== 'assigned') {
    return { ok: false, reason: 'not-offered' };
  }
  const expires = expiryMs(current.offerExpiresAt);
  if (expires && expires <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function queueDeliveryEvent(tx, db, spec) {
  const eventId = idempotencyDocId(spec.eventId || `${spec.type}_${spec.orderId}`);
  const idempotencyKey = String(spec.idempotencyKey || '').trim();
  const payload = spec.payload && typeof spec.payload === 'object' ? spec.payload : {};
  tx.set(
    db.collection('outbox').doc(eventId),
    {
      orderId: String(spec.orderId || ''),
      type: String(spec.type || ''),
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_OUTBOX_ATTEMPTS,
      idempotencyKey,
      payload,
      availableAt: Timestamp.fromMillis(Date.now()),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    db.collection('orderEvents').doc(eventId),
    {
      orderId: String(spec.orderId || ''),
      type: String(spec.type || ''),
      idempotencyKey,
      payload,
      at: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (idempotencyKey) {
    tx.set(
      db.collection('idempotency').doc(idempotencyDocId(idempotencyKey)),
      {
        key: idempotencyKey,
        orderId: String(spec.orderId || ''),
        type: String(spec.type || ''),
        eventId,
        carrierId: String(spec.carrierId || payload.carrierId || ''),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  return eventId;
}

const CARGO_OUTBOX_TOPIC_NAME = 'cargo-order-events';

function pubsubTopic() {
  const fromEnv = String(process.env.CARGO_OUTBOX_TOPIC || '').trim();
  if (fromEnv === 'off' || fromEnv === '0') return '';
  if (fromEnv) return fromEnv;
  // Local tests stay quiet. Deployed Gen2 functions run on Cloud Run and publish
  // only when this process is actually a function. The topic is created in GCP;
  // a failed publish is logged and the Firestore worker still drains the outbox.
  if (process.env.K_SERVICE || process.env.FUNCTION_TARGET) return CARGO_OUTBOX_TOPIC_NAME;
  return '';
}

async function publishOutboxWake(eventId, orderId) {
  const topic = pubsubTopic();
  if (!topic) return { published: false, reason: 'not-configured' };
  try {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/pubsub'] });
    const client = await auth.getClient();
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'efootball-app-9d175';
    const url = `https://pubsub.googleapis.com/v1/projects/${project}/topics/${topic}:publish`;
    await client.request({
      url,
      method: 'POST',
      data: {
        messages: [
          {
            data: Buffer.from(JSON.stringify({ eventId, orderId: orderId || '' })).toString('base64'),
          },
        ],
      },
    });
    return { published: true, topic };
  } catch (error) {
    console.error('outbox pubsub publish failed', {
      eventId,
      topic,
      reason: error?.message || String(error),
    });
    return { published: false, reason: error?.message || 'publish-failed', topic };
  }
}

async function claimIdempotentEffect(db, key) {
  const ref = db.collection('idempotency').doc(idempotencyDocId(`effect_${key}`));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    if (data.status === 'done') return 'done';
    const locked = expiryMs(data.lockedAt);
    if (data.status === 'sending' && locked && Date.now() - locked < EFFECT_LOCK_MS) return 'busy';
    tx.set(
      ref,
      {
        status: 'sending',
        key: String(key || ''),
        lockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return 'claimed';
  });
}

async function finishIdempotentEffect(db, key, error) {
  const ref = db.collection('idempotency').doc(idempotencyDocId(`effect_${key}`));
  if (error) {
    await ref.set(
      {
        status: 'pending',
        lastError: String(error?.message || error).slice(0, 240),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }
  await ref.set(
    {
      status: 'done',
      doneAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function applyOutboxEffects(db, eventId, data) {
  const type = String(data?.type || '');
  const orderId = String(data?.orderId || '');
  const payload = data?.payload || {};
  if (!orderId || !type || type === 'shipment.waiting' || type === 'shipment.accepted' || type === 'shipment.released' || type === 'shipment.parked') {
    return;
  }
  if (type === 'shipment.offered') {
    const carrierId = String(payload.carrierId || '');
    const shipmentSnap = await db.collection('carrierShipments').doc(orderId).get();
    const shipment = shipmentSnap.exists ? { id: orderId, ...shipmentSnap.data() } : { id: orderId };
    const blocked = shipmentBlocksOffer(shipment);
    if (blocked === 'customer-cancelled' || blocked === 'stale' || blocked === 'delivered') return;
    const stillHeld =
      String(shipment.offeredCarrierId || '') === carrierId || String(shipment.carrierId || '') === carrierId;
    if (!stillHeld) return;
    const orderSnap = await db.collection('orders').doc(orderId).get();
    const order = orderSnap.exists ? { id: orderId, ...orderSnap.data() } : null;
    const { sendCompanyOfferSms, sendSenderCompanyFoundSms } = require('./carrier-sms');
    const { notifyCarrierNewOffer } = require('./carrier-push');
    await sendCompanyOfferSms(db, { orderId, shipment, carrierId, order }).catch((error) => {
      console.error('outbox company sms failed', { eventId, orderId, reason: error?.message || String(error) });
      throw error;
    });
    await sendSenderCompanyFoundSms(db, { orderId, shipment, carrierId, order }).catch((error) => {
      console.error('outbox sender sms failed', { eventId, orderId, reason: error?.message || String(error) });
      throw error;
    });
    const push = await notifyCarrierNewOffer(db, {
      carrierId,
      orderId,
      orderNumber: payload.orderNumber || shipment.orderNumber || '',
      destination: payload.destination || shipment.destination || '',
      score: payload.score || null,
    });
    if (push?.reason === 'busy') {
      const busy = new Error('effect-busy');
      busy.code = 'effect-busy';
      throw busy;
    }
    return;
  }
  if (type === 'shipment.cancelled') {
    const { deliverShipmentCancelled } = require('./carrier-cancel');
    const result = await deliverShipmentCancelled(db, {
      orderId,
      carrierId: payload.carrierId || '',
      orderNumber: payload.orderNumber || '',
    });
    if (result?.reason === 'busy') {
      const busy = new Error('effect-busy');
      busy.code = 'effect-busy';
      throw busy;
    }
  }
}

async function processOutboxEvent(db, eventId) {
  const id = String(eventId || '').trim();
  if (!id) return { skipped: true, reason: 'missing' };
  const ref = db.collection('outbox').doc(id);
    const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { skip: true, reason: 'missing' };
    const data = snap.data() || {};
    if (data.status === 'done' || data.status === 'dead') return { skip: true, reason: data.status };
    const available = expiryMs(data.availableAt);
    if (data.status === 'pending' && available && available > Date.now()) return { skip: true, reason: 'waiting' };
    const locked = expiryMs(data.lockedAt);
    if (data.status === 'processing' && locked && Date.now() - locked < PROCESSING_STUCK_MS) {
      return { skip: true, reason: 'processing' };
    }
    const max = Number(data.maxAttempts) || MAX_OUTBOX_ATTEMPTS;
    const attempts = Number(data.attempts) || 0;
    if (attempts >= max) {
      tx.set(
        ref,
        {
          status: 'dead',
          deadAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastError: String(data.lastError || 'max attempts').slice(0, 240),
        },
        { merge: true }
      );
      return { dead: true, attempts, data };
    }
    tx.set(
      ref,
      {
        status: 'processing',
        lockedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { data };
  });

  if (!claim || claim.skip) return claim || { skipped: true };
  if (claim.dead) {
    console.error('outbox dead-letter', {
      eventId: id,
      orderId: claim.data?.orderId || '',
      type: claim.data?.type || '',
      attempts: claim.attempts,
      lastError: claim.data?.lastError || 'max attempts',
    });
    return { dead: true, eventId: id };
  }

  try {
    await applyOutboxEffects(db, id, claim.data);
    await ref.set(
      {
        status: 'done',
        processedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
      },
      { merge: true }
    );
    return { done: true, eventId: id, type: claim.data?.type || '' };
  } catch (error) {
    const next = nextOutboxState(claim.data || {}, {
      now: Date.now(),
      error: error?.message || 'failed',
      max: Number(claim.data?.maxAttempts) || MAX_OUTBOX_ATTEMPTS,
    });
    const patch = {
      status: next.status,
      attempts: next.attempts,
      lastError: next.lastError,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (next.status === 'dead') {
      patch.deadAt = FieldValue.serverTimestamp();
      console.error('outbox dead-letter', {
        eventId: id,
        orderId: claim.data?.orderId || '',
        type: claim.data?.type || '',
        attempts: next.attempts,
        lastError: next.lastError,
      });
    } else {
      patch.availableAt = Timestamp.fromMillis(next.availableAtMs);
    }
    await ref.set(patch, { merge: true });
    return { failed: true, eventId: id, status: next.status, lastError: next.lastError };
  }
}

async function drainOutbox(db, limit = 20) {
  const page = Math.max(1, Math.min(40, Number(limit) || 20));
  const [pendingSnap, processingSnap] = await Promise.all([
    db.collection('outbox').where('status', '==', 'pending').limit(page).get(),
    db.collection('outbox').where('status', '==', 'processing').limit(Math.min(10, page)).get(),
  ]);
  const ids = new Set();
  pendingSnap.docs.forEach((doc) => ids.add(doc.id));
  processingSnap.docs.forEach((doc) => ids.add(doc.id));
  const summary = { checked: ids.size, done: 0, dead: 0, failed: 0, skipped: 0 };
  for (const eventId of ids) {
    try {
      const result = await processOutboxEvent(db, eventId);
      if (result?.done) summary.done += 1;
      else if (result?.dead) summary.dead += 1;
      else if (result?.failed) summary.failed += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('outbox drain item failed', { eventId, reason: error?.message || String(error) });
    }
  }
  if (summary.dead) {
    console.error('outbox dead-letter sweep', summary);
  } else if (summary.done || summary.failed) {
    console.info('outbox drain', summary);
  }
  return summary;
}

module.exports = {
  EFFECT_LOCK_MS,
  MAX_OUTBOX_ATTEMPTS,
  acceptDecision,
  acceptIdempotencyKey,
  backoffMs,
  cancelIdempotencyKey,
  claimIdempotentEffect,
  drainOutbox,
  finishIdempotentEffect,
  idempotencyDocId,
  nextOutboxState,
  offerIdempotencyKey,
  processOutboxEvent,
  pubsubTopic,
  publishOutboxWake,
  queueDeliveryEvent,
  releaseIdempotencyKey,
  shipmentAwaitingFirstOffer,
  shipmentBlocksOffer,
  staleIdempotencyKey,
  visibleToCarrier,
  waitIdempotencyKey,
};
