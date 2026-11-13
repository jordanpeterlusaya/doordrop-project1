const { FieldValue } = require('firebase-admin/firestore');

const NON_CUSTOMER_ACTORS = new Set(['dispatch', 'driver', 'company', 'carrier', 'agent', 'transporter']);
const POST_PICKUP_STATUSES = new Set(['picked_up', 'at_bus', 'in_transit', 'arrived', 'delivered']);
const POST_PICKUP_TRACKS = new Set(['packed', 'transit', 'arrived', 'handed']);
const DESK_STATUSES = ['assigned', 'matching', 'accepted', 'contacted', 'pickup_scheduled'];

function isCustomerCancelledRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const by = String(record.cancelledBy || record.canceledBy || '').trim().toLowerCase();
  const status = String(record.status || record.shipmentStatus || '').trim().toLowerCase();
  const stage = String(record.haulStage || '').trim().toLowerCase();
  const quote = String(record.quoteStatus || '').trim().toLowerCase();
  if (by === 'customer') return true;
  if (stage === 'cancelled' || stage === 'canceled') return true;
  if (quote === 'declined') return true;
  if (status === 'cancelled' || status === 'canceled') return !NON_CUSTOMER_ACTORS.has(by);
  return false;
}

function isPostPickupShipment(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const track = String(shipment?.trackStep || '').toLowerCase();
  return POST_PICKUP_STATUSES.has(status) || POST_PICKUP_TRACKS.has(track);
}

function customerCancelShipmentPatch(shipment, order) {
  const reason = String(
    order?.cancellationReason || order?.cancelReason || shipment?.cancelReason || 'Customer cancelled'
  ).slice(0, 240);
  const postPickup = isPostPickupShipment(shipment);
  const patch = {
    offeredCarrierId: null,
    cancelledBy: 'customer',
    haulStage: 'cancelled',
    reassignBlocked: true,
    assignmentLocked: 'customer-cancel',
    cancelReason: reason,
    cancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!postPickup) {
    patch.shipmentStatus = 'cancelled';
    patch.carrierId = null;
    patch.capacityReserved = false;
    patch.trackStep = FieldValue.delete();
    patch.statusHistory = FieldValue.arrayUnion({
      status: 'cancelled',
      label: 'Imefutwa na mteja',
      at: new Date().toISOString(),
      actor: 'customer',
    });
  }
  return { patch, postPickup, reason };
}

function offerAlreadyCleared(shipment) {
  if (!shipment) return false;
  if (String(shipment.cancelledBy || '') !== 'customer') return false;
  if (shipment.offeredCarrierId) return false;
  if (String(shipment.haulStage || '').toLowerCase() !== 'cancelled') return false;
  if (isPostPickupShipment(shipment)) return true;
  const status = String(shipment.shipmentStatus || '').toLowerCase();
  return (status === 'cancelled' || status === 'canceled') && !shipment.carrierId;
}

/** One inbox row + one push per cancelled order, including outbox retries. */
async function deliverShipmentCancelled(db, { orderId, carrierId, orderNumber }) {
  const id = String(carrierId || '').trim();
  const shipmentId = String(orderId || '').trim();
  if (!id || !shipmentId) return { skipped: true, reason: 'missing' };
  const { claimIdempotentEffect, finishIdempotentEffect } = require('./order-reliability');
  const effectKey = `push_cancel_${shipmentId}`;
  const claim = await claimIdempotentEffect(db, effectKey);
  if (claim === 'done' || claim === 'busy') return { skipped: true, reason: claim };
  const title = 'Oda imefutwa';
  const body = `${orderNumber || shipmentId} · mteja amefuta oda`;
  try {
    await db.collection('carriers').doc(id).collection('notifications').doc(`cancel_${shipmentId}`).set(
      {
        title,
        body,
        orderId: shipmentId,
        type: 'carrier_offer_cancelled',
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      },
      { merge: true }
    );
    const { collectCarrierPushTokens } = require('./carrier-push');
    const tokens = await collectCarrierPushTokens(db, id);
    const data = {
      type: 'carrier_offer_cancelled',
      orderId: shipmentId,
      orderNumber: String(orderNumber || ''),
    };
    if (tokens.expo.length) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          tokens.expo.map((to) => ({
            to,
            sound: 'default',
            title,
            body,
            priority: 'high',
            channelId: 'carrier_offers',
            data,
          }))
        ),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
    }
    if (tokens.fcm.length) {
      const { getMessaging } = require('firebase-admin/messaging');
      const messaging = getMessaging();
      for (const token of tokens.fcm) {
        try {
          await messaging.send({
            token,
            notification: { title, body },
            data,
            android: {
              priority: 'high',
              notification: { channelId: 'carrier_offers', sound: 'default' },
            },
          });
        } catch {
          // ignore per-token failures
        }
      }
    }
    await finishIdempotentEffect(db, effectKey);
    return { sent: true };
  } catch (error) {
    await finishIdempotentEffect(db, effectKey, error);
    console.warn('carrier-cancel push failed', {
      orderId: shipmentId,
      carrierId: id,
      reason: error?.message || 'error',
    });
    return { sent: false, reason: error?.message || 'error' };
  }
}

/**
 * When a customer cancels, drop the offer from the company desk.
 * Pre-pickup assignments lose offeredCarrierId and carrierId so portal queries stop returning them.
 * Cargo already picked up keeps carrierId, but is stamped so the portal hides it.
 */
async function clearCarrierOfferOnCustomerCancel(db, orderId, order, shipmentHint, options = {}) {
  if (!orderId || !order) return { skipped: true, reason: 'missing' };
  const hinted = shipmentHint || null;
  if (!isCustomerCancelledRecord(order) && !isCustomerCancelledRecord(hinted)) {
    return { skipped: true, reason: 'not-cancelled' };
  }

  const shipmentRef = db.collection('carrierShipments').doc(orderId);
  const orderRef = db.collection('orders').doc(orderId);
  const preserveAccepted = options.preserveAccepted === true;
  const {
    cancelIdempotencyKey,
    idempotencyDocId,
    queueDeliveryEvent,
  } = require('./order-reliability');
  const cancelKey = cancelIdempotencyKey(orderId);

  const result = await db.runTransaction(async (tx) => {
    const shipSnap = await tx.get(shipmentRef);
    const orderSnap = await tx.get(orderRef);
    const idemSnap = await tx.get(db.collection('idempotency').doc(idempotencyDocId(cancelKey)));
    const shipment = shipSnap.exists ? shipSnap.data() || {} : hinted || {};
    if (preserveAccepted && shipment.carrierId) {
      return { skipped: true, reason: 'already-accepted', carrierId: String(shipment.carrierId) };
    }
    const hasShipment = shipSnap.exists || Boolean(hinted);
    if (!hasShipment && !orderSnap.exists) {
      return { skipped: true, reason: 'no-shipment' };
    }
    if (offerAlreadyCleared(shipment) && idemSnap.exists) {
      return { skipped: true, reason: 'already-cleared' };
    }

    const { patch, postPickup, reason } = customerCancelShipmentPatch(shipment, order);
    if (idemSnap.exists || offerAlreadyCleared(shipment)) delete patch.statusHistory;
    const notifyCarrierId = String(shipment.offeredCarrierId || shipment.carrierId || '').trim();
    if (hasShipment) tx.set(shipmentRef, patch, { merge: true });

    const liveOrder = orderSnap.exists ? orderSnap.data() || {} : {};
    const orderPatch = {
      haulStage: 'cancelled',
      carrierMatchStatus: 'cancelled',
      carrierTrackStep: FieldValue.delete(),
      carrierShipmentId: orderId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!isCustomerCancelledRecord(liveOrder)) {
      orderPatch.status = 'cancelled';
      orderPatch.cancelledBy = 'customer';
      orderPatch.cancellationReason = reason;
      orderPatch.cancelledAt = FieldValue.serverTimestamp();
    }
    if (orderSnap.exists) tx.set(orderRef, orderPatch, { merge: true });
    if (!idemSnap.exists) {
      queueDeliveryEvent(tx, db, {
        eventId: `cancel_${orderId}`,
        type: 'shipment.cancelled',
        idempotencyKey: cancelKey,
        orderId,
        carrierId: notifyCarrierId,
        payload: {
          carrierId: notifyCarrierId,
          orderNumber: String(order.orderNumber || shipment.orderNumber || ''),
          postPickup: Boolean(postPickup),
        },
      });
    }
    return {
      cleared: true,
      carrierId: notifyCarrierId || null,
      postPickup,
      duplicate: idemSnap.exists,
      orderNumber: String(order.orderNumber || shipment.orderNumber || ''),
    };
  });

  if (!result?.cleared) return result || { skipped: true };
  const { postPickup } = result;
  const notifyCarrierId = String(result.carrierId || '').trim();
  if (postPickup) {
    console.warn('carrier-cancel hiding post-pickup from transporter', {
      orderId,
      status: hinted?.shipmentStatus || '',
      track: hinted?.trackStep || '',
    });
  }
  if (notifyCarrierId && !result.duplicate) {
    await deliverShipmentCancelled(db, {
      orderId,
      carrierId: notifyCarrierId,
      orderNumber: result.orderNumber || order.orderNumber || '',
    });
  }

  console.info('carrier-cancel cleared offer', {
    orderId,
    carrierId: notifyCarrierId || null,
  });
  return { cleared: true, carrierId: notifyCarrierId || null, postPickup };
}

/** Drop customer-cancelled orders that are still offered or owned on a company desk. */
async function releaseOpenCustomerCancelledOffers(db) {
  const [assignedSnap, openSnap, cancelledSnap, transitSnap] = await Promise.all([
    db.collection('carrierShipments').where('shipmentStatus', '==', 'assigned').limit(100).get(),
    db.collection('carrierShipments').where('shipmentStatus', 'in', DESK_STATUSES.filter((status) => status !== 'assigned')).limit(80).get(),
    db.collection('carrierShipments').where('shipmentStatus', '==', 'cancelled').limit(80).get(),
    db.collection('carrierShipments').where('shipmentStatus', 'in', ['picked_up', 'at_bus', 'in_transit']).limit(40).get(),
  ]);
  const docs = new Map();
  [...assignedSnap.docs, ...openSnap.docs, ...cancelledSnap.docs, ...transitSnap.docs].forEach((doc) => docs.set(doc.id, doc));
  let released = 0;
  for (const doc of docs.values()) {
    const shipment = { id: doc.id, ...(doc.data() || {}) };
    if (!shipment.offeredCarrierId && !shipment.carrierId) continue;
    const orderSnap = await db.collection('orders').doc(doc.id).get();
    const order = orderSnap.exists ? { id: orderSnap.id, ...orderSnap.data() } : null;
    if (!isCustomerCancelledRecord(order) && !isCustomerCancelledRecord(shipment)) continue;
    const result = await clearCarrierOfferOnCustomerCancel(
      db,
      doc.id,
      order || {
        id: doc.id,
        status: 'cancelled',
        cancelledBy: 'customer',
        cancellationReason: shipment.cancelReason || 'Customer cancelled',
      },
      shipment
    );
    if (result?.cleared) released += 1;
  }
  if (released) console.info('carrier-cancel released customer-cancelled offers', { released });
  return released;
}

module.exports = {
  DESK_STATUSES,
  clearCarrierOfferOnCustomerCancel,
  customerCancelShipmentPatch,
  deliverShipmentCancelled,
  isCustomerCancelledRecord,
  releaseOpenCustomerCancelledOffers,
};
