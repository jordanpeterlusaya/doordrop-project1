/* eslint-disable @typescript-eslint/no-require-imports */

import React, { useEffect } from 'react';

import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';
import { recordCargoDiagnostic } from '@/lib/cargo-diagnostics';
import { logInfo } from '@/lib/debug-logger';

export default function BookCargoScreen() {
  useEffect(() => {
    recordCargoDiagnostic('book-cargo-wrapper:mounted');
    logInfo('BookCargoScreen', 'wrapper mounted');

    return () => {
      recordCargoDiagnostic('book-cargo-wrapper:unmounted');
      logInfo('BookCargoScreen', 'wrapper unmounted');
    };
  }, []);

  return (
    <SafePlatformScreen
      screenName="Book cargo"
      loadNative={() => require('./book-cargo-screen.native')}
      loadWeb={() => require('./book-cargo-screen.web')}
    />
  );
}
