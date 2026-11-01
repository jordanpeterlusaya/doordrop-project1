import AsyncStorage from '@react-native-async-storage/async-storage';

export type DriverLang = 'en' | 'sw';

export type DriverSettings = {
  language: DriverLang;
  autoConfirm: boolean;
  /** True only after the driver explicitly picks a language in the app. */
  languageChosen?: boolean;
};

const SETTINGS_KEY = 'doordrive.settings.v1';

export const defaultDriverSettings: DriverSettings = {
  language: 'sw',
  autoConfirm: false,
  languageChosen: false,
};

function normalizeSettings(parsed: Partial<DriverSettings>): DriverSettings {
  const languageChosen = parsed.languageChosen === true;
  const language: DriverLang =
    languageChosen && parsed.language === 'en'
      ? 'en'
      : 'sw';

  return {
    language,
    autoConfirm: Boolean(parsed.autoConfirm),
    languageChosen,
  };
}

export async function loadDriverSettings(): Promise<DriverSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultDriverSettings;
    }

    const parsed = JSON.parse(raw) as Partial<DriverSettings>;
    return normalizeSettings(parsed);
  } catch {
    return defaultDriverSettings;
  }
}

export async function saveDriverSettings(settings: DriverSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function withChosenLanguage(settings: DriverSettings, language: DriverLang): DriverSettings {
  return {
    ...settings,
    language,
    languageChosen: true,
  };
}
