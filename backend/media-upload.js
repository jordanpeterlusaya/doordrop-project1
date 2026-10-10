const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

const { config } = require('./config');

const MEDIA_BUCKET =
  process.env.DOORDROP_MEDIA_BUCKET || 'doordrop-order-photos-729242246964';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function unauthorized(message) {
  const error = new Error(message || 'Unauthorized.');
  error.statusCode = 401;
  return error;
}

function ensureFirebaseAdmin() {
  if (!getApps().length) {
    const firebaseAdminOptions = {};
    if (config.firebaseServiceAccount) {
      firebaseAdminOptions.credential = cert(config.firebaseServiceAccount);
    }
    if (config.firebaseProjectId || config.firebaseServiceAccount?.project_id) {
      firebaseAdminOptions.projectId =
        config.firebaseProjectId || config.firebaseServiceAccount?.project_id;
    }
    initializeApp(firebaseAdminOptions);
  }

  return {
    auth: getAuth(),
    storage: getStorage(),
  };
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function readJsonBodyLimited(req, maxBytes) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    if (req.rawBody.length > maxBytes) {
      throw badRequest('Request body is too large.');
    }
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw badRequest('Request body must be valid JSON.');
    }
  }

  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(badRequest('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}

async function requireAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw unauthorized('Missing auth token.');
  }

  try {
    const { auth } = ensureFirebaseAdmin();
    return await auth.verifyIdToken(token);
  } catch {
    throw unauthorized('Invalid or expired auth token.');
  }
}

function sanitizePathPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

async function handleNinunuliePhotoUpload(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 64 * 1024);
  const imageBase64 = String(body.imageBase64 || body.base64 || '').replace(
    /^data:image\/[a-zA-Z+]+;base64,/,
    ''
  );
  if (!imageBase64) {
    throw badRequest('imageBase64 is required.');
  }

  let buffer;
  try {
    buffer = Buffer.from(imageBase64, 'base64');
  } catch {
    throw badRequest('Invalid imageBase64.');
  }

  if (!buffer.length) {
    throw badRequest('Empty image.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw badRequest('Image is too large (max 6MB).');
  }

  const contentType = String(body.contentType || 'image/jpeg').trim() || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw badRequest('Only image uploads are allowed.');
  }

  const userId = sanitizePathPart(decoded.uid);
  const orderKey = sanitizePathPart(body.orderKey || `draft-${Date.now()}`) || `draft-${Date.now()}`;
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const objectPath = `ninunulie/${userId}/${orderKey}/${fileName}`;

  const { storage } = ensureFirebaseAdmin();
  const bucket = storage.bucket(MEDIA_BUCKET);
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000',
      metadata: {
        uploadedBy: decoded.uid,
        purpose: 'ninunulie',
      },
    },
  });

  const downloadURL = `https://storage.googleapis.com/${MEDIA_BUCKET}/${objectPath}`;

  return {
    ok: true,
    downloadURL,
    storagePath: objectPath,
    bucket: MEDIA_BUCKET,
    bytes: buffer.length,
  };
}

const ALLOWED_DOC_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

async function handleCarrierDocumentUpload(req) {
  const decoded = await requireAuthenticatedUser(req);
  const body = await readJsonBodyLimited(req, Math.ceil(MAX_IMAGE_BYTES * 1.4) + 64 * 1024);
  const fileBase64 = String(body.fileBase64 || body.imageBase64 || body.base64 || '').replace(
    /^data:[^;]+;base64,/,
    ''
  );
  if (!fileBase64) {
    throw badRequest('fileBase64 is required.');
  }

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw badRequest('Invalid fileBase64.');
  }

  if (!buffer.length) throw badRequest('Empty file.');
  if (buffer.length > MAX_IMAGE_BYTES) throw badRequest('File is too large (max 6MB).');

  const contentType = String(body.contentType || 'image/jpeg').trim() || 'image/jpeg';
  if (!ALLOWED_DOC_TYPES.has(contentType)) {
    throw badRequest('Only JPEG, PNG, WebP, or PDF uploads are allowed.');
  }

  const docKind = sanitizePathPart(body.docKind || body.kind || 'document') || 'document';
  const userId = sanitizePathPart(decoded.uid);
  const ext =
    contentType === 'application/pdf'
      ? 'pdf'
      : contentType === 'image/png'
        ? 'png'
        : contentType === 'image/webp'
          ? 'webp'
          : 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const objectPath = `carrier-docs/${userId}/${docKind}/${fileName}`;

  const { storage } = ensureFirebaseAdmin();
  const bucket = storage.bucket(MEDIA_BUCKET);
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: 'private, max-age=0',
      metadata: {
        uploadedBy: decoded.uid,
        purpose: 'carrier_registration',
        docKind,
      },
    },
  });

  const downloadURL = `https://storage.googleapis.com/${MEDIA_BUCKET}/${objectPath}`;
  return {
    ok: true,
    downloadURL,
    storagePath: objectPath,
    bucket: MEDIA_BUCKET,
    bytes: buffer.length,
    docKind,
  };
}

module.exports = {
  MEDIA_BUCKET,
  handleCarrierDocumentUpload,
  handleNinunuliePhotoUpload,
};
