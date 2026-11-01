import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  publishCustomerPresence,
  setCustomerPresenceOffline,
} from '@/lib/customer-presence';
import { seedCustomerLocationPoint, warmCustomerLocation } from '@/lib/customer-location';
import { useAuthSession } from '@/providers/auth-provider';

const HEARTBEAT_MS = 20 * 1000;
const BACKGROUND_OFFLINE_MS = 90 * 1000;

export function CustomerPresenceTracker() {
  const { user, profile } = useAuthSession();
  const coordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const fullNameRef = useRef(profile?.fullName || user?.displayName || '');
  const uidRef = useRef(user?.uid || '');
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  fullNameRef.current = profile?.fullName || user?.displayName || '';
  uidRef.current = user?.uid || '';

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    let mounted = true;
    let watch: Location.LocationSubscription | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const uid = user.uid;

    const publish = async (online: boolean) => {
      if (!mounted || !uidRef.current) {
        return;
      }

      try {
        if (!online) {
          await setCustomerPresenceOffline(uid);
          return;
        }

        const coords = coordsRef.current;
        if (!coords) {
          return;
        }

        await publishCustomerPresence({
          uid,
          fullName: fullNameRef.current,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      } catch {
        // Presence is best-effort and must not interrupt the customer app.
      }
    };

    const resolveCoords = async () => {
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!mounted) {
          return null;
        }
        return {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
      } catch {
        try {
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (!mounted || !lastKnown?.coords) {
            return null;
          }
          return {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          };
        } catch {
          return null;
        }
      }
    };

    const start = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!mounted || permission.status !== 'granted') {
          return;
        }

        const coords = await resolveCoords();
        if (coords) {
          coordsRef.current = coords;
          seedCustomerLocationPoint(coords);
          warmCustomerLocation();
          await publish(true);
        }

        watch = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 25,
            timeInterval: 15_000,
          },
          (next) => {
            coordsRef.current = {
              latitude: next.coords.latitude,
              longitude: next.coords.longitude,
            };
            seedCustomerLocationPoint(coordsRef.current, next.coords.accuracy ?? null);
            if (AppState.currentState === 'active') {
              void publish(true);
            }
          }
        );

        heartbeat = setInterval(() => {
          if (AppState.currentState === 'active') {
            if (!coordsRef.current) {
              void resolveCoords().then((nextCoords) => {
                if (nextCoords) {
                  coordsRef.current = nextCoords;
                }
                void publish(true);
              });
              return;
            }
            void publish(true);
          }
        }, HEARTBEAT_MS);
      } catch {
        // Ignore location failures; the home screen still handles its own lookup.
      }
    };

    const handleAppState = (state: AppStateStatus) => {
      if (backgroundTimerRef.current) {
        clearTimeout(backgroundTimerRef.current);
        backgroundTimerRef.current = undefined;
      }

      if (state === 'active') {
        if (!coordsRef.current) {
          void resolveCoords().then((coords) => {
            if (coords) {
              coordsRef.current = coords;
            }
            void publish(true);
          });
          return;
        }
        void publish(true);
        return;
      }

      backgroundTimerRef.current = setTimeout(() => {
        void publish(false);
      }, BACKGROUND_OFFLINE_MS);
    };

    const appState = AppState.addEventListener('change', handleAppState);
    void start();

    return () => {
      mounted = false;
      watch?.remove();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (backgroundTimerRef.current) {
        clearTimeout(backgroundTimerRef.current);
      }
      appState.remove();
    };
  }, [user?.uid]);

  return null;
}
