import type { Carrier } from '@/lib/carrier-types';
import { TZ_REGIONS } from '@/constants/coverage';

const TZ_REGION_ALIASES = [
  ['dar es salaam', 'dar', 'dsm', 'salaam', 'kariakoo', 'ilala', 'kinondoni', 'temeke', 'ubungo', 'kigamboni'],
  ['mwanza', 'ilemela', 'nyamagana', 'nyegezi', 'nyakato'],
  ['arusha'],
  ['dodoma'],
  ['mbeya'],
  ['morogoro'],
  ['tanga'],
  ['kilimanjaro', 'moshi'],
  ['kigoma'],
  ['tabora'],
  ['shinyanga', 'kahama'],
  ['singida'],
  ['iringa'],
  ['mtwara', 'mikindani'],
  ['lindi'],
  ['ruvuma', 'songea'],
  ['pwani', 'coast', 'kibaha', 'bagamoyo'],
  ['geita'],
  ['kagera', 'bukoba'],
  ['mara', 'musoma'],
  ['manyara', 'babati'],
  ['njombe', 'makambako'],
  ['katavi', 'mpanda'],
  ['rukwa', 'sumbawanga'],
  ['simiyu'],
  ['songwe'],
  ['unguja', 'zanzibar', 'stone town'],
  ['pemba'],
];

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function detectRegionId(value: string) {
  const text = normalize(value);
  if (!text) return '';
  const tokens = new Set(text.split(' ').filter(Boolean));
  let bestId = '';
  let bestLen = 0;
  for (const aliases of TZ_REGION_ALIASES) {
    const id = aliases[0];
    for (const alias of aliases) {
      const key = normalize(alias);
      if (!key) continue;
      const hit = key.includes(' ') ? text.includes(key) : tokens.has(key);
      if (!hit || key.length <= bestLen) continue;
      bestLen = key.length;
      bestId = id;
    }
  }
  return bestId;
}

export function sameRegion(left: string, right: string) {
  const a = detectRegionId(left);
  const b = detectRegionId(right);
  if (a && b) return a === b;
  const na = normalize(left);
  const nb = normalize(right);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export function tripRegionChoices(carrier: Carrier | null | undefined) {
  if (!carrier) return [] as string[];
  if (carrier.coverageIntraCity) {
    const base = String(carrier.region || carrier.location || '').trim();
    return base ? [base] : [];
  }
  if (carrier.coverageAllTanzania) return [...TZ_REGIONS];
  const regions = [...(carrier.coverageRegions || [])].map((item) => String(item || '').trim()).filter(Boolean);
  if (carrier.coverageInternational) {
    String(carrier.coverageInternationalCountries || '')
      .split(/[,/]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((country) => regions.push(country));
  }
  return [...new Set(regions)];
}
