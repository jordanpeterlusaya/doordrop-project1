const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACE_DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location,addressComponents,types';
const { fetchJson, ROUTES_TIMEOUT_MS } = require('./fetch-utils');
const { TtlCache } = require('./ttl-cache');

const autocompleteCache = new TtlCache({ ttlMs: 5 * 60 * 1000, maxEntries: 4000 });
const placeDetailsCache = new TtlCache({ ttlMs: 30 * 60 * 1000, maxEntries: 3000 });
const reverseGeocodeCache = new TtlCache({ ttlMs: 15 * 60 * 1000, maxEntries: 4000 });

function isWeakPlaceName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) {
    return true;
  }
  return (
    /^(unnamed(\s+road)?|unknown(\s+road)?|null|undefined|n\/a|-|road|street|tanzania|united republic of tanzania)$/i.test(
      cleaned
    ) || /^unnamed\b/i.test(cleaned)
  );
}

function cleanPlacePart(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  return !cleaned || isWeakPlaceName(cleaned) ? '' : cleaned;
}

function componentValue(components, type) {
  const match = (components || []).find((item) => Array.isArray(item.types) && item.types.includes(type));
  return cleanPlacePart(match?.longText || match?.longName || match?.long_name || match?.shortText || match?.short_name);
}

function componentValues(components, types) {
  for (const type of types) {
    const value = componentValue(components, type);
    if (value) {
      return value;
    }
  }
  return '';
}

function scoreGeocodePrecision(types) {
  const list = Array.isArray(types) ? types : [];
  if (list.includes('street_address')) return 100;
  if (list.includes('premise') || list.includes('subpremise')) return 96;
  if (list.includes('route') || list.includes('intersection')) return 92;
  if (list.includes('neighborhood')) return 84;
  if (list.includes('sublocality_level_1') || list.includes('sublocality')) return 78;
  if (list.includes('point_of_interest') || list.includes('establishment')) return 70;
  if (list.includes('locality') || list.includes('postal_town')) return 42;
  if (list.includes('administrative_area_level_2')) return 24;
  if (list.includes('administrative_area_level_1')) return 12;
  return 30;
}

function buildGooglePlaceLabel({ displayName, formattedAddress, addressComponents, resultTypes }) {
  const components = Array.isArray(addressComponents) ? addressComponents : [];
  const route = componentValue(components, 'route');
  const premise =
    componentValue(components, 'premise') ||
    componentValue(components, 'subpremise') ||
    componentValue(components, 'establishment') ||
    componentValue(components, 'point_of_interest');
  const neighborhood = componentValues(components, [
    'neighborhood',
    'sublocality_level_1',
    'sublocality',
    'sublocality_level_2',
    'sublocality_level_3',
  ]);
  const locality = componentValues(components, ['locality', 'postal_town']);
  const district = componentValue(components, 'administrative_area_level_2');
  const region = componentValue(components, 'administrative_area_level_1');
  const streetNumber = componentValue(components, 'street_number');
  const types = Array.isArray(resultTypes) ? resultTypes : [];
  const prefersRoute = types.some((type) =>
    ['route', 'street_address', 'intersection', 'premise', 'subpremise'].includes(type)
  );
  const roadNamePattern =
    /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|close|way|highway|hwy\.?)\b/i;
  const looksLikeAdmin = (value) => {
    const lower = String(value || '').toLowerCase();
    return [locality, district, region].some((part) => part && part.toLowerCase() === lower);
  };
  const formattedParts = String(formattedAddress || '')
    .split(',')
    .map((part) => cleanPlacePart(part))
    .filter(Boolean);
  const firstFormatted = formattedParts[0] || '';
  const roadFromFormatted =
    firstFormatted &&
    !looksLikeAdmin(firstFormatted) &&
    (roadNamePattern.test(firstFormatted) || prefersRoute)
      ? firstFormatted
      : '';
  const streetLine = [streetNumber, route || roadFromFormatted].filter(Boolean).join(' ');
  const cleanedDisplay = cleanPlacePart(displayName);
  const displayLooksBroad =
    !cleanedDisplay ||
    looksLikeAdmin(cleanedDisplay) ||
    types.some((type) =>
      ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'country', 'political'].includes(
        type
      )
    );

  const primary =
    premise || streetLine || neighborhood || (!displayLooksBroad ? cleanedDisplay : '');
  const areaHint = locality || district;

  if (primary) {
    const secondary = [primary === streetLine ? '' : streetLine, primary === neighborhood ? '' : neighborhood, areaHint]
      .map(cleanPlacePart)
      .filter(Boolean)
      .filter((part, index, all) => all.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index)
      .slice(0, 2);
    return [primary, ...secondary].filter(Boolean).join(', ');
  }

  if (locality && region && locality.toLowerCase() !== region.toLowerCase()) {
    return [locality, region].join(', ');
  }
  if (locality) {
    return locality;
  }
  if (district && region && district.toLowerCase() !== region.toLowerCase()) {
    return [district, region].join(', ');
  }
  if (district) {
    return district;
  }

  return formattedParts.slice(0, 2).join(', ');
}

function extractGoogleErrorMessage(payload, statusCode) {
  if (!payload || typeof payload !== 'object') {
    return `Google request failed with ${statusCode}`;
  }

  return (
    payload?.error?.message ||
    payload?.error_message ||
    payload?.message ||
    `Google request failed with ${statusCode}`
  );
}

function parseDurationSeconds(durationValue) {
  if (typeof durationValue !== 'string') {
    return 0;
  }

  const parsed = Number(durationValue.replace('s', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function requestJson(url, init, timeoutMs = 12_000) {
  const { response, payload } = await fetchJson(url, init, timeoutMs);

  if (!response.ok) {
    throw new Error(extractGoogleErrorMessage(payload, response.status));
  }

  return payload;
}

function roundCoord(value) {
  return Math.round(Number(value) * 200) / 200;
}

function autocompleteCacheKey({ input, sessionToken, origin, limit }) {
  const originKey = origin ? `${roundCoord(origin.latitude)},${roundCoord(origin.longitude)}` : 'none';
  return `${String(input || '').trim().toLowerCase()}::${originKey}::${limit || 8}::${sessionToken || ''}`;
}

function reverseGeocodeCacheKey(latitude, longitude) {
  return `${roundCoord(latitude)},${roundCoord(longitude)}`;
}

const STREET_PRIMARY_TYPES = ['route', 'street_address'];

function isStreetLikeTypes(types) {
  const list = Array.isArray(types) ? types : [];
  return list.some((type) =>
    ['route', 'street_address', 'intersection', 'premise', 'subpremise'].includes(type)
  );
}

function buildAutocompleteBody({
  input,
  sessionToken,
  origin,
  includeRegionRestriction = true,
  includedPrimaryTypes,
}) {
  const radius = 48000;

  return {
    input,
    ...(includeRegionRestriction ? { includedRegionCodes: ['TZ'] } : {}),
    languageCode: 'en',
    regionCode: 'TZ',
    sessionToken: sessionToken || undefined,
    ...(Array.isArray(includedPrimaryTypes) && includedPrimaryTypes.length
      ? { includedPrimaryTypes }
      : {}),
    origin: origin
      ? {
          latitude: Number(origin.latitude),
          longitude: Number(origin.longitude),
        }
      : undefined,
    ...(origin
      ? {
          locationBias: {
            circle: {
              center: {
                latitude: Number(origin.latitude),
                longitude: Number(origin.longitude),
              },
              radius,
            },
          },
        }
      : {}),
  };
}

function extractAutocompleteSuggestions(payload, limit) {
  const suggestions = (payload.suggestions || [])
    .map((suggestion) => suggestion?.placePrediction)
    .filter((prediction) => prediction?.placeId)
    .map((prediction) => {
      const fullText = prediction.text?.text?.trim() || '';
      const name = prediction.structuredFormat?.mainText?.text?.trim() || fullText || 'Selected place';
      const address = prediction.structuredFormat?.secondaryText?.text?.trim() || '';
      const types = Array.isArray(prediction.types)
        ? prediction.types.filter((type) => typeof type === 'string' && type.trim())
        : [];

      return {
        placeId: prediction.placeId,
        name,
        address,
        fullText: fullText || [name, address].filter(Boolean).join(', '),
        featureType: types[0] || 'place',
        types,
      };
    });

  const uniqueSuggestions = suggestions.filter(
    (suggestion, index, allSuggestions) =>
      allSuggestions.findIndex((candidate) => candidate.placeId === suggestion.placeId) === index
  );

  return uniqueSuggestions.slice(0, limit);
}

async function postAutocomplete(apiKey, body) {
  return requestJson(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

async function runAutocompleteVariant(apiKey, body, limit) {
  try {
    const payload = await postAutocomplete(apiKey, body);
    return extractAutocompleteSuggestions(payload, limit);
  } catch (error) {
    // includedPrimaryTypes may be rejected for some keys/API versions — retry without.
    if (Array.isArray(body.includedPrimaryTypes) && body.includedPrimaryTypes.length) {
      const { includedPrimaryTypes: _ignored, ...withoutTypes } = body;
      const payload = await postAutocomplete(apiKey, withoutTypes);
      return extractAutocompleteSuggestions(payload, limit);
    }
    throw error;
  }
}

function mergeStreetFirstSuggestions(streetSuggestions, areaSuggestions, limit) {
  const seen = new Set();
  const merged = [];

  const pushUnique = (items) => {
    for (const item of items) {
      if (!item?.placeId || seen.has(item.placeId)) {
        continue;
      }
      seen.add(item.placeId);
      merged.push(item);
      if (merged.length >= limit) {
        return true;
      }
    }
    return false;
  };

  const streets = (streetSuggestions || []).filter((item) => isStreetLikeTypes(item.types));
  const streetRest = (streetSuggestions || []).filter((item) => !isStreetLikeTypes(item.types));
  if (pushUnique(streets)) return merged;
  if (pushUnique((areaSuggestions || []).filter((item) => isStreetLikeTypes(item.types)))) return merged;
  if (pushUnique(streetRest)) return merged;
  pushUnique(areaSuggestions || []);
  return merged;
}

async function fetchAutocompleteSuggestions({ apiKey, input, sessionToken, origin, limit = 8 }) {
  const cacheKey = autocompleteCacheKey({ input, sessionToken, origin, limit });
  const cached = autocompleteCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fetchLimit = Math.max(limit * 2, 12);
  const streetBody = buildAutocompleteBody({
    input,
    sessionToken,
    origin,
    includeRegionRestriction: true,
    includedPrimaryTypes: STREET_PRIMARY_TYPES,
  });
  const openBody = buildAutocompleteBody({
    input,
    sessionToken,
    origin,
    includeRegionRestriction: true,
  });

  const [streetResult, openResult] = await Promise.allSettled([
    runAutocompleteVariant(apiKey, streetBody, fetchLimit),
    runAutocompleteVariant(apiKey, openBody, fetchLimit),
  ]);

  let streetSuggestions = streetResult.status === 'fulfilled' ? streetResult.value : [];
  let openSuggestions = openResult.status === 'fulfilled' ? openResult.value : [];

  // Soft region bias only — if both TZ-restricted calls fail/empty, retry open without region codes.
  if (!streetSuggestions.length && !openSuggestions.length) {
    const fallbackBody = buildAutocompleteBody({
      input,
      sessionToken,
      origin,
      includeRegionRestriction: false,
    });
    try {
      openSuggestions = await runAutocompleteVariant(apiKey, fallbackBody, fetchLimit);
    } catch {
      openSuggestions = [];
    }
  }

  // If street-typed call failed entirely, treat open results as the only pool.
  if (streetResult.status === 'rejected' && openResult.status === 'fulfilled') {
    streetSuggestions = openSuggestions.filter((item) => isStreetLikeTypes(item.types));
  }

  const suggestions = mergeStreetFirstSuggestions(streetSuggestions, openSuggestions, limit);
  autocompleteCache.set(cacheKey, suggestions);
  return suggestions;
}

async function fetchPlaceDetails({ apiKey, placeId, sessionToken }) {
  const cacheKey = `${placeId}::${sessionToken || ''}`;
  const cached = placeDetailsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const payload = await requestJson(
    buildUrl(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      languageCode: 'en',
      regionCode: 'TZ',
      sessionToken,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      },
    }
  );

  if (!payload.location) {
    throw new Error('Google Place Details returned no coordinates.');
  }

  const location = payload.location;
  const displayName = payload.displayName?.text?.trim() || '';
  const formattedAddress = payload.formattedAddress?.trim() || '';
  const types = Array.isArray(payload.types)
    ? payload.types.filter((type) => typeof type === 'string' && type.trim())
    : [];
  const label = buildGooglePlaceLabel({
    displayName,
    formattedAddress,
    addressComponents: payload.addressComponents,
    resultTypes: types,
  });

  const resolved = {
    placeId: payload.id || placeId,
    name: label || cleanPlacePart(displayName) || 'Selected place',
    address: formattedAddress,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    types,
    featureType: types[0] || 'place',
  };

  placeDetailsCache.set(cacheKey, resolved);
  return resolved;
}

async function reverseGeocodePoint({ apiKey, latitude, longitude }) {
  const cacheKey = reverseGeocodeCacheKey(latitude, longitude);
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fetchResults = async (streetLevelOnly) => {
    const payload = await requestJson(
      buildUrl('https://maps.googleapis.com/maps/api/geocode/json', {
        latlng: `${latitude},${longitude}`,
        language: 'en',
        region: 'tz',
        location_type: 'ROOFTOP|RANGE_INTERPOLATED|GEOMETRIC_CENTER|APPROXIMATE',
        ...(streetLevelOnly
          ? {
              result_type:
                'street_address|premise|subpremise|route|intersection|neighborhood|sublocality|sublocality_level_1|sublocality_level_2|point_of_interest',
            }
          : {}),
        key: apiKey,
      }),
      {
        method: 'GET',
      }
    );

    if (payload.status && payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
      throw new Error(payload.error_message || `Google geocode failed with ${payload.status}`);
    }

    return Array.isArray(payload.results) ? payload.results : [];
  };

  let results = await fetchResults(true);
  if (!results.length) {
    results = await fetchResults(false);
  }

  if (!results.length) {
    return null;
  }

  const ranked = [...results].sort(
    (left, right) => scoreGeocodePrecision(right.types) - scoreGeocodePrecision(left.types)
  );

  let best = null;
  for (const result of ranked) {
    const components = result.address_components || [];
    const mappedComponents = components.map((item) => ({
      longText: item.long_name,
      shortText: item.short_name,
      types: item.types,
    }));
    const label = buildGooglePlaceLabel({
      displayName: result.address_components?.[0]?.long_name,
      formattedAddress: result.formatted_address,
      addressComponents: mappedComponents,
      resultTypes: result.types,
    });
    if (!label && !result.formatted_address) {
      continue;
    }
    const candidate = {
      name: label || result.formatted_address || 'Selected place',
      address: result.formatted_address || '',
      latitude: Number(result.geometry?.location?.lat ?? latitude),
      longitude: Number(result.geometry?.location?.lng ?? longitude),
      score: scoreGeocodePrecision(result.types),
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
    if (candidate.score >= 70) {
      break;
    }
  }

  if (!best) {
    return null;
  }

  const resolved = {
    name: best.name,
    address: best.address,
    latitude: best.latitude,
    longitude: best.longitude,
  };

  reverseGeocodeCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Prefer Google's ranked TRAFFIC_AWARE_OPTIMAL route[0] (matches Maps app).
 * Do not re-sort away from Google's traffic-aware ranking.
 * Returns { distanceMeters, durationSeconds, polyline } or null.
 */
function selectPreferredDriveRoute(routes) {
  const candidates = (Array.isArray(routes) ? routes : [])
    .map((route) => {
      const distanceMeters = Number(route?.distanceMeters);
      const durationSeconds = parseDurationSeconds(route?.duration);
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return null;
      }
      return {
        distanceMeters,
        durationSeconds,
        polyline: route?.polyline?.encodedPolyline || '',
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  // Keep Google's order: first valid candidate is route[0] under TRAFFIC_AWARE_OPTIMAL.
  return candidates[0];
}

/** @deprecated Use selectPreferredDriveRoute — kept as alias for tests/callers. */
function selectShortestRoute(routes) {
  return selectPreferredDriveRoute(routes);
}

function roundCoordForLog(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.round(n * 1e4) / 1e4;
}

function isRoutesDevDiagnosticsEnabled() {
  return process.env.NODE_ENV !== 'production';
}

/** Default preference: TRAFFIC_AWARE_OPTIMAL matches Google Maps app drive routes. */
const DEFAULT_ROUTING_PREFERENCE = 'TRAFFIC_AWARE_OPTIMAL';

/** TRAFFIC_AWARE*_OPTIMAL departureTime must be strictly in Google's future (now + RTT is too late). */
function toRfc3339DepartureSoon() {
  return new Date(Date.now() + 60_000).toISOString();
}

const ROUTES_FIELD_MASK = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

/** Dev-only trip label mirror of book-cargo formatTripDistanceLabel (no pricing). */
function frontendTripDistanceLabel(meters) {
  if (!Number.isFinite(meters) || meters <= 0) {
    return '—';
  }
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m`;
  }
  const km = meters / 1000;
  if (km >= 100) {
    return `${Math.round(km)} km`;
  }
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} km`;
}

function logRouteDiagnostics(payload) {
  if (!isRoutesDevDiagnosticsEnabled()) {
    return;
  }
  console.info('[routes] computeRoute', payload);
}

async function computeRoute({
  apiKey,
  origin,
  destination,
  routingPreference = DEFAULT_ROUTING_PREFERENCE,
  cached = false,
  fallback = false,
}) {
  const originLat = Number(origin.latitude);
  const originLng = Number(origin.longitude);
  const destLat = Number(destination.latitude);
  const destLng = Number(destination.longitude);
  const logOrigin = `${roundCoordForLog(originLat)},${roundCoordForLog(originLng)}`;
  const logDest = `${roundCoordForLog(destLat)},${roundCoordForLog(destLng)}`;
  const preference = routingPreference || DEFAULT_ROUTING_PREFERENCE;
  const departureTime = toRfc3339DepartureSoon();
  const startedAt = Date.now();
  const requestMeta = {
    origin: logOrigin,
    destination: logDest,
    travelMode: 'DRIVE',
    routingPreference: preference,
    departureTime,
    fieldMask: ROUTES_FIELD_MASK,
    computeAlternativeRoutes: false,
    routeModifiers: null,
    intermediates: null,
    placeIdWaypoints: false,
  };

  const requestBody = {
    origin: {
      location: {
        latLng: {
          latitude: originLat,
          longitude: originLng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destLat,
          longitude: destLng,
        },
      },
    },
    travelMode: 'DRIVE',
    // TRAFFIC_AWARE_OPTIMAL + explicit departureTime matches Maps app primary drive route.
    routingPreference: preference,
    departureTime,
    units: 'METRIC',
    languageCode: 'en',
    regionCode: 'TZ',
    polylineQuality: 'HIGH_QUALITY',
    // Single primary route — avoid alternatives that tempt client-side re-ranking.
    computeAlternativeRoutes: false,
  };
  // TEMP diagnostic: confirm preference actually serialized into Routes API body.
  console.info('[routes] requestBody.routingPreference=', requestBody.routingPreference);

  let payload;
  try {
    payload = await requestJson(
      COMPUTE_ROUTES_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': ROUTES_FIELD_MASK,
        },
        body: JSON.stringify(requestBody),
      },
      ROUTES_TIMEOUT_MS
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /timeout|aborted|AbortError/i.test(message)
      ? 'ROUTES_TIMEOUT'
      : /403|PERMISSION|API key/i.test(message)
        ? 'ROUTES_AUTH'
        : 'ROUTES_ERROR';
    logRouteDiagnostics({
      ...requestMeta,
      status: code,
      rawDistanceMeters: null,
      duration: null,
      polylineLength: null,
      distanceMeters: null,
      distanceKm: null,
      durationSeconds: null,
      frontendWouldShow: '—',
      latencyMs: Date.now() - startedAt,
      cached: Boolean(cached),
      fallback: Boolean(fallback),
      message: message.slice(0, 240),
    });
    throw error;
  }

  const rawFirst = Array.isArray(payload?.routes) ? payload.routes[0] : null;
  const rawDistanceMeters = Number(rawFirst?.distanceMeters);
  const rawDuration = rawFirst?.duration ?? null;
  const rawPolyline = typeof rawFirst?.polyline?.encodedPolyline === 'string'
    ? rawFirst.polyline.encodedPolyline
    : '';
  const route = selectPreferredDriveRoute(payload.routes);
  if (!route) {
    logRouteDiagnostics({
      ...requestMeta,
      status: 'ROUTES_INCOMPLETE',
      rawDistanceMeters: Number.isFinite(rawDistanceMeters) ? rawDistanceMeters : null,
      duration: rawDuration,
      polylineLength: rawPolyline.length,
      distanceMeters: null,
      distanceKm: null,
      durationSeconds: null,
      frontendWouldShow: '—',
      latencyMs: Date.now() - startedAt,
      cached: Boolean(cached),
      fallback: Boolean(fallback),
      routesCount: Array.isArray(payload?.routes) ? payload.routes.length : 0,
    });
    throw new Error('Google Routes API returned an incomplete route.');
  }

  // Authoritative meters: routes[0].distanceMeters under OPTIMAL ranking (no polyline/haversine).
  logRouteDiagnostics({
    ...requestMeta,
    status: 'ok',
    rawDistanceMeters: Number.isFinite(rawDistanceMeters) ? rawDistanceMeters : null,
    duration: rawDuration,
    polylineLength: (route.polyline || rawPolyline).length,
    distanceMeters: route.distanceMeters,
    distanceKm: Number((route.distanceMeters / 1000).toFixed(2)),
    durationSeconds: route.durationSeconds,
    frontendWouldShow: frontendTripDistanceLabel(route.distanceMeters),
    latencyMs: Date.now() - startedAt,
    cached: Boolean(cached),
    fallback: Boolean(fallback),
  });

  return route;
}

module.exports = {
  DEFAULT_ROUTING_PREFERENCE,
  computeRoute,
  selectPreferredDriveRoute,
  selectShortestRoute,
  parseDurationSeconds,
  fetchAutocompleteSuggestions,
  fetchPlaceDetails,
  reverseGeocodePoint,
  roundCoordForLog,
};
