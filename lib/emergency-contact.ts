import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';

export type EmergencyContact = {
  name: string;
  phone: string;
};

function storageKey(uid?: string | null) {
  return `doordrop:emergency-contact:${uid?.trim() || 'local'}`;
}

export function toTelHref(phone: string) {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return `tel:${trimmed.replace(/[^\d+]/g, '')}`;
  }

  return `tel:${trimmed.replace(/\D/g, '')}`;
}

export async function getEmergencyContact(uid?: string | null): Promise<EmergencyContact | null> {
  try {
    const raw = await getPersistedItem(storageKey(uid));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<EmergencyContact>;
    const name = String(parsed.name || '').trim();
    const phone = String(parsed.phone || '').trim();
    if (!name || !phone) {
      return null;
    }

    return { name, phone };
  } catch {
    return null;
  }
}

export async function saveEmergencyContact(uid: string | null | undefined, contact: EmergencyContact) {
  await setPersistedItem(storageKey(uid), JSON.stringify(contact));
}

export async function clearEmergencyContact(uid?: string | null) {
  await setPersistedItem(storageKey(uid), '');
}
