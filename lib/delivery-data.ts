import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { recordAppActivity } from '@/lib/app-analytics';
import { cargoAgreementPhase } from '@/doordropdrive/lib/cargo-order-agreement';
import { logWarning } from '@/lib/debug-logger';
import { compactFirestoreData } from '@/lib/firestore-payload';
import { db } from '@/lib/firebase';
import { cellsNear, encodeGeohash } from '@/lib/geohash';
import {
  buildOutsideParcelPublicSummary,
  generateOutsideParcelCode,
  isOutsideParcelOrder,
  makeLogisticsEvent,
} from '@/lib/outside-order-logistics';
import { formatExactCoordinateLabel, isWeakPlaceName } from '@/lib/place-labels';
import { getNearestServiceCity } from '@/lib/service-cities';
import { getOutsideParcelDurationSecondsForOrder } from '@/lib/outside-parcel-eta';
import {
  assertExpressDepartureBookable,
  normalizeOutsideExpressRouteSchedule,
  parseOutsideExpressRouteId,
  resolveExpressFirstMileMinutes,
} from '@/lib/outside-express-schedule';
import { createOrderStatusNotification } from '@/lib/user-notifications';

export type DeliveryFlow = 'parcel' | 'cargo' | 'ninunulie';
export type DeliveryTimingMode = 'now' | 'later';
export type DeliveryCancellationActor = 'customer' | 'driver' | 'dispatch';
export type DriverSearchStatus = 'searching' | 'waiting_for_driver' | 'assigned' | 'auto_cancelled' | 'ops_desk';
type CanonicalDriverVehicleType = 'bodaboda' | 'toyo' | 'kirikuu' | 'canter';
export type DeliveryOrderStatus =
  | 'pending_assignment'
  | 'driver_assigned'
  | 'driver_at_pickup'
  | 'in_transit'
  | 'at_hub'
  | 'delivered'
  | 'cancelled';

export type DriverVehicleType = 'bodaboda' | 'pikipiki' | 'boda' | 'motorcycle' | 'motorbike' | 'kirikuu' | 'toyo' | 'toyo_xl' | 'pickup' | 'van' | 'truck' | 'canter' | 'center';
export type DriverVerificationStatus = 'pending_admin_verification' | 'verified' | 'rejected';
export type DriverVerificationDocumentKey = 'vehiclePhoto' | 'driverPhoto';
export type DriverVerificationDocument = {
  uri?: string;
  fileName?: string | null;
  mimeType?: string | null;
  downloadURL?: string;
  storagePath?: string;
  uploadedAt?: string;
};

export type DeliveryOrder = {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  flow: DeliveryFlow;
  serviceLabel: string;
  status: DeliveryOrderStatus;
  pickupLabel: string;
  dropoffLabel: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
  driverDropoffLabel?: string;
  driverDropoffLatitude?: number;
  driverDropoffLongitude?: number;
  outsideDestinationLabel?: string;
  outsideDestinationCity?: string;
  outsideDestinationStand?: string;
  outsideDestinationLatitude?: number;
  outsideDestinationLongitude?: number;
  outsideParcelWeightKg?: string;
  declaredValueTzs?: string;
  contentsDeclarationAccepted?: boolean;
  contentsDeclarationAcceptedAt?: unknown;
  outsideShippingMode?: string;
  outsideHandoffMode?: string;
  /** When driver starts trip with an outside parcel (customer pickup complete). */
  outsidePickupAt?: unknown;
  /** Fixed countdown start — persists until order completes or cancels. */
  outsideCountdownStartedAt?: unknown;
  /** Promised delivery deadline (persisted; does not reset on track reopen). */
  outsideEtaDeadlineAt?: unknown;
  outsideExpressRouteId?: string;
  outsideExpressDepartureId?: string;
  outsideExpressDepartureAt?: unknown;
  outsideExpressDepartureLabel?: string;
  outsideExpressBookingCutoffAt?: unknown;
  outsideExpressAirportHandoffAt?: unknown;
  outsideExpressArrivalAt?: unknown;
  /** When parcel departed hub via bus/air (admin). */
  departedAt?: unknown;
  /** Origin city/region label for other-region parcels. */
  outsideOriginCity?: string;
  /** Human + QR code for other-region parcels (e.g. DDX-AB12CD). */
  parcelCode?: string;
  trackingId?: string;
  /** Bus-agent match copied from carrierShipments for the customer app. */
  carrierShipmentId?: string;
  carrierMatchStatus?: 'matching' | 'offered' | 'accepted';
  carrierRouteLabel?: string;
  carrierPickupMode?: string;
  carrierTrackStep?: string;
  logisticsStatus?: string;
  logisticsEvents?: Array<{ status?: string; note?: string; by?: string; at?: unknown }>;
  carrierRef?: string;
  etaLabel: string;
  fareLabel: string;
  totalLabel: string;
  fareType?: 'algorithm' | 'negotiated';
  customerOffer?: number;
  driverOffer?: number;
  minFare?: number;
  distanceKm?: number;
  lastOfferBy?: 'customer' | 'driver';
  negotiationStatus?: 'open' | 'confirmed';
  driverNegotiationUsed?: number;
  driverOfferNote?: string;
  customerOfferNote?: string;
  fareConfirmedAt?: unknown;
  suggestedFare?: number;
  suggestedFareMin?: number;
  suggestedFareMax?: number;
  routeLabel?: string;
  routeGeometry?: string;
  timingMode: DeliveryTimingMode;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleLabel: string;
  recipientName: string;
  recipientPhone: string;
  paymentMethod?: string;
  paymentLabel?: string;
  paymentProvider?: string;
  paymentType?: string;
  parcelScope?: string;
  parcelTypeKey?: string;
  parcelTypeLabel?: string;
  cargoVehicleKey?: string;
  cargoVehicleLabel?: string;
  cargoCapacityLabel?: string;
  cargoSizeLabel?: string;
  cargoDriverHelp?: boolean;
  cargoDriverHelpLabel?: string;
  distanceLabel?: string;
  durationLabel?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  customerRating?: number;
  customerReview?: string;
  customerRatedAt?: unknown;
  cancellationReason?: string;
  cancelledBy?: DeliveryCancellationActor;
  cancelledAt?: unknown;
  deliveredAt?: unknown;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  requestedDriverId?: string;
  requestedDriverName?: string;
  driverVehicleType?: DriverVehicleType;
  driverVehicleLabel?: string;
    driverPlateNumber?: string;
  driverVehicleColor?: string;
  driverPhotoURL?: string;
  driverLatitude?: number;
  driverLongitude?: number;
  driverHeading?: number;
  driverSpeedKph?: number;
  driverAccuracyMeters?: number;
  driverLocationUpdatedAt?: unknown;
  acceptedByDriverAt?: unknown;
  assignedAt?: unknown;
  assignmentMode?: string;
  assignmentScore?: number;
  assignmentReason?: string;
  declinedDriverIds?: string[];
  lastDeclinedByDriverId?: string;
  lastDeclinedAt?: unknown;
  driverSearchStatus?: DriverSearchStatus;
  driverSearchMessage?: string;
  driverSearchStartedAt?: unknown;
  driverSearchExpiresAt?: unknown;
  driverSearchResolvedAt?: unknown;
  noNearbyDriverAt?: unknown;
  noNearbyDriverReason?: string;
  autoCancelledAt?: unknown;
  autoCancelledReason?: string;
  ninunulieItemTitle?: string;
  ninunulieItemDescription?: string;
  ninunulieExpectedPriceTzs?: string;
  ninunulieProductUrl?: string;
  ninunuliePhotoUrls?: string[];
  ninunulieSellerName?: string;
  ninunulieSellerPhone?: string;
  ninunulieSellerRegion?: string;
  ninunulieSellerNotes?: string;
  ninunulieCustomerNotes?: string;
  ninunuliePurchaseAmountTzs?: string;
  ninunulieOpsNotes?: string;
  ninunulieFulfillmentChannel?: 'whatsapp' | 'ops_desk';
  ninunulieWhatsAppPhone?: string;
  ninunuliePurchased?: boolean;
  ninunuliePurchasedAt?: unknown;
  ninunuliePurchasedBy?: string;
  ninunuliePurchaseNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type DriverRecord = {
  id: string;
  fullName: string;
  email?: string;
  authUid?: string;
  phoneNumber: string;
  city?: string;
  gender?: string;
  vehicleType?: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor?: string;
  plateNumber: string;
  verificationStatus?: DriverVerificationStatus;
  verificationDocuments?: Partial<Record<DriverVerificationDocumentKey, DriverVerificationDocument | null>>;
  vehiclePhotoURL?: string;
  driverPhotoURL?: string;
  verificationSubmittedAt?: unknown;
  verificationReviewedAt?: unknown;
  verifiedAt?: unknown;
  verifiedByAdminId?: string;
  verifiedByAdminEmail?: string;
  verificationRejectedAt?: unknown;
  verificationRejectedByAdminId?: string;
  verificationRejectedByAdminEmail?: string;
  verificationRejectionReason?: string;
  isAvailable: boolean;
  currentOrderId?: string;
  assignmentCount?: number;
  completedOrderCount?: number;
  cancellationCount?: number;
  ratingAverage?: number;
  ratingCount?: number;
  ratingTotal?: number;
  lastAssignedAt?: unknown;
  driverScore?: number;
  suspensionUntil?: number;
  subscriptionPaidUntil?: unknown;
  subscriptionStatus?: string;
  lastSubscriptionPaymentStatus?: string;
  lastCommissionPaymentStatus?: string;
  currentLatitude?: number;
  currentLongitude?: number;
  currentHeading?: number;
  currentSpeedKph?: number;
  currentAccuracyMeters?: number;
  geohash?: string;
  lastLocationUpdatedAt?: unknown;
  lastActiveAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CreateDeliveryOrderInput = {
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  flow: DeliveryFlow;
  serviceLabel: string;
  pickupLabel: string;
  dropoffLabel: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
  driverDropoffLabel?: string;
  driverDropoffLatitude?: number;
  driverDropoffLongitude?: number;
  outsideDestinationLabel?: string;
  outsideDestinationCity?: string;
  outsideDestinationStand?: string;
  outsideDestinationLatitude?: number;
  outsideDestinationLongitude?: number;
  outsideParcelWeightKg?: string;
  declaredValueTzs?: string;
  contentsDeclarationAccepted?: boolean;
  outsideShippingMode?: string;
  outsideHandoffMode?: string;
  etaLabel: string;
  fareLabel: string;
  totalLabel: string;
  fareType?: 'algorithm' | 'negotiated';
  customerOffer?: number;
  driverOffer?: number;
  minFare?: number;
  distanceKm?: number;
  lastOfferBy?: 'customer' | 'driver';
  negotiationStatus?: 'open' | 'confirmed';
  driverNegotiationUsed?: number;
  driverOfferNote?: string;
  customerOfferNote?: string;
  fareConfirmedAt?: unknown;
  suggestedFare?: number;
  suggestedFareMin?: number;
  suggestedFareMax?: number;
  routeLabel?: string;
  routeGeometry?: string;
  timingMode: DeliveryTimingMode;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleLabel: string;
  recipientName: string;
  recipientPhone: string;
  parcelScope?: string;
  parcelTypeKey?: string;
  parcelTypeLabel?: string;
  cargoVehicleKey?: string;
  cargoVehicleLabel?: string;
  cargoCapacityLabel?: string;
  cargoSizeLabel?: string;
  cargoDriverHelp?: boolean;
  cargoDriverHelpLabel?: string;
  distanceLabel?: string;
  durationLabel?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  requestedDriverId?: string;
  requestedDriverName?: string;
  outsideExpressRouteId?: string;
  outsideExpressDepartureId?: string;
  outsideExpressDepartureAtMs?: number;
  outsideExpressDepartureLabel?: string;
  outsideExpressBookingCutoffAtMs?: number;
  outsideExpressAirportHandoffAtMs?: number;
  outsideExpressFirstMileDeadlineAtMs?: number;
  outsideExpressArrivalOffsetMinutes?: number;
};

export type CreateDriverInput = Pick<DriverRecord, 'fullName' | 'phoneNumber' | 'vehicleType' | 'vehicleLabel' | 'plateNumber'>;
export type RegisterDriverInput = Pick<
  DriverRecord,
  'fullName' | 'phoneNumber' | 'vehicleLabel' | 'plateNumber' | 'vehicleType' | 'vehicleColor'
> & {
  uid: string;
  email?: string;
  city?: string;
  gender?: string;
  verificationStatus?: DriverVerificationStatus;
  verificationDocuments?: Partial<Record<DriverVerificationDocumentKey, DriverVerificationDocument | null>>;
};
export type UpdateDriverLocationInput = {
  latitude: number;
  longitude: number;
  heading?: number;
  speedKph?: number;
  accuracyMeters?: number;
};

export const deliveryOrderStatusOptions: DeliveryOrderStatus[] = [
  'pending_assignment',
  'driver_assigned',
  'driver_at_pickup',
  'in_transit',
  'at_hub',
  'delivered',
  'cancelled',
];

const ordersCollection = collection(db, 'orders');
const driversCollection = collection(db, 'drivers');
const dataScope = 'DeliveryData';
const DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS = 1000 * 60 * 15;
export const DRIVER_SEARCH_TIMEOUT_MS = 1000 * 60 * 10;
const DRIVER_SEARCH_TIMEOUT_REASON = 'No nearby driver came online in time.';
const DRIVER_WAITING_UPDATE_THROTTLE_MS = 1000 * 15;
const RECENT_ORDERS_SUBSCRIPTION_LIMIT = 80;
const USER_ORDERS_SUBSCRIPTION_LIMIT = 40;
const LIVE_DRIVER_SUBSCRIPTION_LIMIT = 80;
const DRIVER_DOC_HEARTBEAT_MS = 45 * 1000;
const DEFAULT_WEEKLY_SUBSCRIPTION_FEE_TZS = 20000;
const BODABODA_WEEKLY_SUBSCRIPTION_FEE_TZS = 12000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

const deliveryOrderStatusLabels: Record<DeliveryOrderStatus, string> = {
  pending_assignment: 'Waiting for driver',
  driver_assigned: 'Driver assigned',
  driver_at_pickup: 'Driver at pickup',
  in_transit: 'In transit',
  at_hub: 'At DoorDrop office',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const autoMatchServices: Array<{
  key: CanonicalDriverVehicleType;
  aliases: string[];
  preferredVehicleTypes: CanonicalDriverVehicleType[];
}> = [
  {
    key: 'bodaboda',
    aliases: ['parcel', 'package', 'pikipiki', 'boda', 'bodaboda', 'motorcycle', 'motorbike', 'bike'],
    preferredVehicleTypes: ['bodaboda'],
  },
  {
    key: 'toyo',
    aliases: ['bajaj', 'bajaji', 'toyo', 'toyo xl', 'xl', 'three wheeler', 'cargo bajaji', 'pickup', 'van', 'truck', 'lorry', 'heavy cargo'],
    preferredVehicleTypes: ['toyo'],
  },
  {
    key: 'kirikuu',
    aliases: ['kirikuu'],
    preferredVehicleTypes: ['kirikuu'],
  },
  {
    key: 'canter',
    aliases: ['canter', 'center', 'fuso'],
    preferredVehicleTypes: ['canter'],
  },
];

function orderRef(orderId: string) {
  return doc(db, 'orders', orderId);
}

function driverRef(driverId: string) {
  return doc(db, 'drivers', driverId);
}

function driverLocationRef(driverId: string) {
  return doc(db, 'driverLocations', driverId);
}

function toMillis(value: unknown) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getTanzaniaDayStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) - TANZANIA_UTC_OFFSET_MS;
}

function getTanzaniaWeekStartMillis(value = Date.now()) {
  const shiftedDate = new Date(value + TANZANIA_UTC_OFFSET_MS);
  return getTanzaniaDayStartMillis(value) - shiftedDate.getUTCDay() * DAY_MS;
}

function getNextTanzaniaSundayStartMillis(value = Date.now()) {
  return getTanzaniaWeekStartMillis(value) + WEEK_MS;
}

function sortOrders(items: DeliveryOrder[]) {
  return [...items].sort((left, right) => {
    return toMillis(right.updatedAt ?? right.createdAt) - toMillis(left.updatedAt ?? left.createdAt);
  });
}

function sortDrivers(items: DriverRecord[]) {
  return [...items].sort((left, right) => {
    if (left.isAvailable !== right.isAvailable) {
      return left.isAvailable ? -1 : 1;
    }

    return left.fullName.localeCompare(right.fullName);
  });
}

function getSnapshotItems<T extends { id: string }>(
  items: { id: string; data: () => Record<string, unknown> }[]
) {
  return items.map((item) => ({ id: item.id, ...item.data() })) as T[];
}

function getGeneratedOrderNumber(documentId: string) {
  return `DD-${documentId.slice(0, 6).toUpperCase()}`;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value: string) {
  return value.split('').reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 0);
}

function getDistanceBetweenPoints(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number }
) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitude = (start.latitude * Math.PI) / 180;
  const endLatitude = (end.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOrderPickupPoint(order: DeliveryOrder) {
  if (order.pickupLatitude === undefined || order.pickupLongitude === undefined) {
    return null;
  }

  return {
    latitude: Number(order.pickupLatitude),
    longitude: Number(order.pickupLongitude),
  };
}

function getDriverCurrentPoint(driver: DriverRecord) {
  if (driver.currentLatitude === undefined || driver.currentLongitude === undefined) {
    return null;
  }

  return {
    latitude: Number(driver.currentLatitude),
    longitude: Number(driver.currentLongitude),
  };
}

function getDriverLastSeenMillis(driver: DriverRecord) {
  return Math.max(
    toMillis(driver.lastLocationUpdatedAt),
    toMillis(driver.lastActiveAt),
    toMillis(driver.updatedAt)
  );
}

function isDriverVerifiedForDispatch(driver: Partial<DriverRecord>) {
  return !driver.verificationStatus || driver.verificationStatus === 'verified';
}

function isDriverAutoAssignable(driver: DriverRecord) {
  const lastSeenMillis = getDriverLastSeenMillis(driver);
  const isFreshOnline = !!lastSeenMillis && Date.now() - lastSeenMillis <= DRIVER_AUTO_ASSIGN_ONLINE_WINDOW_MS;
  return (
    isDriverVerifiedForDispatch(driver) &&
    driver.isAvailable &&
    !driver.currentOrderId &&
    isFreshOnline
  );
}

function getDriverSubscriptionPaidUntilMillis(driver?: Partial<DriverRecord> | null) {
  return toMillis(driver?.subscriptionPaidUntil);
}

function hasActiveDriverSubscription(driver?: Partial<DriverRecord> | null) {
  return getDriverSubscriptionPaidUntilMillis(driver) >= getNextTanzaniaSundayStartMillis();
}

function hasPendingDriverSubscriptionPayment(driver?: Partial<DriverRecord> | null) {
  const status = normalizeText(driver?.lastSubscriptionPaymentStatus || driver?.lastCommissionPaymentStatus);
  return status === 'pending_admin_verification';
}

async function driverHasAssignmentAccess(_driverId: string, _driver?: Partial<DriverRecord> | null) {
  return true;
}

async function assertDriverHasAssignmentAccess(driverId: string, driver?: Partial<DriverRecord> | null) {
  if (!(await driverHasAssignmentAccess(driverId, driver))) {
    throw new Error(`Calendar-week DoorDrop subscription of TZS ${getDriverWeeklySubscriptionFeeTzs(driver).toLocaleString()} is required before receiving new orders.`);
  }
}

function normalizeOrderVehicleKey(vehicleKey?: string) {
  const normalized = normalizeText(vehicleKey);
  const aliases: Record<string, string> = {
    parcel: 'bodaboda',
    pikipiki: 'bodaboda',
    boda: 'bodaboda',
    bodaboda: 'bodaboda',
    motorcycle: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    kirikuu: 'kirikuu',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  };

  return aliases[normalized] || normalized || undefined;
}

function isBodabodaSubscriptionDriver(driver?: Partial<DriverRecord> | null) {
  const vehicleType = normalizeOrderVehicleKey(driver?.vehicleType);
  if (vehicleType) {
    return vehicleType === 'bodaboda';
  }

  const vehicleLabel = normalizeText(driver?.vehicleLabel);
  return ['bodaboda', 'boda', 'pikipiki', 'motorcycle', 'motorbike', 'bike'].some((alias) => vehicleLabel.includes(alias));
}

function getDriverWeeklySubscriptionFeeTzs(driver?: Partial<DriverRecord> | null) {
  return isBodabodaSubscriptionDriver(driver) ? BODABODA_WEEKLY_SUBSCRIPTION_FEE_TZS : DEFAULT_WEEKLY_SUBSCRIPTION_FEE_TZS;
}

function getVehicleLabelForKey(vehicleKey?: string, fallback?: string) {
  const canonicalVehicleKey = normalizeOrderVehicleKey(vehicleKey);
  const labels: Record<string, string> = {
    bodaboda: 'Bodaboda / Motorcycle',
    pikipiki: 'Bodaboda / Motorcycle',
    boda: 'Bodaboda / Motorcycle',
    motorcycle: 'Bodaboda / Motorcycle',
    motorbike: 'Bodaboda / Motorcycle',
    toyo: 'TOYO',
    kirikuu: 'Kirikuu',
    canter: 'Canter',
    center: 'Canter',
  };

  return labels[canonicalVehicleKey || ''] || fallback;
}

function isCanonicalDriverVehicleType(vehicleKey?: string): vehicleKey is CanonicalDriverVehicleType {
  return vehicleKey === 'bodaboda' || vehicleKey === 'toyo' || vehicleKey === 'kirikuu' || vehicleKey === 'canter';
}

function getServiceMatchConfig(order: DeliveryOrder) {
  const cargoVehicleKey = normalizeText(order.cargoVehicleKey);
  const keyMatch = {
    motorcycle: 'bodaboda',
    pikipiki: 'bodaboda',
    boda: 'bodaboda',
    bodaboda: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    kirikuu: 'kirikuu',
    bajaj: 'toyo',
    bajaji: 'toyo',
    toyo: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    cargo: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  }[cargoVehicleKey];

  if (keyMatch) {
    return autoMatchServices.find((service) => service.key === keyMatch) ?? autoMatchServices[0];
  }

  const text = normalizeText(`${order.serviceLabel} ${order.flow} ${order.cargoVehicleKey} ${order.cargoVehicleLabel}`);
  if (text.includes('canter') || text.includes('center') || text.includes('fuso')) {
    return autoMatchServices.find((service) => service.key === 'canter') ?? autoMatchServices[0];
  }
  if (text.includes('toyo xl')) {
    return autoMatchServices.find((service) => service.key === 'toyo') ?? autoMatchServices[0];
  }

  return autoMatchServices.find((service) => service.aliases.some((alias) => text.includes(alias))) ?? autoMatchServices[0];
}

function driverSupportsOrder(driver: DriverRecord, order: DeliveryOrder) {
  const service = getServiceMatchConfig(order);
  const vehicleType = normalizeOrderVehicleKey(driver.vehicleType);
  const vehicleLabel = normalizeText(driver.vehicleLabel);

  if (isCanonicalDriverVehicleType(vehicleType)) {
    return service.preferredVehicleTypes.includes(vehicleType);
  }

  return service.aliases.some((alias) => vehicleLabel.includes(alias));
}

function getDriverRatingAverage(driver: DriverRecord) {
  const average = Number(driver.ratingAverage);
  if (Number.isFinite(average) && average >= 1 && average <= 5) {
    return average;
  }

  return 4.5;
}

function getDriverAutoMatchScore(order: DeliveryOrder, driver: DriverRecord, minimumAssignmentCount: number) {
  const pickup = getOrderPickupPoint(order);
  const currentPoint = getDriverCurrentPoint(driver);
  const supportsOrder = driverSupportsOrder(driver, order);
  const distanceMeters = pickup && currentPoint ? getDistanceBetweenPoints(currentPoint, pickup) : undefined;
  const distancePenalty = distanceMeters === undefined ? 32 : clamp(distanceMeters / 250, 0, 42);
  const ratingPenalty = clamp((5 - getDriverRatingAverage(driver)) * 7, 0, 28);
  const assignmentCount = Number(driver.assignmentCount ?? 0);
  const workloadPenalty = clamp((assignmentCount - minimumAssignmentCount) * 7, 0, 36);
  const lastAssignedMillis = toMillis(driver.lastAssignedAt);
  const idleBonus = lastAssignedMillis ? clamp((Date.now() - lastAssignedMillis) / (1000 * 60 * 60 * 3), 0, 14) : 14;
  const vehiclePenalty = supportsOrder ? 0 : 120;
  const tieBreaker = stableHash(`${order.id}:${driver.id}`) / 10000000000;

  return {
    distanceMeters,
    supportsOrder,
    score: vehiclePenalty + distancePenalty + ratingPenalty + workloadPenalty - idleBonus + tieBreaker,
    reason: [
      supportsOrder ? 'vehicle match' : 'vehicle fallback',
      distanceMeters === undefined ? 'GPS pending' : `${Math.round(distanceMeters)}m from pickup`,
      `${getDriverRatingAverage(driver).toFixed(1)}/5 rating`,
      `${assignmentCount} total assignments`,
    ].join(' · '),
  };
}

function getAutoMatchCandidates(order: DeliveryOrder, drivers: DriverRecord[]) {
  const declinedDriverIds = new Set(order.declinedDriverIds ?? []);
  const availableDrivers = drivers.filter((driver) => isDriverAutoAssignable(driver) && !declinedDriverIds.has(driver.id));
  const assignmentCounts = availableDrivers.map((driver) => Number(driver.assignmentCount ?? 0));
  const minimumAssignmentCount = assignmentCounts.length ? Math.min(...assignmentCounts) : 0;

  return availableDrivers
    .map((driver) => ({
      driver,
      match: getDriverAutoMatchScore(order, driver, minimumAssignmentCount),
    }))
    .filter((candidate) => candidate.match.supportsOrder && candidate.match.score < 125)
    .sort((left, right) => left.match.score - right.match.score);
}

async function selectBestAssignableAutoMatch(order: DeliveryOrder, drivers: DriverRecord[]) {
  const candidates = getAutoMatchCandidates(order, drivers);

  for (const candidate of candidates) {
    if (await driverHasAssignmentAccess(candidate.driver.id, candidate.driver)) {
      return candidate;
    }
  }

  return null;
}

function clearDriverAssignmentFields() {
  return {
    driverId: deleteField(),
    driverName: deleteField(),
    driverPhone: deleteField(),
    driverVehicleType: deleteField(),
    driverVehicleLabel: deleteField(),
    driverPlateNumber: deleteField(),
    driverLatitude: deleteField(),
    driverLongitude: deleteField(),
    driverHeading: deleteField(),
    driverSpeedKph: deleteField(),
    driverAccuracyMeters: deleteField(),
    driverLocationUpdatedAt: deleteField(),
    acceptedByDriverAt: deleteField(),
    assignedAt: deleteField(),
  };
}

function buildDriverAssignmentPayload(driver: DriverRecord) {
  const driverVehicleType = normalizeOrderVehicleKey(driver.vehicleType);
  return compactFirestoreData({
    driverId: driver.id,
    driverName: driver.fullName,
    driverPhone: driver.phoneNumber,
    driverVehicleType: isCanonicalDriverVehicleType(driverVehicleType) ? driverVehicleType : driver.vehicleType,
    driverVehicleLabel: driver.vehicleLabel || getVehicleLabelForKey(driverVehicleType),
    driverPlateNumber: driver.plateNumber,
    driverVehicleColor: driver.vehicleColor || '',
    driverPhotoURL: driver.driverPhotoURL || '',
    driverLatitude: driver.currentLatitude,
    driverLongitude: driver.currentLongitude,
    driverHeading: driver.currentHeading,
    driverSpeedKph: driver.currentSpeedKph,
    driverAccuracyMeters: driver.currentAccuracyMeters,
    driverLocationUpdatedAt: driver.lastLocationUpdatedAt ?? serverTimestamp(),
    acceptedByDriverAt: serverTimestamp(),
  });
}

export function getDeliveryOrderStatusLabel(status: DeliveryOrderStatus) {
  return deliveryOrderStatusLabels[status];
}

export function formatDeliveryDateTime(value?: unknown) {
  const millis = toMillis(value);

  if (!millis) {
    return 'Just now';
  }

  return new Date(millis).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function hasDeliveryOrderRating(order?: Pick<DeliveryOrder, 'customerRating'> | null) {
  return typeof order?.customerRating === 'number' && order.customerRating >= 1 && order.customerRating <= 5;
}

/** Ninunulie is WhatsApp + admin ops only — never live-tracked in the customer app. */
export function isNinunulieOrder(order?: Pick<DeliveryOrder, 'flow' | 'serviceLabel'> | null) {
  if (!order) return false;
  const flow = String(order.flow || '').trim().toLowerCase();
  if (flow === 'ninunulie') return true;
  return String(order.serviceLabel || '').trim().toLowerCase() === 'ninunulie';
}

function getDriverSearchExpiryMillis(order: DeliveryOrder) {
  // Bus/air (outside) parcels stay with the ops desk — never invent a driver-search timeout.
  if (isOutsideParcelOrder(order) || order.driverSearchStatus === 'ops_desk') {
    return 0;
  }

  const explicitExpiry = toMillis(order.driverSearchExpiresAt);
  if (explicitExpiry) {
    return explicitExpiry;
  }

  const createdAt = toMillis(order.createdAt);
  return createdAt ? createdAt + DRIVER_SEARCH_TIMEOUT_MS : 0;
}

function getDriverSearchWaitMinutes(order: DeliveryOrder) {
  const expiry = getDriverSearchExpiryMillis(order);
  if (!expiry) {
    return 0;
  }

  return Math.max(0, Math.ceil((expiry - Date.now()) / 60000));
}

function isDriverSearchExpired(order: DeliveryOrder) {
  const expiry = getDriverSearchExpiryMillis(order);
  return !!expiry && Date.now() >= expiry;
}

function isImmediatePendingWithoutDriver(order: DeliveryOrder) {
  if (isOutsideParcelOrder(order) || order.driverSearchStatus === 'ops_desk') {
    return false;
  }
  return order.status === 'pending_assignment' && !order.driverId && order.timingMode !== 'later';
}

async function recordDriverSearchActivity(order: DeliveryOrder, eventName: string, metadata?: Record<string, string | number | boolean | null | undefined>) {
  await recordAppActivity({
    userId: order.userId,
    userName: order.customerName || order.customerEmail || 'DoorDrop Customer',
    userRole: 'customer',
    eventName,
    featureKey: 'driver_matching',
    featureLabel: 'Driver matching',
    screen: 'dispatch',
    route: '/track-order',
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      serviceLabel: order.serviceLabel,
      vehicleType: order.cargoVehicleKey,
      vehicleLabel: order.cargoVehicleLabel,
      waitMinutesLeft: getDriverSearchWaitMinutes(order),
      ...metadata,
    },
  });
}

async function markOrderWaitingForDriver(order: DeliveryOrder, reason = 'No online nearby driver matched this order yet.') {
  if (!isImmediatePendingWithoutDriver(order)) {
    return;
  }

  const lastNoDriverAt = toMillis(order.noNearbyDriverAt);
  if (lastNoDriverAt && Date.now() - lastNoDriverAt < DRIVER_WAITING_UPDATE_THROTTLE_MS) {
    return;
  }

  await updateDoc(
    orderRef(order.id),
    compactFirestoreData({
      driverSearchStatus: 'waiting_for_driver',
      driverSearchMessage: `We are still looking for a nearby ${order.cargoVehicleLabel || order.serviceLabel} driver.`,
      noNearbyDriverAt: serverTimestamp(),
      noNearbyDriverReason: reason,
      updatedAt: serverTimestamp(),
    })
  );

  await recordDriverSearchActivity(order, 'no_nearby_driver', { reason });
}

export async function autoCancelOrderIfDriverSearchExpired(order: DeliveryOrder) {
  // Outside (bus/air) orders are managed by admin only — never auto-cancel.
  if (isOutsideParcelOrder(order) || order.driverSearchStatus === 'ops_desk') {
    return false;
  }

  if (!isImmediatePendingWithoutDriver(order) || !isDriverSearchExpired(order)) {
    return false;
  }

  await updateDoc(
    orderRef(order.id),
    compactFirestoreData({
      status: 'cancelled',
      cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON,
      cancelledBy: 'dispatch',
      cancelledAt: serverTimestamp(),
      driverSearchStatus: 'auto_cancelled',
      driverSearchMessage: 'We could not find an online nearby driver in time, so the order was cancelled automatically.',
      autoCancelledAt: serverTimestamp(),
      autoCancelledReason: DRIVER_SEARCH_TIMEOUT_REASON,
      updatedAt: serverTimestamp(),
    })
  );

  await Promise.all([
    createOrderStatusNotification({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      serviceLabel: order.serviceLabel,
      status: 'cancelled',
      cancellationReason: DRIVER_SEARCH_TIMEOUT_REASON,
      cancelledBy: 'dispatch',
    }).catch((error) => {
      logWarning(dataScope, 'autoCancelOrderIfDriverSearchExpired notification skipped', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
    recordDriverSearchActivity(order, 'order_auto_cancelled_no_driver', {
      reason: DRIVER_SEARCH_TIMEOUT_REASON,
    }).catch((error) => {
      logWarning(dataScope, 'autoCancelOrderIfDriverSearchExpired analytics skipped', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  ]);

  return true;
}

export async function autoAssignDriverToOrder(order: DeliveryOrder) {
  if (isOutsideParcelOrder(order) || order.fareType === 'negotiated') {
    return;
  }

  if (order.status !== 'pending_assignment' || order.timingMode === 'later') {
    return;
  }

  if (await autoCancelOrderIfDriverSearchExpired(order)) {
    return;
  }

  try {
    const pickupLat = Number(order.pickupLatitude);
    const pickupLng = Number(order.pickupLongitude);
    const nearbyCells = Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
      ? cellsNear(pickupLat, pickupLng, 6).slice(0, 9)
      : [];
    const driversQuery = nearbyCells.length
      ? query(
          driversCollection,
          where('isAvailable', '==', true),
          where('geohash', 'in', nearbyCells),
          firestoreLimit(32)
        )
      : query(driversCollection, where('isAvailable', '==', true), firestoreLimit(32));
    const driversSnapshot = await getDocs(driversQuery);
    const drivers = getSnapshotItems<DriverRecord>(driversSnapshot.docs);
    const bestMatch = await selectBestAssignableAutoMatch(order, drivers);

    if (!bestMatch) {
      await markOrderWaitingForDriver(order);
      logWarning(dataScope, 'autoAssignDriverToOrder skipped without fair match', {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
      return;
    }

    await assignDriverToOrder(order.id, bestMatch.driver.id, {
      mode: 'auto',
      score: bestMatch.match.score,
      reason: bestMatch.match.reason,
    });
  } catch (error) {
    logWarning(dataScope, 'autoAssignDriverToOrder failed', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput) {
  const nextOrderRef = doc(ordersCollection);
  const orderNumber = getGeneratedOrderNumber(nextOrderRef.id);
  const cargoVehicleKey = normalizeOrderVehicleKey(input.cargoVehicleKey);
  const cargoVehicleLabel = getVehicleLabelForKey(cargoVehicleKey, input.cargoVehicleLabel);

  const resolveExpressRouteForValidation = (routeId?: string) => {
    const normalizedId = String(routeId || '').trim();
    if (!normalizedId) {
      return null;
    }

    const parsed = parseOutsideExpressRouteId(normalizedId);
    if (!parsed) {
      return null;
    }

    return normalizeOutsideExpressRouteSchedule({
      id: normalizedId,
      originCityKey: parsed.originCityKey,
      destinationCityKey: parsed.destinationCityKey,
      departures: [],
    });
  };

  const resolveLabel = (label: string | undefined, latitude?: number, longitude?: number) => {
    const trimmed = String(label ?? '').trim();
    if (trimmed && !isWeakPlaceName(trimmed)) {
      return trimmed;
    }
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return formatExactCoordinateLabel({ latitude, longitude });
    }
    return trimmed || 'Selected place';
  };

  const pickupLabel = resolveLabel(input.pickupLabel, input.pickupLatitude, input.pickupLongitude);
  const dropoffLabel = resolveLabel(input.dropoffLabel, input.dropoffLatitude, input.dropoffLongitude);
  const outsideDestinationLabel = input.outsideDestinationLabel
    ? resolveLabel(
        input.outsideDestinationLabel,
        input.outsideDestinationLatitude,
        input.outsideDestinationLongitude
      )
    : input.outsideDestinationLabel;

  const isOutside = isOutsideParcelOrder({
    parcelScope: input.parcelScope,
    outsideDestinationCity: input.outsideDestinationCity,
    outsideDestinationLabel: outsideDestinationLabel,
    outsideShippingMode: input.outsideShippingMode,
  });

  if (isOutside && input.outsideShippingMode === 'express') {
    if (!input.outsideExpressDepartureId || !input.outsideExpressDepartureAtMs || input.outsideExpressDepartureAtMs <= 0) {
      throw new Error('Choose an available flight before placing this express parcel order.');
    }

    if (input.timingMode === 'later') {
      throw new Error('Express flight parcels must be collected now to meet the departure window.');
    }

    const expressRoute = resolveExpressRouteForValidation(input.outsideExpressRouteId);
    if (expressRoute) {
      assertExpressDepartureBookable({
        route: expressRoute,
        departureAtMs: input.outsideExpressDepartureAtMs,
        bookingCutoffAtMs: input.outsideExpressBookingCutoffAtMs,
        airportHandoffAtMs: input.outsideExpressAirportHandoffAtMs,
        firstMileDeadlineAtMs: input.outsideExpressFirstMileDeadlineAtMs,
        firstMileMinutes: resolveExpressFirstMileMinutes({
          route: expressRoute,
          routeDurationSeconds: input.durationSeconds,
        }),
      });
    } else {
      const now = Date.now();
      if (input.outsideExpressBookingCutoffAtMs && now >= input.outsideExpressBookingCutoffAtMs) {
        throw new Error('This flight booking window has closed. Choose another departure.');
      }
      if (input.outsideExpressFirstMileDeadlineAtMs && now >= input.outsideExpressFirstMileDeadlineAtMs) {
        throw new Error(
          'Not enough time to collect your parcel and deliver it to the airport before this flight. Choose a later departure.'
        );
      }
    }
  }

  const parcelCode = isOutside ? generateOutsideParcelCode(nextOrderRef.id) : undefined;
  const outsideOriginCity =
    isOutside &&
    typeof input.pickupLatitude === 'number' &&
    typeof input.pickupLongitude === 'number'
      ? getNearestServiceCity({
          latitude: input.pickupLatitude,
          longitude: input.pickupLongitude,
        }).label
      : isOutside
        ? 'Dar es Salaam'
        : undefined;
  const initialLogisticsEvent = isOutside
    ? makeLogisticsEvent(
        'awaiting_dispatch',
        'Order received. DoorDrop office will arrange pickup to the hub.',
        'system'
      )
    : undefined;
  const publicSummary =
    isOutside && parcelCode
      ? buildOutsideParcelPublicSummary({
          parcelCode,
          orderId: nextOrderRef.id,
          orderNumber,
          originCity: outsideOriginCity,
          destinationCity: input.outsideDestinationCity,
          destinationStand: input.outsideDestinationStand || outsideDestinationLabel,
          shippingMode: input.outsideShippingMode,
          handoffMode: input.outsideHandoffMode,
          weightKg: input.outsideParcelWeightKg,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          fareLabel: input.totalLabel || input.fareLabel,
          logisticsStatus: 'awaiting_dispatch',
        })
      : undefined;

  const order: Omit<DeliveryOrder, 'createdAt' | 'updatedAt' | 'assignedAt'> = {
    id: nextOrderRef.id,
    orderNumber,
    userId: input.userId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    flow: input.flow,
    serviceLabel: input.serviceLabel,
    status: 'pending_assignment',
    pickupLabel,
    dropoffLabel,
    pickupLatitude: input.pickupLatitude,
    pickupLongitude: input.pickupLongitude,
    dropoffLatitude: input.dropoffLatitude,
    dropoffLongitude: input.dropoffLongitude,
    driverDropoffLabel: input.driverDropoffLabel,
    driverDropoffLatitude: input.driverDropoffLatitude,
    driverDropoffLongitude: input.driverDropoffLongitude,
    outsideDestinationLabel,
    outsideDestinationCity: input.outsideDestinationCity,
    outsideDestinationStand: input.outsideDestinationStand,
    outsideDestinationLatitude: input.outsideDestinationLatitude,
    outsideDestinationLongitude: input.outsideDestinationLongitude,
    outsideParcelWeightKg: input.outsideParcelWeightKg,
    declaredValueTzs: input.declaredValueTzs,
    contentsDeclarationAccepted: input.contentsDeclarationAccepted === true ? true : undefined,
    contentsDeclarationAcceptedAt: input.contentsDeclarationAccepted === true ? serverTimestamp() : undefined,
    outsideShippingMode: input.outsideShippingMode,
    outsideHandoffMode: input.outsideHandoffMode,
    outsideOriginCity,
    parcelCode,
    trackingId: parcelCode,
    logisticsStatus: isOutside ? 'awaiting_dispatch' : undefined,
    logisticsEvents: initialLogisticsEvent ? [initialLogisticsEvent] : undefined,
    etaLabel: input.etaLabel,
    fareLabel: input.fareLabel,
    totalLabel: input.totalLabel,
    fareType: input.fareType,
    customerOffer: input.customerOffer,
    driverOffer: input.driverOffer,
    minFare: input.minFare,
    distanceKm: input.distanceKm,
    lastOfferBy: input.lastOfferBy,
    negotiationStatus: input.negotiationStatus,
    driverNegotiationUsed: input.driverNegotiationUsed,
    customerOfferNote: input.customerOfferNote,
    fareConfirmedAt: input.fareConfirmedAt,
    suggestedFare: input.suggestedFare,
    suggestedFareMin: input.suggestedFareMin,
    suggestedFareMax: input.suggestedFareMax,
    routeLabel: input.routeLabel || `${pickupLabel} to ${dropoffLabel}`,
    routeGeometry: input.routeGeometry,
    timingMode: input.timingMode,
    scheduleDate: input.scheduleDate,
    scheduleTime: input.scheduleTime,
    scheduleLabel: input.scheduleLabel,
    recipientName: input.recipientName,
    recipientPhone: input.recipientPhone,
    parcelScope: input.parcelScope,
    parcelTypeKey: input.parcelTypeKey,
    parcelTypeLabel: input.parcelTypeLabel,
    cargoVehicleKey,
    cargoVehicleLabel,
    cargoCapacityLabel: input.cargoCapacityLabel,
    cargoSizeLabel: input.cargoSizeLabel,
    cargoDriverHelp: input.cargoDriverHelp,
    cargoDriverHelpLabel: input.cargoDriverHelpLabel,
    distanceLabel: input.distanceLabel,
    durationLabel: input.durationLabel,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    requestedDriverId: input.requestedDriverId,
    requestedDriverName: input.requestedDriverName,
    assignmentMode: isOutside ? 'ops_desk' : undefined,
    driverSearchStatus: isOutside
      ? 'ops_desk'
      : input.timingMode === 'later'
        ? undefined
        : 'searching',
    driverSearchMessage: isOutside
      ? 'DoorDrop central office will assign a driver to collect your parcel.'
      : input.timingMode === 'later'
        ? undefined
        : input.flow === 'cargo' && input.fareType === 'negotiated'
          ? `Tunatafuta rider kwa bei yako ya ${input.fareLabel}.`
          : `Looking for the nearest online ${cargoVehicleLabel || input.serviceLabel} driver.`,
    driverSearchStartedAt: isOutside || input.timingMode === 'later' ? undefined : serverTimestamp(),
    driverSearchExpiresAt:
      isOutside || input.timingMode === 'later' ? undefined : new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
    ...(isOutside && typeof input.outsideExpressDepartureAtMs === 'number' && input.outsideExpressDepartureAtMs > 0
      ? {
          outsideExpressRouteId: input.outsideExpressRouteId,
          outsideExpressDepartureId: input.outsideExpressDepartureId,
          outsideExpressDepartureAt: new Date(input.outsideExpressDepartureAtMs),
          outsideExpressDepartureLabel: input.outsideExpressDepartureLabel,
          outsideExpressBookingCutoffAt:
            typeof input.outsideExpressBookingCutoffAtMs === 'number' && input.outsideExpressBookingCutoffAtMs > 0
              ? new Date(input.outsideExpressBookingCutoffAtMs)
              : undefined,
          outsideExpressAirportHandoffAt:
            typeof input.outsideExpressAirportHandoffAtMs === 'number' && input.outsideExpressAirportHandoffAtMs > 0
              ? new Date(input.outsideExpressAirportHandoffAtMs)
              : undefined,
          outsideExpressArrivalAt: new Date(
            input.outsideExpressDepartureAtMs +
              Math.max(1, input.outsideExpressArrivalOffsetMinutes ?? 30) * 60 * 1000
          ),
          outsideCountdownStartedAt: serverTimestamp(),
          outsideEtaDeadlineAt: new Date(
            typeof input.outsideExpressAirportHandoffAtMs === 'number' && input.outsideExpressAirportHandoffAtMs > 0
              ? input.outsideExpressAirportHandoffAtMs
              : input.outsideExpressDepartureAtMs - 90 * 60 * 1000
          ),
        }
      : isOutside && typeof input.durationSeconds === 'number' && input.durationSeconds > 0
        ? {
            outsideCountdownStartedAt: serverTimestamp(),
            outsideEtaDeadlineAt: new Date(Date.now() + input.durationSeconds * 1000),
          }
        : {}),
  };

  await setDoc(
    nextOrderRef,
    compactFirestoreData({
      ...order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  if (publicSummary && parcelCode) {
    try {
      await setDoc(
        doc(db, 'publicParcels', parcelCode),
        compactFirestoreData({
          ...publicSummary,
          parcelCode,
          orderId: nextOrderRef.id,
          orderNumber,
          originCity: outsideOriginCity,
          destinationCity: input.outsideDestinationCity,
          destinationStand: input.outsideDestinationStand || outsideDestinationLabel,
          shippingMode: input.outsideShippingMode,
          handoffMode: input.outsideHandoffMode,
          weightKg: input.outsideParcelWeightKg,
          recipientName: input.recipientName,
          recipientPhoneMasked: publicSummary.phone,
          fareLabel: input.totalLabel || input.fareLabel,
          logisticsStatus: 'awaiting_dispatch',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }),
        { merge: true }
      );
    } catch (error) {
      logWarning(dataScope, 'publicParcels write skipped', {
        orderId: nextOrderRef.id,
        parcelCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await createOrderStatusNotification({
      userId: order.userId,
      orderId: order.id,
      orderNumber,
      serviceLabel: order.serviceLabel,
      status: 'pending_assignment',
    });
  } catch (error) {
    logWarning(dataScope, 'createDeliveryOrder notification skipped after order save', {
      orderId: order.id,
      orderNumber,
      userId: order.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isOutside) {
    void autoAssignDriverToOrder(order);
  }

  return order;
}

export type CreateNinunulieOrderInput = {
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryLabel: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  itemTitle: string;
  itemDescription?: string;
  expectedPriceTzs?: string;
  productUrl?: string;
  photoUrls?: string[];
  sellerName: string;
  sellerPhone?: string;
  sellerRegion: string;
  sellerNotes?: string;
  customerNotes?: string;
  timingMode?: DeliveryTimingMode;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleLabel?: string;
  fulfillmentChannel?: 'whatsapp' | 'ops_desk';
};

const HAUL_SOURCE_PHONE = 'HAUL-SOURCE';

export async function createNinunulieOrder(input: CreateNinunulieOrderInput) {
  const userId = String(input.userId || '').trim();
  const customerPhone = String(input.customerPhone || '').trim();
  const itemTitle = String(input.itemTitle || '').trim();
  const sellerRegion = String(input.sellerRegion || '').trim();
  const deliveryLabel = String(input.deliveryLabel || '').trim();
  const requestedPhone = String(input.sellerPhone || '').trim();
  const opsSourced =
    input.fulfillmentChannel === 'ops_desk' ||
    !requestedPhone ||
    requestedPhone === HAUL_SOURCE_PHONE;
  const sellerPhone = opsSourced ? HAUL_SOURCE_PHONE : requestedPhone;
  const sellerName =
    String(input.sellerName || '').trim() ||
    (opsSourced ? `HAUL itatafuta · ${sellerRegion || 'Kariakoo'}` : '');

  if (!userId) {
    throw new Error('Ingia akaunti kabla ya kutuma oda ya Ninunulie.');
  }
  if (!customerPhone) {
    throw new Error('Weka namba yako ya simu.');
  }
  if (!itemTitle) {
    throw new Error('Eleza bidhaa unayotaka kununuliwa.');
  }
  if (!sellerName || !sellerRegion) {
    throw new Error('Chagua soko au duka.');
  }
  if (!deliveryLabel) {
    throw new Error('Chagua mahali pa kukabidhiwa.');
  }

  const nextOrderRef = doc(ordersCollection);
  const orderNumber = getGeneratedOrderNumber(nextOrderRef.id);
  const photoUrls = (input.photoUrls || []).map((url) => String(url || '').trim()).filter(Boolean);
  const expectedPrice = String(input.expectedPriceTzs || '').trim();
  const productUrl = String(input.productUrl || '').trim();
  const itemDescription = String(input.itemDescription || '').trim();
  const sellerNotes = String(input.sellerNotes || '').trim();
  const customerNotes = String(input.customerNotes || '').trim();
  const customerName = String(input.customerName || '').trim() || 'DoorDrop customer';
  const timingMode: DeliveryTimingMode = input.timingMode === 'later' ? 'later' : 'now';
  const scheduleDate = String(input.scheduleDate || '').trim();
  const scheduleTime = String(input.scheduleTime || '').trim();
  const scheduleLabel =
    String(input.scheduleLabel || '').trim() ||
    (timingMode === 'later' && scheduleDate
      ? `Ratiba · ${scheduleDate}${scheduleTime ? ` ${scheduleTime}` : ''}`
      : 'Sasa');

  const order: Omit<DeliveryOrder, 'createdAt' | 'updatedAt' | 'assignedAt'> = {
    id: nextOrderRef.id,
    orderNumber,
    userId,
    customerName,
    customerEmail: String(input.customerEmail || '').trim(),
    customerPhone,
    flow: 'ninunulie',
    serviceLabel: 'Ninunulie',
    status: 'pending_assignment',
    pickupLabel: `${sellerName} · ${sellerRegion}`,
    dropoffLabel: deliveryLabel,
    pickupLatitude: undefined,
    pickupLongitude: undefined,
    dropoffLatitude: input.deliveryLatitude,
    dropoffLongitude: input.deliveryLongitude,
    etaLabel: timingMode === 'later' ? scheduleLabel : 'Ops itakuhabarisha',
    fareLabel: expectedPrice ? `TZS ${expectedPrice}` : 'Bei baadaye',
    totalLabel: expectedPrice ? `TZS ${expectedPrice}` : 'Bei baadaye',
    routeLabel: `${sellerRegion} → ${deliveryLabel}`,
    timingMode,
    scheduleDate: timingMode === 'later' ? scheduleDate || undefined : undefined,
    scheduleTime: timingMode === 'later' ? scheduleTime || undefined : undefined,
    scheduleLabel,
    recipientName: customerName,
    recipientPhone: customerPhone,
    paymentMethod: 'mobile_money',
    paymentLabel: 'Malipo kwa namba ya duka',
    paymentProvider: 'phone',
    paymentType: 'agent_supervised',
    assignmentMode: 'ops_desk',
    driverSearchStatus: 'ops_desk',
    driverSearchMessage:
      'Oda inashughulikiwa na admin / agent. Haitatafutwa dereva otomatiki.',
    ninunulieItemTitle: itemTitle,
    ninunulieItemDescription: itemDescription || undefined,
    ninunulieExpectedPriceTzs: expectedPrice || undefined,
    ninunulieProductUrl: productUrl || undefined,
    ninunuliePhotoUrls: photoUrls.length ? photoUrls : undefined,
    ninunulieSellerName: sellerName,
    ninunulieSellerPhone: sellerPhone,
    ninunulieSellerRegion: sellerRegion,
    ninunulieSellerNotes: sellerNotes || undefined,
    ninunulieCustomerNotes: customerNotes || undefined,
    ninunulieFulfillmentChannel: opsSourced ? 'ops_desk' : input.fulfillmentChannel || 'whatsapp',
    ninunulieWhatsAppPhone: '0785019093',
  };

  await setDoc(
    nextOrderRef,
    compactFirestoreData({
      ...order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  try {
    await createOrderStatusNotification({
      userId,
      orderId: order.id,
      orderNumber,
      serviceLabel: 'Ninunulie',
      status: 'pending_assignment',
    });
  } catch (error) {
    logWarning(dataScope, 'createNinunulieOrder notification skipped after order save', {
      orderId: order.id,
      orderNumber,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await recordAppActivity({
      userId,
      userName: customerName,
      userRole: 'customer',
      eventName: 'order_created',
      featureKey: 'ninunulie',
      featureLabel: 'Ninunulie',
      screen: 'ninunulie',
      route: '/ninunulie',
      metadata: {
        orderId: order.id,
        orderNumber,
        sellerRegion,
      },
    });
  } catch {
    // non-blocking
  }

  return order;
}

/** Persist outside ETA countdown anchor once (survives track screen reopen). */
export async function ensureOutsideOrderCountdownAnchor(order: DeliveryOrder) {
  if (!isOutsideParcelOrder(order)) {
    return;
  }

  if (['delivered', 'cancelled'].includes(order.status)) {
    return;
  }

  if (toMillis(order.outsideEtaDeadlineAt) > 0) {
    return;
  }

  const durationSeconds =
    typeof order.durationSeconds === 'number' && order.durationSeconds > 0
      ? order.durationSeconds
      : getOutsideParcelDurationSecondsForOrder(order);

  if (durationSeconds <= 0) {
    return;
  }

  const startedAt = new Date();
  await updateDoc(
    orderRef(order.id),
    compactFirestoreData({
      outsideCountdownStartedAt: serverTimestamp(),
      outsideEtaDeadlineAt: new Date(startedAt.getTime() + durationSeconds * 1000),
      updatedAt: serverTimestamp(),
    })
  );
}

export function subscribeToOrders(
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const recentOrdersQuery = query(ordersCollection, orderBy('createdAt', 'desc'), firestoreLimit(RECENT_ORDERS_SUBSCRIPTION_LIMIT));

  return onSnapshot(
    recentOrdersQuery,
    (snapshot) => {
      callback(sortOrders(getSnapshotItems<DeliveryOrder>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToUserOrders(
  userId: string,
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const userOrdersQuery = query(
    ordersCollection,
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    firestoreLimit(USER_ORDERS_SUBSCRIPTION_LIMIT)
  );

  return onSnapshot(
    userOrdersQuery,
    (snapshot) => {
      callback(sortOrders(getSnapshotItems<DeliveryOrder>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToOrder(
  orderId: string,
  callback: (order: DeliveryOrder | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    orderRef(orderId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({ id: snapshot.id, ...(snapshot.data() as Omit<DeliveryOrder, 'id'>) });
    },
    (error) => onError?.(error)
  );
}

export type DriverLocationRecord = {
  id: string;
  latitude?: number;
  longitude?: number;
  heading?: number;
  updatedAt?: unknown;
};

export function subscribeToDriverLocations(
  callback: (locations: Record<string, DriverLocationRecord>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const locationsQuery = query(collection(db, 'driverLocations'), firestoreLimit(LIVE_DRIVER_SUBSCRIPTION_LIMIT));

  return onSnapshot(
    locationsQuery,
    (snapshot) => {
      const next: Record<string, DriverLocationRecord> = {};
      snapshot.docs.forEach((item) => {
        next[item.id] = { id: item.id, ...(item.data() as Omit<DriverLocationRecord, 'id'>) };
      });
      callback(next);
    },
    (error) => onError?.(error)
  );
}

export function mergeDriverLivePositions(
  drivers: DriverRecord[],
  locations: Record<string, DriverLocationRecord>
): DriverRecord[] {
  return drivers.map((driver) => {
    const live = locations[driver.id];
    const latitude = Number(live?.latitude ?? driver.currentLatitude);
    const longitude = Number(live?.longitude ?? driver.currentLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        ...driver,
        currentLatitude: undefined,
        currentLongitude: undefined,
      };
    }

    return {
      ...driver,
      currentLatitude: latitude,
      currentLongitude: longitude,
      currentHeading: Number.isFinite(Number(live?.heading ?? driver.currentHeading))
        ? Number(live?.heading ?? driver.currentHeading)
        : driver.currentHeading,
    };
  });
}

export function subscribeToDrivers(
  callback: (drivers: DriverRecord[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const availableDriversQuery = query(
    driversCollection,
    where('isAvailable', '==', true),
    firestoreLimit(LIVE_DRIVER_SUBSCRIPTION_LIMIT)
  );

  return onSnapshot(
    availableDriversQuery,
    (snapshot) => {
      callback(sortDrivers(getSnapshotItems<DriverRecord>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToDriver(
  driverId: string,
  callback: (driver: DriverRecord | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    driverRef(driverId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({ id: snapshot.id, ...(snapshot.data() as Omit<DriverRecord, 'id'>) });
    },
    (error) => onError?.(error)
  );
}

export function subscribeToOpenOrders(
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const openOrdersQuery = query(ordersCollection, where('status', '==', 'pending_assignment'));

  return onSnapshot(
    openOrdersQuery,
    (snapshot) => {
      callback(sortOrders(getSnapshotItems<DeliveryOrder>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToDriverOrders(
  driverId: string,
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const driverOrdersQuery = query(ordersCollection, where('driverId', '==', driverId));

  return onSnapshot(
    driverOrdersQuery,
    (snapshot) => {
      callback(sortOrders(getSnapshotItems<DeliveryOrder>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export async function createDriver(input: CreateDriverInput) {
  const nextDriverRef = doc(driversCollection);
  const vehicleType = normalizeOrderVehicleKey(input.vehicleType);
  const driver: Omit<DriverRecord, 'createdAt' | 'updatedAt'> = {
    id: nextDriverRef.id,
    fullName: input.fullName.trim(),
    phoneNumber: input.phoneNumber.trim(),
    vehicleType: (isCanonicalDriverVehicleType(vehicleType) ? vehicleType : input.vehicleType) as DriverVehicleType,
    vehicleLabel: input.vehicleLabel.trim() || getVehicleLabelForKey(vehicleType, 'Vehicle pending') || 'Vehicle pending',
    plateNumber: input.plateNumber.trim().toUpperCase(),
    isAvailable: true,
    currentOrderId: '',
  };

  await setDoc(
    nextDriverRef,
    compactFirestoreData({
      ...driver,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  return driver;
}

export async function registerDriver(input: RegisterDriverInput) {
  const nextDriverRef = driverRef(input.uid);
  const verificationStatus = input.verificationStatus || 'pending_admin_verification';
  const vehiclePhotoURL = input.verificationDocuments?.vehiclePhoto?.downloadURL || '';
  const driverPhotoURL = input.verificationDocuments?.driverPhoto?.downloadURL || '';
  const vehicleType = normalizeOrderVehicleKey(input.vehicleType);
  const driver: Omit<DriverRecord, 'createdAt' | 'updatedAt'> = {
    id: input.uid,
    authUid: input.uid,
    email: input.email?.trim().toLowerCase() || '',
    fullName: input.fullName.trim(),
    phoneNumber: input.phoneNumber.trim(),
    city: input.city?.trim() || '',
    gender: input.gender?.trim() || '',
    vehicleType: (isCanonicalDriverVehicleType(vehicleType) ? vehicleType : input.vehicleType) as DriverVehicleType,
    vehicleLabel: input.vehicleLabel.trim() || getVehicleLabelForKey(vehicleType, 'Vehicle pending') || 'Vehicle pending',
    vehicleColor: input.vehicleColor?.trim() || '',
    plateNumber: input.plateNumber.trim().toUpperCase(),
    verificationStatus,
    verificationDocuments: input.verificationDocuments,
    vehiclePhotoURL,
    driverPhotoURL,
    verificationSubmittedAt: serverTimestamp(),
    isAvailable: verificationStatus === 'verified',
    currentOrderId: '',
  };

  await setDoc(
    nextDriverRef,
    compactFirestoreData({
      ...driver,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );

  return driver;
}

export async function seedDemoDrivers() {
  const snapshot = await getDocs(driversCollection);
  if (!snapshot.empty) {
    return;
  }

  const starterDrivers: CreateDriverInput[] = [
    {
      fullName: 'Juma Kassim',
      phoneNumber: '+255754222333',
      vehicleType: 'bodaboda',
      vehicleLabel: 'Bodaboda / Motorcycle',
      plateNumber: 'MC 228 TZ',
    },
    {
      fullName: 'Neema David',
      phoneNumber: '+255742000777',
      vehicleType: 'toyo',
      vehicleLabel: 'TOYO',
      plateNumber: 'T 542 DDX',
    },
    {
      fullName: 'Shabani Ally',
      phoneNumber: '+255713884552',
      vehicleType: 'kirikuu',
      vehicleLabel: 'Kirikuu',
      plateNumber: 'T 884 CCF',
    },
  ];

  const batch = writeBatch(db);
  starterDrivers.forEach((driver) => {
    const nextDriverRef = doc(driversCollection);
    batch.set(nextDriverRef, {
      id: nextDriverRef.id,
      fullName: driver.fullName,
      phoneNumber: driver.phoneNumber,
      vehicleType: driver.vehicleType,
      vehicleLabel: driver.vehicleLabel,
      plateNumber: driver.plateNumber,
      isAvailable: true,
      currentOrderId: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

export async function setDriverAvailability(driverId: string, isAvailable: boolean) {
  await updateDoc(
    driverRef(driverId),
    compactFirestoreData({
      isAvailable,
      currentOrderId: isAvailable ? '' : undefined,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function assignDriverToOrder(
  orderId: string,
  driverId: string,
  assignment: { mode?: 'auto' | 'manual' | string; score?: number; reason?: string } = {}
) {
  const preflightDriverSnapshot = await getDoc(driverRef(driverId));
  if (!preflightDriverSnapshot.exists()) {
    throw new Error('Driver was not found.');
  }

  const preflightDriver = { id: preflightDriverSnapshot.id, ...(preflightDriverSnapshot.data() as Omit<DriverRecord, 'id'>) };
  await assertDriverHasAssignmentAccess(driverId, preflightDriver);

  let notificationUserId = '';
  let notificationOrderNumber = '';
  let notificationServiceLabel = '';
  let notificationDriverName = '';

  await runTransaction(db, async (transaction) => {
    const [orderSnapshot, driverSnapshot] = await Promise.all([
      transaction.get(orderRef(orderId)),
      transaction.get(driverRef(driverId)),
    ]);

    if (!orderSnapshot.exists()) {
      throw new Error('Order was not found.');
    }

    if (!driverSnapshot.exists()) {
      throw new Error('Driver was not found.');
    }

    const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
    const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };
    const isSameAssignment = order.driverId === driver.id && driver.currentOrderId === orderId;

    if (order.status !== 'pending_assignment' && order.driverId !== driver.id) {
      throw new Error('This order is no longer waiting for assignment.');
    }

    if (!isSameAssignment && (!driver.isAvailable || driver.currentOrderId)) {
      throw new Error('This driver is not available for a new order.');
    }

    if (!isDriverVerifiedForDispatch(driver)) {
      throw new Error('This driver account is waiting for admin verification.');
    }

    if (!driverSupportsOrder(driver, order)) {
      throw new Error(`${getVehicleLabelForKey(driver.vehicleType, driver.vehicleLabel) || 'This driver'} cannot receive ${getVehicleLabelForKey(order.cargoVehicleKey, order.serviceLabel) || order.serviceLabel} orders.`);
    }

    if (order.driverId && order.driverId !== driver.id) {
      transaction.update(driverRef(order.driverId), {
        isAvailable: true,
        currentOrderId: '',
        updatedAt: serverTimestamp(),
      });
    }

    const driverPayload = buildDriverAssignmentPayload(driver);
    if (order.fareType === 'negotiated') {
      delete driverPayload.acceptedByDriverAt;
    }
    transaction.update(orderRef(orderId), compactFirestoreData({
      status: 'driver_assigned',
      ...driverPayload,
      assignmentMode: assignment.mode || 'manual',
      assignmentScore: Number.isFinite(assignment.score) ? Math.round(Number(assignment.score) * 100) / 100 : undefined,
      assignmentReason: assignment.reason?.trim() || undefined,
      driverSearchStatus: 'assigned',
      driverSearchMessage: `${driver.fullName} has been assigned to this order.`,
      driverSearchResolvedAt: serverTimestamp(),
      assignedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));

    transaction.update(driverRef(driver.id), {
      isAvailable: false,
      currentOrderId: orderId,
      assignmentCount: increment(1),
      lastAssignedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    notificationUserId = order.userId;
    notificationOrderNumber = order.orderNumber;
    notificationServiceLabel = order.serviceLabel;
    notificationDriverName = driver.fullName;
  });

  try {
    await createOrderStatusNotification({
      userId: notificationUserId,
      orderId,
      orderNumber: notificationOrderNumber,
      serviceLabel: notificationServiceLabel,
      status: 'driver_assigned',
      driverName: notificationDriverName,
    });
  } catch (error) {
    logWarning(dataScope, 'assignDriverToOrder notification skipped after assignment save', {
      orderId,
      driverId,
      userId: notificationUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function acceptDeliveryOrder(orderId: string, driverId: string) {
  await assignDriverToOrder(orderId, driverId);
}

export async function unassignDriverFromOrder(orderId: string) {
  const orderSnapshot = await getDoc(orderRef(orderId));

  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  const batch = writeBatch(db);

  batch.update(orderRef(orderId), compactFirestoreData({
    status: 'pending_assignment',
    driverSearchStatus: order.timingMode === 'later' ? undefined : 'searching',
    driverSearchMessage: order.timingMode === 'later'
      ? undefined
      : `Looking for the nearest online ${order.cargoVehicleLabel || order.serviceLabel} driver.`,
    driverSearchStartedAt: order.timingMode === 'later' ? undefined : serverTimestamp(),
    driverSearchExpiresAt: order.timingMode === 'later' ? undefined : new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
    driverSearchResolvedAt: deleteField(),
    noNearbyDriverAt: deleteField(),
    noNearbyDriverReason: deleteField(),
    autoCancelledAt: deleteField(),
    autoCancelledReason: deleteField(),
    updatedAt: serverTimestamp(),
    ...clearDriverAssignmentFields(),
  }));

  if (order.driverId) {
    batch.update(driverRef(order.driverId), {
      isAvailable: true,
      currentOrderId: '',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  try {
    await createOrderStatusNotification({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      serviceLabel: order.serviceLabel,
      status: 'pending_assignment',
    });
  } catch (error) {
    logWarning(dataScope, 'unassignDriverFromOrder notification skipped after status save', {
      orderId: order.id,
      userId: order.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateCargoNegotiation(
  orderId: string,
  patch: {
    customerOffer?: number;
    driverOffer?: number;
    lastOfferBy?: 'customer' | 'driver';
    fareLabel?: string;
    totalLabel?: string;
    negotiationStatus?: 'open' | 'confirmed';
    fareConfirmedAt?: unknown;
    cargoVehicleKey?: string;
    cargoVehicleLabel?: string;
    serviceLabel?: string;
    customerOfferNote?: string;
    customerPhone?: string;
    recipientPhone?: string;
  }
) {
  const confirming = patch.negotiationStatus === 'confirmed';
  const orderSnapshot = confirming ? await getDoc(orderRef(orderId)) : null;
  const order = orderSnapshot?.exists()
    ? ({ id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) })
    : null;
  const agreedAmount =
    confirming && typeof patch.customerOffer === 'number' && patch.customerOffer > 0
      ? patch.customerOffer
      : confirming && typeof order?.driverOffer === 'number' && order.driverOffer > 0
        ? order.driverOffer
        : undefined;
  const phase = order ? cargoAgreementPhase(order) : 'open';
  const canAcceptNow = phase === 'open' || phase === 'negotiating';

  await updateDoc(orderRef(orderId), compactFirestoreData({
    ...patch,
    customerOffer: agreedAmount ?? patch.customerOffer,
    driverOffer: confirming ? agreedAmount ?? patch.driverOffer ?? order?.driverOffer : patch.driverOffer,
    status: confirming && canAcceptNow ? 'driver_assigned' : undefined,
    fareConfirmedAt:
      confirming ? patch.fareConfirmedAt || serverTimestamp() : patch.fareConfirmedAt,
    updatedAt: serverTimestamp(),
  }));
}

export async function updateDeliveryOrderStatus(orderId: string, status: DeliveryOrderStatus) {
  if (status === 'pending_assignment') {
    await unassignDriverFromOrder(orderId);
    return;
  }

  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (order.status === status) {
    return;
  }

  if (!order.driverId && ['driver_assigned', 'driver_at_pickup', 'in_transit', 'delivered'].includes(status)) {
    throw new Error('Assign a driver before moving this order forward.');
  }

  const batch = writeBatch(db);
  batch.update(orderRef(orderId), {
    status,
    updatedAt: serverTimestamp(),
  });

  if ((status === 'delivered' || status === 'cancelled') && order.driverId) {
    batch.update(driverRef(order.driverId), {
      isAvailable: true,
      currentOrderId: '',
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  try {
    await createOrderStatusNotification({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      serviceLabel: order.serviceLabel,
      status,
      driverName: order.driverName,
    });
  } catch (error) {
    logWarning(dataScope, 'updateDeliveryOrderStatus notification skipped after status save', {
      orderId: order.id,
      status,
      userId: order.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function submitDeliveryOrderRating(input: {
  orderId: string;
  userId: string;
  rating: number;
  review?: string;
}) {
  const orderSnapshot = await getDoc(orderRef(input.orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  const normalizedRating = Math.round(Number(input.rating));
  const trimmedReview = input.review?.trim() || '';

  if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    throw new Error('Choose a rating from 1 to 5 stars.');
  }

  if (order.userId !== input.userId) {
    throw new Error('Only the customer who placed this order can submit a rating.');
  }

  if (order.status !== 'delivered') {
    throw new Error('You can rate this order after it has been delivered.');
  }

  const batch = writeBatch(db);
  batch.update(
    orderRef(input.orderId),
    compactFirestoreData({
      customerRating: normalizedRating,
      customerReview: trimmedReview || deleteField(),
      customerRatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  if (order.driverId) {
    const driverSnapshot = await getDoc(driverRef(order.driverId));
    const driver = driverSnapshot.exists() ? driverSnapshot.data() as DriverRecord : null;
    const previousRating = Number(order.customerRating);
    const hadPreviousRating = Number.isFinite(previousRating) && previousRating >= 1 && previousRating <= 5;
    const currentTotal = Number(driver?.ratingTotal ?? 0);
    const currentCount = Number(driver?.ratingCount ?? 0);
    const nextTotal = Math.max(0, currentTotal - (hadPreviousRating ? previousRating : 0) + normalizedRating);
    const nextCount = Math.max(1, currentCount + (hadPreviousRating ? 0 : 1));

    batch.set(
      driverRef(order.driverId),
      {
        ratingTotal: nextTotal,
        ratingCount: nextCount,
        reviewCount: nextCount,
        ratingAverage: Math.round((nextTotal / nextCount) * 100) / 100,
        lastCustomerRating: normalizedRating,
        lastCustomerReview: trimmedReview || deleteField(),
        lastCustomerRatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

export async function cancelDeliveryOrderByUser(orderId: string, reason: string) {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 4) {
    throw new Error('Enter a short reason before cancelling the order.');
  }

  const orderSnapshot = await getDoc(orderRef(orderId));
  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (order.status === 'delivered') {
    throw new Error('Delivered orders cannot be cancelled.');
  }

  if (order.status === 'cancelled') {
    return;
  }

  const batch = writeBatch(db);
  batch.update(orderRef(orderId), {
    status: 'cancelled',
    cancellationReason: trimmedReason,
    cancelledBy: 'customer',
    cancelledAt: serverTimestamp(),
    driverSearchMessage: 'This order was cancelled by the customer.',
    driverSearchResolvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (order.driverId) {
    batch.update(driverRef(order.driverId), {
      isAvailable: true,
      currentOrderId: '',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  void createOrderStatusNotification({
    userId: order.userId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    serviceLabel: order.serviceLabel,
    status: 'cancelled',
    driverName: order.driverName,
    cancellationReason: trimmedReason,
    cancelledBy: 'customer',
  }).catch(() => undefined);
}

export async function updateDriverLocation(driverId: string, location: UpdateDriverLocationInput) {
  const driverSnapshot = await getDoc(driverRef(driverId));

  if (!driverSnapshot.exists()) {
    throw new Error('Driver was not found.');
  }

  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };
  const geohash = encodeGeohash(location.latitude, location.longitude, 6);
  const heartbeatDue = Date.now() - toMillis(driver.lastLocationUpdatedAt) >= DRIVER_DOC_HEARTBEAT_MS;
  const cellChanged = geohash !== driver.geohash;

  await setDoc(
    driverLocationRef(driverId),
    compactFirestoreData({
      latitude: location.latitude,
      longitude: location.longitude,
      heading: location.heading,
      speedKph: location.speedKph,
      accuracyMeters: location.accuracyMeters,
      geohash,
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );

  if (cellChanged || heartbeatDue || !driver.geohash) {
    await updateDoc(
      driverRef(driverId),
      compactFirestoreData({
        currentLatitude: location.latitude,
        currentLongitude: location.longitude,
        currentHeading: location.heading,
        currentSpeedKph: location.speedKph,
        currentAccuracyMeters: location.accuracyMeters,
        geohash,
        lastLocationUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  if (!driver.currentOrderId) {
    return;
  }

  await updateDoc(
    orderRef(driver.currentOrderId),
    compactFirestoreData({
      driverLatitude: location.latitude,
      driverLongitude: location.longitude,
      driverHeading: location.heading,
      driverSpeedKph: location.speedKph,
      driverAccuracyMeters: location.accuracyMeters,
      driverLocationUpdatedAt: serverTimestamp(),
    })
  );
}
