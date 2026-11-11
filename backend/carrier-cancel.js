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

/**
 * When a customer cancels, drop the offer from the company desk.
 * Pre-pickup assignments lose offeredCarrierId and carrierId so portal queries stop returning them.
 * Cargo already picked up keeps carrierId, but is stamped so the portal hides it.
 */
async function clearCarrierOfferOnCustomerCancel(db, orderId, order, shipmentHint) {
  if (!orderId || !order) return { skipped: true, reason: 'missing' };
  const hinted = shipmentHint || null;
  if (!isCustomerCancelledRecord(order) && !isCustomerCancelledRecord(hinted)) {
    return { skipped: true, reason: 'not-cancelled' };
  }

  const shipmentRef = db.collection('carrierShipments').doc(orderId);
  const snap = hinted ? null : await shipmentRef.get();
  if (!hinted && snap && !snap.exists) {
    return { skipped: true, reason: 'no-shipment' };
  }

  const shipment = hinted || snap.data() || {};
  if (offerAlreadyCleared(shipment)) {
    return { skipped: true, reason: 'already-cleared' };
  }

  const { patch, postPickup, reason } = customerCancelShipmentPatch(shipment, order);
  const notifyCarrierId = String(shipment.offeredCarrierId || shipment.carrierId || '').trim();
  if (postPickup) {
    console.warn('carrier-cancel hiding post-pickup from transporter', {
      orderId,
      status: shipment.shipmentStatus || '',
      track: shipment.trackStep || '',
    });
  }

  await shipmentRef.set(patch, { merge: true });

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (orderSnap.exists) {
    const liveOrder = orderSnap.data() || {};
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
    await orderRef.set(orderPatch, { merge: true });
  }

  if (notifyCarrierId) {
    const title = 'Oda imefutwa';
    const body = `${order.orderNumber || orderId} · mteja amefuta oda`;
    await db.collection('carriers').doc(notifyCarrierId).collection('notifications').doc().set({
      title,
      body,
      orderId,
      type: 'carrier_offer_cancelled',
      createdAt: FieldValue.serverTimestamp(),
      read: false,
    });

    try {
      const { collectCarrierPushTokens, isExpoPushToken } = require('./carrier-push');
      const tokens = await collectCarrierPushTokens(db, notifyCarrierId);
      const data = {
        type: 'carrier_offer_cancelled',
        orderId: String(orderId),
        orderNumber: String(order.orderNumber || ''),
      };
      const expoMessages = tokens.expo.map((to) => ({
        to,
        sound: 'default',
        title,
        body,
        priority: 'high',
        channelId: 'carrier_offers',
        data,
      }));
      if (expoMessages.length) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(expoMessages),
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
      void isExpoPushToken;
    } catch (error) {
      console.warn('carrier-cancel push failed', {
        orderId,
        carrierId: notifyCarrierId,
        reason: error?.message || 'error',
      });
    }
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
  isCustomerCancelledRecord,
  releaseOpenCustomerCancelledOffers,
};
