import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

import { getFirebasePersistenceStorage } from '@/lib/persistent-storage';

type FirebaseExtra = {
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
};

function extraFirebase() {
  return (Constants.expoConfig?.extra ?? {}) as FirebaseExtra;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return '';
}

export const firebaseConfig = {
  apiKey: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_API_KEY, extraFirebase().firebaseApiKey, 'AIzaSyD97lPfGR0Yf0z-WfCl1L_rYH9HPlgE3s0'),
  authDomain: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, extraFirebase().firebaseAuthDomain, 'efootball-app-9d175.firebaseapp.com'),
  projectId: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, extraFirebase().firebaseProjectId, 'efootball-app-9d175'),
  storageBucket: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET, extraFirebase().firebaseStorageBucket, 'efootball-app-9d175.firebasestorage.app'),
  messagingSenderId: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, extraFirebase().firebaseMessagingSenderId, '729242246964'),
  appId: firstNonEmpty(process.env.EXPO_PUBLIC_FIREBASE_APP_ID, extraFirebase().firebaseAppId, '1:729242246964:web:bdb35a59a681a4a7420f61'),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createNativeAuth() {
  const authModule = firebaseAuth as typeof firebaseAuth & {
    getReactNativePersistence?: (storage: NonNullable<ReturnType<typeof getFirebasePersistenceStorage>>) => Persistence;
  };
  const storage = getFirebasePersistenceStorage();
  if (storage && authModule.getReactNativePersistence) {
    return firebaseAuth.initializeAuth(firebaseApp, { persistence: authModule.getReactNativePersistence(storage) });
  }
  return firebaseAuth.initializeAuth(firebaseApp);
}

export const auth = (() => {
  try {
    if (Platform.OS === 'web') return firebaseAuth.getAuth(firebaseApp);
    try {
      return createNativeAuth();
    } catch {
      return firebaseAuth.getAuth(firebaseApp);
    }
  } catch {
    return firebaseAuth.getAuth(firebaseApp);
  }
})();

function createFirestore() {
  if (Platform.OS === 'web') return getFirestore(firebaseApp);
  try {
    return initializeFirestore(firebaseApp, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(firebaseApp);
  }
}

export const db = createFirestore();
