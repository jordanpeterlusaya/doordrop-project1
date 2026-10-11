import { emptyCoverage, type CoverageSelection } from '@/constants/coverage';

/** In-memory coverage bridge while navigating register → operation-coverage → back. */
let draft: CoverageSelection = emptyCoverage();
let stamp = 0;

export function setCoverageDraft(next: CoverageSelection) {
  draft = {
    coverageRegions: [...next.coverageRegions],
    coverageAllTanzania: next.coverageAllTanzania,
    coverageInternational: next.coverageInternational,
    coverageInternationalCountries: next.coverageInternationalCountries,
  };
  stamp += 1;
}

export function getCoverageDraft(): CoverageSelection {
  return {
    coverageRegions: [...draft.coverageRegions],
    coverageAllTanzania: draft.coverageAllTanzania,
    coverageInternational: draft.coverageInternational,
    coverageInternationalCountries: draft.coverageInternationalCountries,
  };
}

export function getCoverageDraftStamp() {
  return stamp;
}

export function clearCoverageDraft() {
  draft = emptyCoverage();
  stamp += 1;
}
