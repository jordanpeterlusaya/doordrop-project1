import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getRuntimeEnvValue } from '@/lib/runtime-env';

function getExpoExtra() {
  const manifestExtra = (Constants as any).manifest2?.extra?.expoClient?.extra;
  return Constants.expoConfig?.extra ?? manifestExtra ?? {};
}

export function getGoogleMapsApiKey() {
  const extra = getExpoExtra();
  const configuredKey =
    getRuntimeEnvValue('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    extra?.googleMapsApiKey;

  return typeof configuredKey === 'string' ? configuredKey.trim() : '';
}

export function hasGoogleMapsBuildConfig() {
  const extra = getExpoExtra() as { hasGoogleMapsApiKey?: boolean };

  if (getGoogleMapsApiKey().length > 0) {
    return true;
  }

  return extra?.hasGoogleMapsApiKey === true;
}

export function canRenderNativeGoogleMap() {
  if (Platform.OS !== 'android') {
    return true;
  }

  return hasGoogleMapsBuildConfig();
}
