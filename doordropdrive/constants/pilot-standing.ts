/**
 * HAUL Pilots standing — same streak gamification as Cargo Agents.
 * Progress = unbroken streak of finished deliveries (not Bolt-style points).
 * Reject / post-accept cancel resets streak to 0 (when counters are available).
 *
 * - Bronze:   0–99     kamisheni 20%, ofa ya kawaida
 * - Silver:   100–249  kamisheni 18%, kipaumbele kidogo
 * - Gold:     250–499  kamisheni 17%, kipaumbele zaidi
 * - Platinum: 500+     kamisheni 15%, kipaumbele cha juu
 */

export const PILOT_TIER_RULES = [
  {
    id: 'bronze',
    label: 'Bronze',
    minStreak: 0,
    feePercent: 20,
    /** Unpaid commission lock ceiling (TZS). */
    payCeilingTzs: 25_000,
    priority: 'Ofa ya kawaida',
    accent: '#C48C58',
    accentSoft: '#3D2E22',
  },
  {
    id: 'silver',
    label: 'Silver',
    minStreak: 100,
    feePercent: 18,
    payCeilingTzs: 30_000,
    priority: 'Kipaumbele kidogo',
    accent: '#94A3B8',
    accentSoft: '#2A3038',
  },
  {
    id: 'gold',
    label: 'Gold',
    minStreak: 250,
    feePercent: 17,
    payCeilingTzs: 40_000,
    priority: 'Kipaumbele zaidi',
    accent: '#E8B339',
    accentSoft: '#3A3018',
  },
  {
    id: 'platinum',
    label: 'Platinum',
    minStreak: 500,
    feePercent: 15,
    payCeilingTzs: 50_000,
    priority: 'Kipaumbele cha juu',
    accent: '#7DD3FC',
    accentSoft: '#1A2A38',
  },
] as const;

export type PilotTierId = (typeof PILOT_TIER_RULES)[number]['id'];

export type PilotTier = (typeof PILOT_TIER_RULES)[number];

export type PilotStandingInput = {
  streak: number;
  completed: number;
  rejects: number;
  postAcceptCancels?: number;
};

export type PilotStanding = {
  streak: number;
  completed: number;
  rejects: number;
  postAcceptCancels: number;
  decisions: number;
  cancelRate: number;
  cancelPercent: number;
  highCommission: boolean;
  feePercent: number;
  payCeilingTzs: number;
  tier: PilotTier;
  next: PilotTier | null;
  nextLabel: string | null;
  nextMin: number | null;
  remainingToNext: number | null;
  ratio: number;
  driverScorePercent: number;
};

const HIGH_COMMISSION_RATE = 0.25;
const HIGH_COMMISSION_MIN_DECISIONS = 8;

export function pilotTierForStreak(streak: number): PilotTier {
  const count = Math.max(0, Math.floor(Number(streak) || 0));
  let tier: PilotTier = PILOT_TIER_RULES[0];
  for (const rule of PILOT_TIER_RULES) {
    if (count >= rule.minStreak) tier = rule;
  }
  return tier;
}

export function pilotStanding(input: PilotStandingInput): PilotStanding {
  const streak = Math.max(0, Math.floor(Number(input.streak) || 0));
  const completed = Math.max(0, Math.floor(Number(input.completed) || 0));
  const rejects = Math.max(0, Math.floor(Number(input.rejects) || 0));
  const postAcceptCancels = Math.max(0, Math.floor(Number(input.postAcceptCancels) || 0));
  const decisions = completed + rejects;
  const cancelRate = decisions > 0 ? rejects / decisions : 0;
  const tier = pilotTierForStreak(streak);
  const highCommission = cancelRate > HIGH_COMMISSION_RATE && decisions >= HIGH_COMMISSION_MIN_DECISIONS;
  const tierIndex = PILOT_TIER_RULES.findIndex((rule) => rule.id === tier.id);
  const next = PILOT_TIER_RULES[tierIndex + 1] ?? null;
  const ratio = !next || next.minStreak <= 0 ? 1 : Math.min(1, streak / next.minStreak);
  const remainingToNext = next ? Math.max(0, next.minStreak - streak) : null;
  // Driver score: completion quality (Bolt-style % card; agents use cancel %).
  const driverScorePercent =
    decisions <= 0 ? 100 : Math.max(40, Math.min(100, Math.round((1 - cancelRate) * 100)));

  const payCeilingTzs = highCommission
    ? PILOT_TIER_RULES[0].payCeilingTzs
    : tier.payCeilingTzs;

  return {
    streak,
    completed,
    rejects,
    postAcceptCancels,
    decisions,
    cancelRate,
    cancelPercent: Math.round(cancelRate * 100),
    highCommission,
    feePercent: highCommission ? 20 : tier.feePercent,
    payCeilingTzs,
    tier,
    next,
    nextLabel: next?.label ?? null,
    nextMin: next?.minStreak ?? null,
    remainingToNext,
    ratio,
    driverScorePercent,
  };
}

export type PilotBenefit = {
  icon: 'tag-outline' | 'map-marker-outline' | 'headset' | 'flash-outline' | 'percent-outline' | 'shield-check-outline';
  title: string;
  locked?: boolean;
};

export function pilotBenefitsForTier(tierId: PilotTierId, lang: 'en' | 'sw' = 'sw'): PilotBenefit[] {
  const sw = lang === 'sw';
  const shared: Record<PilotTierId, PilotBenefit[]> = {
    bronze: [
      { icon: 'tag-outline', title: sw ? 'Angalia ofa zilizopo' : 'See all available offers' },
      {
        icon: 'map-marker-outline',
        title: sw ? 'Mpaka safiri 2 kuelekea destinasheni/siku' : 'Up to 2 trips towards destination per day',
      },
    ],
    silver: [
      { icon: 'tag-outline', title: sw ? 'Angalia ofa zilizopo' : 'See all available offers' },
      {
        icon: 'map-marker-outline',
        title: sw ? 'Ona destinasheni kabla ya kukubali' : 'See destination before accepting an order',
      },
      { icon: 'headset', title: sw ? 'Msaada wa kipaumbele' : 'Priority support' },
      {
        icon: 'map-marker-outline',
        title: sw ? 'Mpaka safiri 4 kuelekea destinasheni/siku' : 'Up to 4 trips towards destination per day',
      },
    ],
    gold: [
      { icon: 'tag-outline', title: sw ? 'Angalia ofa zilizopo' : 'See all available offers' },
      {
        icon: 'flash-outline',
        title: sw ? 'Kipaumbele cha juu kwenye ofa' : 'Higher offer priority',
      },
      { icon: 'percent-outline', title: sw ? 'Kamisheni ya chini (17%)' : 'Lower commission (17%)' },
      {
        icon: 'map-marker-outline',
        title: sw ? 'Mpaka safiri 6 kuelekea destinasheni/siku' : 'Up to 6 trips towards destination per day',
      },
    ],
    platinum: [
      { icon: 'tag-outline', title: sw ? 'Angalia ofa zilizopo' : 'See all available offers' },
      {
        icon: 'shield-check-outline',
        title: sw ? 'Kipaumbele cha juu kabisa' : 'Top offer priority',
      },
      { icon: 'percent-outline', title: sw ? 'Kamisheni ya chini (15%)' : 'Lowest commission (15%)' },
      {
        icon: 'headset',
        title: sw ? 'Msaada wa haraka 24/7' : 'Fast 24/7 support',
      },
    ],
  };
  return shared[tierId];
}

export function pilotTierProgressLabel(standing: PilotStanding, lang: 'en' | 'sw' = 'sw'): string {
  if (!standing.next || standing.nextMin == null) {
    return lang === 'sw' ? `Mfululizo ${standing.streak}` : `Streak ${standing.streak}`;
  }
  return lang === 'sw'
    ? `${standing.streak}/${standing.nextMin}`
    : `${standing.streak}/${standing.nextMin}`;
}
