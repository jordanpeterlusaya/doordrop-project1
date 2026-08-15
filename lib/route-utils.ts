export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export function isValidCoordinate(point: Partial<RoutePoint> | null | undefined): point is RoutePoint {
  if (!point || typeof point !== 'object') {
    return false;
  }

  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function filterValidCoordinates(points: Array<Partial<RoutePoint> | null | undefined>) {
  return points.filter(isValidCoordinate);
}

export type OsrmRouteCandidate = {
  geometry?: string;
  distance?: number;
  duration?: number;
};

export type SelectedRoute = {
  coordinates: RoutePoint[];
  geometry: string;
  distanceMeters: number;
  durationSeconds: number;
};

export function decodePolyline(encoded: string, precision = 5): RoutePoint[] {
  const coordinates: RoutePoint[] = [];
  const factor = 10 ** precision;
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / factor,
      longitude: longitude / factor,
    });
  }

  return filterValidCoordinates(coordinates);
}

export function selectBestOsrmRoute(routes: OsrmRouteCandidate[] | undefined) {
  const candidates = (routes ?? [])
    .filter(
      (route): route is Required<Pick<OsrmRouteCandidate, 'geometry' | 'distance' | 'duration'>> =>
        typeof route.geometry === 'string' &&
        typeof route.distance === 'number' &&
        typeof route.duration === 'number' &&
        route.distance > 0 &&
        route.duration > 0
    )
    .map((route) => ({
      coordinates: decodePolyline(route.geometry),
      geometry: route.geometry,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    }))
    .filter((route) => route.coordinates.length > 0);

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((left, right) => {
    if (left.durationSeconds !== right.durationSeconds) {
      return left.durationSeconds - right.durationSeconds;
    }

    return left.distanceMeters - right.distanceMeters;
  })[0];
}

export function formatDistance(distanceMeters: number) {
  const n = Number(distanceMeters);
  if (!Number.isFinite(n) || n < 0) return '0 km';
  const distanceKm = n / 1000;
  return distanceKm >= 100 ? `${distanceKm.toFixed(0)} km` : `${distanceKm.toFixed(1)} km`;
}

export function formatDuration(durationSeconds: number) {
  const secs = Number(durationSeconds);
  if (!Number.isFinite(secs) || secs <= 0) return '1 min';
  const totalMinutes = Math.max(1, Math.round(secs / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${totalMinutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

export function getDistanceBetweenPoints(start: RoutePoint, end: RoutePoint) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getPolylineDistanceMeters(coordinates: RoutePoint[]) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += getDistanceBetweenPoints(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

export function getNearestCoordinateIndex(coordinates: RoutePoint[], point: RoutePoint) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = getDistanceBetweenPoints(point, coordinates[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return { index: nearestIndex, distance: nearestDistance };
}

export function trimRouteFromPoint(coordinates: RoutePoint[], point: RoutePoint) {
  if (coordinates.length < 2 || !isValidCoordinate(point)) {
    return coordinates;
  }

  const { index, distance } = getNearestCoordinateIndex(coordinates, point);
  const remaining = coordinates.slice(index);

  if (distance > 4) {
    return filterValidCoordinates([point, ...remaining.slice(1)]);
  }

  return remaining.length >= 2 ? remaining : filterValidCoordinates([point, coordinates[coordinates.length - 1]]);
}

export function formatEtaByScope(durationSeconds: number, scope: 'city' | 'intercity') {
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  if (scope === 'city' || totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const roundedHalfHours = Math.max(1, Math.round(totalMinutes / 30) / 2);
  if (Number.isInteger(roundedHalfHours)) {
    return roundedHalfHours === 1 ? '1 hr' : `${roundedHalfHours} hrs`;
  }

  return `${roundedHalfHours} hrs`;
}
