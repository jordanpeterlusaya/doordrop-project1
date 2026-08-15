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

const androidPackage = 'com.doordrop.app';
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
const easOwner = process.env.DOORDROP_EAS_OWNER || 'jordanpeter';
const easProjectId = (process.env.DOORDROP_EAS_PROJECT_ID || '9f130ec2-8b0c-404e-81c5-fd11f44a769f').trim();

const isAndroidBuildContext =
  process.env.EAS_BUILD_PLATFORM === 'android' ||
  process.argv.some((value) => /android|prebuild|run:android/i.test(value));
const requiresPublicApiBaseUrl =
  isAndroidBuildContext && (easBuildProfile === 'preview' || easBuildProfile === 'production');
const androidUsesCleartextTraffic = !requiresPublicApiBaseUrl;

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
    name: 'DoorDrop',
    slug: 'DoorDrop',
    scheme: 'doordrop',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/images/doordrop.png',
    splash: {
      image: './assets/images/doordrop.png',
      resizeMode: 'contain',
      backgroundColor: '#16A34A',
    },
    assetBundlePatterns: ['**/*'],
    android: {
      package: androidPackage,
      ...(androidGoogleServicesConfig.configured
        ? {
            googleServicesFile: androidGoogleServicesConfig.file,
          }
        : {}),
      versionCode: 1,
      usesCleartextTraffic: androidUsesCleartextTraffic,
      adaptiveIcon: {
        foregroundImage: './assets/images/doordrop.png',
        backgroundColor: '#ffffff',
      },
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS'],
    },
    ios: {
      bundleIdentifier: androidPackage,
      supportsTablet: true,
    },
    plugins: [
      [
        'expo-notifications',
        {
          icon: './assets/images/doordrop-adaptive-monochrome.png',
          color: '#12B981',
          defaultChannel: 'default',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Allow DoorDrop to use your location',
        },
      ],
      [
        './plugins/with-doordrop-android-maps',
        {
          apiKey: googleMapsApiKey,
        },
      ],
    ],
    extra: {
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
      androidPackage,
      apiBaseUrl: doordropApiBaseUrl,
      hasApiBaseUrl: Boolean(doordropApiBaseUrl),
      googleMapsApiKey,
      hasGoogleMapsApiKey: Boolean(googleMapsApiKey),
      pushNotifications: {
        androidNativeFcmConfigured: androidGoogleServicesConfig.configured,
        androidPackage,
        androidGoogleServicesPackage: androidGoogleServicesConfig.packageName || null,
      },
    },
  },
};
