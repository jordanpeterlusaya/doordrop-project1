/** Tanzania regions + coverage helpers for carrier registration / matching. */

export const TZ_REGIONS = [
  'Arusha',
  'Dar es Salaam',
  'Dodoma',
  'Geita',
  'Iringa',
  'Kagera',
  'Katavi',
  'Kigoma',
  'Kilimanjaro',
  'Lindi',
  'Manyara',
  'Mara',
  'Mbeya',
  'Morogoro',
  'Mtwara',
  'Mwanza',
  'Njombe',
  'Pwani',
  'Rukwa',
  'Ruvuma',
  'Shinyanga',
  'Simiyu',
  'Singida',
  'Songwe',
  'Tabora',
  'Tanga',
  'Unguja (Zanzibar)',
  'Pemba',
] as const;

export type TzRegion = (typeof TZ_REGIONS)[number];

export const COVERAGE_ALL_TZ = 'Mikoa yote Tanzania';
export const COVERAGE_INTERNATIONAL = 'Nje ya nchi';

export type CoverageSelection = {
  coverageRegions: string[];
  coverageAllTanzania: boolean;
  coverageInternational: boolean;
};

export function emptyCoverage(): CoverageSelection {
  return {
    coverageRegions: [],
    coverageAllTanzania: false,
    coverageInternational: false,
  };
}

export function coverageIsValid(selection: CoverageSelection) {
  return (
    selection.coverageAllTanzania ||
    selection.coverageInternational ||
    selection.coverageRegions.length > 0
  );
}

export function coverageSummary(selection: CoverageSelection) {
  const parts: string[] = [];
  if (selection.coverageAllTanzania) parts.push(COVERAGE_ALL_TZ);
  if (selection.coverageInternational) parts.push(COVERAGE_INTERNATIONAL);
  if (!selection.coverageAllTanzania && selection.coverageRegions.length) {
    parts.push(...selection.coverageRegions.slice(0, 4));
    if (selection.coverageRegions.length > 4) {
      parts.push(`+${selection.coverageRegions.length - 4}`);
    }
  }
  return parts.join(' · ') || 'Haijachaguliwa';
}
