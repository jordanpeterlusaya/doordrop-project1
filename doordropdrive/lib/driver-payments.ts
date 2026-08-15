import { auth } from './firebase';
import { ensureDoorDriveApiBaseUrl } from './api-config';

export type DriverPaymentNetworkKey = 'mpesa' | 'mixx' | 'airtel' | 'halopesa';

export type DriverPaymentNetwork = {
  key: DriverPaymentNetworkKey;
  label: string;
  provider: string;
  color: string;
  logoUrl?: string;
  enabled?: boolean;
  comingSoon?: boolean;
  recipientPhone?: string;
};

export type DriverAccessSubscription = {
  status: 'active' | 'pending' | 'expired' | 'unpaid' | string;
  active: boolean;
  pending: boolean;
  paidUntil: string | null;
  paidUntilMillis: number;
  now: string;
  dailyFee: number;
  durationHours: number;
  currency: 'TZS' | string;
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

async function getAuthorizationHeader() {
  const token = await auth.currentUser?.getIdToken();
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
    throw new Error(payload?.error || payload?.message || text || `Request failed with ${response.status}`);
  }

  return payload;
}

async function requestDriverPaymentApi(path: string, options: RequestInit = {}) {
  const baseUrl = ensureDoorDriveApiBaseUrl();
  const authorization = await getAuthorizationHeader();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...(options.headers || {}),
    },
  });

  return readApiJson(response);
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
