import Constants from 'expo-constants';

export type CargoOfferSocketEvent = {
  type: string;
  orderId?: string;
  driverId?: string;
  status?: string;
  message?: string;
  by?: string;
  reason?: string;
  order?: Record<string, unknown>;
  driver?: {
    id?: string;
    name?: string;
    latitude?: number;
    longitude?: number;
    etaMinutes?: number | null;
  } | null;
  nearbyCount?: number;
};

function getExtra() {
  const manifestExtra = (Constants as any).manifest2?.extra?.expoClient?.extra;
  return Constants.expoConfig?.extra ?? manifestExtra ?? {};
}

function env(key: string) {
  const fromProcess = String((process.env as Record<string, string | undefined>)[key] || '').trim();
  if (fromProcess) return fromProcess;
  const extra = getExtra() as Record<string, unknown>;
  const value = extra[key];
  return typeof value === 'string' ? value.trim() : '';
}

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

const PRODUCTION_CARGO_OFFER_WS_URL =
  'wss://haul-cargo-offer-ws-729242246964.us-central1.run.app';

export function getCargoOfferWsUrl() {
  const explicit = env('EXPO_PUBLIC_CARGO_OFFER_WS_URL').replace(/\/+$/, '');
  if (explicit) return explicit;

  if (__DEV__) {
    const port = env('EXPO_PUBLIC_CARGO_OFFER_WS_PORT') || '4010';
    return `ws://${devSocketHost() || '127.0.0.1'}:${port}`;
  }

  const port = env('EXPO_PUBLIC_CARGO_OFFER_WS_PORT') || '4010';
  const apiBase = env('EXPO_PUBLIC_API_BASE_URL') || String((getExtra() as { apiBaseUrl?: string }).apiBaseUrl || '');
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
      // fall through to production default
    }
  }

  return PRODUCTION_CARGO_OFFER_WS_URL;
}

export function connectCargoOfferSocket(handlers: {
  onEvent?: (event: CargoOfferSocketEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
} = {}) {
  const url = getCargoOfferWsUrl();
  if (!url) {
    throw new Error('Missing EXPO_PUBLIC_CARGO_OFFER_WS_URL for cargo offer WebSocket.');
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
      handlers.onEvent?.(JSON.parse(String(message.data)) as CargoOfferSocketEvent);
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
  };
}
