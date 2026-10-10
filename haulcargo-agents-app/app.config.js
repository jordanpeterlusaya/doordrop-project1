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
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#14532d',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.haulcargo.agents',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#14532d',
      },
      package: 'com.haulcargo.agents',
      config: googleMapsApiKey ? { googleMaps: { apiKey: googleMapsApiKey } } : undefined,
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: ['expo-router', 'expo-font'],
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
    },
  },
};
