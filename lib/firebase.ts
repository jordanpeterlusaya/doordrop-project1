import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

import { getFirebasePersistenceStorage } from '@/lib/persistent-storage';

type FirebaseExtra = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
  firebaseMeasurementId?: string;
};

function extraFirebase() {
  return (Constants.expoConfig?.extra ?? {}) as FirebaseExtra;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }

  return '';
}

export const firebaseConfig = {
  apiKey: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_API_KEY, extraFirebase().firebaseApiKey),
  authDomain: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    extraFirebase().firebaseAuthDomain,
    'efootball-app-9d175.firebaseapp.com'
  ),
  projectId: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    extraFirebase().firebaseProjectId,
    'efootball-app-9d175'
  ),
  storageBucket: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    extraFirebase().firebaseStorageBucket,
    'efootball-app-9d175.firebasestorage.app'
  ),
  messagingSenderId: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    extraFirebase().firebaseMessagingSenderId,
    '729242246964'
  ),
  appId: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    extraFirebase().firebaseAppId,
    '1:729242246964:web:bdb35a59a681a4a7420f61'
  ),
  measurementId: firstNonEmpty(
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
    extraFirebase().firebaseMeasurementId,
    'G-G3XDE8M7L5'
  ),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

function getNativePersistence() {
  const authModule = firebaseAuth as typeof firebaseAuth & {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  };
  const persistenceStorage = getFirebasePersistenceStorage();

  if (!persistenceStorage) {
    return undefined;
  }

  return authModule.getReactNativePersistence?.(persistenceStorage);
}

function createNativeAuth() {
  const persistence = getNativePersistence();

  if (persistence) {
    return firebaseAuth.initializeAuth(firebaseApp, {
      persistence,
    });
  }

  return firebaseAuth.initializeAuth(firebaseApp);
}

export const auth = (() => {
  try {
    if (Platform.OS === 'web') {
      return firebaseAuth.getAuth(firebaseApp);
    }

    try {
      return createNativeAuth();
    } catch {
      return firebaseAuth.getAuth(firebaseApp);
    }
  } catch {
    return firebaseAuth.getAuth(firebaseApp);
  }
})();

/**
 * React Native / Expo often fails WebChannel streaming to Firestore
 * ("Could not reach Cloud Firestore backend"). Force long-polling on native.
 */
function createFirestore() {
  if (Platform.OS === 'web') {
    return getFirestore(firebaseApp);
  }

  try {
    return initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
    });
  } catch {
    return getFirestore(firebaseApp);
  }
}

export const db = createFirestore();

export const storage = getStorage(firebaseApp);

export async function enableAnalytics() {
  if (Platform.OS !== 'web') {
    return null;
  }

  try {
    const analyticsModule = await import('firebase/analytics');
    const supported = await analyticsModule.isSupported();
    return supported ? analyticsModule.getAnalytics(firebaseApp) : null;
  } catch {
    return null;
  }
}
