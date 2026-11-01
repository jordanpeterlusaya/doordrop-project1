export const SUPPORT_PHONE = '0796904849';
export const SUPPORT_WHATSAPP = '255796904849';
export const SUPPORT_PHONE_LABEL = '0796 904 849';

export function supportTelUrl() {
  return `tel:${SUPPORT_PHONE}`;
}

export function supportWhatsAppUrl(message?: string) {
  const text = encodeURIComponent(message || 'Habari HAUL Pilots support, nahitaji msaada.');
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`;
}
