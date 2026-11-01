export { ErrorBoundary } from '@/components/expo-router-error-boundary';

import React from 'react';

import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

/**
 * Explicit SafePlatformScreen wrapper so Expo Router always gets a default export.
 * Native content is required only at render time (inside try/catch).
 */
export default function NinunulieRoute() {
  return (
    <SafePlatformScreen
      screenName="Ninunulie"
      loadNative={() => require('@/components/screens/ninunulie-flow')}
      loadWeb={() => require('@/components/screens/ninunulie-flow')}
    />
  );
}
