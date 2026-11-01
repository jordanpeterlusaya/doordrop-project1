import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { compactFirestoreData } from '@/lib/firestore-payload';
import { db } from '@/lib/firebase';
import { encodeGeohash } from '@/lib/geohash';

export const CUSTOMER_PRESENCE_COLLECTION = 'customerPresence';

function presenceRef(uid: string) {
  return doc(db, CUSTOMER_PRESENCE_COLLECTION, uid);
}

function firstNameFrom(fullName?: string) {
  const first = String(fullName || '')
    .trim()
    .split(/\s+/)
    .find(Boolean);
  return first || 'Customer';
}

function roundCoord(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function publishCustomerPresence(input: {
  uid: string;
  fullName?: string;
  latitude: number;
  longitude: number;
}) {
  if (!input.uid || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return;
  }

  const latitude = roundCoord(input.latitude);
  const longitude = roundCoord(input.longitude);

  const payload = compactFirestoreData({
    uid: input.uid,
    firstName: firstNameFrom(input.fullName),
    fullName: String(input.fullName || '').trim() || undefined,
    role: 'customer',
    userType: 'customer',
    latitude,
    longitude,
    geohash: encodeGeohash(latitude, longitude, 6),
    isOnline: true,
    isAppOnline: true,
    lastSeenAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    lastActiveLatitude: latitude,
    lastActiveLongitude: longitude,
    updatedAt: serverTimestamp(),
  });

  await Promise.all([
    setDoc(presenceRef(input.uid), payload, { merge: true }),
    setDoc(doc(db, 'users', input.uid), payload, { merge: true }),
  ]);
}

export async function setCustomerPresenceOffline(uid: string) {
  if (!uid) {
    return;
  }

  await Promise.all([
    setDoc(
      presenceRef(uid),
      {
        isOnline: false,
        isAppOnline: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
    setDoc(
      doc(db, 'users', uid),
      {
        isAppOnline: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ),
  ]);
}

export async function clearCustomerPresence(uid: string) {
  if (!uid) {
    return;
  }

  await deleteDoc(presenceRef(uid)).catch(async () => {
    await setCustomerPresenceOffline(uid);
  });
}
