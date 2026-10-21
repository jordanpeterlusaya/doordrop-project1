const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const { config } = require('./config');
const { cellsNear } = require('./geohash');

const ONLINE_WINDOW_MS = 45 * 60 * 1000;
const DEFAULT_RADIUS_KM = 18;
const PRESENCE_QUERY_LIMIT = 80;
const USERS_FALLBACK_LIMIT = 40;
const MIN_PRESENCE_RESULTS_BEFORE_USER_FALLBACK = 8;

function ensureFirebaseAdmin() {
  if (!getApps().length) {
    const firebaseAdminOptions = {};
    if (config.firebaseServiceAccount) {
      firebaseAdminOptions.credential = cert(config.firebaseServiceAccount);
    }
    if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
      firebaseAdminOptions.projectId = config.firebaseProjectId || config.firebaseServiceAccount.project_id;
    }
    initializeApp(firebaseAdminOptions);
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || req.headers.Authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function requireFirebaseUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Missing Firebase authorization token.');
    error.statusCode = 401;
    throw error;
  }

  try {
    const { auth } = ensureFirebaseAdmin();
    return auth.verifyIdToken(token);
  } catch {
    const error = new Error('Invalid or expired Firebase authorization token.');
    error.statusCode = 401;
    throw error;
  }
}

function toMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function firstNameFrom(fullName) {
  const first = String(fullName || '')
    .trim()
    .split(/\s+/)
    .find(Boolean);
  return first || 'Mteja';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function roundCoord(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function isRecentlyActive(data, now) {
  const lastSeen = toMillis(data.lastSeenAt || data.lastActiveAt || data.updatedAt);
  if (data.isOnline === false && data.isAppOnline === false && now - lastSeen > 10 * 60 * 1000) {
    return false;
  }
  return lastSeen > 0 && now - lastSeen <= ONLINE_WINDOW_MS;
}

function upsertCustomer(map, candidate) {
  if (!candidate?.id || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
    return;
  }
  const current = map.get(candidate.id);
  if (!current || candidate.lastSeen > current.lastSeen) {
    map.set(candidate.id, candidate);
  }
}

function isCustomerLike(data) {
  const role = String(data?.role || data?.userRole || '').toLowerCase();
  const userType = String(data?.userType || '').toLowerCase();
  if (role === 'driver' || userType === 'driver') {
    return false;
  }
  if (role === 'customer' || userType === 'customer') {
    return true;
  }
  return true;
}

async function fetchNearbyPresenceDocs(db, latitude, longitude) {
  const cells = cellsNear(latitude, longitude, 6).slice(0, 9);
  if (!cells.length) {
    return [];
  }

  try {
    const snapshot = await db
      .collection('customerPresence')
      .where('geohash', 'in', cells)
      .limit(PRESENCE_QUERY_LIMIT)
      .get();
    return snapshot.docs;
  } catch {
    const snapshot = await db.collection('customerPresence').limit(PRESENCE_QUERY_LIMIT).get();
    return snapshot.docs;
  }
}

async function fetchRecentActiveUsers(db) {
  try {
    const snapshot = await db.collection('users').orderBy('lastActiveAt', 'desc').limit(USERS_FALLBACK_LIMIT).get();
    return snapshot.docs;
  } catch {
    const snapshot = await db.collection('users').limit(USERS_FALLBACK_LIMIT).get();
    return snapshot.docs;
  }
}

async function handleNearbyCustomers(req, url) {
  const user = await requireFirebaseUser(req);
  const latitude = Number(url.searchParams.get('lat'));
  const longitude = Number(url.searchParams.get('lng'));
  const radiusKm = Math.min(40, Math.max(4, Number(url.searchParams.get('radiusKm')) || DEFAULT_RADIUS_KM));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const error = new Error('Driver location is required.');
    error.statusCode = 400;
    throw error;
  }

  const { db } = ensureFirebaseAdmin();
  const now = Date.now();
  const found = new Map();

  const presenceDocs = await fetchNearbyPresenceDocs(db, latitude, longitude);

  for (const doc of presenceDocs) {
    const data = doc.data() || {};
    if (!isCustomerLike(data)) {
      continue;
    }
    if (!isRecentlyActive(data, now)) {
      continue;
    }
    upsertCustomer(found, {
      id: doc.id,
      firstName: firstNameFrom(data.firstName || data.fullName),
      latitude: roundCoord(data.latitude),
      longitude: roundCoord(data.longitude),
      lastSeen: toMillis(data.lastSeenAt || data.updatedAt),
    });
  }

  if (found.size < MIN_PRESENCE_RESULTS_BEFORE_USER_FALLBACK) {
    const userDocs = await fetchRecentActiveUsers(db);
    for (const doc of userDocs) {
      if (doc.id === user.uid) {
        continue;
      }
      const data = doc.data() || {};
      if (!isCustomerLike(data)) {
        continue;
      }
      if (!isRecentlyActive({ ...data, lastSeenAt: data.lastActiveAt }, now)) {
        continue;
      }
      upsertCustomer(found, {
        id: doc.id,
        firstName: firstNameFrom(data.fullName || data.firstName),
        latitude: roundCoord(data.lastActiveLatitude ?? data.currentLatitude ?? data.latitude),
        longitude: roundCoord(data.lastActiveLongitude ?? data.currentLongitude ?? data.longitude),
        lastSeen: toMillis(data.lastActiveAt || data.updatedAt),
      });
    }
  }

  const customers = [...found.values()]
    .map((item) => ({
      ...item,
      distanceKm: haversineKm(latitude, longitude, item.latitude, item.longitude),
    }))
    .filter((item) => item.id !== user.uid && item.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, 40)
    .map(({ lastSeen, ...item }) => item);

  return {
    ok: true,
    count: customers.length,
    radiusKm,
    customers,
  };
}

module.exports = {
  handleNearbyCustomers,
};
