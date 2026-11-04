/** One forward-only order stage shared by the portal, the API, and the customer app. */

const RANK = { new: 0, verified: 1, in_transit: 2, delivered: 3 };

function stageFromFacts(input) {
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
  const step = String(shipment?.trackStep || '').trim();
  if (haulStage === 'delivered') return 'handed';
  if (haulStage === 'in_transit') return step === 'arrived' ? 'arrived' : 'transit';
  if (haulStage === 'verified') return step && !['transit', 'arrived', 'handed'].includes(step) ? step : 'received';
  return step;
}

module.exports = {
  RANK,
  forwardStage,
  stageFromFacts,
  trackStepForStage,
};
