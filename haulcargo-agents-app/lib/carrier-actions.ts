import {
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { DESK_RAIL, type CarrierShipment } from '@/lib/carrier-types';
import { markShipmentArrived } from '@/lib/carrier-arrive-api';
import { darTodayKey, deskIndex, offerExpiresMs } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import { stopIncomingOrderAlarm } from '@/lib/incoming-order-sound';

function stamp() {
  return new Date().toISOString();
}

function assertOfferedTo(current: Record<string, unknown>, carrierId: string) {
  if (current.offeredCarrierId !== carrierId || current.shipmentStatus !== 'assigned' || current.carrierId) {
    throw new Error('Oda hii si yako tena.');
  }
  const expires = offerExpiresMs({ offerExpiresAt: current.offerExpiresAt } as CarrierShipment);
  if (expires && expires <= Date.now()) throw new Error('Muda umeisha.');
}

export async function acceptOffer(shipmentId: string, carrierId: string, actorEmail: string) {
  stopIncomingOrderAlarm('offer-accepted');
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Mzigo haupatikani.');
  const current = snap.data();
  assertOfferedTo(current, carrierId);
  await updateDoc(ref, {
    carrierId,
    shipmentStatus: 'accepted',
    trackStep: 'received',
    pickupStatus: 'assigned',
    acceptedAt: serverTimestamp(),
    manifestDate: darTodayKey(),
    statusHistory: arrayUnion({ status: 'received', label: 'Imekubaliwa', at: stamp(), actor: actorEmail }),
  });
  await updateDoc(doc(db, 'carriers', carrierId), { accepted: increment(1) });
}

export async function rejectOffer(shipmentId: string, carrierId: string, actorEmail: string) {
  stopIncomingOrderAlarm('offer-rejected');
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Mzigo haupatikani.');
  const current = snap.data();
  assertOfferedTo(current, carrierId);
  const batch = writeBatch(db);
  batch.update(ref, {
    shipmentStatus: 'matching',
    offeredCarrierId: null,
    pickupMode: deleteField(),
    trackStep: deleteField(),
    declinedCarrierIds: arrayUnion(carrierId),
    statusHistory: arrayUnion({ status: 'matching', label: 'Imekataliwa', at: stamp(), actor: actorEmail }),
  });
  batch.set(doc(db, 'carriers', carrierId, 'decisions', shipmentId), {
    shipmentId,
    decision: 'rejected',
    parcelCode: String(current.parcelCode || current.orderNumber || ''),
    destination: String(current.destination || ''),
    weightKg: Number(current.weightKg) || 0,
    actor: actorEmail,
    atIso: stamp(),
    at: serverTimestamp(),
  });
  batch.update(doc(db, 'carriers', carrierId), { rejected: increment(1) });
  await batch.commit();
}

/** Releasing a job after accept resets the streak and counts as a strike. */
export async function cancelAcceptedJob(shipmentId: string, carrierId: string, actorEmail: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Mzigo haupatikani.');
  const current = snap.data();
  if (current.carrierId !== carrierId) throw new Error('Hii si oda yako.');
  const status = String(current.shipmentStatus || '').toLowerCase();
  const step = String(current.trackStep || '').toLowerCase();
  if (status === 'arrived' || status === 'delivered' || step === 'arrived' || step === 'handed') {
    throw new Error('Mzigo umefika. Huwezi kufuta.');
  }
  const batch = writeBatch(db);
  batch.update(ref, {
    shipmentStatus: 'matching',
    carrierId: null,
    offeredCarrierId: null,
    pickupMode: deleteField(),
    trackStep: deleteField(),
    declinedCarrierIds: arrayUnion(carrierId),
    statusHistory: arrayUnion({ status: 'matching', label: 'Imefutwa baada ya kukubali', at: stamp(), actor: actorEmail }),
  });
  batch.set(doc(db, 'carriers', carrierId, 'decisions', shipmentId), {
    shipmentId,
    decision: 'cancelled_after_accept',
    parcelCode: String(current.parcelCode || current.orderNumber || ''),
    destination: String(current.destination || ''),
    weightKg: Number(current.weightKg) || 0,
    actor: actorEmail,
    atIso: stamp(),
    at: serverTimestamp(),
  });
  batch.update(doc(db, 'carriers', carrierId), {
    rejected: increment(1),
    postAcceptCancels: increment(1),
  });
  await batch.commit();
}

const FORWARD: Record<string, string> = {
  received: 'packed',
  packed: 'transit',
  transit: 'arrived',
};

export async function advanceDeskStep(
  shipmentId: string,
  carrierId: string,
  stepKey: string,
  actorEmail: string
) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Mzigo haupatikani.');
  const current = { id: shipmentId, ...snap.data() } as CarrierShipment;
  if (current.carrierId !== carrierId) throw new Error('Hii si oda yako.');
  if (stepKey === 'handed' || stepKey === 'delivered') {
    throw new Error('Hatua hii haiwezi tena.');
  }
  const nowKey = DESK_RAIL.find((_, index) => index === deskIndex(current))?.key || '';
  if (!nowKey || FORWARD[nowKey] !== stepKey) throw new Error('Hatua moja tu mbele.');
  const step = DESK_RAIL.find((item) => item.key === stepKey);
  if (!step) throw new Error('Hatua haijulikani.');

  const patch: Record<string, unknown> = {
    trackStep: step.key,
    shipmentStatus: step.status,
    statusHistory: arrayUnion({
      status: step.key,
      label: step.label,
      at: stamp(),
      actor: actorEmail,
    }),
  };
  if (step.key === 'packed') patch.pickedUpAt = serverTimestamp();
  if (step.key === 'arrived') {
    await markShipmentArrived(shipmentId);
    return;
  }
  await updateDoc(ref, patch);
  if (step.key === 'packed') await updateDoc(doc(db, 'carriers', carrierId), { pickups: increment(1) });
}

export async function markCashCollected(shipmentId: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  await updateDoc(ref, {
    cashStatus: 'collected',
    cashCollectedAmount: Number(current.cashExpected) || 0,
    cashCollectedAt: serverTimestamp(),
  });
}

export async function requestReconciliation(shipmentId: string) {
  await updateDoc(doc(db, 'carrierShipments', shipmentId), { cashStatus: 'pending_reconciliation' });
}
