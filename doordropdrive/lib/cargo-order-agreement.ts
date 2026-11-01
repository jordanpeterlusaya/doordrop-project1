/**
 * One cargo order document. Customer HAUL and HAUL Pilots both use these
 * status strings:
 *
 * pending_assignment — open offer
 * driver_assigned    — a driver is on the order; still negotiating until confirmed
 * driver_at_pickup   — accepted trip, driver at pickup
 * in_transit         — accepted trip, on the road
 * delivered          — completed
 * cancelled          — cancelled
 *
 * An accepted trip is negotiationStatus "confirmed" or acceptedByDriverAt set.
 * Later steps stay driver_at_pickup and in_transit. Completed is delivered.
 */

export type CargoAgreementPhase =
  | 'open'
  | 'negotiating'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export function cargoAgreementPhase(
  order:
    | {
        status?: string | null;
        negotiationStatus?: string | null;
        acceptedByDriverAt?: unknown;
      }
    | null
    | undefined
): CargoAgreementPhase {
  const status = String(order?.status || '');
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (status === 'delivered' || status === 'at_hub') {
    return 'completed';
  }
  if (status === 'driver_at_pickup' || status === 'in_transit') {
    return 'in_progress';
  }
  if (order?.acceptedByDriverAt) {
    return 'accepted';
  }
  if (status === 'driver_assigned') {
    return 'negotiating';
  }
  return 'open';
}

export function isCargoOfferIncoming(
  order:
    | {
        status?: string | null;
        fareType?: string | null;
        negotiationStatus?: string | null;
        acceptedByDriverAt?: unknown;
      }
    | null
    | undefined
) {
  if (!order) {
    return false;
  }
  const phase = cargoAgreementPhase(order);
  if (phase !== 'open' && phase !== 'negotiating') {
    return false;
  }
  if (order.status === 'driver_assigned') {
    return true;
  }
  return (
    order.status === 'pending_assignment' &&
    order.fareType === 'negotiated' &&
    order.negotiationStatus !== 'confirmed'
  );
}

export function cargoOffersMatch(customerOffer?: number | null, draft?: number | null) {
  return typeof customerOffer === 'number' && customerOffer > 0 && customerOffer === draft;
}

/** Canonical cargo key. Electric stays distinct from fuel TOYO. Unknown values do not match. */
export function canonicalCargoVehicleKey(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'toyo_electric' ||
    normalized === 'toyo-electric' ||
    normalized === 'toyoelectric' ||
    normalized === 'electric_toyo'
  ) {
    return 'toyo_electric';
  }
  if (normalized === 'kirikuu') {
    return 'kirikuu';
  }
  if (normalized === 'canter' || normalized === 'center' || normalized === 'fuso') {
    return 'canter';
  }
  if (
    normalized === 'toyo' ||
    normalized === 'bajaj' ||
    normalized === 'bajaji' ||
    normalized === 'pickup' ||
    normalized === 'van' ||
    normalized === 'toyo_xl' ||
    normalized === 'toyo-xl'
  ) {
    return 'toyo';
  }
  return '';
}
