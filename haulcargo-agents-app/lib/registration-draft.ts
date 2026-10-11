import type { CoverageSelection } from '@/constants/coverage';
import type { PickedDoc } from '@/lib/document-upload';

export type DocKey = 'brelaCert' | 'tinCert' | 'businessLicence' | 'latraLicence' | 'repId';

export type RegistrationDraft = {
  companyName: string;
  tradingName: string;
  email: string;
  password: string;
  phone: string;
  contactPerson: string;
  representativeTitle: string;
  businessEmail: string;
  region: string;
  district: string;
  physicalAddress: string;
  brelaNumber: string;
  tin: string;
  businessLicence: string;
  latraLicence: string;
  representativeIdNumber: string;
  operatingStations: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  docs: Partial<Record<DocKey, PickedDoc>>;
  coverage: CoverageSelection;
  routeOrigin: string;
  routeDestination: string;
  routeDepart: string;
  cargoCapacityKg: string;
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
