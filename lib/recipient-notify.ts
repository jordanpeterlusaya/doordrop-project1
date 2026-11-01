import { Linking, Platform } from 'react-native';

import { getOrderRouteDisplay } from '@/lib/order-route-display';

const ANDROID_SMS_PACKAGES = [
  'com.transsion.smartmessage',
  'com.google.android.apps.messaging',
  'com.android.mms',
  'com.samsung.android.messaging',
  'com.android.messaging',
];

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

export function phoneToDigits(phone: string) {
  return normalizeSmsPhone(phone).replace(/\D/g, '');
}

export function isNotifiableRecipientPhone(phone?: string | null) {
  return phoneToDigits(phone?.trim() || '').length >= 11;
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
    return `DoorDrop: ${sender} anakutumia mzigo ${input.orderNumber}. ${input.pickup}→${input.dropoff}. Pakua DoorDrop uone dereva kwenye ramani.`;
  }
  return `DoorDrop: ${sender} sent order ${input.orderNumber}. ${input.pickup}→${input.dropoff}. Get DoorDrop to track live on the map.`;
}

export function buildOutsideRecipientNotifyBody(input: {
  isSw: boolean;
  senderName: string;
  parcelCode: string;
  orderNumber: string;
  origin: string;
  destination: string;
  transportLabel?: string;
}) {
  const sender = input.senderName.trim() || 'DoorDrop';
  const code = input.parcelCode.trim() || input.orderNumber.trim();
  const route = `${input.origin} → ${input.destination}`;
  const modeSuffix = input.transportLabel ? ` (${input.transportLabel})` : '';

  if (input.isSw) {
    return `DoorDrop: ${sender} amekutumia mzigo ${code}. ${route}${modeSuffix}. Pakua DoorDrop, weka msimbo huu ufuatilie moja kwa moja.`;
  }

  return `DoorDrop: ${sender} sent parcel ${code}. ${route}${modeSuffix}. Download DoorDrop, enter this code to track live.`;
}

export function buildRecipientNotifyBody(
  order: {
    orderNumber: string;
    pickupLabel: string;
    dropoffLabel: string;
    parcelCode?: string | null;
    trackingId?: string | null;
    outsideOriginCity?: string | null;
    outsideDestinationCity?: string | null;
    outsideDestinationLabel?: string | null;
    outsideShippingMode?: string | null;
    outsideHandoffMode?: string | null;
  },
  input: { isSw: boolean; senderName: string; transportLabel?: string; isOutside: boolean }
) {
  if (input.isOutside) {
    const route = getOrderRouteDisplay(order);
    return buildOutsideRecipientNotifyBody({
      isSw: input.isSw,
      senderName: input.senderName,
      parcelCode: String(order.parcelCode || order.trackingId || order.orderNumber).trim(),
      orderNumber: order.orderNumber,
      origin: route.from,
      destination: String(order.outsideDestinationCity || order.outsideDestinationLabel || route.to).trim(),
      transportLabel: input.transportLabel,
    });
  }

  const route = getOrderRouteDisplay(order);
  return buildRecipientSmsBody({
    isSw: input.isSw,
    senderName: input.senderName,
    orderNumber: order.orderNumber,
    pickup: route.from,
    dropoff: route.to,
  });
}

function buildAndroidSmsIntentUrl(digits: string, body: string, packageName?: string) {
  const encodedBody = encodeURIComponent(body);
  const packageSuffix = packageName ? `;package=${packageName}` : '';
  return `intent://send/smsto:${digits}?body=${encodedBody}#Intent;scheme=smsto;action=android.intent.action.SENDTO${packageSuffix};end`;
}

async function openAndroidSmsComposer(digits: string, body: string) {
  const encodedBody = encodeURIComponent(body);
  const smstoUrl = `smsto:${digits}?body=${encodedBody}`;

  for (const packageName of ANDROID_SMS_PACKAGES) {
    const intentUrl = buildAndroidSmsIntentUrl(digits, body, packageName);
    try {
      if (await Linking.canOpenURL(intentUrl)) {
        await Linking.openURL(intentUrl);
        return;
      }
    } catch {
      // Try the next package-specific intent URL.
    }
  }

  await Linking.openURL(smstoUrl);
}

async function openAndroidWhatsApp(digits: string, body: string) {
  const encodedBody = encodeURIComponent(body);
  const nativeUrl = `whatsapp://send?phone=${digits}&text=${encodedBody}`;

  if (await Linking.canOpenURL(nativeUrl)) {
    await Linking.openURL(nativeUrl);
    return;
  }

  await Linking.openURL(`https://wa.me/${digits}?text=${encodedBody}`);
}

export async function openRecipientSms(phone: string, body: string) {
  const digits = phoneToDigits(phone);
  if (digits.length < 11) {
    throw new Error('Invalid recipient phone');
  }

  if (Platform.OS === 'android') {
    await openAndroidSmsComposer(digits, body);
    return;
  }

  const normalized = normalizeSmsPhone(phone);
  await Linking.openURL(`sms:${normalized}&body=${encodeURIComponent(body)}`);
}

export async function openRecipientWhatsApp(phone: string, body: string) {
  const digits = phoneToDigits(phone);
  if (digits.length < 11) {
    throw new Error('Invalid recipient phone');
  }

  if (Platform.OS === 'android') {
    await openAndroidWhatsApp(digits, body);
    return;
  }

  const encodedBody = encodeURIComponent(body);
  const nativeUrl = `whatsapp://send?phone=${digits}&text=${encodedBody}`;

  if (await Linking.canOpenURL(nativeUrl)) {
    await Linking.openURL(nativeUrl);
    return;
  }

  await Linking.openURL(`https://wa.me/${digits}?text=${encodedBody}`);
}
