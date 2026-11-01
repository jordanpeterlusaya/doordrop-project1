import { Alert, Linking, Share } from 'react-native';

import type { DeliveryOrder } from '@/lib/delivery-data';
import { getOrderRouteDisplay } from '@/lib/order-route-display';
import { isOutsideParcelOrder } from '@/lib/outside-order-logistics';

export type ReceiptLanguage = 'en' | 'sw';

export type OrderReceiptRow = {
  label: string;
  value: string;
};

export type OrderReceiptModel = {
  brand: 'HAUL';
  title: string;
  recipientName: string;
  recipientPhone: string;
  recipientPhoneDialable: string;
  trackingCode: string;
  rows: OrderReceiptRow[];
  paymentLabel?: string;
  totalLabel: string;
  originCity: string;
};

const RECEIPT_LABELS = {
  en: {
    title: 'Receipt',
    service: 'Service',
    route: 'Route',
    weight: 'Weight',
    size: 'Size',
    date: 'Date',
    time: 'Time',
    total: 'Total',
    payment: 'Payment',
  },
  sw: {
    title: 'Risiti',
    service: 'Huduma',
    route: 'Njia',
    weight: 'Uzito',
    size: 'Ukubwa',
    date: 'Tarehe',
    time: 'Muda',
    total: 'Jumla',
    payment: 'Malipo',
  },
} as const;

function sanitizeFileSegment(value: string) {
  return String(value || 'risiti')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toMillis(value: unknown) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value && typeof (value as { seconds?: number }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function isPlaceholderText(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) {
    return true;
  }
  return /^(recipient not provided|not provided|—|-)$/i.test(text);
}

function getDialablePhoneNumber(phone?: string) {
  const trimmed = String(phone || '').trim();
  if (!trimmed || isPlaceholderText(trimmed)) {
    return '';
  }
  const hasPlusPrefix = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  if (digitsOnly.length < 7) {
    return '';
  }
  return hasPlusPrefix ? `+${digitsOnly}` : digitsOnly;
}

function formatReceiptDate(ms: number, language: ReceiptLanguage) {
  return new Date(ms).toLocaleDateString(language === 'sw' ? 'sw-TZ' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatReceiptTime(ms: number, language: ReceiptLanguage) {
  return new Date(ms).toLocaleTimeString(language === 'sw' ? 'sw-TZ' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseScheduleDateTime(dateText?: string, timeText?: string) {
  const date = String(dateText || '').trim();
  const time = String(timeText || '').trim();
  if (!date) {
    return 0;
  }
  const iso = time ? `${date}T${time.length === 5 ? `${time}:00` : time}` : `${date}T00:00:00`;
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getReceiptServiceLabel(order: DeliveryOrder, language: ReceiptLanguage) {
  if (isOutsideParcelOrder(order)) {
    const mode = String(order.outsideShippingMode || '').toLowerCase();
    const stand = String(order.outsideDestinationStand || order.outsideDestinationLabel || '').toLowerCase();
    const dest = String(order.outsideDestinationCity || '').toLowerCase();
    const ferryHint = /ferry|kivuko|bandari|malindi/.test(`${stand} ${dest}`);
    const zanzibarSea =
      /zanzibar|unguja|pemba/.test(`${stand} ${dest}`) && mode !== 'express' && !mode.includes('air');

    if (mode === 'express' || mode.includes('air') || mode.includes('ndege')) {
      return 'Ndege';
    }
    if (ferryHint || zanzibarSea) {
      return 'Ferry';
    }
    if (mode === 'standard' || mode.includes('bus') || mode.includes('basi')) {
      return 'Basi';
    }
    return language === 'sw' ? 'Mkoa mwingine' : 'Intercity';
  }

  if (order.flow === 'cargo') {
    return String(order.cargoVehicleLabel || order.serviceLabel || '').trim() || 'Cargo';
  }

  return String(order.serviceLabel || order.cargoVehicleLabel || '').trim() || (language === 'sw' ? 'Mzigo' : 'Parcel');
}

export function getReceiptPaymentLabel(order: DeliveryOrder) {
  const raw = String(
    order.paymentLabel || order.paymentMethod || order.paymentProvider || order.paymentType || ''
  ).trim();
  if (!raw) {
    return undefined;
  }

  const key = raw.toLowerCase();
  if (/(m-?pesa|mpesa)/.test(key)) {
    return 'M-Pesa';
  }
  if (/(mixx|tigo)/.test(key)) {
    return 'Mixx';
  }
  if (/airtel/.test(key)) {
    return 'Airtel Money';
  }
  if (/(cash|taslimu)/.test(key)) {
    return 'Taslimu';
  }
  return raw;
}

export function getReceiptTrackingCode(order: DeliveryOrder) {
  return String(order.parcelCode || order.trackingId || order.orderNumber || order.id || '').trim();
}

/** Simple Code128-style bar widths derived from the tracking/order id. */
export function buildReceiptBarcodeWidths(value: string) {
  const seed = String(value || 'HAUL');
  const widths: number[] = [2, 1, 1, 2];
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    widths.push((code % 3) + 1);
    widths.push(((code >> 2) % 3) + 1);
    widths.push(((code >> 4) % 2) + 1);
    widths.push(((code >> 3) % 3) + 1);
  }
  widths.push(2, 1, 1, 2);
  return widths;
}

export function buildOrderReceiptModel(
  order: DeliveryOrder,
  language: ReceiptLanguage,
  originCity?: string
): OrderReceiptModel {
  const labels = RECEIPT_LABELS[language];
  const route = getOrderRouteDisplay(order);
  const resolvedOrigin = String(originCity || order.outsideOriginCity || route.from || '').trim();
  const recipientName = !isPlaceholderText(order.recipientName)
    ? String(order.recipientName).trim()
    : String(order.customerName || '').trim() || '—';
  const recipientPhone = !isPlaceholderText(order.recipientPhone)
    ? String(order.recipientPhone).trim()
    : String(order.customerPhone || '').trim();
  const trackingCode = getReceiptTrackingCode(order);
  const scheduledMs = parseScheduleDateTime(order.scheduleDate, order.scheduleTime);
  const createdMs = toMillis(order.createdAt) || Date.now();
  const stampMs = scheduledMs || createdMs;
  const weight = String(order.outsideParcelWeightKg || '').trim();
  const size = String(order.cargoSizeLabel || '').trim();
  const totalLabel = String(order.totalLabel || order.fareLabel || '').trim() || '—';
  const paymentLabel = getReceiptPaymentLabel(order);

  const rows: OrderReceiptRow[] = [
    { label: labels.service, value: getReceiptServiceLabel(order, language) },
    { label: labels.route, value: `${route.from} → ${route.to}` },
  ];

  if (weight) {
    rows.push({ label: labels.weight, value: /kg/i.test(weight) ? weight : `${weight} kg` });
  }
  if (size) {
    rows.push({ label: labels.size, value: size });
  }

  rows.push(
    { label: labels.date, value: formatReceiptDate(stampMs, language) },
    { label: labels.time, value: order.scheduleTime?.trim() || formatReceiptTime(stampMs, language) },
    { label: labels.total, value: totalLabel }
  );

  return {
    brand: 'HAUL',
    title: labels.title,
    recipientName,
    recipientPhone: recipientPhone || '—',
    recipientPhoneDialable: getDialablePhoneNumber(recipientPhone),
    trackingCode,
    rows,
    paymentLabel,
    totalLabel,
    originCity: resolvedOrigin,
  };
}

function buildReceiptHtml(model: OrderReceiptModel) {
  const barcode = buildReceiptBarcodeWidths(model.trackingCode)
    .map(
      (width, index) =>
        `<span style="display:inline-block;width:${width * 1.4}px;height:46px;background:${
          index % 2 === 0 ? '#ffffff' : 'transparent'
        }"></span>`
    )
    .join('');

  const rows = model.rows
    .map(
      (row) => `
        <tr>
          <td style="padding:9px 0;font-size:12px;color:#cbd5e1;text-align:left;">${escapeHtml(row.label)}</td>
          <td style="padding:9px 0;font-size:13px;color:#ffffff;text-align:right;font-weight:700;">${escapeHtml(
            row.value
          )}</td>
        </tr>`
    )
    .join('');

  const paymentRow = model.paymentLabel
    ? `<div style="margin:18px 4px 0;">
        <div style="font-size:11px;color:#94a3b8;">${escapeHtml(RECEIPT_LABELS.sw.payment)}</div>
        <div style="font-size:18px;font-weight:800;color:#111827;margin-top:2px;">${escapeHtml(model.paymentLabel)}</div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>HAUL ${escapeHtml(model.title)}</title>
  </head>
  <body style="margin:0;padding:28px 18px;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <div style="max-width:360px;margin:0 auto;background:#ffffff;border-radius:28px;padding:22px 20px 24px;">
      <div style="text-align:center;letter-spacing:3px;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:6px;">HAUL</div>
      <div style="text-align:center;font-size:20px;font-weight:800;margin-bottom:18px;">${escapeHtml(model.title)}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="width:46px;vertical-align:middle;">
            <div style="width:42px;height:42px;border-radius:21px;background:#f1f5f9;color:#111827;font-weight:800;text-align:center;line-height:42px;">
              ${escapeHtml(model.recipientName.slice(0, 1).toUpperCase() || 'H')}
            </div>
          </td>
          <td style="vertical-align:middle;padding-left:10px;">
            <div style="font-size:15px;font-weight:800;">${escapeHtml(model.recipientName)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(model.recipientPhone)}</div>
          </td>
        </tr>
      </table>
      <div style="background:#111111;color:#ffffff;border-radius:22px;padding:18px 18px 16px;">
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        <div style="border-top:1px dashed #475569;margin:8px 0 14px;"></div>
        <div style="text-align:center;">
          <div style="white-space:nowrap;height:46px;overflow:hidden;line-height:46px;">${barcode}</div>
          <div style="margin-top:8px;font-size:11px;letter-spacing:1.4px;color:#e2e8f0;">${escapeHtml(
            model.trackingCode
          )}</div>
        </div>
      </div>
      ${paymentRow}
    </div>
  </body>
</html>`;
}

type AnyModule = Record<string, unknown> & { default?: Record<string, unknown> };

function unwrapModule(mod: unknown): AnyModule {
  const root = (mod && typeof mod === 'object' ? (mod as AnyModule) : {}) as AnyModule;
  const nested = root.default && typeof root.default === 'object' ? root.default : null;
  return nested ? { ...root, ...nested } : root;
}

function pickFn<T>(...candidates: unknown[]): T | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      return candidate as T;
    }
  }
  return null;
}

async function tryPrintHtmlToPdf(html: string): Promise<string | null> {
  try {
    const printMod = unwrapModule(await import('expo-print'));
    const printToFileAsync = pickFn<(options: { html: string; base64: boolean }) => Promise<{ uri?: string } | null>>(
      printMod.printToFileAsync
    );
    if (!printToFileAsync) {
      return null;
    }
    const printed = await printToFileAsync({ html, base64: false });
    return printed?.uri || null;
  } catch {
    return null;
  }
}

async function writeReceiptHtmlFile(html: string, fileName: string): Promise<string | null> {
  try {
    const fsMod = unwrapModule(await import('expo-file-system/legacy'));
    const writeAsStringAsync = pickFn<(uri: string, contents: string, options?: { encoding?: string }) => Promise<void>>(
      fsMod.writeAsStringAsync
    );
    const cacheDirectory = typeof fsMod.cacheDirectory === 'string' ? fsMod.cacheDirectory : '';
    if (!writeAsStringAsync || !cacheDirectory) {
      return null;
    }
    const htmlName = fileName.replace(/\.pdf$/i, '.html');
    const uri = `${cacheDirectory}${htmlName}`;
    const encoding =
      (fsMod.EncodingType as { UTF8?: string } | undefined)?.UTF8 || 'utf8';
    await writeAsStringAsync(uri, html, { encoding });
    return uri;
  } catch {
    return null;
  }
}

async function shareReceiptFile(uri: string, fileName: string, mimeType: string) {
  try {
    const shareMod = unwrapModule(await import('expo-sharing'));
    const isAvailableAsync = pickFn<() => Promise<boolean>>(shareMod.isAvailableAsync);
    const shareAsync = pickFn<(fileUri: string, options?: object) => Promise<void>>(shareMod.shareAsync);
    if (isAvailableAsync && shareAsync && (await isAvailableAsync())) {
      await shareAsync(uri, {
        mimeType,
        UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.html',
        dialogTitle: fileName,
      });
      return true;
    }
  } catch {
    // Fall through to the system share sheet.
  }
  return false;
}

function buildReceiptShareText(model: OrderReceiptModel) {
  const lines = [
    'HAUL',
    model.title,
    model.recipientName,
    model.recipientPhone,
    ...model.rows.map((row) => `${row.label}: ${row.value}`),
  ];
  if (model.paymentLabel) {
    lines.push(`${RECEIPT_LABELS.sw.payment}: ${model.paymentLabel}`);
  }
  lines.push(model.trackingCode);
  return lines.filter(Boolean).join('\n');
}

export async function downloadOrderReceiptPdf(params: {
  order: DeliveryOrder;
  language: ReceiptLanguage;
  originCity?: string;
}) {
  const model = buildOrderReceiptModel(params.order, params.language, params.originCity);
  const html = buildReceiptHtml(model);
  const fileName = `HAUL-${sanitizeFileSegment(model.trackingCode || 'risiti')}.pdf`;

  try {
    let shareUri = await tryPrintHtmlToPdf(html);
    let mimeType = 'application/pdf';

    if (shareUri) {
      try {
        const fsMod = unwrapModule(await import('expo-file-system/legacy'));
        const copyAsync = pickFn<(options: { from: string; to: string }) => Promise<void>>(fsMod.copyAsync);
        const cacheDirectory = typeof fsMod.cacheDirectory === 'string' ? fsMod.cacheDirectory : '';
        if (copyAsync && cacheDirectory) {
          const targetUri = `${cacheDirectory}${fileName}`;
          await copyAsync({ from: shareUri, to: targetUri });
          shareUri = targetUri;
        }
      } catch {
        // Keep the original printed URI.
      }
    } else {
      shareUri = await writeReceiptHtmlFile(html, fileName);
      mimeType = 'text/html';
    }

    if (shareUri) {
      if (await shareReceiptFile(shareUri, fileName, mimeType)) {
        return shareUri;
      }
      await Share.share({
        title: `HAUL ${model.trackingCode}`,
        url: shareUri,
        message: `HAUL ${model.title} ${model.trackingCode}`,
      });
      return shareUri;
    }

    await Share.share({
      title: `HAUL ${model.trackingCode}`,
      message: buildReceiptShareText(model),
    });
    return null;
  } catch (error) {
    try {
      await Share.share({
        title: `HAUL ${model.trackingCode}`,
        message: buildReceiptShareText(model),
      });
      return null;
    } catch {
      const message = error instanceof Error ? error.message : 'Imeshindikana kuandaa PDF.';
      Alert.alert('HAUL', message);
      throw error;
    }
  }
}

export async function callReceiptPhone(phone: string) {
  const dialable = getDialablePhoneNumber(phone);
  if (!dialable) {
    return;
  }
  await Linking.openURL(`tel:${dialable}`);
}

/** @deprecated Use downloadOrderReceiptPdf — kept for older ticket callers. */
export async function downloadOutsideParcelTicket(params: {
  parcelCode: string;
  qrPayloadUrl: string;
  qrSize?: number;
}) {
  await Share.share({
    title: `HAUL ${params.parcelCode}`,
    message: `HAUL ${params.parcelCode}\n${params.qrPayloadUrl}`,
    url: params.qrPayloadUrl,
  });
}

/** @deprecated Use downloadOrderReceiptPdf — kept for older ticket callers. */
export async function shareOutsideParcelTicket(params: {
  parcelCode: string;
  qrPayloadUrl: string;
  message: string;
  qrSize?: number;
}) {
  await Share.share({
    title: `HAUL ${params.parcelCode}`,
    message: params.message,
    url: params.qrPayloadUrl,
  });
}
