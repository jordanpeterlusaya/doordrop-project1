import { apiBaseUrl } from '@/lib/api-config';
import { auth } from '@/lib/firebase';

type ApiError = Error & { statusCode?: number };

export type CommissionPayResult = {
  ok?: boolean;
  status?: string;
  unpaidTzs?: number;
  threshold?: number;
  amount?: number;
  orderId?: string;
  canPay?: boolean;
  settled?: boolean;
  duplicate?: boolean;
  error?: string;
};

async function postCommission(path: string, body: Record<string, unknown>) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Ingia tena.');
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as CommissionPayResult;
  if (!response.ok) {
    const error = new Error(payload.error || 'USSD haijatumwa. Jaribu tena.') as ApiError;
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

/** Asks the server to send a real mobile-money USSD/STK push for the commission balance. */
export function requestCommissionUssd(input: { phoneNumber: string; network: string }) {
  return postCommission('/carrier/commission/ussd', {
    phoneNumber: input.phoneNumber,
    network: input.network,
  });
}

/** Checks the provider. Does not mark commission paid by itself. */
export function verifyCommissionUssd() {
  return postCommission('/carrier/commission/verify', {});
}
