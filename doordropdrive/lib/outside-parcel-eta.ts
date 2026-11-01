const OUTSIDE_BUS_ETA_SECONDS = 24 * 60 * 60;
const OUTSIDE_DAR_ZANZIBAR_AIR_ETA_SECONDS = 30 * 60;
const OUTSIDE_DEFAULT_EXPRESS_ETA_SECONDS = 2 * 60 * 60;

function isDarZanzibarAirRoute(origin?: string | null, destination?: string | null) {
  const normalize = (value?: string | null) => String(value || '').toLowerCase();
  const originLabel = normalize(origin);
  const destinationLabel = normalize(destination);
  const isDar = (label: string) => label.includes('dar');
  const isZanzibar = (label: string) => label.includes('zanzibar') || label.includes('znz');

  return (
    (isDar(originLabel) && isZanzibar(destinationLabel)) ||
    (isDar(destinationLabel) && isZanzibar(originLabel))
  );
}

export function getOutsideParcelDurationSecondsForOrder(order: {
  outsideOriginCity?: string | null;
  outsideDestinationCity?: string | null;
  outsideShippingMode?: string | null;
  durationSeconds?: number;
}) {
  if (typeof order.durationSeconds === 'number' && order.durationSeconds > 0) {
    return order.durationSeconds;
  }

  const shippingMode = String(order.outsideShippingMode || '').trim();
  if (shippingMode === 'standard') {
    return OUTSIDE_BUS_ETA_SECONDS;
  }

  if (shippingMode === 'express') {
    if (isDarZanzibarAirRoute(order.outsideOriginCity, order.outsideDestinationCity)) {
      return OUTSIDE_DAR_ZANZIBAR_AIR_ETA_SECONDS;
    }

    return OUTSIDE_DEFAULT_EXPRESS_ETA_SECONDS;
  }

  return OUTSIDE_BUS_ETA_SECONDS;
}
