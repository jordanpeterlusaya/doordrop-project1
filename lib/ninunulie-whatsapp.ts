import { openRecipientWhatsApp } from '@/lib/recipient-notify';

/** DoorDrop ops WhatsApp for live Ninunulie fulfillment. */
export const NINUNULIE_WHATSAPP_PHONE = '0785019093';

export type NinunulieWhatsAppPayload = {
  orderNumber: string;
  itemTitle: string;
  itemDescription?: string;
  productUrl?: string;
  photoUrls?: string[];
  /** @deprecated use photoUrls */
  photoUrl?: string;
  sellerName: string;
  sellerPhone: string;
  sellerRegion: string;
  sellerNotes?: string;
  customerName: string;
  customerPhone: string;
  deliveryLabel: string;
  customerNotes?: string;
};

export function buildNinunulieWhatsAppMessage(payload: NinunulieWhatsAppPayload) {
  const lines = [
    '*ODA MPYA — NINUNULIE (KARIAKOO)*',
    `Namba: ${payload.orderNumber}`,
    '',
    '*Bidhaa*',
    payload.itemTitle.trim(),
  ];

  if (payload.itemDescription?.trim()) {
    lines.push(`Maelezo: ${payload.itemDescription.trim()}`);
  }
  if (payload.productUrl?.trim()) {
    lines.push(`Link: ${payload.productUrl.trim()}`);
  }

  const photos = [
    ...(payload.photoUrls || []),
    ...(payload.photoUrl ? [payload.photoUrl] : []),
  ]
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  const uniquePhotos = [...new Set(photos)];
  if (uniquePhotos.length) {
    lines.push('', '*Picha*');
    uniquePhotos.forEach((url, index) => {
      lines.push(`${index + 1}. ${url}`);
    });
  }

  const sellerPhone = payload.sellerPhone.trim();
  const sellerHasNumber = sellerPhone && sellerPhone !== 'HAUL-SOURCE';
  lines.push(
    '',
    '*Chanzo*',
    sellerHasNumber
      ? `${payload.sellerName.trim()} · ${sellerPhone}`
      : `${payload.sellerName.trim() || 'HAUL itatafuta duka'}`,
    `Soko: ${payload.sellerRegion.trim()}`
  );
  if (!sellerHasNumber) {
    lines.push('Mteja hana namba ya duka — tafuta bidhaa.');
  }
  if (payload.sellerNotes?.trim()) {
    lines.push(`Mahali: ${payload.sellerNotes.trim()}`);
  }

  lines.push(
    '',
    '*Mpokeaji (kutoka app)*',
    `${payload.customerName.trim()} · ${payload.customerPhone.trim()}`,
    `Ukabidhaji: ${payload.deliveryLabel.trim()}`
  );
  if (payload.customerNotes?.trim()) {
    lines.push(`Maelezo: ${payload.customerNotes.trim()}`);
  }

  lines.push(
    '',
    '*Malipo*',
    sellerHasNumber
      ? `Mteja analipa duka kwa namba ${sellerPhone}`
      : 'HAUL itapeleka namba ya malipo baada ya kupata duka',
    'Agent anasimamia malipo dukani na makabidhiano',
    'Kisha HAUL inasafirisha mzigo',
    '',
    '_Imetumwa kutoka HAUL app_'
  );
  return lines.join('\n');
}

export async function openNinunulieWhatsAppOrder(payload: NinunulieWhatsAppPayload) {
  const body = buildNinunulieWhatsAppMessage(payload);
  await openRecipientWhatsApp(NINUNULIE_WHATSAPP_PHONE, body);
}
