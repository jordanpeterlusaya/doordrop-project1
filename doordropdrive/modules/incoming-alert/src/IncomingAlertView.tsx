import { requireNativeView } from 'expo';
import * as React from 'react';

import { IncomingAlertViewProps } from './IncomingAlert.types';

const NativeView: React.ComponentType<IncomingAlertViewProps> =
  requireNativeView('IncomingAlert');

export default function IncomingAlertView(props: IncomingAlertViewProps) {
  return <NativeView {...props} />;
}
