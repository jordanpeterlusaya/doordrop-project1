const OFFERED_VEHICLE_TYPES = ['bodaboda', 'toyo_electric', 'toyo', 'kirikuu'];
const SUPPORTED_VEHICLE_TYPES = [...OFFERED_VEHICLE_TYPES, 'canter'];
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

function optionalEnvNumber(key, fallback) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Toyo Electric only — linear fare on chargeable distance (once):
 * Fare = Base + Distance × (Profit/km + Time Cost/km + Energy Cost/km)
 * Optional env overrides when set (same numeric-env pattern as other backend fees).
 */
const TOYO_ELECTRIC_RATES = {
  baseFare: optionalEnvNumber('TOYO_ELECTRIC_BASE_FARE_TZS', 5000),
  profitPerKm: optionalEnvNumber('TOYO_ELECTRIC_PROFIT_PER_KM_TZS', 1000),
  timeCostPerKm: optionalEnvNumber('TOYO_ELECTRIC_TIME_COST_PER_KM_TZS', 100),
  energyCostPerKm: optionalEnvNumber('TOYO_ELECTRIC_ENERGY_COST_PER_KM_TZS', 100),
};

function toyoElectricVariablePerKm(rates = TOYO_ELECTRIC_RATES) {
  return rates.profitPerKm + rates.timeCostPerKm + rates.energyCostPerKm;
}

/**
 * Fuel tuk-tuk (TOYO) and Kirikuu.
 * Formula A when round-trip km ≤ 39; Formula B when round-trip km > 39.
 * Gap at 19–20 is closed: ≤19 uses 2,080/km; >19 and ≤39 uses 1,780/km.
 */
const FUEL_TUKTUK_RATES = {
  baseFare: 5000,
  formulaAShortMaxRoundTripKm: 19,
  formulaAMediumMaxRoundTripKm: 39,
  formulaAShortRatePerKm: 2080,
  formulaAMediumRatePerKm: 1780,
  fuelPricePerLitre: 4100,
  fuelEfficiencyKmPerLitre: 6.5,
  timeCostPerMinute: 210,
  profitPerKm: 500,
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
    toyo_electric: 'toyo_electric',
    'toyo-electric': 'toyo_electric',
    toyoelectric: 'toyo_electric',
    electric_toyo: 'toyo_electric',
    toyo: 'toyo',
    bajaj: 'toyo',
    bajaji: 'toyo',
    pickup: 'toyo',
    van: 'toyo',
    truck: 'toyo',
    toyo_xl: 'toyo',
    'toyo-xl': 'toyo',
    kirikuu: 'kirikuu',
    canter: 'canter',
    center: 'canter',
    fuso: 'canter',
  };
  const canonical = aliases[normalized];

  if (!canonical) {
    throw new Error(`Unsupported vehicle type "${vehicleType}". Use bodaboda, toyo_electric, toyo, kirikuu, or canter.`);
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

/** Payable cash: nearest 100 TZS (15527 → 15500, 2650 → 2700). */
function roundPayableTzs(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.max(100, Math.round(numeric / 100) * 100);
}

/** @deprecated Prefer roundPayableTzs — same nearest-100 payable rounding. */
function roundToCustomerFare(amount) {
  return roundPayableTzs(amount);
}

/** Whole shillings only — internal/raw; customer-facing fares use roundPayableTzs. */
function roundWholeTzs(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric);
}

function applyInCityParcelDistanceReduction(amount, vehicleType, distanceKm, pricingScope) {
  if (
    pricingScope !== 'city-parcel' ||
    !isBodabodaVehicle(vehicleType) ||
    distanceKm < IN_CITY_PARCEL_REDUCTION_MIN_DISTANCE_KM
  ) {
    return amount;
  }

  return amount * IN_CITY_PARCEL_REDUCTION_MULTIPLIER;
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

function isToyoElectric(vehicleType) {
  return vehicleType === 'toyo_electric';
}

function isFuelTuktuk(vehicleType) {
  return vehicleType === 'toyo' || vehicleType === 'kirikuu';
}

function safePositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * Resolve one-way vs round-trip inputs.
 * Routing normally supplies one-way distance/time; multiply by 2 unless alreadyRoundTrip.
 */
function resolveRoundTripMetrics({ distanceKm, durationMinutes, alreadyRoundTrip }) {
  const oneWayKm = safePositiveNumber(distanceKm, 0);
  const oneWayMinutes = safePositiveNumber(durationMinutes, 0);
  const isRoundTrip = Boolean(alreadyRoundTrip);
  return {
    oneWayKm,
    oneWayMinutes,
    totalDistanceKm: isRoundTrip ? oneWayKm : oneWayKm * 2,
    totalTimeMinutes: isRoundTrip ? oneWayMinutes : oneWayMinutes * 2,
    alreadyRoundTrip: isRoundTrip,
  };
}

function estimateMinutesFromDistanceKm(distanceKm) {
  // ~25 km/h urban fallback when routing did not return a duration.
  const km = safePositiveNumber(distanceKm, 0);
  if (km <= 0) return 0;
  return (km / 25) * 60;
}

function calculateToyoElectricFare({ distanceKm, durationMinutes, alreadyRoundTrip }) {
  const normalizedDistanceKm = Number(distanceKm);
  if (!Number.isFinite(normalizedDistanceKm) || normalizedDistanceKm < 0) {
    throw new Error(`Invalid distanceKm "${distanceKm}". Expected a finite number >= 0.`);
  }

  let minutes = safePositiveNumber(durationMinutes, 0);
  if (minutes <= 0 && normalizedDistanceKm > 0) {
    minutes = estimateMinutesFromDistanceKm(normalizedDistanceKm);
  }
  // Chargeable distance once: double one-way unless caller already passed round-trip km.
  const trip = resolveRoundTripMetrics({
    distanceKm: normalizedDistanceKm,
    durationMinutes: minutes,
    alreadyRoundTrip,
  });
  const rates = TOYO_ELECTRIC_RATES;
  const ratePerKm = toyoElectricVariablePerKm(rates);
  const d = trip.totalDistanceKm;
  const profit = d * rates.profitPerKm;
  const timeCost = d * rates.timeCostPerKm;
  const energyCost = d * rates.energyCostPerKm;
  const distanceCost = profit + timeCost + energyCost;
  const rawPrice = rates.baseFare + distanceCost;

  return {
    formula: 'toyo_electric_linear',
    ...trip,
    baseFare: rates.baseFare,
    profit: Number(profit.toFixed(4)),
    timeCost: Number(timeCost.toFixed(4)),
    energyCost: Number(energyCost.toFixed(4)),
    distanceCost: Number(distanceCost.toFixed(4)),
    ratePerKm,
    rawPrice,
    estimatedPrice: roundPayableTzs(rawPrice),
    rates: { ...rates },
  };
}

function calculateFuelTuktukFare({ distanceKm, durationMinutes, alreadyRoundTrip }) {
  let minutes = safePositiveNumber(durationMinutes, 0);
  if (minutes <= 0 && safePositiveNumber(distanceKm, 0) > 0) {
    minutes = estimateMinutesFromDistanceKm(distanceKm);
  }
  const trip = resolveRoundTripMetrics({
    distanceKm,
    durationMinutes: minutes,
    alreadyRoundTrip,
  });
  const rt = trip.totalDistanceKm;
  const rates = FUEL_TUKTUK_RATES;

  if (rt <= rates.formulaAMediumMaxRoundTripKm) {
    const ratePerKm =
      rt <= rates.formulaAShortMaxRoundTripKm ? rates.formulaAShortRatePerKm : rates.formulaAMediumRatePerKm;
    const distanceCost = rt * ratePerKm;
    const rawPrice = distanceCost + rates.baseFare;
    return {
      formula: rt <= rates.formulaAShortMaxRoundTripKm ? 'fuel_tuktuk_a_short' : 'fuel_tuktuk_a_medium',
      ...trip,
      ratePerKm,
      baseFare: rates.baseFare,
      distanceCost: Number(distanceCost.toFixed(4)),
      fuelCost: 0,
      timeCost: 0,
      profit: 0,
      rawPrice,
      estimatedPrice: roundPayableTzs(rawPrice),
      rates: { ...rates },
    };
  }

  // Formula B — round-trip distance & time (same units as Formula A threshold).
  const fuelCost = (rt / rates.fuelEfficiencyKmPerLitre) * rates.fuelPricePerLitre;
  const timeCost = trip.totalTimeMinutes * rates.timeCostPerMinute;
  const profit = rt * rates.profitPerKm;
  const rawPrice = fuelCost + timeCost + profit;

  return {
    formula: 'fuel_tuktuk_b_long',
    ...trip,
    ratePerKm: null,
    baseFare: 0,
    distanceCost: 0,
    fuelCost: Number(fuelCost.toFixed(4)),
    timeCost: Number(timeCost.toFixed(4)),
    profit: Number(profit.toFixed(4)),
    rawPrice,
    estimatedPrice: roundPayableTzs(rawPrice),
    rates: { ...rates },
  };
}

function calculateEstimatedPrice({
  distanceMeters,
  vehicleType,
  pricingTable,
  cargoSize,
  pricingScope,
  durationSeconds,
  durationMinutes,
  alreadyRoundTrip,
  tripIsRoundTrip,
}) {
  const normalizedVehicleType = normalizeVehicleType(vehicleType);
  const normalizedCargoSize = normalizeCargoSize(cargoSize);
  const normalizedPricingScope = normalizePricingScope(pricingScope);

  if (isBodabodaVehicle(normalizedVehicleType) && normalizedCargoSize) {
    throw new Error('Bodaboda pricing does not accept cargo size.');
  }

  // New tuk-tuk formulas ignore load size. Legacy canter still requires it when provided path uses size extras.
  if (
    !isBodabodaVehicle(normalizedVehicleType) &&
    !isToyoElectric(normalizedVehicleType) &&
    !isFuelTuktuk(normalizedVehicleType) &&
    !normalizedCargoSize
  ) {
    throw new Error('Cargo vehicle pricing requires cargo size: small, half, full, or overload.');
  }

  const distanceKm = Math.max(0, Number(distanceMeters) / 1000);
  const minutesFromSeconds =
    Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0
      ? Number(durationSeconds) / 60
      : 0;
  const minutes =
    Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
      ? Number(durationMinutes)
      : minutesFromSeconds;
  const roundTripFlag = Boolean(alreadyRoundTrip || tripIsRoundTrip);

  // Formula vehicles are priced from fixed rates in this module — do not require pricingTable.
  if (isToyoElectric(normalizedVehicleType)) {
    const electric = calculateToyoElectricFare({
      distanceKm,
      durationMinutes: minutes,
      alreadyRoundTrip: roundTripFlag,
    });
    return {
      vehicleType: normalizedVehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      roundTripDistanceKm: Number(electric.totalDistanceKm.toFixed(2)),
      roundTripMinutes: Number(electric.totalTimeMinutes.toFixed(2)),
      baseFare: electric.baseFare,
      pricePerKm: electric.ratePerKm,
      timeBufferPerKm: 0,
      sizeExtraRatePerKm: 0,
      minimumFare: 0,
      rawPrice: Math.round(electric.rawPrice),
      adjustedRawPrice: electric.estimatedPrice,
      estimatedPrice: electric.estimatedPrice,
      currency: 'TZS',
      cargoSize: normalizedCargoSize || 'small',
      cargoMultiplier: 1,
      pricingScope: normalizedPricingScope,
      formula: electric.formula,
      breakdown: {
        baseFare: electric.baseFare,
        profit: electric.profit,
        timeCost: electric.timeCost,
        energyCost: electric.energyCost,
        distanceCost: electric.distanceCost,
      },
    };
  }

  if (isFuelTuktuk(normalizedVehicleType)) {
    const fuel = calculateFuelTuktukFare({
      distanceKm,
      durationMinutes: minutes,
      alreadyRoundTrip: roundTripFlag,
    });
    return {
      vehicleType: normalizedVehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      roundTripDistanceKm: Number(fuel.totalDistanceKm.toFixed(2)),
      roundTripMinutes: Number(fuel.totalTimeMinutes.toFixed(2)),
      baseFare: fuel.baseFare || 0,
      pricePerKm: fuel.ratePerKm,
      timeBufferPerKm: 0,
      sizeExtraRatePerKm: 0,
      minimumFare: 0,
      rawPrice: Math.round(fuel.rawPrice),
      adjustedRawPrice: fuel.estimatedPrice,
      estimatedPrice: fuel.estimatedPrice,
      currency: 'TZS',
      cargoSize: normalizedCargoSize || 'small',
      cargoMultiplier: 1,
      pricingScope: normalizedPricingScope,
      formula: fuel.formula,
      breakdown: {
        distanceCost: fuel.distanceCost,
        fuelCost: fuel.fuelCost,
        timeCost: fuel.timeCost,
        profit: fuel.profit,
        baseFare: fuel.baseFare || 0,
      },
    };
  }

  const table = pricingTable && typeof pricingTable === 'object' ? pricingTable : null;
  const pricing =
    (table &&
      (table[normalizedVehicleType] ||
        (normalizedVehicleType === 'bodaboda' ? table.pikipiki || table.boda : null))) ||
    null;

  if (!pricing) {
    throw new Error(`Pricing config missing for vehicle type "${normalizedVehicleType}".`);
  }

  if (isBodabodaVehicle(normalizedVehicleType)) {
    const standardPrice = calculatePikipikiParcelFare(distanceKm);
    const estimatedPrice = roundToCustomerFare(
      applyInCityParcelDistanceReduction(
        standardPrice,
        normalizedVehicleType,
        distanceKm,
        normalizedPricingScope
      )
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
      formula: 'bodaboda_parcel',
    };
  }

  // Legacy canter (and any remaining size-based cargo) — unchanged path.
  const sizeExtraRatePerKm =
    pricing.sizeExtraRatePerKm?.[normalizedCargoSize] ?? CARGO_SIZE_EXTRA_RATES[normalizedCargoSize] ?? 0;
  const timeBufferPerKm = pricing.timeBufferPerKm || 0;
  const rawPrice =
    pricing.baseFare +
    distanceKm * pricing.pricePerKm +
    distanceKm * timeBufferPerKm +
    distanceKm * sizeExtraRatePerKm;
  const minimumApplied = Math.max(rawPrice, pricing.minimumFare);
  const finalPrice = roundToCustomerFare(minimumApplied);

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
    cargoSize: normalizedCargoSize,
    cargoMultiplier: 1,
    pricingScope: normalizedPricingScope,
    formula: 'legacy_size_cargo',
  };
}

module.exports = {
  CARGO_SIZE_EXTRA_RATES,
  FUEL_TUKTUK_RATES,
  PIKIPIKI_PARCEL_PRICING,
  TOYO_ELECTRIC_RATES,
  OFFERED_VEHICLE_TYPES,
  SUPPORTED_CARGO_SIZES,
  SUPPORTED_VEHICLE_TYPES,
  calculateEstimatedPrice,
  calculateFuelTuktukFare,
  calculatePikipikiParcelFare,
  calculateToyoElectricFare,
  normalizeCargoSize,
  normalizePricingScope,
  normalizeVehicleType,
  roundPayableTzs,
  roundToCustomerFare,
  roundWholeTzs,
  toyoElectricVariablePerKm,
};
