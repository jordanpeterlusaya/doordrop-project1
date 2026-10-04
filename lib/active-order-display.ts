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
  { key: 'search', labelEn: 'Bus', labelSw: 'Basi' },
  { key: 'found', labelEn: 'Matched', labelSw: 'Limepatikana' },
  { key: 'pickup', labelEn: 'Pickup', labelSw: 'Chukua' },
  { key: 'transit', labelEn: 'On the way', labelSw: 'Njiani' },
  { key: 'done', labelEn: 'Done', labelSw: 'Mwisho' },
] as const;

function busProgressIndex(order: DeliveryOrder) {
  const step = String(order.carrierTrackStep || '');
  if (step === 'handed' || step === 'arrived' || order.status === 'delivered') {
    return 4;
  }
  if (step === 'transit') {
    return 3;
  }
  if (step === 'pickup' || step === 'packed') {
    return 2;
  }
  if (step === 'received' || order.carrierMatchStatus === 'accepted' || order.carrierMatchStatus === 'offered') {
    return 1;
  }
  return 0;
}

export function getBusParcelHeadline(order: DeliveryOrder, language: 'en' | 'sw') {
  const sw = language === 'sw';
  const step = String(order.carrierTrackStep || '');
  const route = String(order.carrierRouteLabel || '').trim();
  if (step === 'handed' || order.status === 'delivered') {
    return sw ? 'Mzigo umekabidhiwa' : 'Parcel handed over';
  }
  if (step === 'arrived') {
    return sw ? 'Mzigo umefika' : 'Parcel arrived';
  }
  if (step === 'transit') {
    return sw ? 'Mzigo uko njiani' : 'Parcel is on the way';
  }
  if (step === 'packed') {
    return sw ? 'Mzigo umepakiwa' : 'Parcel is packed';
  }
  if (step === 'pickup') {
    return order.carrierPickupMode === 'haul_delivers_to_office'
      ? sw
        ? 'Mzigo unaletwa ofisini'
        : 'Parcel is going to the bus office'
      : sw
        ? 'Basi linakuja kuchukua'
        : 'The bus is coming to collect it';
  }
  if (step === 'received' || order.carrierMatchStatus === 'accepted') {
    return sw ? 'Basi limekubali mzigo' : 'Bus accepted the parcel';
  }
  if (order.carrierMatchStatus === 'offered') {
    return route ? (sw ? `Basi limepatikana · ${route}` : `Bus matched · ${route}`) : sw ? 'Basi limepatikana' : 'Bus matched';
  }
  return sw ? 'Tunatafuta basi' : 'Matching a bus';
}

export function getBusParcelDetail(order: DeliveryOrder, language: 'en' | 'sw') {
  const sw = language === 'sw';
  const route = String(order.carrierRouteLabel || '').trim();
  if (order.carrierPickupMode === 'agent_collects') {
    return sw ? 'Kampuni itakuja kuchukua mzigo kwako.' : 'The bus company will collect the parcel from you.';
  }
  if (order.carrierPickupMode === 'haul_delivers_to_office') {
    return sw ? 'Mzigo utaletwa ofisini mwa kampuni ya basi.' : 'Haul will bring the parcel to the bus office.';
  }
  if (route) {
    return sw ? `Ratiba: ${route}.` : `Schedule: ${route}.`;
  }
  return sw
    ? 'Tunalinganisha uzito na njia na basi lililothibitishwa.'
    : 'We are matching the weight and route to a verified bus.';
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
    const currentIndex = busProgressIndex(order);
    return BUS_PROGRESS_STEPS.map((step, index) => ({
      key: step.key,
      label: language === 'sw' ? step.labelSw : step.labelEn,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
    }));
  }

  if (isOutsideParcelOrder(order)) {
    const currentIndex = outsideProgressIndex(String(order.logisticsStatus || 'awaiting_dispatch'));
    return OUTSIDE_PROGRESS_STEPS.map((step, index) => ({
      key: step.key,
      label: language === 'sw' ? step.labelSw : step.labelEn,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
    }));
  }

  const currentIndex = cityProgressIndex(order.status);
  return CITY_PROGRESS_STEPS.map((step, index) => ({
    key: step.key,
    label: language === 'sw' ? step.labelSw : step.labelEn,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
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
