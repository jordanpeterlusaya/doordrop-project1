import { openRecipientWhatsApp } from '@/lib/recipient-notify';

export const SUPPORT_PHONE = '0796904849';
export const SUPPORT_WHATSAPP = '255796904849';
export const SUPPORT_PHONE_LABEL = '0796 904 849';

export function buildAdminWhatsAppOrderMessage(input: {
  orderNumber: string;
  isSw: boolean;
  origin?: string;
  destination?: string;
}) {
  const orderRef = String(input.orderNumber || '').trim() || '—';
  const route =
    input.origin?.trim() && input.destination?.trim()
      ? ` (${input.origin.trim()} → ${input.destination.trim()})`
      : '';

  if (input.isSw) {
    return `Oda ${orderRef}${route} - Habari DoorDrop, ninahitaji msaada kuhusu mzigo wangu.`;
  }

  return `Order ${orderRef}${route} - Hello DoorDrop, I need help with my parcel.`;
}

export async function openSupportWhatsApp(body: string) {
  await openRecipientWhatsApp(`+${SUPPORT_WHATSAPP}`, body);
}
