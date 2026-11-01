import { collection, doc, getDoc, getDocs, limit as firestoreLimit, query, where } from 'firebase/firestore';

import { isNinunulieOrder } from '@/lib/delivery-data';
import { db } from '@/lib/firebase';

export type TrackLookupResult = {
  orderId: string;
  parcelCode?: string;
  orderNumber?: string;
  source: 'publicParcels' | 'orders';
};

export function normalizeTrackCodeInput(raw: string) {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) {
    return '';
  }

  if (/^DDX-/i.test(trimmed) || /^DD-/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^[A-Z0-9]{4,10}$/.test(trimmed)) {
    return `DDX-${trimmed}`;
  }

  return trimmed.toUpperCase();
}

export async function lookupTrackOrderByCode(rawInput: string): Promise<TrackLookupResult | null> {
  const normalized = normalizeTrackCodeInput(rawInput);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('DDX-')) {
    const parcelSnap = await getDoc(doc(db, 'publicParcels', normalized));
    if (parcelSnap.exists()) {
      const data = parcelSnap.data();
      const orderId = String(data.orderId || data.id || '').trim();
      if (orderId) {
        return {
          orderId,
          parcelCode: normalized,
          orderNumber: String(data.orderNumber || '').trim() || undefined,
          source: 'publicParcels',
        };
      }
    }
  }

  const publicByNumberQuery = query(
    collection(db, 'publicParcels'),
    where('orderNumber', '==', normalized),
    firestoreLimit(1)
  );
  const publicByNumberSnap = await getDocs(publicByNumberQuery);
  if (!publicByNumberSnap.empty) {
    const parcelDoc = publicByNumberSnap.docs[0];
    const data = parcelDoc.data();
    const orderId = String(data.orderId || '').trim();
    if (orderId) {
      return {
        orderId,
        parcelCode: parcelDoc.id,
        orderNumber: String(data.orderNumber || normalized).trim() || undefined,
        source: 'publicParcels',
      };
    }
  }

  const publicByParcelCodeQuery = query(
    collection(db, 'publicParcels'),
    where('parcelCode', '==', normalized),
    firestoreLimit(1)
  );
  const publicByParcelCodeSnap = await getDocs(publicByParcelCodeQuery);
  if (!publicByParcelCodeSnap.empty) {
    const parcelDoc = publicByParcelCodeSnap.docs[0];
    const data = parcelDoc.data();
    const orderId = String(data.orderId || '').trim();
    if (orderId) {
      return {
        orderId,
        parcelCode: String(data.parcelCode || parcelDoc.id).trim() || undefined,
        orderNumber: String(data.orderNumber || '').trim() || undefined,
        source: 'publicParcels',
      };
    }
  }

  const ordersByNumberQuery = query(
    collection(db, 'orders'),
    where('orderNumber', '==', normalized),
    firestoreLimit(1)
  );
  const ordersByNumberSnap = await getDocs(ordersByNumberQuery);
  if (!ordersByNumberSnap.empty) {
    const orderDoc = ordersByNumberSnap.docs[0];
    const data = orderDoc.data();
    if (isNinunulieOrder({ flow: data.flow, serviceLabel: data.serviceLabel })) {
      return null;
    }
    return {
      orderId: orderDoc.id,
      orderNumber: normalized,
      parcelCode: String(data.parcelCode || data.trackingId || '').trim() || undefined,
      source: 'orders',
    };
  }

  const ordersByParcelCodeQuery = query(
    collection(db, 'orders'),
    where('parcelCode', '==', normalized),
    firestoreLimit(1)
  );
  const ordersByParcelCodeSnap = await getDocs(ordersByParcelCodeQuery);
  if (!ordersByParcelCodeSnap.empty) {
    const orderDoc = ordersByParcelCodeSnap.docs[0];
    const data = orderDoc.data();
    if (isNinunulieOrder({ flow: data.flow, serviceLabel: data.serviceLabel })) {
      return null;
    }
    return {
      orderId: orderDoc.id,
      orderNumber: String(data.orderNumber || '').trim() || undefined,
      parcelCode: normalized,
      source: 'orders',
    };
  }

  return null;
}
