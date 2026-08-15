import { Linking, Platform } from 'react-native';

export function normalizeSmsPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) {
    return '';
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `+255${digits.slice(1)}`;
  }
  if (digits.startsWith('255') || digits.startsWith('254') || digits.startsWith('256') || digits.startsWith('250')) {
    return `+${digits}`;
  }
  if (digits.startsWith('1') && digits.length > 10) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function isNotifiableRecipientPhone(phone?: string | null) {
  const normalized = normalizeSmsPhone(phone?.trim() || '');
  return normalized.replace(/\D/g, '').length >= 11;
}

export function buildRecipientSmsBody(input: {
  isSw: boolean;
  senderName: string;
  orderNumber: string;
  pickup: string;
  dropoff: string;
}) {
  const sender = input.senderName.trim() || 'DoorDrop';
  if (input.isSw) {
    return `DoorDrop: ${sender} anakutumia mzigo. Oda ${input.orderNumber}. Kutoka ${input.pickup} kwenda ${input.dropoff}. Fuatilia kwenye app ya DoorDrop.`;
  }
  return `DoorDrop: ${sender} is sending you a delivery. Order ${input.orderNumber}. From ${input.pickup} to ${input.dropoff}. Open DoorDrop to track.`;
}

export async function openRecipientSms(phone: string, body: string) {
  const normalized = normalizeSmsPhone(phone);
  if (!normalized) {
    throw new Error('Invalid recipient phone');
  }

  const separator = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${normalized}${separator}body=${encodeURIComponent(body)}`;
  await Linking.openURL(url);
}
