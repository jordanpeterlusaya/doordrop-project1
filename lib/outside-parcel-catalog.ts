import {
  collection,
  doc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import {
  normalizeOutsideDestinationCity,
  outsideDestinationCities,
  sortOutsideDestinationCities,
  type OutsideDestinationCity,
} from '@/lib/outside-parcel';
import { mergeTanzaniaBusRegions } from '@/lib/tanzania-bus-regions';

export const OUTSIDE_PARCEL_CONFIG_DOC = 'outsideParcel';
export const OUTSIDE_DESTINATION_CITIES_COLLECTION = 'outsideDestinationCities';

export type OutsideParcelCatalog = {
  cities: OutsideDestinationCity[];
  expressEnabledGlobally: boolean;
  source: 'remote' | 'defaults';
};

function defaultCatalog(): OutsideParcelCatalog {
  return {
    cities: mergeTanzaniaBusRegions(
      sortOutsideDestinationCities(
        outsideDestinationCities.map((city, index) =>
          normalizeOutsideDestinationCity({ ...city, expressEnabled: true, active: true }, index)
        ).filter(Boolean) as OutsideDestinationCity[]
      )
    ),
    expressEnabledGlobally: false,
    source: 'defaults',
  };
}

export function subscribeOutsideParcelCatalog(
  onChange: (catalog: OutsideParcelCatalog) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  let remoteCities: OutsideDestinationCity[] | null = null;
  let expressEnabledGlobally = false;
  let citiesReady = false;
  let configReady = false;

  const emit = () => {
    if (!citiesReady || !configReady) {
      return;
    }

    if (remoteCities && remoteCities.length > 0) {
      onChange({
        cities: mergeTanzaniaBusRegions(
          sortOutsideDestinationCities(remoteCities.filter((city) => city.active !== false))
        ),
        expressEnabledGlobally,
        source: 'remote',
      });
      return;
    }

    onChange({
      ...defaultCatalog(),
      expressEnabledGlobally,
    });
  };

  const citiesUnsub = onSnapshot(
    collection(db, OUTSIDE_DESTINATION_CITIES_COLLECTION),
    (snapshot) => {
      remoteCities = snapshot.docs
        .map((item, index) =>
          normalizeOutsideDestinationCity({ key: item.id, id: item.id, ...item.data() }, index)
        )
        .filter(Boolean) as OutsideDestinationCity[];
      citiesReady = true;
      emit();
    },
    (error) => {
      citiesReady = true;
      remoteCities = null;
      onError?.(error);
      emit();
    }
  );

  const configUnsub = onSnapshot(
    doc(db, 'appConfig', OUTSIDE_PARCEL_CONFIG_DOC),
    (snapshot) => {
      const data = snapshot.data() || {};
      expressEnabledGlobally = data.expressEnabledGlobally !== false;
      configReady = true;
      emit();
    },
    (error) => {
      configReady = true;
      expressEnabledGlobally = false;
      onError?.(error);
      emit();
    }
  );

  return () => {
    citiesUnsub();
    configUnsub();
  };
}
