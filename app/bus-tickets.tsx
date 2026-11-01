export { ErrorBoundary } from '@/components/expo-router-error-boundary';

import React from 'react';

import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

export default function BusTicketsRoute() {
  return (
    <SafePlatformScreen
      screenName="Bus tickets"
      loadNative={() => require('@/components/screens/bus-tickets-screen')}
      loadWeb={() => require('@/components/screens/bus-tickets-screen')}
    />
  );
}
