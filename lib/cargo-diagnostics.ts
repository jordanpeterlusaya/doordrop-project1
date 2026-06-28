import { logInfo } from '@/lib/debug-logger';
import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';

const CARGO_DIAGNOSTIC_KEY = 'doordrop.cargo.lastDiagnostic';

let activeCargoAttemptId = '';

export type CargoDiagnosticEntry = {
  attemptId: string;
  at: string;
  details?: string;
  step: string;
};

function normalizeDetails(details?: unknown) {
  if (details === undefined) {
    return undefined;
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function buildEntry(step: string, details?: unknown): CargoDiagnosticEntry {
  if (!activeCargoAttemptId) {
    activeCargoAttemptId = `cargo-${Date.now()}`;
  }

  return {
    attemptId: activeCargoAttemptId,
    at: new Date().toISOString(),
    details: normalizeDetails(details),
    step,
  };
}

export async function beginCargoDiagnosticAttempt(source: string, details?: unknown) {
  activeCargoAttemptId = `cargo-${Date.now()}`;
  await recordCargoDiagnostic(`attempt-start:${source}`, details);
}

export async function recordCargoDiagnostic(step: string, details?: unknown) {
  const entry = buildEntry(step, details);
  logInfo('CargoDiagnostics', step, {
    attemptId: entry.attemptId,
    details: entry.details,
  });
  await setPersistedItem(CARGO_DIAGNOSTIC_KEY, JSON.stringify(entry));
  return entry;
}

export async function getLastCargoDiagnostic() {
  const rawValue = await getPersistedItem(CARGO_DIAGNOSTIC_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as CargoDiagnosticEntry;
  } catch {
    return {
      attemptId: 'unknown',
      at: new Date(0).toISOString(),
      details: rawValue,
      step: 'diagnostic-parse-failure',
    } satisfies CargoDiagnosticEntry;
  }
}
