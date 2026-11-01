import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export async function driveHapticLight() {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Ignore missing haptics hardware.
  }
}

export async function driveHapticMedium() {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // Ignore missing haptics hardware.
  }
}

export async function driveHapticSuccess() {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Ignore missing haptics hardware.
  }
}

export async function driveHapticSelection() {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    await Haptics.selectionAsync();
  } catch {
    // Ignore missing haptics hardware.
  }
}
