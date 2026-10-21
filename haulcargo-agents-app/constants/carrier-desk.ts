/**
 * HAUL Cargo Agents desk rules. Keep these identical to TIER_RULES in
 * backend/carrier-matching.js.
 *
 * Promotion is an unbroken streak of finished shipments (Imefika / delivered).
 * One company reject or post-accept cancel resets the streak to 0.
 *
 * - Bronze:   streak 0–99     kamisheni 20%, ofa ya kawaida
 * - Silver:   streak 100–249  kamisheni 18%, kipaumbele kidogo
 * - Gold:     streak 250–499  kamisheni 17%, kipaumbele zaidi
 * - Platinum: streak 500+     kamisheni 15%, kipaumbele cha juu
 *
 * Cancel rate is rejects / (completed + rejects). Above 25%, with at least
 * 8 decisions, the company pays 20% even if the streak tier is higher.
 * At 40% (and at least 8 decisions), or 3 post-accept cancels, new offers
 * stop until an admin clears offersPaused and fraudHold. The account is
 * not deleted.
 *
 * The rate is stored as haulFee only when a new offer is created.
 * Older shipments keep the haulFee they already have.
 *
 * Unpaid commission is collected in one USSD push only at or above
 * COMMISSION_PAY_THRESHOLD_TZS. Keep this number identical to
 * backend/carrier-commission.js.
 */
export const CARRIER_TIER_RULES = [
  { id: 'bronze', label: 'Bronze', minStreak: 0, feePercent: 20, priority: 'Ofa ya kawaida', priorityBonus: 0 },
  { id: 'silver', label: 'Silver', minStreak: 100, feePercent: 18, priority: 'Kipaumbele kidogo', priorityBonus: 6 },
  { id: 'gold', label: 'Gold', minStreak: 250, feePercent: 17, priority: 'Kipaumbele zaidi', priorityBonus: 16 },
  { id: 'platinum', label: 'Platinum', minStreak: 500, feePercent: 15, priority: 'Kipaumbele cha juu', priorityBonus: 40 },
] as const;

export type CarrierTierId = (typeof CARRIER_TIER_RULES)[number]['id'];

export type CarrierTier = {
  id: CarrierTierId;
  label: string;
  minStreak: number;
  feePercent: number;
  priority: string;
  priorityBonus: number;
};

/** Unpaid HAUL commission is collected only once the balance reaches this amount. */
export const COMMISSION_PAY_THRESHOLD_TZS = 30_000;

export const CANCEL_WARN_RATE = 0.15;
export const HIGH_COMMISSION_RATE = 0.25;
export const HIGH_COMMISSION_MIN_DECISIONS = 8;
export const CLOSURE_RATE = 0.4;
export const CLOSURE_POST_ACCEPT_CANCELS = 3;

export type CarrierStandingInput = {
  streak: number;
  completed: number;
  rejects: number;
  postAcceptCancels?: number;
};

export type CarrierStanding = {
  streak: number;
  completed: number;
  rejects: number;
  postAcceptCancels: number;
  decisions: number;
  cancelRate: number;
  cancelPercent: number;
  /** Above 25% with at least 8 decisions, or already in the closure band. */
  highCommission: boolean;
  /** 40% with at least 8 decisions, or 3 post-accept cancels. */
  closure: boolean;
  /** Rate actually charged on the next offer. 20 when punished. */
  feePercent: number;
  priorityBonus: number;
  tier: CarrierTier;
  nextLabel: string | null;
  nextMin: number | null;
  ratio: number;
};

export function carrierTierForStreak(streak: number): CarrierTier {
  const count = Math.max(0, Math.floor(Number(streak) || 0));
  let tier: CarrierTier = CARRIER_TIER_RULES[0];
  for (const rule of CARRIER_TIER_RULES) {
    if (count >= rule.minStreak) tier = rule;
  }
  return tier;
}

export function carrierStanding(input: CarrierStandingInput): CarrierStanding {
  const streak = Math.max(0, Math.floor(Number(input.streak) || 0));
  const completed = Math.max(0, Math.floor(Number(input.completed) || 0));
  const rejects = Math.max(0, Math.floor(Number(input.rejects) || 0));
  const postAcceptCancels = Math.max(0, Math.floor(Number(input.postAcceptCancels) || 0));
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  const tier = carrierTierForStreak(streak);
  const highCancel = cancelRate > HIGH_COMMISSION_RATE && decisions >= HIGH_COMMISSION_MIN_DECISIONS;
  const closure =
    postAcceptCancels >= CLOSURE_POST_ACCEPT_CANCELS ||
    (cancelRate >= CLOSURE_RATE && decisions >= HIGH_COMMISSION_MIN_DECISIONS);
  const punished = highCancel || closure;
  const next = CARRIER_TIER_RULES[CARRIER_TIER_RULES.findIndex((rule) => rule.id === tier.id) + 1] ?? null;
  const ratio = !next || next.minStreak <= 0 ? 1 : Math.min(1, streak / next.minStreak);
  return {
    streak,
    completed,
    rejects,
    postAcceptCancels,
    decisions,
    cancelRate,
    cancelPercent: Math.round(cancelRate * 100),
    highCommission: punished,
    closure,
    feePercent: punished ? 20 : tier.feePercent,
    priorityBonus: punished ? 0 : tier.priorityBonus,
    tier,
    nextLabel: next?.label ?? null,
    nextMin: next?.minStreak ?? null,
    ratio,
  };
}

/** Finished jobs after the latest company reject/cancel. An undated break resets the streak. */
export function completionStreak(completionTimes: number[], breakTimes: number[], undatedBreak: boolean) {
  if (undatedBreak) return 0;
  const latestBreak = (breakTimes || []).reduce((max, ms) => Math.max(max, Math.floor(Number(ms) || 0)), 0);
  if (latestBreak <= 0) return (completionTimes || []).length;
  return (completionTimes || []).filter((ms) => Math.floor(Number(ms) || 0) > latestBreak).length;
}

export function tierBenefitLabel(standing: { feePercent: number; highCommission?: boolean; tier: { priority: string } }) {
  if (standing.highCommission) return 'Kamisheni 20% · Kundi la juu';
  return `Kamisheni ${standing.feePercent}% · ${standing.tier.priority}`;
}

export function tierProgressLabel(standing: CarrierStanding) {
  if (!standing.nextLabel || standing.nextMin == null) return 'Uko juu';
  return `mfululizo ${standing.streak} / ${standing.nextMin} kufikia ${standing.nextLabel}`;
}

/** Homepage tier row. "4 / 100" — streak toward the next tier, nothing else. */
export function tierProgressShort(standing: CarrierStanding) {
  if (standing.nextMin == null) return 'Uko juu';
  return `${standing.streak} / ${standing.nextMin}`;
}

/**
 * Cancel notice, empty while the rate is healthy.
 * 15%+: onyo. Above 25% with enough decisions: 20% commission.
 * "Akaunti inaweza kufungwa" only in the 40% closure band.
 * A fraud hold or offer pause does not print that sentence on its own.
 */
export function tierWarning(standing: CarrierStanding, _offersPaused = false) {
  if (standing.cancelRate < CANCEL_WARN_RATE) return '';
  if (standing.cancelRate >= CLOSURE_RATE && standing.decisions >= HIGH_COMMISSION_MIN_DECISIONS) {
    return 'Akaunti inaweza kufungwa';
  }
  if (standing.cancelRate > HIGH_COMMISSION_RATE && standing.decisions >= HIGH_COMMISSION_MIN_DECISIONS) {
    return `Cancel ${standing.cancelPercent}%. Kamisheni sasa 20%.`;
  }
  return `Onyo: cancel ${standing.cancelPercent}%. Punguza kukataa.`;
}
