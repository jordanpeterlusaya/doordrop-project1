import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

import { getFirebasePersistenceStorage } from '@/lib/persistent-storage';
import { getRuntimeEnvValue } from '@/lib/runtime-env';

function getFirebaseEnvValue(key: string, fallback = '') {
  return getRuntimeEnvValue(key).trim() || fallback;
}

export const firebaseConfig = {
  apiKey: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'efootball-app-9d175.firebaseapp.com'),
  projectId: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'efootball-app-9d175'),
  storageBucket: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'efootball-app-9d175.firebasestorage.app'),
  messagingSenderId: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '729242246964'),
  appId: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_APP_ID', '1:729242246964:web:bdb35a59a681a4a7420f61'),
  measurementId: getFirebaseEnvValue('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID', 'G-G3XDE8M7L5'),
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
  if (Platform.OS === 'web') {
    return firebaseAuth.getAuth(firebaseApp);
  }

  try {
    return createNativeAuth();
  } catch {
    return firebaseAuth.getAuth(firebaseApp);
  }
})();

export const db = getFirestore(firebaseApp);

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
