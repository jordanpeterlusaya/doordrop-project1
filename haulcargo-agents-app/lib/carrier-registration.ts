import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { DAYS } from '@/lib/carrier-types';
import { darTodayKey } from '@/lib/carrier-helpers';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';

export type RegisterCompanyInput = {
  companyName: string;
  contactPerson?: string;
  phone?: string;
  location?: string;
  businessDetails?: string;
  routeOrigin: string;
  routeDestination: string;
  routeDepart: string;
  cargoCapacityKg: number;
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
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Dar_es_Salaam' })
    .format(new Date())
    .slice(0, 3)
    .toLowerCase();

  await setDoc(doc(db, 'carriers', carrierId), {
    ownerUid: carrierId,
    companyName: input.companyName.trim(),
    contactPerson: input.contactPerson || '',
    phone: input.phone || '',
    email,
    location: input.location || '',
    businessDetails: input.businessDetails || '',
    status: 'pending',
    documents: {},
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
    operatingDays: [dayName],
    pickupKariakoo: true,
    active: true,
    serviceDate: darTodayKey(),
    createdAt: serverTimestamp(),
  });

  return carrierId;
}

export { DAYS };
