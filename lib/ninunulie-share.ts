import { Linking, Platform } from 'react-native';

export type NinunulieSourceMode = 'seller_contact' | 'haul_source';

export type NinunulieShareDraft = {
  text: string;
  url: string;
  imageUris: string[];
  itemHint: string;
};

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const SOCIAL_HOST_RE = /(instagram\.com|tiktok\.com|facebook\.com|fb\.watch|wa\.me|whatsapp\.com|youtube\.com|youtu\.be)/i;

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    return firstString(value[0]);
  }
  return String(value || '').trim();
}

export function extractUrlFromText(text: string) {
  const match = String(text || '').match(URL_RE);
  return match?.[0]?.trim() || '';
}

export function asLocalImageUri(path: string) {
  const value = String(path || '').trim();
  if (!value) return '';
  if (
    value.startsWith('file://') ||
    value.startsWith('content://') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('ph://') ||
    value.startsWith('assets-library://')
  ) {
    return value;
  }
  if (value.startsWith('/')) {
    return `file://${value}`;
  }
  return value;
}

function itemHintFromText(text: string, url: string) {
  const cleaned = String(text || '')
    .replace(url, '')
    .replace(URL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 80) {
    return cleaned;
  }
  return '';
}

export function parseNinunulieShareParams(params: Record<string, unknown>): NinunulieShareDraft | null {
  const sharedFlag = firstString(params.shared);
  const sharedText = firstString(params.sharedText || params.text || params.itemTitle);
  const productUrl = firstString(params.productUrl || params.sharedUrl);
  const imageKeys = ['sharedImage', 'sharedImage1', 'sharedImage2', 'sharedImage3'];
  const imageUris = imageKeys
    .map((key) => asLocalImageUri(firstString(params[key])))
    .filter(Boolean);

  const url = productUrl || extractUrlFromText(sharedText);
  const text = sharedText;
  const itemHint = firstString(params.itemHint) || itemHintFromText(text, url);

  if (!sharedFlag && !text && !url && !imageUris.length) {
    return null;
  }

  return {
    text,
    url,
    imageUris,
    itemHint,
  };
}

export function parseNinunulieShareUrl(rawUrl: string): NinunulieShareDraft | null {
  const href = String(rawUrl || '').trim();
  if (!href) return null;

  try {
    const parsed = new URL(href);
    const host = `${parsed.host}${parsed.pathname}`.replace(/^\/*/, '');
    const isNinunulie =
      parsed.protocol === 'doordrop:' ||
      parsed.protocol === 'exp+doordrop:' ||
      host.startsWith('ninunulie');
    if (!isNinunulie && !parsed.searchParams.get('shared')) {
      return null;
    }
    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return parseNinunulieShareParams(params);
  } catch {
    return null;
  }
}

export function shareDraftKey(draft: NinunulieShareDraft) {
  return [draft.url, draft.text, draft.imageUris.join('|')].join('::');
}

export function looksLikeSocialProductLink(url: string) {
  return SOCIAL_HOST_RE.test(String(url || ''));
}

async function tryOpenUrl(url: string) {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      return false;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function openInstagramForScreenshot() {
  for (const url of ['instagram://app', 'https://www.instagram.com/']) {
    if (await tryOpenUrl(url)) {
      return true;
    }
  }
  return false;
}

export async function openWhatsAppForScreenshot() {
  for (const url of ['whatsapp://app', 'https://wa.me/']) {
    if (await tryOpenUrl(url)) {
      return true;
    }
  }
  return false;
}

export async function readInitialNinunulieShare() {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const initial = await Linking.getInitialURL();
    return initial ? parseNinunulieShareUrl(initial) : null;
  } catch {
    return null;
  }
}

export function subscribeNinunulieShare(onDraft: (draft: NinunulieShareDraft) => void) {
  const seen = new Set<string>();

  const deliver = (draft: NinunulieShareDraft | null) => {
    if (!draft) return;
    const key = shareDraftKey(draft);
    if (!key.replace(/:/g, '') || seen.has(key)) return;
    seen.add(key);
    onDraft(draft);
  };

  void readInitialNinunulieShare().then(deliver);

  const sub = Linking.addEventListener('url', (event) => {
    deliver(parseNinunulieShareUrl(event.url));
  });

  return () => {
    sub.remove();
  };
}
