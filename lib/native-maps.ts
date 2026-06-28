import type { ComponentType } from 'react';
import { Platform } from 'react-native';

import { canRenderNativeGoogleMap } from '@/lib/maps-config';
import { logWarning } from '@/lib/debug-logger';
import { tryRequire } from '@/lib/safety';

type NativeMapsModule = {
  default?: ComponentType<any>;
  AnimatedRegion?: new (...args: any[]) => any;
  Marker?: ComponentType<any>;
  MarkerAnimated?: ComponentType<any>;
  Polyline?: ComponentType<any>;
  PROVIDER_GOOGLE?: string;
};

let cachedMaps: NativeMapsModule | null | undefined;
let missingMapsWarningLogged = false;

function loadNativeMaps() {
  if (cachedMaps !== undefined) {
    return cachedMaps;
  }

  cachedMaps = tryRequire<NativeMapsModule>('react-native-maps');
  return cachedMaps;
}

export function getNativeMaps() {
  const maps = loadNativeMaps();
  const MapView = maps?.default ?? null;
  const Marker = maps?.Marker ?? null;
  const MarkerAnimated = maps?.MarkerAnimated ?? Marker;
  const Polyline = maps?.Polyline ?? null;
  const AnimatedRegion = maps?.AnimatedRegion ?? null;
  const provider = Platform.OS === 'android' ? maps?.PROVIDER_GOOGLE : undefined;
  const hasRequiredComponents = Boolean(MapView && Marker && Polyline);
  const canRender = hasRequiredComponents && canRenderNativeGoogleMap();

  if (!hasRequiredComponents && !missingMapsWarningLogged) {
    missingMapsWarningLogged = true;
    logWarning('NativeMaps', 'react-native-maps is unavailable; using map fallback UI', {
      hasMapView: Boolean(MapView),
      hasMarker: Boolean(Marker),
      hasPolyline: Boolean(Polyline),
      platform: Platform.OS,
    });
  }

  return {
    AnimatedRegion,
    canRender,
    MapView,
    Marker,
    MarkerAnimated,
    Polyline,
    provider,
  };
}
