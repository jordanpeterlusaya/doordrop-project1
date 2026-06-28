import { getRuntimeEnvValue } from '@/lib/runtime-env';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

declare const __DEV__: boolean | undefined;

const verboseRuntimeLogs =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  getRuntimeEnvValue('EXPO_PUBLIC_VERBOSE_LOGS') === 'true';

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function logWithConsole(method: 'log' | 'warn' | 'error', scope: string, message: string, details?: unknown) {
  const prefix = `[DoorDrop][${scope}] ${message}`;

  if (details === undefined) {
    console[method](prefix);
    return;
  }

  console[method](prefix, details);
}

export function logInfo(scope: string, message: string, details?: unknown) {
  if (!verboseRuntimeLogs) {
    return;
  }

  logWithConsole('log', scope, message, details);
}

export function logWarning(scope: string, message: string, details?: unknown) {
  logWithConsole('warn', scope, message, details);
}

export function logError(scope: string, message: string, error?: unknown, details?: unknown) {
  let payload: Record<string, unknown> | undefined;

  if (error !== undefined || details !== undefined) {
    payload = {};

    if (details !== undefined) {
      payload.details = details;
    }

    if (error !== undefined) {
      payload.error = normalizeError(error);
    }
  }

  logWithConsole('error', scope, message, payload);
}

export function logAsyncStart(scope: string, operation: string, details?: unknown) {
  logInfo(scope, `${operation}:start`, details);
}

export function logAsyncSuccess(scope: string, operation: string, details?: unknown) {
  logInfo(scope, `${operation}:success`, details);
}

export function logAsyncFailure(scope: string, operation: string, error: unknown, details?: unknown) {
  logError(scope, `${operation}:failure`, error, details);
}

export function logBoundaryError(scope: string, error: unknown, componentStack?: string) {
  logError(scope, 'render-failure', error, componentStack ? { componentStack } : undefined);
}

export function installGlobalErrorLogging() {
  const globalScope = globalThis as typeof globalThis & {
    __DOORDROP_GLOBAL_ERROR_LOGGING_INSTALLED__?: boolean;
    ErrorUtils?: {
      getGlobalHandler?: () => GlobalErrorHandler | undefined;
      setGlobalHandler?: (handler: GlobalErrorHandler) => void;
    };
    onunhandledrejection?: ((event: unknown) => void) | null;
  };

  if (globalScope.__DOORDROP_GLOBAL_ERROR_LOGGING_INSTALLED__) {
    return;
  }

  globalScope.__DOORDROP_GLOBAL_ERROR_LOGGING_INSTALLED__ = true;

  const errorUtils = globalScope.ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();

  if (errorUtils?.setGlobalHandler) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      logError('GlobalError', isFatal ? 'fatal-js-exception' : 'js-exception', error);
      previousHandler?.(error, isFatal);
    });
  }

  const previousUnhandledRejection = globalScope.onunhandledrejection;
  globalScope.onunhandledrejection = (event: unknown) => {
    const reason =
      typeof event === 'object' && event !== null && 'reason' in event ? (event as { reason?: unknown }).reason : event;
    logError('UnhandledPromise', 'unhandled-rejection', reason, event);
    previousUnhandledRejection?.(event);
  };

  logInfo('GlobalError', 'debug logging installed');
}
