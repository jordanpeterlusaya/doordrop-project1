import { pilotStanding, PILOT_TIER_RULES } from '../constants/pilot-standing';
import type { DeliveryOrder, DriverRecord } from './driver-data';

export const DRIVER_COMMISSION_FEE_RATE = 0.2;
export const DEFAULT_DRIVER_PAY_CEILING_TZS = PILOT_TIER_RULES[0].payCeilingTzs;

type DriverStandingFields = DriverRecord & {
  completionStreak?: number;
  rejectionCount?: number;
};

export function driverPayCeilingTzs(driver?: DriverRecord | null) {
  const profile = (driver || {}) as DriverStandingFields;
  const completed = Math.max(0, Math.floor(Number(profile.completedOrderCount) || 0));
  const rejects = Math.max(0, Math.floor(Number(profile.rejectionCount || profile.cancellationCount) || 0));
  const streak = Math.max(0, Math.floor(Number(profile.completionStreak) || completed));
  const standing = pilotStanding({ streak, completed, rejects });
  const fromStanding = Math.round(Number(standing.payCeilingTzs) || 0);
  if (fromStanding > 0) {
    return fromStanding;
  }
  return DEFAULT_DRIVER_PAY_CEILING_TZS;
}

function parseFare(order: DeliveryOrder) {
  const direct = Number(order.driverGrossEarnings || 0);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.round(direct);
  }
  const digits = String(order.totalLabel || order.fareLabel || '').replace(/[^\d]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function orderHaulFee(order: DeliveryOrder) {
  const explicit = Math.max(0, Math.round(Number(order.haulFee) || 0));
  if (explicit > 0) {
    return explicit;
  }
  const status = String(order.status || '');
  if (status !== 'delivered' && status !== 'at_hub') {
    return 0;
  }
  const fare = parseFare(order);
  return fare > 0 ? Math.round(fare * DRIVER_COMMISSION_FEE_RATE) : 0;
}

export function orderCommissionOutstanding(order: DeliveryOrder) {
  const fee = orderHaulFee(order);
  if (fee <= 0) {
    return 0;
  }
  if (String(order.cashStatus || '').toLowerCase() === 'reconciled') {
    return 0;
  }
  const paid = Math.max(0, Math.round(Number(order.commissionPaidTzs) || 0));
  return Math.max(0, fee - paid);
}

export function summarizeDriverCommission(orders: DeliveryOrder[], driver?: DriverRecord | null) {
  const unpaidTzs = orders.reduce((sum, order) => sum + orderCommissionOutstanding(order), 0);
  const mirrored = Math.max(0, Math.round(Number(driver?.unpaidCommissionTzs) || 0));
  const due = Math.max(unpaidTzs, mirrored);
  const ceiling = driverPayCeilingTzs(driver);
  return {
    unpaidTzs: due,
    payCeilingTzs: ceiling,
    locked: due >= ceiling,
    canPay: due >= 1,
    feeRate: DRIVER_COMMISSION_FEE_RATE,
  };
}
