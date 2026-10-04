/** Shared helpers for other-region (outside) parcel ops. */

export type OutsideLogisticsStatus =
  | 'awaiting_dispatch'
  | 'first_mile_assigned'
  | 'awaiting_hub_intake'
  | 'received_at_hub'
  | 'in_transit_carrier'
  | 'arrived_destination'
  | 'out_for_delivery'
  | 'completed';

export type OutsideLogisticsEvent = {
  status: OutsideLogisticsStatus | string;
  note?: string;
  by?: string;
  at?: unknown;
};

export type OutsideParcelPublicSummary = {
  c: string;
  id: string;
  on?: string;
  origin?: string;
  dest?: string;
  stand?: string;
  mode?: string;
  handoff?: string;
  weight?: string;
  recipient?: string;
  phone?: string;
  fare?: string;
  status?: string;
};

export const OUTSIDE_PARCEL_PUBLIC_BASE_URL = 'https://efootball-app-9d175.web.app/parcel';

export function isOutsideParcelOrder(order: {
  parcelScope?: string | null;
  outsideDestinationCity?: string | null;
  outsideDestinationLabel?: string | null;
  outsideShippingMode?: string | null;
} | null | undefined) {
  if (!order) {
    return false;
  }
  if (String(order.parcelScope || '').trim().toLowerCase() === 'outside') {
    return true;
  }
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

export function generateOutsideParcelCode(orderId: string) {
  const base = String(orderId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase();
  return `DDX-${base || 'ORDER'}`;
}

export function buildOutsideParcelPublicSummary(input: {
  parcelCode: string;
  orderId: string;
  orderNumber?: string;
  originCity?: string;
  destinationCity?: string;
  destinationStand?: string;
  shippingMode?: string;
  handoffMode?: string;
  weightKg?: string;
  recipientName?: string;
  recipientPhone?: string;
  fareLabel?: string;
  logisticsStatus?: string;
}): OutsideParcelPublicSummary {
  const phone = String(input.recipientPhone || '').replace(/\D/g, '');
  const maskedPhone = phone.length >= 3 ? `***${phone.slice(-3)}` : undefined;
  return {
    c: input.parcelCode,
    id: input.orderId,
    on: input.orderNumber || undefined,
    origin: input.originCity || undefined,
    dest: input.destinationCity || undefined,
    stand: input.destinationStand || undefined,
    mode: input.shippingMode || undefined,
    handoff: input.handoffMode || undefined,
    weight: input.weightKg || undefined,
    recipient: input.recipientName || undefined,
    phone: maskedPhone,
    fare: input.fareLabel || undefined,
    status: input.logisticsStatus || 'awaiting_dispatch',
  };
}

/** QR encodes a public URL so scanning opens the parcel info page. */
export function buildOutsideParcelQrPayload(parcelCode: string, orderId: string, summary?: OutsideParcelPublicSummary) {
  return buildOutsideParcelPublicUrl(parcelCode, orderId, summary);
}

export function buildOutsideParcelPublicUrl(
  parcelCode: string,
  orderId: string,
  summary?: OutsideParcelPublicSummary
) {
  const params = new URLSearchParams();
  params.set('c', parcelCode);
  params.set('id', orderId);
  if (summary) {
    params.set('d', encodeURIComponent(JSON.stringify(summary)));
  }
  return `${OUTSIDE_PARCEL_PUBLIC_BASE_URL}?${params.toString()}`;
}

export function buildOutsideParcelQrImageUrl(payload: string, size = 280) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;
}

export function getOutsideTransportIconName(shippingMode?: string | null, handoffMode?: string | null) {
  const mode = String(shippingMode || '').toLowerCase();
  const handoff = String(handoffMode || '').toLowerCase();
  if (mode === 'express' || handoff === 'airport') {
    return 'airplane' as const;
  }
  if (handoff === 'home') {
    return 'home-export-outline' as const;
  }
  return 'bus' as const;
}

export function getOutsideTransportLabel(shippingMode?: string | null, handoffMode?: string | null) {
  const mode = String(shippingMode || '').toLowerCase();
  const handoff = String(handoffMode || '').toLowerCase();
  if (mode === 'express') {
    return handoff === 'home' ? 'Air · home delivery' : 'Air · airport handoff';
  }
  if (mode === 'standard') {
    return handoff === 'home' ? 'Bus · home delivery' : 'Bus · stand handoff';
  }
  return 'Other regions';
}

export const OUTSIDE_LOGISTICS_STATUS_LABELS: Record<OutsideLogisticsStatus, string> = {
  awaiting_dispatch: 'Order confirmed — awaiting pickup',
  first_mile_assigned: 'Driver collecting parcel',
  awaiting_hub_intake: 'Heading to DoorDrop office',
  received_at_hub: 'At DoorDrop office',
  in_transit_carrier: 'In transit (bus / air)',
  arrived_destination: 'Arrived at destination',
  out_for_delivery: 'Out for delivery',
  completed: 'Received',
};

export const OUTSIDE_LOGISTICS_STATUS_LABELS_SW: Record<OutsideLogisticsStatus, string> = {
  awaiting_dispatch: 'Inasubiri uchukuzi wa kwanza',
  first_mile_assigned: 'Dereva anakuja kuchukua',
  awaiting_hub_intake: 'Inaelekea ofisi ya DoorDrop',
  received_at_hub: 'Imepokelewa ofisini',
  in_transit_carrier: 'Safarini (basi / ndege)',
  arrived_destination: 'Imefika eneo lengwa',
  out_for_delivery: 'Inapelekwa kwa mpokeaji',
  completed: 'Imepokelewa',
};

export function getOutsideLogisticsStatusLabel(status?: string | null, language: 'en' | 'sw' = 'en') {
  const key = String(status || '').trim() as OutsideLogisticsStatus;
  if (language === 'sw' && OUTSIDE_LOGISTICS_STATUS_LABELS_SW[key]) {
    return OUTSIDE_LOGISTICS_STATUS_LABELS_SW[key];
  }
  return OUTSIDE_LOGISTICS_STATUS_LABELS[key] || String(status || 'Unknown').replace(/_/g, ' ');
}

const OUTSIDE_POST_HUB_LOGISTICS = [
  'received_at_hub',
  'in_transit_carrier',
  'arrived_destination',
  'out_for_delivery',
  'completed',
] as const;

/** Parcel has reached the DoorDrop office and left first-mile driver tracking. */
export function isOutsidePostHubPhase(order: {
  status?: string | null;
  logisticsStatus?: string | null;
} | null | undefined) {
  if (!order) {
    return false;
  }
  const logistics = String(order.logisticsStatus || '').trim();
  if (OUTSIDE_POST_HUB_LOGISTICS.includes(logistics as (typeof OUTSIDE_POST_HUB_LOGISTICS)[number])) {
    return true;
  }
  return String(order.status || '').trim() === 'at_hub';
}

/** After hub intake, customer should not cancel. */
export function canCancelOutsideParcel(order: {
  status?: string | null;
  logisticsStatus?: string | null;
} | null | undefined) {
  if (!order) {
    return false;
  }
  if (['delivered', 'cancelled'].includes(String(order.status || ''))) {
    return false;
  }
  const logistics = String(order.logisticsStatus || '');
  return !['received_at_hub', 'in_transit_carrier', 'arrived_destination', 'out_for_delivery', 'completed'].includes(
    logistics
  );
}

export function makeLogisticsEvent(
  status: OutsideLogisticsStatus | string,
  note?: string,
  by = 'system'
): OutsideLogisticsEvent {
  return {
    status,
    note: note || undefined,
    by,
    at: new Date(),
  };
}
