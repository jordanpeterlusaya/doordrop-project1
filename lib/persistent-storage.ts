import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const memoryStorage = new Map<string, string>();

function canUseBrowserStorage() {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export function hasNativeAsyncStorage() {
  if (Platform.OS === 'web') {
    return false;
  }

  // New-architecture builds may not expose AsyncStorage under NativeModules.
  // The imported module methods are the safer capability check here.
  return typeof AsyncStorage?.getItem === 'function' && typeof AsyncStorage?.setItem === 'function';
}

export function getFirebasePersistenceStorage() {
  if (!hasNativeAsyncStorage()) {
    return undefined;
  }

  return AsyncStorage;
}

export async function getPersistedItem(key: string) {
  if (canUseBrowserStorage()) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  }

  if (!hasNativeAsyncStorage()) {
    return memoryStorage.get(key) ?? null;
  }

  try {
    const value = await AsyncStorage.getItem(key);

    if (value !== null) {
      memoryStorage.set(key, value);
    }

    return value ?? memoryStorage.get(key) ?? null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
}

export async function setPersistedItem(key: string, value: string) {
  memoryStorage.set(key, value);

  if (canUseBrowserStorage()) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      return;
    }
    return;
  }

  if (!hasNativeAsyncStorage()) {
    return;
  }

  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    return;
  }
}
