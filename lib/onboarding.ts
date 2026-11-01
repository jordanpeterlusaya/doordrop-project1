import AsyncStorage from '@react-native-async-storage/async-storage';

/** Bumped so the letter intro is not skipped after prior sessions. */
export const ONBOARDING_STORAGE_KEY = '@haul/onboarding_complete_v9';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
    return value === '1';
  } catch {
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch {
    // Ignore storage failures so onboarding can still finish.
  }
}

export async function resetOnboardingProgress(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      ONBOARDING_STORAGE_KEY,
      '@haul/onboarding_complete',
      '@haul/onboarding_complete_v2',
      '@haul/onboarding_complete_v3',
      '@haul/onboarding_complete_v4',
      '@haul/onboarding_complete_v5',
      '@haul/onboarding_complete_v6',
      '@haul/onboarding_complete_v7',
      '@haul/onboarding_complete_v8',
    ]);
  } catch {
    // Ignore.
  }
}
