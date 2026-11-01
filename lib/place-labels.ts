import type { RoutePoint } from '@/lib/route-utils';

const WEAK_NAME_PATTERN =
  /^(unnamed(\s+road)?|unknown(\s+road)?|null|undefined|n\/a|-|road|street|tanzania|united republic of tanzania)$/i;

export function isCoordinateLikeLabel(value?: string | null) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(
    String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

export function isWeakPlaceName(value?: string | null) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) {
    return true;
  }
  if (WEAK_NAME_PATTERN.test(cleaned)) {
    return true;
  }
  if (/^unnamed\b/i.test(cleaned)) {
    return true;
  }
  // Bare coordinates are not useful labels for customers or drivers.
  if (isCoordinateLikeLabel(cleaned)) {
    return true;
  }
  return false;
}

export function cleanPlacePart(value?: string | null) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned || isWeakPlaceName(cleaned)) {
    return '';
  }
  return cleaned;
}

export function uniquePlaceParts(parts: Array<string | null | undefined>, limit = 3) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const cleaned = cleanPlacePart(part);
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function buildPlaceLabel(parts: Array<string | null | undefined>, fallback = 'Selected place') {
  const unique = uniquePlaceParts(parts, 3);
  return unique.join(', ') || fallback;
}

type ExpoLikeAddress = {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export function formatExpoGeocodedLabel(address: ExpoLikeAddress | null | undefined, point?: RoutePoint | null) {
  if (address) {
    const streetLine = [cleanPlacePart(address.streetNumber), cleanPlacePart(address.street)].filter(Boolean).join(' ');
    if (streetLine) {
      // Street first; city/subregion as context — skip district when city is available.
      const label = buildPlaceLabel(
        [streetLine, address.subregion, address.city, address.district],
        ''
      );
      if (label) {
        return label;
      }
    }

    // Prefer named neighborhood / subregion over bare district (wilaya).
    const area =
      cleanPlacePart(address.name) ||
      cleanPlacePart(address.subregion) ||
      cleanPlacePart(address.district);
    const city = cleanPlacePart(address.city) || cleanPlacePart(address.region);
    const nameLooksLikeDistrict =
      cleanPlacePart(address.name) &&
      cleanPlacePart(address.district) &&
      cleanPlacePart(address.name)?.toLowerCase() === cleanPlacePart(address.district)?.toLowerCase();

    if (area && city && area.toLowerCase() !== city.toLowerCase() && !nameLooksLikeDistrict) {
      return buildPlaceLabel([area, city], '');
    }
    if (area && !nameLooksLikeDistrict) {
      return area;
    }
    if (city) {
      return city;
    }
    if (cleanPlacePart(address.district)) {
      return cleanPlacePart(address.district);
    }
  }

  if (point) {
    return formatExactCoordinateLabel(point);
  }

  return '';
}

type AddressComponent = {
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
  types?: string[];
};

function componentValue(components: AddressComponent[], type: string) {
  const match = components.find((item) => Array.isArray(item.types) && item.types.includes(type));
  return cleanPlacePart(match?.longText || match?.long_name || match?.shortText || match?.short_name);
}

function componentValues(components: AddressComponent[], types: string[]) {
  for (const type of types) {
    const value = componentValue(components, type);
    if (value) {
      return value;
    }
  }
  return '';
}

const BROAD_AREA_TYPES = new Set([
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'country',
  'political',
]);

export function scoreGeocodePrecision(types: string[] | undefined) {
  const list = Array.isArray(types) ? types : [];
  if (list.includes('street_address')) return 100;
  if (list.includes('premise') || list.includes('subpremise')) return 96;
  if (list.includes('route') || list.includes('intersection')) return 92;
  if (list.includes('neighborhood')) return 84;
  if (list.includes('sublocality_level_1') || list.includes('sublocality')) return 78;
  if (list.includes('sublocality_level_2') || list.includes('sublocality_level_3')) return 74;
  if (list.includes('point_of_interest') || list.includes('establishment')) return 70;
  if (list.includes('locality') || list.includes('postal_town')) return 42;
  if (list.includes('administrative_area_level_3')) return 34;
  if (list.includes('administrative_area_level_2')) return 24;
  if (list.includes('administrative_area_level_1')) return 12;
  if (list.includes('country')) return 4;
  return 30;
}

export function formatExactCoordinateLabel(point: RoutePoint) {
  return `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`;
}

/** True only for street / neighborhood / place precision — not wilaya/city-only. */
export function isStreetLevelPrecision(types: string[] | undefined) {
  return scoreGeocodePrecision(types) >= 70;
}

export function hasStreetLevelComponents(addressComponents?: AddressComponent[] | null) {
  const components = Array.isArray(addressComponents) ? addressComponents : [];
  return Boolean(
    componentValue(components, 'route') ||
      componentValue(components, 'premise') ||
      componentValue(components, 'subpremise') ||
      componentValue(components, 'neighborhood') ||
      componentValue(components, 'sublocality_level_1') ||
      componentValue(components, 'sublocality') ||
      componentValue(components, 'street_number')
  );
}

const ROAD_NAME_PATTERN =
  /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|close|way|highway|hwy\.?)\b/i;

function looksLikeAdminName(
  value: string,
  locality: string,
  district: string,
  region: string
) {
  const lower = value.toLowerCase();
  return [locality, district, region].some((part) => part && part.toLowerCase() === lower);
}

/** Pull a street/road segment from formatted address when components omit route. */
function extractRoadFromFormattedAddress(
  formatted: string,
  locality: string,
  district: string,
  region: string,
  preferAnyFirstSegment: boolean
) {
  const parts = String(formatted || '')
    .split(',')
    .map((part) => cleanPlacePart(part))
    .filter(Boolean);
  if (!parts.length) {
    return '';
  }

  const first = parts[0];
  if (looksLikeAdminName(first, locality, district, region)) {
    return '';
  }
  if (ROAD_NAME_PATTERN.test(first) || preferAnyFirstSegment) {
    return first;
  }
  return '';
}

/**
 * Prefer street / road names (e.g. Bulale Street) over district/wilaya (Nyamagana).
 * Order: street → road → neighborhood → locality → district last.
 */
export function buildGooglePlaceLabel(params: {
  displayName?: string | null;
  formattedAddress?: string | null;
  addressComponents?: AddressComponent[] | null;
  fallbackName?: string | null;
  fallbackAddress?: string | null;
  resultTypes?: string[] | null;
}) {
  const components = Array.isArray(params.addressComponents) ? params.addressComponents : [];
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
  // Keep city and district separate — district must never win as the primary label.
  const locality = componentValues(components, ['locality', 'postal_town']);
  const district = componentValue(components, 'administrative_area_level_2');
  const region = componentValue(components, 'administrative_area_level_1');
  const streetNumber = componentValue(components, 'street_number');
  const resultTypes = Array.isArray(params.resultTypes) ? params.resultTypes : [];
  const prefersRoute = resultTypes.some((type) =>
    ['route', 'street_address', 'intersection', 'premise', 'subpremise'].includes(type)
  );
  const formatted = String(params.formattedAddress || params.fallbackAddress || '');
  const roadFromFormatted = extractRoadFromFormattedAddress(
    formatted,
    locality,
    district,
    region,
    prefersRoute
  );
  const streetLine = [streetNumber, route || roadFromFormatted].filter(Boolean).join(' ');

  const displayName = cleanPlacePart(params.displayName);
  const fallbackName = cleanPlacePart(params.fallbackName);
  const displayLooksBroad =
    !displayName ||
    looksLikeAdminName(displayName, locality, district, region) ||
    resultTypes.some((type) => BROAD_AREA_TYPES.has(type));
  const fallbackLooksBroad =
    !fallbackName || looksLikeAdminName(fallbackName, locality, district, region);

  // Street-first: Bulale Street before Nyamagana / Mwanza.
  const primary =
    premise ||
    streetLine ||
    neighborhood ||
    (!displayLooksBroad ? displayName : '') ||
    (!fallbackLooksBroad ? fallbackName : '');

  const areaHint = locality || district;

  if (primary) {
    const secondaryParts = uniquePlaceParts(
      [
        primary === streetLine ? '' : streetLine,
        primary === neighborhood ? '' : neighborhood,
        areaHint,
      ],
      2
    );
    return buildPlaceLabel([primary, ...secondaryParts], '');
  }

  // No street/road: locality (city) before district (wilaya).
  if (locality && region && locality.toLowerCase() !== region.toLowerCase()) {
    return buildPlaceLabel([locality, region], '');
  }
  if (locality) {
    return locality;
  }
  if (district && region && district.toLowerCase() !== region.toLowerCase()) {
    return buildPlaceLabel([district, region], '');
  }
  if (district) {
    return district;
  }

  const fromFormatted = uniquePlaceParts(
    formatted.split(',').map((part) => cleanPlacePart(part)),
    2
  );
  if (fromFormatted.length >= 1) {
    return fromFormatted.join(', ');
  }

  return '';
}

/** Higher = more street-like. Used when racing reverse-geocode providers. */
export function scorePlaceLabelPrecision(label?: string | null, types?: string[] | null) {
  const typeScore = scoreGeocodePrecision(types ?? undefined);
  const text = String(label ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text || isCoordinateLikeLabel(text) || isWeakPlaceName(text)) {
    return 0;
  }

  let textScore = 28;
  if (ROAD_NAME_PATTERN.test(text)) {
    textScore = 94;
  } else if (/,/.test(text)) {
    const first = text.split(',')[0]?.trim() || '';
    if (first && first.split(/\s+/).length <= 5) {
      // "Bulale, Nyamagana" without Street keyword still beats bare district.
      textScore = ROAD_NAME_PATTERN.test(first) ? 94 : 72;
    }
  }

  // Single-token district/city names score low.
  if (!/,/.test(text) && !ROAD_NAME_PATTERN.test(text) && text.split(/\s+/).length <= 2) {
    textScore = Math.min(textScore, 26);
  }

  return Math.max(typeScore, textScore);
}

export function sanitizeSuggestionPresentation(
  name: string,
  address?: string,
  fullText?: string,
  types?: string[] | null
) {
  const typeList = Array.isArray(types) ? types : [];
  const isStreetType = typeList.some((type) =>
    ['route', 'street_address', 'intersection', 'premise', 'subpremise'].includes(type)
  );
  const isNeighbourhoodType =
    !isStreetType &&
    typeList.some((type) =>
      ['neighborhood', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'sublocality_level_3'].includes(
        type
      )
    );

  const primaryCandidate = cleanPlacePart(name);
  const secondaryFromAddress = uniquePlaceParts(
    String(address || '')
      .split(',')
      .map((part) => cleanPlacePart(part)),
    2
  ).filter((part) => part.toLowerCase() !== primaryCandidate.toLowerCase());

  // Street/route: keep road name primary; area/city secondary. Never promote neighbourhood as a street.
  if (isStreetType && primaryCandidate) {
    const secondary = secondaryFromAddress.slice(0, 2).join(', ');
    return {
      name: primaryCandidate,
      address: secondary,
      fullText: [primaryCandidate, secondary].filter(Boolean).join(', '),
      weak: false,
    };
  }

  if (isNeighbourhoodType && primaryCandidate) {
    const secondary = secondaryFromAddress.slice(0, 2).join(', ');
    return {
      name: primaryCandidate,
      address: secondary,
      fullText: [primaryCandidate, secondary].filter(Boolean).join(', '),
      weak: false,
    };
  }

  const cleanedParts = [name, address, fullText]
    .filter(Boolean)
    .flatMap((value) =>
      String(value)
        .split(',')
        .map((part) => cleanPlacePart(part))
        .filter(Boolean)
    );

  const unique = uniquePlaceParts(cleanedParts, 3);
  if (!unique.length) {
    return {
      name: 'Selected place',
      address: '',
      fullText: 'Selected place',
      weak: true,
    };
  }

  return {
    name: unique[0],
    address: unique.slice(1).join(', '),
    fullText: unique.join(', '),
    weak: false,
  };
}
