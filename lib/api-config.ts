import { syncDoorDropApiRuntimeConfig } from '@/lib/api-debug';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo } from '@/lib/debug-logger';
import { getRuntimeEnvValue } from '@/lib/runtime-env';
import Constants from 'expo-constants';

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

  logAsyncStart(scope, 'backendHealth', { url: `${baseUrl}/health` });

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || `Backend health failed with ${response.status}`);
    }

    logAsyncSuccess(scope, 'backendHealth', payload);
    return payload;
  } catch (error) {
    logAsyncFailure(scope, 'backendHealth', error, { apiBaseUrl: baseUrl });
    return null;
  }
}

syncDoorDropApiRuntimeConfig(getDoorDropApiRuntimeConfig());
