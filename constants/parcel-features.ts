import type { ParcelScope } from '@/constants/cargo-theme';

/**
 * Temporarily hidden until the in-city (mjini) parcel service launches.
 * Flip to `true` to restore the In city / Mjini tab, same-city dropoff UI,
 * city package types, and in-city pricing without rebuilding those screens.
 */
export const CITY_PARCELS_ENABLED = false;

function firstParam(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}

/** Visible booking scope. City is forced off while CITY_PARCELS_ENABLED is false. */
export function resolveVisibleParcelScope(requested?: string | string[] | null): ParcelScope {
  if (!CITY_PARCELS_ENABLED) {
    return 'outside';
  }
  return firstParam(requested) === 'outside' ? 'outside' : 'city';
}

export function isHiddenCityParcelRequest(requested?: string | string[] | null) {
  return !CITY_PARCELS_ENABLED && firstParam(requested) !== 'outside';
}
