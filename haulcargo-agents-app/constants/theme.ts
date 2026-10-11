/** HAUL Agents — premium light SaaS system (Stripe / Linear / Ramp inspired). */
export const theme = {
  /** Tiny brand mark only — never a loud surface fill. */
  brandYellow: '#FFE500',
  primary: '#0F172A',
  primarySoft: '#F1F5F9',
  primaryDark: '#0F172A',
  onPrimary: '#FFFFFF',
  navy: '#0F172A',
  navyMid: '#1E3A5F',
  accent: '#2563EB',
  accentSoft: '#EFF6FF',
  ink: '#0F172A',
  charcoal: '#0F172A',
  text: '#0F172A',
  muted: '#64748B',
  subtext: '#64748B',
  border: '#E2E8F0',
  line: '#E2E8F0',
  bg: '#FFFFFF',
  canvas: '#FFFFFF',
  white: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#F8FAFC',
  tile: '#F8FAFC',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  warning: '#D97706',
  success: '#16A34A',
  successSoft: '#F0FDF4',
  info: '#2563EB',
  /** @deprecated Prefer navy / accent — kept for older screens. */
  green: '#0F172A',
  greenLight: '#1E3A5F',
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    pill: 999,
  },
  cta: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    labelSize: 15,
    labelLineHeight: 20,
    labelColor: '#FFFFFF',
    letterSpacing: -0.1,
  },
} as const;

export const HAUL_FEE_RATE = 0.2;
export const OFFER_MS = 5 * 60 * 1000;
export const ADMIN_EMAIL = 'boyzeus11@gmail.com';
