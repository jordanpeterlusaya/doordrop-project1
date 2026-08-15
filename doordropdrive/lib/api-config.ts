function getRuntimeEnvValue(key: string) {
  const value = typeof process === 'undefined' ? undefined : process.env?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function getDoorDriveApiBaseUrl() {
  return getRuntimeEnvValue('EXPO_PUBLIC_API_BASE_URL').replace(/\/+$/, '');
}

export function ensureDoorDriveApiBaseUrl() {
  const baseUrl = getDoorDriveApiBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_BASE_URL. Set it to the deployed DoorDrop backend URL.');
  }

  return baseUrl;
}
