import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { compactFirestoreData } from './firestore-payload';
import { db } from './firebase';

export type DirectMessage = {
  id: string;
  conversationId: string;
  driverId: string;
  customerId: string;
  senderId: string;
  senderRole: 'driver' | 'customer';
  senderName: string;
  message: string;
  createdAt?: unknown;
};

function conversationIdFor(driverId: string, customerId: string) {
  return [driverId, customerId].sort().join('_');
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

export function subscribeToDirectMessages(
  driverId: string,
  customerId: string,
  callback: (messages: DirectMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const conversationId = conversationIdFor(driverId, customerId);
  const messagesQuery = query(collection(db, 'directMessages'), where('conversationId', '==', conversationId));

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const items = snapshot.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<DirectMessage, 'id'>) }))
        .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt));
      callback(items);
    },
    (error) => onError?.(error)
  );
}

export async function sendDirectCustomerMessage(input: {
  driverId: string;
  driverName: string;
  driverVehicleType?: string;
  customerId: string;
  customerName: string;
  message: string;
}) {
  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new Error('Message cannot be empty.');
  }

  const conversationId = conversationIdFor(input.driverId, input.customerId);
  const messageRef = doc(collection(db, 'directMessages'));
  const notificationRef = doc(collection(db, 'userNotifications'));
  const driverName = input.driverName.trim() || 'HAUL Pilots';

  await setDoc(
    messageRef,
    compactFirestoreData({
      conversationId,
      driverId: input.driverId,
      customerId: input.customerId,
      customerName: input.customerName,
      senderId: input.driverId,
      senderRole: 'driver',
      senderName: driverName,
      recipientId: input.customerId,
      recipientRole: 'customer',
      driverVehicleType: input.driverVehicleType,
      message: trimmedMessage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await setDoc(
    notificationRef,
    compactFirestoreData({
      userId: input.customerId,
      title: `${driverName} yuko karibu`,
      message: trimmedMessage,
      type: 'message',
      driverId: input.driverId,
      driverName,
      driverVehicleType: input.driverVehicleType,
      conversationId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  ).catch(() => null);

  return messageRef.id;
}
