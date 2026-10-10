/* global __dirname */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_SDK_KEY ||
  '';

module.exports = {
  expo: {
    name: 'Haul Cargo Agents',
    slug: 'haulcargoagents',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'haulcargoagents',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/images/haul-splash-blank.png',
      resizeMode: 'contain',
      backgroundColor: '#FFE500',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.haulcargo.agents',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
        backgroundColor: '#FFE500',
      },
      package: 'com.haulcargo.agents',
      config: googleMapsApiKey ? { googleMaps: { apiKey: googleMapsApiKey } } : undefined,
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-sharing',
      'expo-splash-screen',
      'expo-status-bar',
      [
        'expo-notifications',
        {
          color: '#FFE500',
          defaultChannel: 'carrier_offers',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Ruhusu HAUL Agents kuchagua picha za hati za biashara.',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
      firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
      googleMapsApiKey,
      apiBaseUrl:
        process.env.EXPO_PUBLIC_API_BASE_URL ||
        'https://us-central1-efootball-app-9d175.cloudfunctions.net/api',
    },
  },
};
