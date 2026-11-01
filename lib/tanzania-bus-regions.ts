import {
  normalizeOutsideDestinationCity,
  outsideDestinationCities,
  sortOutsideDestinationCities,
  type OutsideDestinationCity,
  type OutsideHub,
} from '@/lib/outside-parcel';

export type BusCorridorId = 'dar-mwanza' | 'dar-arusha' | 'dar-mtwara';

type BusStandSeed = {
  id: string;
  label: string;
  latitude?: number;
  longitude?: number;
};

type BusRegionSeed = {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
  sortOrder: number;
  corridor: BusCorridorId;
  stands: BusStandSeed[];
};

const BUS_REGIONS: BusRegionSeed[] = [
  {
    key: 'pwani',
    label: 'Pwani',
    latitude: -6.8333,
    longitude: 38.9833,
    sortOrder: 70,
    corridor: 'dar-mtwara',
    stands: [
      { id: 'kibaha', label: 'Kibaha Bus Stand', latitude: -6.7667, longitude: 38.9167 },
      { id: 'mlandizi', label: 'Mlandizi Bus Stand', latitude: -6.7, longitude: 38.75 },
    ],
  },
  {
    key: 'morogoro',
    label: 'Morogoro',
    latitude: -6.8278,
    longitude: 37.6591,
    sortOrder: 80,
    corridor: 'dar-mwanza',
    stands: [{ id: 'msamvu', label: 'Msamvu Bus Terminal', latitude: -6.808, longitude: 37.661 }],
  },
  {
    key: 'tanga',
    label: 'Tanga',
    latitude: -5.0889,
    longitude: 39.1023,
    sortOrder: 90,
    corridor: 'dar-arusha',
    stands: [
      { id: 'tanga-central', label: 'Tanga Bus Stand', latitude: -5.0889, longitude: 39.1023 },
      { id: 'korogwe', label: 'Korogwe Bus Stand', latitude: -5.1558, longitude: 38.4503 },
    ],
  },
  {
    key: 'kilimanjaro',
    label: 'Kilimanjaro',
    latitude: -3.3869,
    longitude: 37.3333,
    sortOrder: 100,
    corridor: 'dar-arusha',
    stands: [{ id: 'moshi', label: 'Moshi Bus Stand', latitude: -3.3349, longitude: 37.3404 }],
  },
  {
    key: 'manyara',
    label: 'Manyara',
    latitude: -3.3667,
    longitude: 35.6833,
    sortOrder: 110,
    corridor: 'dar-arusha',
    stands: [
      { id: 'babati', label: 'Babati Bus Stand', latitude: -4.2167, longitude: 35.75 },
      { id: 'karatu', label: 'Karatu Bus Stand', latitude: -3.3333, longitude: 35.6667 },
    ],
  },
  {
    key: 'singida',
    label: 'Singida',
    latitude: -4.8163,
    longitude: 34.7436,
    sortOrder: 120,
    corridor: 'dar-mwanza',
    stands: [{ id: 'singida-central', label: 'Singida Bus Stand' }],
  },
  {
    key: 'tabora',
    label: 'Tabora',
    latitude: -5.0167,
    longitude: 32.8,
    sortOrder: 130,
    corridor: 'dar-mwanza',
    stands: [{ id: 'tabora-central', label: 'Tabora Bus Stand' }],
  },
  {
    key: 'shinyanga',
    label: 'Shinyanga',
    latitude: -3.6619,
    longitude: 33.4211,
    sortOrder: 140,
    corridor: 'dar-mwanza',
    stands: [{ id: 'shinyanga-central', label: 'Shinyanga Bus Stand' }],
  },
  {
    key: 'simiyu',
    label: 'Simiyu',
    latitude: -2.7667,
    longitude: 33.9833,
    sortOrder: 150,
    corridor: 'dar-mwanza',
    stands: [{ id: 'bariadi', label: 'Bariadi Bus Stand' }],
  },
  {
    key: 'geita',
    label: 'Geita',
    latitude: -2.8714,
    longitude: 32.2294,
    sortOrder: 160,
    corridor: 'dar-mwanza',
    stands: [{ id: 'geita-central', label: 'Geita Bus Stand' }],
  },
  {
    key: 'mara',
    label: 'Mara',
    latitude: -1.5,
    longitude: 33.8,
    sortOrder: 170,
    corridor: 'dar-mwanza',
    stands: [{ id: 'musoma', label: 'Musoma Bus Stand' }],
  },
  {
    key: 'lindi',
    label: 'Lindi',
    latitude: -10.0,
    longitude: 39.7167,
    sortOrder: 180,
    corridor: 'dar-mtwara',
    stands: [{ id: 'lindi-central', label: 'Lindi Bus Stand' }],
  },
  {
    key: 'ruvuma',
    label: 'Ruvuma',
    latitude: -10.6833,
    longitude: 35.65,
    sortOrder: 190,
    corridor: 'dar-mtwara',
    stands: [{ id: 'songea', label: 'Songea Bus Stand' }],
  },
  {
    key: 'iringa',
    label: 'Iringa',
    latitude: -7.77,
    longitude: 35.69,
    sortOrder: 200,
    corridor: 'dar-mtwara',
    stands: [{ id: 'iringa-central', label: 'Iringa Bus Stand' }],
  },
  {
    key: 'njombe',
    label: 'Njombe',
    latitude: -9.3333,
    longitude: 34.7667,
    sortOrder: 210,
    corridor: 'dar-mtwara',
    stands: [{ id: 'njombe-central', label: 'Njombe Bus Stand' }],
  },
  {
    key: 'mbeya',
    label: 'Mbeya',
    latitude: -8.9,
    longitude: 33.45,
    sortOrder: 220,
    corridor: 'dar-mtwara',
    stands: [
      { id: 'soweto', label: 'Soweto Bus Stand' },
      { id: 'mbalizi', label: 'Mbalizi Bus Stand', latitude: -8.95, longitude: 33.3667 },
    ],
  },
  {
    key: 'songwe',
    label: 'Songwe',
    latitude: -9.2167,
    longitude: 32.7667,
    sortOrder: 230,
    corridor: 'dar-mtwara',
    stands: [{ id: 'vwawa', label: 'Vwawa Bus Stand' }],
  },
  {
    key: 'rukwa',
    label: 'Rukwa',
    latitude: -8.0,
    longitude: 31.6167,
    sortOrder: 240,
    corridor: 'dar-mtwara',
    stands: [{ id: 'sumbawanga', label: 'Sumbawanga Bus Stand' }],
  },
  {
    key: 'katavi',
    label: 'Katavi',
    latitude: -6.3667,
    longitude: 31.05,
    sortOrder: 250,
    corridor: 'dar-mwanza',
    stands: [{ id: 'mpanda', label: 'Mpanda Bus Stand' }],
  },
  {
    key: 'kigoma',
    label: 'Kigoma',
    latitude: -4.8769,
    longitude: 29.6267,
    sortOrder: 260,
    corridor: 'dar-mwanza',
    stands: [{ id: 'kigoma-central', label: 'Kigoma Bus Stand' }],
  },
  {
    key: 'kagera',
    label: 'Kagera',
    latitude: -1.3333,
    longitude: 31.8,
    sortOrder: 270,
    corridor: 'dar-mwanza',
    stands: [{ id: 'bukoba', label: 'Bukoba Bus Stand' }],
  },
];

const CORRIDOR_KEYS: Record<BusCorridorId, string[]> = {
  'dar-mwanza': [
    'morogoro',
    'dodoma',
    'singida',
    'tabora',
    'shinyanga',
    'kahama',
    'simiyu',
    'geita',
    'mwanza',
    'mara',
    'kagera',
    'kigoma',
    'katavi',
  ],
  'dar-arusha': ['tanga', 'kilimanjaro', 'arusha', 'manyara'],
  'dar-mtwara': ['pwani', 'lindi', 'mtwara', 'ruvuma', 'iringa', 'njombe', 'mbeya', 'songwe', 'rukwa'],
};

const EXTRA_STANDS: Record<string, BusStandSeed[]> = {
  mwanza: [{ id: 'buzuruga', label: 'Buzuruga Bus Terminal', latitude: -2.56, longitude: 32.9 }],
  arusha: [{ id: 'sakina', label: 'Sakina Bus Stand', latitude: -3.365, longitude: 36.68 }],
};

export const BUS_CORRIDOR_COPY = {
  sw: {
    'dar-mwanza': 'Dar — Mwanza',
    'dar-arusha': 'Dar — Arusha',
    'dar-mtwara': 'Dar — Mtwara',
    other: 'Mikoa mingine',
  },
  en: {
    'dar-mwanza': 'Dar — Mwanza',
    'dar-arusha': 'Dar — Arusha',
    'dar-mtwara': 'Dar — Mtwara',
    other: 'Other regions',
  },
} as const;

function standsFromSeed(seed: BusRegionSeed): OutsideHub[] {
  return seed.stands.map((stand) => ({
    id: `${seed.key}-${stand.id}`,
    label: stand.label,
    query: `${stand.label}, ${seed.label}, Tanzania`,
    fallbackPoint: {
      latitude: stand.latitude ?? seed.latitude,
      longitude: stand.longitude ?? seed.longitude,
    },
  }));
}

function toCity(seed: BusRegionSeed): OutsideDestinationCity | null {
  return normalizeOutsideDestinationCity({
    key: seed.key,
    label: seed.label,
    sortOrder: seed.sortOrder,
    expressEnabled: false,
    homeDeliveryEnabled: false,
    active: true,
    centerPoint: { latitude: seed.latitude, longitude: seed.longitude },
    stands: standsFromSeed(seed),
    airports: [],
  });
}

function extraHubsForCity(city: OutsideDestinationCity): OutsideHub[] {
  const extras = EXTRA_STANDS[city.key] ?? [];
  const existingIds = new Set(city.stands.map((stand) => stand.id));

  return extras
    .filter((stand) => !existingIds.has(stand.id) && !existingIds.has(`${city.key}-${stand.id}`))
    .map((stand) => ({
      id: stand.id,
      label: stand.label,
      query: `${stand.label}, ${city.label}, Tanzania`,
      fallbackPoint: {
        latitude: stand.latitude ?? city.centerPoint.latitude,
        longitude: stand.longitude ?? city.centerPoint.longitude,
      },
    }));
}

function withExtraStands(city: OutsideDestinationCity): OutsideDestinationCity {
  const extra = extraHubsForCity(city);
  if (extra.length === 0) {
    return city;
  }
  return { ...city, stands: [...city.stands, ...extra] };
}

export function getBusCorridorId(cityKey: string): BusCorridorId | 'other' {
  if (CORRIDOR_KEYS['dar-mwanza'].includes(cityKey)) {
    return 'dar-mwanza';
  }
  if (CORRIDOR_KEYS['dar-arusha'].includes(cityKey)) {
    return 'dar-arusha';
  }
  if (CORRIDOR_KEYS['dar-mtwara'].includes(cityKey)) {
    return 'dar-mtwara';
  }
  return 'other';
}

export function groupDestinationsByBusCorridor(cities: OutsideDestinationCity[]) {
  const groups: { id: BusCorridorId | 'other'; cities: OutsideDestinationCity[] }[] = [
    { id: 'dar-mwanza', cities: [] },
    { id: 'dar-arusha', cities: [] },
    { id: 'dar-mtwara', cities: [] },
    { id: 'other', cities: [] },
  ];

  for (const city of cities) {
    const group = groups.find((item) => item.id === getBusCorridorId(city.key));
    (group ?? groups[3]).cities.push(city);
  }

  return groups.filter((group) => group.cities.length > 0);
}

function canonicalHubsForKey(cityKey: string): { stands?: OutsideHub[]; airports?: OutsideHub[] } {
  const local = outsideDestinationCities.find((city) => city.key === cityKey);
  if (local) {
    return { stands: local.stands, airports: local.airports };
  }

  const seed = BUS_REGIONS.find((region) => region.key === cityKey);
  if (seed) {
    return { stands: standsFromSeed(seed), airports: [] };
  }

  return {};
}

export function mergeTanzaniaBusRegions(cities: OutsideDestinationCity[]): OutsideDestinationCity[] {
  const byKey = new Map(
    cities.map((city) => {
      const canonical = canonicalHubsForKey(city.key);
      return [
        city.key,
        withExtraStands({
          ...city,
          stands: canonical.stands ?? city.stands,
          airports: canonical.airports ?? city.airports,
        }),
      ];
    })
  );

  for (const seed of BUS_REGIONS) {
    const existing = byKey.get(seed.key);
    if (existing) {
      const seededStands = existing.stands.length === 0 ? standsFromSeed(seed) : existing.stands;
      byKey.set(existing.key, withExtraStands({ ...existing, stands: seededStands }));
      continue;
    }
    const city = toCity(seed);
    if (city) {
      byKey.set(city.key, city);
    }
  }

  return sortOutsideDestinationCities([...byKey.values()]);
}
