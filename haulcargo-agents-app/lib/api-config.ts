import Constants from 'expo-constants';

const DEFAULT_API =
  'https://us-central1-efootball-app-9d175.cloudfunctions.net/api';

export function apiBaseUrl(): string {
  const fromExtra = String((Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl || '').trim();
  const fromEnv = String(process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  return (fromEnv || fromExtra || DEFAULT_API).replace(/\/+$/, '');
}
