/* global Buffer */

const http = require('http');
const polyline = require('@mapbox/polyline');

const { config, assertGoogleApiConfig } = require('./config');
const { sendDebugWebhook } = require('./debug-webhook');
const { computeRoute, fetchAutocompleteSuggestions, fetchPlaceDetails, reverseGeocodePoint } = require('./google-maps');
const { readRouteCache, routeCacheKey, writeRouteCache } = require('./route-cache');
const { enforceRateLimit } = require('./rate-limit');
const { getMetricsSnapshot, recordRequest } = require('./request-metrics');
const {
  SUPPORTED_VEHICLE_TYPES,
  calculateEstimatedPrice,
  normalizeCargoSize,
  normalizePricingScope,
  normalizeVehicleType,
} = require('./pricing');
const {
  driverAccessFeeTzs,
  handleDriverPaymentHistory: getDriverPaymentHistoryPayload,
  handleDriverPaymentStatus: getDriverPaymentStatusPayload,
  handleMongikeWebhook,
  initiateDriverPayment,
  mongikeNetworks,
  verifyDriverPayment,
} = require('./mongike-payments');
const { handleNearbyCustomers } = require('./nearby-customers');
const { handleCarrierDocumentUpload, handleNinunuliePhotoUpload } = require('./media-upload');
const { handleConfirmPhone, handleSendOtp, handleVerifyOtp } = require('./carrier-otp');

function sendJson(res, statusCode, data, originHeader, extraHeaders = {}) {
  const allowOrigin = resolveCorsOrigin(originHeader);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,x-admin-email,x-admin-uid',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...extraHeaders,
  });

  res.end(JSON.stringify(data));
}

function resolveCorsOrigin(originHeader) {
  if (config.allowedOrigins.includes('*')) {
    return '*';
  }

  if (originHeader && config.allowedOrigins.includes(originHeader)) {
    return originHeader;
  }

  return config.allowedOrigins[0] || '*';
}

function getRequestOrigin(req) {
  return req.headers.origin || '';
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseCoordinate(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`Invalid ${name}.`);
  }

  return parsed;
}

function validatePlaceInput(input) {
  const trimmed = String(input || '').trim();
  if (trimmed.length < 3) {
    throw badRequest('Search text must be at least 3 characters.');
  }

  return trimmed;
}

async function readJsonBody(req) {
  const MAX_BODY_BYTES = 256 * 1024;

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    if (req.rawBody.length > MAX_BODY_BYTES) {
      throw badRequest('Request body is too large.');
    }
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw badRequest('Request body must be valid JSON.');
    }
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw badRequest('Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}

function decodeRouteCoordinates(encodedPolyline) {
  if (!encodedPolyline) {
    return [];
  }

  try {
    return polyline.decode(encodedPolyline).map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));
  } catch {
    return [];
  }
}

function mapRouteResponse(route, pricingEstimate = null) {
  return {
    distanceMeters: route.distanceMeters,
    distanceKm: Number((route.distanceMeters / 1000).toFixed(2)),
    durationSeconds: route.durationSeconds,
    polyline: route.polyline,
    coordinates: decodeRouteCoordinates(route.polyline),
    price: pricingEstimate?.estimatedPrice ?? null,
    pricingEstimate,
  };
}

function mapPricingResponse(price) {
  return {
    vehicleType: price.vehicleType,
    distanceKm: price.distanceKm,
    estimatedPrice: price.estimatedPrice,
    currency: price.currency,
    cargoSize: price.cargoSize ?? null,
    cargoMultiplier: price.cargoMultiplier ?? 1,
    pricing: {
      baseFare: price.baseFare,
      pricePerKm: price.pricePerKm,
      timeBufferPerKm: price.timeBufferPerKm ?? 0,
      sizeExtraRatePerKm: price.sizeExtraRatePerKm ?? 0,
      minimumFare: price.minimumFare,
      rawPrice: price.rawPrice,
      adjustedRawPrice: price.adjustedRawPrice ?? price.rawPrice,
    },
  };
}

function createDebugRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function countPolylineCoordinates(encodedPolyline) {
  if (!encodedPolyline) {
    return 0;
  }

  try {
    return polyline.decode(encodedPolyline).length;
  } catch {
    return 0;
  }
}

function buildPricingSnapshot(distanceMeters, cargoSize = null, pricingScope = null) {
  if (!Number.isFinite(distanceMeters)) {
    return null;
  }

  return Object.fromEntries(
    SUPPORTED_VEHICLE_TYPES.map((vehicleType) => {
      try {
        const price = calculateEstimatedPrice({
          distanceMeters,
          vehicleType,
          pricingTable: config.pricing,
          cargoSize,
          pricingScope,
        });

        return [vehicleType, mapPricingResponse(price)];
      } catch (error) {
        return [
          vehicleType,
          {
            error: error instanceof Error ? error.message : 'Pricing calculation failed.',
          },
        ];
      }
    })
  );
}

function buildRoutePricingEstimate(distanceMeters, vehicleType, cargoSize = null, pricingScope = null) {
  if (!vehicleType || !Number.isFinite(distanceMeters)) {
    return null;
  }

  return mapPricingResponse(
    calculateEstimatedPrice({
      distanceMeters,
      vehicleType,
      pricingTable: config.pricing,
      cargoSize,
      pricingScope,
    })
  );
}

function buildOptionalRoutePricingEstimate(distanceMeters, vehicleType, cargoSize = null, pricingScope = null) {
  try {
    return buildRoutePricingEstimate(distanceMeters, vehicleType, cargoSize, pricingScope);
  } catch {
    return null;
  }
}

async function handleAutocomplete(req, res, url) {
  const input = validatePlaceInput(url.searchParams.get('input'));
  const sessionToken = String(url.searchParams.get('sessionToken') || '').trim();
  const latitude = url.searchParams.get('latitude');
  const longitude = url.searchParams.get('longitude');
  const limit = Number(url.searchParams.get('limit') || 6);

  const origin =
    latitude && longitude
      ? {
          latitude: parseCoordinate(latitude, 'latitude'),
          longitude: parseCoordinate(longitude, 'longitude'),
        }
      : null;

  const debugRequestId = createDebugRequestId('places');
  const debugBasePayload = {
    requestId: debugRequestId,
    endpoint: '/places/autocomplete',
    query: input,
    origin,
    destination: null,
    distanceMeters: null,
    durationSeconds: null,
    coordinatesCount: null,
    pricingResult: null,
  };

  void sendDebugWebhook('places-autocomplete-request', {
    ...debugBasePayload,
    status: 'request',
    success: null,
  });

  try {
    const suggestions = await fetchAutocompleteSuggestions({
      apiKey: config.googlePlacesApiKey,
      input,
      sessionToken,
      origin,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 10) : 6,
    });

    void sendDebugWebhook('places-autocomplete-response', {
      ...debugBasePayload,
      status: 'success',
      success: true,
      suggestionsCount: suggestions.length,
      suggestionsPreview: suggestions.slice(0, 3),
    });

    sendJson(res, 200, { suggestions }, getRequestOrigin(req));
  } catch (error) {
    void sendDebugWebhook('places-autocomplete-error', {
      ...debugBasePayload,
      status: 'error',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unexpected autocomplete error.',
    });

    throw error;
  }
}

async function handlePlaceReverse(req, res, url) {
  const latitude = parseCoordinate(url.searchParams.get('latitude'), 'latitude');
  const longitude = parseCoordinate(url.searchParams.get('longitude'), 'longitude');

  const place = await reverseGeocodePoint({
    apiKey: config.googlePlacesApiKey,
    latitude,
    longitude,
  });

  if (!place) {
    sendJson(res, 200, { name: null, address: null, latitude, longitude }, getRequestOrigin(req));
    return;
  }

  sendJson(res, 200, place, getRequestOrigin(req));
}

async function handlePlaceDetails(req, res, url) {
  const placeId = String(url.searchParams.get('placeId') || '').trim();
  const sessionToken = String(url.searchParams.get('sessionToken') || '').trim();
  if (!placeId) {
    throw badRequest('placeId is required.');
  }

  const debugRequestId = createDebugRequestId('place-details');
  const debugBasePayload = {
    requestId: debugRequestId,
    endpoint: '/places/details',
    query: null,
    placeId,
    origin: null,
    destination: null,
    distanceMeters: null,
    durationSeconds: null,
    coordinatesCount: null,
    pricingResult: null,
  };

  void sendDebugWebhook('places-details-request', {
    ...debugBasePayload,
    status: 'request',
    success: null,
  });

  try {
    const place = await fetchPlaceDetails({
      apiKey: config.googlePlacesApiKey,
      placeId,
      sessionToken: sessionToken || undefined,
    });

    void sendDebugWebhook('places-details-response', {
      ...debugBasePayload,
      status: 'success',
      success: true,
      place: {
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
      },
    });

    sendJson(res, 200, place, getRequestOrigin(req));
  } catch (error) {
    void sendDebugWebhook('places-details-error', {
      ...debugBasePayload,
      status: 'error',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unexpected place details error.',
    });

    throw error;
  }
}

async function handlePlaceResolve(req, res, url) {
  await handlePlaceDetails(req, res, url);
}

async function handleRouteEstimate(req, res) {
  const body = await readJsonBody(req);
  const vehicleType = body.vehicleType ? normalizeVehicleType(body.vehicleType) : null;
  const cargoSize = normalizeCargoSize(body.cargoSize);
  const pricingScope = normalizePricingScope(body.pricingScope || body.scope);

  const origin = {
    latitude: parseCoordinate(body.origin?.latitude, 'origin.latitude'),
    longitude: parseCoordinate(body.origin?.longitude, 'origin.longitude'),
  };

  const destination = {
    latitude: parseCoordinate(body.destination?.latitude, 'destination.latitude'),
    longitude: parseCoordinate(body.destination?.longitude, 'destination.longitude'),
  };

  const debugRequestId = createDebugRequestId('routes');
  const debugBasePayload = {
    requestId: debugRequestId,
    endpoint: '/routes/estimate',
    query: null,
    vehicleType,
    cargoSize,
    pricingScope,
    origin,
    destination,
    distanceMeters: null,
    durationSeconds: null,
    coordinatesCount: null,
    pricingResult: null,
  };

  void sendDebugWebhook('routes-estimate-request', {
    ...debugBasePayload,
    status: 'request',
    success: null,
  });

  try {
    const cacheKey = routeCacheKey(origin, destination, vehicleType, cargoSize);
    const cached = readRouteCache(cacheKey);
    const route = cached || await computeRoute({
      apiKey: config.googleRoutesApiKey,
      origin,
      destination,
    });

    if (!cached) {
      writeRouteCache(cacheKey, route);
    }

    const coordinatesCount = countPolylineCoordinates(route.polyline);
    const routePricingEstimate = buildOptionalRoutePricingEstimate(route.distanceMeters, vehicleType, cargoSize, pricingScope);
    const pricingResult = routePricingEstimate ?? buildPricingSnapshot(route.distanceMeters, cargoSize, pricingScope);

    void sendDebugWebhook('routes-estimate-response', {
      ...debugBasePayload,
      status: 'success',
      success: true,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      coordinatesCount,
      price: routePricingEstimate?.estimatedPrice ?? null,
      pricingResult,
    });

    sendJson(res, 200, mapRouteResponse(route, routePricingEstimate), getRequestOrigin(req));
  } catch (error) {
    void sendDebugWebhook('routes-estimate-error', {
      ...debugBasePayload,
      status: 'error',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unexpected route estimate error.',
    });

    throw error;
  }
}

async function handlePricingEstimate(req, res) {
  const body = await readJsonBody(req);
  const vehicleType = normalizeVehicleType(body.vehicleType);
  const cargoSize = normalizeCargoSize(body.cargoSize);
  const pricingScope = normalizePricingScope(body.pricingScope || body.scope);
  const distanceMeters = parseCoordinate(body.distanceMeters, 'distanceMeters');

  const debugRequestId = createDebugRequestId('pricing');
  const debugBasePayload = {
    requestId: debugRequestId,
    endpoint: '/pricing/estimate',
    query: null,
    vehicleType,
    cargoSize,
    pricingScope,
    origin: null,
    destination: null,
    distanceMeters,
    durationSeconds: null,
    coordinatesCount: null,
    pricingResult: null,
  };

  void sendDebugWebhook('pricing-estimate-request', {
    ...debugBasePayload,
    status: 'request',
    success: null,
  });

  try {
    const price = calculateEstimatedPrice({
      distanceMeters,
      vehicleType,
      pricingTable: config.pricing,
      cargoSize,
      pricingScope,
    });

    const pricingResult = mapPricingResponse(price);

    void sendDebugWebhook('pricing-estimate-response', {
      ...debugBasePayload,
      status: 'success',
      success: true,
      pricingResult,
    });

    sendJson(res, 200, pricingResult, getRequestOrigin(req));
  } catch (error) {
    void sendDebugWebhook('pricing-estimate-error', {
      ...debugBasePayload,
      status: 'error',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unexpected pricing estimate error.',
    });

    throw error;
  }
}

async function handleDriverPaymentInitiate(req, res) {
  const body = await readJsonBody(req);
  const payload = await initiateDriverPayment(req, body);
  sendJson(res, 200, payload, getRequestOrigin(req));
}

async function handleDriverPaymentVerify(req, res) {
  const body = await readJsonBody(req);
  const payload = await verifyDriverPayment(req, body);
  sendJson(res, 200, payload, getRequestOrigin(req));
}

async function handleDriverPaymentStatus(req, res, url) {
  const payload = await getDriverPaymentStatusPayload(req, url);
  sendJson(res, 200, payload, getRequestOrigin(req));
}

async function handleDriverPaymentHistory(req, res) {
  const payload = await getDriverPaymentHistoryPayload(req);
  sendJson(res, 200, payload, getRequestOrigin(req));
}

async function handleDriverPaymentWebhook(req, res) {
  const body = await readJsonBody(req);
  const payload = await handleMongikeWebhook(req, body);
  sendJson(res, 200, { ok: true, ...payload }, getRequestOrigin(req));
}

async function requestListener(req, res) {
  const originHeader = getRequestOrigin(req);
  const startedAt = Date.now();
  let pathname = '/';

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {}, originHeader);
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    url.pathname = normalizeFunctionPathname(url.pathname);
    pathname = url.pathname;

    enforceRateLimit(req, pathname);

    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(
        res,
        200,
        {
          ok: true,
          service: 'DoorDrop API',
          health: '/health',
          metrics: '/metrics',
          endpoints: [
            'GET /health',
            'GET /metrics',
            'GET /places/autocomplete',
            'GET /places/details',
            'GET /places/reverse',
            'GET /places/resolve',
            'POST /routes/estimate',
            'POST /pricing/estimate',
            'POST /driver-payments/initiate',
            'POST /driver-payments/verify',
            'GET /driver-payments/status',
            'GET /driver-payments/history',
            'GET /nearby-customers',
            'POST /media/ninunulie',
            'POST /media/carrier-document',
            'POST /carrier-auth/otp/send',
            'POST /carrier-auth/otp/verify',
            'POST /carrier-auth/confirm-phone',
            'POST /driver-payments/webhook/mongike',
          ],
        },
        originHeader
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      sendJson(res, 200, getMetricsSnapshot(), originHeader);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      let smsConfigured = false;
      let smsProvider = '';
      try {
        const sms = require('./sms-provider');
        smsConfigured = Boolean(sms.smsConfigured());
        smsProvider = String(process.env.SMS_PROVIDER || (smsConfigured ? 'auto' : '')).trim().toLowerCase() || '';
      } catch {
        smsConfigured = false;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          googlePlacesConfigured: Boolean(config.googlePlacesApiKey),
          googleRoutesConfigured: Boolean(config.googleRoutesApiKey),
          mongikeConfigured: Boolean(process.env.MONGIKE_API_KEY),
          smsConfigured,
          smsProvider: smsProvider || null,
          driverAccessFeeTzs,
          mongikeNetworks,
          supportedVehicleTypes: SUPPORTED_VEHICLE_TYPES,
        },
        originHeader
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/places/autocomplete') {
      await handleAutocomplete(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/places/details') {
      await handlePlaceDetails(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/places/reverse') {
      await handlePlaceReverse(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/places/resolve') {
      await handlePlaceResolve(req, res, url);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/routes/estimate') {
      await handleRouteEstimate(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/pricing/estimate') {
      await handlePricingEstimate(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/driver-payments/initiate') {
      await handleDriverPaymentInitiate(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/driver-payments/verify') {
      await handleDriverPaymentVerify(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/driver-payments/status') {
      await handleDriverPaymentStatus(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/driver-payments/history') {
      await handleDriverPaymentHistory(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/nearby-customers') {
      const payload = await handleNearbyCustomers(req, url);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/media/ninunulie') {
      const payload = await handleNinunuliePhotoUpload(req);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/media/carrier-document') {
      const payload = await handleCarrierDocumentUpload(req);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/carrier-auth/otp/send') {
      const payload = await handleSendOtp(req);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/carrier-auth/otp/verify') {
      const payload = await handleVerifyOtp(req);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/carrier-auth/confirm-phone') {
      const authHeader = String(req.headers.authorization || req.headers.Authorization || '');
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        sendJson(res, 401, { error: 'Missing auth token.' }, originHeader);
        return;
      }
      const { cert, getApps, initializeApp } = require('firebase-admin/app');
      const { getAuth } = require('firebase-admin/auth');
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
      let decoded;
      try {
        decoded = await getAuth().verifyIdToken(match[1].trim());
      } catch {
        sendJson(res, 401, { error: 'Invalid or expired auth token.' }, originHeader);
        return;
      }
      const payload = await handleConfirmPhone(req, decoded);
      sendJson(res, 200, payload, originHeader);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/driver-payments/webhook/mongike') {
      await handleDriverPaymentWebhook(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Not found.' }, originHeader);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(
      res,
      statusCode,
      {
        error: error instanceof Error ? error.message : 'Unexpected server error.',
      },
      originHeader
    );
  } finally {
    recordRequest(pathname, Date.now() - startedAt, res.statusCode || 200);
  }
}

function normalizeFunctionPathname(pathname) {
  if (pathname === '/api') {
    return '/';
  }

  if (pathname.startsWith('/api/')) {
    return pathname.slice('/api'.length);
  }

  return pathname;
}

function startServer() {
  assertGoogleApiConfig();
  const server = http.createServer(requestListener);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`DoorDrop backend listening on 0.0.0.0:${config.port}`);
  });

  return server;
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  requestListener,
  startServer,
};
