import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export function getFirebasePersistenceStorage() {
  if (Platform.OS === 'web') return undefined;
  if (typeof AsyncStorage?.getItem === 'function') return AsyncStorage;
  return undefined;
}
