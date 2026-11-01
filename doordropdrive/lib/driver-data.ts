import {
  collection,
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  increment,
  limit as firestoreLimit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { canonicalCargoVehicleKey, cargoAgreementPhase } from './cargo-order-agreement';
import { compactFirestoreData } from './firestore-payload';
import { encodeGeohash } from './geohash';
import { db } from './firebase';
import { getAccessBillingPeriodKey, getDriverAccessPlan, getTanzaniaDateKey, isDriverSubscriptionActive, resolveAccessPaymentDuePatch } from './driver-access';
import { getOutsideParcelDurationSecondsForOrder } from './outside-parcel-eta';

export { isDriverSubscriptionActive };

export type DriverVehicleType = 'bodaboda' | 'kirikuu' | 'toyo' | 'toyo_electric' | 'canter';
export type DriverVerificationStatus = 'pending_admin_verification' | 'verified' | 'rejected';
export type DriverVerificationDocumentKey = 'vehiclePhoto' | 'driverPhoto';
export type DriverVerificationDocument = {
  uri?: string;
  fileName?: string | null;
  mimeType?: string | null;
  downloadURL?: string;
  storagePath?: string;
  uploadedAt?: string;
  uploadStatus?: 'uploaded' | 'pending_upload' | 'not_submitted';
  uploadNote?: string;
};

function serializeVerificationDocument(document?: DriverVerificationDocument | null) {
  if (!document) {
    return {
      uploadStatus: 'not_submitted' as const,
    };
  }

  return compactFirestoreData({
    fileName: document.fileName || undefined,
    mimeType: document.mimeType || undefined,
    downloadURL: document.downloadURL || '',
    storagePath: document.storagePath || undefined,
    uploadedAt: document.uploadedAt || undefined,
    uploadStatus: document.uploadStatus || (document.downloadURL ? 'uploaded' : 'pending_upload'),
    uploadNote: document.uploadNote || undefined,
  });
}

function serializeVerificationDocuments(
  documents?: Partial<Record<DriverVerificationDocumentKey, DriverVerificationDocument | null>>
) {
  return {
    vehiclePhoto: serializeVerificationDocument(documents?.vehiclePhoto),
    driverPhoto: serializeVerificationDocument(documents?.driverPhoto),
  };
}
export type DeliveryOrderStatus =
  | 'pending_assignment'
  | 'driver_assigned'
  | 'driver_at_pickup'
  | 'in_transit'
  | 'at_hub'
  | 'delivered'
  | 'cancelled';

export type DeliveryOrder = {
  id: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
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
  parcelScope?: string;
  outsideShippingMode?: string;
  outsideHandoffMode?: string;
  outsidePickupAt?: unknown;
  outsideEtaDeadlineAt?: unknown;
  parcelCode?: string;
  logisticsStatus?: string;
  logisticsEvents?: Array<{ status?: string; note?: string; by?: string; at?: unknown }>;
  etaLabel: string;
  fareLabel: string;
  totalLabel: string;
  fareType?: 'algorithm' | 'negotiated';
  customerOffer?: number;
  driverOffer?: number;
  minFare?: number;
  distanceKm?: number;
  lastOfferBy?: 'customer' | 'driver';
  negotiationStatus?: 'open' | 'confirmed' | string;
  driverNegotiationUsed?: number;
  driverOfferNote?: string;
  customerOfferNote?: string;
  cargoSizeLabel?: string;
  cargoVehicleKey?: string;
  cargoVehicleLabel?: string;
  flow?: string;
  scheduleLabel: string;
  recipientName: string;
  recipientPhone: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverVehicleType?: DriverVehicleType;
  driverVehicleLabel?: string;
  driverPlateNumber?: string;
  driverLatitude?: number;
  driverLongitude?: number;
  driverHeading?: number;
  driverSpeedKph?: number;
  driverAccuracyMeters?: number;
  driverLocationUpdatedAt?: unknown;
  cancellationReason?: string;
  cancelledBy?: 'customer' | 'driver' | 'dispatch';
  cancelledAt?: unknown;
  acceptedByDriverAt?: unknown;
  assignedAt?: unknown;
  deliveredAt?: unknown;
  declinedDriverIds?: string[];
  lastDeclinedByDriverId?: string;
  lastDeclinedAt?: unknown;
  assignmentMode?: string;
  driverGrossEarnings?: number;
  haulFee?: number;
  haulFeeRate?: number;
  commissionPaidTzs?: number;
  cashStatus?: 'unpaid' | 'reconciled' | string;
  commissionPaymentId?: string;
  adminCommissionRate?: number;
  adminCommissionDue?: number;
  driverCommissionPaidAt?: unknown;
  driverCommissionPaymentId?: string;
  driverCustomerRating?: number;
  driverCustomerRatingComment?: string;
  driverCustomerRatedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type DriverRecord = {
  id: string;
  authUid?: string;
  email?: string;
  fullName: string;
  phoneNumber: string;
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
  latestPushToken?: string;
  pushTokenPlatform?: string;
  pushTokenUpdatedAt?: unknown;
  isAvailable: boolean;
  isPriorityDriver?: boolean;
  priorityDriverUpdatedAt?: unknown;
  priorityDriverUpdatedBy?: string;
  priorityDriverUpdatedByEmail?: string;
  currentOrderId?: string;
  currentLatitude?: number;
  currentLongitude?: number;
  currentHeading?: number;
  currentSpeedKph?: number;
  currentAccuracyMeters?: number;
  geohash?: string;
  lastLocationUpdatedAt?: unknown;
  appOpenCount?: number;
  lastActiveAt?: unknown;
  driverScore?: number;
  rejectionCount?: number;
  cancellationCount?: number;
  disciplinePoints?: number;
  completedOrderCount?: number;
  dailyCompletedOrderCount?: number;
  dailyCompletedDateKey?: string;
  weeklyCompletedOrderCount?: number;
  weeklyCompletedWeekKey?: string;
  suspensionUntil?: number;
  commissionDueDateKey?: string;
  commissionDueEarningsTzs?: number;
  commissionDueTzs?: number;
  unpaidCommissionTzs?: number;
  commissionPayCeilingTzs?: number;
  commissionLocked?: boolean;
  commissionFeeRate?: number;
  commissionStatus?: string;
  commissionPaidDateKey?: string;
  commissionPayment?: {
    orderId?: string;
    status?: string;
    amount?: number;
  };
  commissionStatus?: 'due' | 'pending' | 'paid' | string;
  commissionPaidDateKey?: string;
  lastCommissionPaymentDateKey?: string;
  lastCommissionPaidAt?: unknown;
  lastCommissionPaidAmount?: number;
  totalCommissionPaid?: number;
  subscriptionPaidUntil?: unknown;
  accessPaymentDuePeriodKey?: string;
  subscriptionTrialStartedAt?: unknown;
  subscriptionTrialEndsAt?: unknown;
  subscriptionStatus?: string;
  lastSubscriptionPaymentStatus?: string;
  lastSubscriptionPaymentSubmittedAt?: unknown;
  lastSubscriptionPaymentId?: string;
  lastSubscriptionPaymentAmount?: number;
  lastSubscriptionPaymentGatewayRef?: string;
  lastSubscriptionPaymentReceiptNumber?: string;
  lastSubscriptionPaymentExpiresAt?: unknown;
  totalSubscriptionPaid?: number;
  acceptedTerms?: boolean;
  acceptedTermsAt?: unknown;
  acceptedTermsVersion?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type RegisterDriverInput = {
  uid: string;
  email?: string;
  fullName: string;
  phoneNumber: string;
  vehicleType: DriverVehicleType;
  vehicleLabel: string;
  vehicleColor?: string;
  plateNumber: string;
  verificationStatus?: DriverVerificationStatus;
  verificationDocuments?: Partial<Record<DriverVerificationDocumentKey, DriverVerificationDocument | null>>;
  acceptedTerms?: boolean;
  acceptedTermsVersion?: string;
};

export type UpdateDriverLocationInput = {
  latitude: number;
  longitude: number;
  heading?: number;
  speedKph?: number;
  accuracyMeters?: number;
};

const ordersCollection = collection(db, 'orders');
const commissionPaymentReviewsCollection = collection(db, 'commissionPaymentReviews');
const userNotificationsCollection = collection(db, 'userNotifications');
const usersCollection = collection(db, 'users');
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TANZANIA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DRIVER_SEARCH_TIMEOUT_MS = 1000 * 60 * 10;
const DRIVER_APP_ONLINE_REFRESH_MS = 1000 * 60 * 15;
const DRIVER_ORDER_FEED_LIMIT = 80;
const DRIVER_DOC_HEARTBEAT_MS = 45 * 1000;

function normalizeDriverVehicleType(vehicleType: DriverVehicleType | string): DriverVehicleType {
  const normalized = String(vehicleType || '').trim().toLowerCase();
  const aliases: Record<string, DriverVehicleType> = {
    bodaboda: 'toyo',
    boda: 'toyo',
    pikipiki: 'toyo',
    motorcycle: 'toyo',
    motorbike: 'toyo',
    bike: 'toyo',
    toyo_electric: 'toyo_electric',
    'toyo-electric': 'toyo_electric',
    toyoelectric: 'toyo_electric',
    electric_toyo: 'toyo_electric',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    kirikuu: 'kirikuu',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  };

  return aliases[normalized] || 'toyo';
}

const deliveryOrderStatusLabels: Record<DeliveryOrderStatus, string> = {
  pending_assignment: 'Waiting for driver',
  driver_assigned: 'Driver assigned',
  driver_at_pickup: 'Driver at pickup',
  in_transit: 'In transit',
  at_hub: 'Delivered to DoorDrop office',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function isOutsideParcelOrder(order: {
  parcelScope?: string | null;
  outsideDestinationCity?: string | null;
  outsideDestinationLabel?: string | null;
  outsideShippingMode?: string | null;
}) {
  if (String(order.parcelScope || '').trim().toLowerCase() === 'outside') {
    return true;
  }
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

function orderRef(orderId: string) {
  return doc(db, 'orders', orderId);
}

function driverRef(driverId: string) {
  return doc(db, 'drivers', driverId);
}

function driverLocationRef(driverId: string) {
  return doc(db, 'driverLocations', driverId);
}

function driverCommissionPaymentRef(driverId: string) {
  return doc(collection(driverRef(driverId), 'commissionPayments'));
}

function commissionPaymentReviewRef(paymentId: string) {
  return doc(commissionPaymentReviewsCollection, paymentId);
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

function parseAmountFromLabel(label?: string) {
  const digits = (label || '').replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
}

function getNextSubscriptionPeriodStartMillis() {
  return getTanzaniaWeekStartMillis();
}

function getNextSubscriptionPaidUntilMillis() {
  return getNextTanzaniaSundayStartMillis();
}

function getSnapshotItems<T extends { id: string }>(
  items: { id: string; data: () => Record<string, unknown> }[]
) {
  return items.map((item) => ({ id: item.id, ...item.data() })) as T[];
}

function isDriverVerifiedForDispatch(driver: Partial<DriverRecord>) {
  return !driver.verificationStatus || driver.verificationStatus === 'verified';
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

async function canSendOrderNotification(userId: string) {
  const userSnapshot = await getDoc(doc(usersCollection, userId));
  const preferences = userSnapshot.data()?.notificationPreferences as
    | {
        orderUpdates?: boolean;
      }
    | undefined;

  return preferences?.orderUpdates !== false;
}

function getOrderStatusNotificationCopy(input: {
  orderNumber: string;
  status: DeliveryOrderStatus;
  driverName?: string;
}) {
  if (input.status === 'driver_assigned') {
    return {
      title: 'Driver assigned',
      message: `${input.driverName || 'A driver'} has been assigned to ${input.orderNumber}.`,
    };
  }

  if (input.status === 'driver_at_pickup') {
    return {
      title: 'Driver reached pickup',
      message: `${input.orderNumber} has reached the pickup point and loading can begin.`,
    };
  }

  if (input.status === 'in_transit') {
    return {
      title: 'Order in transit',
      message: `${input.orderNumber} is now on the road to the drop-off.`,
    };
  }

  if (input.status === 'delivered') {
    return {
      title: 'Order delivered',
      message: `${input.orderNumber} was marked delivered successfully.`,
    };
  }

  return {
    title: 'Order cancelled',
    message: `${input.orderNumber} was cancelled. Contact support if this was unexpected.`,
  };
}

async function createOrderStatusNotification(input: {
  userId: string;
  orderId: string;
  orderNumber: string;
  status: DeliveryOrderStatus;
  driverName?: string;
}) {
  if (!(await canSendOrderNotification(input.userId))) {
    return;
  }

  const nextNotificationRef = doc(userNotificationsCollection);
  const copy = getOrderStatusNotificationCopy(input);

  await setDoc(
    nextNotificationRef,
    compactFirestoreData({
      userId: input.userId,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      orderStatus: input.status,
      title: copy.title,
      message: copy.message,
      type: input.status === 'pending_assignment' ? 'order_created' : 'order_status',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
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

export function subscribeToDriverOrders(
  driverId: string,
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const driverOrdersQuery = query(ordersCollection, where('driverId', '==', driverId), firestoreLimit(DRIVER_ORDER_FEED_LIMIT));

  return onSnapshot(
    driverOrdersQuery,
    (snapshot) => {
      callback(sortOrders(getSnapshotItems<DeliveryOrder>(snapshot.docs)));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToOpenCargoOffers(
  vehicleType: string,
  callback: (orders: DeliveryOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const vehicleKey = canonicalCargoVehicleKey(vehicleType);
  const openOffersQuery = query(
    ordersCollection,
    where('status', '==', 'pending_assignment'),
    firestoreLimit(40)
  );

  return onSnapshot(
    openOffersQuery,
    (snapshot) => {
      const offers = getSnapshotItems<DeliveryOrder>(snapshot.docs).filter((order) => {
        if (!vehicleKey) {
          return false;
        }
        // Instant verify flow assigns over WebSocket — do not show in open pool.
        if (String(order.assignmentMode || '') === 'cargo_ws') {
          return false;
        }
        if (order.fareType !== 'negotiated' || order.negotiationStatus === 'confirmed') {
          return false;
        }
        if (order.driverId) {
          return false;
        }
        if (cargoAgreementPhase(order) !== 'open') {
          return false;
        }
        return canonicalCargoVehicleKey(order.cargoVehicleKey) === vehicleKey;
      });
      callback(sortOrders(offers));
    },
    (error) => onError?.(error)
  );
}

export function subscribeToDeliveryOrder(
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

export async function registerDriver(input: RegisterDriverInput) {
  const nextDriverRef = driverRef(input.uid);
  const verificationStatus = input.verificationStatus || 'pending_admin_verification';
  const vehiclePhotoURL = input.verificationDocuments?.vehiclePhoto?.downloadURL || '';
  const driverPhotoURL = input.verificationDocuments?.driverPhoto?.downloadURL || '';
  const vehicleType = normalizeDriverVehicleType(input.vehicleType);
  const driver: Omit<DriverRecord, 'createdAt' | 'updatedAt'> = {
    id: input.uid,
    authUid: input.uid,
    email: input.email?.trim().toLowerCase() || '',
    fullName: input.fullName.trim(),
    phoneNumber: input.phoneNumber.trim(),
    vehicleType,
    vehicleLabel: input.vehicleLabel.trim() || vehicleType,
    vehicleColor: input.vehicleColor?.trim() || '',
    plateNumber: input.plateNumber.trim().toUpperCase(),
    verificationStatus,
    verificationDocuments: serializeVerificationDocuments(input.verificationDocuments),
    vehiclePhotoURL,
    driverPhotoURL,
    verificationSubmittedAt: serverTimestamp(),
    isAvailable: false,
    currentOrderId: '',
    rejectionCount: 0,
    cancellationCount: 0,
    completedOrderCount: 0,
    subscriptionStatus: 'unpaid',
    acceptedTerms: Boolean(input.acceptedTerms),
    acceptedTermsAt: input.acceptedTerms ? serverTimestamp() : undefined,
    acceptedTermsVersion: input.acceptedTermsVersion || '',
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

export async function recordDriverAppOpen(input: {
  uid: string;
  email?: string;
  fullName?: string;
  phoneNumber?: string;
  latitude?: number;
  longitude?: number;
}) {
  await setDoc(
    driverRef(input.uid),
    compactFirestoreData({
      id: input.uid,
      authUid: input.uid,
      email: input.email?.trim().toLowerCase() || '',
      fullName: input.fullName?.trim() || 'DoorDrop driver',
      phoneNumber: input.phoneNumber?.trim() || '',
      appOpenCount: increment(1),
      appOnline: true,
      appOnlineUntil: new Date(Date.now() + DRIVER_APP_ONLINE_REFRESH_MS),
      lastActiveAt: serverTimestamp(),
      currentLatitude: input.latitude,
      currentLongitude: input.longitude,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

export async function setDriverAvailability(driverId: string, isAvailable: boolean) {
  const driverSnapshot = await getDoc(driverRef(driverId));
  const driver = driverSnapshot.exists() ? driverSnapshot.data() as DriverRecord : null;

  if (isAvailable) {
    if (driver && !isDriverVerifiedForDispatch(driver)) {
      throw new Error('Your DoorDrop Drive account is waiting for admin verification.');
    }
  }

  await updateDoc(
    driverRef(driverId),
    compactFirestoreData({
      isAvailable,
      currentOrderId: isAvailable ? '' : undefined,
      geohash:
        isAvailable && driver && Number.isFinite(Number(driver.currentLatitude)) && Number.isFinite(Number(driver.currentLongitude))
          ? encodeGeohash(Number(driver.currentLatitude), Number(driver.currentLongitude), 6)
          : undefined,
      appOnline: true,
      appOnlineUntil: isAvailable ? new Date(Date.now() + DRIVER_APP_ONLINE_REFRESH_MS) : undefined,
      lastActiveAt: isAvailable ? serverTimestamp() : undefined,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function saveDriverPushToken(driverId: string, token: string, platform: string) {
  await saveDriverPushTokens(driverId, {
    latestPushToken: token,
    platform,
  });
}

export async function saveDriverPushTokens(
  driverId: string,
  tokens: {
    expoPushToken?: string;
    fcmToken?: string;
    latestPushToken: string;
    platform: string;
  }
) {
  await updateDoc(
    driverRef(driverId),
    compactFirestoreData({
      expoPushToken: tokens.expoPushToken || undefined,
      fcmToken: tokens.fcmToken || undefined,
      latestPushToken: tokens.latestPushToken,
      pushTokenPlatform: tokens.platform,
      pushPlatform: tokens.platform,
      pushTokenUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export async function acceptDriverOrder(driverId: string, orderId: string) {
  const [orderSnapshot, driverSnapshot] = await Promise.all([getDoc(orderRef(orderId)), getDoc(driverRef(driverId))]);

  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  if (!driverSnapshot.exists()) {
    throw new Error('Driver profile was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (order.driverId !== driverId) {
    throw new Error('This order is assigned to a different driver.');
  }

  if (order.status !== 'driver_assigned') {
    throw new Error('Only newly assigned orders can be accepted.');
  }

  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };
  if (!isDriverVerifiedForDispatch(driver)) {
    throw new Error('This driver account is waiting for admin verification.');
  }

  const agreedFare =
    order.fareType === 'negotiated'
      ? order.lastOfferBy === 'driver' && typeof order.driverOffer === 'number' && order.driverOffer > 0
        ? order.driverOffer
        : typeof order.customerOffer === 'number' && order.customerOffer > 0
          ? order.customerOffer
          : undefined
      : undefined;
  const agreedFareLabel =
    typeof agreedFare === 'number' ? `TZS ${Math.round(agreedFare).toLocaleString('en-US')}` : undefined;

  const batch = writeBatch(db);
  batch.update(
    orderRef(orderId),
    compactFirestoreData({
      acceptedByDriverAt: serverTimestamp(),
      status: 'driver_assigned',
      negotiationStatus: order.fareType === 'negotiated' ? 'confirmed' : order.negotiationStatus,
      customerOffer: order.fareType === 'negotiated' ? agreedFare : order.customerOffer,
      driverOffer: order.fareType === 'negotiated' ? agreedFare : order.driverOffer,
      lastOfferBy: order.fareType === 'negotiated' ? 'driver' : order.lastOfferBy,
      fareConfirmedAt: order.fareType === 'negotiated' ? serverTimestamp() : undefined,
      updatedAt: serverTimestamp(),
      fareLabel: agreedFareLabel || order.fareLabel,
      totalLabel: agreedFareLabel || order.totalLabel,
      driverName: driver.fullName || order.driverName,
      driverPhone: driver.phoneNumber || order.driverPhone,
      driverVehicleLabel: driver.vehicleLabel || order.driverVehicleLabel,
      driverPlateNumber: driver.plateNumber || order.driverPlateNumber,
    })
  );
  batch.update(driverRef(driverId), {
    isAvailable: false,
    currentOrderId: orderId,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function updateCargoNegotiation(
  orderId: string,
  patch: {
    customerOffer?: number;
    driverOffer?: number;
    lastOfferBy?: 'customer' | 'driver';
    fareLabel?: string;
    totalLabel?: string;
  }
) {
  await updateDoc(
    orderRef(orderId),
    compactFirestoreData({
      ...patch,
      updatedAt: serverTimestamp(),
    })
  );
}

function pilotVehicleLabel(vehicleType: string) {
  const key = normalizeDriverVehicleType(vehicleType);
  if (key === 'kirikuu') return 'Kirikuu';
  if (key === 'canter') return 'Canter';
  return 'TOYO';
}

export const DRIVER_NEGOTIATION_CHANCES = 3;
export const DEFAULT_FARE_NOTE = 'Bei yangu.';

export async function submitDriverFare(driverId: string, orderId: string, amount: number, note?: string) {
  const [orderSnapshot, driverSnapshot] = await Promise.all([getDoc(orderRef(orderId)), getDoc(driverRef(driverId))]);
  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }
  if (!driverSnapshot.exists()) {
    throw new Error('Driver profile was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };
  if (order.driverId && order.driverId !== driverId) {
    throw new Error('This order is assigned to a different driver.');
  }
  if (order.negotiationStatus === 'confirmed') {
    throw new Error('This fare is already confirmed.');
  }

  const fareAmount = Math.max(0, Math.round(amount));
  const customerAmount = Math.max(0, Math.round(Number(order.customerOffer) || 0));
  const previousDriverAmount = Math.max(0, Math.round(Number(order.driverOffer) || 0));
  const used = Math.max(0, Math.round(Number(order.driverNegotiationUsed) || 0));
  const isCounter = fareAmount !== customerAmount;
  const sameResend = order.lastOfferBy === 'driver' && previousDriverAmount === fareAmount;
  if (isCounter && !sameResend && used >= DRIVER_NEGOTIATION_CHANCES) {
    throw new Error('Nafasi za kujadili zimekwisha. Kubali bei ya mteja.');
  }
  const nextUsed = isCounter && !sameResend ? used + 1 : used;
  const offerNote = String(note || '').trim().slice(0, 140) || DEFAULT_FARE_NOTE;
  const fareLabel = `TZS ${fareAmount.toLocaleString('en-US')}`;
  const vehicleType = normalizeDriverVehicleType(driver.vehicleType || '');

  const batch = writeBatch(db);
  batch.update(orderRef(orderId), compactFirestoreData({
    driverId,
    driverName: driver.fullName,
    driverPhone: driver.phoneNumber,
    driverVehicleType: vehicleType,
    driverVehicleLabel: driver.vehicleLabel || pilotVehicleLabel(vehicleType),
    driverPlateNumber: driver.plateNumber,
    driverVehicleColor: driver.vehicleColor || '',
    driverPhotoURL: driver.driverPhotoURL || '',
    driverOffer: fareAmount,
    driverOfferNote: offerNote,
    driverNegotiationUsed: nextUsed,
    lastOfferBy: 'driver',
    fareLabel,
    totalLabel: fareLabel,
    status: order.status === 'pending_assignment' ? 'driver_assigned' : order.status,
    assignedAt: order.assignedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  batch.update(driverRef(driverId), compactFirestoreData({
    currentOrderId: orderId,
    isAvailable: false,
    updatedAt: serverTimestamp(),
  }));
  await batch.commit();
}

export async function declineDriverOrder(driverId: string, orderId: string, reason?: string) {
  const [orderSnapshot, driverSnapshot] = await Promise.all([getDoc(orderRef(orderId)), getDoc(driverRef(driverId))]);

  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  if (!driverSnapshot.exists()) {
    throw new Error('Driver profile was not found.');
  }

  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (!order.driverId && order.status === 'pending_assignment') {
    await updateDoc(orderRef(orderId), compactFirestoreData({
      declinedDriverIds: arrayUnion(driverId),
      lastDeclinedByDriverId: driverId,
      lastDeclinedReason: reason?.trim() || 'Driver rejected offer',
      lastDeclinedAt: serverTimestamp(),
      driverOffer: deleteField(),
      lastOfferBy: order.fareType === 'negotiated' ? 'customer' : order.lastOfferBy,
      negotiationStatus: order.fareType === 'negotiated' ? 'open' : order.negotiationStatus,
      status: 'pending_assignment',
      updatedAt: serverTimestamp(),
    }));
    return;
  }

  if (order.driverId !== driverId) {
    throw new Error('This order is assigned to a different driver.');
  }

  if (order.status !== 'driver_assigned') {
    throw new Error('Only newly assigned orders can be rejected. Cancel active trips from the trip controls.');
  }

  const batch = writeBatch(db);

  batch.update(orderRef(orderId), compactFirestoreData({
    status: 'pending_assignment',
    driverSearchStatus: 'searching',
    driverSearchMessage: `Looking for another nearby online ${order.serviceLabel || 'DoorDrop'} driver.`,
    driverSearchStartedAt: serverTimestamp(),
    driverSearchExpiresAt: new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
    driverSearchResolvedAt: deleteField(),
    noNearbyDriverAt: deleteField(),
    noNearbyDriverReason: deleteField(),
    autoCancelledAt: deleteField(),
    autoCancelledReason: deleteField(),
    declinedDriverIds: arrayUnion(driverId),
    lastDeclinedByDriverId: driverId,
    lastDeclinedReason: reason?.trim() || 'Driver rejected assignment',
    lastDeclinedAt: serverTimestamp(),
    driverOffer: deleteField(),
    lastOfferBy: order.fareType === 'negotiated' ? 'customer' : order.lastOfferBy,
    negotiationStatus: order.fareType === 'negotiated' ? 'open' : order.negotiationStatus,
    updatedAt: serverTimestamp(),
    ...clearDriverAssignmentFields(),
  }));

  batch.update(
    driverRef(driverId),
    compactFirestoreData({
      isAvailable: true,
      currentOrderId: '',
      rejectionCount: increment(1),
      updatedAt: serverTimestamp(),
    })
  );

  await batch.commit();
}

export async function updateDriverLocation(driverId: string, location: UpdateDriverLocationInput) {
  const driverSnapshot = await getDoc(driverRef(driverId));

  if (!driverSnapshot.exists()) {
    throw new Error('Driver profile was not found.');
  }

  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };

  const geohash = encodeGeohash(location.latitude, location.longitude, 6);

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

  await updateDoc(
    driverRef(driverId),
    compactFirestoreData({
      currentLatitude: location.latitude,
      currentLongitude: location.longitude,
      currentHeading: location.heading,
      currentSpeedKph: location.speedKph,
      currentAccuracyMeters: location.accuracyMeters,
      geohash,
      appOnline: true,
      appOnlineUntil: new Date(Date.now() + DRIVER_APP_ONLINE_REFRESH_MS),
      lastActiveAt: serverTimestamp(),
      lastLocationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

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

export async function updateDriverOrderStatus(driverId: string, orderId: string, status: DeliveryOrderStatus) {
  const [orderSnapshot, driverSnapshot] = await Promise.all([getDoc(orderRef(orderId)), getDoc(driverRef(driverId))]);

  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  if (!driverSnapshot.exists()) {
    throw new Error('Driver profile was not found.');
  }

  const driver = { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) };

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (order.driverId !== driverId) {
    throw new Error('This order is assigned to a different driver.');
  }

  const batch = writeBatch(db);

  if (status === 'pending_assignment') {
    batch.update(orderRef(orderId), compactFirestoreData({
      status,
      driverSearchStatus: 'searching',
      driverSearchMessage: `Looking for another nearby online ${order.serviceLabel || 'DoorDrop'} driver.`,
      driverSearchStartedAt: serverTimestamp(),
      driverSearchExpiresAt: new Date(Date.now() + DRIVER_SEARCH_TIMEOUT_MS),
      driverSearchResolvedAt: deleteField(),
      noNearbyDriverAt: deleteField(),
      noNearbyDriverReason: deleteField(),
      autoCancelledAt: deleteField(),
      autoCancelledReason: deleteField(),
      updatedAt: serverTimestamp(),
      ...clearDriverAssignmentFields(),
    }));

    batch.update(driverRef(driverId), {
      isAvailable: true,
      currentOrderId: '',
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return;
  }

  const fareAmount = parseAmountFromLabel(order.totalLabel || order.fareLabel);
  const isOutsideComplete = status === 'delivered' && isOutsideParcelOrder(order);
  const resolvedStatus: DeliveryOrderStatus = isOutsideComplete ? 'at_hub' : status;
  const shouldStampOutsidePickup =
    resolvedStatus === 'in_transit' && isOutsideParcelOrder(order) && !order.outsidePickupAt;
  const outsideDurationSeconds = shouldStampOutsidePickup
    ? getOutsideParcelDurationSecondsForOrder(order)
    : 0;
  const haulFeeRate = 0.2;
  const haulFee =
    resolvedStatus === 'delivered' || isOutsideComplete
      ? Math.max(0, Math.round(fareAmount * haulFeeRate))
      : 0;
  const orderPayload = compactFirestoreData({
    status: resolvedStatus,
    acceptedByDriverAt:
      resolvedStatus === 'driver_at_pickup' ||
      resolvedStatus === 'in_transit' ||
      resolvedStatus === 'at_hub' ||
      resolvedStatus === 'delivered'
        ? order.acceptedByDriverAt || serverTimestamp()
        : undefined,
    deliveredAt: resolvedStatus === 'delivered' ? serverTimestamp() : undefined,
    firstMileCompletedAt: isOutsideComplete ? serverTimestamp() : undefined,
    ...(shouldStampOutsidePickup
      ? {
          outsidePickupAt: serverTimestamp(),
          outsideCountdownStartedAt: serverTimestamp(),
          outsideEtaDeadlineAt: new Date(Date.now() + outsideDurationSeconds * 1000),
        }
      : {}),
    cancelledAt: resolvedStatus === 'cancelled' ? serverTimestamp() : undefined,
    cancelledBy: resolvedStatus === 'cancelled' ? 'driver' : undefined,
    driverGrossEarnings: resolvedStatus === 'delivered' || isOutsideComplete ? fareAmount : undefined,
    ...(haulFee > 0
      ? {
          haulFee,
          haulFeeRate,
          commissionPaidTzs: Number(order.commissionPaidTzs || 0) || 0,
          cashStatus: String(order.cashStatus || '') === 'reconciled' ? 'reconciled' : 'unpaid',
        }
      : {}),
    ...(isOutsideComplete
      ? {
          logisticsStatus: 'awaiting_hub_intake',
          logisticsEvents: arrayUnion({
            status: 'awaiting_hub_intake',
            note: 'Driver delivered parcel to DoorDrop office. Awaiting office intake scan.',
            by: 'driver',
            at: new Date(),
          }),
        }
      : {}),
    updatedAt: serverTimestamp(),
  });

  batch.update(orderRef(orderId), orderPayload);

  if (
    resolvedStatus === 'driver_assigned' ||
    resolvedStatus === 'driver_at_pickup' ||
    resolvedStatus === 'in_transit'
  ) {
    batch.update(driverRef(driverId), {
      isAvailable: false,
      currentOrderId: orderId,
      updatedAt: serverTimestamp(),
    });
  }

  if (resolvedStatus === 'delivered' || resolvedStatus === 'cancelled' || isOutsideComplete) {
    const now = Date.now();
    const todayKey = getTanzaniaDateKey(now);
    const sameDay = String(driver.dailyCompletedDateKey || '') === todayKey;
    const accessPlan = getDriverAccessPlan(driver);
    const weekKey = getAccessBillingPeriodKey(accessPlan, now);
    const sameWeek = String(driver.weeklyCompletedWeekKey || '') === weekKey;
    const nextDailyCount =
      resolvedStatus === 'delivered' || isOutsideComplete ? (sameDay ? Number(driver.dailyCompletedOrderCount || 0) + 1 : 1) : undefined;
    const nextWeeklyCount =
      resolvedStatus === 'delivered' || isOutsideComplete
        ? sameWeek
          ? Number(driver.weeklyCompletedOrderCount || 0) + 1
          : 1
        : undefined;
    const accessDriver = {
      ...driver,
      dailyCompletedDateKey: resolvedStatus === 'delivered' || isOutsideComplete ? todayKey : driver.dailyCompletedDateKey,
      dailyCompletedOrderCount: nextDailyCount,
      weeklyCompletedWeekKey: resolvedStatus === 'delivered' || isOutsideComplete ? weekKey : driver.weeklyCompletedWeekKey,
      weeklyCompletedOrderCount: nextWeeklyCount,
    };
    const fallbackCount = accessPlan.period === 'week' ? nextWeeklyCount || 0 : nextDailyCount || 0;
    const duePatch =
      resolvedStatus === 'delivered' || isOutsideComplete
        ? resolveAccessPaymentDuePatch(accessDriver, now, fallbackCount)
        : null;
    const previousUnpaid = Math.max(0, Math.round(Number(driver.unpaidCommissionTzs) || 0));
    const nextUnpaid =
      haulFee > 0 && String(order.cashStatus || '') !== 'reconciled'
        ? previousUnpaid + haulFee
        : previousUnpaid;
    const payCeiling = Math.max(
      1,
      Math.round(Number(driver.commissionPayCeilingTzs || 25000))
    );
    batch.update(
      driverRef(driverId),
      compactFirestoreData({
        isAvailable: true,
        currentOrderId: '',
        completedOrderCount: resolvedStatus === 'delivered' || isOutsideComplete ? increment(1) : undefined,
        dailyCompletedDateKey: resolvedStatus === 'delivered' || isOutsideComplete ? todayKey : undefined,
        dailyCompletedOrderCount:
          resolvedStatus === 'delivered' || isOutsideComplete ? (sameDay ? increment(1) : 1) : undefined,
        weeklyCompletedWeekKey: resolvedStatus === 'delivered' || isOutsideComplete ? weekKey : undefined,
        weeklyCompletedOrderCount:
          resolvedStatus === 'delivered' || isOutsideComplete ? (sameWeek ? increment(1) : 1) : undefined,
        accessPaymentDuePeriodKey: duePatch?.accessPaymentDuePeriodKey,
        unpaidCommissionTzs: resolvedStatus === 'delivered' || isOutsideComplete ? nextUnpaid : undefined,
        commissionPayCeilingTzs: resolvedStatus === 'delivered' || isOutsideComplete ? payCeiling : undefined,
        commissionLocked:
          resolvedStatus === 'delivered' || isOutsideComplete ? nextUnpaid >= payCeiling : undefined,
        commissionStatus:
          resolvedStatus === 'delivered' || isOutsideComplete
            ? nextUnpaid > 0
              ? 'due'
              : 'clear'
            : undefined,
        cancellationCount: resolvedStatus === 'cancelled' ? increment(1) : undefined,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  await batch.commit();

  await createOrderStatusNotification({
    userId: order.userId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: resolvedStatus === 'at_hub' ? 'in_transit' : resolvedStatus,
    driverName: order.driverName,
  });
}

export async function saveDailyCommissionDue(
  driverId: string,
  input: {
    dateKey: string;
    earningsTzs: number;
    commissionTzs: number;
    status: 'due' | 'pending';
  }
) {
  await updateDoc(
    driverRef(driverId),
    compactFirestoreData({
      commissionDueDateKey: input.dateKey,
      commissionDueEarningsTzs: Math.max(0, Math.round(input.earningsTzs)),
      commissionDueTzs: Math.max(0, Math.round(input.commissionTzs)),
      commissionStatus: input.status,
      updatedAt: serverTimestamp(),
    })
  );
}

export async function markDriverCommissionPaid(
  driverId: string,
  input: {
    dateKey: string;
    grossAmount: number;
    commissionAmount: number;
    orderIds: string[];
    method?: string;
    payerPhone?: string;
    transactionReference?: string;
  }
) {
  if (!input.dateKey || input.commissionAmount <= 0) {
    throw new Error('There is no legacy access payment to record.');
  }

  const driverSnapshot = await getDoc(driverRef(driverId));
  const driver = driverSnapshot.exists()
    ? { id: driverSnapshot.id, ...(driverSnapshot.data() as Omit<DriverRecord, 'id'>) }
    : null;
  const paymentRef = driverCommissionPaymentRef(driverId);
  const reviewRef = commissionPaymentReviewRef(paymentRef.id);
  const batch = writeBatch(db);
  const subscriptionStartsAt = new Date(getNextSubscriptionPeriodStartMillis());
  const subscriptionPaidUntil = new Date(getNextSubscriptionPaidUntilMillis());
  const paymentPayload = compactFirestoreData({
    id: paymentRef.id,
    paymentType: 'weekly_subscription',
    driverId,
    driverName: driver?.fullName,
    driverPhone: driver?.phoneNumber,
    driverPlateNumber: driver?.plateNumber,
    dateKey: input.dateKey,
    grossAmount: input.grossAmount,
    commissionAmount: input.commissionAmount,
    subscriptionFee: input.commissionAmount,
    subscriptionDurationDays: 7,
    subscriptionStartsAt,
    subscriptionPaidUntil,
    subscriptionWeekStartsAt: subscriptionStartsAt,
    subscriptionWeekEndsAt: subscriptionPaidUntil,
    subscriptionDueDay: 'sunday',
    orderIds: input.orderIds,
    method: input.method || 'manual_mpesa',
    payerPhone: input.payerPhone,
    transactionReference: input.transactionReference,
    status: 'pending_admin_verification',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(paymentRef, paymentPayload);
  batch.set(reviewRef, paymentPayload);

  batch.update(driverRef(driverId), {
    lastCommissionPaymentSubmissionDateKey: input.dateKey,
    lastCommissionPaymentSubmittedAt: serverTimestamp(),
    lastCommissionPaymentSubmittedAmount: input.commissionAmount,
    lastCommissionPaymentSubmissionId: paymentRef.id,
    lastCommissionPaymentStatus: 'pending_admin_verification',
    lastSubscriptionPaymentStatus: 'pending_admin_verification',
    lastSubscriptionPaymentSubmittedAt: serverTimestamp(),
    lastSubscriptionPaymentId: paymentRef.id,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  return paymentRef.id;
}

export async function rateDeliveryCustomer(
  driverId: string,
  orderId: string,
  input: {
    rating: number;
    comment?: string;
  }
) {
  const safeRating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const orderSnapshot = await getDoc(orderRef(orderId));

  if (!orderSnapshot.exists()) {
    throw new Error('Order was not found.');
  }

  const order = { id: orderSnapshot.id, ...(orderSnapshot.data() as Omit<DeliveryOrder, 'id'>) };
  if (order.driverId !== driverId) {
    throw new Error('This order is assigned to a different driver.');
  }

  if (order.status !== 'delivered') {
    throw new Error('You can rate the customer after the delivery is complete.');
  }

  const batch = writeBatch(db);
  batch.update(
    orderRef(orderId),
    compactFirestoreData({
      driverCustomerRating: safeRating,
      driverCustomerRatingComment: input.comment?.trim() || '',
      driverCustomerRatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  if (order.userId) {
    batch.set(
      doc(usersCollection, order.userId),
      compactFirestoreData({
        customerDriverRatingTotal: increment(safeRating),
        customerDriverRatingCount: increment(1),
        lastDriverRating: safeRating,
        lastDriverRatingAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
  }

  await batch.commit();
}

export function sortDriverFleet(items: DriverRecord[]) {
  return sortDrivers(items);
}
