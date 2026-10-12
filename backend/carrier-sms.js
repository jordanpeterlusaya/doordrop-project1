const { FieldValue } = require('firebase-admin/firestore');
const { config } = require('./config');
const { isSmsBalanceError, mamboSenderId, maskPhone, normalizeSmsPhone, sendSms, smsConfigured } = require('./sms-provider');

function parcelCodeOf(shipment, orderId) {
  return String(shipment?.parcelCode || shipment?.orderNumber || orderId || '')
    .trim()
    .toUpperCase();
}

function buildBody(event, shipment, orderId) {
  const code = parcelCodeOf(shipment, orderId);
  const company = String(shipment?.carrierCompanyName || shipment?.routeLabel || 'HAUL Cargo').trim();
  const dest = String(shipment?.destination || '').trim();
  const sender = String(shipment?.customerName || 'Mtumaji').trim();

  if (event === 'accepted') {
    return `HAUL: ${company} imepokea mzigo wako ${code}${dest ? ` kwenda ${dest}` : ''}. Kutoka ${sender}. Fuatilia kwa msimbo huu kwenye HAUL.`;
  }
  if (event === 'arrived') {
    return buildArrivalBody(shipment, orderId);
  }
  if (event === 'handed' || event === 'delivered') {
    return `HAUL: Mzigo ${code} umekabidhiwa. Asante kwa kutumia HAUL.`;
  }
  if (event === 'in_transit') {
    return `HAUL: Mzigo ${code} uko safarini${dest ? ` kwenda ${dest}` : ''}.`;
  }
  return `HAUL: Hali ya mzigo ${code} imesasishwa (${event}).`;
}

function clipSms(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * Kiswahili arrival text for both mpokeaji and mtumaji.
 * One SMS when it fits; the gateway may split a longer body into two.
 */
function buildArrivalBody(shipment, orderId, contact = {}) {
  const code = parcelCodeOf(shipment, orderId) || 'MZIGO';
  const pickup = clipSms(contact.pickup || shipment?.pickupLabel || shipment?.origin || '', 36);
  const dest = clipSms(contact.destination || shipment?.destination || '', 36);
  const company = clipSms(contact.companyName || shipment?.carrierCompanyName || '', 28);
  const phone = clipSms(contact.confirmPhone || '', 18);
  const route = pickup && dest ? `${pickup} → ${dest}` : dest || pickup;
  let body = `HAUL: ${code} umefika.`;
  if (route) body += ` ${route}.`;
  if (company) body += ` ${company}.`;
  if (phone) body += ` Piga ${phone}.`;
  if (body.length > 300) {
    const shortRoute = pickup && dest ? `${clipSms(pickup, 18)} → ${clipSms(dest, 18)}` : clipSms(route, 40);
    body = `HAUL: ${code} umefika.`;
    if (shortRoute) body += ` ${shortRoute}.`;
    if (company) body += ` ${clipSms(company, 18)}.`;
    if (phone) body += ` Piga ${phone}.`;
  }
  return body.slice(0, 320);
}

function opsConfirmPhone() {
  return String(config.supportPhone || '').trim();
}

async function resolveConfirmContact(db, shipment) {
  const carrierId = String(shipment?.carrierId || shipment?.offeredCarrierId || '').trim();
  let company = String(shipment?.carrierCompanyName || '').trim();
  let phone = String(shipment?.carrierPhone || '').trim();
  if (carrierId) {
    try {
      const snap = await db.collection('carriers').doc(carrierId).get();
      if (snap.exists) {
        const carrier = snap.data() || {};
        const trading = String(carrier.tradingName || '').trim();
        const registered = String(carrier.companyName || carrier.name || '').trim();
        if (!company) company = trading || registered;
        if (!phone) phone = String(carrier.phone || '').trim();
      }
    } catch {
      // Fall through to the ops line already in config.
    }
  }
  if (!phone) phone = opsConfirmPhone();
  return { companyName: company, confirmPhone: phone };
}

async function notifyAdminSmsBalance(db, { orderId, shipment, detail }) {
  const code = parcelCodeOf(shipment, orderId);
  const ref = db.collection('adminNotifications').doc(`sms_balance_${orderId}`);
  const existing = await ref.get();
  const message = `Mzigo ${code} umewekwa Imefika. SMS haikutumwa kwa sababu salio la Mambo limeisha.`;
  if (!existing.exists) {
    await ref.set({
      type: 'sms_balance_exhausted',
      email: config.adminEmail,
      title: 'Salio la SMS limeisha',
      message,
      orderId,
      parcelCode: code,
      detail: String(detail || 'mambo_insufficient_balance').slice(0, 180),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  const adminEmail = String(config.adminEmail || '').trim().toLowerCase();
  if (!adminEmail) return;
  try {
    const users = await db.collection('users').where('email', '==', adminEmail).limit(1).get();
    if (users.empty) return;
    await db.collection('userNotifications').doc(`sms_balance_${orderId}`).set(
      {
        userId: users.docs[0].id,
        orderId,
        orderNumber: code,
        title: 'Salio la SMS limeisha',
        message,
        type: 'admin_sms_balance',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('admin sms balance notification failed', orderId, error?.message || error);
  }
}

function arrivalJobId(orderId, audience) {
  return audience === 'sender' ? `${orderId}_arrived_sender` : `${orderId}_arrived`;
}

function jobWasSent(snap) {
  return Boolean(snap?.exists && snap.data()?.status === 'sent');
}

/**
 * Arrival SMS must go through Mambo. The signup OTP bypass is not consulted here.
 */
function assertMamboLive() {
  const named = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const provider = named === 'mambosms' ? 'mambo' : named;
  const token = String(process.env.MAMBO_SMS_API_TOKEN || process.env.SMS_API_KEY || '').trim();
  const senderId = mamboSenderId();
  if (provider && provider !== 'mambo') {
    const error = new Error('SMS ya kufika inatumwa kupitia Mambo tu.');
    error.statusCode = 503;
    error.code = 'sms_not_mambo';
    throw error;
  }
  if (!token || !senderId || !smsConfigured()) {
    const error = new Error('Huduma ya SMS haijawekwa. SMS haijatumwa.');
    error.statusCode = 503;
    error.code = 'sms_not_configured';
    throw error;
  }
}

async function resolveArrivalPhones(db, orderId, shipment) {
  let recipient = String(shipment?.recipientPhone || '').trim();
  let sender = String(shipment?.customerPhone || shipment?.senderPhone || '').trim();
  let userId = String(shipment?.userId || '').trim();
  if (!normalizeSmsPhone(recipient) || !normalizeSmsPhone(sender) || !userId) {
    try {
      const snap = await db.collection('orders').doc(orderId).get();
      const order = snap.exists ? snap.data() || {} : {};
      if (!userId) userId = String(order.userId || '').trim();
      if (!normalizeSmsPhone(recipient)) {
        recipient = String(order.recipientPhone || order.receiverPhone || '').trim();
      }
      if (!normalizeSmsPhone(sender)) {
        sender = String(order.customerPhone || order.senderPhone || order.phoneNumber || '').trim();
      }
    } catch {
      // Shipment phones still apply if the order lookup fails.
    }
  }
  if (!normalizeSmsPhone(sender) && userId && !userId.startsWith('manual:')) {
    try {
      const userSnap = await db.collection('users').doc(userId).get();
      if (userSnap.exists) {
        const user = userSnap.data() || {};
        sender = String(user.phoneNumber || user.phone || '').trim();
      }
    } catch {
      // Keep the shipment/order sender phone if the profile lookup fails.
    }
  }
  return { recipient, sender };
}

function smsError(audience, cause) {
  const detail = String(cause?.message || 'Jaribu tena.').slice(0, 240);
  const prefix = audience === 'sender' ? 'SMS ya mtumaji imeshindwa.' : 'SMS ya mpokeaji imeshindwa.';
  const error = new Error(`${prefix} ${detail}`);
  error.statusCode = cause?.statusCode || 503;
  error.code = cause?.code || 'sms_failed';
  if (cause?.causeDetail) error.causeDetail = String(cause.causeDetail).slice(0, 180);
  return error;
}

function missingPhoneError(audience) {
  const error = new Error(
    audience === 'sender'
      ? 'Mtumaji hana nambari ya simu. SMS haijatumwa.'
      : 'Mpokeaji hana nambari ya simu. SMS haijatumwa.'
  );
  error.statusCode = 400;
  error.code = audience === 'sender' ? 'no_sender_phone' : 'no_recipient_phone';
  return error;
}

async function writeSmsJob(ref, existing, payload) {
  const data = {
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!existing?.exists) data.createdAt = FieldValue.serverTimestamp();
  await ref.set(data, { merge: true });
}

async function deliverArrivalSms(db, { orderId, shipment, to, body, audience }) {
  const jobId = arrivalJobId(orderId, audience);
  const ref = db.collection('smsJobs').doc(jobId);
  const existing = await ref.get();
  if (jobWasSent(existing)) {
    return { sent: true, skipped: true, reason: 'already-sent', jobId, audience };
  }

  let result;
  try {
    result = await sendSms(to, body, { event: 'arrived', orderId, jobId, audience });
  } catch (cause) {
    const balance = isSmsBalanceError(cause);
    await writeSmsJob(ref, existing, {
      toMasked: maskPhone(to),
      body,
      event: 'arrived',
      orderId,
      parcelCode: parcelCodeOf(shipment, orderId),
      channel: 'sms',
      audience,
      provider: 'mambo',
      status: 'failed',
      errorCode: balance ? 'mambo_insufficient_balance' : String(cause?.code || 'sms_failed').slice(0, 80),
      lastError: String(cause?.message || 'sms_failed').slice(0, 240),
    });
    if (balance) {
      return { sent: false, balanceExhausted: true, jobId, audience, code: 'mambo_insufficient_balance' };
    }
    throw smsError(audience, cause);
  }

  if (result?.provider !== 'mambo') {
    await writeSmsJob(ref, existing, {
      toMasked: maskPhone(to),
      body,
      event: 'arrived',
      orderId,
      audience,
      provider: result?.provider || 'unknown',
      status: 'failed',
      lastError: 'sms_not_mambo',
    });
    throw smsError(audience, { message: 'SMS haijatumwa kupitia Mambo.', statusCode: 503, code: 'sms_not_mambo' });
  }

  await writeSmsJob(ref, existing, {
    to: result.to || to,
    toMasked: maskPhone(to),
    body,
    event: 'arrived',
    orderId,
    parcelCode: parcelCodeOf(shipment, orderId),
    channel: 'sms',
    audience,
    provider: 'mambo',
    status: 'sent',
    messageId: result.messageId || null,
    sentAt: FieldValue.serverTimestamp(),
  });
  return { sent: true, skipped: false, jobId, audience, provider: 'mambo', messageId: result.messageId || null };
}

async function markSharedParty(db, { orderId, shipment, body, messageId, audience, phone }) {
  const jobId = arrivalJobId(orderId, audience);
  const ref = db.collection('smsJobs').doc(jobId);
  const existing = await ref.get();
  if (jobWasSent(existing)) {
    return { sent: true, skipped: true, reason: 'already-sent', jobId, audience };
  }
  await writeSmsJob(ref, existing, {
    toMasked: maskPhone(phone),
    body,
    event: 'arrived',
    orderId,
    parcelCode: parcelCodeOf(shipment, orderId),
    channel: 'sms',
    audience,
    provider: 'mambo',
    status: 'sent',
    sharedPhone: true,
    messageId: messageId || null,
    sentAt: FieldValue.serverTimestamp(),
  });
  return {
    sent: true,
    skipped: false,
    sharedPhone: true,
    jobId,
    audience,
    provider: 'mambo',
    messageId: messageId || null,
  };
}

async function noteArrivalSms(db, orderId, result) {
  if (!result?.sent || result.skipped) return;
  const field = result.audience === 'sender' ? 'senderSmsEvents' : 'recipientSmsEvents';
  await db.collection('carrierShipments').doc(orderId).set(
    {
      [field]: FieldValue.arrayUnion({
        event: 'arrived',
        jobId: result.jobId,
        at: new Date().toISOString(),
        status: 'sent',
        audience: result.audience,
      }),
      arrivalSmsError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Real Mambo SMS when cargo is marked Imefika.
 * audiences defaults to both parties. Pass ['sender'] to text only the sender
 * (used when the recipient was already notified).
 */
function jobBalanceFailed(snap) {
  if (!snap?.exists) return false;
  const data = snap.data() || {};
  return data.status === 'failed' && data.errorCode === 'mambo_insufficient_balance';
}

async function sendArrivalNotices(db, { orderId, shipment, audiences } = {}) {
  const wanted = Array.isArray(audiences) && audiences.length ? audiences : ['recipient', 'sender'];
  const wantRecipient = wanted.includes('recipient');
  const wantSender = wanted.includes('sender');
  const contact = await resolveConfirmContact(db, shipment);
  const body = buildArrivalBody(shipment, orderId, contact);
  const recipientRef = db.collection('smsJobs').doc(arrivalJobId(orderId, 'recipient'));
  const senderRef = db.collection('smsJobs').doc(arrivalJobId(orderId, 'sender'));
  const [recipientSnap, senderSnap] = await Promise.all([recipientRef.get(), senderRef.get()]);
  const recipientSent = jobWasSent(recipientSnap);
  const senderSent = jobWasSent(senderSnap);
  const balanceAlready =
    (wantRecipient && jobBalanceFailed(recipientSnap)) || (wantSender && jobBalanceFailed(senderSnap));
  if (balanceAlready && (!wantRecipient || recipientSent || jobBalanceFailed(recipientSnap)) && (!wantSender || senderSent || jobBalanceFailed(senderSnap))) {
    await notifyAdminSmsBalance(db, { orderId, shipment, detail: 'mambo_insufficient_balance' });
    return {
      ok: true,
      balanceExhausted: true,
      body,
      recipient: {
        sent: recipientSent,
        skipped: true,
        balanceExhausted: jobBalanceFailed(recipientSnap),
        jobId: arrivalJobId(orderId, 'recipient'),
      },
      sender: {
        sent: senderSent,
        skipped: true,
        balanceExhausted: jobBalanceFailed(senderSnap),
        jobId: arrivalJobId(orderId, 'sender'),
      },
    };
  }
  if ((!wantRecipient || recipientSent) && (!wantSender || senderSent)) {
    return {
      ok: true,
      body,
      recipient: { sent: recipientSent, skipped: true, jobId: arrivalJobId(orderId, 'recipient') },
      sender: { sent: senderSent, skipped: true, jobId: arrivalJobId(orderId, 'sender') },
    };
  }

  const phones = await resolveArrivalPhones(db, orderId, shipment);
  const recipientTo = normalizeSmsPhone(phones.recipient);
  const senderTo = normalizeSmsPhone(phones.sender);
  const samePhone = Boolean(recipientTo && senderTo && recipientTo === senderTo);

  if (wantRecipient && !recipientSent && !recipientTo) throw missingPhoneError('recipient');
  if (wantSender && !senderSent && !senderTo) throw missingPhoneError('sender');

  const needsLiveSend =
    (wantRecipient && !recipientSent) || (wantSender && !senderSent && !(samePhone && (recipientSent || wantRecipient)));
  if (needsLiveSend) assertMamboLive();

  let recipient = { sent: recipientSent, skipped: recipientSent, jobId: arrivalJobId(orderId, 'recipient') };
  let sender = { sent: senderSent, skipped: senderSent, jobId: arrivalJobId(orderId, 'sender') };

  if (wantRecipient && !recipientSent) {
    recipient = await deliverArrivalSms(db, { orderId, shipment, to: recipientTo, body, audience: 'recipient' });
    if (recipient.balanceExhausted) {
      await notifyAdminSmsBalance(db, { orderId, shipment, detail: recipient.code });
      return { ok: true, balanceExhausted: true, body, recipient, sender };
    }
    await noteArrivalSms(db, orderId, recipient);
  }

  if (wantSender && !senderSent) {
    if (samePhone && (recipientSent || recipient.sent)) {
      const messageId = recipient.messageId || recipientSnap.data()?.messageId || null;
      sender = await markSharedParty(db, {
        orderId,
        shipment,
        body,
        messageId,
        audience: 'sender',
        phone: senderTo,
      });
    } else {
      sender = await deliverArrivalSms(db, { orderId, shipment, to: senderTo, body, audience: 'sender' });
      if (sender.balanceExhausted) {
        await notifyAdminSmsBalance(db, { orderId, shipment, detail: sender.code });
        return { ok: true, balanceExhausted: true, body, recipient, sender };
      }
      if (samePhone && !recipientSent && !recipient.sent) {
        recipient = await markSharedParty(db, {
          orderId,
          shipment,
          body,
          messageId: sender.messageId,
          audience: 'recipient',
          phone: recipientTo,
        });
        await noteArrivalSms(db, orderId, recipient);
      }
    }
    await noteArrivalSms(db, orderId, sender);
  }

  return { ok: true, body, recipient, sender };
}

function smsEventFromTransition(beforeStatus, afterStatus, beforeStep, afterStep) {
  const before = String(beforeStatus || '').toLowerCase();
  const after = String(afterStatus || '').toLowerCase();
  const step = String(afterStep || '').toLowerCase();

  if (after === 'accepted' && before !== 'accepted') return 'accepted';
  if ((after === 'arrived' || step === 'arrived') && before !== 'arrived' && before !== 'delivered') return 'arrived';
  if ((after === 'delivered' || step === 'handed') && before !== 'delivered') return 'handed';
  if (after === 'in_transit' && before !== 'in_transit') return 'in_transit';
  return null;
}

/**
 * Prefer a real outbound SMS provider when env is configured; otherwise enqueue smsJobs
 * for an admin/worker to send. Never log full phone numbers.
 */
async function enqueueRecipientSms(db, { orderId, shipment, event, carrierCompanyName }) {
  const rawPhone = String(shipment?.recipientPhone || '').trim();
  const to = normalizeSmsPhone(rawPhone);
  if (!to) {
    console.info('carrier-sms skip', { orderId, event, reason: 'no-recipient-phone' });
    return { skipped: true, reason: 'no-phone' };
  }

  const jobId = `${orderId}_${event}`;
  const ref = db.collection('smsJobs').doc(jobId);
  const existing = await ref.get();
  if (existing.exists) {
    return { skipped: true, reason: 'already-queued', jobId };
  }

  const body = buildBody(event, { ...shipment, carrierCompanyName }, orderId);
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const payload = {
    to,
    toMasked: maskPhone(to),
    body,
    event,
    orderId,
    parcelCode: parcelCodeOf(shipment, orderId),
    channel: 'sms',
    audience: 'recipient',
    provider: provider || 'queue',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await ref.set(payload, { merge: true });

  // Live send when Africa's Talking / Twilio / SMS_API_* / webhook is configured.
  if (smsConfigured()) {
    try {
      const result = await sendSms(to, body, { event, orderId, jobId, audience: 'recipient' });
      await ref.set(
        {
          status: 'sent',
          provider: result.provider || provider || 'live',
          sentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.info('carrier-sms sent', { orderId, event, toMasked: maskPhone(to), provider: result.provider });
      return { queued: true, sent: true, jobId };
    } catch (error) {
      await ref.set(
        {
          status: 'pending',
          lastError: String(error?.message || 'sms_failed').slice(0, 160),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.warn('carrier-sms send failed', { orderId, event, toMasked: maskPhone(to) });
    }
  } else {
    console.info('carrier-sms queued', { orderId, event, toMasked: maskPhone(to) });
  }

  return { queued: true, sent: false, jobId };
}

async function maybeNotifyRecipientOnShipmentChange(db, orderId, before, after) {
  if (!after) return { skipped: true };
  const event = smsEventFromTransition(
    before?.shipmentStatus,
    after.shipmentStatus,
    before?.trackStep,
    after.trackStep
  );
  if (!event) return { skipped: true };

  if (event === 'arrived') {
    return sendArrivalNotices(db, { orderId, shipment: after });
  }

  let carrierCompanyName = '';
  const carrierId = String(after.carrierId || '').trim();
  if (carrierId) {
    try {
      const snap = await db.collection('carriers').doc(carrierId).get();
      if (snap.exists) carrierCompanyName = String(snap.data()?.companyName || '').trim();
    } catch {
      // ignore lookup failures — body still works without company name
    }
  }

  const result = await enqueueRecipientSms(db, {
    orderId,
    shipment: after,
    event,
    carrierCompanyName,
  });

  if (result?.jobId) {
    await db
      .collection('carrierShipments')
      .doc(orderId)
      .set(
        {
          recipientSmsEvents: FieldValue.arrayUnion({
            event,
            jobId: result.jobId,
            at: new Date().toISOString(),
            status: result.sent ? 'sent' : 'queued',
          }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return result;
}

module.exports = {
  buildArrivalBody,
  buildBody,
  enqueueRecipientSms,
  maskPhone,
  maybeNotifyRecipientOnShipmentChange,
  normalizeSmsPhone,
  notifyAdminSmsBalance,
  sendArrivalNotices,
  smsEventFromTransition,
};
