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

import { compactFirestoreData } from '@/lib/firestore-payload';
import { db } from '@/lib/firebase';
import { createUserNotification } from '@/lib/user-notifications';

export type OrderMessageSenderRole = 'customer' | 'driver' | 'dispatch';

export type OrderMessage = {
  id: string;
  orderId: string;
  orderNumber?: string;
  customerId?: string;
  driverId?: string;
  senderId: string;
  senderRole: OrderMessageSenderRole;
  senderName: string;
  recipientId?: string;
  recipientRole?: OrderMessageSenderRole;
  message: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type SendOrderMessageInput = {
  orderId: string;
  orderNumber?: string;
  customerId?: string;
  driverId?: string;
  senderId: string;
  senderRole: OrderMessageSenderRole;
  senderName: string;
  message: string;
};

const orderMessagesCollection = collection(db, 'orderMessages');

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

function sortMessages(items: OrderMessage[]) {
  return [...items].sort((left, right) => {
    return toMillis(left.createdAt ?? left.updatedAt) - toMillis(right.createdAt ?? right.updatedAt);
  });
}

export function subscribeToOrderMessages(
  orderId: string,
  callback: (messages: OrderMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const orderMessagesQuery = query(orderMessagesCollection, where('orderId', '==', orderId));

  return onSnapshot(
    orderMessagesQuery,
    (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<OrderMessage, 'id'>) }));
      callback(sortMessages(items));
    },
    (error) => onError?.(error)
  );
}

async function notifyCustomerAboutDriverMessage(input: SendOrderMessageInput, trimmedMessage: string) {
  if (input.senderRole !== 'driver' || !input.customerId) {
    return;
  }

  await createUserNotification({
    userId: input.customerId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    title: `Message from ${input.senderName.trim() || 'your driver'}`,
    message: trimmedMessage,
    type: 'message',
  }).catch(() => null);
}

export async function sendOrderMessage(input: SendOrderMessageInput) {
  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new Error('Message cannot be empty.');
  }

  const nextMessageRef = doc(orderMessagesCollection);
  const recipientRole =
    input.senderRole === 'customer' ? 'driver' : input.senderRole === 'driver' ? 'customer' : undefined;
  const recipientId =
    input.senderRole === 'customer' ? input.driverId : input.senderRole === 'driver' ? input.customerId : undefined;

  await setDoc(
    nextMessageRef,
    compactFirestoreData({
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      customerId: input.customerId,
      driverId: input.driverId,
      senderId: input.senderId,
      senderRole: input.senderRole,
      senderName: input.senderName.trim() || 'DoorDrop',
      recipientId,
      recipientRole,
      message: trimmedMessage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  await notifyCustomerAboutDriverMessage(input, trimmedMessage);

  return nextMessageRef.id;
}
