import type { Timestamp } from 'firebase/firestore';

export type FireTime = Timestamp | Date | { seconds: number } | string | null | undefined;

export type Carrier = {
  id: string;
  ownerUid?: string;
  /** Registered / legal company name (BRELA). */
  companyName?: string;
  /** Optional trading / DBA / brand name shown on the desk when set. */
  tradingName?: string;
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
  region?: string;
  coverageRegions?: string[];
  coverageAllTanzania?: boolean;
  coverageIntraCity?: boolean;
  coverageInternational?: boolean;
  coverageInternationalCountries?: string;
  cargoCapacityKg?: number;
  operatingDays?: string[];
  phoneNormalized?: string;
  phoneVerified?: boolean;
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
  parcelPhotoUrls?: string[];
  tripId?: string;
  tripName?: string;
  proofOfDelivery?: {
    method?: 'photo' | 'otp' | 'signature' | string;
    url?: string;
    verified?: boolean;
    at?: string;
  };
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

/** Desk rail. Keys stay the ones the customer app and SMS already read. */
export const DESK_RAIL = [
  { key: 'received', label: 'Imekubaliwa', status: 'accepted' },
  { key: 'packed', label: 'Imepokelewa', status: 'picked_up' },
  { key: 'transit', label: 'Imetumwa', status: 'in_transit' },
  { key: 'arrived', label: 'Imefika', status: 'arrived' },
  { key: 'handed', label: 'Imekabidhiwa', status: 'delivered' },
] as const;

export type DeskStepKey = (typeof DESK_RAIL)[number]['key'];

export const STATUS_LABEL: Record<string, string> = {
  new: 'Mpya',
  matching: 'Inatafutwa',
  assigned: 'Oda mpya',
  accepted: 'Imekubaliwa',
  contacted: 'Imekubaliwa',
  pickup_scheduled: 'Imekubaliwa',
  picked_up: 'Imepokelewa',
  at_bus: 'Imepokelewa',
  in_transit: 'Imetumwa',
  arrived: 'Imefika',
  delivered: 'Imekabidhiwa',
};

export type CarrierTrip = {
  id: string;
  carrierId: string;
  name: string;
  serviceDate: string;
  destinationRegion: string;
  vehicleNote?: string;
  /** Clock time HH:mm on serviceDate. Late chip uses this only when the company set it. */
  arrivalTime?: string;
  createdAt?: FireTime;
};

export type CarrierDecision = {
  id: string;
  shipmentId?: string;
  decision?: string;
  parcelCode?: string;
  destination?: string;
  weightKg?: number;
  actor?: string;
  at?: FireTime;
  atIso?: string;
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
