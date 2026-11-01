import * as React from 'react';

import { IncomingAlertViewProps } from './IncomingAlert.types';

export default function IncomingAlertView(props: IncomingAlertViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
