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

/** Firestore / Mambo form: 255XXXXXXXXX (no plus). */
function phoneDigits255(phone) {
  const normalized = normalizeSmsPhone(phone);
  if (!normalized) return '';
  const digits = normalized.replace(/\D/g, '');
  if (!digits.startsWith('255') || digits.length < 12) return '';
  return digits.slice(0, 12);
}

function phoneLookupKeys(phone) {
  const digits = phoneDigits255(phone);
  if (!digits) return [];
  return [...new Set([`+${digits}`, digits, `0${digits.slice(3)}`])];
}

async function loadVerifiedSession(db, phone, otpTicket) {
  const ref = db.collection('carrierOtpSessions').doc(sessionIdForPhone(phone));
  const snap = await ref.get();
  if (!snap.exists) throw badRequest('Uthibitisho wa simu hauko sahihi.', 'no_session');
  const session = snap.data() || {};
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
  return { ref, session, now };
}

async function consumeVerifiedSession(ref, uid, extra = {}) {
  await ref.set(
    {
      otpTicketHash: FieldValue.delete(),
      consumedAtMs: Date.now(),
      consumedByUid: uid || '',
      updatedAt: FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );
}

function verifiedPhonePatch(digits) {
  return {
    phone: digits,
    phoneNormalized: digits,
    notificationPhone: digits,
    phoneVerified: true,
    phoneVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
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

/**
 * Skips SMS and accepts any 4–8 digit code. Leave disabled in production so
 * agent OTP is sent with the approved Mambo sender (HAUL APP).
 */
function isOtpBypassEnabled() {
  const raw = String(
    process.env.CARRIER_OTP_BYPASS_ENABLED || process.env.OTP_BYPASS_ENABLED || ''
  )
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
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
  const otpBypass = isOtpBypassEnabled();
  if (!smsConfigured() && !allowDevWithoutSms() && !otpBypass) {
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
  if (smsConfigured() && !otpBypass) {
    try {
      const result = await sendSms(phone, message, { purpose: 'carrier_otp', event: 'otp' });
      sent = true;
      provider = result.provider;
      console.info('carrier-otp sent', { toMasked: maskPhone(phone), provider, purpose });
    } catch (error) {
      const errCode = String(error?.code || '');
      const raw = String(error?.causeDetail || error?.message || '');
      console.warn('carrier-otp send failed', {
        toMasked: maskPhone(phone),
        purpose,
        code: errCode || undefined,
        reason: raw.slice(0, 160),
      });
      if (Number.isInteger(error?.statusCode) && error.message && !/^mambo_\d+/.test(error.message)) {
        throw error;
      }
      throw serviceUnavailable(
        'Imeshindwa kutuma msimbo wa OTP. Hakikisha Sender ID imeidhinishwa kwenye Mambo SMS, kisha jaribu tena.',
        errCode || 'sms_send_failed'
      );
    }
  } else if (otpBypass) {
    // TEMP: Mambo Sender ID not approved — skip SMS; verify accepts any code.
    console.warn('carrier-otp bypass send (SMS skipped)', {
      toMasked: maskPhone(phone),
      purpose,
      flag: 'CARRIER_OTP_BYPASS_ENABLED',
    });
    provider = 'bypass';
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

  if (otpBypass) {
    payload.otpBypass = true;
  }

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

  const otpBypass = isOtpBypassEnabled();
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

  if (!otpBypass) {
    const expected = String(session.codeHash || '');
    const candidate = hashValue(code, String(session.salt || ''));
    if (candidate !== expected) {
      await ref.set(
        { attempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      throw badRequest('Msimbo si sahihi.', 'invalid_code');
    }
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
      ...(otpBypass ? { verifiedViaBypass: true } : {}),
    },
    { merge: true }
  );

  console.info('carrier-otp verified', {
    toMasked: maskPhone(phone),
    bypass: otpBypass || undefined,
  });

  return {
    ok: true,
    otpTicket,
    expiresInSeconds: Math.floor(TICKET_TTL_MS / 1000),
    phoneMasked: maskPhone(phone),
    ...(otpBypass ? { otpBypass: true } : {}),
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
  const { ref } = await loadVerifiedSession(db, phone, otpTicket);

  const digits = phoneDigits255(phone);
  if (!digits) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');

  let carrierId = decoded.uid;
  const requested = String(body.carrierId || '').trim();
  if (requested && requested !== decoded.uid) {
    const member = await db.collection('carrierMembers').doc(decoded.uid).get();
    if (member.exists && String(member.data()?.carrierId || '') === requested) {
      carrierId = requested;
    }
  }
  const patch = verifiedPhonePatch(digits);
  await db.collection('carriers').doc(carrierId).set(patch, { merge: true });

  const memberRef = db.collection('carrierMembers').doc(decoded.uid);
  const memberSnap = await memberRef.get();
  if (memberSnap.exists) {
    await memberRef.set(
      {
        phone: digits,
        phoneNormalized: digits,
        notificationPhone: digits,
        phoneVerified: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await consumeVerifiedSession(ref, decoded.uid);

  return { ok: true, phoneMasked: maskPhone(phone), carrierId, notificationPhone: digits };
}

async function findCarrierByPhone(db, phone) {
  const keys = phoneLookupKeys(phone);
  if (!keys.length) return null;

  for (const field of ['notificationPhone', 'phoneNormalized', 'phone']) {
    const snap = await db.collection('carriers').where(field, 'in', keys).limit(1).get();
    if (!snap.empty) return snap.docs[0];
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
  const { ref, session, now } = await loadVerifiedSession(db, phone, otpTicket);

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
  const digits = phoneDigits255(phone);
  if (digits) {
    await carrierDoc.ref.set(verifiedPhonePatch(digits), { merge: true });
    const memberRef = db.collection('carrierMembers').doc(uid);
    const memberSnap = await memberRef.get();
    if (memberSnap.exists) {
      await memberRef.set(
        {
          phone: digits,
          phoneNormalized: digits,
          notificationPhone: digits,
          phoneVerified: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  const customToken = await getAuth().createCustomToken(uid, {
    role: 'carrier',
    carrierId: carrierDoc.id,
  });

  await consumeVerifiedSession(ref, uid, { loginAtMs: now });

  console.info('carrier-otp login', { toMasked: maskPhone(phone), carrierId: carrierDoc.id });

  return {
    ok: true,
    customToken,
    carrierId: carrierDoc.id,
    status: String(carrier.status || 'pending'),
    phoneMasked: maskPhone(phone),
    notificationPhone: digits || '',
  };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * After OTP, create the Firebase user and persist the verified phone as the
 * order-SMS number on carriers + carrierMembers.
 */
async function handleRegisterWithOtp(req) {
  const body = await readJsonBody(req);
  const phone = normalizeSmsPhone(body.phone);
  const otpTicket = String(body.otpTicket || '').trim();
  const companyName = String(body.companyName || '').trim();
  const contactPerson = String(body.contactPerson || body.name || '').trim();
  const region = String(body.region || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!phone) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
  if (!otpTicket) throw badRequest('Thibitisha OTP kwanza.', 'missing_ticket');
  const digits = phoneDigits255(phone);
  if (!digits) throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
  if (companyName.length < 2) throw badRequest('Weka jina la kampuni.', 'invalid_company');
  if (contactPerson.length < 2) throw badRequest('Weka jina lako.', 'invalid_name');
  if (email && !validEmail(email)) throw badRequest('Weka barua pepe sahihi.', 'invalid_email');
  if (email && password.length < 6) throw badRequest('Nenosiri liwe angalau herufi 6.', 'weak_password');
  if (!email && password) throw badRequest('Weka barua pepe pamoja na nenosiri.', 'email_required');

  const db = getDb();
  const { ref, session } = await loadVerifiedSession(db, phone, otpTicket);
  const purpose = String(session.purpose || 'signup').trim().toLowerCase();
  if (purpose !== 'signup' && purpose !== 'login') {
    throw badRequest('OTP haitumiki kusajili.', 'bad_purpose');
  }

  const existing = await findCarrierByPhone(db, phone);
  if (existing) throw badRequest('Simu hii tayari imesajiliwa. Ingia.', 'phone_taken');

  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();
  const e164 = `+${digits}`;
  let uid = '';

  const attachExisting = async (existingUid) => {
    const member = await db.collection('carrierMembers').doc(existingUid).get();
    const owned = await db.collection('carriers').doc(existingUid).get();
    if (member.exists || owned.exists) {
      throw badRequest('Simu hii tayari imesajiliwa. Ingia.', 'phone_taken');
    }
    if (email) {
      try {
        await auth.updateUser(existingUid, { email, password, displayName: contactPerson });
      } catch (updateError) {
        if (String(updateError?.code || '') === 'auth/email-already-exists') {
          throw badRequest('Barua pepe hii tayari imesajiliwa. Ingia.', 'email_taken');
        }
        console.warn('carrier-otp register update failed', {
          code: String(updateError?.code || '') || undefined,
          reason: String(updateError?.message || '').slice(0, 160),
        });
        throw badRequest('Imeshindwa kufungua akaunti. Jaribu tena.', 'auth_create_failed');
      }
    }
    return existingUid;
  };

  try {
    const create = { phoneNumber: e164, displayName: contactPerson };
    if (email) {
      create.email = email;
      create.password = password;
    }
    const user = await auth.createUser(create);
    uid = user.uid;
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/email-already-exists') {
      throw badRequest('Barua pepe hii tayari imesajiliwa. Ingia.', 'email_taken');
    }
    if (code === 'auth/phone-number-already-exists') {
      const user = await auth.getUserByPhoneNumber(e164);
      uid = await attachExisting(user.uid);
    } else if (code === 'auth/invalid-password' || code === 'auth/weak-password') {
      throw badRequest('Nenosiri liwe angalau herufi 6.', 'weak_password');
    } else if (code === 'auth/invalid-phone-number') {
      throw badRequest('Weka namba ya simu sahihi.', 'invalid_phone');
    } else {
      console.warn('carrier-otp register auth failed', {
        code: code || undefined,
        reason: String(error?.message || '').slice(0, 160),
      });
      throw badRequest('Imeshindwa kufungua akaunti. Jaribu tena.', 'auth_create_failed');
    }
  }

  if (!uid) throw badRequest('Imeshindwa kufungua akaunti. Jaribu tena.', 'auth_create_failed');

  const carrierId = uid;
  await db.collection('carriers').doc(carrierId).set(
    {
      ownerUid: uid,
      companyName,
      name: companyName,
      contactPerson,
      ...verifiedPhonePatch(digits),
      businessEmail: email || '',
      email: email || '',
      region,
      location: region,
      physicalAddress: region,
      businessDetails: '',
      status: 'pending',
      documents: {},
      termsAcceptedAt: FieldValue.serverTimestamp(),
      coverageRegions: [],
      coverageAllTanzania: true,
      coverageIntraCity: false,
      coverageInternational: false,
      coverageInternationalCountries: '',
      notifySms: true,
      notifyPortal: true,
      ordersReceived: 0,
      accepted: 0,
      rejected: 0,
      pickups: 0,
      deliveries: 0,
      failedPickups: 0,
      customerIssues: 0,
      cashDiscrepancies: 0,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection('carrierMembers').doc(uid).set(
    {
      carrierId,
      role: 'owner',
      email: email || '',
      phone: digits,
      phoneNormalized: digits,
      notificationPhone: digits,
      phoneVerified: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await consumeVerifiedSession(ref, uid);

  const customToken = await auth.createCustomToken(uid, { role: 'carrier', carrierId });
  console.info('carrier-otp register', { toMasked: maskPhone(phone), carrierId });

  return {
    ok: true,
    customToken,
    carrierId,
    status: 'pending',
    phoneMasked: maskPhone(phone),
    notificationPhone: digits,
  };
}

module.exports = {
  handleConfirmPhone,
  handleLoginWithOtp,
  handleRegisterWithOtp,
  handleSendOtp,
  handleVerifyOtp,
  maskPhone,
  normalizeSmsPhone,
  phoneDigits255,
};
