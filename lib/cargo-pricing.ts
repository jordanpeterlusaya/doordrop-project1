export const CARGO_SIZE_EXTRA_RATES = {
  small: 0,
  half: 600,
  full: 1200,
  overload: 2400,
} as const;

export type CargoSize = keyof typeof CARGO_SIZE_EXTRA_RATES;
export type DoorDropVehicleType = 'bodaboda' | 'pikipiki' | 'boda' | 'motorcycle' | 'motorbike' | 'toyo' | 'kirikuu';
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

export const DOORDROP_PRICING_CONFIG = {
  bodaboda: PIKIPIKI_PARCEL_PRICING,
  pikipiki: PIKIPIKI_PARCEL_PRICING,
  motorcycle: PIKIPIKI_PARCEL_PRICING,
  motorbike: PIKIPIKI_PARCEL_PRICING,
  boda: PIKIPIKI_PARCEL_PRICING,
  toyo: {
    baseFare: 5000,
    pricePerKm: 1800,
    timeBufferPerKm: 0,
    minimumFare: 5000,
    sizeExtraRatePerKm: {
      small: 0,
      half: 600,
      full: 1200,
      overload: 2400,
    },
  },
  kirikuu: {
    baseFare: 5200,
    pricePerKm: 2200,
    timeBufferPerKm: 0,
    minimumFare: 8000,
    sizeExtraRatePerKm: {
      small: 0,
      half: 800,
      full: 1600,
      overload: 3000,
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

function isBodabodaVehicle(vehicleType: DoorDropVehicleType) {
  return normalizeDoorDropVehicleType(vehicleType) === 'bodaboda';
}

function roundUpToNearestFiveHundred(amount: number) {
  return Math.ceil(amount / 500) * 500;
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

  return Math.round(amount * IN_CITY_PARCEL_REDUCTION_MULTIPLIER);
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

export function buildFrontendPricingEstimate(input: {
  distanceMeters: number;
  vehicleType: DoorDropVehicleType;
  cargoSize?: CargoSize | null;
  pricingScope?: DoorDropPricingScope;
}) {
  const distanceMeters = Number(input.distanceMeters);
  const distanceKm = Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters / 1000 : 0;
  const vehicleType = normalizeDoorDropVehicleType(input.vehicleType);
  const pricing = DOORDROP_PRICING_CONFIG[vehicleType];
  const cargoSize = isBodabodaVehicle(vehicleType) ? null : input.cargoSize ?? 'small';

  if (isBodabodaVehicle(vehicleType)) {
    const standardPrice = calculatePikipikiParcelFare(distanceKm);
    const estimatedPrice = applyInCityParcelDistanceReduction(standardPrice, vehicleType, distanceKm, input.pricingScope);

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
  const estimatedPrice = roundUpToNearestFiveHundred(minimumApplied);

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
    source: 'frontend-fallback' as const,
  };
}

export function buildFrontendPricingEstimates(
  distanceMeters: number,
  vehicleTypes: DoorDropVehicleType[],
  cargoSize?: CargoSize | null,
  pricingScope?: DoorDropPricingScope
) {
  return Object.fromEntries(
    vehicleTypes.map((vehicleType) => [
      vehicleType,
      buildFrontendPricingEstimate({
        distanceMeters,
        vehicleType,
        cargoSize,
        pricingScope,
      }),
    ])
  ) as Record<DoorDropVehicleType, ReturnType<typeof buildFrontendPricingEstimate>>;
}

type CalculateCargoPriceInput = {
  distance_km: number;
  cargo_size: CargoSize;
  vehicle_type?: Extract<DoorDropVehicleType, 'toyo' | 'kirikuu'>;
};

export function calculateCargoPrice({
  distance_km,
  cargo_size,
  vehicle_type = 'toyo',
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
  }).estimatedPrice;
}
