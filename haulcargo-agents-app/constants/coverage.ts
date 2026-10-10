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
  /** Comma-separated countries when operating outside Tanzania. */
  coverageInternationalCountries: string;
};

export function emptyCoverage(): CoverageSelection {
  return {
    coverageRegions: [],
    coverageAllTanzania: false,
    coverageInternational: false,
    coverageInternationalCountries: '',
  };
}

export function coverageIsValid(selection: CoverageSelection) {
  if (selection.coverageAllTanzania || selection.coverageRegions.length > 0) return true;
  if (selection.coverageInternational) {
    return selection.coverageInternationalCountries.trim().length > 1;
  }
  return false;
}

export function coverageSummary(selection: CoverageSelection) {
  const parts: string[] = [];
  if (selection.coverageAllTanzania) parts.push(COVERAGE_ALL_TZ);
  if (selection.coverageInternational) {
    const countries = selection.coverageInternationalCountries.trim();
    parts.push(countries ? `${COVERAGE_INTERNATIONAL}: ${countries}` : COVERAGE_INTERNATIONAL);
  }
  if (!selection.coverageAllTanzania && selection.coverageRegions.length) {
    parts.push(...selection.coverageRegions.slice(0, 4));
    if (selection.coverageRegions.length > 4) {
      parts.push(`+${selection.coverageRegions.length - 4}`);
    }
  }
  return parts.join(' · ') || 'Haijachaguliwa';
}
