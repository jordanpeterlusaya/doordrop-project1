import type { CoverageSelection } from '@/constants/coverage';

export type RegistrationDraft = {
  companyName: string;
  tradingName: string;
  email: string;
  password: string;
  phone: string;
  region: string;
  coverage: CoverageSelection;
  termsAccepted: boolean;
};

let draft: RegistrationDraft | null = null;

export function saveRegistrationDraft(next: RegistrationDraft) {
  draft = next;
}

export function getRegistrationDraft() {
  return draft;
}

export function clearRegistrationDraft() {
  draft = null;
}
