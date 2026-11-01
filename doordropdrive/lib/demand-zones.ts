import type { NearbyCustomer } from './customer-presence';

export type DemandZone = {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  intensity: number;
  radiusMeters: number;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function buildDemandZones(customers: NearbyCustomer[]): DemandZone[] {
  const cells = new Map<string, { latitude: number; longitude: number; count: number }>();

  for (const customer of customers) {
    const cellLat = Math.round(customer.latitude * 100) / 100;
    const cellLng = Math.round(customer.longitude * 100) / 100;
    const key = `${cellLat},${cellLng}`;
    const existing = cells.get(key);
    if (existing) {
      const nextCount = existing.count + 1;
      existing.latitude = (existing.latitude * existing.count + customer.latitude) / nextCount;
      existing.longitude = (existing.longitude * existing.count + customer.longitude) / nextCount;
      existing.count = nextCount;
    } else {
      cells.set(key, { latitude: customer.latitude, longitude: customer.longitude, count: 1 });
    }
  }

  const maxCount = Math.max(1, ...[...cells.values()].map((cell) => cell.count));

  return [...cells.entries()]
    .map(([id, cell]) => ({
      id,
      latitude: cell.latitude,
      longitude: cell.longitude,
      count: cell.count,
      intensity: cell.count / maxCount,
      radiusMeters: 320 + cell.count * 220,
    }))
    .sort((left, right) => right.count - left.count);
}

export function getTopDemandZone(zones: DemandZone[]) {
  return zones[0] ?? null;
}

export function estimateOrderProbabilityAtPoint(
  driverPoint: { latitude: number; longitude: number },
  customers: NearbyCustomer[],
  zones: DemandZone[]
) {
  if (!customers.length) {
    return 8;
  }

  const nearbyCount = customers.filter((customer) => {
    return haversineKm(driverPoint.latitude, driverPoint.longitude, customer.latitude, customer.longitude) <= 2.2;
  }).length;

  const localZone = zones.find((zone) => {
    return haversineKm(driverPoint.latitude, driverPoint.longitude, zone.latitude, zone.longitude) <= zone.radiusMeters / 1000;
  });

  const base = Math.min(88, 10 + nearbyCount * 16);
  if (!localZone) {
    return base;
  }

  return Math.min(96, Math.round(base + localZone.intensity * 28));
}
