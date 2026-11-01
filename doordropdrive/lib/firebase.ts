import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim(),
  authDomain: (process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'efootball-app-9d175.firebaseapp.com').trim(),
  projectId: (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'efootball-app-9d175').trim(),
  storageBucket: (process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'efootball-app-9d175.firebasestorage.app').trim(),
  messagingSenderId: (process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '729242246964').trim(),
  appId: (process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:729242246964:web:bdb35a59a681a4a7420f61').trim(),
  measurementId: (process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-G3XDE8M7L5').trim(),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

function hasNativeAsyncStorage() {
  if (Platform.OS === 'web') {
    return false;
  }

  return typeof AsyncStorage?.getItem === 'function' && typeof AsyncStorage?.setItem === 'function';
}

function getFirebasePersistenceStorage() {
  return hasNativeAsyncStorage() ? AsyncStorage : undefined;
}

function createNativeAuth() {
  const authModule = firebaseAuth as typeof firebaseAuth & {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  };
  const persistenceStorage = getFirebasePersistenceStorage();
  const persistence = persistenceStorage ? authModule.getReactNativePersistence?.(persistenceStorage) : undefined;

  if (persistence) {
    return firebaseAuth.initializeAuth(firebaseApp, { persistence });
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
