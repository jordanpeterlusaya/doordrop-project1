import { Linking } from 'react-native';

const PLACEHOLDER_PHONE = /^(not provided|haijatolewa|n\/a|none|null|undefined|-)$/i;

export function readablePhone(value?: string | null) {
  const trimmed = String(value || '').trim();
  if (!trimmed || PLACEHOLDER_PHONE.test(trimmed)) {
    return '';
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) {
    return '';
  }

  return trimmed;
}

export function dialTarget(phone?: string | null) {
  const readable = readablePhone(phone);
  if (!readable) {
    return '';
  }

  const digits = readable.replace(/\D/g, '');
  return `tel:${readable.startsWith('+') ? '+' : ''}${digits}`;
}

/** Opens the device phone app on the number. Skips canOpenURL, which returns false for tel: on Android. */
export async function openPhoneDialer(phone?: string | null) {
  const target = dialTarget(phone);
  if (!target) {
    return false;
  }

  await Linking.openURL(target);
  return true;
}
