const { FieldValue } = require('firebase-admin/firestore');

const { ensureFirebaseAdmin, readJsonBodyLimited, requireAuthenticatedUser } = require('./media-upload');
const { carrierStanding, commissionPayCeiling } = require('./carrier-matching');
const { outstandingFee } = require('./carrier-commission');

const JOURNEY_STATUSES = ['in_transit', 'at_checkpoint', 'near_destination', 'delivered'];
const OWNED_BEFORE_TRANSIT = ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'];

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function dbHandle() {
  ensureFirebaseAdmin();
  const { getFirestore } = require('firebase-admin/firestore');
  return getFirestore();
}

async function resolveCarrierId(db, uid) {
  const member = await db.collection('carrierMembers').doc(uid).get();
  if (member.exists) {
    const id = String(member.data()?.carrierId || '').trim();
    if (id) return id;
  }
  const owned = await db.collection('carriers').doc(uid).get();
  if (owned.exists) return owned.id;
  return '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 10) return `255${digits.slice(1, 10)}`;
  if (digits.startsWith('255')) return digits.slice(0, 12);
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function deliveryFeeOf(shipment) {
  const fee = Math.round(Number(shipment?.cashExpected) || 0);
  return fee > 0 ? fee : 0;
}

function standingFor(carrier) {
  return (
    carrier?.deskStanding ||
    carrierStanding({
      streak: carrier?.streak,
      completed: carrier?.deliveries || carrier?.completedShipments,
      rejects: carrier?.rejected,
      postAcceptCancels: carrier?.postAcceptCancels,
    })
  );
}

function eligibilityFor(carrier, shipments) {
  const standing = standingFor(carrier);
  const ceiling = commissionPayCeiling(standing);
  const unpaid = (shipments || []).reduce((sum, item) => sum + outstandingFee(item), 0);
  const paused = Boolean(carrier?.offersPaused || carrier?.fraudHold || standing.closure || unpaid >= ceiling);
  const approaching = !paused && ceiling > 0 && unpaid >= ceiling * 0.8;
  return {
    eligible: !paused,
    state: paused ? 'paused' : approaching ? 'approaching' : 'eligible',
    label: paused
      ? 'Limit Reached — Orders Paused'
      : approaching
        ? 'Approaching Commission Limit'
        : 'Eligible to Receive Orders',
    thresholdTzs: ceiling,
    outstandingTzs: unpaid,
    remainingTzs: Math.max(0, ceiling - unpaid),
    amountToRestoreTzs: paused ? Math.max(0, unpaid - ceiling + 1) : 0,
    feePercent: standing.feePercent,
    feeRate: Number(standing.feeRate) || Number(standing.feePercent) / 100 || 0.12,
  };
}

function assertCanAccept(current, carrierId) {
  if (current.carrierId && current.carrierId !== carrierId) throw conflict('This order is already accepted by another company.');
  if (current.carrierId === carrierId) throw conflict('This order is already accepted.');
  if (current.offeredCarrierId !== carrierId || current.shipmentStatus !== 'assigned') {
    throw conflict('This order is no longer available to accept.');
  }
  if (!current.transporterVerifiedAt) throw badRequest('Verify the order before accepting it.');
}

function financeRow(shipment, feePercent) {
  const deliveryFee = deliveryFeeOf(shipment);
  const cargoValue = Math.round(Number(shipment.declaredValueTzs) || 0);
  const rate = Number.isFinite(Number(shipment.haulFeeRate)) ? Number(shipment.haulFeeRate) : feePercent / 100;
  const commission = Math.round(Number(shipment.haulFee) || 0);
  const paid = shipment.cashStatus === 'reconciled' ? commission : Math.min(commission, Math.round(Number(shipment.commissionPaidTzs) || 0));
  const due = Math.max(0, commission - paid);
  const paymentStatus = due <= 0 && commission > 0 ? 'paid' : shipment.commissionPaymentStatus === 'pending' ? 'pending_verification' : 'unpaid';
  return {
    orderId: shipment.id,
    cargoValueTzs: cargoValue,
    deliveryFeeTzs: deliveryFee,
    commissionRate: rate,
    commissionTzs: commission,
    netTzs: Math.max(0, deliveryFee - commission),
    paymentStatus,
    paidTzs: paid,
    dueTzs: due,
  };
}

function customerMatchStatus(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').trim();
  if (step === 'handed' || status === 'delivered') return 'accepted';
  if (shipment?.carrierId) return 'accepted';
  if (['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus', 'in_transit', 'arrived'].includes(status)) {
    return 'accepted';
  }
  if (shipment?.offeredCarrierId || status === 'assigned') return 'offered';
  return 'matching';
}

async function mirrorCustomer(db, shipment) {
  const orderId = String(shipment.orderId || shipment.id || '').trim();
  if (!orderId) return;
  const latest = shipment.latestJourney || {};
  const matchStatus = customerMatchStatus(shipment);
  const trackStep = String(shipment.trackStep || '').trim();
  const pickupMode = String(shipment.pickupMode || '').trim();
  const patch = {
    carrierShipmentId: orderId,
    carrierMatchStatus: matchStatus,
    carrierRouteLabel: String(shipment.routeLabel || '').trim(),
    carrierPickupMode: pickupMode || FieldValue.delete(),
    carrierTrackStep: trackStep || FieldValue.delete(),
    carrierJourneyStatus: latest.status || shipment.journeyStatus || shipment.shipmentStatus || '',
    carrierJourneyMessage: latest.message || '',
    carrierLocationLabel: latest.locationName || '',
    carrierLocationSource: latest.locationSource || '',
    carrierLatitude: Number.isFinite(Number(latest.latitude)) ? Number(latest.latitude) : FieldValue.delete(),
    carrierLongitude: Number.isFinite(Number(latest.longitude)) ? Number(latest.longitude) : FieldValue.delete(),
    carrierEtaLabel: latest.eta || '',
    carrierJourneyAt: latest.at || new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (matchStatus === 'matching') {
    patch.carrierName = FieldValue.delete();
    patch.carrierAgentName = FieldValue.delete();
    patch.carrierPhone = FieldValue.delete();
    patch.carrierBusName = FieldValue.delete();
  }
  if (shipment.shipmentStatus === 'delivered' || trackStep === 'handed') {
    patch.status = 'delivered';
    patch.logisticsStatus = 'completed';
    patch.carrierMatchStatus = 'accepted';
    patch.deliveredAt = FieldValue.serverTimestamp();
  }
  await db.collection('orders').doc(orderId).set(patch, { merge: true });
}

async function requireCarrierContext(req) {
  const decoded = await requireAuthenticatedUser(req);
  const db = dbHandle();
  const carrierId = await resolveCarrierId(db, decoded.uid);
  if (!carrierId) throw forbidden('This login is not linked to a transport company.');
  const carrierSnap = await db.collection('carriers').doc(carrierId).get();
  if (!carrierSnap.exists) throw notFound('Company not found.');
  return { db, decoded, carrierId, carrier: { id: carrierId, ...carrierSnap.data() } };
}

async function shipmentForCarrier(db, carrierId, shipmentId) {
  const id = String(shipmentId || '').trim();
  if (!id) throw badRequest('Order id is required.');
  const snap = await db.collection('carrierShipments').doc(id).get();
  if (!snap.exists) throw notFound('Order not found.');
  const data = { id: snap.id, ...snap.data() };
  const offered = data.offeredCarrierId === carrierId;
  const owned = data.carrierId === carrierId;
  if (!offered && !owned) throw forbidden('This order belongs to another company.');
  return { ref: snap.ref, shipment: data };
}

async function handlePortalVerify(req) {
  const { db, decoded, carrierId } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 8 * 1024);
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  if (shipment.shipmentStatus !== 'assigned' || shipment.offeredCarrierId !== carrierId || shipment.carrierId) {
    throw conflict('Only a new offer can be verified.');
  }
  if (shipment.transporterVerifiedAt) return { ok: true, already: true, shipmentId: shipment.id };
  const at = new Date().toISOString();
  await ref.set(
    {
      transporterVerifiedAt: FieldValue.serverTimestamp(),
      transporterVerifiedBy: decoded.email || decoded.uid,
      portalStage: 'verified',
      latestJourney: { status: 'verified', message: 'Order verified by the transport company.', at, locationSource: '' },
      statusHistory: FieldValue.arrayUnion({ status: 'verified', label: 'Verified', at, actor: decoded.email || decoded.uid }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await mirrorCustomer(db, { ...shipment, latestJourney: { status: 'verified', message: 'Order verified by the transport company.', at } });
  return { ok: true, shipmentId: shipment.id, verifiedAt: at };
}

async function handlePortalAccept(req) {
  const { db, decoded, carrierId, carrier } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 8 * 1024);
  const ownedSnap = await db.collection('carrierShipments').where('carrierId', '==', carrierId).get();
  const owned = ownedSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const gate = eligibilityFor(carrier, owned);
  if (!gate.eligible) throw forbidden('Commission limit reached. Pay the outstanding balance before accepting new orders.');
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  assertCanAccept(shipment, carrierId);
  const at = new Date().toISOString();
  const rate = gate.feeRate;
  const needsQuote =
    String(shipment.quoteStatus || '') === 'awaiting_company' ||
    (String(shipment.quoteStatus || '') === 'offered' && deliveryFeeOf(shipment) <= 0) ||
    deliveryFeeOf(shipment) <= 0;
  let fee = deliveryFeeOf(shipment);
  if (body.amountTzs != null && body.amountTzs !== '') {
    fee = Math.round(Number(body.amountTzs) || 0);
  }
  if (needsQuote && (fee < 1000 || fee > 50000000)) {
    throw badRequest('Enter the delivery price in TZS before taking this order.');
  }
  const requestedCommission = body.commissionTzs != null && body.commissionTzs !== ''
    ? Math.round(Number(body.commissionTzs) || 0)
    : null;
  const haulFee =
    requestedCommission != null
      ? Math.max(0, Math.min(fee, requestedCommission))
      : shipment.haulFee != null && Number(shipment.haulFee) > 0
        ? Math.round(Number(shipment.haulFee) || 0)
        : Math.round(fee * rate);
  const label = fee > 0 ? `TZS ${fee.toLocaleString('en-US')}` : String(shipment.fareLabel || '').trim();
  const orderId = String(shipment.orderId || shipment.id || '').trim();
  let orderExtras = {};
  if (orderId) {
    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (orderSnap.exists) {
      const order = orderSnap.data() || {};
      const photos = Array.isArray(order.parcelPhotoUrls)
        ? order.parcelPhotoUrls.map((url) => String(url || '').trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 6)
        : [];
      if (photos.length && !(Array.isArray(shipment.parcelPhotoUrls) && shipment.parcelPhotoUrls.length)) {
        orderExtras.parcelPhotoUrls = photos;
      }
      const meters = Number(order.distanceMeters);
      if ((!shipment.distanceMeters || Number(shipment.distanceMeters) <= 0) && Number.isFinite(meters) && meters > 0) {
        orderExtras.distanceMeters = Math.round(meters);
        orderExtras.distanceKm = Math.round((meters / 1000) * 10) / 10;
        orderExtras.distanceLabel = String(order.distanceLabel || '').trim() || `${orderExtras.distanceKm} km`;
      }
      if (!shipment.durationSeconds && Number(order.durationSeconds) > 0) {
        orderExtras.durationSeconds = Math.round(Number(order.durationSeconds));
      }
    }
  }
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw notFound('Order not found.');
    assertCanAccept({ id: fresh.id, ...fresh.data() }, carrierId);
    const patch = {
      carrierId,
      shipmentStatus: 'accepted',
      trackStep: 'received',
      portalStage: 'accepted',
      pickupStatus: 'assigned',
      acceptedAt: FieldValue.serverTimestamp(),
      cashExpected: fee,
      haulFee,
      haulFeeRate: fee > 0 ? haulFee / fee : rate,
      carrierNet: Math.max(0, fee - haulFee),
      commissionCountedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({ status: 'accepted', label: 'Accepted', at, actor: decoded.email || decoded.uid }),
      updatedAt: FieldValue.serverTimestamp(),
      ...orderExtras,
    };
    if (fee > 0) {
      patch.fareLabel = label;
      if (String(shipment.quoteStatus || '') === 'awaiting_company' || String(shipment.quoteStatus || '') === 'offered') {
        patch.quoteStatus = 'offered';
      }
    }
    tx.set(ref, patch, { merge: true });
    tx.set(db.collection('carriers').doc(carrierId), { accepted: FieldValue.increment(1) }, { merge: true });
    if (orderId && fee > 0 && (needsQuote || String(shipment.quoteStatus || '') === 'awaiting_company')) {
      tx.set(
        db.collection('orders').doc(orderId),
        {
          quoteStatus: 'offered',
          carrierQuoteTzs: fee,
          fareLabel: label,
          totalLabel: label,
          carrierQuoteAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });
  await mirrorCustomer(db, { ...shipment, carrierId, shipmentStatus: 'accepted', trackStep: 'received', cashExpected: fee });
  return { ok: true, shipmentId: shipment.id, amountTzs: fee, commissionTzs: haulFee };
}

async function handlePortalTransit(req) {
  const { db, decoded, carrierId } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 8 * 1024);
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  if (shipment.carrierId !== carrierId) throw forbidden('Accept the order before starting the journey.');
  if (shipment.quoteStatus && shipment.quoteStatus !== 'confirmed') {
    throw conflict('The customer has not confirmed the price yet.');
  }
  if (shipment.shipmentStatus === 'in_transit') return { ok: true, already: true, shipmentId: shipment.id };
  if (!OWNED_BEFORE_TRANSIT.includes(String(shipment.shipmentStatus || ''))) {
    throw conflict('This order cannot move to In Transit from its current status.');
  }
  const at = new Date().toISOString();
  const latest = { status: 'in_transit', message: 'Journey started.', at, locationSource: '' };
  await ref.set(
    {
      shipmentStatus: 'in_transit',
      trackStep: 'transit',
      journeyStatus: 'in_transit',
      portalStage: 'in_transit',
      inTransitAt: FieldValue.serverTimestamp(),
      latestJourney: latest,
      statusHistory: FieldValue.arrayUnion({ status: 'in_transit', label: 'In Transit', at, actor: decoded.email || decoded.uid }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await ref.collection('journeyUpdates').add({ ...latest, actor: decoded.email || decoded.uid, createdAt: FieldValue.serverTimestamp() });
  await mirrorCustomer(db, { ...shipment, shipmentStatus: 'in_transit', trackStep: 'transit', latestJourney: latest });
  return { ok: true, shipmentId: shipment.id };
}

function readLocation(body) {
  const latitude = body.latitude == null || body.latitude === '' ? null : Number(body.latitude);
  const longitude = body.longitude == null || body.longitude === '' ? null : Number(body.longitude);
  const hasGps = Number.isFinite(latitude) && Number.isFinite(longitude);
  const source = hasGps && body.locationSource !== 'manual' ? 'gps' : 'manual';
  const locationName = String(body.locationName || '').trim();
  if (!hasGps && !locationName) throw badRequest('Add a GPS position or a manually reported place name.');
  return { latitude: hasGps ? latitude : null, longitude: hasGps ? longitude : null, locationName, locationSource: source };
}

async function handlePortalJourney(req) {
  const { db, decoded, carrierId } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  if (shipment.carrierId !== carrierId || !['in_transit', 'arrived'].includes(String(shipment.shipmentStatus || ''))) {
    throw conflict('Journey updates are available after the order is in transit.');
  }
  const status = String(body.status || '').trim();
  if (!JOURNEY_STATUSES.includes(status) || status === 'delivered') throw badRequest('Choose a valid in-transit journey status.');
  const location = readLocation(body);
  const at = new Date().toISOString();
  const latest = {
    status,
    message: String(body.message || '').trim().slice(0, 280),
    eta: String(body.eta || '').trim().slice(0, 80),
    at,
    ...location,
  };
  const updateRef = ref.collection('journeyUpdates').doc();
  await updateRef.set({ ...latest, actor: decoded.email || decoded.uid, createdAt: FieldValue.serverTimestamp() });
  await ref.set(
    {
      journeyStatus: status,
      trackStep: 'transit',
      latestJourney: latest,
      statusHistory: FieldValue.arrayUnion({ status, label: latest.message || status, at, actor: decoded.email || decoded.uid }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await mirrorCustomer(db, { ...shipment, shipmentStatus: 'in_transit', trackStep: 'transit', latestJourney: latest });
  return { ok: true, shipmentId: shipment.id, updateId: updateRef.id, locationSource: location.locationSource };
}

async function sendWhatsAppText({ to, body, idempotencyKey }) {
  const token = String(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId) {
    const error = new Error('WhatsApp is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. SMS was not used instead.');
    error.statusCode = 503;
    error.code = 'whatsapp_not_configured';
    throw error;
  }
  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'WhatsApp rejected the message.');
    error.statusCode = 502;
    error.code = 'whatsapp_failed';
    error.provider = payload;
    throw error;
  }
  return { id: payload?.messages?.[0]?.id || '', idempotencyKey, to };
}

function trackingUrl(orderId) {
  const base = String(process.env.HAUL_TRACK_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    const error = new Error('HAUL_TRACK_BASE_URL is not configured, so a tracking link was not invented.');
    error.statusCode = 503;
    error.code = 'track_url_not_configured';
    throw error;
  }
  return `${base}/${encodeURIComponent(orderId)}`;
}

async function recordWhatsApp(db, shipmentId, key, patch) {
  await db.collection('carrierShipments').doc(shipmentId).collection('whatsappLog').doc(key).set(
    { ...patch, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function deliverWhatsApp(db, shipment, event, text) {
  const key = `${event}_${shipment.id}`;
  const existing = await db.collection('carrierShipments').doc(shipment.id).collection('whatsappLog').doc(key).get();
  if (existing.exists && existing.data()?.status === 'sent') {
    return { ok: true, duplicate: true, status: 'sent', id: existing.data()?.providerMessageId || '' };
  }
  const to = normalizePhone(shipment.customerPhone);
  if (!/^255[67]\d{8}$/.test(to)) throw badRequest('The customer phone on this order is not a valid WhatsApp number.');
  try {
    const sent = await sendWhatsAppText({ to, body: text, idempotencyKey: key });
    await recordWhatsApp(db, shipment.id, key, { status: 'sent', to, event, providerMessageId: sent.id, body: text });
    return { ok: true, status: 'sent', id: sent.id };
  } catch (error) {
    await recordWhatsApp(db, shipment.id, key, { status: 'failed', to, event, error: error.message, body: text });
    throw error;
  }
}

async function handlePortalDeliver(req) {
  const { db, decoded, carrierId } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  if (shipment.carrierId !== carrierId) throw forbidden('This order is not yours.');
  if (shipment.shipmentStatus === 'delivered') return { ok: true, already: true, shipmentId: shipment.id };
  if (!['in_transit', 'arrived'].includes(String(shipment.shipmentStatus || ''))) {
    throw conflict('Mark the order in transit before confirming delivery.');
  }
  const location = readLocation({ ...body, locationName: body.locationName || 'Delivered' });
  const at = new Date().toISOString();
  const latest = { status: 'delivered', message: String(body.message || 'Delivered to the customer.').slice(0, 280), at, ...location };
  await ref.set(
    {
      shipmentStatus: 'delivered',
      trackStep: 'handed',
      journeyStatus: 'delivered',
      portalStage: 'delivered',
      deliveredAt: FieldValue.serverTimestamp(),
      latestJourney: latest,
      statusHistory: FieldValue.arrayUnion({ status: 'delivered', label: 'Delivered', at, actor: decoded.email || decoded.uid }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await ref.collection('journeyUpdates').add({ ...latest, actor: decoded.email || decoded.uid, createdAt: FieldValue.serverTimestamp() });
  await db.collection('carriers').doc(carrierId).set({ deliveries: FieldValue.increment(1) }, { merge: true });
  await mirrorCustomer(db, { ...shipment, shipmentStatus: 'delivered', trackStep: 'handed', latestJourney: latest });
  let whatsapp = { ok: false, status: 'not_sent' };
  try {
    const link = trackingUrl(shipment.orderId || shipment.id);
    whatsapp = await deliverWhatsApp(
      db,
      shipment,
      'delivered',
      `HAUL delivery confirmed.\nOrder ${shipment.orderNumber || shipment.id}\nDelivered at ${at}.\nDetails: ${link}`
    );
  } catch (error) {
    whatsapp = { ok: false, status: 'failed', error: error.message, code: error.code || 'whatsapp_failed' };
  }
  return { ok: true, shipmentId: shipment.id, whatsapp };
}

async function handlePortalTrackingLink(req) {
  const { db, carrierId } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 8 * 1024);
  const { shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  if (shipment.carrierId !== carrierId || shipment.shipmentStatus !== 'in_transit') {
    throw conflict('A tracking link can be sent while the order is in transit.');
  }
  const link = trackingUrl(shipment.orderId || shipment.id);
  const whatsapp = await deliverWhatsApp(
    db,
    shipment,
    'tracking',
    `HAUL tracking.\nOrder ${shipment.orderNumber || shipment.id} is in transit.\nTrack: ${link}`
  );
  return { ok: true, shipmentId: shipment.id, url: link, whatsapp };
}

async function handlePortalQuote(req) {
  const { db, decoded, carrierId, carrier } = await requireCarrierContext(req);
  const body = await readJsonBodyLimited(req, 8 * 1024);
  const amount = Math.round(Number(body.amountTzs) || 0);
  if (amount < 1000 || amount > 50000000) throw badRequest('Enter the delivery price in TZS.');
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, body.shipmentId);
  const offeredToCompany = shipment.offeredCarrierId === carrierId || shipment.carrierId === carrierId;
  if (!offeredToCompany) throw forbidden('This order is not assigned to your company.');
  if (['cancelled', 'delivered'].includes(String(shipment.shipmentStatus || ''))) {
    throw conflict('This order is already closed.');
  }
  if (shipment.quoteStatus === 'confirmed' && deliveryFeeOf(shipment) > 0) {
    throw conflict('The customer already confirmed this price.');
  }
  const standing = standingFor(carrier);
  const rate = Number(standing?.feeRate) || Number(standing?.feePercent) / 100 || 0.12;
  // Draft commission only — haulFee counts when the company accepts/takes the order.
  const draftCommission = Math.max(0, Math.round(Number(body.commissionTzs) || amount * rate));
  const label = `TZS ${amount.toLocaleString('en-US')}`;
  await ref.set(
    {
      cashExpected: amount,
      quoteDraftCommissionTzs: draftCommission,
      quoteDraftFeeRate: rate,
      quoteStatus: 'offered',
      fareLabel: label,
      quotedAt: FieldValue.serverTimestamp(),
      quotedBy: decoded.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const orderId = String(shipment.orderId || shipment.id || '').trim();
  if (orderId) {
    await db.collection('orders').doc(orderId).set(
      {
        quoteStatus: 'offered',
        carrierQuoteTzs: amount,
        fareLabel: label,
        totalLabel: label,
        carrierQuoteAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  return { ok: true, shipmentId: shipment.id, amountTzs: amount, draftCommissionTzs: draftCommission };
}

function photoUrlsFrom(doc) {
  const raw = Array.isArray(doc?.parcelPhotoUrls)
    ? doc.parcelPhotoUrls
    : Array.isArray(doc?.cargoPhotos)
      ? doc.cargoPhotos
      : [];
  const urls = raw
    .map((entry) => (typeof entry === 'string' ? entry : entry?.url || entry?.downloadURL || ''))
    .map((url) => String(url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url));
  if (doc?.parcelPhotoUrl && /^https?:\/\//i.test(String(doc.parcelPhotoUrl))) {
    urls.unshift(String(doc.parcelPhotoUrl).trim());
  }
  return [...new Set(urls)].slice(0, 6);
}

/** Ensures parcel photos are on the shipment (from order) and returns them to the portal. */
async function handlePortalPhotos(req, url) {
  const { db, carrierId } = await requireCarrierContext(req);
  const shipmentId = String(url?.searchParams?.get('shipmentId') || '').trim();
  if (!shipmentId) throw badRequest('shipmentId is required.');
  const { ref, shipment } = await shipmentForCarrier(db, carrierId, shipmentId);
  let photos = photoUrlsFrom(shipment);
  if (!photos.length) {
    const orderId = String(shipment.orderId || shipment.id || shipmentId).trim();
    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (orderSnap.exists) {
      photos = photoUrlsFrom(orderSnap.data() || {});
      if (photos.length) {
        await ref.set(
          {
            parcelPhotoUrls: photos,
            parcelPhotoUrl: photos[0],
            cargoPhotos: photos,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  }
  return {
    ok: true,
    shipmentId,
    parcelPhotoUrls: photos,
    parcelPhotoUrl: photos[0] || '',
  };
}

async function handlePortalPresence(req) {
  const { db, decoded, carrierId } = await requireCarrierContext(req);
  const at = new Date().toISOString();
  await db.collection('carriers').doc(carrierId).set(
    {
      portalOnlineAt: FieldValue.serverTimestamp(),
      portalOnlineUid: decoded.uid,
      portalOnlineEmail: decoded.email || '',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Pull waiting jobs onto this live portal session.
  let claimed = 0;
  try {
    const { matchOrderById, isBusParcel } = require('./carrier-matching');
    const waiting = await db.collection('carrierShipments').where('shipmentStatus', '==', 'matching').limit(20).get();
    for (const doc of waiting.docs) {
      const orderSnap = await db.collection('orders').doc(doc.id).get();
      if (!orderSnap.exists) continue;
      const order = { id: orderSnap.id, ...orderSnap.data() };
      if (order.status === 'cancelled' || !isBusParcel(order)) continue;
      const result = await matchOrderById(db, doc.id, { preferCarrierIds: new Set([carrierId]) });
      if (result?.matched && String(result.carrierId || '') === carrierId) claimed += 1;
      if (claimed >= 5) break;
    }
  } catch (error) {
    console.error('portal presence rematch failed', carrierId, error?.message || error);
  }

  return { ok: true, carrierId, onlineAt: at, claimed };
}

async function handlePortalFinance(req) {
  const { db, carrierId, carrier } = await requireCarrierContext(req);
  const snap = await db.collection('carrierShipments').where('carrierId', '==', carrierId).get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const gate = eligibilityFor(carrier, rows);
  const lines = rows.map((item) => financeRow(item, gate.feePercent));
  const paymentsSnap = await db.collection('carrierCommissionPayments').where('carrierId', '==', carrierId).limit(40).get().catch(() => null);
  const payments = paymentsSnap
    ? paymentsSnap.docs.map((doc) => {
        const data = doc.data() || {};
        return { id: doc.id, amountTzs: Math.round(Number(data.amount) || 0), status: data.status || '', reference: data.trivapesaReference || doc.id, at: data.createdAtMs || null };
      })
    : [];
  const paid = lines.reduce((sum, item) => sum + item.paidTzs, 0);
  return {
    ok: true,
    eligibility: gate,
    assignedValueTzs: lines.reduce((sum, item) => sum + item.cargoValueTzs, 0),
    deliveryRevenueTzs: lines.reduce((sum, item) => sum + item.deliveryFeeTzs, 0),
    commissionOwedTzs: lines.reduce((sum, item) => sum + item.commissionTzs, 0),
    commissionPaidTzs: paid,
    outstandingTzs: gate.outstandingTzs,
    orders: lines,
    payments,
  };
}

module.exports = {
  JOURNEY_STATUSES,
  eligibilityFor,
  financeRow,
  handlePortalAccept,
  handlePortalDeliver,
  handlePortalFinance,
  handlePortalJourney,
  handlePortalPhotos,
  handlePortalPresence,
  handlePortalQuote,
  handlePortalTrackingLink,
  handlePortalTransit,
  handlePortalVerify,
};
