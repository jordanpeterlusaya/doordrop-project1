/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

import { AuthNotificationBoundary } from '@/components/auth/session-boundary';
import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

export default function TrackOrderScreen() {
  return (
    <AuthNotificationBoundary>
      <SafePlatformScreen
        screenName="Track order"
        loadNative={() => require('./track-order-screen.native')}
        loadWeb={() => require('./track-order-screen.web')}
      />
    </AuthNotificationBoundary>
  );
}
