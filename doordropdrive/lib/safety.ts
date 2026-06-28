export function tryRequire<T = any>(modulePath: string): T | null {
  try {
    switch (modulePath) {
      case 'react-native-maps': {
        const mod = require('react-native-maps') as T;
        return mod;
      }
      case 'expo-location': {
        const mod = require('expo-location') as T;
        return mod;
      }
      default:
        return null;
    }
  } catch (err) {
    console.error(`tryRequire: failed to require ${modulePath}`, err);
    return null;
  }
}
