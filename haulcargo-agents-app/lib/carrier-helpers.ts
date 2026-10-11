import { HAUL_FEE_RATE } from '@/constants/theme';
import {
  DESK_RAIL,
  type Carrier,
  type CarrierShipment,
  type CarrierTrip,
  type FireTime,
} from '@/lib/carrier-types';

const DAR = 'Africa/Dar_es_Salaam';

/** Desk-facing company label: trading name when set, else registered company name. */
export function carrierDisplayName(carrier?: Pick<Carrier, 'tradingName' | 'companyName' | 'name'> | null) {
  const trading = carrier?.tradingName?.trim();
  if (trading) return trading;
  const registered = carrier?.companyName?.trim();
  if (registered) return registered;
  const legacy = carrier?.name?.trim();
  if (legacy) return legacy;
  return 'Kampuni';
}

export function darTodayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAR }).format(new Date());
}

export function darTodayLabel() {
  return new Intl.DateTimeFormat('sw-TZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: DAR,
  }).format(new Date());
}

export function fireTimeMs(value: FireTime): number {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return (value as { seconds: number }).seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as string).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatWhen(value: FireTime) {
  const ms = fireTimeMs(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('sw-TZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function offerExpiresMs(item: CarrierShipment) {
  return fireTimeMs(item.offerExpiresAt);
}

export function formatCountdown(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function money(amount: number | undefined) {
  return `TZS ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}

export function feeSplit(amount: number) {
  const n = Number(amount) || 0;
  const haulFee = Math.round(n * HAUL_FEE_RATE);
  return { amount: n, haulFee, carrierNet: n - haulFee };
}

export function shipmentCode(item: CarrierShipment) {
  const parcelCode = String(item.parcelCode || '').trim();
  if (parcelCode) return parcelCode.toUpperCase();
  return String(item.orderNumber || item.id.slice(0, 8)).trim().toUpperCase();
}

export function isDelivered(item: CarrierShipment) {
  return item.shipmentStatus === 'delivered' || item.trackStep === 'handed';
}

export function trackLabel(stepKey: string) {
  const step = DESK_RAIL.find((s) => s.key === stepKey);
  return step?.label || stepKey;
}

/** Index on the desk rail. Imefika is the last step. Pickup mode does not move this. */
export function deskIndex(item: CarrierShipment) {
  const step = String(item.trackStep || '');
  if (step === 'handed' || item.shipmentStatus === 'delivered') return 4;
  if (step === 'arrived' || item.shipmentStatus === 'arrived') return 3;
  if (step === 'transit' || item.shipmentStatus === 'in_transit') return 2;
  if (step === 'packed' || item.shipmentStatus === 'picked_up' || item.shipmentStatus === 'at_bus') return 1;
  if (
    step === 'received' ||
    step === 'pickup' ||
    item.shipmentStatus === 'accepted' ||
    item.shipmentStatus === 'contacted' ||
    item.shipmentStatus === 'pickup_scheduled'
  ) {
    return 0;
  }
  return -1;
}

function railAt(index: number) {
  return DESK_RAIL.find((_, stepIndex) => stepIndex === index);
}

export function deskStatusLabel(item: CarrierShipment) {
  if (isDelivered(item) || item.shipmentStatus === 'arrived' || item.trackStep === 'arrived') return 'Imefika';
  const step = railAt(deskIndex(item));
  if (step) return step.label;
  if (item.shipmentStatus === 'assigned') return 'Oda mpya';
  return item.shipmentStatus;
}

/** Next forward step. Imefika is the last action the company can take. */
export function nextDeskStep(item: CarrierShipment) {
  if (isDelivered(item)) return null;
  const index = deskIndex(item);
  if (index < 0) return null;
  return railAt(index + 1) || null;
}

export function carrierStatusLabel(status?: string) {
  const map: Record<string, string> = {
    pending: 'Inasubiri uthibitisho',
    verified: 'Imethibitishwa',
    suspended: 'Imesimamishwa',
    rejected: 'Imekataliwa',
  };
  return map[String(status || '').toLowerCase()] || status || '';
}

export function cashStatusLabel(status?: string) {
  const map: Record<string, string> = {
    unpaid: 'Haijalipwa',
    collected: 'Imekusanywa',
    pending_reconciliation: 'Inasubiri ulinganifu',
    reconciled: 'Imelinganishwa',
  };
  return map[String(status || '').toLowerCase()] || status || '';
}

export function dropOffLabel(item: CarrierShipment) {
  return item.destination || item.routeLabel || '—';
}

export function isIncomingOffer(item: CarrierShipment, carrierId: string) {
  return item.shipmentStatus === 'assigned' && item.offeredCarrierId === carrierId && !item.carrierId;
}

export function offerStillValid(item: CarrierShipment) {
  if (item.shipmentStatus !== 'assigned') return false;
  const until = offerExpiresMs(item);
  if (!until) return true;
  return until > Date.now();
}

const HELD_STATUSES = new Set([
  'accepted',
  'contacted',
  'pickup_scheduled',
  'picked_up',
  'at_bus',
  'in_transit',
  'arrived',
]);

/** Open kg is capacity minus weight already on this company's active shipments. */
export function capacitySnapshot(
  carrier: Pick<Carrier, 'cargoCapacityKg'> | null | undefined,
  shipments: CarrierShipment[],
  carrierId: string,
  excludeId?: string
) {
  const limit = Number(carrier?.cargoCapacityKg) || 0;
  let held = 0;
  for (const item of shipments) {
    if (item.id === excludeId) continue;
    if (item.carrierId !== carrierId) continue;
    if (!HELD_STATUSES.has(item.shipmentStatus)) continue;
    held += Number(item.weightKg) || 0;
  }
  return {
    limit,
    held,
    open: limit > 0 ? limit - held : null,
  };
}

export function todayCargoRows(shipments: CarrierShipment[], carrierId: string) {
  const today = darTodayKey();
  return shipments.filter((item) => {
    if (item.carrierId !== carrierId || item.shipmentStatus === 'assigned') return false;
    if (item.shipmentStatus === 'delivered') {
      const ms = fireTimeMs(item.deliveredAt);
      if (!ms) return false;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: DAR }).format(new Date(ms));
      return day === today;
    }
    return item.shipmentStatus !== 'matching';
  });
}

export function primaryActiveJob(shipments: CarrierShipment[], carrierId: string): CarrierShipment | null {
  const active = shipments.filter(
    (item) =>
      item.carrierId === carrierId &&
      !isDelivered(item) &&
      item.shipmentStatus !== 'matching' &&
      item.shipmentStatus !== 'assigned'
  );
  const offer = shipments.find((item) => isIncomingOffer(item, carrierId) && offerStillValid(item));
  if (offer) return offer;
  return active[0] || null;
}

/** Newest-first inbox: live offers + active accepted work (not delivered history). */
export function inboxShipments(shipments: CarrierShipment[], carrierId: string): CarrierShipment[] {
  if (!carrierId) return [];
  return shipments
    .filter((item) => {
      if (isIncomingOffer(item, carrierId)) return true;
      if (item.carrierId !== carrierId) return false;
      if (isDelivered(item) || item.shipmentStatus === 'matching') return false;
      return true;
    })
    .sort((left, right) => shipmentRecencyMs(right) - shipmentRecencyMs(left));
}

export function shipmentRecencyMs(item: CarrierShipment) {
  return (
    fireTimeMs(item.offeredAt) ||
    fireTimeMs(item.acceptedAt) ||
    fireTimeMs(item.createdAt) ||
    fireTimeMs(item.offerExpiresAt) ||
    0
  );
}

export function telHref(phone?: string | null) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `tel:${digits}` : '';
}

function contactBits(name?: string, phone?: string) {
  return [String(name || '').trim(), String(phone || '').trim()].filter(Boolean).join(' ');
}

/** Tight WhatsApp/share text. Omits any fact the shipment does not have. */
export function orderShareMessage(item: CarrierShipment) {
  const lines = [shipmentCode(item)];
  const type = String(item.parcelDescription || '').trim();
  const kg = Number(item.weightKg) || 0;
  const cargo = [type, kg ? `${kg} kg` : ''].filter(Boolean).join(', ');
  if (cargo) lines.push(`Mzigo: ${cargo}`);
  const pickup = String(item.pickupLabel || item.origin || '').trim();
  if (pickup) lines.push(`Kuchukua: ${pickup}`);
  const destination = String(item.destination || '').trim();
  if (destination) lines.push(`Kwenda: ${destination}`);
  const sender = contactBits(item.customerName, item.customerPhone);
  if (sender) lines.push(`Mtumaji: ${sender}`);
  const recipient = contactBits(item.recipientName, item.recipientPhone);
  if (recipient) lines.push(`Mpokeaji: ${recipient}`);
  const price = [
    item.cashExpected != null ? `Mteja ${money(item.cashExpected)}` : '',
    item.carrierNet != null ? `Mapato ${money(item.carrierNet)}` : '',
    item.haulFee != null ? `Kamisheni ${money(item.haulFee)}` : '',
  ].filter(Boolean);
  if (price.length) lines.push(price.join(' · '));
  return lines.join('\n');
}

export function tripArrivalMs(trip: Pick<CarrierTrip, 'serviceDate' | 'arrivalTime'>) {
  const clock = String(trip.arrivalTime || '').trim();
  const day = String(trip.serviceDate || '').trim();
  if (!/^\d{2}:\d{2}$/.test(clock) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  const ms = new Date(`${day}T${clock}:00+03:00`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Late only when the company set a trip arrival time and arrivedAt is after it. */
export function isShipmentLate(item: CarrierShipment, trips: CarrierTrip[]) {
  if (!item.tripId) return false;
  const trip = trips.find((entry) => entry.id === item.tripId);
  if (!trip?.arrivalTime) return false;
  const deadline = tripArrivalMs(trip);
  const arrived = fireTimeMs(item.arrivedAt);
  if (!deadline || !arrived) return false;
  return arrived > deadline;
}
