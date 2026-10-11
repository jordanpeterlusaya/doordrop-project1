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
