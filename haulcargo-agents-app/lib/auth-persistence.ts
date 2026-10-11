import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firebaseAuth from 'firebase/auth';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
  type Persistence,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { auth } from '@/lib/firebase';
import { getFirebasePersistenceStorage } from '@/lib/persistent-storage';

const REMEMBER_ME_KEY = 'haul.agents.rememberMe';
const EXPLICIT_LOGOUT_KEY = 'haul.agents.explicitLogout';
const FIREBASE_AUTH_KEY_PREFIXES = ['firebase:authUser:', 'firebase:persistence:'];

/**
 * In-memory lock so a persisted Firebase user cannot bounce the UI back to the
 * desk before React state and AsyncStorage have both dropped the session.
 * Cold start reads EXPLICIT_LOGOUT_KEY because this flag resets with the JS runtime.
 */
let explicitSignOutActive = false;
let acceptNextSignIn = false;

export function beginExplicitSignOut(): void {
  explicitSignOutActive = true;
  acceptNextSignIn = false;
}

export function isExplicitSignOutActive(): boolean {
  return explicitSignOutActive;
}

/** Allow the next auth-state user through. Used only around a real sign-in or sign-up. */
export function allowNextSignedInUser(): void {
  acceptNextSignIn = true;
}

/** Sign-in failed before a user was accepted. Does not start an explicit logout. */
export function cancelPendingSignIn(): void {
  acceptNextSignIn = false;
}

export function shouldRejectRestoredUser(nextUser: unknown): boolean {
  if (!nextUser || !explicitSignOutActive) return false;
  if (acceptNextSignIn) {
    acceptNextSignIn = false;
    explicitSignOutActive = false;
    return false;
  }
  return true;
}

export function noteSignedInUserAccepted(): void {
  acceptNextSignIn = false;
  explicitSignOutActive = false;
}

export async function markExplicitLogout(): Promise<void> {
  beginExplicitSignOut();
  try {
    await AsyncStorage.setItem(EXPLICIT_LOGOUT_KEY, '1');
  } catch {
    // Module lock still blocks this runtime if storage is unavailable.
  }
}

export async function clearExplicitLogout(): Promise<void> {
  noteSignedInUserAccepted();
  try {
    await AsyncStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } catch {
    // The in-memory lock is already clear so this sign-in can finish.
  }
}

export async function wasExplicitLogout(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(EXPLICIT_LOGOUT_KEY);
    return value === '1' || value === 'true';
  } catch {
    return explicitSignOutActive;
  }
}

/** Drop Firebase Auth blobs so Remember me cannot restore a session after logout. */
export async function purgePersistedFirebaseAuth(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const authKeys = keys.filter((key) => FIREBASE_AUTH_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)));
    if (authKeys.length) await AsyncStorage.multiRemove(authKeys);
  } catch {
    // Best effort. The explicit-logout flag still blocks a restored session.
  }
}

/** Default on — returning agents stay signed in unless they opt out. */
export async function getRememberMePreference(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(REMEMBER_ME_KEY);
    if (value == null) return true;
    return value === '1' || value === 'true';
  } catch {
    return true;
  }
}

export async function setRememberMePreference(rememberMe: boolean): Promise<void> {
  await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? '1' : '0');
}

function nativePersistent(): Persistence | null {
  const authModule = firebaseAuth as typeof firebaseAuth & {
    getReactNativePersistence?: (
      storage: NonNullable<ReturnType<typeof getFirebasePersistenceStorage>>
    ) => Persistence;
  };
  const storage = getFirebasePersistenceStorage();
  if (storage && authModule.getReactNativePersistence) {
    return authModule.getReactNativePersistence(storage);
  }
  return null;
}

/**
 * Apply Firebase Auth persistence before email/password sign-in.
 * Remember me → AsyncStorage (native) / local (web).
 * Unchecked → in-memory (native) / session (web) so a cold start requires sign-in again.
 */
export async function applyAuthPersistence(rememberMe: boolean): Promise<void> {
  await setRememberMePreference(rememberMe);

  if (Platform.OS === 'web') {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    return;
  }

  if (rememberMe) {
    const persistence = nativePersistent();
    if (persistence) {
      await setPersistence(auth, persistence);
      return;
    }
  }

  await setPersistence(auth, inMemoryPersistence);
}
