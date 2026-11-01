import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, getDocFromCache, increment, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { readablePhone } from '@/lib/phone-link';

const PROFILE_FETCH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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
  const ref = userProfileRef(uid);
  let cachedProfile: UserProfile | null = null;

  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      cachedProfile = cached.data() as UserProfile;
    }
  } catch {
    // No local cache yet — fall through to network.
  }

  if (cachedProfile && readablePhone(cachedProfile.phoneNumber)) {
    void getDoc(ref).catch(() => undefined);
    return cachedProfile;
  }

  try {
    const snapshot = await withTimeout(
      getDoc(ref),
      PROFILE_FETCH_TIMEOUT_MS,
      'Firestore profile fetch timed out'
    );

    if (snapshot.exists()) {
      return snapshot.data() as UserProfile;
    }
  } catch (error) {
    if (cachedProfile) {
      return cachedProfile;
    }
    throw error;
  }

  return cachedProfile;
}

export async function upsertUserProfile(
  profile: Pick<UserProfile, 'uid' | 'fullName' | 'phoneNumber' | 'phoneVerified'> & {
    email?: string;
    city?: string;
    defaultPayment?: string;
    notificationPreferences?: UserProfile['notificationPreferences'];
  }
) {
  const phoneNumber = readablePhone(profile.phoneNumber);
  const profileWithoutPhone = { ...profile };
  delete profileWithoutPhone.phoneNumber;

  await setDoc(
    userProfileRef(profile.uid),
    {
      ...profileWithoutPhone,
      ...(phoneNumber ? { phoneNumber } : {}),
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
  const hasLocation =
    typeof input.latitude === 'number' &&
    Number.isFinite(input.latitude) &&
    typeof input.longitude === 'number' &&
    Number.isFinite(input.longitude);
  const shouldCount = await shouldRecordAppOpen(input.uid);

  if (!shouldCount && !hasLocation) {
    return;
  }

  const phoneNumber = readablePhone(input.phoneNumber);
  const payload: Record<string, unknown> = {
    uid: input.uid,
    fullName: input.fullName,
    email: input.email?.trim().toLowerCase() || '',
    phoneVerified: input.phoneVerified,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    isAppOnline: true,
    ...(phoneNumber ? { phoneNumber } : {}),
  };

  if (shouldCount) {
    payload.appOpenCount = increment(1);
  }

  if (hasLocation) {
    payload.lastActiveLatitude = input.latitude;
    payload.lastActiveLongitude = input.longitude;
  }

  await setDoc(userProfileRef(input.uid), payload, { merge: true });
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
