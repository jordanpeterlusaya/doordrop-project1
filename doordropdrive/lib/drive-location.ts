import * as Location from 'expo-location';

export type DriveMapPoint = {
  latitude: number;
  longitude: number;
};

export const DAR_ES_SALAAM_FALLBACK: DriveMapPoint = {
  latitude: -6.7924,
  longitude: 39.2083,
};

const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  mayShowUserSettingsDialog: true,
};

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 8,
  timeInterval: 2000,
  mayShowUserSettingsDialog: true,
};

export function getLocationWatchOptions() {
  return WATCH_OPTIONS;
}

export function isValidCoordinate(latitude: unknown, longitude: unknown) {
  const latitudeValue = Number(latitude);
  const longitudeValue = Number(longitude);
  return (
    Number.isFinite(latitudeValue) &&
    Number.isFinite(longitudeValue) &&
    Math.abs(latitudeValue) <= 90 &&
    Math.abs(longitudeValue) <= 180 &&
    !(latitudeValue === 0 && longitudeValue === 0)
  );
}

export function toMapPoint(latitude: unknown, longitude: unknown): DriveMapPoint | null {
  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
}

export function resolveDriverMapPoint(
  profile?: { currentLatitude?: unknown; currentLongitude?: unknown } | null,
  livePoint?: DriveMapPoint | null
): DriveMapPoint | null {
  return livePoint ?? toMapPoint(profile?.currentLatitude, profile?.currentLongitude);
}

export async function requestDriveLocationPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { granted: false as const, foreground: foreground.status, background: 'denied' as const };
  }

  let backgroundStatus: Location.PermissionStatus = Location.PermissionStatus.UNDETERMINED;
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    backgroundStatus = background.status;
  } catch {
    backgroundStatus = Location.PermissionStatus.DENIED;
  }

  return {
    granted: true as const,
    foreground: foreground.status,
    background: backgroundStatus,
  };
}

export async function readDeviceLocation(): Promise<Location.LocationObject> {
  try {
    return await Location.getCurrentPositionAsync(LOCATION_OPTIONS);
  } catch {
    const lastKnown = await Location.getLastKnownPositionAsync();
    if (lastKnown && isValidCoordinate(lastKnown.coords.latitude, lastKnown.coords.longitude)) {
      return lastKnown;
    }
    throw new Error('Could not read device location.');
  }
}

export async function ensureLocationServicesEnabled() {
  const enabled = await Location.hasServicesEnabledAsync();
  if (enabled) {
    return true;
  }

  if (typeof Location.enableNetworkProviderAsync === 'function') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      // Ignore and re-check below.
    }
  }

  return Location.hasServicesEnabledAsync();
}

export function buildMapRegion(
  center: DriveMapPoint,
  latitudeDelta = 0.02,
  longitudeDelta = 0.02
) {
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta,
    longitudeDelta,
  };
}
