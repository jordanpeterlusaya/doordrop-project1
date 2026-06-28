import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type UserProfile = {
  uid: string;
  fullName: string;
  email?: string;
  phoneNumber: string;
  phoneVerified: boolean;
  city?: string;
  defaultPayment?: string;
  notificationPreferences?: {
    orderUpdates?: boolean;
    promotions?: boolean;
  };
  appOpenCount?: number;
  lastActiveAt?: unknown;
  lastActiveLatitude?: number;
  lastActiveLongitude?: number;
  latestPushToken?: string;
  pushTokenPlatform?: string;
  pushTokenUpdatedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function userProfileRef(uid: string) {
  return doc(db, 'users', uid);
}

const APP_OPEN_THROTTLE_MS = 15 * 60 * 1000;
const lastAppOpenByUid = new Map<string, number>();

async function shouldRecordAppOpen(uid: string) {
  const now = Date.now();
  const previousInMemory = lastAppOpenByUid.get(uid) ?? 0;
  if (now - previousInMemory < APP_OPEN_THROTTLE_MS) {
    return false;
  }

  const storageKey = `doordrop:lastAppOpen:${uid}`;
  try {
    const previousStored = Number(await AsyncStorage.getItem(storageKey));
    if (Number.isFinite(previousStored) && now - previousStored < APP_OPEN_THROTTLE_MS) {
      lastAppOpenByUid.set(uid, previousStored);
      return false;
    }

    await AsyncStorage.setItem(storageKey, String(now));
  } catch {
    // The write is still safe without local storage; memory throttle covers the current session.
  }

  lastAppOpenByUid.set(uid, now);
  return true;
}

export async function getUserProfile(uid: string) {
  const snapshot = await getDoc(userProfileRef(uid));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as UserProfile;
}

export async function upsertUserProfile(
  profile: Pick<UserProfile, 'uid' | 'fullName' | 'phoneNumber' | 'phoneVerified'> & {
    email?: string;
    city?: string;
    defaultPayment?: string;
    notificationPreferences?: UserProfile['notificationPreferences'];
  }
) {
  await setDoc(
    userProfileRef(profile.uid),
    {
      ...profile,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function recordUserAppOpen(input: {
  uid: string;
  fullName: string;
  phoneNumber: string;
  phoneVerified: boolean;
  email?: string;
  latitude?: number;
  longitude?: number;
}) {
  if (!(await shouldRecordAppOpen(input.uid))) {
    return;
  }

  await setDoc(
    userProfileRef(input.uid),
    {
      uid: input.uid,
      fullName: input.fullName,
      email: input.email?.trim().toLowerCase() || '',
      phoneNumber: input.phoneNumber,
      phoneVerified: input.phoneVerified,
      appOpenCount: increment(1),
      lastActiveAt: serverTimestamp(),
      lastActiveLatitude: input.latitude,
      lastActiveLongitude: input.longitude,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function recordUserPushToken(input: {
  uid: string;
  token: string;
  platform: string;
}) {
  await setDoc(
    userProfileRef(input.uid),
    {
      latestPushToken: input.token,
      pushTokenPlatform: input.platform,
      pushTokenUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}
