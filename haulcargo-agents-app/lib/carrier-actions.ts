import {
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { TRACK, type CarrierShipment } from '@/lib/carrier-types';
import { darTodayKey, isArrived, isLoaded, trackIndex, trackLabel } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';

function stamp() {
  return new Date().toISOString();
}

export async function acceptOffer(shipmentId: string, carrierId: string, actorEmail: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  if (current.offeredCarrierId !== carrierId) throw new Error('Not your shipment.');
  await updateDoc(ref, {
    carrierId,
    shipmentStatus: 'accepted',
    trackStep: 'received',
    pickupStatus: 'assigned',
    acceptedAt: serverTimestamp(),
    manifestDate: darTodayKey(),
    statusHistory: arrayUnion({ status: 'received', label: 'Imepokelewa', at: stamp(), actor: actorEmail }),
  });
  await updateDoc(doc(db, 'carriers', carrierId), { accepted: increment(1) });
}

export async function rejectOffer(shipmentId: string, carrierId: string, actorEmail: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  await updateDoc(ref, {
    shipmentStatus: 'matching',
    offeredCarrierId: null,
    pickupMode: deleteField(),
    trackStep: deleteField(),
    declinedCarrierIds: arrayUnion(carrierId),
    statusHistory: arrayUnion({ status: 'matching', label: 'Imekataliwa', at: stamp(), actor: actorEmail }),
  });
  await updateDoc(doc(db, 'carriers', carrierId), { rejected: increment(1) });
}

export async function setPickupMode(
  shipmentId: string,
  carrierId: string,
  mode: 'agent_collects' | 'haul_delivers_to_office',
  actorEmail: string
) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  if (current.carrierId !== carrierId) throw new Error('Not your shipment.');
  const label = mode === 'haul_delivers_to_office' ? 'Leteni ofisini' : 'Nitafuata';
  await updateDoc(ref, {
    pickupMode: mode,
    shipmentStatus: 'contacted',
    trackStep: 'pickup',
    manifestDate: darTodayKey(),
    stickerReady: true,
    stickerCreatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: mode === 'haul_delivers_to_office' ? 'inaletwa_ofisini' : 'inafuatwa',
      label,
      at: stamp(),
      actor: actorEmail,
    }),
  });
}

export async function advanceTrackStep(shipmentId: string, carrierId: string, stepKey: string, actorEmail: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = { id: shipmentId, ...snap.data() } as CarrierShipment;
  if (current.carrierId !== carrierId || !current.pickupMode) throw new Error('Not your shipment.');
  const step = TRACK.find((item) => item.key === stepKey);
  const nextIndex = step ? TRACK.findIndex((item) => item.key === step.key) : -1;
  const nowIndex = trackIndex(current);
  if (!step || nextIndex !== nowIndex + 1) return;
  const patch: Record<string, unknown> = {
    trackStep: step.key,
    shipmentStatus: step.status,
    statusHistory: arrayUnion({
      status: step.key,
      label: trackLabel(step.key, current.pickupMode),
      at: stamp(),
      actor: actorEmail,
    }),
  };
  if (step.key === 'packed') patch.pickedUpAt = serverTimestamp();
  if (step.key === 'handed') patch.deliveredAt = serverTimestamp();
  await updateDoc(ref, patch);
  if (step.key === 'packed') await updateDoc(doc(db, 'carriers', carrierId), { pickups: increment(1) });
  if (step.key === 'handed') await updateDoc(doc(db, 'carriers', carrierId), { deliveries: increment(1) });
}

export async function applyManifestMark(
  shipmentId: string,
  carrierId: string,
  stage: 'loaded' | 'arrived' | 'delivered',
  actorEmail: string
) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = { id: shipmentId, ...snap.data() } as CarrierShipment;
  if (current.carrierId !== carrierId) throw new Error('Not your shipment.');
  if (stage === 'loaded') {
    if (isLoaded(current)) return;
    await updateDoc(ref, {
      shipmentStatus: 'at_bus',
      trackStep: 'packed',
      loadedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'packed', label: 'Imepakiwa', at: stamp(), actor: actorEmail }),
    });
    return;
  }
  if (stage === 'arrived') {
    if (!isLoaded(current)) throw new Error('Mark loaded first.');
    if (isArrived(current)) return;
    await updateDoc(ref, {
      shipmentStatus: 'arrived',
      trackStep: 'arrived',
      arrivedAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'arrived', label: 'Imefika', at: stamp(), actor: actorEmail }),
    });
    return;
  }
  if (stage === 'delivered') {
    if (!isArrived(current)) throw new Error('Mark arrived first.');
    await updateDoc(ref, {
      shipmentStatus: 'delivered',
      trackStep: 'handed',
      deliveredAt: serverTimestamp(),
      statusHistory: arrayUnion({ status: 'handed', label: 'Imewasili', at: stamp(), actor: actorEmail }),
    });
    await updateDoc(doc(db, 'carriers', carrierId), { deliveries: increment(1) });
  }
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

/**
 * Honest in-app commission pay request — marks pending_reconciliation for admin reconcile.
 * Does not fake mobile-money success.
 */
export async function requestCommissionPayment(shipmentId: string, carrierId: string, actorEmail: string) {
  const ref = doc(db, 'carrierShipments', shipmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shipment not found.');
  const current = snap.data();
  if (current.carrierId !== carrierId) throw new Error('Not your shipment.');
  const haulFee = Number(current.haulFee) || 0;
  if (haulFee <= 0) throw new Error('Hakuna kamisheni ya kulipa.');
  if (current.cashStatus === 'reconciled') throw new Error('Kamisheni tayari imelinganishwa.');

  await updateDoc(ref, {
    cashStatus: 'pending_reconciliation',
    commissionPayRequest: {
      requestedAt: serverTimestamp(),
      requestedBy: actorEmail,
      method: 'manual_pay_request',
      amount: haulFee,
      note: 'Carrier requested HAUL commission payment; awaiting admin reconciliation.',
    },
    statusHistory: arrayUnion({
      status: 'commission_pay_requested',
      label: 'Ombi la kulipa kamisheni',
      at: stamp(),
      actor: actorEmail,
    }),
  });
}
