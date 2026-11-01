import type { DeliveryOrder, DeliveryOrderStatus } from '@/lib/delivery-data';
import { getDeliveryOrderStatusLabel, isNinunulieOrder } from '@/lib/delivery-data';
import {
  getOutsideLogisticsStatusLabel,
  isOutsideParcelOrder,
  type OutsideLogisticsStatus,
} from '@/lib/outside-order-logistics';

const CITY_ACTIVE_STATUSES = new Set<DeliveryOrderStatus>([
  'pending_assignment',
  'driver_assigned',
  'driver_at_pickup',
  'in_transit',
]);

const CITY_PROGRESS_STEPS = [
  { key: 'placed', labelEn: 'Placed', labelSw: 'Imewekwa' },
  { key: 'assigned', labelEn: 'Driver', labelSw: 'Dereva' },
  { key: 'pickup', labelEn: 'Pickup', labelSw: 'Chukua' },
  { key: 'transit', labelEn: 'On the way', labelSw: 'Njiani' },
] as const;

const OUTSIDE_PROGRESS_STEPS: Array<{
  key: OutsideLogisticsStatus | 'cancelled';
  labelEn: string;
  labelSw: string;
}> = [
  { key: 'awaiting_dispatch', labelEn: 'Confirmed', labelSw: 'Imethibitishwa' },
  { key: 'received_at_hub', labelEn: 'At office', labelSw: 'Ofisini' },
  { key: 'in_transit_carrier', labelEn: 'In transit', labelSw: 'Njiani' },
  { key: 'arrived_destination', labelEn: 'Arrived', labelSw: 'Imefika' },
  { key: 'completed', labelEn: 'Received', labelSw: 'Imepokelewa' },
];

function outsideProgressIndex(status: string) {
  const normalized = String(status || 'awaiting_dispatch');
  if (['first_mile_assigned', 'awaiting_hub_intake'].includes(normalized)) {
    return 0;
  }
  if (normalized === 'received_at_hub') {
    return 1;
  }
  if (normalized === 'in_transit_carrier') {
    return 2;
  }
  if (['arrived_destination', 'out_for_delivery'].includes(normalized)) {
    return 3;
  }
  if (normalized === 'completed') {
    return 4;
  }
  return 0;
}

export function isBusCustomerParcel(
  order: {
    parcelScope?: string | null;
    outsideDestinationCity?: string | null;
    outsideDestinationLabel?: string | null;
    outsideShippingMode?: string | null;
  } | null | undefined
) {
  if (!isOutsideParcelOrder(order)) {
    return false;
  }
  const mode = String(order?.outsideShippingMode || '').toLowerCase();
  return !['express', 'air', 'flight', 'ndege'].some((key) => mode.includes(key));
}

const BUS_PROGRESS_STEPS = [
  { key: 'received', labelEn: 'Order Received', labelSw: 'Oda imepokelewa' },
  { key: 'confirmed', labelEn: 'Confirmed', labelSw: 'Imethibitishwa' },
  { key: 'transit', labelEn: 'On the Way', labelSw: 'Iko njiani' },
  { key: 'delivered', labelEn: 'Delivered', labelSw: 'Imewasili' },
] as const;

/** Same four stages the transporter portal writes onto carrierTrackStep. */
function busStageIndex(order: DeliveryOrder) {
  const step = String(order.carrierTrackStep || '');
  const match = String(order.carrierMatchStatus || '');
  if (step === 'handed' || order.status === 'delivered') return 3;
  if (step === 'transit' || step === 'arrived') return 2;
  if (step === 'received' || step === 'pickup' || step === 'packed' || match === 'accepted') return 1;
  return 0;
}

function busStageTime(order: DeliveryOrder, index: number, current: number) {
  if (index === 0) return order.createdAt;
  if (index === 3 && current >= 3) return order.deliveredAt;
  if (index === current && index > 0) return order.carrierJourneyAt;
  return undefined;
}

function stageTimeLabel(value: unknown) {
  if (!value) return '';
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const next = value.toDate();
    date = next instanceof Date ? next : null;
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function getBusParcelHeadline(order: DeliveryOrder, language: 'en' | 'sw') {
  const step = BUS_PROGRESS_STEPS[busStageIndex(order)];
  return language === 'sw' ? step.labelSw : step.labelEn;
}

export function getBusParcelDetail(order: DeliveryOrder, language: 'en' | 'sw') {
  const sw = language === 'sw';
  const lines = [
    sw ? 'Oda yako imepokelewa.' : 'Your order has been received.',
    sw ? 'Kampuni imethibitisha oda yako.' : 'The transporter has confirmed your order.',
    sw ? 'Mzigo wako uko njiani.' : 'Your cargo is on its way.',
    sw ? 'Mzigo wako umefika.' : 'Your cargo has arrived.',
  ];
  const stage = busStageIndex(order);
  const base = lines[stage];
  if (stage !== 2) return base;
  const place = String(order.carrierLocationLabel || '').trim();
  return place ? `${base} ${place}.` : base;
}

function cityProgressIndex(status: DeliveryOrderStatus) {
  if (status === 'pending_assignment') {
    return 0;
  }
  if (status === 'driver_assigned') {
    return 1;
  }
  if (status === 'driver_at_pickup') {
    return 2;
  }
  return 3;
}

/** Cargo fare still being negotiated — not yet on track/home. */
export function isCargoNegotiationOpen(order: DeliveryOrder | null | undefined) {
  return Boolean(
    order &&
      order.flow === 'cargo' &&
      order.fareType === 'negotiated' &&
      order.negotiationStatus === 'open'
  );
}

export function isActiveCustomerOrder(order: DeliveryOrder | null | undefined) {
  if (!order || order.status === 'cancelled') {
    return false;
  }

  if (isCargoNegotiationOpen(order)) {
    return false;
  }

  // Ninunulie is handled on WhatsApp + admin — never show as a trackable active order.
  if (isNinunulieOrder(order)) {
    return false;
  }

  if (isOutsideParcelOrder(order)) {
    const logistics = String(order.logisticsStatus || 'awaiting_dispatch');
    if (['completed', 'cancelled'].includes(logistics)) {
      return false;
    }
    return order.status !== 'delivered';
  }

  return CITY_ACTIVE_STATUSES.has(order.status);
}

/** Orders that should light History (incl. Ninunulie in progress). */
export function isHistoryActivityOrder(order: DeliveryOrder | null | undefined) {
  if (!order || order.status === 'cancelled' || order.status === 'delivered') {
    return false;
  }

  if (isCargoNegotiationOpen(order)) {
    return false;
  }

  if (isNinunulieOrder(order)) {
    return true;
  }

  return isActiveCustomerOrder(order);
}

export function getActiveOrderHeadline(order: DeliveryOrder, language: 'en' | 'sw') {
  if (isBusCustomerParcel(order)) {
    return getBusParcelHeadline(order, language);
  }

  if (isOutsideParcelOrder(order)) {
    const status = String(order.logisticsStatus || 'awaiting_dispatch');
    return getOutsideLogisticsStatusLabel(status, language);
  }

  const swMap: Partial<Record<DeliveryOrderStatus, string>> = {
    pending_assignment: 'Inatafuta dereva',
    driver_assigned: 'Dereva amepangiwa',
    driver_at_pickup: 'Dereva yupo kwenye pickup',
    in_transit: 'Mzigo uko njiani',
  };

  if (language === 'sw' && swMap[order.status]) {
    return swMap[order.status];
  }

  return getDeliveryOrderStatusLabel(order.status);
}

export function getActiveOrderProgress(order: DeliveryOrder, language: 'en' | 'sw') {
  if (isBusCustomerParcel(order)) {
    const currentIndex = busStageIndex(order);
    return BUS_PROGRESS_STEPS.map((step, index) => ({
      key: step.key,
      label: language === 'sw' ? step.labelSw : step.labelEn,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
      timeLabel: stageTimeLabel(busStageTime(order, index, currentIndex)),
    }));
  }

  if (isOutsideParcelOrder(order)) {
    const currentIndex = outsideProgressIndex(String(order.logisticsStatus || 'awaiting_dispatch'));
    return OUTSIDE_PROGRESS_STEPS.map((step, index) => ({
      key: step.key,
      label: language === 'sw' ? step.labelSw : step.labelEn,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
      timeLabel: '',
    }));
  }

  const currentIndex = cityProgressIndex(order.status);
  return CITY_PROGRESS_STEPS.map((step, index) => ({
    key: step.key,
    label: language === 'sw' ? step.labelSw : step.labelEn,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
    timeLabel: '',
  }));
}

export function getActiveOrderBadge(order: DeliveryOrder, language: 'en' | 'sw') {
  if (isOutsideParcelOrder(order)) {
    const mode = String(order.outsideShippingMode || '').toLowerCase();
    if (mode.includes('express') || mode.includes('air')) {
      return language === 'sw' ? 'Ndege' : 'Air';
    }
    if (mode.includes('bus') || mode.includes('standard')) {
      return language === 'sw' ? 'Basi' : 'Bus';
    }
    return language === 'sw' ? 'Mkoa mwingine' : 'Intercity';
  }

  if (order.flow === 'cargo') {
    return language === 'sw' ? 'Cargo' : 'Cargo';
  }

  return language === 'sw' ? 'Mjini' : 'City';
}
