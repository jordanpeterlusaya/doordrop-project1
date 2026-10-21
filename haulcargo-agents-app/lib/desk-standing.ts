import { carrierStanding, completionStreak, type CarrierStanding } from '@/constants/carrier-desk';
import { fireTimeMs, isCompletedShipment } from '@/lib/carrier-helpers';
import type { CarrierDecision, CarrierShipment } from '@/lib/carrier-types';

const BREAKS = new Set(['rejected', 'cancelled_after_accept']);

function decisionMs(decision: CarrierDecision) {
  return fireTimeMs(decision.at) || Date.parse(String(decision.atIso || '')) || 0;
}

function completionMs(item: CarrierShipment) {
  return fireTimeMs(item.arrivedAt) || fireTimeMs(item.deliveredAt) || 0;
}

/** Standing from finished shipments and company reject/cancel decisions. */
export function deskStanding(
  shipments: CarrierShipment[],
  carrierId: string,
  decisions: CarrierDecision[] | undefined,
  rejectedCounter?: number,
  postAcceptCounter?: number,
): CarrierStanding {
  const completedRows = shipments.filter((item) => item.carrierId === carrierId && isCompletedShipment(item));
  const breaks = (decisions || []).filter((item) => BREAKS.has(String(item.decision || '').toLowerCase()));
  const postAcceptFromDocs = (decisions || []).filter(
    (item) => String(item.decision || '').toLowerCase() === 'cancelled_after_accept',
  ).length;
  const postAcceptCancels = Math.max(postAcceptFromDocs, Math.max(0, Math.floor(Number(postAcceptCounter) || 0)));
  const fromDocs = breaks.length;
  const rejects = Math.max(fromDocs, Math.max(0, Math.floor(Number(rejectedCounter) || 0)));
  const breakTimes = breaks.map(decisionMs).filter((ms) => ms > 0);
  const undatedBreak = breaks.some((item) => decisionMs(item) <= 0) || rejects > fromDocs;
  const streak = completionStreak(
    completedRows.map(completionMs),
    breakTimes,
    undatedBreak,
  );
  return carrierStanding({
    streak,
    completed: completedRows.length,
    rejects,
    postAcceptCancels,
  });
}

/** Unpaid haulFee on finished jobs. Reconciled rows are already paid. */
export function unpaidHaulFee(shipments: CarrierShipment[], carrierId: string) {
  let unpaid = 0;
  for (const item of shipments) {
    if (item.carrierId !== carrierId || !isCompletedShipment(item)) continue;
    if (String(item.cashStatus || '').toLowerCase() === 'reconciled') continue;
    const fee = Math.max(0, Math.round(Number(item.haulFee) || 0));
    if (fee > 0) unpaid += fee;
  }
  return unpaid;
}
