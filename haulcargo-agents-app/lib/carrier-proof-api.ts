import * as FileSystem from 'expo-file-system/legacy';

import { apiBaseUrl } from '@/lib/api-config';
import type { PickedDoc } from '@/lib/document-upload';
import { auth } from '@/lib/firebase';

type ApiError = Error & { statusCode?: number; code?: string };

async function authed<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Ingia tena.');
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: init?.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!response.ok) {
    const error = new Error(payload.error || 'Imeshindwa.') as ApiError;
    error.statusCode = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export async function fetchDeliveryProofOptions(shipmentId: string) {
  return authed<{
    ok: boolean;
    smsConfigured: boolean;
    hasRecipientPhone: boolean;
    otpAvailable: boolean;
  }>(`/carrier/delivery-proof/options?shipmentId=${encodeURIComponent(shipmentId)}`);
}

export async function sendDeliveryOtp(shipmentId: string) {
  return authed<{ ok: boolean; sent: boolean }>('/carrier/delivery-proof/otp/send', {
    method: 'POST',
    body: { shipmentId },
  });
}

export async function uploadDeliveryProof(shipmentId: string, method: 'photo' | 'signature', file: PickedDoc) {
  const fileBase64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
  return authed<{ ok: boolean; downloadURL: string; method: string }>('/carrier/delivery-proof/upload', {
    method: 'POST',
    body: {
      shipmentId,
      method,
      fileBase64,
      contentType: file.mimeType || 'image/jpeg',
    },
  });
}

export async function completeDeliveryProof(input: {
  shipmentId: string;
  method: 'photo' | 'signature' | 'otp';
  proofUrl?: string;
  code?: string;
}) {
  return authed<{ ok: boolean; shipmentStatus: string }>('/carrier/delivery-proof/complete', {
    method: 'POST',
    body: input,
  });
}
