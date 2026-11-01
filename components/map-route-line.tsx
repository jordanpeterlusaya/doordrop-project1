import React from 'react';

import type { RoutePoint } from '@/lib/route-utils';

const ROUTE_LINE_FILL = '#16A34A';
const ROUTE_LINE_FALLBACK = '#34D399';
const CARGO_ROUTE_FILL = '#111827';
const CARGO_ROUTE_FALLBACK = '#374151';

type MapRouteLineProps = {
  Polyline: any;
  coordinates: RoutePoint[];
  fallback?: boolean;
  tone?: 'default' | 'ink';
};

/** Road polyline. Parcel keeps the green stroke; cargo uses one strong ink line. */
export function MapRouteLine({ Polyline, coordinates, fallback = false, tone = 'default' }: MapRouteLineProps) {
  if (!Polyline || coordinates.length < 2) {
    return null;
  }

  // Avoid painting a fake straight A→B line when we only have endpoints.
  if (coordinates.length < 3 && !fallback) {
    return null;
  }

  const isInk = tone === 'ink';
  const fill = isInk
    ? fallback
      ? CARGO_ROUTE_FALLBACK
      : CARGO_ROUTE_FILL
    : fallback
      ? ROUTE_LINE_FALLBACK
      : ROUTE_LINE_FILL;

  return (
    <>
      <Polyline
        coordinates={coordinates}
        strokeColor={isInk ? 'rgba(17, 24, 39, 0.16)' : 'rgba(15, 23, 42, 0.20)'}
        strokeWidth={isInk ? 10 : 12}
        lineCap="round"
        lineJoin="round"
        zIndex={1}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor="#FFFFFF"
        strokeWidth={isInk ? 7 : 8}
        lineCap="round"
        lineJoin="round"
        zIndex={2}
      />
      <Polyline
        coordinates={coordinates}
        strokeColor={fill}
        strokeWidth={isInk ? 4 : 5}
        lineCap="round"
        lineJoin="round"
        zIndex={3}
      />
    </>
  );
}
