import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import {
  isAdminConfiguredExpressRoute,
  normalizeOutsideExpressRouteSchedule,
  type OutsideExpressRouteSchedule,
} from '@/lib/outside-express-schedule';

export const OUTSIDE_EXPRESS_ROUTES_COLLECTION = 'outsideExpressRoutes';

export type OutsideExpressRoutesCatalog = {
  routes: OutsideExpressRouteSchedule[];
  source: 'remote' | 'empty';
};

export function subscribeOutsideExpressRoutesCatalog(
  onChange: (catalog: OutsideExpressRoutesCatalog) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const unsubscribe = onSnapshot(
    collection(db, OUTSIDE_EXPRESS_ROUTES_COLLECTION),
    (snapshot) => {
      const remoteRoutes = snapshot.docs
        .map((item, index) => {
          try {
            return normalizeOutsideExpressRouteSchedule({ id: item.id, ...(item.data() || {}) }, index);
          } catch {
            return null;
          }
        })
        .filter(
          (route): route is OutsideExpressRouteSchedule =>
            Boolean(route && isAdminConfiguredExpressRoute(route))
        );

      onChange({
        routes: remoteRoutes.sort((left, right) =>
          String(left.label || left.id).localeCompare(String(right.label || left.id))
        ),
        source: remoteRoutes.length ? 'remote' : 'empty',
      });
    },
    (error) => {
      onChange({ routes: [], source: 'empty' });
      onError?.(error);
    }
  );

  return unsubscribe;
}
