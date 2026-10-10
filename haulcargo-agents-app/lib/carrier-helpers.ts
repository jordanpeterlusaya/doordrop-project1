import { HAUL_FEE_RATE } from '@/constants/theme';
import { TRACK, type CarrierShipment, type FireTime } from '@/lib/carrier-types';

const DAR = 'Africa/Dar_es_Salaam';

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

export function isLoaded(item: CarrierShipment) {
  return Boolean(item.loadedAt) || ['at_bus', 'in_transit', 'arrived', 'delivered'].includes(item.shipmentStatus);
}

export function isArrived(item: CarrierShipment) {
  return Boolean(item.arrivedAt) || ['arrived', 'delivered'].includes(item.shipmentStatus);
}

export function isDelivered(item: CarrierShipment) {
  return item.shipmentStatus === 'delivered';
}

export function trackLabel(stepKey: string, pickupMode?: string) {
  const step = TRACK.find((s) => s.key === stepKey);
  if (!step) return stepKey;
  if (step.key === 'pickup') {
    return pickupMode === 'haul_delivers_to_office' ? 'Kuleta ofisini' : 'Wakala anachukua';
  }
  return step.label;
}

export function trackIndex(item: CarrierShipment) {
  if (item.trackStep) {
    const found = TRACK.findIndex((step) => step.key === item.trackStep);
    if (found >= 0) return found;
  }
  const status = item.shipmentStatus;
  if (status === 'accepted') return 0;
  if (status === 'contacted' || status === 'pickup_scheduled') return item.pickupMode ? 1 : 0;
  if (status === 'picked_up' || status === 'at_bus') return 2;
  if (status === 'in_transit') return 3;
  if (status === 'arrived') return 4;
  if (status === 'delivered') return 5;
  return -1;
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
  const until = offerExpiresMs(item);
  return until > Date.now();
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
  const needsPickup = active.filter((item) => !item.pickupMode && ['accepted', 'contacted'].includes(item.shipmentStatus));
  if (needsPickup.length) return needsPickup[0];
  return active[0] || null;
}

export function manifestNextAction(item: CarrierShipment) {
  if (!isLoaded(item)) return { act: 'loaded' as const, label: 'Imepakiwa' };
  if (!isArrived(item)) return { act: 'arrived' as const, label: 'Imefika' };
  if (!isDelivered(item)) return { act: 'delivered' as const, label: 'Imekabidhiwa' };
  return null;
}

export function groupManifestByDrop(shipments: CarrierShipment[], carrierId: string) {
  const rows = todayCargoRows(shipments, carrierId).filter((item) => item.shipmentStatus !== 'delivered');
  const groups = new Map<string, CarrierShipment[]>();
  for (const item of rows) {
    const key = dropOffLabel(item);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
