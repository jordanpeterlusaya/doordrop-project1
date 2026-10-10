/** HAUL visual system — aligned with customer app cargoTheme. */
export const theme = {
  primary: '#FFE500',
  primarySoft: '#FFF9CC',
  primaryDark: '#111827',
  onPrimary: '#111827',
  ink: '#111827',
  charcoal: '#111827',
  text: '#111827',
  muted: '#6B7280',
  subtext: '#6B7280',
  border: '#E5E7EB',
  line: '#E5E7EB',
  bg: '#F7F7F5',
  canvas: '#F7F7F5',
  white: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#F8FAFC',
  tile: '#F3F4F6',
  danger: '#B91C1C',
  warning: '#EA580C',
  success: '#22C55E',
  info: '#2563EB',
  /** @deprecated Use ink / primary — kept so older screens compile during restyle. */
  green: '#111827',
  greenLight: '#1F2937',
  radius: {
    md: 16,
    lg: 20,
    xl: 28,
    pill: 999,
  },
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#FFE500',
    paddingHorizontal: 20,
    labelSize: 17,
    labelLineHeight: 22,
    labelColor: '#111827',
    letterSpacing: -0.2,
  },
} as const;

export const HAUL_FEE_RATE = 0.2;
export const OFFER_MS = 5 * 60 * 1000;
export const ADMIN_EMAIL = 'boyzeus11@gmail.com';
