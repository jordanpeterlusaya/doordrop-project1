import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CargoRoadVehiclePin, getMapVehicleKey, VehicleDriverMarker, type MapVehicleKey } from '@/components/map-markers';
import type { DriverRecord, DriverVehicleType } from '@/lib/delivery-data';
import { getDistanceBetweenPoints, isValidCoordinate, type RoutePoint } from '@/lib/route-utils';

const DEFAULT_RADIUS_METERS = 12000;
const DEFAULT_MAX_VISIBLE = 10;
const MARKER_ANIMATION_MS = 900;
const DEFAULT_MARKER_GAP_PX = 48;

export type MapViewportRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type NearbyLiveVehicle = {
  id: string;
  coordinate: RoutePoint;
  title: string;
  description: string;
  vehicleKey: MapVehicleKey;
  isSelectedType: boolean;
  nearestDistanceMeters: number;
  heading?: number;
};

function mercatorY(latitude: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export function projectMapCoordinate(
  coordinate: RoutePoint,
  region: MapViewportRegion,
  size: { width: number; height: number }
): { x: number; y: number } | null {
  if (size.width < 8 || size.height < 8) {
    return null;
  }
  if (!Number.isFinite(region.latitudeDelta) || region.latitudeDelta <= 0) {
    return null;
  }
  if (!Number.isFinite(region.longitudeDelta) || region.longitudeDelta <= 0) {
    return null;
  }

  const west = region.longitude - region.longitudeDelta / 2;
  const x = ((coordinate.longitude - west) / region.longitudeDelta) * size.width;
  const north = region.latitude + region.latitudeDelta / 2;
  const south = region.latitude - region.latitudeDelta / 2;
  const northY = mercatorY(north);
  const southY = mercatorY(south);
  const span = northY - southY;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-9) {
    return null;
  }

  const y = ((northY - mercatorY(coordinate.latitude)) / span) * size.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function offsetCoordinateByHeading(point: RoutePoint, headingDegrees: number, meters: number): RoutePoint {
  const heading = ((headingDegrees % 360) + 360) % 360;
  const radians = (heading * Math.PI) / 180;
  const latitude = point.latitude + (meters * Math.cos(radians)) / 111320;
  const longitude =
    point.longitude + (meters * Math.sin(radians)) / (111320 * Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.2));
  return { latitude, longitude };
}

export function spaceNearbyVehicles(
  vehicles: NearbyLiveVehicle[],
  region: MapViewportRegion | null | undefined,
  mapSize: { width: number; height: number },
  minGapPx = DEFAULT_MARKER_GAP_PX
): NearbyLiveVehicle[] {
  if (!region || mapSize.width < 8 || mapSize.height < 8 || vehicles.length < 2) {
    return vehicles;
  }

  const metersPerPixel = (region.latitudeDelta * 111320) / mapSize.height;
  const nudgeMeters = Math.max(8, metersPerPixel * 26);
  const ranked = [...vehicles].sort((left, right) => {
    if (left.isSelectedType !== right.isSelectedType) {
      return left.isSelectedType ? -1 : 1;
    }
    return left.nearestDistanceMeters - right.nearestDistanceMeters;
  });

  const placed: Array<NearbyLiveVehicle & { screen: { x: number; y: number } }> = [];

  for (const vehicle of ranked) {
    let coordinate = vehicle.coordinate;
    let screen = projectMapCoordinate(coordinate, region, mapSize);
    if (!screen) {
      placed.push({ ...vehicle, screen: { x: 0, y: 0 } });
      continue;
    }

    let hideSameType = false;
    for (const other of placed) {
      const gap = Math.hypot(screen.x - other.screen.x, screen.y - other.screen.y);
      if (gap >= minGapPx) {
        continue;
      }

      if (vehicle.vehicleKey === other.vehicleKey && gap < minGapPx * 0.55) {
        hideSameType = true;
        break;
      }

      const heading = Number.isFinite(vehicle.heading)
        ? Number(vehicle.heading)
        : (Math.atan2(screen.x - other.screen.x || 0.01, -(screen.y - other.screen.y) || 0.01) * 180) / Math.PI;
      coordinate = offsetCoordinateByHeading(vehicle.coordinate, heading, nudgeMeters);
      screen = projectMapCoordinate(coordinate, region, mapSize) ?? screen;
    }

    if (hideSameType) {
      continue;
    }

    const stillOverlapsSameType = placed.some((other) => {
      if (other.vehicleKey !== vehicle.vehicleKey) {
        return false;
      }
      return Math.hypot(screen.x - other.screen.x, screen.y - other.screen.y) < minGapPx * 0.7;
    });
    if (stillOverlapsSameType) {
      continue;
    }

    placed.push({ ...vehicle, coordinate, screen });
  }

  return placed.map(({ screen: _screen, ...vehicle }) => vehicle);
}

function formatDistance(meters: number) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function buildNearbyLiveVehicles(params: {
  drivers: DriverRecord[];
  origin: RoutePoint | null | undefined;
  selectedVehicleKey?: MapVehicleKey | null;
  allowedVehicleKeys?: MapVehicleKey[];
  radiusMeters?: number;
  maxVisible?: number;
}): NearbyLiveVehicle[] {
  const {
    drivers,
    origin,
    selectedVehicleKey = null,
    allowedVehicleKeys,
    radiusMeters = DEFAULT_RADIUS_METERS,
    maxVisible = DEFAULT_MAX_VISIBLE,
  } = params;

  if (!isValidCoordinate(origin)) {
    return [];
  }

  return drivers
    .filter((driver) => driver.isAvailable)
    .map((driver) => {
      const coordinate = {
        latitude: driver.currentLatitude ?? Number.NaN,
        longitude: driver.currentLongitude ?? Number.NaN,
      };

      if (!isValidCoordinate(coordinate)) {
        return null;
      }

      const vehicleKey = getMapVehicleKey({
        driverVehicleType: driver.vehicleType as DriverVehicleType | string,
        serviceLabel: driver.vehicleLabel,
      });

      if (allowedVehicleKeys && !allowedVehicleKeys.includes(vehicleKey)) {
        return null;
      }

      const nearestDistanceMeters = getDistanceBetweenPoints(origin, coordinate);
      if (nearestDistanceMeters > radiusMeters) {
        return null;
      }

      return {
        id: driver.id,
        coordinate,
        title: driver.fullName || driver.vehicleLabel || 'DoorDrop driver',
        description: `${driver.vehicleLabel || vehicleKey} • ${formatDistance(nearestDistanceMeters)} away`,
        vehicleKey,
        isSelectedType: Boolean(selectedVehicleKey && vehicleKey === selectedVehicleKey),
        nearestDistanceMeters,
        heading: Number.isFinite(Number(driver.currentHeading)) ? Number(driver.currentHeading) : undefined,
      } satisfies NearbyLiveVehicle;
    })
    .filter((driver): driver is NearbyLiveVehicle => Boolean(driver))
    .sort((left, right) => {
      if (left.isSelectedType !== right.isSelectedType) {
        return left.isSelectedType ? -1 : 1;
      }
      return left.nearestDistanceMeters - right.nearestDistanceMeters;
    })
    .slice(0, maxVisible);
}

type NearbyLiveVehicleMarkersProps = {
  vehicles: NearbyLiveVehicle[];
  Marker: any;
  MarkerAnimated?: any;
  AnimatedRegion?: any;
  pinStyle?: 'avatar' | 'silhouette';
};

/**
 * Renders nearby service vehicles as moving avatars on the map.
 */
export function NearbyLiveVehicleMarkers({
  vehicles,
  Marker,
  MarkerAnimated,
  AnimatedRegion,
  pinStyle = 'avatar',
}: NearbyLiveVehicleMarkersProps) {
  const animatedCoordinatesRef = useRef<Record<string, any>>({});
  const coordinateSnapshotRef = useRef<Record<string, RoutePoint>>({});
  const [, setAnimationVersion] = useState(0);

  useEffect(() => {
    if (!AnimatedRegion) {
      animatedCoordinatesRef.current = {};
      coordinateSnapshotRef.current = {};
      return;
    }

    let hasStructuralChange = false;
    const visibleIds = new Set(vehicles.map((vehicle) => vehicle.id));

    Object.keys(animatedCoordinatesRef.current).forEach((driverId) => {
      if (visibleIds.has(driverId)) {
        return;
      }
      delete animatedCoordinatesRef.current[driverId];
      delete coordinateSnapshotRef.current[driverId];
      hasStructuralChange = true;
    });

    vehicles.forEach((vehicle) => {
      const existingCoordinate = animatedCoordinatesRef.current[vehicle.id];
      const previousCoordinate = coordinateSnapshotRef.current[vehicle.id];

      if (!existingCoordinate) {
        animatedCoordinatesRef.current[vehicle.id] = new AnimatedRegion({
          latitude: vehicle.coordinate.latitude,
          longitude: vehicle.coordinate.longitude,
          latitudeDelta: 0,
          longitudeDelta: 0,
        });
        coordinateSnapshotRef.current[vehicle.id] = vehicle.coordinate;
        hasStructuralChange = true;
        return;
      }

      if (
        previousCoordinate &&
        Math.abs(previousCoordinate.latitude - vehicle.coordinate.latitude) < 0.00001 &&
        Math.abs(previousCoordinate.longitude - vehicle.coordinate.longitude) < 0.00001
      ) {
        return;
      }

      existingCoordinate
        .timing({
          latitude: vehicle.coordinate.latitude,
          longitude: vehicle.coordinate.longitude,
          latitudeDelta: 0,
          longitudeDelta: 0,
          duration: MARKER_ANIMATION_MS,
          toValue: 0,
          useNativeDriver: false,
        })
        .start();
      coordinateSnapshotRef.current[vehicle.id] = vehicle.coordinate;
    });

    if (hasStructuralChange) {
      setAnimationVersion((value) => value + 1);
    }
  }, [AnimatedRegion, vehicles]);

  const rendered = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const animatedCoordinate = animatedCoordinatesRef.current[vehicle.id];
        const markerChild =
          pinStyle === 'silhouette' ? (
            <CargoRoadVehiclePin vehicleKey={vehicle.vehicleKey} emphasized={vehicle.isSelectedType} />
          ) : (
            <VehicleDriverMarker
              vehicleKey={vehicle.vehicleKey}
              assigned={vehicle.isSelectedType}
              muted={!vehicle.isSelectedType}
            />
          );

        if (animatedCoordinate && MarkerAnimated) {
          return (
            <MarkerAnimated
              key={vehicle.id}
              coordinate={animatedCoordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges
              zIndex={vehicle.isSelectedType ? 6 : 4}>
              {markerChild}
            </MarkerAnimated>
          );
        }

        return (
          <Marker
            key={vehicle.id}
            coordinate={vehicle.coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges
            zIndex={vehicle.isSelectedType ? 6 : 4}>
            {markerChild}
          </Marker>
        );
      }),
    [Marker, MarkerAnimated, pinStyle, vehicles]
  );

  return <>{rendered}</>;
}
