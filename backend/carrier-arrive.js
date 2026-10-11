const { FieldValue } = require('firebase-admin/firestore');

const { sendArrivalNotices } = require('./carrier-sms');
const { readJsonBodyLimited, requireAuthenticatedUser } = require('./media-upload');

const PENDING_MS = 2 * 60 * 1000;

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  if (code) error.code = code;
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

function conflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  if (code) error.code = code;
  return error;
}

function isDelivered(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').toLowerCase();
  return status === 'delivered' || step === 'handed';
}

function isArrived(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').toLowerCase();
  return status === 'arrived' || step === 'arrived';
}

function readyToArrive(shipment) {
  const status = String(shipment?.shipmentStatus || '').toLowerCase();
  const step = String(shipment?.trackStep || '').toLowerCase();
  return status === 'in_transit' || step === 'transit';
}

function pendingFresh(shipment) {
  if (!shipment?.arrivalSmsPending) return false;
  const at = Date.parse(shipment.arrivalSmsPendingAt || '');
  if (!Number.isFinite(at)) return true;
  return Date.now() - at < PENDING_MS;
}

async function resolveCarrierId(database, uid) {
  const member = await database.collection('carrierMembers').doc(uid).get();
  if (member.exists) {
    const id = String(member.data()?.carrierId || '').trim();
    if (id) return id;
  }
  const owned = await database.collection('carriers').doc(uid).get();
  if (owned.exists) return owned.id;
  return '';
}

async function handleMarkArrived(req, database) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 16 * 1024);
  const shipmentId = String(body.shipmentId || '').trim();
  if (!shipmentId) throw badRequest('shipmentId inahitajika.', 'missing_shipment');

  const carrierId = await resolveCarrierId(database, decoded.uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');

  const ref = database.collection('carrierShipments').doc(shipmentId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('Mzigo haupatikani.');
  const shipment = snap.data() || {};
  if (String(shipment.carrierId || '') !== carrierId) throw forbidden('Hii si oda yako.');
  if (isDelivered(shipment)) {
    throw conflict('Hakuna hatua nyingine baada ya Imefika.', 'already_closed');
  }
  if (isArrived(shipment)) {
    return { ok: true, shipmentStatus: 'arrived', already: true };
  }
  if (!readyToArrive(shipment)) throw badRequest('Hatua moja tu mbele.', 'bad_step');
  if (pendingFresh(shipment)) throw conflict('SMS inatumwa. Subiri kidogo.', 'arrival_sms_pending');

  await ref.set(
    {
      arrivalSmsPending: true,
      arrivalSmsPendingAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const notices = await sendArrivalNotices(database, { orderId: shipmentId, shipment });
    if (!notices?.recipient?.sent || !notices?.sender?.sent) {
      const error = new Error('SMS haijatumwa kwa mtumaji na mpokeaji.');
      error.statusCode = 503;
      error.code = 'arrival_sms_incomplete';
      throw error;
    }
    const actor = String(decoded.email || decoded.uid || '').trim();
    await ref.set(
      {
        trackStep: 'arrived',
        shipmentStatus: 'arrived',
        arrivedAt: FieldValue.serverTimestamp(),
        arrivalSmsPending: false,
        arrivalSmsError: FieldValue.delete(),
        statusHistory: FieldValue.arrayUnion({
          status: 'arrived',
          label: 'Imefika',
          at: new Date().toISOString(),
          actor,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      ok: true,
      shipmentStatus: 'arrived',
      sms: {
        provider: 'mambo',
        body: notices.body,
        recipientSent: Boolean(notices.recipient?.sent),
        senderSent: Boolean(notices.sender?.sent),
      },
    };
  } catch (error) {
    await ref.set(
      {
        arrivalSmsPending: false,
        arrivalSmsError: String(error?.message || 'Imeshindwa kutuma SMS.').slice(0, 180),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw error;
  }
}

module.exports = {
  handleMarkArrived,
};
