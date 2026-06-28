const runtimeConfig = globalThis.DOORDROP_ADMIN_CONFIG || {};
const firebaseOverrides = runtimeConfig.firebaseConfig || {};

export const firebaseConfig = {
  apiKey: firebaseOverrides.apiKey || runtimeConfig.firebaseApiKey || '',
  authDomain: firebaseOverrides.authDomain || 'efootball-app-9d175.firebaseapp.com',
  projectId: firebaseOverrides.projectId || 'efootball-app-9d175',
  storageBucket: firebaseOverrides.storageBucket || 'efootball-app-9d175.firebasestorage.app',
  messagingSenderId: firebaseOverrides.messagingSenderId || '729242246964',
  appId: firebaseOverrides.appId || '1:729242246964:web:bdb35a59a681a4a7420f61',
  measurementId: firebaseOverrides.measurementId || 'G-G3XDE8M7L5',
};

export const adminWebsiteConfig = {
  appName: 'doordrop Admin Dashboards',
  projectLabel: 'efootball-app-9d175',
  currencyLabel: 'TZS',
  apiBaseUrl: 'https://us-central1-efootball-app-9d175.cloudfunctions.net/api',
  googleMapsApiKey: runtimeConfig.googleMapsApiKey || '',
  mapCenter: {
    lat: -6.7924,
    lng: 39.2083,
  },
  // Admin access:
  // - Browser access is gated by Firebase Auth in admin-website/app.js.
  // - Only the approved admin email is allowed to open the dashboard.
  // - Keep Firestore rules restricted to trusted admin users before production use.
  accessControl: {
    assignments: {},
    fallbackRole: '',
  },
};
