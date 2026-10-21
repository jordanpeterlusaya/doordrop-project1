/**
 * HAUL Cargo Agents desk rules.
 *
 * Tiers use real completed shipments: Imefika (`arrived`) and older
 * delivered rows. Counts are inclusive. Keep these thresholds identical
 * to TIER_RULES in backend/carrier-matching.js.
 *
 * - Bronze:   0–19   kamisheni 20%, ofa ya kawaida
 * - Silver:   20–49  kamisheni 18%, kipaumbele kidogo
 * - Gold:     50–99  kamisheni 15%, kipaumbele zaidi
 * - Platinum: 100+   kamisheni 12%, kipaumbele cha juu
 *
 * The rate is stored as haulFee only when a new offer is created.
 * Older shipments keep the haulFee they already have.
 *
 * Points = completed − company rejects. Cancel rate is
 * rejects / (completed + rejects). Above 30%, with at least 5
 * decisions, the tier drops one level. Bronze cannot drop further.
 *
 * Unpaid commission (the stored haulFee) is collected in one USSD push
 * only at or above COMMISSION_PAY_THRESHOLD_TZS. Keep this number
 * identical to backend/carrier-commission.js.
 */
export const CARRIER_TIER_RULES = [
  { id: 'bronze', label: 'Bronze', minCompleted: 0, feePercent: 20, priority: 'Ofa ya kawaida', priorityBonus: 0 },
  { id: 'silver', label: 'Silver', minCompleted: 20, feePercent: 18, priority: 'Kipaumbele kidogo', priorityBonus: 6 },
  { id: 'gold', label: 'Gold', minCompleted: 50, feePercent: 15, priority: 'Kipaumbele zaidi', priorityBonus: 16 },
  { id: 'platinum', label: 'Platinum', minCompleted: 100, feePercent: 12, priority: 'Kipaumbele cha juu', priorityBonus: 40 },
] as const;

export type CarrierTierId = (typeof CARRIER_TIER_RULES)[number]['id'];

export type CarrierTier = {
  id: CarrierTierId;
  label: string;
  minCompleted: number;
  feePercent: number;
  priority: string;
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

export type CarrierStanding = {
  completed: number;
  rejects: number;
  /** completed − rejects. Can be negative. */
  points: number;
  /** completed + rejects. */
  decisions: number;
  /** rejects / decisions, or 0 when there are no decisions. */
  cancelRate: number;
  cancelPercent: number;
  /** True only when the tier actually dropped one level. */
  held: boolean;
  tier: CarrierTier;
  raw: CarrierTier;
  nextLabel: string | null;
  nextMin: number | null;
  /** Share of the next tier's threshold already completed. 1 at the top. */
  ratio: number;
};

export function carrierStanding(completedOrders: number, rejects: number): CarrierStanding {
  const completed = Math.max(0, Math.floor(Number(completedOrders) || 0));
  const rejected = Math.max(0, Math.floor(Number(rejects) || 0));
  const points = completed - rejected;
  const decisions = completed + rejected;
  const cancelRate = decisions > 0 ? rejected / decisions : 0;
  const raw = carrierTierForCompleted(completed);
  const rawIndex = CARRIER_TIER_RULES.findIndex((rule) => rule.id === raw.id);
  const held = cancelRate > 0.3 && decisions >= 5 && rawIndex > 0;
  const tierRule = CARRIER_TIER_RULES[held ? rawIndex - 1 : Math.max(0, rawIndex)];
  const tier: CarrierTier = { ...tierRule, completedOrders: completed };
  const nextIndex = CARRIER_TIER_RULES.findIndex((rule) => rule.id === tier.id) + 1;
  const next = CARRIER_TIER_RULES[nextIndex] ?? null;
  const ratio = !next || next.minCompleted <= 0 ? 1 : Math.min(1, completed / next.minCompleted);
  return {
    completed,
    rejects: rejected,
    points,
    decisions,
    cancelRate,
    cancelPercent: Math.round(cancelRate * 100),
    held,
    tier,
    raw,
    nextLabel: next?.label ?? null,
    nextMin: next?.minCompleted ?? null,
    ratio,
  };
}

export function tierBenefitLabel(tier: { feePercent: number; priority: string }) {
  return `Kamisheni ${tier.feePercent}% · ${tier.priority}`;
}

export function tierProgressLabel(standing: CarrierStanding) {
  if (standing.held) return 'Imeshikiliwa';
  if (!standing.nextLabel || standing.nextMin == null) return 'Uko juu';
  return `${standing.completed} / ${standing.nextMin} kufikia ${standing.nextLabel}`;
}
