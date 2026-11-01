export type DriverAccessVehicleType = 'bodaboda' | 'toyo' | 'kirikuu' | 'canter';
export type DriverAccessPeriod = 'day' | 'week';

export type DriverAccessPlan = {
  vehicleType: DriverAccessVehicleType;
  label: string;
  feeTzs: number;
  durationHours: number;
  durationDays: number;
  minOrders: number;
  period: DriverAccessPeriod;
  periodLabel: DriverAccessPeriod;
};

export type DriverAccessPlanState = DriverAccessPlan & {
  completedOrders: number;
  remainingOrders: number;
  grace: boolean;
  paid: boolean;
  canPay: boolean;
  paymentRequired: boolean;
  workWindow: boolean;
  billingPeriodKey: string;
  unpaidDebt: boolean;
};

const TEST_ACCESS_FEE_TZS = Number(process.env.EXPO_PUBLIC_DRIVER_ACCESS_TEST_FEE_TZS || '0');

function resolveAccessFee(standardFee: number) {
  return Number.isFinite(TEST_ACCESS_FEE_TZS) && TEST_ACCESS_FEE_TZS > 0 ? TEST_ACCESS_FEE_TZS : standardFee;
}

const ACCESS_PLANS: Record<DriverAccessVehicleType, DriverAccessPlan> = {
  bodaboda: {
    vehicleType: 'bodaboda',
    label: 'Bodaboda',
    feeTzs: resolveAccessFee(3500),
    durationHours: 24,
    durationDays: 1,
    minOrders: 4,
    period: 'day',
    periodLabel: 'day',
  },
  toyo: {
    vehicleType: 'toyo',
    label: 'TOYO',
    feeTzs: resolveAccessFee(25000),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
  kirikuu: {
    vehicleType: 'kirikuu',
    label: 'Kirikuu',
    feeTzs: resolveAccessFee(25000),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
  canter: {
    vehicleType: 'canter',
    label: 'Canter',
    feeTzs: resolveAccessFee(25000),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'object' && value && Number.isFinite((value as { _seconds?: number })._seconds)) {
    return Number((value as { _seconds: number })._seconds) * 1000;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeDriverAccessVehicleType(vehicleType?: string | null): DriverAccessVehicleType {
  const normalized = String(vehicleType || '').trim().toLowerCase();
  const aliases: Record<string, DriverAccessVehicleType> = {
    bodaboda: 'toyo',
    boda: 'toyo',
    pikipiki: 'toyo',
    motorcycle: 'toyo',
    motorbike: 'toyo',
    bike: 'toyo',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    truck: 'toyo',
    kirikuu: 'kirikuu',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  };

  return aliases[normalized] || 'toyo';
}

const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_SETTLEMENT_HOUR_EAT = 4;
/** @deprecated Use ACCESS_SETTLEMENT_HOUR_EAT */
const BODABODA_SETTLEMENT_HOUR_EAT = ACCESS_SETTLEMENT_HOUR_EAT;

export function getTanzaniaDateKey(value = Date.now()) {
  const date = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return date.toISOString().slice(0, 10);
}

export function getTanzaniaHour(value = Date.now()) {
  return new Date(value + TANZANIA_UTC_OFFSET_MS).getUTCHours();
}

export function isBodabodaSettlementOpen(value = Date.now()) {
  return isDailySettlementOpen(value);
}

export function isDailySettlementOpen(value = Date.now()) {
  const dayStart = getTanzaniaDayStartMillis(value);
  const settlementAt = dayStart + ACCESS_SETTLEMENT_HOUR_EAT * 60 * 60 * 1000;
  return value >= settlementAt;
}

/** Weekly plans settle at 4 AM EAT when the current billing week ends (Sunday 4 AM). */
export function isWeeklySettlementOpen(value = Date.now()) {
  const periodStart = getTanzaniaWeekPeriodStartMillis(value);
  const settlementAt = periodStart + 7 * DAY_MS;
  return value >= settlementAt;
}

export function isAccessSettlementOpen(plan: Pick<DriverAccessPlan, 'period'>, value = Date.now()) {
  return plan.period === 'week' ? isWeeklySettlementOpen(value) : isDailySettlementOpen(value);
}

export function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - TANZANIA_UTC_OFFSET_MS;
}

export function getTanzaniaDayEndMillis(value = Date.now()) {
  return getTanzaniaDayStartMillis(value) + DAY_MS;
}

export function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * DAY_MS;
}

/** Weekly billing periods run Sunday 4 AM EAT to the following Sunday 4 AM EAT. */
export function getTanzaniaWeekPeriodStartMillis(value = Date.now()) {
  const weekStart = getTanzaniaWeekStartMillis(value);
  const thisWeekSettlement = weekStart + ACCESS_SETTLEMENT_HOUR_EAT * 60 * 60 * 1000;
  if (value >= thisWeekSettlement) {
    return thisWeekSettlement;
  }

  return thisWeekSettlement - 7 * DAY_MS;
}

export function getTanzaniaWeekEndMillis(value = Date.now()) {
  return getTanzaniaWeekPeriodStartMillis(value) + 7 * DAY_MS;
}

export function getAccessPaidUntilMillis(
  plan: Pick<DriverAccessPlan, 'period'>,
  now = Date.now()
) {
  return plan.period === 'week' ? getTanzaniaWeekEndMillis(now) : getTanzaniaDayEndMillis(now);
}

export function getAccessPeriodStartMillis(
  plan: Pick<DriverAccessPlan, 'period'>,
  now = Date.now()
) {
  return plan.period === 'week' ? getTanzaniaWeekPeriodStartMillis(now) : getTanzaniaDayStartMillis(now);
}

export function getPreviousAccessBillingPeriodKey(
  plan: Pick<DriverAccessPlan, 'period'>,
  now = Date.now()
) {
  const currentStart = getAccessPeriodStartMillis(plan, now);
  return getAccessBillingPeriodKey(plan, currentStart - 1);
}

export function getAccessBillingPeriodKey(
  plan: Pick<DriverAccessPlan, 'period'>,
  now = Date.now()
) {
  const periodStart = getAccessPeriodStartMillis(plan, now);
  return plan.period === 'week'
    ? `week:${getTanzaniaDateKey(periodStart)}`
    : `day:${getTanzaniaDateKey(periodStart)}`;
}

export function getCurrentAccessChargeTzs(plan: Pick<DriverAccessPlan, 'feeTzs'>) {
  return Number(plan.feeTzs || 0);
}

export function resolveAccessPaidUntilMillis(
  plan: Pick<DriverAccessPlan, 'period'>,
  now = Date.now(),
  currentPaidUntil = 0
) {
  if (currentPaidUntil > now) {
    return currentPaidUntil;
  }

  return getAccessPaidUntilMillis(plan, now);
}

export function getDriverAccessPlan(driver?: { vehicleType?: string | null; vehicleLabel?: string | null } | null): DriverAccessPlan {
  const vehicleType = normalizeDriverAccessVehicleType(driver?.vehicleType || driver?.vehicleLabel);
  return ACCESS_PLANS[vehicleType];
}

export function getDriverCompletedOrderCount(
  driver?: {
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
    weeklyCompletedOrderCount?: number | null;
    weeklyCompletedWeekKey?: string | null;
    vehicleType?: string | null;
    vehicleLabel?: string | null;
  } | null,
  fallbackCount = 0,
  now = Date.now()
) {
  const plan = getDriverAccessPlan(driver);

  if (plan.period === 'week') {
    const weekKey = getAccessBillingPeriodKey(plan, now);
    if (String(driver?.weeklyCompletedWeekKey || '') === weekKey) {
      const weekly = Number(driver?.weeklyCompletedOrderCount ?? fallbackCount ?? 0);
      return Number.isFinite(weekly) && weekly > 0 ? Math.floor(weekly) : 0;
    }
    return Math.max(0, Math.floor(Number(fallbackCount || 0)));
  }

  const todayKey = getTanzaniaDateKey(now);
  if (String(driver?.dailyCompletedDateKey || '') === todayKey) {
    const daily = Number(driver?.dailyCompletedOrderCount ?? fallbackCount ?? 0);
    return Number.isFinite(daily) && daily > 0 ? Math.floor(daily) : 0;
  }

  return 0;
}

export function isDriverSubscriptionPaid(driver?: { subscriptionPaidUntil?: unknown } | null, now = Date.now()) {
  return toMillis(driver?.subscriptionPaidUntil) > now;
}

export function hasQualifiedForAccessCharge(
  driver?: {
    vehicleType?: string | null;
    vehicleLabel?: string | null;
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
  } | null,
  now = Date.now(),
  fallbackCompletedCount = 0
) {
  const plan = getDriverAccessPlan(driver);
  return getDriverCompletedOrderCount(driver, fallbackCompletedCount, now) >= plan.minOrders;
}

export function hasUnpaidAccessDebt(
  driver?: { subscriptionPaidUntil?: unknown; accessPaymentDuePeriodKey?: string | null } | null,
  now = Date.now()
) {
  const dueKey = String(driver?.accessPaymentDuePeriodKey || '').trim();
  if (!dueKey) {
    return false;
  }

  return !isDriverSubscriptionPaid(driver, now);
}

export function resolveAccessPaymentDuePatch(
  driver?: {
    vehicleType?: string | null;
    vehicleLabel?: string | null;
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
    weeklyCompletedOrderCount?: number | null;
    weeklyCompletedWeekKey?: string | null;
    subscriptionPaidUntil?: unknown;
    accessPaymentDuePeriodKey?: string | null;
  } | null,
  now = Date.now(),
  fallbackCompletedCount = 0
) {
  const plan = getDriverAccessPlan(driver);
  const planState = buildAccessPlanState(driver, now, fallbackCompletedCount);
  if (planState.paid || planState.unpaidDebt) {
    return null;
  }

  const billingPeriodKey = getAccessBillingPeriodKey(plan, now);
  const currentDue = String(driver?.accessPaymentDuePeriodKey || '').trim();

  if (planState.paymentRequired) {
    if (currentDue === billingPeriodKey) {
      return null;
    }

    return { accessPaymentDuePeriodKey: billingPeriodKey };
  }

  if (plan.period === 'week') {
    const previousPeriodKey = getPreviousAccessBillingPeriodKey(plan, now);
    if (previousPeriodKey !== billingPeriodKey && String(driver?.weeklyCompletedWeekKey || '') === previousPeriodKey) {
      const previousCount = Number(driver?.weeklyCompletedOrderCount || 0);
      if (previousCount >= plan.minOrders) {
        if (currentDue === previousPeriodKey) {
          return null;
        }

        return { accessPaymentDuePeriodKey: previousPeriodKey };
      }
    }
  }

  return null;
}

export function isDriverInAccessGrace(
  driver?: {
    vehicleType?: string | null;
    vehicleLabel?: string | null;
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
    accessPaymentDuePeriodKey?: string | null;
    subscriptionPaidUntil?: unknown;
  } | null,
  now = Date.now(),
  fallbackCompletedCount = 0
) {
  if (hasUnpaidAccessDebt(driver, now)) {
    return false;
  }

  const plan = getDriverAccessPlan(driver);
  if (getDriverCompletedOrderCount(driver, fallbackCompletedCount, now) < plan.minOrders) {
    return true;
  }

  return !isAccessSettlementOpen(plan, now);
}

export function isDriverSubscriptionActive(
  driver?: {
    vehicleType?: string | null;
    vehicleLabel?: string | null;
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
    subscriptionPaidUntil?: unknown;
  } | null,
  now = Date.now(),
  fallbackCompletedCount = 0
) {
  if (!driver) {
    return false;
  }

  return isDriverInAccessGrace(driver, now, fallbackCompletedCount) || isDriverSubscriptionPaid(driver, now);
}

export function buildAccessPlanState(
  driver?: {
    vehicleType?: string | null;
    vehicleLabel?: string | null;
    completedOrderCount?: number | null;
    dailyCompletedOrderCount?: number | null;
    dailyCompletedDateKey?: string | null;
    subscriptionPaidUntil?: unknown;
    accessPaymentDuePeriodKey?: string | null;
  } | null,
  now = Date.now(),
  fallbackCompletedCount = 0
): DriverAccessPlanState {
  const plan = getDriverAccessPlan(driver);
  const completedOrders = getDriverCompletedOrderCount(driver, fallbackCompletedCount, now);
  const remainingOrders = Math.max(0, plan.minOrders - completedOrders);
  const paid = isDriverSubscriptionPaid(driver, now);
  const qualified = completedOrders >= plan.minOrders;
  const workWindow = !isAccessSettlementOpen(plan, now);
  const grace = !hasUnpaidAccessDebt(driver, now) && (!qualified || workWindow);
  const unpaidDebt = hasUnpaidAccessDebt(driver, now);

  return {
    ...plan,
    completedOrders,
    remainingOrders,
    grace,
    paid,
    workWindow,
    canPay: (unpaidDebt || (qualified && !workWindow)) && !paid,
    paymentRequired: unpaidDebt || (qualified && !paid && !workWindow),
    billingPeriodKey: getAccessBillingPeriodKey(plan, now),
    unpaidDebt,
  };
}

export function formatAccessFeeLabel(plan: Pick<DriverAccessPlan, 'feeTzs' | 'periodLabel'>) {
  return `TZS ${plan.feeTzs.toLocaleString()} / ${plan.periodLabel === 'week' ? 'wiki' : 'siku'}`;
}
