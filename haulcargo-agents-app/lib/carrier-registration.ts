import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import type { CoverageSelection } from '@/constants/coverage';
import { ALL_OPERATING_DAYS } from '@/lib/carrier-types';
import { darTodayKey } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';

export type RegisterCompanyInput = {
  companyName: string;
  brelaNumber?: string;
  tin?: string;
  businessLicence?: string;
  latraLicence?: string;
  contactPerson?: string;
  representativeTitle?: string;
  representativeIdNumber?: string;
  phone?: string;
  businessEmail?: string;
  location?: string;
  physicalAddress?: string;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  operatingStations?: string;
  businessDetails?: string;
  documents?: Record<string, string>;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
  phoneVerified?: boolean;
  routeOrigin: string;
  routeDestination: string;
  routeDepart: string;
  cargoCapacityKg: number;
  coverageRegions?: string[];
  coverageAllTanzania?: boolean;
  coverageInternational?: boolean;
};

export async function createCarrierFromRegistration(user: User, input: RegisterCompanyInput, email: string) {
  const inviteSnap = await getDoc(doc(db, 'carrierInvites', email.replaceAll('.', ',')));
  if (inviteSnap.exists()) {
    await setDoc(doc(db, 'carrierMembers', user.uid), {
      carrierId: inviteSnap.data().carrierId,
      role: inviteSnap.data().role || 'dispatcher',
      email,
    });
    return inviteSnap.data().carrierId as string;
  }

  const carrierId = user.uid;

  const coverage: CoverageSelection = {
    coverageRegions: input.coverageAllTanzania ? [] : [...(input.coverageRegions || [])],
    coverageAllTanzania: Boolean(input.coverageAllTanzania),
    coverageInternational: Boolean(input.coverageInternational),
  };

  await setDoc(doc(db, 'carriers', carrierId), {
    ownerUid: carrierId,
    companyName: input.companyName.trim(),
    brelaNumber: input.brelaNumber?.trim() || '',
    tin: input.tin?.trim() || '',
    businessLicence: input.businessLicence?.trim() || '',
    latraLicence: input.latraLicence?.trim() || '',
    contactPerson: input.contactPerson || '',
    representativeTitle: input.representativeTitle?.trim() || '',
    representativeIdNumber: input.representativeIdNumber?.trim() || '',
    phone: input.phone || '',
    businessEmail: (input.businessEmail || email).trim().toLowerCase(),
    email,
    location: input.location || input.physicalAddress || '',
    physicalAddress: input.physicalAddress?.trim() || input.location || '',
    gpsLatitude: input.gpsLatitude ?? null,
    gpsLongitude: input.gpsLongitude ?? null,
    operatingStations: input.operatingStations?.trim() || '',
    businessDetails: input.businessDetails || '',
    status: 'pending',
    documents: input.documents || {},
    termsAcceptedAt: input.termsAccepted ? serverTimestamp() : null,
    privacyAcceptedAt: input.privacyAccepted ? serverTimestamp() : null,
    phoneVerified: Boolean(input.phoneVerified),
    coverageRegions: coverage.coverageRegions,
    coverageAllTanzania: coverage.coverageAllTanzania,
    coverageInternational: coverage.coverageInternational,
    ordersReceived: 0,
    accepted: 0,
    rejected: 0,
    pickups: 0,
    deliveries: 0,
    failedPickups: 0,
    customerIssues: 0,
    cashDiscrepancies: 0,
    createdAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'carrierMembers', user.uid), {
    carrierId,
    role: 'owner',
    email,
  });

  await addDoc(collection(db, 'carrierRoutes'), {
    carrierId,
    origin: input.routeOrigin.trim(),
    destination: input.routeDestination.trim(),
    departureTime: input.routeDepart,
    arrivalTime: input.routeDepart,
    cargoCapacityKg: input.cargoCapacityKg,
    operatingDays: [...ALL_OPERATING_DAYS],
    pickupKariakoo: true,
    active: true,
    serviceDate: darTodayKey(),
    createdAt: serverTimestamp(),
  });

  return carrierId;
}
