import type { ReactNode } from 'react';

import { ScreenErrorBoundary } from '@/components/ErrorBoundary';

export function AuthSessionBoundary({ children }: { children: ReactNode }) {
  return <ScreenErrorBoundary screenName="Auth session boundary">{children}</ScreenErrorBoundary>;
}

export function AuthNotificationBoundary({ children }: { children: ReactNode }) {
  return (
    <ScreenErrorBoundary screenName="Auth notification boundary">
      {children}
    </ScreenErrorBoundary>
  );
}
