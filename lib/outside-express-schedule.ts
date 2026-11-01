import type { OutsideDestinationCityKey } from '@/lib/outside-parcel';
import { isDarZanzibarAirExpressRoute } from '@/lib/outside-parcel-routes';
import { buildScheduleDays, toIsoDate, type ScheduleDayOption } from '@/lib/schedule-delivery';

export type OutsideExpressDeparture = {
  id: string;
  localTime: string;
  label?: string;
  daysOfWeek?: number[];
  active?: boolean;
};

export type OutsideExpressDateOverrideMode = 'custom' | 'cancelled';

export type OutsideExpressDateOverride = {
  departures: OutsideExpressDeparture[];
  mode?: OutsideExpressDateOverrideMode;
  active?: boolean;
  updatedAt?: unknown;
  updatedBy?: string;
};

export type OutsideExpressRouteSchedule = {
  id: string;
  originCityKey: OutsideDestinationCityKey;
  destinationCityKey: OutsideDestinationCityKey;
  label?: string;
  active?: boolean;
  bookingOpenDaysAhead?: number;
  bookingCloseMinutesBefore?: number;
  /** Minutes before departure when the parcel must be at the airport. */
  airportHandoffMinutesBefore?: number;
  /** Conservative pickup→office→airport estimate when live route timing is unavailable. */
  firstMileBufferMinutes?: number;
  arrivalOffsetMinutes?: number;
  departures: OutsideExpressDeparture[];
  /** Admin edits for specific calendar days (YYYY-MM-DD, East Africa Time). */
  dateOverrides?: Record<string, OutsideExpressDateOverride>;
  /** Set true only when admin explicitly saves flight times — blocks legacy/seed schedules in the customer app. */
  scheduleConfigured?: boolean;
};

export type BookableExpressDeparture = {
  routeId: string;
  departureId: string;
  isoDate: string;
  localTime: string;
  departureAtMs: number;
  bookingCutoffAtMs: number;
  airportHandoffAtMs: number;
  firstMileDeadlineAtMs: number;
  arrivalAtMs: number;
  dayLabel: string;
  timeLabel: string;
  hoursUntilDeparture: number;
  minutesUntilCutoff: number;
  minutesUntilAirportHandoff: number;
  pickupWindowMinutes: number;
  bookingClosesAtMs: number;
  scheduleSource: 'daily' | 'weekly';
  bookable: boolean;
  status: 'open' | 'closing' | 'closed';
};

export const DEFAULT_OFFICE_TO_AIRPORT_MINUTES = 45;
export const DEFAULT_FIRST_MILE_BUFFER_MINUTES = 90;
export const EXPRESS_CLOSING_SOON_MINUTES = 30;
export const EXPRESS_SCHEDULE_DISPLAY_DAYS = 7;
/** Non–Dar/Zanzibar routes: accept bookings until 1 hour before departure. */
export const EXPRESS_REGIONAL_BOOKING_CLOSE_MINUTES = 60;

const TZ_OFFSET = '+03:00';

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function buildOutsideExpressRouteId(
  originCityKey: string,
  destinationCityKey: string
): string {
  return `${String(originCityKey).trim()}__${String(destinationCityKey).trim()}`;
}

export function parseOutsideExpressRouteId(routeId: string) {
  const [originCityKey, destinationCityKey] = String(routeId || '').split('__');
  if (!originCityKey || !destinationCityKey) {
    return null;
  }
  return { originCityKey, destinationCityKey };
}

export function normalizeOutsideExpressDeparture(
  raw: Partial<OutsideExpressDeparture> & { id?: string },
  index = 0
): OutsideExpressDeparture | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const localTime = String(raw.localTime || '').trim();
  if (!/^\d{2}:\d{2}$/.test(localTime)) {
    return null;
  }

  const id = String(raw.id || `d${localTime.replace(':', '')}`).trim();
  if (!id) {
    return null;
  }

  const daysOfWeek = Array.isArray(raw.daysOfWeek)
    ? raw.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [0, 1, 2, 3, 4, 5, 6];

  return {
    id,
    localTime,
    label: String(raw.label || '').trim() || undefined,
    daysOfWeek,
    active: raw.active !== false,
  };
}

export function normalizeOutsideExpressRouteSchedule(
  raw: Partial<OutsideExpressRouteSchedule> & { id?: string },
  index = 0
): OutsideExpressRouteSchedule | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const parsed =
    raw.originCityKey && raw.destinationCityKey
      ? {
          originCityKey: raw.originCityKey,
          destinationCityKey: raw.destinationCityKey,
        }
      : parseOutsideExpressRouteId(String(raw.id || ''));

  if (!parsed) {
    return null;
  }

  const id = buildOutsideExpressRouteId(parsed.originCityKey, parsed.destinationCityKey);
  const departures = (Array.isArray(raw.departures) ? raw.departures : [])
    .map((item, departureIndex) => normalizeOutsideExpressDeparture(item, departureIndex))
    .filter(Boolean) as OutsideExpressDeparture[];

  const dateOverrides = normalizeOutsideExpressDateOverrides(raw.dateOverrides) ?? {};
  const hasOverrideFlights = Object.values(dateOverrides).some(
    (override) =>
      override &&
      override.mode !== 'cancelled' &&
      override.active !== false &&
      (override.departures?.length ?? 0) > 0
  );
  const scheduleConfigured =
    raw.scheduleConfigured === true || departures.length > 0 || hasOverrideFlights;

  return {
    id,
    originCityKey: parsed.originCityKey as OutsideDestinationCityKey,
    destinationCityKey: parsed.destinationCityKey as OutsideDestinationCityKey,
    label: String(raw.label || '').trim() || undefined,
    active: raw.active !== false,
    bookingOpenDaysAhead:
      typeof raw.bookingOpenDaysAhead === 'number' && raw.bookingOpenDaysAhead > 0
        ? Math.min(30, Math.round(raw.bookingOpenDaysAhead))
        : 14,
    bookingCloseMinutesBefore:
      typeof raw.bookingCloseMinutesBefore === 'number' && raw.bookingCloseMinutesBefore >= 0
        ? Math.round(raw.bookingCloseMinutesBefore)
        : 120,
    airportHandoffMinutesBefore:
      typeof raw.airportHandoffMinutesBefore === 'number' && raw.airportHandoffMinutesBefore >= 15
        ? Math.round(raw.airportHandoffMinutesBefore)
        : defaultAirportHandoffMinutes(parsed.originCityKey, parsed.destinationCityKey),
    firstMileBufferMinutes:
      typeof raw.firstMileBufferMinutes === 'number' && raw.firstMileBufferMinutes >= 15
        ? Math.round(raw.firstMileBufferMinutes)
        : defaultFirstMileBufferMinutes(parsed.originCityKey, parsed.destinationCityKey),
    arrivalOffsetMinutes:
      typeof raw.arrivalOffsetMinutes === 'number' && raw.arrivalOffsetMinutes > 0
        ? Math.round(raw.arrivalOffsetMinutes)
        : defaultArrivalOffsetMinutes(parsed.originCityKey, parsed.destinationCityKey),
    departures,
    dateOverrides: Object.keys(dateOverrides).length ? dateOverrides : undefined,
    scheduleConfigured,
  };
}

function normalizeOutsideExpressDateOverride(
  raw: Partial<OutsideExpressDateOverride> | null | undefined
): OutsideExpressDateOverride | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const mode = raw.mode === 'cancelled' ? 'cancelled' : raw.mode === 'custom' ? 'custom' : undefined;
  const departures = (Array.isArray(raw.departures) ? raw.departures : [])
    .map((item, index) => normalizeOutsideExpressDeparture(item, index))
    .filter(Boolean) as OutsideExpressDeparture[];

  if (mode === 'cancelled' || raw.active === false) {
    return {
      mode: 'cancelled',
      active: false,
      departures: [],
      updatedBy: String(raw.updatedBy || '').trim() || undefined,
    };
  }

  if (mode === 'custom' || departures.length) {
    return {
      mode: 'custom',
      active: true,
      departures,
      updatedBy: String(raw.updatedBy || '').trim() || undefined,
    };
  }

  return null;
}

function normalizeOutsideExpressDateOverrides(
  raw: OutsideExpressRouteSchedule['dateOverrides']
): Record<string, OutsideExpressDateOverride> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const entries = Object.entries(raw)
    .map(([isoDate, value]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        return null;
      }
      const normalized = normalizeOutsideExpressDateOverride(value);
      return normalized ? ([isoDate, normalized] as const) : null;
    })
    .filter(Boolean) as Array<readonly [string, OutsideExpressDateOverride]>;

  return entries.length ? Object.fromEntries(entries) : {};
}

export function getExpressDateOverrideMode(
  route: Pick<OutsideExpressRouteSchedule, 'dateOverrides'>,
  isoDate: string
): 'template' | 'custom' | 'cancelled' {
  const override = route.dateOverrides?.[isoDate];
  if (!override) {
    return 'template';
  }
  if (override.mode === 'cancelled' || override.active === false) {
    return 'cancelled';
  }
  if (override.mode === 'custom' || (override.departures?.length ?? 0) > 0) {
    return 'custom';
  }
  return 'template';
}

export function isAdminConfiguredExpressRoute(
  route:
    | Pick<OutsideExpressRouteSchedule, 'scheduleConfigured' | 'departures' | 'dateOverrides'>
    | null
    | undefined
) {
  if (!route) {
    return false;
  }
  if (route.scheduleConfigured === true) {
    return true;
  }
  return Object.values(route.dateOverrides || {}).some(
    (override) =>
      override &&
      override.mode !== 'cancelled' &&
      override.active !== false &&
      (override.departures?.length ?? 0) > 0
  );
}

export function sanitizeCustomerExpressRoute(
  raw: Partial<OutsideExpressRouteSchedule> & { id?: string },
  index = 0
): OutsideExpressRouteSchedule | null {
  const route = normalizeOutsideExpressRouteSchedule(raw, index);
  if (!route) {
    return null;
  }
  if (!isAdminConfiguredExpressRoute(route)) {
    return {
      ...route,
      departures: [],
      dateOverrides: {},
    };
  }
  return route;
}

export function resolveExpressDeparturesForDate(
  route: OutsideExpressRouteSchedule,
  isoDate: string
): OutsideExpressDeparture[] {
  if (!isAdminConfiguredExpressRoute(route)) {
    return [];
  }

  const override = route.dateOverrides?.[isoDate];
  if (!override) {
    // Admin publishes per calendar day only — never invent flights from a weekly template.
    return [];
  }
  if (override.mode === 'cancelled' || override.active === false) {
    return [];
  }

  return (override.departures ?? []).filter((departure) => departure.active !== false);
}

function defaultArrivalOffsetMinutes(originCityKey: string, destinationCityKey: string) {
  if (
    isDarZanzibarAirExpressRoute({
      originCityKey: originCityKey as OutsideDestinationCityKey,
      destinationCityKey: destinationCityKey as OutsideDestinationCityKey,
      shippingMode: 'express',
    })
  ) {
    return 30;
  }
  return 120;
}

function defaultAirportHandoffMinutes(originCityKey: string, destinationCityKey: string) {
  if (
    isDarZanzibarAirExpressRoute({
      originCityKey: originCityKey as OutsideDestinationCityKey,
      destinationCityKey: destinationCityKey as OutsideDestinationCityKey,
      shippingMode: 'express',
    })
  ) {
    return 60;
  }
  return 90;
}

function defaultFirstMileBufferMinutes(originCityKey: string, destinationCityKey: string) {
  if (
    isDarZanzibarAirExpressRoute({
      originCityKey: originCityKey as OutsideDestinationCityKey,
      destinationCityKey: destinationCityKey as OutsideDestinationCityKey,
      shippingMode: 'express',
    })
  ) {
    return 75;
  }
  return 90;
}

export function resolveExpressFirstMileMinutes(params: {
  routeDurationSeconds?: number | null;
  route?: Pick<OutsideExpressRouteSchedule, 'firstMileBufferMinutes' | 'originCityKey' | 'destinationCityKey'>;
  officeToAirportMinutes?: number;
}) {
  const officeMinutes = params.officeToAirportMinutes ?? DEFAULT_OFFICE_TO_AIRPORT_MINUTES;

  if (typeof params.routeDurationSeconds === 'number' && params.routeDurationSeconds > 0) {
    return Math.max(15, Math.ceil(params.routeDurationSeconds / 60) + officeMinutes);
  }

  if (typeof params.route?.firstMileBufferMinutes === 'number' && params.route.firstMileBufferMinutes > 0) {
    return params.route.firstMileBufferMinutes;
  }

  if (params.route?.originCityKey && params.route?.destinationCityKey) {
    return defaultFirstMileBufferMinutes(params.route.originCityKey, params.route.destinationCityKey);
  }

  return DEFAULT_FIRST_MILE_BUFFER_MINUTES;
}

export function resolveExpressAirportHandoffAtMs(
  departureAtMs: number,
  route: Pick<OutsideExpressRouteSchedule, 'airportHandoffMinutesBefore' | 'originCityKey' | 'destinationCityKey'>
) {
  const handoffMinutes =
    route.airportHandoffMinutesBefore ??
    defaultAirportHandoffMinutes(route.originCityKey, route.destinationCityKey);
  return departureAtMs - handoffMinutes * 60 * 1000;
}

export function getExpressTodayIso(nowMs = Date.now()) {
  const now = new Date(nowMs + 3 * 60 * 60 * 1000);
  return `${pad2(now.getUTCFullYear())}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

export function isDarZanzibarExpressRouteSchedule(
  route: Pick<OutsideExpressRouteSchedule, 'originCityKey' | 'destinationCityKey'>
) {
  return isDarZanzibarAirExpressRoute({
    originCityKey: route.originCityKey,
    destinationCityKey: route.destinationCityKey,
    shippingMode: 'express',
  });
}

export function pickExpressNextDayFallbackSlot(
  slots: BookableExpressDeparture[],
  nowMs = Date.now()
): BookableExpressDeparture | null {
  const todayIso = getExpressTodayIso(nowMs);
  const todaySlots = slots.filter((slot) => slot.isoDate === todayIso);
  const todayHasOpen = todaySlots.some((slot) => slot.bookable);
  if (todayHasOpen) {
    return null;
  }

  // Today empty, cancelled, or all booking windows closed → offer the next open day.
  return slots.find((slot) => slot.isoDate > todayIso && slot.bookable) ?? null;
}

export function resolveExpressRequiredLeadMinutes(
  route: OutsideExpressRouteSchedule,
  firstMileMinutes?: number
) {
  if (!isDarZanzibarExpressRouteSchedule(route)) {
    return EXPRESS_REGIONAL_BOOKING_CLOSE_MINUTES;
  }

  const handoffMinutes =
    route.airportHandoffMinutesBefore ??
    defaultAirportHandoffMinutes(route.originCityKey, route.destinationCityKey);
  const resolvedFirstMileMinutes =
    typeof firstMileMinutes === 'number' && firstMileMinutes > 0
      ? firstMileMinutes
      : resolveExpressFirstMileMinutes({ route });
  const policyLeadMinutes = route.bookingCloseMinutesBefore ?? 120;
  return Math.max(handoffMinutes + resolvedFirstMileMinutes, policyLeadMinutes);
}

export function assertExpressDepartureBookable(params: {
  route: OutsideExpressRouteSchedule;
  departureAtMs: number;
  bookingCutoffAtMs?: number;
  airportHandoffAtMs?: number;
  firstMileDeadlineAtMs?: number;
  nowMs?: number;
  firstMileMinutes?: number;
  language?: 'sw' | 'en';
}) {
  if (!params?.route) {
    return;
  }

  const language = params.language === 'sw' ? 'sw' : 'en';
  const nowMs = params.nowMs ?? Date.now();
  const resolvedFirstMileMinutes =
    typeof params.firstMileMinutes === 'number' && params.firstMileMinutes > 0
      ? params.firstMileMinutes
      : resolveExpressFirstMileMinutes({ route: params.route });
  const requiredLeadMinutes = resolveExpressRequiredLeadMinutes(params.route, resolvedFirstMileMinutes);
  const firstMileDeadlineAtMs = params.firstMileDeadlineAtMs ?? params.departureAtMs - requiredLeadMinutes * 60 * 1000;
  const effectiveCutoffAtMs = firstMileDeadlineAtMs;

  if (nowMs >= effectiveCutoffAtMs) {
    throw new Error(
      isDarZanzibarExpressRouteSchedule(params.route)
        ? language === 'sw'
          ? 'Hakuna muda wa kutosha kuchukua mzigo na kuupeleka uwanjani kabla ya ndege hii kuondoka. Chagua ndege ya baadaye.'
          : 'Not enough time to collect your parcel and deliver it to the airport before this flight. Choose a later departure.'
        : language === 'sw'
          ? 'Booking ya ndege hii imefungwa — tunachukua oda hadi saa 1 kabla ya ndege kuondoka.'
          : 'Booking for this flight is closed — we take orders up to 1 hour before departure.'
    );
  }
}

export function departureAtMs(isoDate: string, localTime: string) {
  const [hourText, minuteText = '00'] = localTime.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  return Date.parse(`${isoDate}T${pad2(hour)}:${pad2(minute)}:00${TZ_OFFSET}`);
}

export function formatExpressClockLabel(localTime: string, language: 'sw' | 'en') {
  const [hourText, minuteText = '00'] = localTime.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour)) {
    return localTime;
  }

  if (language === 'sw') {
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad2(minute)} ${suffix}`;
}

function resolveDayLabel(isoDate: string, language: 'sw' | 'en', days: ScheduleDayOption[]) {
  const match = days.find((day) => day.isoDate === isoDate);
  if (match) {
    return match.label;
  }

  const date = new Date(`${isoDate}T00:00:00${TZ_OFFSET}`);
  return date.toLocaleDateString(language === 'sw' ? 'sw-TZ' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function mergeExpressRouteSchedule(
  remote: OutsideExpressRouteSchedule | null | undefined,
  routeId: string
): OutsideExpressRouteSchedule | null {
  const remoteRoute = remote ? normalizeOutsideExpressRouteSchedule(remote) : null;
  if (remoteRoute && remoteRoute.id === routeId) {
    return remoteRoute;
  }
  if (remoteRoute) {
    return remoteRoute;
  }
  return null;
}

export function findOutsideExpressRouteSchedule(
  routes: OutsideExpressRouteSchedule[],
  originCityKey: string,
  destinationCityKey: string
) {
  const routeId = buildOutsideExpressRouteId(originCityKey, destinationCityKey);
  const remote = routes.find((route) => route.id === routeId && route.active !== false) ?? null;
  if (!remote || !isAdminConfiguredExpressRoute(remote)) {
    return null;
  }
  return remote;
}

export function hasScheduledExpressDepartures(params: {
  route: OutsideExpressRouteSchedule | null | undefined;
  language?: 'sw' | 'en';
  nowMs?: number;
  daysAhead?: number;
}) {
  if (!params.route) {
    return false;
  }

  return getBookableExpressDepartures(params).length > 0;
}

export function hasBookableExpressDepartures(params: {
  route: OutsideExpressRouteSchedule | null | undefined;
  language?: 'sw' | 'en';
  nowMs?: number;
  firstMileMinutes?: number;
}) {
  if (!params.route) {
    return false;
  }

  return getBookableExpressDepartures(params).some((slot) => slot.bookable);
}

export function getBookableExpressDepartures(params: {
  route: OutsideExpressRouteSchedule;
  language?: 'sw' | 'en';
  nowMs?: number;
  daysAhead?: number;
  firstMileMinutes?: number;
}): BookableExpressDeparture[] {
  if (!params?.route) {
    return [];
  }

  const language = params.language === 'sw' ? 'sw' : 'en';
  const nowMs = params.nowMs ?? Date.now();
  const daysAhead = params.daysAhead ?? params.route.bookingOpenDaysAhead ?? EXPRESS_SCHEDULE_DISPLAY_DAYS;
  const arrivalOffsetMinutes = params.route.arrivalOffsetMinutes ?? 120;
  const resolvedFirstMileMinutes =
    typeof params.firstMileMinutes === 'number' && params.firstMileMinutes > 0
      ? params.firstMileMinutes
      : resolveExpressFirstMileMinutes({ route: params.route });
  const scheduleDays = buildScheduleDays(language, daysAhead + 1);
  const results: BookableExpressDeparture[] = [];

  scheduleDays.slice(0, daysAhead + 1).forEach((day) => {
    const departuresForDay = resolveExpressDeparturesForDate(params.route, day.isoDate);
    if (!departuresForDay.length) {
      return;
    }

    departuresForDay.forEach((departure) => {
      const departureAt = departureAtMs(day.isoDate, departure.localTime);
      if (departureAt <= 0) {
        return;
      }

      const requiredLeadMinutes = resolveExpressRequiredLeadMinutes(params.route, resolvedFirstMileMinutes);
      const airportHandoffAtMs = resolveExpressAirportHandoffAtMs(departureAt, params.route);
      const firstMileDeadlineAtMs = departureAt - requiredLeadMinutes * 60 * 1000;
      const effectiveCutoffAtMs = firstMileDeadlineAtMs;
      const arrivalAtMs = departureAt + arrivalOffsetMinutes * 60 * 1000;
      const minutesUntilCutoff = Math.round((effectiveCutoffAtMs - nowMs) / 60000);
      const minutesUntilAirportHandoff = Math.round((airportHandoffAtMs - nowMs) / 60000);
      const pickupWindowMinutes = Math.max(0, minutesUntilAirportHandoff);
      const hoursUntilDeparture = Math.max(0, Math.round((departureAt - nowMs) / 3600000));
      const bookable = nowMs < effectiveCutoffAtMs;
      const status: BookableExpressDeparture['status'] = !bookable
        ? 'closed'
        : minutesUntilCutoff <= EXPRESS_CLOSING_SOON_MINUTES
          ? 'closing'
          : 'open';
      const scheduleSource = 'daily' as const;

      results.push({
        routeId: params.route.id,
        departureId: `${departure.id}__${day.isoDate}`,
        isoDate: day.isoDate,
        localTime: departure.localTime,
        departureAtMs: departureAt,
        bookingCutoffAtMs: effectiveCutoffAtMs,
        airportHandoffAtMs,
        firstMileDeadlineAtMs,
        arrivalAtMs,
        dayLabel: resolveDayLabel(day.isoDate, language, scheduleDays),
        timeLabel: formatExpressClockLabel(departure.localTime, language),
        hoursUntilDeparture,
        minutesUntilCutoff,
        minutesUntilAirportHandoff,
        pickupWindowMinutes,
        bookingClosesAtMs: effectiveCutoffAtMs,
        scheduleSource,
        bookable,
        status,
      });
    });
  });

  return results
    .filter((slot) => slot.departureAtMs >= nowMs - 60 * 60 * 1000)
    .sort((left, right) => left.departureAtMs - right.departureAtMs);
}

export function formatExpressBookingCountdown(
  remainingMs: number,
  language: 'sw' | 'en' = 'en',
  closesAtMs?: number
) {
  if (typeof closesAtMs === 'number' && closesAtMs > 0) {
    const closeDate = new Date(closesAtMs + 3 * 60 * 60 * 1000);
    const hour = closeDate.getUTCHours();
    const minute = closeDate.getUTCMinutes();
    const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (remainingMs <= 0) {
      return language === 'sw' ? `Booking ilifungwa saa ${clock}` : `Booking closed at ${clock}`;
    }
    if (language === 'sw') {
      return `Booking inafunga saa ${clock}`;
    }
    return `Booking closes at ${clock}`;
  }

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;

  if (language === 'sw') {
    return hours > 0 ? `Inafunga ndani ya masaa ${hours}` : `Inafunga ndani ya dakika ${minutes || 1}`;
  }

  return hours > 0 ? `Closes in ${hours} hr` : `Closes in ${minutes || 1} min`;
}

export function formatExpressDepartureSummary(
  slot: Pick<BookableExpressDeparture, 'dayLabel' | 'timeLabel' | 'hoursUntilDeparture' | 'minutesUntilCutoff' | 'status'>,
  language: 'sw' | 'en'
) {
  if (language === 'sw') {
    if (slot.status === 'closed') {
      return `${slot.dayLabel} • ${slot.timeLabel} • Imefungwa`;
    }
    if (slot.hoursUntilDeparture >= 24) {
      const days = Math.ceil(slot.hoursUntilDeparture / 24);
      return `${slot.dayLabel} • ${slot.timeLabel} • Ndege ndani ya siku ${days}`;
    }
    if (slot.hoursUntilDeparture >= 1) {
      return `${slot.dayLabel} • ${slot.timeLabel} • Ndege ndani ya masaa ${slot.hoursUntilDeparture}`;
    }
    return `${slot.dayLabel} • ${slot.timeLabel} • Ndege hivi karibuni`;
  }

  if (slot.status === 'closed') {
    return `${slot.dayLabel} • ${slot.timeLabel} • Booking closed`;
  }
  if (slot.hoursUntilDeparture >= 24) {
    const days = Math.ceil(slot.hoursUntilDeparture / 24);
    return `${slot.dayLabel} • ${slot.timeLabel} • Departs in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (slot.hoursUntilDeparture >= 1) {
    return `${slot.dayLabel} • ${slot.timeLabel} • Departs in ${slot.hoursUntilDeparture} hr`;
  }
  return `${slot.dayLabel} • ${slot.timeLabel} • Departing soon`;
}

export function formatExpressFlightEtaLabel(params: {
  departureAtMs: number;
  arrivalOffsetMinutes: number;
  language?: 'sw' | 'en';
  nowMs?: number;
}) {
  const language = params.language === 'sw' ? 'sw' : 'en';
  const nowMs = params.nowMs ?? Date.now();
  const hoursUntil = Math.max(0, Math.round((params.departureAtMs - nowMs) / 3600000));

  if (language === 'sw') {
    return hoursUntil >= 24
      ? `Ndege ndani ya siku ${Math.ceil(hoursUntil / 24)} • utoaji ~${params.arrivalOffsetMinutes} dk baada ya kuondoka`
      : hoursUntil >= 1
        ? `Ndege ndani ya masaa ${hoursUntil} • utoaji ~${params.arrivalOffsetMinutes} dk baada ya kuondoka`
        : `Ndege hivi karibuni • utoaji ~${params.arrivalOffsetMinutes} dk baada ya kuondoka`;
  }

  return hoursUntil >= 24
    ? `Flight in ${Math.ceil(hoursUntil / 24)} day${Math.ceil(hoursUntil / 24) === 1 ? '' : 's'} • delivery ~${params.arrivalOffsetMinutes} min after departure`
    : hoursUntil >= 1
      ? `Flight in ${hoursUntil} hr • delivery ~${params.arrivalOffsetMinutes} min after departure`
      : `Flight departing soon • delivery ~${params.arrivalOffsetMinutes} min after departure`;
}

export const DEFAULT_OUTSIDE_EXPRESS_ROUTE_SEED: OutsideExpressRouteSchedule[] = [];
