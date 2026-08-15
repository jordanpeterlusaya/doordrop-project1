/* global __dirname */

const fs = require('fs');
const path = require('path');

const base = require('./app.json');

function loadEnvFile(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('../.env.local');
loadEnvFile('../.env');
loadEnvFile('.env.local');
loadEnvFile('.env');

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_SDK_KEY ||
  process.env.GOOGLE_MAPS_ANDROID_SDK_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
  '';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || '';

const isAndroidBuildContext =
  process.env.EAS_BUILD_PLATFORM === 'android' ||
  process.argv.some((value) => /android|prebuild|run:android/i.test(value));

if (!googleMapsApiKey) {
  console.warn('[DoorDrive][Config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing. Android APKs cannot safely render Google Maps.');

  if (isAndroidBuildContext) {
    throw new Error(
      'DoorDrive Android build aborted: missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to ../.env, doordropdrive/.env, your shell env, or EAS env/secrets before building.'
    );
  }
}

const expo = base.expo;
const baseAndroid = expo.android || {};
const baseAndroidConfig = baseAndroid.config || {};
const basePlugins = expo.plugins || [];
const androidPermissions = new Set([
  ...(baseAndroid.permissions || []),
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'VIBRATE',
]);

module.exports = {
  expo: {
    ...expo,
    assetBundlePatterns: ['./assets/images/icon2.png'],
    android: {
      ...baseAndroid,
      config: {
        ...baseAndroidConfig,
        googleMaps: {
          ...(baseAndroidConfig.googleMaps || {}),
          apiKey: googleMapsApiKey,
        },
      },
      permissions: [...androidPermissions],
    },
    plugins: [
      ...basePlugins,
      'expo-font',
      [
        'expo-location',
        {
          locationWhenInUsePermission: 'Allow DoorDrive to use your location for live dispatch tracking.',
        },
      ],
    ],
    extra: {
      ...(expo.extra || {}),
      googleMapsApiKey,
      hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
      apiBaseUrl,
    },
  },
};
