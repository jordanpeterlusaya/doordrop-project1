import type { DeliveryOrder } from '@/lib/delivery-data';

function coordParam(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function getRepeatOrderHref(order: DeliveryOrder) {
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

  return {
    pathname: '/send-parcel' as const,
    params: {
      repeat: '1',
      scope: order.parcelScope === 'outside' ? 'outside' : 'city',
      parcelType: order.parcelTypeKey ?? '',
      pickup: order.pickupLabel,
      pickupLat: coordParam(order.pickupLatitude),
      pickupLng: coordParam(order.pickupLongitude),
      dropoff: order.dropoffLabel,
      dropoffLat: coordParam(order.dropoffLatitude),
      dropoffLng: coordParam(order.dropoffLongitude),
      recipientName: order.recipientName === 'Recipient not provided' ? '' : order.recipientName,
      recipientPhone: order.recipientPhone === 'Not provided' ? '' : order.recipientPhone,
      parcelWeightKg: order.outsideParcelWeightKg ?? '',
    },
  };
}
