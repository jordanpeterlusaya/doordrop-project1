import AsyncStorage from '@react-native-async-storage/async-storage';

export type DriverLang = 'en' | 'sw';

export type DriverSettings = {
  language: DriverLang;
  autoConfirm: boolean;
};

const SETTINGS_KEY = 'doordrive.settings.v1';

export const defaultDriverSettings: DriverSettings = {
  language: 'en',
  autoConfirm: false,
};

export async function loadDriverSettings(): Promise<DriverSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultDriverSettings;
    }
    const parsed = JSON.parse(raw) as Partial<DriverSettings>;
    return {
      language: parsed.language === 'sw' ? 'sw' : 'en',
      autoConfirm: Boolean(parsed.autoConfirm),
    };
  } catch {
    return defaultDriverSettings;
  }
}

export async function saveDriverSettings(settings: DriverSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
