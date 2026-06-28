const SUPPORTED_VEHICLE_TYPES = ['bodaboda', 'toyo', 'kirikuu'];
const SUPPORTED_CARGO_SIZES = ['small', 'half', 'full', 'overload'];
const CARGO_SIZE_EXTRA_RATES = {
  small: 0,
  half: 600,
  full: 1200,
  overload: 2400,
};
const IN_CITY_PARCEL_REDUCTION_MIN_DISTANCE_KM = 4;
const IN_CITY_PARCEL_REDUCTION_MULTIPLIER = 0.8;

const PIKIPIKI_PARCEL_PRICING = {
  baseFare: 1200,
  ratePerKm: 450,
  extraDistanceRatePerKm: 650,
  timeBufferPerKm: 0,
  minimumFare: 1200,
};

function normalizeVehicleType(vehicleType) {
  const normalized = String(vehicleType || '')
    .trim()
    .toLowerCase();
  const aliases = {
    bodaboda: 'bodaboda',
    boda: 'bodaboda',
    pikipiki: 'bodaboda',
    motorcycle: 'bodaboda',
    motorbike: 'bodaboda',
    bike: 'bodaboda',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    kirikuu: 'kirikuu',
  };
  const canonical = aliases[normalized];

  if (!canonical) {
    throw new Error(`Unsupported vehicle type "${vehicleType}". Use bodaboda, toyo, or kirikuu.`);
  }

  return canonical;
}

function normalizeCargoSize(cargoSize) {
  const normalized = String(cargoSize || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (!SUPPORTED_CARGO_SIZES.includes(normalized)) {
    throw new Error(`Unsupported cargo size "${cargoSize}". Use small, half, full, or overload.`);
  }

  return normalized;
}

function normalizePricingScope(pricingScope) {
  const normalized = String(pricingScope || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');

  if (!normalized) {
    return null;
  }

  if (['city-parcel', 'parcel-city', 'in-city-parcel', 'in-city-parcel-delivery', 'parcel'].includes(normalized)) {
    return 'city-parcel';
  }

  if (['city', 'in-city', 'inside-city', 'local'].includes(normalized)) {
    return 'city';
  }

  if (['outside', 'outside-city', 'intercity', 'inter-city'].includes(normalized)) {
    return 'outside';
  }

  return null;
}

function roundUpToNearestFiveHundred(amount) {
  return Math.ceil(amount / 500) * 500;
}

function applyInCityParcelDistanceReduction(amount, vehicleType, distanceKm, pricingScope) {
  if (
    pricingScope !== 'city-parcel' ||
    !isBodabodaVehicle(vehicleType) ||
    distanceKm < IN_CITY_PARCEL_REDUCTION_MIN_DISTANCE_KM
  ) {
    return amount;
  }

  return Math.round(amount * IN_CITY_PARCEL_REDUCTION_MULTIPLIER);
}

function calculatePikipikiParcelFare(distanceKm) {
  const normalizedDistanceKm = Number(distanceKm);
  const safeDistanceKm = Number.isFinite(normalizedDistanceKm) && normalizedDistanceKm > 0 ? normalizedDistanceKm : 0;

  if (safeDistanceKm <= 1) {
    return PIKIPIKI_PARCEL_PRICING.minimumFare;
  }

  if (safeDistanceKm <= 5) {
    return Math.round(1200 + 450 * (safeDistanceKm - 1));
  }

  return Math.round(3000 + 650 * (safeDistanceKm - 5));
}

function isBodabodaVehicle(vehicleType) {
  return vehicleType === 'bodaboda';
}

function calculateEstimatedPrice({ distanceMeters, vehicleType, pricingTable, cargoSize, pricingScope }) {
  const normalizedVehicleType = normalizeVehicleType(vehicleType);
  const normalizedCargoSize = normalizeCargoSize(cargoSize);
  const normalizedPricingScope = normalizePricingScope(pricingScope);
  const pricing = pricingTable[normalizedVehicleType] || (normalizedVehicleType === 'bodaboda' ? pricingTable.pikipiki || pricingTable.boda : null);

  if (!pricing) {
    throw new Error(`Pricing config missing for vehicle type "${normalizedVehicleType}".`);
  }

  if (isBodabodaVehicle(normalizedVehicleType) && normalizedCargoSize) {
    throw new Error('Bodaboda pricing does not accept cargo size.');
  }

  if (!isBodabodaVehicle(normalizedVehicleType) && !normalizedCargoSize) {
    throw new Error('Toyo and Kirikuu pricing require cargo size: small, half, full, or overload.');
  }

  const distanceKm = Math.max(0, Number(distanceMeters) / 1000);

  if (isBodabodaVehicle(normalizedVehicleType)) {
    const standardPrice = calculatePikipikiParcelFare(distanceKm);
    const estimatedPrice = applyInCityParcelDistanceReduction(
      standardPrice,
      normalizedVehicleType,
      distanceKm,
      normalizedPricingScope
    );

    return {
      vehicleType: normalizedVehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      baseFare: pricing.baseFare,
      pricePerKm: pricing.ratePerKm ?? pricing.pricePerKm,
      timeBufferPerKm: pricing.timeBufferPerKm || 0,
      sizeExtraRatePerKm: 0,
      minimumFare: pricing.minimumFare,
      rawPrice: standardPrice,
      adjustedRawPrice: estimatedPrice,
      estimatedPrice,
      currency: 'TZS',
      cargoSize: null,
      cargoMultiplier: 1,
      pricingScope: normalizedPricingScope,
    };
  }

  const sizeExtraRatePerKm =
    isBodabodaVehicle(normalizedVehicleType)
      ? 0
      : pricing.sizeExtraRatePerKm?.[normalizedCargoSize] ?? CARGO_SIZE_EXTRA_RATES[normalizedCargoSize] ?? 0;
  const timeBufferPerKm = pricing.timeBufferPerKm || 0;
  const rawPrice =
    pricing.baseFare +
    distanceKm * pricing.pricePerKm +
    distanceKm * timeBufferPerKm +
    distanceKm * sizeExtraRatePerKm;
  const minimumApplied = Math.max(rawPrice, pricing.minimumFare);
  const finalPrice = roundUpToNearestFiveHundred(minimumApplied);

  return {
    vehicleType: normalizedVehicleType,
    distanceKm: Number(distanceKm.toFixed(2)),
    baseFare: pricing.baseFare,
    pricePerKm: pricing.pricePerKm,
    timeBufferPerKm,
    sizeExtraRatePerKm,
    minimumFare: pricing.minimumFare,
    rawPrice: Math.round(rawPrice),
    adjustedRawPrice: finalPrice,
    estimatedPrice: finalPrice,
    currency: 'TZS',
    cargoSize: isBodabodaVehicle(normalizedVehicleType) ? null : normalizedCargoSize,
    cargoMultiplier: 1,
    pricingScope: normalizedPricingScope,
  };
}

module.exports = {
  CARGO_SIZE_EXTRA_RATES,
  PIKIPIKI_PARCEL_PRICING,
  SUPPORTED_CARGO_SIZES,
  SUPPORTED_VEHICLE_TYPES,
  calculateEstimatedPrice,
  calculatePikipikiParcelFare,
  normalizeCargoSize,
  normalizePricingScope,
  normalizeVehicleType,
};
