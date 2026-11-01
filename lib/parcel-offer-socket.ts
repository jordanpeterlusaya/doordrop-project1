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

/** Resolve parcel offer WebSocket URL. Prefer EXPO_PUBLIC_PARCEL_OFFER_WS_URL. */
export function getParcelOfferWsUrl() {
  const explicit = getRuntimeEnvValue('EXPO_PUBLIC_PARCEL_OFFER_WS_URL').trim().replace(/\/+$/, '');
  if (explicit) return explicit;

  if (__DEV__) {
    const port = getRuntimeEnvValue('EXPO_PUBLIC_PARCEL_OFFER_WS_PORT').trim() || '4011';
    return `ws://${devSocketHost() || '127.0.0.1'}:${port}`;
  }

  const port = getRuntimeEnvValue('EXPO_PUBLIC_PARCEL_OFFER_WS_PORT').trim() || '4011';
  const apiBase = getDoorDropApiRuntimeConfig().resolvedApiBaseUrl;
  const wsBase = httpToWsBase(apiBase);
  if (!wsBase) return '';

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
    // fall through
  }

  return '';
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
    throw new Error(
      'Missing parcel offer WebSocket URL. Set EXPO_PUBLIC_PARCEL_OFFER_WS_URL (e.g. ws://192.168.1.17:4011).'
    );
  }

  const socket = new WebSocket(url);
  let closed = false;

  socket.onopen = () => handlers.onOpen?.();
  socket.onclose = () => {
    closed = true;
    handlers.onClose?.();
  };
  socket.onerror = (error) => handlers.onError?.(error);
  socket.onmessage = (message) => {
    try {
      handlers.onEvent?.(JSON.parse(String(message.data)) as ParcelOfferSocketEvent);
    } catch {
      // ignore
    }
  };

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
