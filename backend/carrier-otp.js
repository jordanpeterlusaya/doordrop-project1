const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

const { maskPhone, normalizeSmsPhone, sendSms, smsConfigured } = require('./sms-provider');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const TICKET_TTL_MS = 30 * 60 * 1000;

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  if (code) error.code = code;
  return error;
}

function tooMany(message, code) {
  const error = new Error(message);
  error.statusCode = 429;
  if (code) error.code = code;
  return error;
}

function serviceUnavailable(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  if (code) error.code = code;
  return error;
}

function hashValue(value, salt = '') {
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

function randomDigits(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String(crypto.randomInt(0, 10));
  }
  return out;
}

function randomTicket() {
  return crypto.randomBytes(24).toString('hex');
}

function sessionIdForPhone(phone) {
  return hashValue(normalizeSmsPhone(phone), 'carrier-otp-session').slice(0, 40);
}

function isEmulator() {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST
  );
}

function allowDevWithoutSms() {
  return isEmulator() && String(process.env.SMS_OTP_ALLOW_DEV || '').trim() === '1';
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}

function getDb() {
  const { getFirestore } = require('firebase-admin/firestore');
  const { cert, getApps, initializeApp } = require('firebase-admin/app');
  const { config } = require('./config');
  if (!getApps().length) {
    const opts = {};
    if (config.firebaseServiceAccount) opts.credential = cert(config.firebaseServiceAccount);
    if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
      opts.projectId = config.firebaseProjectId || config.firebaseServiceAccount.project_id;
    }
    initializeApp(opts);
  }
  return getFirestore();
}

async function handleSendOtp(req) {
  const body = await readJsonBody(req);
  const phone = normalizeSmsPhone(body.phone);
  if (!phone) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');

  const purpose = String(body.purpose || 'signup').trim().toLowerCase() || 'signup';
  if (!smsConfigured() && !allowDevWithoutSms()) {
    throw serviceUnavailable(
      'Huduma ya SMS haijawekwa. Wasiliana na HAUL.',
      'sms_not_configured'
    );
  }

  const db = getDb();
  const id = sessionIdForPhone(phone);
  const ref = db.collection('carrierOtpSessions').doc(id);
  const snap = await ref.get();
  const now = Date.now();
  const existing = snap.exists ? snap.data() : null;

  if (existing?.lastSentAtMs && now - Number(existing.lastSentAtMs) < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - Number(existing.lastSentAtMs))) / 1000);
    throw tooMany(`Subiri sekunde ${waitSec} kabla ya kutuma tena.`, 'cooldown');
  }

  const hourAgo = now - 60 * 60 * 1000;
  const sends = Array.isArray(existing?.sendTimestampsMs)
    ? existing.sendTimestampsMs.filter((ts) => Number(ts) > hourAgo)
    : [];
  if (sends.length >= MAX_SENDS_PER_HOUR) {
    throw tooMany('Umefikia kikomo cha SMS kwa saa hii. Jaribu baadaye.', 'rate_limit');
  }

  const code = randomDigits(6);
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashValue(code, salt);
  const expiresAtMs = now + OTP_TTL_MS;

  await ref.set(
    {
      phoneMasked: maskPhone(phone),
      phoneHash: hashValue(phone, 'phone'),
      purpose,
      codeHash,
      salt,
      expiresAtMs,
      attempts: 0,
      verified: false,
      otpTicketHash: null,
      lastSentAtMs: now,
      sendTimestampsMs: [...sends, now].slice(-MAX_SENDS_PER_HOUR),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const message = `HAUL Agents: msimbo wako wa uthibitisho ni ${code}. Una dakika 5. Usishiriki na mtu yeyote.`;

  let sent = false;
  let provider = 'none';
  if (smsConfigured()) {
    try {
      const result = await sendSms(phone, message, { purpose: 'carrier_otp', event: 'otp' });
      sent = true;
      provider = result.provider;
      console.info('carrier-otp sent', { toMasked: maskPhone(phone), provider, purpose });
    } catch (error) {
      const code = String(error?.code || '');
      const raw = String(error?.causeDetail || error?.message || '');
      console.warn('carrier-otp send failed', {
        toMasked: maskPhone(phone),
        purpose,
        code: code || undefined,
        reason: raw.slice(0, 160),
      });
      if (Number.isInteger(error?.statusCode) && error.message && !/^mambo_\d+/.test(error.message)) {
        throw error;
      }
      throw serviceUnavailable(
        'Imeshindwa kutuma msimbo wa OTP. Hakikisha Sender ID imeidhinishwa kwenye Mambo SMS, kisha jaribu tena.',
        code || 'sms_send_failed'
      );
    }
  } else if (allowDevWithoutSms()) {
    // Emulator-only path: code is never logged.
    console.info('carrier-otp queued emulator', { toMasked: maskPhone(phone), purpose });
    provider = 'emulator';
  }

  const payload = {
    ok: true,
    sent,
    provider,
    cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    phoneMasked: maskPhone(phone),
  };

  // Never include the code except on the Firebase emulator with explicit opt-in.
  if (allowDevWithoutSms() && !smsConfigured()) {
    payload.devEmulatorOnly = true;
  }

  return payload;
}

async function handleVerifyOtp(req) {
  const body = await readJsonBody(req);
  const phone = normalizeSmsPhone(body.phone);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!phone) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
  if (code.length < 4 || code.length > 8) throw badRequest('Msimbo si sahihi.', 'invalid_code');

  const db = getDb();
  const id = sessionIdForPhone(phone);
  const ref = db.collection('carrierOtpSessions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw badRequest('Omba msimbo mpya kwanza.', 'no_session');

  const session = snap.data();
  const now = Date.now();
  if (Number(session.expiresAtMs) < now) {
    throw badRequest('Msimbo umeisha muda. Omba mpya.', 'expired');
  }
  if (Number(session.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    throw tooMany('Jaribio nyingi. Omba msimbo mpya.', 'too_many_attempts');
  }

  const expected = String(session.codeHash || '');
  const candidate = hashValue(code, String(session.salt || ''));
  if (candidate !== expected) {
    await ref.set({ attempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw badRequest('Msimbo si sahihi.', 'invalid_code');
  }

  const otpTicket = randomTicket();
  const otpTicketHash = hashValue(otpTicket, 'ticket');
  await ref.set(
    {
      verified: true,
      verifiedAtMs: now,
      otpTicketHash,
      ticketExpiresAtMs: now + TICKET_TTL_MS,
      codeHash: FieldValue.delete(),
      salt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.info('carrier-otp verified', { toMasked: maskPhone(phone) });

  return {
    ok: true,
    otpTicket,
    expiresInSeconds: Math.floor(TICKET_TTL_MS / 1000),
    phoneMasked: maskPhone(phone),
  };
}

/**
 * Consume a verified OTP ticket and mark the carrier phone as verified.
 */
async function handleConfirmPhone(req, decoded) {
  const body = await readJsonBody(req);
  const phone = normalizeSmsPhone(body.phone);
  const otpTicket = String(body.otpTicket || '').trim();
  if (!phone) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
  if (!otpTicket) throw badRequest('Uthibitisho wa simu unahitajika.', 'missing_ticket');
  if (!decoded?.uid) {
    const error = new Error('Unauthorized.');
    error.statusCode = 401;
    throw error;
  }

  const db = getDb();
  const id = sessionIdForPhone(phone);
  const ref = db.collection('carrierOtpSessions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw badRequest('Uthibitisho wa simu hauko sahihi.', 'no_session');
  const session = snap.data();
  const now = Date.now();
  if (!session.verified || !session.otpTicketHash) {
    throw badRequest('Thibitisha simu kwanza.', 'not_verified');
  }
  if (Number(session.ticketExpiresAtMs) < now) {
    throw badRequest('Uthibitisho umeisha muda. Anza upya.', 'ticket_expired');
  }
  if (hashValue(otpTicket, 'ticket') !== session.otpTicketHash) {
    throw badRequest('Uthibitisho wa simu hauko sahihi.', 'bad_ticket');
  }

  const carrierId = String(body.carrierId || decoded.uid).trim() || decoded.uid;
  await db.collection('carriers').doc(carrierId).set(
    {
      phone,
      phoneNormalized: phone,
      phoneVerified: true,
      phoneVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await ref.set(
    {
      otpTicketHash: FieldValue.delete(),
      consumedAtMs: now,
      consumedByUid: decoded.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, phoneMasked: maskPhone(phone), carrierId };
}

async function findCarrierByPhone(db, phone) {
  const normalized = normalizeSmsPhone(phone);
  if (!normalized) return null;

  const byNormalized = await db
    .collection('carriers')
    .where('phoneNormalized', '==', normalized)
    .limit(1)
    .get();
  if (!byNormalized.empty) return byNormalized.docs[0];

  const byPhone = await db.collection('carriers').where('phone', '==', normalized).limit(1).get();
  if (!byPhone.empty) return byPhone.docs[0];

  const digits = normalized.replace(/\D/g, '');
  if (digits.startsWith('255') && digits.length >= 12) {
    const local = `0${digits.slice(3)}`;
    const byLocal = await db.collection('carriers').where('phone', '==', local).limit(1).get();
    if (!byLocal.empty) return byLocal.docs[0];
  }

  return null;
}

/**
 * Exchange a verified OTP ticket for a Firebase custom token (phone OTP login).
 */
async function handleLoginWithOtp(req) {
  const body = await readJsonBody(req);
  const phone = normalizeSmsPhone(body.phone);
  const otpTicket = String(body.otpTicket || '').trim();
  if (!phone) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
  if (!otpTicket) throw badRequest('Thibitisha OTP kwanza.', 'missing_ticket');

  const db = getDb();
  const id = sessionIdForPhone(phone);
  const ref = db.collection('carrierOtpSessions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw badRequest('Uthibitisho wa simu hauko sahihi.', 'no_session');

  const session = snap.data();
  const now = Date.now();
  if (!session.verified || !session.otpTicketHash) {
    throw badRequest('Thibitisha simu kwanza.', 'not_verified');
  }
  if (Number(session.ticketExpiresAtMs) < now) {
    throw badRequest('Uthibitisho umeisha muda. Anza upya.', 'ticket_expired');
  }
  if (hashValue(otpTicket, 'ticket') !== session.otpTicketHash) {
    throw badRequest('Uthibitisho wa simu hauko sahihi.', 'bad_ticket');
  }

  const purpose = String(session.purpose || 'signup').trim().toLowerCase();
  if (purpose !== 'login' && purpose !== 'signup') {
    throw badRequest('OTP haitumiki kuingia.', 'bad_purpose');
  }

  const carrierDoc = await findCarrierByPhone(db, phone);
  if (!carrierDoc) {
    throw badRequest('Hakuna akaunti kwa simu hii. Jisajili kwanza.', 'no_account');
  }

  const carrier = carrierDoc.data() || {};
  const uid = String(carrier.ownerUid || carrierDoc.id).trim();
  if (!uid) throw badRequest('Akaunti haipatikani.', 'no_account');

  const { getAuth } = require('firebase-admin/auth');
  const customToken = await getAuth().createCustomToken(uid, {
    role: 'carrier',
    carrierId: carrierDoc.id,
  });

  await ref.set(
    {
      otpTicketHash: FieldValue.delete(),
      consumedAtMs: now,
      consumedByUid: uid,
      loginAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Backfill normalized phone for faster future lookups.
  if (!carrier.phoneNormalized) {
    await carrierDoc.ref.set(
      { phoneNormalized: phone, phone, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  console.info('carrier-otp login', { toMasked: maskPhone(phone), carrierId: carrierDoc.id });

  return {
    ok: true,
    customToken,
    carrierId: carrierDoc.id,
    status: String(carrier.status || 'pending'),
    phoneMasked: maskPhone(phone),
  };
}

module.exports = {
  handleConfirmPhone,
  handleLoginWithOtp,
  handleSendOtp,
  handleVerifyOtp,
  maskPhone,
  normalizeSmsPhone,
};
