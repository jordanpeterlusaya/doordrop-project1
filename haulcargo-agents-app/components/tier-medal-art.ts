/* Metallic medal artwork. Keep in sync with assets/badges/medal-*.svg */
export const TIER_MEDAL_XML = {
  bronze: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 156">
  <defs>
    <linearGradient id="bronze-rib" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3F2918"/>
      <stop offset="1" stop-color="#1C100A"/>
    </linearGradient>
    <linearGradient id="bronze-rim" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#FFF4E8"/>
      <stop offset="0.28" stop-color="#E2A25E"/>
      <stop offset="0.62" stop-color="#8A4E22"/>
      <stop offset="1" stop-color="#F8DCC0"/>
    </linearGradient>
    <radialGradient id="bronze-face" cx="0.35" cy="0.28" r="0.78">
      <stop offset="0" stop-color="#F8D2AE"/>
      <stop offset="0.5" stop-color="#C88848"/>
      <stop offset="1" stop-color="#7A4520"/>
    </radialGradient>
    <linearGradient id="bronze-gem" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#FFF9F4"/>
      <stop offset="1" stop-color="#F0C8A6"/>
    </linearGradient>
  </defs>
  <path d="M34 2h22l6 34-12 40H28L18 36Z" fill="url(#bronze-rib)"/>
  <path d="M72 2h22l16 34-10 40H78L66 36Z" fill="url(#bronze-rib)"/>
  <path d="M42 4h8l2 30-4 36h-8L38 34Z" fill="#E2B07A"/>
  <path d="M80 4h8l4 32-4 34h-8l-2-36Z" fill="#E2B07A"/>
  <circle cx="64" cy="100" r="46" fill="#0F172A" opacity="0.12"/>
  <circle cx="64" cy="96" r="46" fill="url(#bronze-rim)"/>
  <circle cx="64" cy="96" r="38.5" fill="#5C3418"/>
  <circle cx="64" cy="96" r="36" fill="url(#bronze-face)"/>
  <circle cx="64" cy="96" r="37.2" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>
  <circle cx="64" cy="96" r="30" fill="none" stroke="#FFF6EC" stroke-width="1.15" stroke-opacity="0.85"/>
  <path d="M30 78 A36 36 0 0 1 86 66" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
  <g transform="translate(0.8,1.5)"><path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="#5A3016" opacity="0.28"/></g>
  <path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="url(#bronze-gem)"/>
</svg>
`,
  silver: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 156">
  <defs>
    <linearGradient id="silver-rib" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2C3138"/>
      <stop offset="1" stop-color="#12151A"/>
    </linearGradient>
    <linearGradient id="silver-rim" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.28" stop-color="#D7DCE3"/>
      <stop offset="0.62" stop-color="#747C88"/>
      <stop offset="1" stop-color="#F8F9FB"/>
    </linearGradient>
    <radialGradient id="silver-face" cx="0.35" cy="0.28" r="0.78">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.5" stop-color="#D2D7DF"/>
      <stop offset="1" stop-color="#8B939F"/>
    </radialGradient>
    <linearGradient id="silver-gem" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#E6EAF0"/>
    </linearGradient>
  </defs>
  <path d="M34 2h22l6 34-12 40H28L18 36Z" fill="url(#silver-rib)"/>
  <path d="M72 2h22l16 34-10 40H78L66 36Z" fill="url(#silver-rib)"/>
  <path d="M42 4h8l2 30-4 36h-8L38 34Z" fill="#F4F6F8"/>
  <path d="M80 4h8l4 32-4 34h-8l-2-36Z" fill="#F4F6F8"/>
  <circle cx="64" cy="100" r="46" fill="#0F172A" opacity="0.12"/>
  <circle cx="64" cy="96" r="46" fill="url(#silver-rim)"/>
  <circle cx="64" cy="96" r="38.5" fill="#3A414C"/>
  <circle cx="64" cy="96" r="36" fill="url(#silver-face)"/>
  <circle cx="64" cy="96" r="37.2" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>
  <circle cx="64" cy="96" r="30" fill="none" stroke="#FFFFFF" stroke-width="1.15" stroke-opacity="0.85"/>
  <path d="M30 78 A36 36 0 0 1 86 66" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
  <g transform="translate(0.8,1.5)"><path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="#555E6C" opacity="0.28"/></g>
  <path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="url(#silver-gem)"/>
</svg>
`,
  gold: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 156">
  <defs>
    <linearGradient id="gold-rib" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3A2A0C"/>
      <stop offset="1" stop-color="#161006"/>
    </linearGradient>
    <linearGradient id="gold-rim" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#FFF8DC"/>
      <stop offset="0.28" stop-color="#F0C84A"/>
      <stop offset="0.62" stop-color="#A07812"/>
      <stop offset="1" stop-color="#FFEBB0"/>
    </linearGradient>
    <radialGradient id="gold-face" cx="0.35" cy="0.28" r="0.78">
      <stop offset="0" stop-color="#FFE9A6"/>
      <stop offset="0.5" stop-color="#E8C04A"/>
      <stop offset="1" stop-color="#A67C14"/>
    </radialGradient>
    <linearGradient id="gold-gem" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#FFFDF6"/>
      <stop offset="1" stop-color="#F8E090"/>
    </linearGradient>
  </defs>
  <path d="M34 2h22l6 34-12 40H28L18 36Z" fill="url(#gold-rib)"/>
  <path d="M72 2h22l16 34-10 40H78L66 36Z" fill="url(#gold-rib)"/>
  <path d="M42 4h8l2 30-4 36h-8L38 34Z" fill="#FFE08A"/>
  <path d="M80 4h8l4 32-4 34h-8l-2-36Z" fill="#FFE08A"/>
  <circle cx="64" cy="100" r="46" fill="#0F172A" opacity="0.12"/>
  <circle cx="64" cy="96" r="46" fill="url(#gold-rim)"/>
  <circle cx="64" cy="96" r="38.5" fill="#6A4E10"/>
  <circle cx="64" cy="96" r="36" fill="url(#gold-face)"/>
  <circle cx="64" cy="96" r="37.2" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>
  <circle cx="64" cy="96" r="30" fill="none" stroke="#FFF6D6" stroke-width="1.15" stroke-opacity="0.85"/>
  <path d="M30 78 A36 36 0 0 1 86 66" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
  <g transform="translate(0.8,1.5)"><path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="#7A5810" opacity="0.28"/></g>
  <path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="url(#gold-gem)"/>
</svg>
`,
  platinum: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 156">
  <defs>
    <linearGradient id="platinum-rib" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#172233"/>
      <stop offset="1" stop-color="#0A1018"/>
    </linearGradient>
    <linearGradient id="platinum-rim" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.28" stop-color="#D5E0EE"/>
      <stop offset="0.62" stop-color="#6E7E96"/>
      <stop offset="1" stop-color="#F4F8FC"/>
    </linearGradient>
    <radialGradient id="platinum-face" cx="0.35" cy="0.28" r="0.78">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.5" stop-color="#E4ECF6"/>
      <stop offset="1" stop-color="#96A9C2"/>
    </radialGradient>
    <linearGradient id="platinum-gem" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F7FAFD"/>
    </linearGradient>
  </defs>
  <path d="M34 2h22l6 34-12 40H28L18 36Z" fill="url(#platinum-rib)"/>
  <path d="M72 2h22l16 34-10 40H78L66 36Z" fill="url(#platinum-rib)"/>
  <path d="M42 4h8l2 30-4 36h-8L38 34Z" fill="#F5F8FC"/>
  <path d="M80 4h8l4 32-4 34h-8l-2-36Z" fill="#F5F8FC"/>
  <circle cx="64" cy="100" r="46" fill="#0F172A" opacity="0.12"/>
  <circle cx="64" cy="96" r="46" fill="url(#platinum-rim)"/>
  <circle cx="64" cy="96" r="38.5" fill="#243044"/>
  <circle cx="64" cy="96" r="36" fill="url(#platinum-face)"/>
  <circle cx="64" cy="96" r="37.2" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>
  <circle cx="64" cy="96" r="30" fill="none" stroke="#FFFFFF" stroke-width="1.15" stroke-opacity="0.85"/>
  <path d="M30 78 A36 36 0 0 1 86 66" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
  <g transform="translate(0.8,1.5)"><path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="#3A4A62" opacity="0.28"/></g>
  <path d="M 64.00 80.00 L 67.88 90.66 L 79.22 91.06 L 70.28 98.04 L 73.40 108.94 L 64.00 102.60 L 54.60 108.94 L 57.72 98.04 L 48.78 91.06 L 60.12 90.66 Z" fill="url(#platinum-gem)"/>
</svg>
`,
} as const;
