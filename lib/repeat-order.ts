import type { DeliveryOrder } from '@/lib/delivery-data';

function coordParam(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function textParam(value?: string | null) {
  return value?.trim() ? value.trim() : '';
}

export function getRepeatOrderHref(order: DeliveryOrder) {
  if (order.flow === 'ninunulie' || String(order.serviceLabel || '').toLowerCase() === 'ninunulie') {
    return {
      pathname: '/ninunulie' as const,
      params: {},
    };
  }

  if (order.flow === 'cargo') {
    return {
      pathname: '/book-cargo' as const,
      params: {
        repeat: '1',
        pickup: order.pickupLabel,
        pickupLat: coordParam(order.pickupLatitude),
        pickupLng: coordParam(order.pickupLongitude),
        dropoff: order.dropoffLabel,
        dropoffLat: coordParam(order.dropoffLatitude),
        dropoffLng: coordParam(order.dropoffLongitude),
        vehicle: order.cargoVehicleKey ?? '',
        cargoSize: order.cargoSizeLabel ?? '',
      },
    };
  }

  const isOutside = order.parcelScope === 'outside';

  return {
    pathname: '/send-parcel' as const,
    params: {
      repeat: '1',
      scope: isOutside ? 'outside' : 'city',
      parcelType: order.parcelTypeKey ?? '',
      pickup: order.pickupLabel,
      pickupLat: coordParam(order.pickupLatitude),
      pickupLng: coordParam(order.pickupLongitude),
      dropoff: order.dropoffLabel,
      dropoffLat: coordParam(order.dropoffLatitude),
      dropoffLng: coordParam(order.dropoffLongitude),
      outsideDestinationCity: textParam(order.outsideDestinationCity),
      outsideDestinationStand: textParam(order.outsideDestinationStand || order.outsideDestinationLabel),
      outsideDestination: textParam(order.outsideDestinationLabel || order.dropoffLabel),
      outsideDestinationLat: coordParam(order.outsideDestinationLatitude),
      outsideDestinationLng: coordParam(order.outsideDestinationLongitude),
      outsideShippingMode: textParam(order.outsideShippingMode),
      outsideHandoffMode: textParam(order.outsideHandoffMode),
      timing: order.timingMode === 'later' ? 'later' : 'now',
      scheduleDate: textParam(order.scheduleDate),
      scheduleTime: textParam(order.scheduleTime),
      recipientName: order.recipientName === 'Recipient not provided' ? '' : order.recipientName,
      recipientPhone: order.recipientPhone === 'Not provided' ? '' : order.recipientPhone,
      parcelWeightKg: order.outsideParcelWeightKg ?? '',
    },
  };
}
