import { useCallback, useEffect, useRef, useState } from 'react';
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
    normalized.includes('offline')
  );
}

export function classifyLocationError(error: unknown): CustomerNoticeKind {
  const normalized = getErrorText(error).toLowerCase();
  if (
    normalized.includes('location_service_unavailable') ||
    normalized.includes('invalid json') ||
    normalized.includes('backend') ||
    normalized.includes('503') ||
    normalized.includes('unavailable') ||
    normalized.includes('api_base_url') ||
    normalized.includes('expo_public') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('abort') ||
    normalized.includes('cooldown')
  ) {
    return 'service';
  }

  if (isNetworkError(error)) {
    return 'offline';
  }

  return 'location';
}

async function probeUrl(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return typeof response.status === 'number';
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pingOnline() {
  // Race a few cheap probes. First success wins — do not wait for all.
  const probes = [
    probeUrl('https://clients3.google.com/generate_204', 2500),
    probeUrl('https://www.cloudflare.com/cdn-cgi/trace', 2500),
    probeUrl('https://1.1.1.1/', 2500),
  ];

  try {
    await Promise.any(
      probes.map(async (probe) => {
        const ok = await probe;
        if (!ok) {
          throw new Error('probe failed');
        }
        return true;
      })
    );
    return true;
  } catch {
    return false;
  }
}

function readNavigatorOnline() {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return null;
}

type CustomerNetworkOptions = {
  failThreshold?: number;
};

export function useCustomerNetwork(options?: CustomerNetworkOptions) {
  const failThreshold = options?.failThreshold ?? 3;
  const [online, setOnline] = useState(() => readNavigatorOnline() !== false);
  const [checking, setChecking] = useState(false);
  const failStreakRef = useRef(0);
  const checkingRef = useRef(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const check = useCallback(
    async (immediate = false) => {
      if (checkingRef.current) {
        return onlineRef.current;
      }
      checkingRef.current = true;
      setChecking(true);
      try {
        const navigatorOnline = readNavigatorOnline();
        if (navigatorOnline === false) {
          failStreakRef.current = failThreshold;
          setOnline(false);
          return false;
        }

        const nextOnline = await pingOnline();
        if (nextOnline) {
          failStreakRef.current = 0;
          setOnline(true);
          return true;
        }

        failStreakRef.current += 1;
        if (immediate || failStreakRef.current >= failThreshold) {
          setOnline(false);
          return false;
        }
        return onlineRef.current;
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [failThreshold]
  );

  const retry = useCallback(async () => {
    failStreakRef.current = 0;
    return check(true);
  }, [check]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) {
        return;
      }
      await check();
    };

    void run();
    const intervalId = setInterval(() => {
      void run();
    }, 30000);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void run();
      }
    });

    const handleBrowserChange = () => {
      if (readNavigatorOnline() === false) {
        failStreakRef.current = failThreshold;
        setOnline(false);
        return;
      }
      void run();
    };

    // RN Android/iOS expose `window` but not the browser EventTarget API.
    const browserWindow =
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function' &&
      typeof window.removeEventListener === 'function'
        ? window
        : null;

    if (browserWindow) {
      browserWindow.addEventListener('online', handleBrowserChange);
      browserWindow.addEventListener('offline', handleBrowserChange);
    }

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      subscription.remove();
      if (browserWindow) {
        browserWindow.removeEventListener('online', handleBrowserChange);
        browserWindow.removeEventListener('offline', handleBrowserChange);
      }
    };
  }, [check, failThreshold]);

  return { online, checking, retry };
}

export function useNetworkStatus() {
  return useCustomerNetwork().online;
}
