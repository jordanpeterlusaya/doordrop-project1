export const CARGO_SIZE_EXTRA_RATES = {
  small: 0,
  half: 600,
  full: 1200,
  overload: 2400,
} as const;

export type CargoSize = keyof typeof CARGO_SIZE_EXTRA_RATES;
export type DoorDropVehicleType =
  | 'bodaboda'
  | 'pikipiki'
  | 'boda'
  | 'motorcycle'
  | 'motorbike'
  | 'toyo_electric'
  | 'toyo'
  | 'kirikuu'
  | 'canter'
  | 'center';
export type DoorDropPricingScope = 'city' | 'city-parcel' | 'outside';
const IN_CITY_PARCEL_REDUCTION_MIN_DISTANCE_KM = 4;
const IN_CITY_PARCEL_REDUCTION_MULTIPLIER = 0.8;

const PIKIPIKI_PARCEL_PRICING = {
  baseFare: 1200,
  pricePerKm: 450,
  extraDistanceRatePerKm: 650,
  timeBufferPerKm: 0,
  minimumFare: 1200,
  sizeExtraRatePerKm: null,
} as const;

/**
 * Toyo Electric only — linear fare on chargeable distance (once):
 * Fare = Base + Distance × (Profit/km + Time Cost/km + Energy Cost/km)
 */
export const TOYO_ELECTRIC_RATES = {
  baseFare: 5000,
  profitPerKm: 1000,
  timeCostPerKm: 100,
  energyCostPerKm: 100,
} as const;

export function toyoElectricVariablePerKm(
  rates: typeof TOYO_ELECTRIC_RATES = TOYO_ELECTRIC_RATES
) {
  return rates.profitPerKm + rates.timeCostPerKm + rates.energyCostPerKm;
}

/** Fuel TOYO + Kirikuu. Formula A ≤ 39 km RT; Formula B above that. */
export const FUEL_TUKTUK_RATES = {
  baseFare: 5000,
  formulaAShortMaxRoundTripKm: 19,
  formulaAMediumMaxRoundTripKm: 39,
  formulaAShortRatePerKm: 2080,
  formulaAMediumRatePerKm: 1780,
  fuelPricePerLitre: 4100,
  fuelEfficiencyKmPerLitre: 6.5,
  timeCostPerMinute: 210,
  profitPerKm: 500,
} as const;

export const DOORDROP_PRICING_CONFIG = {
  bodaboda: PIKIPIKI_PARCEL_PRICING,
  pikipiki: PIKIPIKI_PARCEL_PRICING,
  motorcycle: PIKIPIKI_PARCEL_PRICING,
  motorbike: PIKIPIKI_PARCEL_PRICING,
  boda: PIKIPIKI_PARCEL_PRICING,
  toyo_electric: {
    baseFare: TOYO_ELECTRIC_RATES.baseFare,
    pricePerKm: toyoElectricVariablePerKm(),
    timeBufferPerKm: 0,
    minimumFare: 0,
    sizeExtraRatePerKm: {
      small: 0,
      half: 0,
      full: 0,
      overload: 0,
    },
  },
  toyo: {
    baseFare: FUEL_TUKTUK_RATES.baseFare,
    pricePerKm: FUEL_TUKTUK_RATES.formulaAShortRatePerKm,
    timeBufferPerKm: 0,
    minimumFare: 0,
    sizeExtraRatePerKm: {
      small: 0,
      half: 0,
      full: 0,
      overload: 0,
    },
  },
  kirikuu: {
    baseFare: FUEL_TUKTUK_RATES.baseFare,
    pricePerKm: FUEL_TUKTUK_RATES.formulaAShortRatePerKm,
    timeBufferPerKm: 0,
    minimumFare: 0,
    sizeExtraRatePerKm: {
      small: 0,
      half: 0,
      full: 0,
      overload: 0,
    },
  },
  canter: {
    baseFare: 8000,
    pricePerKm: 2500,
    timeBufferPerKm: 0,
    minimumFare: 12000,
    sizeExtraRatePerKm: {
      small: 0,
      half: 1000,
      full: 2000,
      overload: 4000,
    },
  },
  center: {
    baseFare: 8000,
    pricePerKm: 2500,
    timeBufferPerKm: 0,
    minimumFare: 12000,
    sizeExtraRatePerKm: {
      small: 0,
      half: 1000,
      full: 2000,
      overload: 4000,
    },
  },
} as const;

export function normalizeDoorDropVehicleType(vehicleType: DoorDropVehicleType | string): DoorDropVehicleType {
  const normalized = String(vehicleType || '').trim().toLowerCase();
  const aliases: Record<string, DoorDropVehicleType> = {
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
    throw new Error(
      `Unsupported vehicle type "${vehicleType}". Use bodaboda, toyo_electric, toyo, kirikuu, or canter.`
    );
  }

  return canonical;
}

function isBodabodaVehicle(vehicleType: DoorDropVehicleType) {
  return normalizeDoorDropVehicleType(vehicleType) === 'bodaboda';
}

function isToyoElectric(vehicleType: DoorDropVehicleType) {
  return normalizeDoorDropVehicleType(vehicleType) === 'toyo_electric';
}

function isFuelTuktuk(vehicleType: DoorDropVehicleType) {
  const key = normalizeDoorDropVehicleType(vehicleType);
  return key === 'toyo' || key === 'kirikuu';
}

/** Payable cash: nearest 100 TZS (15527 → 15500, 2650 → 2700). */
export function roundPayableTzs(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Math.max(100, Math.round(amount / 100) * 100);
}

/** @deprecated Prefer roundPayableTzs — same nearest-100 payable rounding. */
export function roundToCustomerFare(amount: number) {
  return roundPayableTzs(amount);
}

function applyInCityParcelDistanceReduction(
  amount: number,
  vehicleType: DoorDropVehicleType,
  distanceKm: number,
  pricingScope?: DoorDropPricingScope
) {
  if (
    pricingScope !== 'city-parcel' ||
    !isBodabodaVehicle(vehicleType) ||
    distanceKm < IN_CITY_PARCEL_REDUCTION_MIN_DISTANCE_KM
  ) {
    return amount;
  }

  return amount * IN_CITY_PARCEL_REDUCTION_MULTIPLIER;
}

export function calculatePikipikiParcelFare(distanceKm: number) {
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

function safePositive(value: number | undefined | null, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveRoundTrip(distanceKm: number, durationMinutes: number, alreadyRoundTrip?: boolean) {
  const oneWayKm = safePositive(distanceKm);
  const oneWayMinutes = safePositive(durationMinutes);
  const isRt = Boolean(alreadyRoundTrip);
  return {
    totalDistanceKm: isRt ? oneWayKm : oneWayKm * 2,
    totalTimeMinutes: isRt ? oneWayMinutes : oneWayMinutes * 2,
  };
}

function estimateMinutesFromDistanceKm(distanceKm: number) {
  const km = safePositive(distanceKm);
  if (km <= 0) return 0;
  return (km / 25) * 60;
}

function calculateToyoElectricFare(distanceKm: number, durationMinutes: number, alreadyRoundTrip?: boolean) {
  const normalizedDistanceKm = Number(distanceKm);
  if (!Number.isFinite(normalizedDistanceKm) || normalizedDistanceKm < 0) {
    throw new Error(`Invalid distanceKm "${distanceKm}". Expected a finite number >= 0.`);
  }

  let minutes = safePositive(durationMinutes);
  if (minutes <= 0) minutes = estimateMinutesFromDistanceKm(normalizedDistanceKm);
  // Chargeable distance once: double one-way unless caller already passed round-trip km.
  const trip = resolveRoundTrip(normalizedDistanceKm, minutes, alreadyRoundTrip);
  const rates = TOYO_ELECTRIC_RATES;
  const ratePerKm = toyoElectricVariablePerKm(rates);
  const d = trip.totalDistanceKm;
  const profit = d * rates.profitPerKm;
  const timeCost = d * rates.timeCostPerKm;
  const energyCost = d * rates.energyCostPerKm;
  const distanceCost = profit + timeCost + energyCost;
  const rawPrice = rates.baseFare + distanceCost;
  return {
    ...trip,
    ratePerKm,
    baseFare: rates.baseFare,
    rawPrice,
    estimatedPrice: roundPayableTzs(rawPrice),
    formula: 'toyo_electric_linear' as const,
    breakdown: { baseFare: rates.baseFare, profit, timeCost, energyCost, distanceCost },
  };
}

function calculateFuelTuktukFare(distanceKm: number, durationMinutes: number, alreadyRoundTrip?: boolean) {
  let minutes = safePositive(durationMinutes);
  if (minutes <= 0) minutes = estimateMinutesFromDistanceKm(distanceKm);
  const trip = resolveRoundTrip(distanceKm, minutes, alreadyRoundTrip);
  const rt = trip.totalDistanceKm;
  const rates = FUEL_TUKTUK_RATES;

  if (rt <= rates.formulaAMediumMaxRoundTripKm) {
    const ratePerKm =
      rt <= rates.formulaAShortMaxRoundTripKm ? rates.formulaAShortRatePerKm : rates.formulaAMediumRatePerKm;
    const rawPrice = rt * ratePerKm + rates.baseFare;
    return {
      ...trip,
      ratePerKm,
      baseFare: rates.baseFare,
      rawPrice,
      estimatedPrice: roundPayableTzs(rawPrice),
      formula:
        rt <= rates.formulaAShortMaxRoundTripKm
          ? ('fuel_tuktuk_a_short' as const)
          : ('fuel_tuktuk_a_medium' as const),
      breakdown: {
        distanceCost: rt * ratePerKm,
        fuelCost: 0,
        timeCost: 0,
        profit: 0,
        baseFare: rates.baseFare,
      },
    };
  }

  const fuelCost = (rt / rates.fuelEfficiencyKmPerLitre) * rates.fuelPricePerLitre;
  const timeCost = trip.totalTimeMinutes * rates.timeCostPerMinute;
  const profit = rt * rates.profitPerKm;
  const rawPrice = fuelCost + timeCost + profit;
  return {
    ...trip,
    ratePerKm: null as number | null,
    baseFare: 0,
    rawPrice,
    estimatedPrice: roundPayableTzs(rawPrice),
    formula: 'fuel_tuktuk_b_long' as const,
    breakdown: { distanceCost: 0, fuelCost, timeCost, profit, baseFare: 0 },
  };
}

export function buildFrontendPricingEstimate(input: {
  distanceMeters: number;
  vehicleType: DoorDropVehicleType;
  cargoSize?: CargoSize | null;
  pricingScope?: DoorDropPricingScope;
  durationSeconds?: number | null;
  durationMinutes?: number | null;
  alreadyRoundTrip?: boolean;
}) {
  const distanceMeters = Number(input.distanceMeters);
  const distanceKm = Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters / 1000 : 0;
  const vehicleType = normalizeDoorDropVehicleType(input.vehicleType);
  const pricing = DOORDROP_PRICING_CONFIG[vehicleType];
  const cargoSize = isBodabodaVehicle(vehicleType) ? null : input.cargoSize ?? 'small';
  const minutesFromSeconds =
    typeof input.durationSeconds === 'number' && input.durationSeconds > 0 ? input.durationSeconds / 60 : 0;
  const durationMinutes =
    typeof input.durationMinutes === 'number' && input.durationMinutes > 0
      ? input.durationMinutes
      : minutesFromSeconds;

  if (isBodabodaVehicle(vehicleType)) {
    const standardPrice = calculatePikipikiParcelFare(distanceKm);
    const estimatedPrice = roundPayableTzs(
      applyInCityParcelDistanceReduction(standardPrice, vehicleType, distanceKm, input.pricingScope)
    );

    return {
      vehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      estimatedPrice,
      currency: 'TZS',
      cargoSize,
      cargoMultiplier: 1,
      pricing: {
        baseFare: pricing.baseFare,
        pricePerKm: pricing.pricePerKm,
        timeBufferPerKm: pricing.timeBufferPerKm ?? 0,
        minimumFare: pricing.minimumFare,
        sizeExtraRatePerKm: 0,
        rawPrice: standardPrice,
        adjustedRawPrice: estimatedPrice,
      },
      formula: 'bodaboda_parcel',
      source: 'frontend-fallback' as const,
    };
  }

  if (isToyoElectric(vehicleType)) {
    const electric = calculateToyoElectricFare(distanceKm, durationMinutes, input.alreadyRoundTrip);
    return {
      vehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      estimatedPrice: electric.estimatedPrice,
      currency: 'TZS',
      cargoSize,
      cargoMultiplier: 1,
      pricing: {
        baseFare: electric.baseFare,
        pricePerKm: electric.ratePerKm,
        timeBufferPerKm: 0,
        minimumFare: 0,
        sizeExtraRatePerKm: 0,
        rawPrice: Math.round(electric.rawPrice),
        adjustedRawPrice: electric.estimatedPrice,
      },
      formula: electric.formula,
      source: 'frontend-fallback' as const,
    };
  }

  if (isFuelTuktuk(vehicleType)) {
    const fuel = calculateFuelTuktukFare(distanceKm, durationMinutes, input.alreadyRoundTrip);
    return {
      vehicleType,
      distanceKm: Number(distanceKm.toFixed(2)),
      estimatedPrice: fuel.estimatedPrice,
      currency: 'TZS',
      cargoSize,
      cargoMultiplier: 1,
      pricing: {
        baseFare: fuel.baseFare,
        pricePerKm: fuel.ratePerKm ?? 0,
        timeBufferPerKm: 0,
        minimumFare: 0,
        sizeExtraRatePerKm: 0,
        rawPrice: Math.round(fuel.rawPrice),
        adjustedRawPrice: fuel.estimatedPrice,
      },
      formula: fuel.formula,
      source: 'frontend-fallback' as const,
    };
  }

  const sizeExtraRatePerKm =
    cargoSize && pricing.sizeExtraRatePerKm ? pricing.sizeExtraRatePerKm[cargoSize] ?? 0 : 0;
  const timeBufferPerKm = pricing.timeBufferPerKm ?? 0;
  const rawPrice =
    pricing.baseFare +
    distanceKm * pricing.pricePerKm +
    distanceKm * timeBufferPerKm +
    distanceKm * sizeExtraRatePerKm;
  const minimumApplied = Math.max(rawPrice, pricing.minimumFare);
  const estimatedPrice = roundPayableTzs(minimumApplied);

  return {
    vehicleType,
    distanceKm: Number(distanceKm.toFixed(2)),
    estimatedPrice,
    currency: 'TZS',
    cargoSize,
    cargoMultiplier: 1,
    pricing: {
      baseFare: pricing.baseFare,
      pricePerKm: pricing.pricePerKm,
      timeBufferPerKm,
      minimumFare: pricing.minimumFare,
      sizeExtraRatePerKm,
      rawPrice: Math.round(rawPrice),
      adjustedRawPrice: estimatedPrice,
    },
    formula: 'legacy_size_cargo',
    source: 'frontend-fallback' as const,
  };
}

export function buildFrontendPricingEstimates(
  distanceMeters: number,
  vehicleTypes: DoorDropVehicleType[],
  cargoSize?: CargoSize | null,
  pricingScope?: DoorDropPricingScope,
  durationSeconds?: number | null
) {
  return Object.fromEntries(
    vehicleTypes.map((vehicleType) => [
      vehicleType,
      buildFrontendPricingEstimate({
        distanceMeters,
        vehicleType,
        cargoSize,
        pricingScope,
        durationSeconds,
      }),
    ])
  ) as Record<DoorDropVehicleType, ReturnType<typeof buildFrontendPricingEstimate>>;
}

type CalculateCargoPriceInput = {
  distance_km: number;
  cargo_size: CargoSize;
  vehicle_type?: Extract<DoorDropVehicleType, 'toyo_electric' | 'toyo' | 'kirikuu' | 'canter' | 'center'>;
  duration_minutes?: number;
};

export function calculateCargoPrice({
  distance_km,
  cargo_size,
  vehicle_type = 'toyo',
  duration_minutes,
}: CalculateCargoPriceInput) {
  const distanceKm = Number(distance_km);
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    // eslint-disable-next-line no-console
    console.error('calculateCargoPrice: invalid distance_km', distance_km);
    return 5000;
  }

  return buildFrontendPricingEstimate({
    distanceMeters: distanceKm * 1000,
    vehicleType: vehicle_type,
    cargoSize: cargo_size,
    durationMinutes: duration_minutes,
  }).estimatedPrice;
}

/** Distance-band cargo floor: 1–5 km = 5,000 TZS, then +5,000 each 5 km. Under 1 km still 5,000. */
export function minFareFromDistanceMeters(distanceMeters: number) {
  const meters = Number(distanceMeters);
  if (!Number.isFinite(meters) || meters <= 0) {
    return 5000;
  }
  const km = meters / 1000;
  if (km < 1) {
    return 5000;
  }
  return Math.max(1, Math.ceil(km / 5)) * 5000;
}

export function distanceKmFromMeters(distanceMeters: number) {
  const meters = Number(distanceMeters);
  if (!Number.isFinite(meters) || meters <= 0) {
    return 0;
  }
  return Math.round((meters / 1000) * 10) / 10;
}

/** Quiet suggested band from the old cargo algorithm — never a locked customer price. */
export function buildSuggestedFareRange(estimatedPrice: number) {
  const mid = roundPayableTzs(estimatedPrice);
  if (!mid) {
    return { suggestedFare: 0, min: 0, max: 0 };
  }

  const min = Math.max(1000, roundPayableTzs(mid * 0.85));
  const max = Math.max(min + 100, roundPayableTzs(mid * 1.15));
  return { suggestedFare: mid, min, max };
}
