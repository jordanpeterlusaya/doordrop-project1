/** Light client-side phone helpers (server still normalizes for SMS). */

export function digitsOnly(value: string) {
  return String(value || '').replace(/\D/g, '');
}

export function isValidTzPhone(value: string) {
  const digits = digitsOnly(value);
  return digits.length >= 9 && digits.length <= 15;
}

export function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
