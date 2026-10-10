import type { Timestamp } from 'firebase/firestore';

export type FireTime = Timestamp | Date | { seconds: number } | string | null | undefined;

export type Carrier = {
  id: string;
  ownerUid?: string;
  companyName?: string;
  /** Some carrier docs use `name` instead of / alongside `companyName`. */
  name?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  location?: string;
  businessDetails?: string;
  status?: 'pending' | 'verified' | 'rejected' | 'suspended' | string;
  rejectionReason?: string;
  documents?: Record<string, string>;
  coverageRegions?: string[];
  coverageAllTanzania?: boolean;
  coverageInternational?: boolean;
};

export type CarrierRoute = {
  id: string;
  carrierId: string;
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  cargoCapacityKg?: number;
  operatingDays?: string[];
  active?: boolean;
  serviceDate?: string;
};

export type StatusHistoryEntry = {
  status: string;
  label?: string;
  at?: string;
  actor?: string;
};

export type CarrierShipment = {
  id: string;
  orderId?: string;
  orderNumber?: string;
  parcelCode?: string;
  carrierId?: string;
  offeredCarrierId?: string;
  shipmentStatus: string;
  pickupMode?: 'agent_collects' | 'haul_delivers_to_office' | string;
  trackStep?: string;
  routeId?: string;
  routeLabel?: string;
  departureTime?: string;
  destination?: string;
  origin?: string;
  pickupLabel?: string;
  customerName?: string;
  customerPhone?: string;
  recipientName?: string;
  recipientPhone?: string;
  parcelDescription?: string;
  weightKg?: number;
  cashExpected?: number;
  haulFee?: number;
  carrierNet?: number;
  cashStatus?: string;
  commissionPayRequest?: {
    requestedAt?: FireTime;
    requestedBy?: string;
    method?: string;
    amount?: number;
  };
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  offerExpiresAt?: FireTime;
  statusHistory?: StatusHistoryEntry[];
  loadedAt?: FireTime;
  arrivedAt?: FireTime;
  deliveredAt?: FireTime;
  createdAt?: FireTime;
  acceptedAt?: FireTime;
  offeredAt?: FireTime;
  manifestDate?: string;
  declaredValueTzs?: number;
  recipientSmsEvents?: Array<{ event?: string; jobId?: string; at?: string; status?: string }>;
};

export const TRACK = [
  { key: 'received', label: 'Imepokelewa', status: 'accepted' },
  { key: 'pickup', label: 'Uchukuzi', status: 'contacted' },
  { key: 'packed', label: 'Imepakiwa', status: 'at_bus' },
  { key: 'transit', label: 'Safarini', status: 'in_transit' },
  { key: 'arrived', label: 'Imefika', status: 'arrived' },
  { key: 'handed', label: 'Imewasili', status: 'delivered' },
] as const;

export const STATUS_LABEL: Record<string, string> = {
  new: 'Mpya',
  matching: 'Inatafutwa',
  assigned: 'Oda',
  accepted: 'Imekubaliwa',
  contacted: 'Uchukuzi',
  pickup_scheduled: 'Pickup imewekwa',
  picked_up: 'Imechukuliwa',
  at_bus: 'Imepakiwa',
  in_transit: 'Safarini',
  arrived: 'Imefika',
  delivered: 'Imewasili',
};

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type DayKey = (typeof DAYS)[number];

/** Default: operates every day unless the agent changes it. */
export const ALL_OPERATING_DAYS: DayKey[] = [...DAYS];

export const DAY_LABEL_SW: Record<DayKey, string> = {
  mon: 'Jt',
  tue: 'Jn',
  wed: 'Jtano',
  thu: 'Al',
  fri: 'Ij',
  sat: 'Jms',
  sun: 'Jp',
};
