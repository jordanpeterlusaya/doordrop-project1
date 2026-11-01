const DEFAULT_COUNTRY_CODE = '+255';
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizePhoneNumber(input?: string | null) {
  const trimmed = String(input || '').trim();

  if (!trimmed) {
    return '';
  }

  const compact = trimmed.replace(/[^\d+]/g, '');

  if (compact.startsWith('+')) {
    return E164_PATTERN.test(compact) ? compact : '';
  }

  const digitsOnly = compact.replace(/\D/g, '');

  if (digitsOnly.startsWith('255') && digitsOnly.length >= 12) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith('0') && digitsOnly.length >= 10) {
    return `${DEFAULT_COUNTRY_CODE}${digitsOnly.slice(1)}`;
  }

  if (digitsOnly.length === 9) {
    return `${DEFAULT_COUNTRY_CODE}${digitsOnly}`;
  }

  return '';
}
