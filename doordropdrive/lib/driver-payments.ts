import { collection, onSnapshot, query, type Unsubscribe } from 'firebase/firestore';

import { getDoorDriveApiBaseUrls } from './api-config';
import { auth, db } from './firebase';

export type DriverPaymentNetworkKey = 'mpesa' | 'mixx' | 'airtel';

export type DriverPaymentNetwork = {
  key: DriverPaymentNetworkKey;
  label: string;
  provider: string;
  color: string;
  logoUrl?: string;
  enabled?: boolean;
  comingSoon?: boolean;
};

export type DriverAccessSubscription = {
  status: 'active' | 'pending' | 'expired' | 'unpaid' | 'grace' | string;
  active: boolean;
  pending: boolean;
  paidUntil: string | null;
  paidUntilMillis: number;
  now: string;
  dailyFee: number;
  amount?: number;
  durationHours: number;
  durationDays?: number;
  period?: 'day' | 'week' | string;
  periodLabel?: string;
  currency: 'TZS' | string;
  vehicleType?: string;
  vehicleLabel?: string;
  minOrders?: number;
  completedOrders?: number;
  remainingOrders?: number;
  grace?: boolean;
  canPay?: boolean;
  paymentRequired?: boolean;
  message: string;
};

export type DriverPaymentRecord = {
  id: string;
  orderId: string;
  driverId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'expired' | string;
  providerStatus: string;
  network: DriverPaymentNetworkKey | string;
  recipientPhone?: string;
  payerPhone: string;
  buyerName: string;
  gatewayRef: string;
  mongikePaymentId: string;
  receiptNumber: string;
  receiptUrl: string;
  subscriptionStartsAt: string | null;
  subscriptionPaidUntil: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
};

export type DriverPaymentStatusResponse = {
  driverId: string;
  subscription: DriverAccessSubscription;
  latestPayment: DriverPaymentRecord | null;
  history: DriverPaymentRecord[];
  networks: DriverPaymentNetwork[];
  duplicate?: boolean;
};

export class PaymentApiError extends Error {
  code: 'offline' | 'unavailable' | 'generic';

  constructor(code: 'offline' | 'unavailable' | 'generic', message: string) {
    super(message);
    this.name = 'PaymentApiError';
    this.code = code;
  }
}

async function getAuthorizationHeader() {
  const token = await auth.currentUser?.getIdToken(false);
  if (!token) {
    throw new Error('Sign in again before managing driver access payments.');
  }

  return `Bearer ${token}`;
}

async function readApiJson(response: Response) {
  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const htmlError = typeof text === 'string' && /<title>\s*\d{3}\s+Server Error/i.test(text);
    if (htmlError || response.status >= 500) {
      throw new PaymentApiError('unavailable', 'Payments are temporarily unavailable. Please try again in a few minutes.');
    }
    throw new Error(payload?.error || payload?.message || text || `Request failed with ${response.status}`);
  }

  return payload;
}

async function requestDriverPaymentApi(path: string, options: RequestInit = {}) {
  const baseUrls = getDoorDriveApiBaseUrls();
  const authorization = await getAuthorizationHeader();
  let lastNetworkError: unknown = null;

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization,
          ...(options.headers || {}),
        },
      });
      return await readApiJson(response);
    } catch (error) {
      if (error instanceof PaymentApiError) {
        throw error;
      }
      lastNetworkError = error;
    }
  }

  throw new PaymentApiError(
    'offline',
    lastNetworkError instanceof Error ? lastNetworkError.message : 'No internet connection.'
  );
}

export async function fetchDriverPaymentStatus(): Promise<DriverPaymentStatusResponse> {
  return requestDriverPaymentApi('/driver-payments/status');
}

export async function fetchDriverPaymentHistory(): Promise<{
  driverId: string;
  history: DriverPaymentRecord[];
  networks: DriverPaymentNetwork[];
}> {
  return requestDriverPaymentApi('/driver-payments/history');
}

export async function initiateDriverAccessPayment(input: {
  phoneNumber: string;
  network: DriverPaymentNetworkKey | string;
  retry?: boolean;
}): Promise<DriverPaymentStatusResponse> {
  return requestDriverPaymentApi('/driver-payments/initiate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyDriverAccessPayment(paymentId?: string): Promise<DriverPaymentStatusResponse> {
  return requestDriverPaymentApi('/driver-payments/verify', {
    method: 'POST',
    body: JSON.stringify({ paymentId }),
  });
}

/** TrivaPesa commission (Agents-style): pay any amount up to unpaid debt. */
export type DriverCommissionPayResult = {
  ok?: boolean;
  status?: string;
  unpaidTzs?: number;
  payCeilingTzs?: number;
  locked?: boolean;
  canPay?: boolean;
  amount?: number;
  orderId?: string;
  settled?: boolean;
  duplicate?: boolean;
  message?: string;
  error?: string;
  networks?: DriverPaymentNetwork[];
  provider?: string;
};

export async function fetchDriverCommissionStatus(): Promise<DriverCommissionPayResult> {
  return requestDriverPaymentApi('/driver/commission/status');
}

export async function initiateDriverCommissionUssd(input: {
  phoneNumber: string;
  network: DriverPaymentNetworkKey | string;
  amount: number;
}): Promise<DriverCommissionPayResult> {
  return requestDriverPaymentApi('/driver/commission/ussd', {
    method: 'POST',
    body: JSON.stringify({
      phoneNumber: input.phoneNumber,
      network: input.network,
      amount: Math.round(input.amount),
    }),
  });
}

export async function verifyDriverCommissionUssd(orderId?: string): Promise<DriverCommissionPayResult> {
  return requestDriverPaymentApi('/driver/commission/verify', {
    method: 'POST',
    body: JSON.stringify(orderId ? { orderId } : {}),
  });
}

function toIso(value: unknown) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  }
  if (typeof value === 'object' && value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return new Date((value as { toMillis: () => number }).toMillis()).toISOString();
  }
  if (typeof value === 'object' && value && Number.isFinite((value as { seconds?: number }).seconds)) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000).toISOString();
  }
  return null;
}

function serializeDriverPaymentDoc(id: string, data: Record<string, unknown>): DriverPaymentRecord {
  return {
    id,
    orderId: String(data.orderId || id),
    driverId: String(data.driverId || ''),
    amount: Number(data.amount || 0),
    currency: String(data.currency || 'TZS'),
    status: String(data.status || data.localStatus || 'pending').toLowerCase(),
    providerStatus: String(data.providerStatus || ''),
    network: String(data.network || 'mpesa'),
    recipientPhone: String(data.recipientPhone || data.merchantRecipientPhone || ''),
    payerPhone: String(data.payerPhone || data.buyerPhone || ''),
    buyerName: String(data.buyerName || data.driverName || ''),
    gatewayRef: String(data.gatewayRef || data.reference || ''),
    mongikePaymentId: String(data.mongikePaymentId || ''),
    receiptNumber: String(data.receiptNumber || ''),
    receiptUrl: String(data.receiptUrl || ''),
    subscriptionStartsAt: toIso(data.subscriptionStartsAt),
    subscriptionPaidUntil: toIso(data.subscriptionPaidUntil),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    completedAt: toIso(data.completedAt),
    expiresAt: toIso(data.expiresAt || data.mongikeExpiresAt),
  };
}

export function subscribeToDriverPayments(
  driverId: string,
  callback: (payments: DriverPaymentRecord[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const paymentsQuery = query(collection(db, 'drivers', driverId, 'subscriptionPayments'));

  return onSnapshot(
    paymentsQuery,
    (snapshot) => {
      const payments = snapshot.docs
        .map((doc) => serializeDriverPaymentDoc(doc.id, doc.data() as Record<string, unknown>))
        .sort((left, right) => {
          const rightAt = right.completedAt || right.createdAt || right.updatedAt || '';
          const leftAt = left.completedAt || left.createdAt || left.updatedAt || '';
          return rightAt.localeCompare(leftAt);
        });
      callback(payments);
    },
    (error) => onError?.(error)
  );
}
