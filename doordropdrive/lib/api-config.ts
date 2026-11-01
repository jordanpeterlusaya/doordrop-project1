import Constants from 'expo-constants';

const DEFAULT_API_BASE_URL = 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api';

function readExtraApiBaseUrl() {
  const extra = (Constants.expoConfig?.extra || {}) as { apiBaseUrl?: string };
  return String(extra.apiBaseUrl || '').trim();
}

function readDevHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    (Constants as { linkingUri?: string }).linkingUri,
    process.env.EXPO_DEV_SERVER_URL,
    process.env.REACT_NATIVE_PACKAGER_HOSTNAME,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) {
      continue;
    }

    const ipv4 = value.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (ipv4?.[1] && ipv4[1] !== '127.0.0.1' && ipv4[1] !== '0.0.0.0') {
      return ipv4[1];
    }

    try {
      const parsed = new URL(value.includes('://') ? value : `http://${value}`);
      if (parsed.hostname && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return parsed.hostname;
      }
    } catch {
      // Ignore malformed debugger URLs and keep scanning.
    }
  }

  return '';
}

function uniqueUrls(urls: string[]) {
  return [...new Set(urls.map((url) => url.replace(/\/+$/, '')).filter(Boolean))];
}

export function getDoorDriveApiBaseUrls() {
  const fromDevOverride = String(process.env.EXPO_PUBLIC_DEV_API_BASE_URL || '').trim();
  const fromEnv = String(process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  const fromExtra = readExtraApiBaseUrl();
  const devHost = readDevHost();

  if (__DEV__) {
    return uniqueUrls([
      fromDevOverride,
      devHost ? `http://${devHost}:4000` : '',
      'http://127.0.0.1:4000',
    ]);
  }

  return uniqueUrls([fromEnv, fromExtra, DEFAULT_API_BASE_URL]);
}

export function getDoorDriveApiBaseUrl() {
  return getDoorDriveApiBaseUrls()[0] || '';
}

export function ensureDoorDriveApiBaseUrl() {
  const baseUrl = getDoorDriveApiBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing payment server URL. Restart HAUL Pilots and try again.');
  }

  return baseUrl;
}
