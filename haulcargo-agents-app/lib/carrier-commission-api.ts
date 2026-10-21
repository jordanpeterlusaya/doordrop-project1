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
  message?: string;
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
    const error = new Error(swahiliPayError(payload.error)) as ApiError;
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function swahiliPayError(value: unknown) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 90 || /salio/i.test(text)) return 'USSD haijatumwa. Jaribu tena.';
  return text;
}

/** Asks the server to send a TrivaPesa USSD push. Unadaiwa changes only after confirmation. */
export function requestCommissionUssd(input: { phoneNumber: string; network: string; amount: number }) {
  return postCommission('/carrier/commission/ussd', {
    phoneNumber: input.phoneNumber,
    network: input.network,
    amount: Math.round(input.amount),
  });
}

/** Checks TrivaPesa. Does not mark commission paid by itself. */
export function verifyCommissionUssd(orderId?: string) {
  return postCommission('/carrier/commission/verify', orderId ? { orderId } : {});
}
