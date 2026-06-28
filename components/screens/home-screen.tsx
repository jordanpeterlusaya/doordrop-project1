/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

import { AuthNotificationBoundary } from '@/components/auth/session-boundary';
import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

export default function HomeScreen() {
  return (
    <AuthNotificationBoundary>
      <SafePlatformScreen
        screenName="Home"
        loadNative={() => require('./home-screen.native')}
        loadWeb={() => require('./home-screen.web')}
      />
    </AuthNotificationBoundary>
  );
}
