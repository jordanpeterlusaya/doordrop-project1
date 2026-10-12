import { ensureDoorDropApiBaseUrl, getDoorDropApiBaseUrl } from '@/lib/api-config';

type ApiError = Error & { statusCode?: number; code?: string };

/** signup = registration; confirm = post email-login phone verify */
export type CustomerOtpPurpose = 'signup' | 'confirm';

async function postJson<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const baseUrl = getDoorDropApiBaseUrl() || ensureDoorDropApiBaseUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
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

export async function sendCustomerOtp(phone: string, purpose: CustomerOtpPurpose = 'signup') {
  const apiPurpose = purpose === 'confirm' ? 'signup' : purpose;
  return postJson<{
    ok: boolean;
    cooldownSeconds: number;
    expiresInSeconds: number;
    phoneMasked: string;
    /** Present when server CUSTOMER_OTP_BYPASS_ENABLED / CARRIER_OTP_BYPASS_ENABLED is on. */
    otpBypass?: boolean;
  }>('/customer-auth/otp/send', { phone, purpose: apiPurpose });
}

export async function verifyCustomerOtp(phone: string, code: string) {
  return postJson<{
    ok: boolean;
    otpTicket: string;
    expiresInSeconds: number;
    phoneMasked: string;
    otpBypass?: boolean;
  }>('/customer-auth/otp/verify', { phone, code });
}

export async function confirmCustomerPhone(opts: {
  phone: string;
  otpTicket: string;
  idToken: string;
}) {
  return postJson<{ ok: boolean; phoneMasked: string; uid: string }>(
    '/customer-auth/confirm-phone',
    {
      phone: opts.phone,
      otpTicket: opts.otpTicket,
    },
    opts.idToken
  );
}

export function formatOtpCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
