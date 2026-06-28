export function tryOrDefault<T>(fn: () => Promise<T> | T, defaultValue: T, contextMessage?: string): Promise<T> {
  try {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<T>).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(contextMessage ?? 'safe call failed', err);
        return defaultValue;
      });
    }

    return Promise.resolve(result as T);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(contextMessage ?? 'safe call failed', err);
    return Promise.resolve(defaultValue);
  }
}

export function safeNumber(value: unknown, fallback = 0) {
  const n = Number(value as any);
  return Number.isFinite(n) ? n : fallback;
}

export function safeRoutePoint(point: any) {
  if (!point || typeof point !== 'object') return null;
  const lat = safeNumber(point.latitude, NaN);
  const lng = safeNumber(point.longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * tryRequire - SAFE, bundler-friendly guarded require
 *
 * Metro (and other bundlers) statically analyze calls to `require()` and reject
 * non-literal argument forms like `require(modulePath)`. That causes bundling
 * failures (SyntaxError: Invalid call) when the bundler cannot determine the
 * module at build time.
 *
 * To be bundler-safe we avoid dynamic requires entirely and expose a small
 * whitelist mapping of allowed native modules. Add entries here for modules
 * you expect to guard at runtime (e.g. 'react-native-maps'). This keeps
 * requires literal so Metro can include or ignore them during build.
 */
export function tryRequire<T = any>(modulePath: string): T | null {
  try {
    switch (modulePath) {
      case 'react-native-maps': {
        // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
        const mod = require('react-native-maps') as T;
        return mod;
      }
      case 'expo-location': {
        // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
        const mod = require('expo-location') as T;
        return mod;
      }
      // Add other known modules here when needed, using literal requires.
      default:
        return null;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`tryRequire: failed to require ${modulePath}`, err);
    return null;
  }
}

export function safeAsync<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
    try {
      // @ts-ignore
      return await fn(...args);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('safeAsync: caught error', err);
      return null;
    }
  };
}
