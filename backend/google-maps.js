const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACE_DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location';

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

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const rawBody = await response.text();
  let payload = {};

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { message: rawBody };
    }
  }

  if (!response.ok) {
    throw new Error(extractGoogleErrorMessage(payload, response.status));
  }

  return payload;
}

function buildAutocompleteBody({ input, sessionToken, origin, includeRegionRestriction }) {
  return {
    input,
    ...(includeRegionRestriction ? { includedRegionCodes: ['TZ'] } : {}),
    languageCode: 'en',
    regionCode: 'TZ',
    sessionToken: sessionToken || undefined,
    origin: origin
      ? {
          latitude: Number(origin.latitude),
          longitude: Number(origin.longitude),
        }
      : undefined,
    locationBias: origin
      ? {
          circle: {
            center: {
              latitude: Number(origin.latitude),
              longitude: Number(origin.longitude),
            },
            radius: 50000,
          },
        }
      : undefined,
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

      return {
        placeId: prediction.placeId,
        name,
        address,
        fullText: fullText || [name, address].filter(Boolean).join(', '),
        featureType: prediction.types?.[0] || 'place',
      };
    });

  const uniqueSuggestions = suggestions.filter(
    (suggestion, index, allSuggestions) =>
      allSuggestions.findIndex((candidate) => candidate.placeId === suggestion.placeId) === index
  );

  return uniqueSuggestions.slice(0, limit);
}

async function fetchAutocompleteSuggestions({ apiKey, input, sessionToken, origin, limit = 6 }) {
  const requestVariants = [
    buildAutocompleteBody({ input, sessionToken, origin, includeRegionRestriction: true }),
    origin ? buildAutocompleteBody({ input, sessionToken, origin: null, includeRegionRestriction: true }) : null,
    buildAutocompleteBody({ input, sessionToken, origin: null, includeRegionRestriction: false }),
  ].filter(Boolean);

  for (const body of requestVariants) {
    const payload = await requestJson(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const suggestions = extractAutocompleteSuggestions(payload, limit);
    if (suggestions.length > 0) {
      return suggestions;
    }
  }

  return [];
}

async function fetchPlaceDetails({ apiKey, placeId, sessionToken }) {
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

  return {
    placeId: payload.id || placeId,
    name: payload.displayName?.text?.trim() || 'Selected place',
    address: payload.formattedAddress?.trim() || '',
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
}

async function computeRoute({ apiKey, origin, destination }) {
  const payload = await requestJson(COMPUTE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: Number(origin.latitude),
            longitude: Number(origin.longitude),
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: Number(destination.latitude),
            longitude: Number(destination.longitude),
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      units: 'METRIC',
      polylineQuality: 'OVERVIEW',
    }),
  });

  const route = payload.routes?.[0];
  if (!route?.distanceMeters || !route?.duration) {
    throw new Error('Google Routes API returned an incomplete route.');
  }

  return {
    distanceMeters: Number(route.distanceMeters),
    durationSeconds: parseDurationSeconds(route.duration),
    polyline: route.polyline?.encodedPolyline || '',
  };
}

module.exports = {
  computeRoute,
  fetchAutocompleteSuggestions,
  fetchPlaceDetails,
};
