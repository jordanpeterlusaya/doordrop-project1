import { Platform } from 'react-native';
import { addDoc, collection, doc, increment, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from './firebase';

type DriverActivityInput = {
  driverId?: string;
  driverName?: string;
  eventName: string;
  featureKey: string;
  featureLabel?: string;
  screen?: string;
  route?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const activityEventsCollection = collection(db, 'appActivityEvents');

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function cleanMetadata(metadata?: DriverActivityInput['metadata']) {
  if (!metadata) {
    return {};
  }

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

export async function recordDriverActivity(input: DriverActivityInput) {
  const featureKey = normalizeKey(input.featureKey);
  const dateKey = getDateKey();
  const payload = {
    userId: input.driverId || '',
    userName: input.driverName || '',
    userRole: 'driver',
    eventName: input.eventName,
    featureKey,
    featureLabel: input.featureLabel || featureKey,
    screen: input.screen || '',
    route: input.route || '',
    platform: Platform.OS,
    metadata: cleanMetadata(input.metadata),
    dateKey,
    createdAt: serverTimestamp(),
  };

  try {
    const writes: Promise<unknown>[] = [
      addDoc(activityEventsCollection, payload),
      setDoc(
        doc(db, 'appFeatureStats', `${dateKey}_${featureKey}`),
        {
          dateKey,
          featureKey,
          featureLabel: payload.featureLabel,
          platform: Platform.OS,
          userRole: 'driver',
          count: increment(1),
          lastEventName: input.eventName,
          lastEventAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
      setDoc(
        doc(db, 'appEventStats', `${dateKey}_${normalizeKey(input.eventName)}_${featureKey}`),
        {
          dateKey,
          eventName: input.eventName,
          featureKey,
          featureLabel: payload.featureLabel,
          platform: Platform.OS,
          userRole: 'driver',
          count: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
    ];

    if (input.driverId) {
      writes.push(
        setDoc(
          doc(db, 'appUserActivityStats', `${dateKey}_${input.driverId}`),
          {
            dateKey,
            userId: input.driverId,
            userName: input.driverName || '',
            userRole: 'driver',
            platform: Platform.OS,
            count: increment(1),
            lastEventName: input.eventName,
            lastFeatureKey: featureKey,
            lastActiveAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );
    }

    await Promise.all(writes);
  } catch {
    // Analytics should never block driver operations.
  }
}
