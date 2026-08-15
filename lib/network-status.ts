import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export type CustomerNoticeKind = 'offline' | 'location' | 'service';

function getErrorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return '';
}

export function isNetworkError(error: unknown) {
  const normalized = getErrorText(error).toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('internet') ||
    normalized.includes('offline') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('abort')
  );
}

export function classifyLocationError(error: unknown): CustomerNoticeKind {
  if (isNetworkError(error)) {
    return 'offline';
  }

  const normalized = getErrorText(error).toLowerCase();
  if (
    normalized.includes('location_service_unavailable') ||
    normalized.includes('invalid json') ||
    normalized.includes('backend') ||
    normalized.includes('503') ||
    normalized.includes('unavailable') ||
    normalized.includes('api_base_url') ||
    normalized.includes('expo_public')
  ) {
    return 'service';
  }

  return 'location';
}

async function pingOnline() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function useNetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const nextOnline = await pingOnline();
      if (!cancelled) {
        setOnline(nextOnline);
      }
    };

    void check();
    const intervalId = setInterval(() => {
      void check();
    }, 8000);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void check();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      subscription.remove();
    };
  }, []);

  return online;
}
