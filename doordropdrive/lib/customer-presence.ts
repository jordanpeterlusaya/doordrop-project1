import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { getDoorDriveApiBaseUrls } from './api-config';
import { auth, db } from './firebase';
import { cellsNear } from './geohash';

export type NearbyCustomer = {
  id: string;
  firstName: string;
  latitude: number;
  longitude: number;
  displayLatitude: number;
  displayLongitude: number;
  distanceKm?: number;
};

const CUSTOMER_PRESENCE_COLLECTION = 'customerPresence';
const ONLINE_WINDOW_MS = 45 * 60 * 1000;

function toMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function offsetForId(id: string, latitude: number, longitude: number) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }

  const dLat = ((hash % 17) - 8) * 0.00018;
  const dLng = (((hash >> 4) % 17) - 8) * 0.00018;
  return {
    latitude: latitude + dLat,
    longitude: longitude + dLng,
  };
}

function isFreshOnline(data: { isOnline?: unknown; lastSeenAt?: unknown; updatedAt?: unknown }) {
  const lastSeen = toMillis(data.lastSeenAt ?? data.updatedAt);
  if (lastSeen && Date.now() - lastSeen > ONLINE_WINDOW_MS) {
    return false;
  }

  return lastSeen > 0 || data.isOnline === true;
}

function toNearbyCustomer(input: {
  id: string;
  firstName?: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
}): NearbyCustomer {
  const display = offsetForId(input.id, input.latitude, input.longitude);
  return {
    id: input.id,
    firstName: String(input.firstName || '').trim() || 'Mteja',
    latitude: input.latitude,
    longitude: input.longitude,
    displayLatitude: display.latitude,
    displayLongitude: display.longitude,
    distanceKm: input.distanceKm,
  };
}

function isCustomerLike(data: { role?: unknown; userRole?: unknown; userType?: unknown }) {
  const role = String(data.role ?? data.userRole ?? '').trim().toLowerCase();
  const userType = String(data.userType ?? '').trim().toLowerCase();
  if (role === 'driver' || userType === 'driver') {
    return false;
  }
  if (role === 'customer' || userType === 'customer') {
    return true;
  }
  return true;
}

export async function fetchNearbyOnlineCustomers(point: { latitude: number; longitude: number }) {
  const token = await auth.currentUser?.getIdToken(false);
  if (!token) {
    return [] as NearbyCustomer[];
  }

  const queryString = `lat=${encodeURIComponent(String(point.latitude))}&lng=${encodeURIComponent(String(point.longitude))}&radiusKm=18`;
  let lastError: unknown = null;

  for (const baseUrl of getDoorDriveApiBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}/nearby-customers?${queryString}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | { customers?: Array<{ id: string; firstName?: string; latitude: number; longitude: number; distanceKm?: number }> }
        | null;
      if (!response.ok) {
        lastError = new Error(payload && 'error' in payload ? String((payload as { error?: string }).error) : `HTTP ${response.status}`);
        continue;
      }

      return (payload?.customers || [])
        .filter((item) => item?.id && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
        .map((item) =>
          toNearbyCustomer({
            id: item.id,
            firstName: item.firstName,
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            distanceKm: Number(item.distanceKm),
          })
        );
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error('Could not load nearby customers.');
  }

  return [] as NearbyCustomer[];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function subscribeToNearbyOnlineCustomers(
  point: { latitude: number; longitude: number },
  callback: (customers: NearbyCustomer[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const cells = cellsNear(point.latitude, point.longitude, 6);
  const RADIUS_KM = 18;
  const found = new Map<string, NearbyCustomer>();

  const flush = () => {
    callback([...found.values()]);
  };

  const presenceQuery = query(
    collection(db, CUSTOMER_PRESENCE_COLLECTION),
    where('geohash', 'in', cells.slice(0, 10))
  );

  const unsubPresence = onSnapshot(
    presenceQuery,
    (snapshot) => {
      for (const doc of snapshot.docs) {
        const data = doc.data() as {
          firstName?: string;
          latitude?: number;
          longitude?: number;
          role?: string;
          userRole?: string;
          userType?: string;
          isOnline?: boolean;
          isAppOnline?: boolean;
          lastSeenAt?: unknown;
          lastActiveAt?: unknown;
          updatedAt?: unknown;
        };
        if (!isCustomerLike(data)) {
          found.delete(doc.id);
          continue;
        }

        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          found.delete(doc.id);
          continue;
        }
        if (!isFreshOnline(data)) {
          found.delete(doc.id);
          continue;
        }
        if (haversineKm(point.latitude, point.longitude, latitude, longitude) > RADIUS_KM) {
          continue;
        }

        found.set(
          doc.id,
          toNearbyCustomer({ id: doc.id, firstName: data.firstName, latitude, longitude })
        );
      }
      flush();
    },
    (error) => onError?.(error)
  );

  return unsubPresence;
}
