/**
 * Nyerere Bridge (Kigamboni) toll for cargo quotes.
 * The bridge deck is the published point 6°51′33″S 39°17′59″E, 680 m across the Kurasini estuary.
 * Tolls are the published per-crossing rates, added once to the listed price when the route uses the bridge.
 * Small vehicles (Toyo Electric and fuel TOYO) pay TZS 500 on Nyerere Bridge (published small-vehicle rate after the NSSF reduction, still the rate cited in 2025).
 * Pickup up to 2 tonnes: TZS 2,000 (Ministry of Works schedule, 14 May 2016). Kirikuu is that class.
 * The base vehicle rate tables are unchanged. This amount is not added a second time at checkout.
 */

export type BridgePoint = { latitude: number; longitude: number };

const BRIDGE_LAT = -6.859167;
const BRIDGE_LNG = 39.299761;
const METERS_PER_DEG_LAT = 111_320;
const BRIDGE_HALF_METERS = 400;
const DECK_CORRIDOR_METERS = 60;

const METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * Math.cos((BRIDGE_LAT * Math.PI) / 180);
const HALF_LNG = BRIDGE_HALF_METERS / METERS_PER_DEG_LNG;

const BRIDGE_WEST: BridgePoint = { latitude: BRIDGE_LAT, longitude: BRIDGE_LNG - HALF_LNG };
const BRIDGE_EAST: BridgePoint = { latitude: BRIDGE_LAT, longitude: BRIDGE_LNG + HALF_LNG };
const GATE_NORTH: BridgePoint = { latitude: BRIDGE_LAT + 80 / METERS_PER_DEG_LAT, longitude: BRIDGE_LNG };
const GATE_SOUTH: BridgePoint = { latitude: BRIDGE_LAT - 80 / METERS_PER_DEG_LAT, longitude: BRIDGE_LNG };

const KIGAMBONI_SIDE = /kigamboni|vijibweni|kibada|mjimwema|somangila/;

/** Per crossing, by the vehicle the customer is booking. */
export const NYERERE_BRIDGE_TOLL_TZS = {
  toyo_electric: 500,
  toyo: 500,
  kirikuu: 2000,
} as const;

export function nyerereBridgeTollTzs(vehicleKey?: string | null) {
  const key = String(vehicleKey || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (key === 'kirikuu') return NYERERE_BRIDGE_TOLL_TZS.kirikuu;
  if (key === 'toyo_electric' || key === 'toyoelectric' || key === 'electric_toyo') {
    return NYERERE_BRIDGE_TOLL_TZS.toyo_electric;
  }
  if (key === 'toyo' || key === 'bajaj' || key === 'bajaji') return NYERERE_BRIDGE_TOLL_TZS.toyo;
  return 0;
}

function cross(origin: BridgePoint, a: BridgePoint, b: BridgePoint) {
  return (a.longitude - origin.longitude) * (b.latitude - origin.latitude) - (a.latitude - origin.latitude) * (b.longitude - origin.longitude);
}

function segmentsCross(a: BridgePoint, b: BridgePoint, c: BridgePoint, d: BridgePoint) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function distanceToBridgeDeckMeters(point: BridgePoint) {
  const lat0 = (BRIDGE_LAT * Math.PI) / 180;
  const ax = 0;
  const ay = 0;
  const bx = (BRIDGE_EAST.longitude - BRIDGE_WEST.longitude) * Math.cos(lat0) * METERS_PER_DEG_LAT;
  const by = (BRIDGE_EAST.latitude - BRIDGE_WEST.latitude) * METERS_PER_DEG_LAT;
  const px = (point.longitude - BRIDGE_WEST.longitude) * Math.cos(lat0) * METERS_PER_DEG_LAT;
  const py = (point.latitude - BRIDGE_WEST.latitude) * METERS_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
  const cx = bx * t;
  const cy = by * t;
  return Math.hypot(px - cx, py - cy);
}

export function routeCrossesNyerereBridge(
  points: BridgePoint[] | null | undefined,
  labels?: { pickup?: string | null; dropoff?: string | null }
) {
  const route = (points || []).filter(
    (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  );
  for (const point of route) {
    if (distanceToBridgeDeckMeters(point) <= DECK_CORRIDOR_METERS) {
      return true;
    }
  }
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    if (segmentsCross(previous, current, BRIDGE_WEST, BRIDGE_EAST)) {
      return true;
    }
    if (segmentsCross(previous, current, GATE_NORTH, GATE_SOUTH)) {
      return true;
    }
    const mid = {
      latitude: (previous.latitude + current.latitude) / 2,
      longitude: (previous.longitude + current.longitude) / 2,
    };
    if (distanceToBridgeDeckMeters(mid) <= DECK_CORRIDOR_METERS) {
      return true;
    }
  }

  const pickupLabel = String(labels?.pickup || '').toLowerCase();
  const dropoffLabel = String(labels?.dropoff || '').toLowerCase();
  const pickupEast = KIGAMBONI_SIDE.test(pickupLabel);
  const dropoffEast = KIGAMBONI_SIDE.test(dropoffLabel);
  if (pickupEast === dropoffEast || route.length < 2) {
    return false;
  }
  const startLng = route[0].longitude;
  const endLng = route[route.length - 1].longitude;
  return (startLng - BRIDGE_LNG) * (endLng - BRIDGE_LNG) < 0;
}
