/**
 * HAUL Cargo Agents desk rules.
 *
 * Tiers use real completed shipments only: Imefika (`arrived`) and older
 * delivered rows. Counts are inclusive.
 *
 * - Bronze:   0–19
 * - Silver:   20–49
 * - Gold:     50–99
 * - Platinum: 100+
 *
 * Commission is the stored haulFee (HAUL_FEE_RATE = 20% at offer time).
 * The company pays that balance in one USSD push only at or above
 * COMMISSION_PAY_THRESHOLD_TZS. Keep this number identical to
 * COMMISSION_PAY_THRESHOLD_TZS in backend/carrier-commission.js.
 */
export const CARRIER_TIER_RULES = [
  { id: 'bronze', label: 'Bronze', minCompleted: 0 },
  { id: 'silver', label: 'Silver', minCompleted: 20 },
  { id: 'gold', label: 'Gold', minCompleted: 50 },
  { id: 'platinum', label: 'Platinum', minCompleted: 100 },
] as const;

export type CarrierTierId = (typeof CARRIER_TIER_RULES)[number]['id'];

export type CarrierTier = {
  id: CarrierTierId;
  label: string;
  minCompleted: number;
  completedOrders: number;
};

/** Unpaid HAUL commission is collected only once the balance reaches this amount. */
export const COMMISSION_PAY_THRESHOLD_TZS = 50_000;

export function carrierTierForCompleted(completedOrders: number): CarrierTier {
  const count = Math.max(0, Math.floor(Number(completedOrders) || 0));
  let tier: (typeof CARRIER_TIER_RULES)[number] = CARRIER_TIER_RULES[0];
  for (const rule of CARRIER_TIER_RULES) {
    if (count >= rule.minCompleted) tier = rule;
  }
  return { ...tier, completedOrders: count };
}
