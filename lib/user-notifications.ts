import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { compactFirestoreData } from '@/lib/firestore-payload';
import { db } from '@/lib/firebase';

export type UserNotificationType = 'order_created' | 'order_status' | 'promotion' | 'message';
export type DeliveryCancellationActor = 'customer' | 'driver' | 'dispatch';
export type DeliveryOrderStatus =
  | 'pending_assignment'
  | 'driver_assigned'
  | 'driver_at_pickup'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type UserNotification = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: UserNotificationType;
  orderId?: string;
  orderNumber?: string;
  orderStatus?: DeliveryOrderStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  readAt?: unknown;
};

type CreateUserNotificationInput = Omit<UserNotification, 'id' | 'createdAt' | 'updatedAt' | 'readAt'>;

type OrderNotificationInput = {
  userId: string;
  orderId: string;
  orderNumber: string;
  serviceLabel: string;
  status: DeliveryOrderStatus;
  driverName?: string;
  cancellationReason?: string;
  cancelledBy?: DeliveryCancellationActor;
};

const userNotificationsCollection = collection(db, 'userNotifications');
const usersCollection = collection(db, 'users');
const USER_NOTIFICATION_SUBSCRIPTION_LIMIT = 80;

function notificationRef(notificationId: string) {
  return doc(db, 'userNotifications', notificationId);
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

function sortNotifications(items: UserNotification[]) {
  return [...items].sort((left, right) => {
    return toMillis(right.createdAt ?? right.updatedAt) - toMillis(left.createdAt ?? left.updatedAt);
  });
}

async function canSendNotification(userId: string, type: UserNotificationType) {
  const userSnapshot = await getDoc(doc(db, 'users', userId));
  const preferences = userSnapshot.data()?.notificationPreferences as
    | {
        orderUpdates?: boolean;
        promotions?: boolean;
      }
    | undefined;

  if (type === 'promotion') {
    return preferences?.promotions !== false;
  }

  return preferences?.orderUpdates !== false;
}

function getOrderStatusNotificationCopy(input: OrderNotificationInput) {
  if (input.status === 'pending_assignment') {
    return {
      title: 'Order received',
      message: `${input.orderNumber} is in dispatch and waiting for the best available driver.`,
    };
  }

  if (input.status === 'driver_assigned') {
    return {
      title: 'Driver assigned',
      message: `${input.driverName || 'A driver'} has been assigned to ${input.orderNumber}.`,
    };
  }

  if (input.status === 'driver_at_pickup') {
    return {
      title: 'Driver reached pickup',
      message: `${input.orderNumber} has reached the pickup point and loading can begin.`,
    };
  }

  if (input.status === 'in_transit') {
    return {
      title: 'Order in transit',
      message: `${input.orderNumber} is now on the road to the drop-off.`,
    };
  }

  if (input.status === 'delivered') {
    return {
      title: 'Order delivered',
      message: `${input.orderNumber} was marked delivered successfully.`,
    };
  }

  const reasonText = input.cancellationReason?.trim()
    ? ` Reason: ${input.cancellationReason.trim()}.`
    : '';
  const actorPrefix =
    input.cancelledBy === 'customer'
      ? 'You cancelled'
      : input.cancelledBy === 'driver'
        ? 'The driver cancelled'
        : 'DoorDrop dispatch cancelled';

  return {
    title: 'Order cancelled',
    message: `${actorPrefix} ${input.orderNumber}.${reasonText}${reasonText ? '' : ' Contact support if this was unexpected.'}`,
  };
}

export async function createUserNotification(input: CreateUserNotificationInput) {
  if (!(await canSendNotification(input.userId, input.type))) {
    return null;
  }

  const nextNotificationRef = doc(userNotificationsCollection);

  await setDoc(
    nextNotificationRef,
    compactFirestoreData({
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  return nextNotificationRef.id;
}

export async function createOrderStatusNotification(input: OrderNotificationInput) {
  const copy = getOrderStatusNotificationCopy(input);

  return createUserNotification({
    userId: input.userId,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    orderStatus: input.status,
    title: copy.title,
    message: copy.message,
    type: input.status === 'pending_assignment' ? 'order_created' : 'order_status',
  });
}

export async function publishPromotionNotifications(input: {
  title: string;
  message: string;
}) {
  type PromotionPreferenceUser = {
    id: string;
    notificationPreferences?: {
      promotions?: boolean;
    };
  };

  const usersSnapshot = await getDocs(usersCollection);
  const eligibleUsers = usersSnapshot.docs
    .map((item) => ({ id: item.id, ...(item.data() as Omit<PromotionPreferenceUser, 'id'>) }))
    .filter((user) => user.notificationPreferences?.promotions !== false);

  if (!eligibleUsers.length) {
    return 0;
  }

  let sentCount = 0;
  let batch = writeBatch(db);
  let batchSize = 0;

  for (const user of eligibleUsers) {
    const nextNotificationRef = doc(userNotificationsCollection);
    batch.set(
      nextNotificationRef,
      compactFirestoreData({
        userId: user.id,
        title: input.title.trim(),
        message: input.message.trim(),
        type: 'promotion',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    batchSize += 1;
    sentCount += 1;

    if (batchSize === 450) {
      await batch.commit();
      batch = writeBatch(db);
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return sentCount;
}

export function subscribeToUserNotifications(
  userId: string,
  callback: (notifications: UserNotification[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const emitSnapshot = (snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<UserNotification, 'id'>) }));
    callback(sortNotifications(items));
  };
  let fallbackUnsubscribe: Unsubscribe | null = null;
  const fallbackQuery = query(
    userNotificationsCollection,
    where('userId', '==', userId),
    limit(USER_NOTIFICATION_SUBSCRIPTION_LIMIT)
  );
  const notificationsQuery = query(
    userNotificationsCollection,
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(USER_NOTIFICATION_SUBSCRIPTION_LIMIT)
  );

  const primaryUnsubscribe = onSnapshot(
    notificationsQuery,
    emitSnapshot,
    (error) => {
      const errorCode = (error as { code?: string }).code;
      if (errorCode === 'failed-precondition' && !fallbackUnsubscribe) {
        fallbackUnsubscribe = onSnapshot(fallbackQuery, emitSnapshot, (fallbackError) => onError?.(fallbackError));
        return;
      }

      onError?.(error);
    }
  );

  return () => {
    primaryUnsubscribe();
    fallbackUnsubscribe?.();
  };
}

export async function markUserNotificationRead(notificationId: string) {
  await updateDoc(
    notificationRef(notificationId),
    compactFirestoreData({
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export async function markAllUserNotificationsRead(userId: string) {
  const notificationsSnapshot = await getDocs(query(userNotificationsCollection, where('userId', '==', userId)));
  const unreadNotifications = notificationsSnapshot.docs.filter((item) => !item.data().readAt);

  if (!unreadNotifications.length) {
    return;
  }

  const batch = writeBatch(db);
  unreadNotifications.forEach((item) => {
    batch.update(item.ref, {
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export async function deleteUserNotification(notificationId: string) {
  await deleteDoc(notificationRef(notificationId));
}

export async function deleteAllUserNotifications(userId: string) {
  const notificationsSnapshot = await getDocs(query(userNotificationsCollection, where('userId', '==', userId)));

  if (notificationsSnapshot.empty) {
    return;
  }

  let batch = writeBatch(db);
  let batchSize = 0;

  for (const notification of notificationsSnapshot.docs) {
    batch.delete(notification.ref);
    batchSize += 1;

    if (batchSize === 450) {
      await batch.commit();
      batch = writeBatch(db);
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }
}
