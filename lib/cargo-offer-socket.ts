import Constants from 'expo-constants';

import { getRuntimeEnvValue } from '@/lib/runtime-env';
import { getDoorDropApiRuntimeConfig } from '@/lib/api-config';

export type CargoOfferSocketDriver = {
  id: string;
  name?: string;
  phone?: string;
  vehicleType?: string;
  vehicleLabel?: string;
  plateNumber?: string;
  photoURL?: string;
  latitude?: number;
  longitude?: number;
  heading?: number;
  distanceMeters?: number;
  etaMinutes?: number | null;
};

export type CargoOfferSocketEvent =
  | { type: 'ready'; service?: string }
  | { type: 'hello_ok'; role?: string; userId?: string; driverId?: string }
  | {
      type: 'assigned' | 'no_driver' | 'declined';
      orderId: string;
      status?: string;
      reassigned?: boolean;
      fareLabel?: string;
      vehicleKey?: string;
      vehicleLabel?: string;
      driver?: CargoOfferSocketDriver | null;
      nearbyCount?: number;
      nearbyDrivers?: CargoOfferSocketDriver[];
    }
  | { type: 'accepted'; orderId: string; driverId?: string }
  | { type: 'cancelled'; orderId: string; by?: string }
  | { type: 'offer'; orderId: string; status?: string; driver?: CargoOfferSocketDriver | null }
  | { type: 'offer_cleared'; orderId: string; reason?: string }
  | { type: 'error'; message?: string; orderId?: string }
  | { type: 'pong'; at?: number }
  | { type: string; [key: string]: unknown };

function httpToWsBase(url: string) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed;
  return '';
}

function devSocketHost() {
  const candidates = [Constants.expoConfig?.hostUri, (Constants as { linkingUri?: string }).linkingUri];
  for (const candidate of candidates) {
    const value = String(candidate || '');
    const ipv4 = value.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (ipv4?.[1] && ipv4[1] !== '127.0.0.1' && ipv4[1] !== '0.0.0.0') return ipv4[1];
  }
  return '';
}

/** Resolve cargo offer WebSocket URL. Prefer EXPO_PUBLIC_CARGO_OFFER_WS_URL. */
export function getCargoOfferWsUrl() {
  const explicit = getRuntimeEnvValue('EXPO_PUBLIC_CARGO_OFFER_WS_URL').trim().replace(/\/+$/, '');
  if (explicit) {
    return explicit;
  }

  if (__DEV__) {
    const port = getRuntimeEnvValue('EXPO_PUBLIC_CARGO_OFFER_WS_PORT').trim() || '4010';
    return `ws://${devSocketHost() || '127.0.0.1'}:${port}`;
  }

  const port = getRuntimeEnvValue('EXPO_PUBLIC_CARGO_OFFER_WS_PORT').trim() || '4010';
  const apiBase = getDoorDropApiRuntimeConfig().resolvedApiBaseUrl;
  const wsBase = httpToWsBase(apiBase);
  if (!wsBase) {
    return '';
  }

  try {
    const parsed = new URL(wsBase);
    // Local / LAN API → same host, dedicated cargo WS port.
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.startsWith('10.') ||
      parsed.hostname.startsWith('192.168.') ||
      parsed.hostname.endsWith('.local')
    ) {
      parsed.port = port;
      parsed.pathname = '/';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // fall through
  }

  // Hosted HTTPS API cannot host long-lived sockets on Cloud Functions —
  // require an explicit WS URL in production builds.
  return '';
}

export type CargoOfferSocketHandlers = {
  onEvent?: (event: CargoOfferSocketEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
};

/** User-facing connection failure (never mention WS ports / env vars). */
export class CargoOfferSocketConnectionError extends Error {
  constructor(message = 'Could not reach drivers right now. Check your connection and try again.') {
    super(message);
    this.name = 'CargoOfferSocketConnectionError';
  }
}

export function connectCargoOfferSocket(handlers: CargoOfferSocketHandlers = {}) {
  const url = getCargoOfferWsUrl();
  if (!url) {
    // Throw a user-safe message; log the config hint only in development.
    if (__DEV__) {
      console.warn(
        '[cargo-offer-socket] Missing EXPO_PUBLIC_CARGO_OFFER_WS_URL (e.g. ws://192.168.1.17:4010).'
      );
    }
    throw new CargoOfferSocketConnectionError();
  }

  let socket = new WebSocket(url);
  let closed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const maxReconnectAttempts = 2;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const bindSocket = (next: WebSocket) => {
    socket = next;
    socket.onopen = () => {
      reconnectAttempt = 0;
      handlers.onOpen?.();
    };
    socket.onclose = () => {
      if (closed) {
        handlers.onClose?.();
        return;
      }
      // Soft reconnect a couple of times before surfacing failure to the UI.
      if (reconnectAttempt < maxReconnectAttempts) {
        const delayMs = 600 * (reconnectAttempt + 1);
        reconnectAttempt += 1;
        clearReconnect();
        reconnectTimer = setTimeout(() => {
          if (closed) return;
          try {
            bindSocket(new WebSocket(url));
          } catch {
            closed = true;
            handlers.onError?.(new Event('error'));
            handlers.onClose?.();
          }
        }, delayMs);
        return;
      }
      closed = true;
      handlers.onError?.(new Event('error'));
      handlers.onClose?.();
    };
    socket.onerror = () => {
      // onclose drives reconnect / final error — avoid double-firing UI errors here.
    };
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data)) as CargoOfferSocketEvent;
        handlers.onEvent?.(data);
      } catch {
        // ignore malformed frames
      }
    };
  };

  bindSocket(socket);

  const send = (payload: Record<string, unknown>) => {
    if (closed || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  };

  return {
    url,
    send,
    close: () => {
      closed = true;
      clearReconnect();
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
    get readyState() {
      return socket.readyState;
    },
  };
}

export type CargoOfferSocketClient = ReturnType<typeof connectCargoOfferSocket>;
