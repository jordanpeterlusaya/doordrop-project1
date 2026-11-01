import { doc, getDoc } from 'firebase/firestore';

import type { DeliveryOrder } from './driver-data';
import { db } from './firebase';
import { readablePhone } from './phone-link';

const phoneCache = new Map<string, string>();

export function resolveOrderContactPhone(order?: DeliveryOrder | null) {
  if (!order) {
    return '';
  }

  return (
    readablePhone(order.customerPhone) ||
    readablePhone(order.recipientPhone) ||
    readablePhone((order as { phoneNumber?: string }).phoneNumber) ||
    readablePhone((order as { senderPhone?: string }).senderPhone)
  );
}

export async function fetchCustomerPhoneForOrder(order?: DeliveryOrder | null) {
  const direct = resolveOrderContactPhone(order);
  if (direct) {
    return direct;
  }

  const userId = String(order?.userId || '').trim();
  if (!userId || userId.startsWith('manual:')) {
    return '';
  }

  if (phoneCache.has(userId)) {
    return phoneCache.get(userId) || '';
  }

  try {
    const snapshot = await getDoc(doc(db, 'users', userId));
    const data = snapshot.data() as { phoneNumber?: string; phone?: string } | undefined;
    const phone = readablePhone(data?.phoneNumber) || readablePhone(data?.phone);
    if (phone) {
      phoneCache.set(userId, phone);
    }
    return phone;
  } catch {
    return '';
  }
}
