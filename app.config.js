/* global __dirname */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filename) {
  const filePath = path.join(__dirname, filename);
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

loadEnvFile('.env.local');
loadEnvFile('.env');

const androidPackage = 'com.doordrop.mobile';
const androidGoogleServicesFile = './google-services.json';
const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_SDK_KEY ||
  process.env.GOOGLE_MAPS_ANDROID_SDK_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
  '';

const doordropApiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
const easBuildProfile = process.env.EAS_BUILD_PROFILE || '';
const easOwner = process.env.DOORDROP_EAS_OWNER || 'lusayaapeters-team';
const easProjectId = (
  process.env.DOORDROP_EAS_PROJECT_ID || '7e8f96f2-2fb2-4775-b540-815429462767'
).trim();

const isAndroidBuildContext =
  process.env.EAS_BUILD_PLATFORM === 'android' ||
  process.argv.some((value) => /android|prebuild|run:android/i.test(value));
const isStoreReleaseProfile = ['preview', 'production', 'standalone'].includes(easBuildProfile);
const requiresPublicApiBaseUrl = isAndroidBuildContext && isStoreReleaseProfile;
const androidUsesCleartextTraffic = !isStoreReleaseProfile;
const includeDevClient = !isStoreReleaseProfile;

function warnConfig(message, details) {
  if (details === undefined) {
    console.warn(`[DoorDrop][Config] ${message}`);
    return;
  }

  console.warn(`[DoorDrop][Config] ${message}`, details);
}

function getAndroidGoogleServicesConfig() {
  const filePath = path.join(__dirname, androidGoogleServicesFile);

  if (!fs.existsSync(filePath)) {
    return {
      configured: false,
      file: androidGoogleServicesFile,
      packageName: '',
      reason: 'missing',
    };
  }

  try {
    const rawConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const clients = Array.isArray(rawConfig.client) ? rawConfig.client : [];
    const packageNames = clients
      .map((client) => client?.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    const matchingPackageName = packageNames.find((packageName) => packageName === androidPackage) || '';

    return {
      configured: Boolean(matchingPackageName),
      file: androidGoogleServicesFile,
      packageName: matchingPackageName || packageNames[0] || '',
      reason: matchingPackageName ? 'matched' : 'package-mismatch',
    };
  } catch (error) {
    return {
      configured: false,
      file: androidGoogleServicesFile,
      packageName: '',
      reason: 'invalid-json',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isPrivateOrLocalHostname(hostname) {
  const normalizedHostname = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');

  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '10.0.2.2' ||
    normalizedHostname.endsWith('.local')
  ) {
    return true;
  }

  const ipv4Match = normalizedHostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) {
    return false;
  }

  const firstOctet = Number(ipv4Match[1]);
  const secondOctet = Number(ipv4Match[2]);

  return (
    firstOctet === 10 ||
    firstOctet === 127 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168) ||
    (firstOctet === 169 && secondOctet === 254)
  );
}

function getApiBaseUrlIssue(apiBaseUrl) {
  if (!apiBaseUrl) {
    return {
      message:
        'EXPO_PUBLIC_API_BASE_URL is missing. The APK will build, but Places, Routes, pricing, and health checks will fail at runtime.',
      buildMessage:
        'missing EXPO_PUBLIC_API_BASE_URL. Deploy the backend to a public HTTPS URL, then set EXPO_PUBLIC_API_BASE_URL before building.',
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    return {
      message: 'EXPO_PUBLIC_API_BASE_URL is not a valid URL.',
      buildMessage: 'EXPO_PUBLIC_API_BASE_URL must be a valid HTTPS URL for preview/production APKs.',
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      message: 'EXPO_PUBLIC_API_BASE_URL must start with http:// or https://.',
      buildMessage: 'EXPO_PUBLIC_API_BASE_URL must be a valid HTTPS URL for preview/production APKs.',
    };
  }

  if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
    return {
      message:
        'EXPO_PUBLIC_API_BASE_URL points to a private/local network address. That only works on your own Wi-Fi, not for APKs shared to users.',
      buildMessage:
        'EXPO_PUBLIC_API_BASE_URL points to a private/local network address. Use a deployed public HTTPS backend URL.',
    };
  }

  if (requiresPublicApiBaseUrl && parsedUrl.protocol !== 'https:') {
    return {
      message: 'Preview/production Android builds must use an HTTPS backend URL.',
      buildMessage: 'preview/production APKs require EXPO_PUBLIC_API_BASE_URL to start with https://.',
    };
  }

  return null;
}

if (!googleMapsApiKey) {
  warnConfig('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing. Android APKs will not render real Google Maps.');

  if (isAndroidBuildContext) {
    throw new Error(
      'DoorDrop Android build aborted: missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to .env, your shell env, or EAS env/secrets before building.'
    );
  }
}

const apiBaseUrlIssue = getApiBaseUrlIssue(doordropApiBaseUrl);
const androidGoogleServicesConfig = getAndroidGoogleServicesConfig();

if (apiBaseUrlIssue) {
  warnConfig(apiBaseUrlIssue.message, { apiBaseUrl: doordropApiBaseUrl || 'missing' });

  if (requiresPublicApiBaseUrl) {
    throw new Error(`DoorDrop Android ${easBuildProfile} build aborted: ${apiBaseUrlIssue.buildMessage}`);
  }
}

if (!androidGoogleServicesConfig.configured) {
  warnConfig(
    'Android push notifications are not native FCM configured. Expo push token registration will be skipped until google-services.json matches the Android package.',
    {
      androidPackage,
      googleServicesPackage: androidGoogleServicesConfig.packageName || 'missing',
      reason: androidGoogleServicesConfig.reason,
      file: androidGoogleServicesConfig.file,
    }
  );
}

module.exports = {
  expo: {
    owner: easOwner,
    name: 'HAUL',
    slug: 'DoorDrop',
    scheme: 'doordrop',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/images/haul-icon.png',
    splash: {
      image: './assets/images/haul-splash-blank.png',
      resizeMode: 'cover',
      backgroundColor: '#FFE500',
    },
    assetBundlePatterns: ['**/*'],
    android: {
      package: androidPackage,
      ...(androidGoogleServicesConfig.configured
        ? {
            googleServicesFile: androidGoogleServicesConfig.file,
          }
        : {}),
      versionCode: 2,
      usesCleartextTraffic: androidUsesCleartextTraffic,
      adaptiveIcon: {
        foregroundImage: './assets/images/haul-adaptive-foreground.png',
        backgroundColor: '#FFE500',
      },
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
      softwareKeyboardLayoutMode: 'resize',
      intentFilters: [
        {
          action: 'SEND',
          category: ['DEFAULT'],
          data: [{ mimeType: 'image/*' }],
        },
        {
          action: 'SEND',
          category: ['DEFAULT'],
          data: [{ mimeType: 'text/plain' }],
        },
        {
          action: 'SEND',
          category: ['DEFAULT'],
          data: [{ mimeType: 'text/*' }],
        },
        {
          action: 'SEND_MULTIPLE',
          category: ['DEFAULT'],
          data: [{ mimeType: 'image/*' }],
        },
      ],
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'POST_NOTIFICATIONS',
        'CAMERA',
        'READ_CONTACTS',
      ],
      // Use Android Photo Picker (no broad gallery access) for Play photo/video policy.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.WRITE_CONTACTS',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.READ_EXTERNAL_STORAGE',
      ],
    },
    ios: {
      bundleIdentifier: androidPackage,
      supportsTablet: true,
      infoPlist: {
        NSPhotoLibraryUsageDescription:
          'DoorDrop inahitaji picha ili uambatanishe screenshot ya bidhaa.',
        NSPhotoLibraryAddUsageDescription:
          'DoorDrop inahitaji ruhusa ya picha kwa oda za Ninunulie.',
        NSCameraUsageDescription: 'DoorDrop inahitaji kamera ili upige picha ya bidhaa.',
        NSContactsUsageDescription:
          'DoorDrop inahitaji contacts ili uchague mpokeaji wa parcel kwa haraka.',
        NSLocationWhenInUseUsageDescription:
          'DoorDrop inahitaji location yako kuonyesha pickup na delivery.',
      },
    },
    plugins: [
      'expo-router',
      ...(includeDevClient ? ['expo-dev-client'] : []),
      [
        'expo-image-picker',
        {
          // iOS still needs a usage string; Android uses Photo Picker without READ_MEDIA_*.
          photosPermission: 'DoorDrop inahitaji picha ili uambatanishe screenshot ya bidhaa.',
          cameraPermission: 'DoorDrop inahitaji kamera ili upige picha ya bidhaa.',
          microphonePermission: false,
        },
      ],
      [
        'expo-contacts',
        {
          contactsPermission:
            'DoorDrop inahitaji contacts ili uchague mpokeaji wa parcel kwa haraka.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/haul-notification-icon.png',
          color: '#FFE500',
          defaultChannel: 'default',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Allow DoorDrop to use your location',
          locationWhenInUsePermission: 'Allow DoorDrop to use your location while using the app',
        },
      ],
      [
        './plugins/with-doordrop-android-maps',
        {
          apiKey: googleMapsApiKey,
        },
      ],
      './plugins/with-ninunulie-share-intent',
      './plugins/withStandaloneRelease',
    ],
    extra: {
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
      androidPackage,
      apiBaseUrl: doordropApiBaseUrl,
      hasApiBaseUrl: Boolean(doordropApiBaseUrl),
      googleMapsApiKey,
      hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'efootball-app-9d175.firebaseapp.com',
      firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'efootball-app-9d175',
      firebaseStorageBucket:
        process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'efootball-app-9d175.firebasestorage.app',
      firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '729242246964',
      firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:729242246964:web:bdb35a59a681a4a7420f61',
      firebaseMeasurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-G3XDE8M7L5',
      pushNotifications: {
        androidNativeFcmConfigured: androidGoogleServicesConfig.configured,
        androidPackage,
        androidGoogleServicesPackage: androidGoogleServicesConfig.packageName || null,
      },
    },
  },
};
