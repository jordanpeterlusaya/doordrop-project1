type DoorDropRequestKind =
  | 'backend-health'
  | 'places-autocomplete'
  | 'place-details'
  | 'place-resolve'
  | 'routes-estimate'
  | 'pricing-estimate';

export type DoorDropApiErrorKind =
  | 'network_error'
  | 'http_error'
  | 'json_parse_error'
  | 'empty_response'
  | 'frontend_parse_error'
  | 'request_setup_error';

export type DoorDropApiDebugState = {
  processEnvApiBaseUrl: string;
  extraApiBaseUrl: string;
  resolvedApiBaseUrl: string;
  runtimeSource: 'process.env' | 'expo.extra' | 'missing';
  missingEnvMessage: string | null;
  lastRequestMethod: string;
  lastRequestUrl: string;
  lastRequestBody: string;
  lastAutocompleteUrl: string;
  lastPlaceResolveUrl: string;
  lastRoutesUrl: string;
  lastRoutesBody: string;
  lastResponseStatus: number | null;
  lastResponseStatusLabel: string;
  lastResponseUrl: string;
  lastResponseBody: string;
  lastResponseRawText: string;
  lastParsedResponseBody: string;
  lastErrorKind: DoorDropApiErrorKind | '';
  lastErrorMessage: string;
  lastErrorUrl: string;
  lastErrorStack: string;
};

type DoorDropApiRuntimePayload = {
  processEnvApiBaseUrl?: string;
  extraApiBaseUrl?: string;
  resolvedApiBaseUrl?: string;
  runtimeSource?: DoorDropApiDebugState['runtimeSource'];
  missingEnvMessage?: string | null;
};

type DoorDropApiRequestPayload = {
  kind: DoorDropRequestKind;
  method?: string;
  url: string;
  body?: unknown;
};

type DoorDropApiResponsePayload = {
  url: string;
  status: number;
  statusLabel?: string;
  rawText?: string;
  parsedBody?: unknown;
};

type DoorDropApiErrorPayload = {
  url: string;
  kind: DoorDropApiErrorKind;
  status?: number | null;
  body?: unknown;
  error: unknown;
};

const MAX_DEBUG_TEXT_LENGTH = 2400;

const defaultState: DoorDropApiDebugState = {
  processEnvApiBaseUrl: '',
  extraApiBaseUrl: '',
  resolvedApiBaseUrl: '',
  runtimeSource: 'missing',
  missingEnvMessage: null,
  lastRequestMethod: '',
  lastRequestUrl: '',
  lastRequestBody: '',
  lastAutocompleteUrl: '',
  lastPlaceResolveUrl: '',
  lastRoutesUrl: '',
  lastRoutesBody: '',
  lastResponseStatus: null,
  lastResponseStatusLabel: '',
  lastResponseUrl: '',
  lastResponseBody: '',
  lastResponseRawText: '',
  lastParsedResponseBody: '',
  lastErrorKind: '',
  lastErrorMessage: '',
  lastErrorUrl: '',
  lastErrorStack: '',
};

let state = defaultState;
const listeners = new Set<() => void>();

function emitState() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function truncateDebugText(value: string) {
  if (value.length <= MAX_DEBUG_TEXT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_DEBUG_TEXT_LENGTH)}…`;
}

function stringifyDebugValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return truncateDebugText(value);
  }

  try {
    return truncateDebugText(JSON.stringify(value));
  } catch {
    return truncateDebugText(String(value));
  }
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return stringifyDebugValue(error) || 'Unknown API error';
}

function normalizeRawError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function normalizeErrorStack(error: unknown) {
  if (error instanceof Error && typeof error.stack === 'string') {
    return truncateDebugText(error.stack);
  }

  if (typeof error === 'object' && error !== null && 'stack' in error) {
    return truncateDebugText(String((error as { stack?: unknown }).stack ?? ''));
  }

  return '';
}

function updateState(partial: Partial<DoorDropApiDebugState>) {
  state = {
    ...state,
    ...partial,
  };
  emitState();
}

export function getDoorDropApiDebugState() {
  return state;
}

export function subscribeDoorDropApiDebug(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function syncDoorDropApiRuntimeConfig(payload: DoorDropApiRuntimePayload) {
  const processEnvApiBaseUrl = payload.processEnvApiBaseUrl?.trim() ?? '';
  const extraApiBaseUrl = payload.extraApiBaseUrl?.trim() ?? '';
  const resolvedApiBaseUrl = payload.resolvedApiBaseUrl?.trim() ?? '';
  const missingEnvMessage = payload.missingEnvMessage?.trim() || null;
  const runtimeSource =
    payload.runtimeSource ?? (resolvedApiBaseUrl ? 'process.env' : 'missing');

  updateState({
    processEnvApiBaseUrl,
    extraApiBaseUrl,
    resolvedApiBaseUrl,
    runtimeSource,
    missingEnvMessage,
    lastRequestMethod: state.lastRequestMethod,
    lastRequestUrl: state.lastRequestUrl,
    lastErrorMessage: missingEnvMessage ?? state.lastErrorMessage,
    lastErrorUrl: missingEnvMessage ? 'runtime-config' : state.lastErrorUrl,
  });

  console.log('[DoorDrop API_BASE_URL]', resolvedApiBaseUrl || missingEnvMessage || 'missing');

  if (missingEnvMessage) {
    console.error('[DoorDrop API Error]', missingEnvMessage);
  }
}

export function recordDoorDropApiRequest(payload: DoorDropApiRequestPayload) {
  const bodyText = stringifyDebugValue(payload.body);
  const method = (payload.method || 'GET').toUpperCase();

  updateState({
    lastRequestMethod: method,
    lastRequestUrl: payload.url,
    lastRequestBody: bodyText,
    lastResponseStatus: null,
    lastResponseStatusLabel: 'Waiting for response',
    lastResponseUrl: '',
    lastResponseBody: '',
    lastResponseRawText: '',
    lastParsedResponseBody: '',
    lastErrorKind: '',
    lastErrorMessage: '',
    lastErrorUrl: '',
    lastErrorStack: '',
  });

  if (payload.kind === 'places-autocomplete') {
    updateState({
      lastAutocompleteUrl: payload.url,
    });
    console.log('[DoorDrop API Request]', {
      kind: payload.kind,
      method,
      url: payload.url,
      body: payload.body ?? null,
    });
    return;
  }

  if (payload.kind === 'place-details' || payload.kind === 'place-resolve') {
    updateState({
      lastPlaceResolveUrl: payload.url,
    });
    console.log('[DoorDrop API Request]', {
      kind: payload.kind,
      method,
      url: payload.url,
      body: payload.body ?? null,
    });
    return;
  }

  if (payload.kind === 'routes-estimate') {
    updateState({
      lastRoutesUrl: payload.url,
      lastRoutesBody: bodyText,
    });
  }

  console.log('[DoorDrop API Request]', {
    kind: payload.kind,
    method,
    url: payload.url,
    body: payload.body ?? null,
  });
}

export function recordDoorDropApiResponse(payload: DoorDropApiResponsePayload) {
  const rawText = stringifyDebugValue(payload.rawText);
  const parsedBodyText = stringifyDebugValue(payload.parsedBody);
  const bodyText = parsedBodyText || rawText || 'empty';
  const statusLabel = payload.statusLabel || String(payload.status);

  updateState({
    lastResponseStatus: payload.status,
    lastResponseStatusLabel: statusLabel,
    lastResponseUrl: payload.url,
    lastResponseBody: bodyText,
    lastResponseRawText: rawText || 'empty',
    lastParsedResponseBody: parsedBodyText || 'empty',
  });

  console.log('[DoorDrop API Response]', {
    url: payload.url,
    status: payload.status,
    statusLabel,
    rawText: payload.rawText ?? '',
    parsedBody: payload.parsedBody ?? null,
  });
}

export function recordDoorDropApiError(payload: DoorDropApiErrorPayload) {
  const errorMessage = normalizeErrorMessage(payload.error);
  const bodyText = stringifyDebugValue(payload.body);
  const stack = normalizeErrorStack(payload.error);

  updateState({
    lastResponseStatus: payload.status ?? null,
    lastResponseStatusLabel: payload.kind,
    lastResponseUrl: payload.url,
    lastResponseBody: bodyText || state.lastResponseBody,
    lastErrorKind: payload.kind,
    lastErrorMessage: errorMessage,
    lastErrorUrl: payload.url,
    lastErrorStack: stack,
  });

  console.error('[DoorDrop API Error]', {
    url: payload.url,
    kind: payload.kind,
    status: payload.status ?? null,
    error: errorMessage,
    rawError: normalizeRawError(payload.error),
    stack,
    body: payload.body ?? bodyText ?? null,
  });
}
