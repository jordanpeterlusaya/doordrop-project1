import { Platform } from 'react-native';
import { addDoc, collection, doc, increment, serverTimestamp, setDoc } from 'firebase/firestore';

import { logWarning } from '@/lib/debug-logger';
import { db } from '@/lib/firebase';

type AppActivityInput = {
  userId?: string;
  userName?: string;
  userRole?: 'customer' | 'driver' | 'admin' | string;
  eventName: 'screen_view' | 'feature_tap' | 'feature_open' | 'schedule_open' | string;
  featureKey: string;
  featureLabel?: string;
  screen?: string;
  route?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const activityEventsCollection = collection(db, 'appActivityEvents');
const ACTIVITY_CACHE_LIMIT = 200;
const recentActivityTimestamps = new Map<string, number>();

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function cleanMetadata(metadata?: AppActivityInput['metadata']) {
  if (!metadata) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  );
}

function getDedupeWindowMs(eventName: string) {
  if (eventName === 'screen_view') {
    return 20_000;
  }

  if (eventName === 'feature_tap' || eventName === 'feature_open' || eventName === 'schedule_open') {
    return 1_200;
  }

  return 0;
}

function shouldSkipRecentActivity(input: AppActivityInput, featureKey: string) {
  const dedupeWindowMs = getDedupeWindowMs(input.eventName);
  if (dedupeWindowMs <= 0) {
    return false;
  }

  const now = Date.now();
  const cacheKey = [
    input.userId || 'guest',
    input.eventName,
    featureKey,
    input.route || '',
    input.screen || '',
  ].join(':');
  const previousTimestamp = recentActivityTimestamps.get(cacheKey) ?? 0;
  recentActivityTimestamps.set(cacheKey, now);

  if (recentActivityTimestamps.size > ACTIVITY_CACHE_LIMIT) {
    const oldestAllowed = now - 60_000;
    recentActivityTimestamps.forEach((timestamp, key) => {
      if (timestamp < oldestAllowed) {
        recentActivityTimestamps.delete(key);
      }
    });
  }

  return now - previousTimestamp < dedupeWindowMs;
}

export async function recordAppActivity(input: AppActivityInput) {
  const featureKey = normalizeKey(input.featureKey);
  if (shouldSkipRecentActivity(input, featureKey)) {
    return;
  }

  const dateKey = getDateKey();
  const payload = {
    userId: input.userId || '',
    userName: input.userName || '',
    userRole: input.userRole || 'customer',
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
          userRole: payload.userRole,
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
          userRole: payload.userRole,
          count: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ),
    ];

    if (input.userId) {
      writes.push(
        setDoc(
          doc(db, 'appUserActivityStats', `${dateKey}_${input.userId}`),
          {
            dateKey,
            userId: input.userId,
            userName: input.userName || '',
            userRole: payload.userRole,
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
  } catch (error) {
    logWarning('AppAnalytics', 'recordAppActivity failed', {
      featureKey,
      eventName: input.eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
