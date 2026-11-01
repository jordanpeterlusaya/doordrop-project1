export function getRequestDriverHref(input: {
  driverId: string;
  driverName?: string;
  driverVehicleType?: string;
}) {
  const vehicle = String(input.driverVehicleType || '').toLowerCase();
  const isCargo = /toyo|kirikuu|canter|center|fuso|truck|van|pickup/.test(vehicle);

  return {
    pathname: (isCargo ? '/book-cargo' : '/send-parcel') as '/book-cargo' | '/send-parcel',
    params: {
      requestedDriverId: input.driverId,
      requestedDriverName: input.driverName || '',
      vehicle: isCargo ? (vehicle.includes('kirikuu') ? 'kirikuu' : vehicle.includes('electric') ? 'toyo_electric' : 'toyo') : '',
    },
  };
}
