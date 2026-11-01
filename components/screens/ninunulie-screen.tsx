/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

export default function NinunulieScreen() {
  return (
    <SafePlatformScreen
      screenName="Ninunulie"
      loadNative={() => require('./ninunulie-flow')}
      loadWeb={() => require('./ninunulie-flow')}
    />
  );
}
