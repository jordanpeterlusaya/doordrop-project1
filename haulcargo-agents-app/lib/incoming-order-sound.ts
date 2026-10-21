import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

// Short desk chime — not incoming_order_alarm.wav.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const INCOMING_ORDER_CHIME_ASSET = require('@/assets/sounds/incoming_order_chime.wav');

const CHIME_FILE = 'incoming_order_chime.wav';
const MAX_CHIME_DURATION_MS = 18_000;
const VIBRATION_REPEAT_INTERVAL_MS = 1_600;
const OFFER_VIBRATION_PATTERN = [0, 180, 90, 180];

let sharedPlayer: AudioPlayer | null = null;
let resolvedLocalUri: string | null = null;
let audioModeConfigured = false;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let vibrationInterval: ReturnType<typeof setInterval> | null = null;
let activeOrderId: string | null = null;
let isAlarmRinging = false;
const listeners = new Set<(ringing: boolean, orderId: string | null) => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener(isAlarmRinging, activeOrderId);
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeIncomingOrderAlarm(
  listener: (ringing: boolean, orderId: string | null) => void
) {
  listeners.add(listener);
  listener(isAlarmRinging, activeOrderId);
  return () => {
    listeners.delete(listener);
  };
}

export function isIncomingOrderAlarmRinging() {
  return isAlarmRinging;
}

async function ensureAudioReady(): Promise<string | number> {
  if (!audioModeConfigured && Platform.OS !== 'web') {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });
      audioModeConfigured = true;
    } catch (error) {
      console.warn(
        '[HAUL_AGENTS_SOUND] setAudioModeAsync failed',
        error instanceof Error ? error.message : 'error'
      );
    }
  }

  if (resolvedLocalUri) {
    return resolvedLocalUri;
  }

  try {
    const asset = Asset.fromModule(INCOMING_ORDER_CHIME_ASSET);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    resolvedLocalUri = asset.localUri || asset.uri || null;
    if (resolvedLocalUri) return resolvedLocalUri;
  } catch (error) {
    console.warn(
      '[HAUL_AGENTS_SOUND] asset preload fallback',
      error instanceof Error ? error.message : 'error'
    );
  }

  return INCOMING_ORDER_CHIME_ASSET;
}

/** Preload the incoming-order chime on app startup. */
export async function preloadIncomingOrderAlarm(): Promise<void> {
  try {
    await ensureAudioReady();
  } catch {
    // ignore preload errors
  }
}

function clearTimers() {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
}

/**
 * Plays the incoming-order chime (`incoming_order_chime.wav`) with vibration
 * until Kubali, Kataa, dismiss, or the short repeat window ends.
 */
export async function startIncomingOrderAlarm(
  orderId?: string,
  opts?: { loop?: boolean; durationMs?: number }
): Promise<boolean> {
  const loop = opts?.loop ?? true;
  const durationMs = opts?.durationMs ?? MAX_CHIME_DURATION_MS;

  clearTimers();
  activeOrderId = orderId || activeOrderId || 'incoming-offer';
  isAlarmRinging = true;
  notifyListeners();

  try {
    const source = await ensureAudioReady();
    const playerSource = typeof source === 'string' ? { uri: source } : source;

    if (!sharedPlayer) {
      sharedPlayer = createAudioPlayer(playerSource, {
        updateInterval: 500,
        keepAudioSessionActive: true,
      });
    } else {
      try {
        sharedPlayer.replace(playerSource);
      } catch {
        // If replace fails on an existing instance, recreate player
        try {
          sharedPlayer.remove();
        } catch {
          // ignore
        }
        sharedPlayer = createAudioPlayer(playerSource, {
          updateInterval: 500,
          keepAudioSessionActive: true,
        });
      }
    }

    sharedPlayer.loop = loop;
    sharedPlayer.volume = 1.0;
    sharedPlayer.muted = false;
    await sharedPlayer.seekTo(0).catch(() => undefined);
    sharedPlayer.play();
    try {
      Vibration.vibrate(OFFER_VIBRATION_PATTERN);
    } catch {
      // ignore
    }

    if (loop) {
      vibrationInterval = setInterval(() => {
        try {
          Vibration.vibrate(OFFER_VIBRATION_PATTERN);
        } catch {
          // ignore
        }
      }, VIBRATION_REPEAT_INTERVAL_MS);

      stopTimer = setTimeout(() => {
        stopIncomingOrderAlarm('timeout');
      }, durationMs);
    } else {
      stopTimer = setTimeout(() => {
        stopIncomingOrderAlarm('single-shot-complete');
      }, 5_000);
    }

    console.info('[HAUL_AGENTS_SOUND_START]', {
      orderId: activeOrderId,
      sound: CHIME_FILE,
      loop,
      source: typeof source === 'string' ? source : 'asset-module',
      at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    isAlarmRinging = false;
    notifyListeners();
    console.warn(
      '[HAUL_AGENTS_SOUND_ERROR]',
      error instanceof Error ? error.message : 'error'
    );
    return false;
  }
}

/** Stops the custom incoming order alarm sound and vibration immediately. */
export function stopIncomingOrderAlarm(reason = 'user-action'): void {
  const wasRinging = isAlarmRinging;
  clearTimers();
  isAlarmRinging = false;
  const previousOrderId = activeOrderId;
  activeOrderId = null;
  notifyListeners();

  try {
    Vibration.cancel();
  } catch {
    // ignore
  }

  if (sharedPlayer) {
    try {
      sharedPlayer.loop = false;
      sharedPlayer.pause();
      void sharedPlayer.seekTo(0).catch(() => undefined);
    } catch {
      // ignore player stop errors
    }
  }

  if (wasRinging) {
    console.info('[HAUL_AGENTS_SOUND_STOP]', {
      orderId: previousOrderId,
      reason,
      at: new Date().toISOString(),
    });
  }
}
