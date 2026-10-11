import { apiBaseUrl } from '@/lib/api-config';
import { auth } from '@/lib/firebase';

type ApiError = Error & { statusCode?: number; code?: string };

export async function markShipmentArrived(shipmentId: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Ingia tena.');
  const response = await fetch(`${apiBaseUrl()}/carrier/shipments/arrive`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ shipmentId }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string; ok?: boolean };
  if (!response.ok) {
    const error = new Error(payload.error || 'Imeshindwa kutuma SMS.') as ApiError;
    error.statusCode = response.status;
    error.code = payload.code;
    throw error;
  }
  if (payload.ok !== true) {
    throw new Error('Imeshindwa kutuma SMS.');
  }
}
