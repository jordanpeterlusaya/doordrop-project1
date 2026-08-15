import { syncDoorDropApiRuntimeConfig } from '@/lib/api-debug';
import { logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import { getRuntimeEnvValue } from '@/lib/runtime-env';
import Constants from 'expo-constants';

const BACKEND_COOLDOWN_MS = 45000;
const HEALTH_TIMEOUT_MS = 5000;
let lastBackendFailureAt = 0;

function getExpoExtra() {
  const manifestExtra = (Constants as any).manifest2?.extra?.expoClient?.extra;
  return Constants.expoConfig?.extra ?? manifestExtra ?? {};
}

export function getDoorDropApiBaseUrl() {
  return getDoorDropApiRuntimeConfig().resolvedApiBaseUrl;
}

export function getDoorDropApiRuntimeConfig() {
  const processEnvApiBaseUrl = getRuntimeEnvValue('EXPO_PUBLIC_API_BASE_URL').trim().replace(/\/+$/, '');
  const extra = getExpoExtra() as { apiBaseUrl?: string };
  const extraApiBaseUrl = typeof extra.apiBaseUrl === 'string' ? extra.apiBaseUrl.trim().replace(/\/+$/, '') : '';
  const resolvedApiBaseUrl = processEnvApiBaseUrl || extraApiBaseUrl;

  return {
    processEnvApiBaseUrl,
    extraApiBaseUrl,
    resolvedApiBaseUrl,
    runtimeSource: processEnvApiBaseUrl ? 'process.env' : extraApiBaseUrl ? 'expo.extra' : 'missing',
    missingEnvMessage: resolvedApiBaseUrl ? null : 'Missing EXPO_PUBLIC_API_BASE_URL',
  } as const;
}

export function hasDoorDropApiBaseUrl() {
  return getDoorDropApiBaseUrl().length > 0;
}

export function ensureDoorDropApiBaseUrl() {
  const runtimeConfig = getDoorDropApiRuntimeConfig();
  syncDoorDropApiRuntimeConfig(runtimeConfig);

  const baseUrl = runtimeConfig.resolvedApiBaseUrl;
  if (!baseUrl) {
    throw new Error(runtimeConfig.missingEnvMessage ?? 'Missing EXPO_PUBLIC_API_BASE_URL');
  }

  logInfo('DoorDropApiConfig', 'resolved-api-base-url', {
    apiBaseUrl: baseUrl,
    runtimeSource: runtimeConfig.runtimeSource,
  });

  return baseUrl;
}

export function maskConfigSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'missing';
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function isDoorDropBackendCoolingDown() {
  return Date.now() - lastBackendFailureAt < BACKEND_COOLDOWN_MS;
}

export function markDoorDropBackendFailure() {
  lastBackendFailureAt = Date.now();
}

export function markDoorDropBackendHealthy() {
  lastBackendFailureAt = 0;
}

function parseJsonObject(rawText: string) {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function checkDoorDropBackendHealth(scope: string) {
  const runtimeConfig = getDoorDropApiRuntimeConfig();
  syncDoorDropApiRuntimeConfig(runtimeConfig);
  const baseUrl = runtimeConfig.resolvedApiBaseUrl;

  logInfo(scope, 'api-config', {
    apiBaseUrl: baseUrl || 'missing',
    hasApiBaseUrl: Boolean(baseUrl),
  });

  if (!baseUrl) {
    return null;
  }

  if (isDoorDropBackendCoolingDown()) {
    logInfo(scope, 'backendHealth:skipped-cooldown', { apiBaseUrl: baseUrl });
    return null;
  }

  logAsyncStart(scope, 'backendHealth', { url: `${baseUrl}/health` });

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS) : null;

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller?.signal,
    });
    const payload = parseJsonObject(await response.text());

    if (!response.ok || !payload) {
      markDoorDropBackendFailure();
      logWarning(scope, 'backendHealth:unavailable', {
        apiBaseUrl: baseUrl,
        status: response.status,
      });
      return null;
    }

    markDoorDropBackendHealthy();
    logAsyncSuccess(scope, 'backendHealth', payload);
    return payload;
  } catch (error) {
    markDoorDropBackendFailure();
    logWarning(scope, 'backendHealth:unavailable', {
      apiBaseUrl: baseUrl,
      message: error instanceof Error ? error.message : 'unreachable',
    });
    return null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

syncDoorDropApiRuntimeConfig(getDoorDropApiRuntimeConfig());
