import AsyncStorage from '@react-native-async-storage/async-storage';

const INTRO_KEY = '@haul-pilots/intro_v1';

export async function hasSeenPilotIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTRO_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markPilotIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_KEY, '1');
  } catch {
    // Landing can still finish if storage fails.
  }
}
