/* global Buffer */

const http = require('http');
const polyline = require('@mapbox/polyline');

const { config, assertGoogleApiConfig } = require('./config');
const { sendDebugWebhook } = require('./debug-webhook');
const { computeRoute, fetchAutocompleteSuggestions, fetchPlaceDetails } = require('./google-maps');
const {
  SUPPORTED_VEHICLE_TYPES,
  calculateEstimatedPrice,
  normalizeCargoSize,
  normalizePricingScope,
  normalizeVehicleType,
} = require('./pricing');

function sendJson(res, statusCode, data, originHeader) {
  const allowOrigin = resolveCorsOrigin(originHeader);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,x-admin-email,x-admin-uid',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    try {
      return JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw badRequest('Request body must be valid JSON.');
    }
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
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
    const route = await computeRoute({
      apiKey: config.googleRoutesApiKey,
      origin,
      destination,
    });

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

async function requestListener(req, res) {
  const originHeader = getRequestOrigin(req);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {}, originHeader);
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    url.pathname = normalizeFunctionPathname(url.pathname);

    if (req.method === 'GET' && url.pathname === '/') {
      sendJson(
        res,
        200,
        {
          ok: true,
          service: 'DoorDrop API',
          health: '/health',
          endpoints: [
            'GET /health',
            'GET /places/autocomplete',
            'GET /places/details',
            'GET /places/resolve',
            'POST /routes/estimate',
            'POST /pricing/estimate',
          ],
        },
        originHeader
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(
        res,
        200,
        {
          ok: true,
          googlePlacesConfigured: Boolean(config.googlePlacesApiKey),
          googleRoutesConfigured: Boolean(config.googleRoutesApiKey),
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
  server.listen(config.port, () => {
    console.log(`DoorDrop backend listening on port ${config.port}`);
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
