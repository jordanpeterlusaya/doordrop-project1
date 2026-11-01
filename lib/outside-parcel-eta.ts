import {
  findOutsideCityByLabel,
  getNearestOutsideCity,
  type OutsideDestinationCityKey,
  type OutsideShippingMode,
} from '@/lib/outside-parcel';
import { isDarZanzibarAirExpressRoute } from '@/lib/outside-parcel-routes';

export const OUTSIDE_BUS_ETA_SECONDS = 24 * 60 * 60;
export const OUTSIDE_DAR_ZANZIBAR_AIR_ETA_SECONDS = 30 * 60;
export const OUTSIDE_DEFAULT_EXPRESS_ETA_SECONDS = 2 * 60 * 60;

export function getOutsideParcelDurationSeconds(params: {
  originCityKey?: OutsideDestinationCityKey | null;
  destinationCityKey?: OutsideDestinationCityKey | null;
  shippingMode?: OutsideShippingMode | null;
}) {
  const { originCityKey, destinationCityKey, shippingMode } = params;

  if (shippingMode === 'standard') {
    return OUTSIDE_BUS_ETA_SECONDS;
  }

  if (shippingMode === 'express') {
    if (
      originCityKey &&
      destinationCityKey &&
      isDarZanzibarAirExpressRoute({
        originCityKey,
        destinationCityKey,
        shippingMode: 'express',
      })
    ) {
      return OUTSIDE_DAR_ZANZIBAR_AIR_ETA_SECONDS;
    }

    return OUTSIDE_DEFAULT_EXPRESS_ETA_SECONDS;
  }

  return OUTSIDE_BUS_ETA_SECONDS;
}

export function formatOutsideParcelEtaLabel(params: {
  originCityKey?: OutsideDestinationCityKey | null;
  destinationCityKey?: OutsideDestinationCityKey | null;
  shippingMode?: OutsideShippingMode | null;
  language?: 'sw' | 'en';
}) {
  const language = params.language === 'sw' ? 'sw' : 'en';
  const seconds = getOutsideParcelDurationSeconds(params);

  if (params.shippingMode === 'standard') {
    return language === 'sw' ? 'Masaa 24 baada ya kuchukuliwa' : '24 hrs after pickup';
  }

  if (
    params.shippingMode === 'express' &&
    params.originCityKey &&
    params.destinationCityKey &&
    isDarZanzibarAirExpressRoute({
      originCityKey: params.originCityKey,
      destinationCityKey: params.destinationCityKey,
      shippingMode: 'express',
    })
  ) {
    return language === 'sw' ? 'Dakika 30 baada ya kuchukuliwa' : '30 min after pickup';
  }

  if (params.shippingMode === 'express') {
    return language === 'sw' ? '~masaa 2 baada ya kuchukuliwa' : '~2 hrs after pickup';
  }

  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600);
    return language === 'sw' ? `Masaa ${hours} baada ya kuchukuliwa` : `${hours} hrs after pickup`;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  return language === 'sw' ? `Dakika ${minutes} baada ya kuchukuliwa` : `${minutes} min after pickup`;
}

export function resolveOutsideCityKeysFromOrder(order: {
  outsideOriginCity?: string | null;
  outsideDestinationCity?: string | null;
  pickupLatitude?: number;
  pickupLongitude?: number;
}) {
  const destinationCity = findOutsideCityByLabel(order.outsideDestinationCity);
  const originCity =
    findOutsideCityByLabel(order.outsideOriginCity) ??
    (typeof order.pickupLatitude === 'number' && typeof order.pickupLongitude === 'number'
      ? getNearestOutsideCity({ latitude: order.pickupLatitude, longitude: order.pickupLongitude })
      : findOutsideCityByLabel('Dar es Salaam'));

  return {
    originCityKey: (originCity?.key ?? 'dar-es-salaam') as OutsideDestinationCityKey,
    destinationCityKey: (destinationCity?.key ?? null) as OutsideDestinationCityKey | null,
  };
}

export function getOutsideParcelDurationSecondsForOrder(order: {
  outsideOriginCity?: string | null;
  outsideDestinationCity?: string | null;
  outsideShippingMode?: string | null;
  pickupLatitude?: number;
  pickupLongitude?: number;
  durationSeconds?: number;
}) {
  if (typeof order.durationSeconds === 'number' && order.durationSeconds > 0) {
    return order.durationSeconds;
  }

  const { originCityKey, destinationCityKey } = resolveOutsideCityKeysFromOrder(order);
  const shippingMode = String(order.outsideShippingMode || '').trim() as OutsideShippingMode;

  return getOutsideParcelDurationSeconds({
    originCityKey,
    destinationCityKey,
    shippingMode: shippingMode === 'express' || shippingMode === 'standard' ? shippingMode : null,
  });
}

export function resolveTimestampMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function resolveOutsideDeliveryDeadlineMs(order: {
  outsidePickupAt?: unknown;
  outsideEtaDeadlineAt?: unknown;
  durationSeconds?: number;
  outsideOriginCity?: string | null;
  outsideDestinationCity?: string | null;
  outsideShippingMode?: string | null;
  pickupLatitude?: number;
  pickupLongitude?: number;
}) {
  const explicitDeadline = resolveTimestampMillis(order.outsideEtaDeadlineAt);
  if (explicitDeadline > 0) {
    return explicitDeadline;
  }

  const pickupAt = resolveTimestampMillis(order.outsidePickupAt);
  if (pickupAt <= 0) {
    return null;
  }

  const durationSeconds = getOutsideParcelDurationSecondsForOrder(order);
  return pickupAt + durationSeconds * 1000;
}

export type OutsideTrackingCountdownPlan = {
  kind: 'live';
  deadlineMs: number;
  startedAtMs: number;
};

/** Resolve persisted outside-parcel countdown for track screen. */
export function resolveOutsideTrackingCountdownPlan(order: {
  id?: string;
  status?: string | null;
  logisticsStatus?: string | null;
  outsidePickupAt?: unknown;
  outsideCountdownStartedAt?: unknown;
  outsideExpressDepartureAt?: unknown;
  outsideEtaDeadlineAt?: unknown;
  durationSeconds?: number;
  outsideOriginCity?: string | null;
  outsideDestinationCity?: string | null;
  outsideShippingMode?: string | null;
  pickupLatitude?: number;
  pickupLongitude?: number;
} | null | undefined): OutsideTrackingCountdownPlan | null {
  if (!order?.id) {
    return null;
  }

  if (String(order.logisticsStatus || '') === 'completed' || order.status === 'delivered' || order.status === 'cancelled') {
    return null;
  }

  const durationSeconds = getOutsideParcelDurationSecondsForOrder(order);
  if (durationSeconds <= 0) {
    return null;
  }

  const explicitDeadline = resolveTimestampMillis(order.outsideEtaDeadlineAt);
  if (explicitDeadline <= 0) {
    return null;
  }

  const flightDepartureAt = resolveTimestampMillis(order.outsideExpressDepartureAt);
  const countdownStartedAt = resolveTimestampMillis(order.outsideCountdownStartedAt);
  const pickupAt = resolveTimestampMillis(order.outsidePickupAt);
  const startedAtMs =
    flightDepartureAt > 0
      ? countdownStartedAt > 0
        ? countdownStartedAt
        : Math.min(Date.now(), flightDepartureAt)
      : countdownStartedAt > 0
        ? countdownStartedAt
        : pickupAt > 0
          ? pickupAt
          : explicitDeadline - durationSeconds * 1000;

  return {
    kind: 'live',
    deadlineMs: explicitDeadline,
    startedAtMs,
  };
}

export type EtaCountdownParts = {
  totalMs: number;
  remainingMs: number;
  elapsedMs: number;
  progress: number;
  isComplete: boolean;
  isOverdue: boolean;
  display: string;
  compactDisplay: string;
};

export function buildEtaCountdownParts(deadlineMs: number, nowMs = Date.now(), startedAtMs?: number | null): EtaCountdownParts {
  const remainingMs = Math.max(0, deadlineMs - nowMs);
  const startedAt = startedAtMs && startedAtMs > 0 ? startedAtMs : deadlineMs - remainingMs;
  const totalMs = Math.max(1, deadlineMs - startedAt);
  const elapsedMs = Math.min(totalMs, Math.max(0, nowMs - startedAt));
  const progress = Math.min(1, elapsedMs / totalMs);
  const isComplete = remainingMs <= 0;
  const isOverdue = nowMs > deadlineMs;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (value: number) => String(value).padStart(2, '0');

  let display = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  let compactDisplay = display;

  if (days > 0) {
    display = `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    compactDisplay = `${days}d ${hours}h`;
  } else if (totalMs >= 3600 * 1000) {
    compactDisplay = `${hours}h ${minutes}m`;
  } else if (totalMs >= 60 * 1000) {
    compactDisplay = `${minutes}m ${seconds}s`;
  } else {
    compactDisplay = `${Math.max(totalSeconds, 0)}s`;
  }

  return {
    totalMs,
    remainingMs,
    elapsedMs,
    progress,
    isComplete,
    isOverdue,
    display,
    compactDisplay,
  };
}
