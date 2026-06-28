/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

import { SafePlatformScreen } from '@/components/screens/safe-platform-screen';

export default function SendParcelScreen() {
  return (
    <SafePlatformScreen
      screenName="Send parcel"
      loadNative={() => require('./send-parcel-screen.native')}
      loadWeb={() => require('./send-parcel-screen.web')}
    />
  );
}
