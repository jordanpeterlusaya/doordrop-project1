import type { DeliveryOrder } from '@/lib/delivery-data';
import { getOutsideTransportLabel, isOutsideParcelOrder } from '@/lib/outside-order-logistics';

function isGenericLocalRouteLabel(routeLabel: string) {
  return /local delivery/i.test(routeLabel) || /^dar es salaam\b/i.test(routeLabel);
}

export type OrderRouteDisplay = {
  from: string;
  to: string;
  detail?: string;
  shareLabel: string;
};

export function getOrderRouteDisplay(order: Pick<
  DeliveryOrder,
  | 'pickupLabel'
  | 'dropoffLabel'
  | 'routeLabel'
  | 'parcelScope'
  | 'outsideOriginCity'
  | 'outsideDestinationCity'
  | 'outsideDestinationLabel'
  | 'outsideDestinationStand'
  | 'outsideShippingMode'
  | 'outsideHandoffMode'
> | null | undefined): OrderRouteDisplay {
  if (!order) {
    return {
      from: 'Pickup',
      to: 'Drop-off',
      shareLabel: 'Pickup to drop-off',
    };
  }

  if (isOutsideParcelOrder(order)) {
    const from = String(order.outsideOriginCity || order.pickupLabel || '').trim() || 'Origin';
    const destinationCity = String(
      order.outsideDestinationCity || order.outsideDestinationLabel || order.dropoffLabel || ''
    ).trim();
    const stand = String(order.outsideDestinationStand || '').trim();
    const handoff = String(order.outsideHandoffMode || '').trim().toLowerCase();
    const detail = getOutsideTransportLabel(order.outsideShippingMode, order.outsideHandoffMode);
    const to =
      destinationCity && stand && handoff !== 'home'
        ? `${destinationCity} · ${stand}`
        : destinationCity || stand || String(order.dropoffLabel || '').trim() || 'Destination';

    return {
      from,
      to,
      detail,
      shareLabel: `${from} → ${destinationCity || to}${detail ? ` · ${detail}` : ''}`,
    };
  }

  const from = String(order.pickupLabel || '').trim() || 'Pickup';
  const to = String(order.dropoffLabel || '').trim() || 'Drop-off';
  const routeLabel = String(order.routeLabel || '').trim();
  const hasReadableEndpoints = from !== 'Pickup' && to !== 'Drop-off';
  const shareLabel = hasReadableEndpoints
    ? `${from} → ${to}`
    : routeLabel && !isGenericLocalRouteLabel(routeLabel)
      ? routeLabel
      : `${from} to ${to}`;

  return {
    from,
    to,
    detail: routeLabel && !isGenericLocalRouteLabel(routeLabel) ? routeLabel : undefined,
    shareLabel,
  };
}
