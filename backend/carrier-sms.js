const { FieldValue } = require('firebase-admin/firestore');

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeSmsPhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length < 9) return '';
  if (digits.startsWith('0') && digits.length === 10) return `+255${digits.slice(1)}`;
  if (digits.startsWith('255') || digits.startsWith('254') || digits.startsWith('256') || digits.startsWith('250')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

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
    return `HAUL: Mzigo ${code} umefika${dest ? ` ${dest}` : ''}. Wasiliana na kampuni ${company} kuchukua.`;
  }
  if (event === 'handed' || event === 'delivered') {
    return `HAUL: Mzigo ${code} umekabidhiwa. Asante kwa kutumia HAUL.`;
  }
  if (event === 'in_transit') {
    return `HAUL: Mzigo ${code} uko safarini${dest ? ` kwenda ${dest}` : ''}.`;
  }
  return `HAUL: Hali ya mzigo ${code} imesasishwa (${event}).`;
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

  // Optional live send if a provider URL is configured (generic webhook).
  const webhook = String(process.env.SMS_WEBHOOK_URL || '').trim();
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SMS_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          to,
          body,
          event,
          orderId,
          jobId,
        }),
      });
      if (response.ok) {
        await ref.set(
          { status: 'sent', sentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        console.info('carrier-sms sent', { orderId, event, toMasked: maskPhone(to) });
        return { queued: true, sent: true, jobId };
      }
      await ref.set(
        {
          status: 'pending',
          lastError: `webhook_${response.status}`,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      await ref.set(
        {
          status: 'pending',
          lastError: 'webhook_failed',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.warn('carrier-sms webhook failed', { orderId, event, toMasked: maskPhone(to) });
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
  buildBody,
  enqueueRecipientSms,
  maskPhone,
  maybeNotifyRecipientOnShipmentChange,
  normalizeSmsPhone,
  smsEventFromTransition,
};
