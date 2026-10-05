/* eslint-disable no-console */
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { config } = require('../config');
const { syncCarrierShipment } = require('../carrier-matching');

function ensureAdmin() {
  if (getApps().length) {
    return;
  }
  const options = {};
  if (config.firebaseServiceAccount) {
    options.credential = cert(config.firebaseServiceAccount);
  }
  if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
    options.projectId = config.firebaseProjectId || config.firebaseServiceAccount?.project_id;
  }
  initializeApp(options);
}

async function main() {
  const orderId = String(process.argv[2] || 'rxn4YuLLd3kd0DhwZeLm').trim();
  if (!orderId) {
    throw new Error('orderId required');
  }

  ensureAdmin();
  const db = getFirestore();
  const shipmentSnap = await db.collection('carrierShipments').doc(orderId).get();
  if (!shipmentSnap.exists) {
    console.log(JSON.stringify({ ok: false, reason: 'missing-shipment', orderId }));
    return;
  }

  const shipment = shipmentSnap.data();
  await syncCarrierShipment(db, orderId, shipment, shipment);

  const orderSnap = await db.collection('orders').doc(orderId).get();
  const order = orderSnap.data() || {};
  console.log(
    JSON.stringify({
      ok: true,
      orderId,
      carrierName: String(order.carrierName || '').trim() || null,
      carrierAgentName: String(order.carrierAgentName || '').trim() || null,
      carrierBusName: String(order.carrierBusName || order.carrierRouteLabel || '').trim() || null,
      hasCarrierPhone: Boolean(String(order.carrierPhone || '').trim()),
      parcelCode: String(order.parcelCode || '').trim() || null,
      carrierMatchStatus: order.carrierMatchStatus || null,
    })
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
