import Constants from 'expo-constants';

type RuntimeEnv = Record<string, string | undefined>;

function getExpoExtra(): Record<string, unknown> {
  const constants = Constants as {
    expoConfig?: { extra?: Record<string, unknown> } | null;
    manifest?: { extra?: Record<string, unknown> } | null;
    manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } } | null;
  };
  const candidates = [
    constants.expoConfig?.extra,
    constants.manifest?.extra,
    constants.manifest2?.extra?.expoClient?.extra,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }
  return {};
}

export function getRuntimeEnv() {
  if (typeof process === 'undefined' || !process?.env) {
    return {} as RuntimeEnv;
  }

  return process.env as RuntimeEnv;
}

export function getRuntimeEnvValue(key: string) {
  const fromProcess = getRuntimeEnv()[key];
  if (typeof fromProcess === 'string' && fromProcess.trim()) {
    return fromProcess;
  }

  const extra = getExpoExtra();
  const fromExtra = extra[key];
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    return fromExtra;
  }

  // Also accept short aliases baked into app.config extra (cargoOfferWsUrl, etc.)
  const aliases: Record<string, string[]> = {
    EXPO_PUBLIC_API_BASE_URL: ['apiBaseUrl'],
    EXPO_PUBLIC_CARGO_OFFER_WS_URL: ['cargoOfferWsUrl'],
    EXPO_PUBLIC_PARCEL_OFFER_WS_URL: ['parcelOfferWsUrl'],
  };
  for (const alias of aliases[key] || []) {
    const value = extra[alias];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return '';
}
