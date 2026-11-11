/** One forward-only order stage shared by the portal, the API, and the customer app. */

const RANK = { new: 0, verified: 1, in_transit: 2, delivered: 3 };
const NON_CUSTOMER_ACTORS = new Set(['dispatch', 'driver', 'company', 'carrier', 'agent', 'transporter']);

/** Same predicate as carrier-cancel.isCustomerCancelledRecord and the portal desk. */
function isCustomerCancelFacts(input) {
  if (!input || typeof input !== 'object') return false;
  const by = String(input.cancelledBy || input.canceledBy || '').trim().toLowerCase();
  const status = String(input.status || input.shipmentStatus || '').trim().toLowerCase();
  const stage = String(input.haulStage || '').trim().toLowerCase();
  const quote = String(input.quoteStatus || '').trim().toLowerCase();
  if (by === 'customer') return true;
  if (stage === 'cancelled' || stage === 'canceled') return true;
  if (quote === 'declined') return true;
  if (status === 'cancelled' || status === 'canceled') return !NON_CUSTOMER_ACTORS.has(by);
  return false;
}

function stageFromFacts(input) {
  if (isCustomerCancelFacts(input)) return 'cancelled';
  const status = String(input?.shipmentStatus || input?.status || '').toLowerCase();
  const step = String(input?.trackStep || input?.carrierTrackStep || '').toLowerCase();
  const named = String(input?.haulStage || '').toLowerCase();
  if (step === 'handed' || status === 'delivered' || named === 'delivered') return 'delivered';
  if (
    step === 'transit' ||
    step === 'arrived' ||
    status === 'in_transit' ||
    status === 'arrived' ||
    named === 'in_transit'
  ) {
    return 'in_transit';
  }
  if (
    named === 'verified' ||
    input?.carrierId ||
    ['accepted', 'contacted', 'pickup_scheduled', 'picked_up', 'at_bus'].includes(status) ||
    ['received', 'pickup', 'packed'].includes(step) ||
    String(input?.carrierMatchStatus || '') === 'accepted'
  ) {
    return 'verified';
  }
  if (named === 'new') return 'new';
  return 'new';
}

function forwardStage(current, incoming) {
  if (isCustomerCancelFacts(current) || isCustomerCancelFacts(incoming)) {
    const version = Math.max(0, Math.round(Number(current?.statusVersion) || 0));
    const already = String(current?.haulStage || '').toLowerCase() === 'cancelled';
    return {
      haulStage: 'cancelled',
      statusVersion: already ? version : version + 1,
      advanced: !already,
      rejectedRegression: false,
    };
  }
  const currentName = stageFromFacts(current || {});
  const incomingName = stageFromFacts(incoming || {});
  const currentRank = RANK[currentName] ?? 0;
  const incomingRank = RANK[incomingName] ?? 0;
  const haulStage = incomingRank >= currentRank ? incomingName : currentName;
  const version = Math.max(0, Math.round(Number(current?.statusVersion) || 0));
  const changed = haulStage !== currentName || version === 0;
  return {
    haulStage,
    statusVersion: changed ? version + 1 : version,
    advanced: haulStage !== currentName,
    rejectedRegression: incomingRank < currentRank,
  };
}

function trackStepForStage(haulStage, shipment) {
  if (haulStage === 'cancelled') return '';
  const step = String(shipment?.trackStep || '').trim();
  if (haulStage === 'delivered') return 'handed';
  if (haulStage === 'in_transit') return step === 'arrived' ? 'arrived' : 'transit';
  if (haulStage === 'verified') return step && !['transit', 'arrived', 'handed'].includes(step) ? step : 'received';
  return step;
}

module.exports = {
  RANK,
  forwardStage,
  isCustomerCancelFacts,
  stageFromFacts,
  trackStepForStage,
};
