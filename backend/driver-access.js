function normalizeDriverVehicleType(vehicleType) {
  const normalized = String(vehicleType || '').trim().toLowerCase();
  const aliases = {
    bodaboda: 'bodaboda',
    boda: 'bodaboda',
    pikipiki: 'bodaboda',
    motorcycle: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    kirikuu: 'kirikuu',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  };

  return aliases[normalized] || 'bodaboda';
}

function parseFee(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const testAccessFeeTzs = parseFee(process.env.DRIVER_ACCESS_TEST_FEE_TZS, 0);

function resolveAccessFee(standardFee) {
  return testAccessFeeTzs || standardFee;
}

const ACCESS_PLANS = {
  bodaboda: {
    vehicleType: 'bodaboda',
    label: 'Bodaboda',
    feeTzs: resolveAccessFee(parseFee(process.env.DRIVER_BODABODA_ACCESS_FEE_TZS || process.env.DRIVER_DAILY_ACCESS_FEE_TZS, 3500)),
    durationHours: 24,
    durationDays: 1,
    minOrders: 4,
    period: 'day',
    periodLabel: 'day',
  },
  toyo: {
    vehicleType: 'toyo',
    label: 'TOYO',
    feeTzs: resolveAccessFee(parseFee(process.env.DRIVER_TOYO_ACCESS_FEE_TZS || process.env.DRIVER_WEEKLY_ACCESS_FEE_TZS, 25000)),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
  kirikuu: {
    vehicleType: 'kirikuu',
    label: 'Kirikuu',
    feeTzs: resolveAccessFee(parseFee(process.env.DRIVER_KIRIKUU_ACCESS_FEE_TZS || process.env.DRIVER_WEEKLY_ACCESS_FEE_TZS, 25000)),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
  canter: {
    vehicleType: 'canter',
    label: 'Canter',
    feeTzs: resolveAccessFee(parseFee(process.env.DRIVER_CANTER_ACCESS_FEE_TZS || process.env.DRIVER_WEEKLY_ACCESS_FEE_TZS, 25000)),
    durationHours: 168,
    durationDays: 7,
    minOrders: 3,
    period: 'week',
    periodLabel: 'week',
  },
};

const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_SETTLEMENT_HOUR_EAT = Number.parseInt(process.env.DRIVER_ACCESS_SETTLEMENT_HOUR || process.env.DRIVER_BODABODA_SETTLEMENT_HOUR || '4', 10) || 4;

function getTanzaniaDateKey(value = Date.now()) {
  const date = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return date.toISOString().slice(0, 10);
}

function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - TANZANIA_UTC_OFFSET_MS;
}

function getTanzaniaDayEndMillis(value = Date.now()) {
  return getTanzaniaDayStartMillis(value) + DAY_MS;
}

function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * DAY_MS;
}

function getTanzaniaWeekPeriodStartMillis(value = Date.now()) {
  const weekStart = getTanzaniaWeekStartMillis(value);
  const thisWeekSettlement = weekStart + ACCESS_SETTLEMENT_HOUR_EAT * 60 * 60 * 1000;
  if (value >= thisWeekSettlement) {
    return thisWeekSettlement;
  }

  return thisWeekSettlement - 7 * DAY_MS;
}

function getTanzaniaWeekEndMillis(value = Date.now()) {
  return getTanzaniaWeekPeriodStartMillis(value) + 7 * DAY_MS;
}

function isDailySettlementOpen(value = Date.now()) {
  const dayStart = getTanzaniaDayStartMillis(value);
  const settlementAt = dayStart + ACCESS_SETTLEMENT_HOUR_EAT * 60 * 60 * 1000;
  return value >= settlementAt;
}

function isWeeklySettlementOpen(value = Date.now()) {
  const periodStart = getTanzaniaWeekPeriodStartMillis(value);
  const settlementAt = periodStart + 7 * DAY_MS;
  return value >= settlementAt;
}

function isAccessSettlementOpen(plan, value = Date.now()) {
  return plan.period === 'week' ? isWeeklySettlementOpen(value) : isDailySettlementOpen(value);
}

function isBodabodaSettlementOpen(value = Date.now()) {
  return isDailySettlementOpen(value);
}

function getAccessPaidUntilMillis(plan, now = Date.now()) {
  return plan.period === 'week' ? getTanzaniaWeekEndMillis(now) : getTanzaniaDayEndMillis(now);
}

function getAccessPeriodStartMillis(plan, now = Date.now()) {
  return plan.period === 'week' ? getTanzaniaWeekPeriodStartMillis(now) : getTanzaniaDayStartMillis(now);
}

function getPreviousAccessBillingPeriodKey(plan, now = Date.now()) {
  const currentStart = getAccessPeriodStartMillis(plan, now);
  return getAccessBillingPeriodKey(plan, currentStart - 1);
}

function getAccessBillingPeriodKey(plan, now = Date.now()) {
  const periodStart = getAccessPeriodStartMillis(plan, now);
  return plan.period === 'week'
    ? `week:${getTanzaniaDateKey(periodStart)}`
    : `day:${getTanzaniaDateKey(periodStart)}`;
}

function getPaymentBillingPeriodKey(payment, plan, now = Date.now()) {
  const stored = String(payment?.billingPeriodKey || '').trim();
  if (stored) {
    return stored;
  }

  const dateKey = String(payment?.dateKey || '').trim();
  if (dateKey) {
    const paymentNow = Date.parse(`${dateKey}T12:00:00+03:00`);
    if (Number.isFinite(paymentNow)) {
      return getAccessBillingPeriodKey(plan, paymentNow);
    }
  }

  return getAccessBillingPeriodKey(plan || getDriverAccessPlan(null), now);
}

function isSameAccessBillingPeriod(payment, plan, now = Date.now()) {
  return getPaymentBillingPeriodKey(payment, plan, now) === getAccessBillingPeriodKey(plan, now);
}

function getCurrentAccessChargeTzs(plan) {
  return Number(plan?.feeTzs || 0);
}

function resolveAccessPaidUntilMillis(plan, now = Date.now(), currentPaidUntil = 0) {
  if (currentPaidUntil > now) {
    return currentPaidUntil;
  }

  return getAccessPaidUntilMillis(plan, now);
}

function getDriverAccessPlan(driver) {
  const vehicleType = normalizeDriverVehicleType(driver?.vehicleType || driver?.vehicleLabel);
  return ACCESS_PLANS[vehicleType] || ACCESS_PLANS.bodaboda;
}

function getDriverCompletedOrderCount(driver, now = Date.now(), fallbackCount = 0) {
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

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasUnpaidAccessDebt(driver, now = Date.now()) {
  const dueKey = String(driver?.accessPaymentDuePeriodKey || '').trim();
  if (!dueKey) {
    return false;
  }

  return !isDriverSubscriptionPaid(driver, now);
}

function resolveAccessPaymentDuePatch(driver, now = Date.now()) {
  const plan = getDriverAccessPlan(driver);
  const planState = buildAccessPlanState(driver, now);
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

function isDriverInAccessGrace(driver, now = Date.now()) {
  if (hasUnpaidAccessDebt(driver, now)) {
    return false;
  }

  const plan = getDriverAccessPlan(driver);
  if (getDriverCompletedOrderCount(driver, now) < plan.minOrders) {
    return true;
  }

  return !isAccessSettlementOpen(plan, now);
}

function hasQualifiedForAccessCharge(driver, now = Date.now()) {
  const plan = getDriverAccessPlan(driver);
  return getDriverCompletedOrderCount(driver, now) >= plan.minOrders;
}

function isDriverSubscriptionPaid(driver, now = Date.now()) {
  return toMillis(driver?.subscriptionPaidUntil) > now;
}

function isDriverSubscriptionActive(driver, now = Date.now()) {
  if (!driver) {
    return false;
  }

  return isDriverInAccessGrace(driver, now) || isDriverSubscriptionPaid(driver, now);
}

function canInitiateDriverAccessPayment(driver, now = Date.now()) {
  if (!driver) {
    return false;
  }

  if (isDriverSubscriptionPaid(driver, now)) {
    return false;
  }

  const planState = buildAccessPlanState(driver, now);
  return planState.canPay;
}

function hasUnpaidPreviousDayCommission(driver, now = Date.now()) {
  const todayStart = getTanzaniaDayStartMillis(now);
  const yesterdayKey = getTanzaniaDateKey(todayStart - 1);
  if (String(driver?.commissionPaidDateKey || '').trim() === yesterdayKey) {
    return false;
  }

  const dueKey = String(driver?.commissionDueDateKey || '').trim();
  const dueTzs = Number(driver?.commissionDueTzs || 0);
  const status = String(driver?.commissionStatus || '').trim().toLowerCase();
  return dueKey === yesterdayKey && Number.isFinite(dueTzs) && dueTzs > 0 && status !== 'paid';
}

function buildAccessPlanState(driver, now = Date.now()) {
  const plan = getDriverAccessPlan(driver);
  const completedOrders = getDriverCompletedOrderCount(driver, now);
  const remainingOrders = Math.max(0, plan.minOrders - completedOrders);
  const paid = isDriverSubscriptionPaid(driver, now);
  const qualified = completedOrders >= plan.minOrders;
  const workWindow = !isAccessSettlementOpen(plan, now);
  const unpaidDebt = hasUnpaidAccessDebt(driver, now);
  const grace = !unpaidDebt && (!qualified || workWindow);

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
    chargeTzs: getCurrentAccessChargeTzs(plan),
    arrearsTzs: unpaidDebt ? getCurrentAccessChargeTzs(plan) : 0,
    unpaidDebt,
  };
}

module.exports = {
  ACCESS_PLANS,
  buildAccessPlanState,
  canInitiateDriverAccessPayment,
  getAccessBillingPeriodKey,
  getAccessPaidUntilMillis,
  getAccessPeriodStartMillis,
  getCurrentAccessChargeTzs,
  getDriverAccessPlan,
  getDriverCompletedOrderCount,
  getPaymentBillingPeriodKey,
  getTanzaniaDateKey,
  getTanzaniaDayEndMillis,
  getPreviousAccessBillingPeriodKey,
  getTanzaniaWeekEndMillis,
  getTanzaniaWeekPeriodStartMillis,
  hasQualifiedForAccessCharge,
  hasUnpaidAccessDebt,
  hasUnpaidPreviousDayCommission,
  isAccessSettlementOpen,
  isBodabodaSettlementOpen,
  isDailySettlementOpen,
  isDriverInAccessGrace,
  isDriverSubscriptionActive,
  isDriverSubscriptionPaid,
  isSameAccessBillingPeriod,
  isWeeklySettlementOpen,
  normalizeDriverVehicleType,
  resolveAccessPaymentDuePatch,
  resolveAccessPaidUntilMillis,
};
