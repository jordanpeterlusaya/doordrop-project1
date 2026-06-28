/* global __dirname */

const fs = require('fs');
const path = require('path');

const ENV_FILE_PATH = path.join(__dirname, '.env');
const ROOT_ENV_FILE_PATH = path.join(__dirname, '..', '.env');

function loadEnvFile(filePath) {
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

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowedOrigins(value) {
  if (!value || value.trim() === '*') {
    return ['*'];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJsonEnv(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  const text = String(filePath || '').trim();
  if (!text) {
    return null;
  }

  const resolvedPath = path.isAbsolute(text) ? text : path.join(__dirname, text);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizePrivateKey(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return text.replace(/\\n/g, '\n');
}

function readServiceAccountFromEnv() {
  const projectId = String(process.env.DOORDROP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!clientEmail && !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

loadEnvFile(ENV_FILE_PATH);
loadEnvFile(ROOT_ENV_FILE_PATH);

const sharedGoogleServerApiKey =
  process.env.GOOGLE_SERVER_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const pikipikiParcelPricing = {
  baseFare: 1200,
  pricePerKm: 450,
  extraDistanceRatePerKm: 650,
  timeBufferPerKm: 0,
  minimumFare: 1200,
};

const config = {
  port: parseNumber(process.env.PORT || process.env.BACKEND_PORT, 4000),
  firebaseProjectId: String(process.env.DOORDROP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim(),
  firebaseServiceAccount:
    readJsonEnv(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    readJsonFile(process.env.DOORDROP_FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_PATH) ||
    readServiceAccountFromEnv(),
  googleApplicationCredentials: String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim(),
  isManagedGoogleRuntime: Boolean(process.env.FUNCTION_TARGET || process.env.K_SERVICE || process.env.FIREBASE_CONFIG),
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || sharedGoogleServerApiKey,
  googleRoutesApiKey: process.env.GOOGLE_ROUTES_API_KEY || sharedGoogleServerApiKey,
  debugWebhookUrl: String(process.env.DEBUG_WEBHOOK_URL || '').trim(),
  allowedOrigins: parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  pricing: {
    bodaboda: { ...pikipikiParcelPricing },
    pikipiki: { ...pikipikiParcelPricing },
    boda: { ...pikipikiParcelPricing },
    toyo: {
      baseFare: 5000,
      pricePerKm: 1800,
      timeBufferPerKm: 0,
      minimumFare: 5000,
      sizeExtraRatePerKm: {
        small: 0,
        half: 600,
        full: 1200,
        overload: 2400,
      },
    },
    kirikuu: {
      baseFare: 5200,
      pricePerKm: 2200,
      timeBufferPerKm: 0,
      minimumFare: 8000,
      sizeExtraRatePerKm: {
        small: 0,
        half: 800,
        full: 1600,
        overload: 3000,
      },
    },
  },
};

function assertGoogleApiConfig() {
  if (!config.googlePlacesApiKey) {
    throw new Error(
      'Missing a Google backend key. Set GOOGLE_SERVER_API_KEY, or GOOGLE_PLACES_API_KEY and GOOGLE_ROUTES_API_KEY, in backend/.env or root .env.'
    );
  }

  if (!config.googleRoutesApiKey) {
    throw new Error(
      'Missing a Google backend key. Set GOOGLE_SERVER_API_KEY, or GOOGLE_PLACES_API_KEY and GOOGLE_ROUTES_API_KEY, in backend/.env or root .env.'
    );
  }
}

function assertFirebaseAdminConfig() {
  if (!config.firebaseProjectId && !config.firebaseServiceAccount?.project_id) {
    throw new Error(
      'Missing Firebase project ID. Set DOORDROP_FIREBASE_PROJECT_ID, FIREBASE_PROJECT_ID, GOOGLE_CLOUD_PROJECT, or GCLOUD_PROJECT.'
    );
  }

  const hasFirebaseCredentials =
    Boolean(config.firebaseServiceAccount?.client_email && config.firebaseServiceAccount?.private_key) ||
    Boolean(config.googleApplicationCredentials) ||
    config.isManagedGoogleRuntime;

  if (!hasFirebaseCredentials) {
    throw new Error(
      'Missing Firebase Admin credentials. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or set GOOGLE_APPLICATION_CREDENTIALS / DOORDROP_FIREBASE_SERVICE_ACCOUNT_PATH to a service account JSON file.'
    );
  }
}

function assertBackendConfig() {
  assertFirebaseAdminConfig();
  assertGoogleApiConfig();
}

module.exports = {
  assertFirebaseAdminConfig,
  assertGoogleApiConfig,
  config,
  assertBackendConfig,
};
