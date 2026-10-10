import { apiBaseUrl } from '@/lib/api-config';

type ApiError = Error & { statusCode?: number; code?: string };

export type OtpPurpose = 'signup' | 'login';

async function postJson<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    ok?: boolean;
  } & T;

  if (!response.ok) {
    const error = new Error(payload.error || 'Imeshindwa.') as ApiError;
    error.statusCode = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export async function sendCarrierOtp(phone: string, purpose: OtpPurpose = 'signup') {
  return postJson<{
    ok: boolean;
    cooldownSeconds: number;
    expiresInSeconds: number;
    phoneMasked: string;
  }>('/carrier-auth/otp/send', { phone, purpose });
}

export async function verifyCarrierOtp(phone: string, code: string) {
  return postJson<{
    ok: boolean;
    otpTicket: string;
    expiresInSeconds: number;
    phoneMasked: string;
  }>('/carrier-auth/otp/verify', { phone, code });
}

export async function loginCarrierWithOtp(phone: string, otpTicket: string) {
  return postJson<{
    ok: boolean;
    customToken: string;
    carrierId: string;
    status: string;
    phoneMasked: string;
  }>('/carrier-auth/otp/login', { phone, otpTicket });
}

export async function confirmCarrierPhone(opts: {
  phone: string;
  otpTicket: string;
  idToken: string;
  carrierId?: string;
}) {
  return postJson<{ ok: boolean; phoneMasked: string; carrierId: string }>(
    '/carrier-auth/confirm-phone',
    {
      phone: opts.phone,
      otpTicket: opts.otpTicket,
      carrierId: opts.carrierId,
    },
    opts.idToken
  );
}
