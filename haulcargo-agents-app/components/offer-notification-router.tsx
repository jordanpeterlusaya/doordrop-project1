import { router } from 'expo-router';
import { useEffect } from 'react';

import { listenForOfferTaps } from '@/lib/push-notifications';

/** Opens /order/{id} when the company taps an offer notification. */
export function OfferNotificationRouter() {
  useEffect(() => {
    return listenForOfferTaps((orderId) => {
      router.push(`/order/${orderId}`);
    });
  }, []);
  return null;
}
