import { carrierStanding, type CarrierStanding } from '@/constants/carrier-desk';
import { isCompletedShipment } from '@/lib/carrier-helpers';
import type { CarrierDecision, CarrierShipment } from '@/lib/carrier-types';

/** Rejects already written on the carrier counter and/or decision docs. */
export function rejectCount(decisions: CarrierDecision[] | undefined, rejectedCounter?: number) {
  const fromDocs = (decisions || []).filter((item) => String(item.decision || '').toLowerCase() === 'rejected').length;
  const fromCounter = Math.max(0, Math.floor(Number(rejectedCounter) || 0));
  return Math.max(fromDocs, fromCounter);
}

/** Standing from this company's own finished shipments and reject records. */
export function deskStanding(
  shipments: CarrierShipment[],
  carrierId: string,
  decisions: CarrierDecision[] | undefined,
  rejectedCounter?: number,
): CarrierStanding {
  const completed = shipments.filter((item) => item.carrierId === carrierId && isCompletedShipment(item)).length;
  return carrierStanding(completed, rejectCount(decisions, rejectedCounter));
}
