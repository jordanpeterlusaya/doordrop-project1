import * as Location from 'expo-location';

import { reverseGeocodeLocationFast } from '@/lib/location-search';
import { getDistanceBetweenPoints, type RoutePoint } from '@/lib/route-utils';

export type CustomerLocationStatus = 'idle' | 'loading' | 'ready' | 'permission-denied' | 'unavailable';

export type CustomerLocationSnapshot = {
  point: RoutePoint | null;
  label: string;
  address: string;
  status: CustomerLocationStatus;
  updatedAt: number;
  accuracyMeters?: number | null;
};

const POSITION_TTL_MS = 5 * 60 * 1000;
const SIGNIFICANT_MOVE_METERS = 35;

const emptySnapshot = (): CustomerLocationSnapshot => ({
  point: null,
  label: '',
  address: '',
  status: 'idle',
  updatedAt: 0,
  accuracyMeters: null,
});

let snapshot: CustomerLocationSnapshot = emptySnapshot();
let refreshPromise: Promise<CustomerLocationSnapshot> | null = null;
const listeners = new Set<(next: CustomerLocationSnapshot) => void>();

function emit() {
  listeners.forEach((listener) => listener(snapshot));
}

function setSnapshot(patch: Partial<CustomerLocationSnapshot>) {
  snapshot = {
    ...snapshot,
    ...patch,
    updatedAt: Date.now(),
  };
  emit();
}

function isSnapshotFresh(next: CustomerLocationSnapshot = snapshot) {
  return (
    next.status === 'ready' &&
    Boolean(next.point) &&
    Boolean(next.label.trim()) &&
    Date.now() - next.updatedAt < POSITION_TTL_MS
  );
}

function hasMovedSignificantly(previous: RoutePoint | null, next: RoutePoint) {
  if (!previous) {
    return true;
  }

  return getDistanceBetweenPoints(previous, next) >= SIGNIFICANT_MOVE_METERS;
}

async function applyReverseGeocode(point: RoutePoint) {
  const reversed = await reverseGeocodeLocationFast(point);
  setSnapshot({
    point,
    label: reversed.label,
    address: reversed.address,
    status: 'ready',
  });
}

export function getCustomerLocationSnapshot() {
  return snapshot;
}

export function subscribeCustomerLocation(listener: (next: CustomerLocationSnapshot) => void) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function seedCustomerLocationPoint(point: RoutePoint, accuracyMeters?: number | null) {
  const moved = hasMovedSignificantly(snapshot.point, point);
  if (!moved && snapshot.label.trim() && snapshot.status === 'ready') {
    return;
  }

  setSnapshot({
    point,
    accuracyMeters: accuracyMeters ?? snapshot.accuracyMeters ?? null,
    status: snapshot.label.trim() && !moved ? 'ready' : 'loading',
  });

  if (!snapshot.label.trim() || moved) {
    void applyReverseGeocode(point).catch(() => {
      if (snapshot.point) {
        setSnapshot({ status: 'ready' });
      }
    });
  }
}

export function warmCustomerLocation() {
  if (isSnapshotFresh()) {
    return;
  }

  void ensureCustomerLocation({ source: 'initial' });
}

export async function ensureCustomerLocation(options?: {
  force?: boolean;
  source?: 'initial' | 'tap' | 'watch';
}): Promise<CustomerLocationSnapshot> {
  const force = options?.force ?? false;

  if (!force && isSnapshotFresh()) {
    return snapshot;
  }

  if (refreshPromise && !force) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setSnapshot({
          status: 'permission-denied',
          label: '',
          address: '',
        });
        return snapshot;
      }

      if (!force && snapshot.point && snapshot.label.trim() && Date.now() - snapshot.updatedAt < POSITION_TTL_MS) {
        setSnapshot({ status: 'ready' });
        return snapshot;
      }

      let workingPoint = snapshot.point;

      try {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown?.coords) {
          const lastKnownPoint = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };

          if (!workingPoint || hasMovedSignificantly(workingPoint, lastKnownPoint) || !snapshot.label.trim()) {
            workingPoint = lastKnownPoint;
            setSnapshot({
              point: lastKnownPoint,
              accuracyMeters: lastKnown.coords.accuracy ?? null,
              status: snapshot.label.trim() ? 'ready' : 'loading',
            });

            if (!snapshot.label.trim()) {
              void applyReverseGeocode(lastKnownPoint).catch(() => undefined);
            }
          }
        }
      } catch {
        // Last-known position is optional; continue with a fresh GPS read.
      }

      if (!snapshot.label.trim() && snapshot.status !== 'loading') {
        setSnapshot({ status: 'loading' });
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nextPoint = {
        latitude: currentPosition.coords.latitude,
        longitude: currentPosition.coords.longitude,
      };

      const moved = hasMovedSignificantly(workingPoint, nextPoint);
      if (!force && !moved && snapshot.label.trim()) {
        setSnapshot({
          point: nextPoint,
          accuracyMeters: currentPosition.coords.accuracy ?? null,
          status: 'ready',
        });
        return snapshot;
      }

      await applyReverseGeocode(nextPoint);
      setSnapshot({
        accuracyMeters: currentPosition.coords.accuracy ?? null,
      });
      return snapshot;
    } catch {
      if (snapshot.point) {
        setSnapshot({
          status: snapshot.label.trim() ? 'ready' : 'unavailable',
        });
      } else {
        setSnapshot({
          status: 'unavailable',
          label: '',
          address: '',
        });
      }
      return snapshot;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
