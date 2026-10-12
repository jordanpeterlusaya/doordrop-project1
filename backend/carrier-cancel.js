const { FieldValue } = require('firebase-admin/firestore');

/**
 * When a customer cancels before pickup, clear the open offer/assignment from
 * carrierShipments and notify the agent so the inbox updates immediately.
 */
async function clearCarrierOfferOnCustomerCancel(db, orderId, order) {
  if (!orderId || !order) return { skipped: true, reason: 'missing' };
  if (String(order.status || '') !== 'cancelled') {
    return { skipped: true, reason: 'not-cancelled' };
  }

  const shipmentRef = db.collection('carrierShipments').doc(orderId);
  const snap = await shipmentRef.get();
  if (!snap.exists) {
    return { skipped: true, reason: 'no-shipment' };
  }

  const shipment = snap.data() || {};
  const status = String(shipment.shipmentStatus || '').toLowerCase();
  const track = String(shipment.trackStep || '').toLowerCase();
  const postPickupStatuses = new Set([
    'picked_up',
    'at_bus',
    'in_transit',
    'arrived',
    'delivered',
  ]);
  const postPickupTracks = new Set(['packed', 'transit', 'arrived', 'handed']);

  if (postPickupStatuses.has(status) || postPickupTracks.has(track)) {
    console.warn('carrier-cancel ignored post-pickup', { orderId, status, track });
    return { skipped: true, reason: 'post-pickup' };
  }

  const notifyCarrierId = String(shipment.offeredCarrierId || shipment.carrierId || '').trim();
  const alreadyTerminal = ['cancelled', 'matching'].includes(status) && !shipment.offeredCarrierId && !shipment.carrierId;
  if (alreadyTerminal && String(shipment.cancelledBy || '') === 'customer') {
    return { skipped: true, reason: 'already-cleared' };
  }

  await shipmentRef.set(
    {
      shipmentStatus: 'cancelled',
      offeredCarrierId: null,
      carrierId: null,
      capacityReserved: false,
      trackStep: FieldValue.delete(),
      cancelledBy: 'customer',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: String(order.cancellationReason || 'Customer cancelled').slice(0, 240),
      statusHistory: FieldValue.arrayUnion({
        status: 'cancelled',
        label: 'Imefutwa na mteja',
        at: new Date().toISOString(),
        actor: 'customer',
      }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection('orders').doc(orderId).set(
    {
      carrierMatchStatus: 'matching',
      carrierTrackStep: FieldValue.delete(),
      carrierShipmentId: orderId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

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
  return { cleared: true, carrierId: notifyCarrierId || null };
}

module.exports = {
  clearCarrierOfferOnCustomerCancel,
};
