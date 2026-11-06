import Constants from 'expo-constants';

import { getRuntimeEnvValue } from '@/lib/runtime-env';
import { getDoorDropApiRuntimeConfig } from '@/lib/api-config';

export type ParcelOfferSocketCarrier = {
  id: string;
  companyName?: string;
  phone?: string;
  region?: string;
};

export type ParcelOfferSocketEvent =
  | { type: 'ready'; service?: string }
  | { type: 'hello_ok'; role?: string; userId?: string; carrierId?: string }
  | {
      type: 'offered';
      orderId: string;
      status?: string;
      carrierId?: string;
      carrier?: ParcelOfferSocketCarrier | null;
      routeLabel?: string;
      fareLabel?: string;
    }
  | {
      type: 'accepted';
      orderId: string;
      carrierId?: string;
      carrier?: ParcelOfferSocketCarrier | null;
    }
  | { type: 'no_company'; orderId: string; status?: string; message?: string }
  | { type: 'cancelled'; orderId: string; by?: string }
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

/**
 * Live Cloud Run parcel-offer socket.
 * Direct string literal in the release return so Hermes cannot drop it.
 */
export const HAUL_PARCEL_OFFER_WSS = 'wss://haul-parcel-offer-ws-729242246964.us-central1.run.app';

function isPublicOfferWsUrl(url: string) {
  if (!url.startsWith('wss://')) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return host.length > 0;
  } catch {
    return false;
  }
}

/** Resolve parcel offer WebSocket URL. Release builds always have the live Cloud Run host. */
export function getParcelOfferWsUrl() {
  let explicit = '';
  try {
    explicit = getRuntimeEnvValue('EXPO_PUBLIC_PARCEL_OFFER_WS_URL').trim().replace(/\/+$/, '');
  } catch {
    explicit = '';
  }

  if (typeof __DEV__ === 'undefined' || __DEV__ === false) {
    if (isPublicOfferWsUrl(explicit)) return explicit;
    return 'wss://haul-parcel-offer-ws-729242246964.us-central1.run.app';
  }

  if (explicit.startsWith('ws://') || explicit.startsWith('wss://')) return explicit;

  const port = getRuntimeEnvValue('EXPO_PUBLIC_PARCEL_OFFER_WS_PORT').trim() || '4011';
  const apiBase = getDoorDropApiRuntimeConfig().resolvedApiBaseUrl;
  const wsBase = httpToWsBase(apiBase);
  if (wsBase) {
    try {
      const parsed = new URL(wsBase);
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
      // local dev falls through to the loopback socket
    }
  }

  return `ws://${devSocketHost() || '127.0.0.1'}:${port}`;
}

export type ParcelOfferSocketHandlers = {
  onEvent?: (event: ParcelOfferSocketEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
};

export function connectParcelOfferSocket(handlers: ParcelOfferSocketHandlers = {}) {
  const url = getParcelOfferWsUrl();
  if (!url) {
    if (__DEV__) {
      console.warn('[parcel-offer-socket] Missing EXPO_PUBLIC_PARCEL_OFFER_WS_URL.');
    }
    throw new Error('Could not reach carriers right now. Check your connection and try again.');
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
      // onclose drives reconnect / final error.
    };
    socket.onmessage = (message) => {
      try {
        handlers.onEvent?.(JSON.parse(String(message.data)) as ParcelOfferSocketEvent);
      } catch {
        // ignore malformed frames
      }
    };
  };

  bindSocket(socket);

  const send = (payload: Record<string, unknown>) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return false;
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

export type ParcelOfferSocketClient = ReturnType<typeof connectParcelOfferSocket>;
