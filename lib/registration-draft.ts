import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'doordrop.customer.registrationDraft';

export type RegistrationDraft = {
  fullName: string;
  phoneNumber: string;
  email: string;
  password: string;
  returnTo?: string;
};

let memoryDraft: RegistrationDraft | null = null;

export async function saveRegistrationDraft(next: RegistrationDraft) {
  memoryDraft = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Memory draft still available for this session.
  }
}

export async function getRegistrationDraft(): Promise<RegistrationDraft | null> {
  if (memoryDraft) {
    return memoryDraft;
  }

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegistrationDraft;
    if (
      !parsed ||
      typeof parsed.fullName !== 'string' ||
      typeof parsed.phoneNumber !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.password !== 'string'
    ) {
      return null;
    }
    memoryDraft = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearRegistrationDraft() {
  memoryDraft = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
