const crypto = require('crypto');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const { maskPhone, normalizeSmsPhone, sendSms, smsConfigured } = require('./sms-provider');
const {
  MEDIA_BUCKET,
  ensureFirebaseAdmin,
  readJsonBodyLimited,
  requireAuthenticatedUser,
  sanitizePathPart,
} = require('./media-upload');

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

function serviceUnavailable(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  if (code) error.code = code;
  return error;
}

function hashValue(value, salt) {
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

function randomDigits(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(crypto.randomInt(0, 10));
  return out;
}

function db() {
  ensureFirebaseAdmin();
  return getFirestore();
}

function hasDeliveryProof(shipment) {
  const proof = shipment?.proofOfDelivery;
  if (!proof || typeof proof !== 'object') return false;
  const method = String(proof.method || '').toLowerCase();
  if (method === 'otp') return proof.verified === true;
  if (method === 'photo' || method === 'signature') {
    const ids = [shipment.id, shipment.orderId].filter(Boolean);
    return ids.some((id) => proofUrlMatches(proof.url, id, method));
  }
  return false;
}

function proofUrlMatches(url, shipmentId, method) {
  const text = String(url || '');
  const id = sanitizePathPart(shipmentId);
  const kind = sanitizePathPart(method);
  if (!id || !kind) return false;
  const prefix = `https://storage.googleapis.com/${MEDIA_BUCKET}/carrier-proof/`;
  return text.startsWith(prefix) && text.includes(`/${id}/${kind}/`);
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

function assertReadyToProve(shipment, carrierId) {
  if (!shipment) throw notFound('Mzigo haupatikani.');
  if (String(shipment.carrierId || '') !== carrierId) throw forbidden('Hii si oda yako.');
  const status = String(shipment.shipmentStatus || '').toLowerCase();
  const step = String(shipment.trackStep || '').toLowerCase();
  if (status === 'delivered' || step === 'handed') {
    const error = new Error('Mzigo tayari umekabidhiwa.');
    error.statusCode = 409;
    throw error;
  }
  if (status !== 'arrived' && step !== 'arrived') {
    throw badRequest('Kwanza weka Imefika.', 'not_arrived');
  }
}

async function loadOwnedShipment(database, uid, shipmentId) {
  const id = String(shipmentId || '').trim();
  if (!id) throw badRequest('shipmentId inahitajika.', 'missing_shipment');
  const carrierId = await resolveCarrierId(database, uid);
  if (!carrierId) throw forbidden('Akaunti haina kampuni.');
  const snap = await database.collection('carrierShipments').doc(id).get();
  if (!snap.exists) throw notFound('Mzigo haupatikani.');
  return { carrierId, shipmentId: id, shipment: { id: snap.id, ...snap.data() }, ref: snap.ref };
}

async function handleDeliveryProofOptions(req, url) {
  const decoded = await requireAuthenticatedUser(req);
  const database = db();
  const { shipment } = await loadOwnedShipment(database, decoded.uid, url.searchParams.get('shipmentId'));
  const phone = normalizeSmsPhone(shipment.recipientPhone);
  const sms = smsConfigured();
  return {
    ok: true,
    smsConfigured: sms,
    hasRecipientPhone: Boolean(phone),
    otpAvailable: Boolean(sms && phone),
  };
}

async function handleSendDeliveryOtp(req) {
  if (!smsConfigured()) {
    throw serviceUnavailable('Huduma ya SMS haijawekwa.', 'sms_not_configured');
  }
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 64 * 1024);
  const database = db();
  const loaded = await loadOwnedShipment(database, decoded.uid, body.shipmentId);
  assertReadyToProve(loaded.shipment, loaded.carrierId);
  const phone = normalizeSmsPhone(loaded.shipment.recipientPhone);
  if (!phone) throw badRequest('Mpokeaji hana simu. Tumia picha au saini.', 'no_recipient_phone');

  const sessionRef = database.collection('deliveryOtpSessions').doc(loaded.shipmentId);
  const existingSnap = await sessionRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  const now = Date.now();
  if (existing?.lastSentAtMs && now - Number(existing.lastSentAtMs) < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - Number(existing.lastSentAtMs))) / 1000);
    throw badRequest(`Subiri sekunde ${waitSec} kabla ya kutuma tena.`, 'cooldown');
  }

  const code = randomDigits(6);
  const salt = crypto.randomBytes(16).toString('hex');
  const parcelCode = String(loaded.shipment.parcelCode || loaded.shipment.orderNumber || loaded.shipmentId)
    .trim()
    .toUpperCase();
  const smsBody = `HAUL: Msimbo wa kukabidhi mzigo ${parcelCode} ni ${code}. Mpe kampuni inayokabidhi.`;

  await sessionRef.set({
    codeHash: hashValue(code, salt),
    salt,
    expiresAtMs: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAtMs: now,
    carrierId: loaded.carrierId,
    used: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await sendSms(phone, smsBody, {
      event: 'delivery_otp',
      orderId: loaded.shipmentId,
      audience: 'recipient',
    });
  } catch (error) {
    await sessionRef.set(
      { lastSentAtMs: 0, lastError: 'send_failed', updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    console.warn('delivery-otp send failed', { shipmentId: loaded.shipmentId, toMasked: maskPhone(phone) });
    throw serviceUnavailable('SMS haijatumwa. Jaribu tena au tumia picha.', 'sms_failed');
  }

  console.info('delivery-otp sent', { shipmentId: loaded.shipmentId, toMasked: maskPhone(phone) });
  return { ok: true, sent: true };
}

async function handleDeliveryProofUpload(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 64 * 1024);
  const method = String(body.method || '').toLowerCase();
  if (method !== 'photo' && method !== 'signature') {
    throw badRequest('Chagua picha au saini.', 'bad_method');
  }
  const database = db();
  const loaded = await loadOwnedShipment(database, decoded.uid, body.shipmentId);
  assertReadyToProve(loaded.shipment, loaded.carrierId);

  const fileBase64 = String(body.fileBase64 || body.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!fileBase64) throw badRequest('Picha inahitajika.', 'missing_file');
  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw badRequest('Picha si sahihi.', 'bad_file');
  }
  if (!buffer.length) throw badRequest('Picha tupu.', 'empty_file');
  if (buffer.length > MAX_IMAGE_BYTES) throw badRequest('Picha ni kubwa sana (kiwango 6MB).', 'too_large');

  const contentType = String(body.contentType || 'image/jpeg').trim() || 'image/jpeg';
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(contentType)) throw badRequest('Tumia picha ya JPEG, PNG, au WebP.', 'bad_type');

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const userId = sanitizePathPart(decoded.uid);
  const shipmentKey = sanitizePathPart(loaded.shipmentId);
  const fileName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const objectPath = `carrier-proof/${userId}/${shipmentKey}/${method}/${fileName}`;

  const { storage } = ensureFirebaseAdmin();
  const bucket = storage.bucket(MEDIA_BUCKET);
  await bucket.file(objectPath).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'private, max-age=0',
      metadata: {
        uploadedBy: decoded.uid,
        purpose: 'delivery_proof',
        method,
        shipmentId: loaded.shipmentId,
      },
    },
  });

  const downloadURL = `https://storage.googleapis.com/${MEDIA_BUCKET}/${objectPath}`;
  return { ok: true, downloadURL, method };
}

async function handleCompleteDeliveryProof(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, 64 * 1024);
  const method = String(body.method || '').toLowerCase();
  if (!['photo', 'signature', 'otp'].includes(method)) {
    throw badRequest('Chagua picha, saini, au msimbo.', 'bad_method');
  }
  const database = db();
  const loaded = await loadOwnedShipment(database, decoded.uid, body.shipmentId);
  assertReadyToProve(loaded.shipment, loaded.carrierId);

  if (method === 'otp') {
    if (!smsConfigured()) throw serviceUnavailable('Huduma ya SMS haijawekwa.', 'sms_not_configured');
    if (!normalizeSmsPhone(loaded.shipment.recipientPhone)) {
      throw badRequest('Mpokeaji hana simu.', 'no_recipient_phone');
    }
    const code = String(body.code || '').replace(/\D/g, '');
    if (code.length !== 6) throw badRequest('Weka msimbo wa tarakimu 6.', 'bad_code');
    const sessionRef = database.collection('deliveryOtpSessions').doc(loaded.shipmentId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw badRequest('Tuma msimbo kwanza.', 'otp_missing');
    const session = sessionSnap.data() || {};
    if (session.used) throw badRequest('Msimbo tayari umetumika.', 'otp_used');
    if (Number(session.attempts) >= MAX_ATTEMPTS) {
      throw badRequest('Umejaribu mara nyingi. Tuma msimbo mpya.', 'otp_locked');
    }
    if (!session.expiresAtMs || Date.now() > Number(session.expiresAtMs)) {
      throw badRequest('Msimbo umeisha. Tuma mpya.', 'otp_expired');
    }
    const expected = hashValue(code, String(session.salt || ''));
    if (expected !== session.codeHash) {
      await sessionRef.set({ attempts: FieldValue.increment(1) }, { merge: true });
      throw badRequest('Msimbo si sahihi.', 'otp_mismatch');
    }
  }

  const proofUrl = String(body.proofUrl || body.downloadURL || '').trim();
  if ((method === 'photo' || method === 'signature') && !proofUrlMatches(proofUrl, loaded.shipmentId, method)) {
    throw badRequest('Picha ya uthibitisho haipo.', 'bad_proof_url');
  }

  const actor = String(decoded.email || decoded.uid || '').trim();
  const proof =
    method === 'otp'
      ? { method: 'otp', verified: true, at: new Date().toISOString(), actor }
      : { method, url: proofUrl, verified: true, at: new Date().toISOString(), actor };

  await database.runTransaction(async (tx) => {
    const snap = await tx.get(loaded.ref);
    if (!snap.exists) throw notFound('Mzigo haupatikani.');
    const current = snap.data() || {};
    assertReadyToProve({ ...current, id: loaded.shipmentId }, loaded.carrierId);
    if (method === 'otp') {
      const sessionRef = database.collection('deliveryOtpSessions').doc(loaded.shipmentId);
      const sessionSnap = await tx.get(sessionRef);
      const session = sessionSnap.exists ? sessionSnap.data() : null;
      const code = String(body.code || '').replace(/\D/g, '');
      if (!session || session.used || hashValue(code, String(session.salt || '')) !== session.codeHash) {
        throw badRequest('Msimbo si sahihi.', 'otp_mismatch');
      }
      tx.set(sessionRef, { used: true, usedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.set(
      loaded.ref,
      {
        shipmentStatus: 'delivered',
        trackStep: 'handed',
        deliveredAt: FieldValue.serverTimestamp(),
        proofOfDelivery: proof,
        statusHistory: FieldValue.arrayUnion({
          status: 'handed',
          label: 'Imekabidhiwa',
          at: new Date().toISOString(),
          actor,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      database.collection('deliveryProofReceipts').doc(loaded.shipmentId),
      {
        method,
        carrierId: loaded.carrierId,
        actor,
        at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(database.collection('carriers').doc(loaded.carrierId), { deliveries: FieldValue.increment(1) }, { merge: true });
  });

  return { ok: true, shipmentStatus: 'delivered', trackStep: 'handed' };
}

module.exports = {
  handleCompleteDeliveryProof,
  handleDeliveryProofOptions,
  handleDeliveryProofUpload,
  handleSendDeliveryOtp,
  hasDeliveryProof,
  proofUrlMatches,
};
