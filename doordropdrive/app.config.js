const fs = require('fs');
const path = require('path');

const base = require('./app.json');

const DEFAULT_API_BASE_URL = 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api';

function loadEnvFile(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
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

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
const cargoOfferWsUrl = (process.env.EXPO_PUBLIC_CARGO_OFFER_WS_URL || '').trim().replace(/\/+$/, '');
const parcelOfferWsUrl = (process.env.EXPO_PUBLIC_PARCEL_OFFER_WS_URL || '').trim().replace(/\/+$/, '');
const easBuildProfile = process.env.EAS_BUILD_PROFILE || '';
const allowLanStandalone =
  process.env.DOORDROP_ALLOW_LAN_STANDALONE === '1' || easBuildProfile === 'standalone-lan';
const forceStandalone =
  process.env.DOORDROP_STANDALONE === '1' ||
  ['preview', 'production', 'standalone', 'standalone-lan'].includes(easBuildProfile);
const isStoreReleaseProfile = ['preview', 'production', 'standalone', 'standalone-lan'].includes(
  easBuildProfile
);
const needsCleartextTraffic =
  apiBaseUrl.startsWith('http://') ||
  cargoOfferWsUrl.startsWith('ws://') ||
  parcelOfferWsUrl.startsWith('ws://');
const androidUsesCleartextTraffic =
  !isStoreReleaseProfile || allowLanStandalone || needsCleartextTraffic;
// Stash for withStandaloneRelease (schema rejects android.usesCleartextTraffic in some validators).
process.env.DOORDROP_ANDROID_CLEARTEXT = androidUsesCleartextTraffic ? '1' : '0';

const isAndroidBuildContext =
  process.env.EAS_BUILD_PLATFORM === 'android' ||
  process.argv.some((value) => /android|prebuild|run:android|assembleRelease/i.test(value));

if (!googleMapsApiKey) {
  console.warn('[DoorDrive][Config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing. Android builds cannot render Google Maps.');

  if (isAndroidBuildContext && isStoreReleaseProfile) {
    throw new Error(
      'DoorDrive Android build aborted: missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to ../.env.local, doordropdrive/.env, your shell env, or EAS secrets before building.'
    );
  }
}

if (
  isAndroidBuildContext &&
  forceStandalone &&
  !allowLanStandalone &&
  (apiBaseUrl.startsWith('http://') || /localhost|127\.0\.0\.1|192\.168\.|10\./.test(apiBaseUrl))
) {
  throw new Error(
    'DoorDrive standalone build aborted: LAN/http API requires DOORDROP_ALLOW_LAN_STANDALONE=1 (or profile standalone-lan) so WebSockets/cleartext work.'
  );
}

const expo = base.expo;
const baseAndroid = expo.android || {};
const baseAndroidConfig = baseAndroid.config || {};
const basePlugins = (expo.plugins || []).filter((plugin) => {
  const name = Array.isArray(plugin) ? plugin[0] : plugin;
  if (forceStandalone && name === 'expo-dev-client') return false;
  return true;
});

const androidPermissions = [
  ...new Set([
    ...(baseAndroid.permissions || []),
    'CAMERA',
    'READ_MEDIA_IMAGES',
    'READ_MEDIA_VISUAL_USER_SELECTED',
  ]),
].filter((permission) => permission !== 'WRITE_EXTERNAL_STORAGE');

module.exports = {
  expo: {
    ...expo,
    jsEngine: 'hermes',
    assetBundlePatterns: ['assets/**/*'],
    android: {
      ...baseAndroid,
      config: {
        ...baseAndroidConfig,
        googleMaps: {
          ...(baseAndroidConfig.googleMaps || {}),
          apiKey: googleMapsApiKey,
        },
      },
      permissions: androidPermissions,
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.WRITE_CONTACTS',
        'android.permission.READ_CONTACTS',
      ],
    },
    plugins: [
      ...basePlugins.map((plugin) => {
        if (Array.isArray(plugin) && plugin[0] === 'expo-image-picker') {
          return [
            'expo-image-picker',
            {
              ...(plugin[1] || {}),
              microphonePermission: false,
            },
          ];
        }
        return plugin;
      }),
      'expo-font',
      './plugins/withStandaloneRelease.js',
    ],
    extra: {
      ...(expo.extra || {}),
      googleMapsApiKey,
      hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
      apiBaseUrl,
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
      EXPO_PUBLIC_CARGO_OFFER_WS_URL: cargoOfferWsUrl,
      EXPO_PUBLIC_PARCEL_OFFER_WS_URL: parcelOfferWsUrl,
      cargoOfferWsUrl,
      parcelOfferWsUrl,
    },
  },
};
