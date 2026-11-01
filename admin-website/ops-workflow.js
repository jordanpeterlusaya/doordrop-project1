/**
 * DoorDrop admin operations workflow engine.
 * Pure logic — no Firestore. Used by admin-website/app.js.
 */

export const DELIVERY_TYPES = {
  LOCAL: 'local',
  INTER_REGION: 'inter_region',
};

export const ATTENTION_PRIORITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  NORMAL: 'normal',
};

export const PRIORITY_META = {
  critical: { label: 'Critical', tone: 'danger', icon: '🔴' },
  high: { label: 'High', tone: 'warning', icon: '🟠' },
  medium: { label: 'Medium', tone: 'amber', icon: '🟡' },
  normal: { label: 'Normal', tone: 'success', icon: '🟢' },
};

/** Default SLA minutes per stage — overridable via settings.opsSla */
export const DEFAULT_OPS_SLA_MINUTES = {
  local: {
    pending_assignment: 30,
    driver_assigned: 45,
    driver_at_pickup: 30,
    in_transit: 120,
    at_hub: 60,
  },
  inter_region: {
    awaiting_dispatch: 120,
    first_mile_assigned: 180,
    awaiting_hub_intake: 60,
    received_at_hub: 240,
    in_transit_carrier: 720,
    arrived_destination: 120,
    out_for_delivery: 240,
  },
};

export const LOCAL_STAGES = [
  { id: 'pending_assignment', label: 'Waiting for rider', team: 'Dispatch' },
  { id: 'driver_assigned', label: 'Rider assigned', team: 'Rider' },
  { id: 'driver_at_pickup', label: 'At pickup', team: 'Rider' },
  { id: 'in_transit', label: 'In transit', team: 'Rider' },
  { id: 'at_hub', label: 'At hub', team: 'Operations' },
  { id: 'delivered', label: 'Delivered', team: 'System' },
  { id: 'cancelled', label: 'Cancelled', team: 'System' },
];

export const INTER_REGION_STAGES = [
  { id: 'order_created', label: 'Order created', team: 'System', logisticsStatus: null },
  { id: 'awaiting_dispatch', label: 'Pickup pending', team: 'Dispatch', logisticsStatus: 'awaiting_dispatch' },
  { id: 'first_mile_assigned', label: 'Picked up / collecting', team: 'Rider', logisticsStatus: 'first_mile_assigned' },
  { id: 'awaiting_hub_intake', label: 'At origin hub (intake)', team: 'Operations', logisticsStatus: 'awaiting_hub_intake' },
  { id: 'received_at_hub', label: 'Origin hub', team: 'Operations', logisticsStatus: 'received_at_hub' },
  { id: 'in_transit_carrier', label: 'In transit', team: 'Transport', logisticsStatus: 'in_transit_carrier' },
  { id: 'arrived_destination', label: 'Destination hub', team: 'Operations', logisticsStatus: 'arrived_destination' },
  { id: 'out_for_delivery', label: 'Out for delivery', team: 'Rider', logisticsStatus: 'out_for_delivery' },
  { id: 'completed', label: 'Received', team: 'System', logisticsStatus: 'completed' },
  { id: 'cancelled', label: 'Cancelled', team: 'System', logisticsStatus: 'cancelled' },
  { id: 'failed', label: 'Failed', team: 'Operations', logisticsStatus: 'failed' },
];

/** Same journey as customer track (bus/air) + local city steps */
export const SHIPMENT_LIFECYCLE = [
  { id: 'created', shortLabel: 'Created', label: 'Created', logisticsStatuses: [], localStatuses: [] },
  { id: 'confirmed', shortLabel: 'Confirmed', label: 'Confirmed', logisticsStatuses: ['awaiting_dispatch'], localStatuses: ['pending_assignment'] },
  { id: 'pickup', shortLabel: 'Collecting', label: 'Collecting', logisticsStatuses: ['first_mile_assigned', 'awaiting_hub_intake'], localStatuses: ['driver_assigned', 'driver_at_pickup'] },
  { id: 'origin_hub', shortLabel: 'At office', label: 'At office', logisticsStatuses: ['received_at_hub'], localStatuses: ['at_hub'] },
  { id: 'in_transit', shortLabel: 'In transit', label: 'In transit', logisticsStatuses: ['in_transit_carrier'], localStatuses: ['in_transit'] },
  { id: 'arrived', shortLabel: 'Arrived', label: 'Arrived', logisticsStatuses: ['arrived_destination', 'out_for_delivery'], localStatuses: [] },
  { id: 'received', shortLabel: 'Received', label: 'Received', logisticsStatuses: ['completed'], localStatuses: ['delivered'] },
];

export const OUTSIDE_ACTIVE_LOGISTICS_STATUSES = [
  'awaiting_dispatch',
  'first_mile_assigned',
  'awaiting_hub_intake',
  'received_at_hub',
  'in_transit_carrier',
  'arrived_destination',
  'out_for_delivery',
];

/** Ops queue pages → which stages they show */
export const OPS_QUEUE_PAGES = {
  myAttention: { title: 'My Attention', subtitle: 'Tasks that need your action now.', filter: 'attention' },
  overdue: { title: 'Overdue orders', subtitle: 'Orders that exceeded expected stage time.', filter: 'overdue' },
  opsExceptions: { title: 'Exceptions', subtitle: 'Stuck, failed, or critical shipments needing intervention.', filter: 'exceptions' },
  opsNew: { title: 'New orders', subtitle: 'Orders awaiting dispatch or confirmation.', stages: ['awaiting_dispatch'], deliveryType: 'inter_region' },
  opsPickups: { title: 'Pickups', subtitle: 'First-mile collection to origin office.', stages: ['first_mile_assigned'], deliveryType: 'inter_region' },
  opsOriginHub: { title: 'Origin hub', subtitle: 'Packages arriving and being received at origin office.', stages: ['awaiting_hub_intake'], deliveryType: 'inter_region' },
  opsTransport: { title: 'Transport', subtitle: 'At origin hub — ready for carrier handover.', stages: ['received_at_hub'], deliveryType: 'inter_region' },
  opsInTransit: { title: 'In transit', subtitle: 'Shipments moving with bus or air carrier.', filter: 'in_transit' },
  opsDestinationHub: { title: 'Destination hub', subtitle: 'Arrived in destination region.', stages: ['arrived_destination'], deliveryType: 'inter_region' },
  opsLastMile: { title: 'Last-mile', subtitle: 'Final delivery leg to recipient.', stages: ['out_for_delivery'], deliveryType: 'inter_region' },
  opsFinalDelivery: { title: 'Out for delivery', subtitle: 'Last-mile to recipient.', stages: ['out_for_delivery'], deliveryType: 'inter_region' },
  opsDelivered: { title: 'Received', subtitle: 'Parcels marked received — closed to History.', stages: ['completed'], deliveryType: 'inter_region' },
  opsFailed: { title: 'Failed & cancelled', subtitle: 'Problem orders needing follow-up.', stages: ['cancelled', 'failed'], deliveryType: 'any' },
  opsReturns: { title: 'Returns', subtitle: 'Return-to-sender and reversal shipments.', filter: 'returns' },
  shipmentPayments: { title: 'Shipment payments', subtitle: 'Payment status across active shipments.', filter: 'payments' },
  transportDesk: { title: 'Transport desk', subtitle: 'Carrier movements and delay management.', filter: 'transport' },
  opsRegions: { title: 'Regional view', subtitle: 'Active shipments by destination region.', filter: 'regions' },
  orderTimeline: { title: 'Order timeline', subtitle: 'Full chronological history for one order.', filter: 'timeline' },
};

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isOutsideParcelOrder(order) {
  if (!order) return false;
  if (normalize(order.parcelScope) === 'outside') return true;
  return Boolean(
    String(order.outsideDestinationCity || '').trim() ||
      String(order.outsideDestinationLabel || '').trim() ||
      String(order.outsideShippingMode || '').trim()
  );
}

export function getDeliveryType(order) {
  if (!order) return DELIVERY_TYPES.LOCAL;
  if (order.deliveryType === DELIVERY_TYPES.INTER_REGION || order.deliveryType === DELIVERY_TYPES.LOCAL) {
    return order.deliveryType;
  }
  return isOutsideParcelOrder(order) ? DELIVERY_TYPES.INTER_REGION : DELIVERY_TYPES.LOCAL;
}

export function getCurrentOpsStageId(order) {
  if (!order) return '';
  const type = getDeliveryType(order);
  if (type === DELIVERY_TYPES.INTER_REGION) {
    const logistics = normalize(order.logisticsStatus || 'awaiting_dispatch');
    if (logistics === 'cancelled' || normalize(order.status) === 'cancelled') return 'cancelled';
    if (logistics === 'failed') return 'failed';
    const match = INTER_REGION_STAGES.find((stage) => stage.logisticsStatus === logistics);
    return match?.id || logistics || 'awaiting_dispatch';
  }
  return normalize(order.status || 'pending_assignment') || 'pending_assignment';
}

export function getOpsStageLabel(stageId, deliveryType) {
  const stages = deliveryType === DELIVERY_TYPES.INTER_REGION ? INTER_REGION_STAGES : LOCAL_STAGES;
  return stages.find((stage) => stage.id === stageId)?.label || String(stageId || 'Unknown').replace(/_/g, ' ');
}

export function getResponsibleTeam(order) {
  const type = getDeliveryType(order);
  const stageId = getCurrentOpsStageId(order);
  const stages = type === DELIVERY_TYPES.INTER_REGION ? INTER_REGION_STAGES : LOCAL_STAGES;
  return stages.find((stage) => stage.id === stageId)?.team || 'Operations';
}

export function getSlaMinutes(order, stageId, slaOverrides = {}) {
  const type = getDeliveryType(order);
  const bucket = type === DELIVERY_TYPES.INTER_REGION ? 'inter_region' : 'local';
  const defaults = DEFAULT_OPS_SLA_MINUTES[bucket] || {};
  const custom = slaOverrides?.[bucket] || slaOverrides || {};
  const minutes = Number(custom[stageId] ?? defaults[stageId]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function getStageStartedAt(order, stageId) {
  const record = order?.opsStageRecords?.[stageId];
  if (record?.startedAt) return toMillis(record.startedAt);
  if (record?.completedAt) return toMillis(record.completedAt);

  const events = Array.isArray(order?.logisticsEvents) ? order.logisticsEvents : [];
  const stage = INTER_REGION_STAGES.find((item) => item.id === stageId);
  const logisticsKey = stage?.logisticsStatus || stageId;
  const event = [...events].reverse().find((item) => normalize(item.status) === normalize(logisticsKey));
  if (event?.at) return toMillis(event.at);

  if (stageId === 'order_created' || stageId === 'pending_assignment' || stageId === 'awaiting_dispatch') {
    return toMillis(order?.createdAt);
  }
  if (stageId === 'in_transit_carrier' && order?.departedAt) return toMillis(order.departedAt);
  return toMillis(order?.updatedAt || order?.createdAt);
}

export function getStageExpectedAt(order, stageId, slaOverrides = {}) {
  const record = order?.opsStageRecords?.[stageId];
  if (record?.expectedAt) return toMillis(record.expectedAt);
  const sla = getSlaMinutes(order, stageId, slaOverrides);
  const started = getStageStartedAt(order, stageId);
  if (!sla || !started) return 0;
  return started + sla * 60 * 1000;
}

export function getStageCompletedAt(order, stageId) {
  const record = order?.opsStageRecords?.[stageId];
  if (record?.completedAt) return toMillis(record.completedAt);
  const terminal = ['delivered', 'completed', 'cancelled', 'failed'];
  const current = getCurrentOpsStageId(order);
  if (terminal.includes(stageId) && current === stageId) {
    return toMillis(order?.deliveredAt || order?.cancelledAt || order?.updatedAt);
  }
  return 0;
}

export function getOpsStageDelay(order, slaOverrides = {}, now = Date.now()) {
  const stageId = getCurrentOpsStageId(order);
  if (['delivered', 'completed', 'cancelled', 'failed'].includes(stageId)) {
    return { stageId, delayMs: 0, overdue: false, approaching: false, expectedAt: 0, startedAt: 0 };
  }

  const startedAt = getStageStartedAt(order, stageId);
  const expectedAt = getStageExpectedAt(order, stageId, slaOverrides);
  const completedAt = getStageCompletedAt(order, stageId);
  const reference = completedAt || now;
  const delayMs = expectedAt > 0 && reference > expectedAt ? reference - expectedAt : 0;
  const approaching = expectedAt > 0 && !delayMs && expectedAt - now <= 45 * 60 * 1000 && expectedAt > now;

  return {
    stageId,
    startedAt,
    expectedAt,
    completedAt,
    delayMs,
    overdue: delayMs > 0,
    approaching,
  };
}

export function formatDelay(delayMs) {
  if (!delayMs || delayMs <= 0) return '';
  const totalMinutes = Math.floor(delayMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatOpsDateTime(value) {
  const millis = toMillis(value);
  if (!millis) return '—';
  return new Date(millis).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildOpsTimeline(order) {
  const items = [];
  const activity = Array.isArray(order?.opsActivityLog) ? order.opsActivityLog : [];
  activity.forEach((entry) => {
    items.push({
      at: toMillis(entry.at),
      title: entry.type === 'status_change' ? 'Status changed' : String(entry.type || 'Activity').replace(/_/g, ' '),
      detail: entry.note || `${entry.from || ''} → ${entry.to || ''}`.trim(),
      by: entry.by || 'system',
      reason: entry.reason || '',
      location: entry.location || '',
      delayLabel: entry.delayLabel || '',
    });
  });

  const events = Array.isArray(order?.logisticsEvents) ? order.logisticsEvents : [];
  events.forEach((event) => {
    items.push({
      at: toMillis(event.at),
      title: getOpsStageLabel(event.status, DELIVERY_TYPES.INTER_REGION),
      detail: event.note || '',
      by: event.by || 'system',
      reason: '',
      location: '',
      delayLabel: '',
    });
  });

  if (!items.length && order?.createdAt) {
    items.push({
      at: toMillis(order.createdAt),
      title: 'Order created',
      detail: 'Customer created order.',
      by: 'system',
      reason: '',
      location: '',
      delayLabel: '',
    });
  }

  return items.sort((left, right) => right.at - left.at);
}

export function getNextOpsAction(order) {
  const type = getDeliveryType(order);
  const stageId = getCurrentOpsStageId(order);

  if (type === DELIVERY_TYPES.INTER_REGION) {
    const logistics = normalize(order.logisticsStatus || 'awaiting_dispatch');
    const handoff = normalize(order.outsideHandoffMode || 'bus');
    const hasDriver = Boolean(order.driverId);

    if (logistics === 'awaiting_dispatch' || (normalize(order.status) === 'pending_assignment' && !hasDriver)) {
      return { label: 'Assign pickup rider', action: 'outside-assign', tone: 'primary', team: 'Dispatch' };
    }
    if (['awaiting_hub_intake', 'first_mile_assigned', 'at_hub'].includes(logistics) || normalize(order.status) === 'at_hub') {
      return { label: 'Confirm hub intake', action: 'outside-intake', tone: 'primary', team: 'Operations' };
    }
    if (logistics === 'received_at_hub') {
      return { label: 'Confirm transport handover', action: 'outside-depart', tone: 'primary', team: 'Transport' };
    }
    if (logistics === 'in_transit_carrier') {
      return { label: 'Confirm arrival', action: 'outside-arrive', tone: 'primary', team: 'Operations' };
    }
    if (logistics === 'arrived_destination' && handoff === 'home') {
      return { label: 'Assign final rider', action: 'outside-out-for-delivery', tone: 'primary', team: 'Dispatch' };
    }
    if (['arrived_destination', 'out_for_delivery'].includes(logistics)) {
      return { label: 'Mark as received', action: 'outside-complete', tone: 'primary', team: 'Operations' };
    }
    if (logistics === 'completed') {
      return { label: 'Received — in History', action: '', tone: 'success', team: 'System' };
    }
    return { label: 'Review order', action: 'open-ops-desk', tone: 'soft', team: getResponsibleTeam(order) };
  }

  if (stageId === 'pending_assignment') {
    return { label: 'Assign rider', action: 'open-dispatch', tone: 'primary', team: 'Dispatch' };
  }
  if (stageId === 'driver_assigned') {
    return { label: 'Mark at pickup', action: 'status:driver_at_pickup', tone: 'primary', team: 'Rider' };
  }
  if (stageId === 'driver_at_pickup') {
    return { label: 'Start transit', action: 'status:in_transit', tone: 'primary', team: 'Rider' };
  }
  if (stageId === 'in_transit') {
    return { label: 'Mark delivered', action: 'status:delivered', tone: 'primary', team: 'Rider' };
  }
  return { label: 'Monitor order', action: 'open-order', tone: 'soft', team: getResponsibleTeam(order) };
}

function buildAttentionItem(order, slaOverrides) {
  const delay = getOpsStageDelay(order, slaOverrides);
  const stageId = delay.stageId;
  const next = getNextOpsAction(order);
  const orderRef = order.orderNumber || order.id;
  let priority = ATTENTION_PRIORITY.NORMAL;
  let message = '';
  let code = 'monitor';

  if (['cancelled', 'failed'].includes(stageId)) {
    return null;
  }

  if (delay.overdue) {
    priority = delay.delayMs >= 2 * 60 * 60 * 1000 ? ATTENTION_PRIORITY.CRITICAL : ATTENTION_PRIORITY.HIGH;
    message = `Order ${orderRef} overdue in "${getOpsStageLabel(stageId, getDeliveryType(order))}" by ${formatDelay(delay.delayMs)}.`;
    code = 'overdue';
  } else if (delay.approaching) {
    priority = ATTENTION_PRIORITY.HIGH;
    message = `Order ${orderRef} approaching deadline in "${getOpsStageLabel(stageId, getDeliveryType(order))}" (${formatDelay(delay.expectedAt - Date.now())} left).`;
    code = 'approaching';
  } else if (stageId === 'awaiting_dispatch' && !order.driverId) {
    priority = ATTENTION_PRIORITY.MEDIUM;
    message = `Order ${orderRef} waiting for pickup assignment.`;
    code = 'no_assignment';
  } else if (isShipmentStuck(order, slaOverrides)) {
    priority = ATTENTION_PRIORITY.HIGH;
    message = `Order ${orderRef} appears stuck — no progress beyond SLA window.`;
    code = 'stuck';
  } else if (next.action && next.action !== 'open-order' && next.action !== 'open-ops-desk') {
    priority = ATTENTION_PRIORITY.MEDIUM;
    message = `Order ${orderRef}: ${next.label}.`;
    code = 'next_action';
  } else {
    return null;
  }

  return {
    orderId: order.id,
    orderRef,
    priority,
    message,
    code,
    stageId,
    delayMs: delay.delayMs,
    nextAction: next,
    deliveryType: getDeliveryType(order),
    responsibleTeam: getResponsibleTeam(order),
    destination: order.outsideDestinationCity || order.dropoffLabel || '',
  };
}

export function analyzeOpsAttention(orders, slaOverrides = {}) {
  const items = [];
  (orders || []).forEach((order) => {
    if (['delivered', 'completed'].includes(getCurrentOpsStageId(order))) return;
    const item = buildAttentionItem(order, slaOverrides);
    if (item) items.push(item);
  });

  const rank = { critical: 4, high: 3, medium: 2, normal: 1 };
  items.sort((left, right) => (rank[right.priority] || 0) - (rank[left.priority] || 0) || right.delayMs - left.delayMs);

  const counts = { critical: 0, high: 0, medium: 0, normal: 0 };
  items.forEach((item) => {
    counts[item.priority] = (counts[item.priority] || 0) + 1;
  });

  return { items, counts, total: items.length };
}

export function isShipmentStuck(order, slaOverrides = {}, now = Date.now()) {
  const delay = getOpsStageDelay(order, slaOverrides, now);
  if (['delivered', 'completed', 'cancelled', 'failed'].includes(delay.stageId)) return false;
  if (delay.overdue && delay.delayMs >= 4 * 60 * 60 * 1000) return true;
  const started = delay.startedAt;
  if (!started) return false;
  const hoursInStage = (now - started) / (60 * 60 * 1000);
  const sla = getSlaMinutes(order, delay.stageId, slaOverrides);
  if (sla && hoursInStage > (sla / 60) * 2) return true;
  return false;
}

export function getShipmentMilestoneIndex(order) {
  const type = getDeliveryType(order);
  const logistics = normalize(order.logisticsStatus || '');
  const localStatus = normalize(order.status || '');
  if (['cancelled', 'failed'].includes(logistics) || ['cancelled'].includes(localStatus)) {
    return -1;
  }
  let index = 0;
  SHIPMENT_LIFECYCLE.forEach((milestone, milestoneIndex) => {
    const statuses = type === DELIVERY_TYPES.INTER_REGION ? milestone.logisticsStatuses : milestone.localStatuses;
    if (statuses.some((status) => normalize(status) === logistics || normalize(status) === localStatus)) {
      index = milestoneIndex;
    }
  });
  if (logistics === 'completed' || localStatus === 'delivered') {
    return SHIPMENT_LIFECYCLE.length - 1;
  }
  return index;
}

export function buildShipmentMilestoneProgress(order) {
  const currentIndex = getShipmentMilestoneIndex(order);
  const type = getDeliveryType(order);
  const isException = ['cancelled', 'failed'].includes(normalize(order.logisticsStatus))
    || normalize(order.status) === 'cancelled';

  return SHIPMENT_LIFECYCLE.map((milestone, index) => {
    let state = 'upcoming';
    if (isException && index === currentIndex) {
      state = 'exception';
    } else if (index < currentIndex) {
      state = 'complete';
    } else if (index === currentIndex) {
      state = 'current';
    }

    const stageIds = type === DELIVERY_TYPES.INTER_REGION ? milestone.logisticsStatuses : milestone.localStatuses;
    let completedAt = 0;
    stageIds.forEach((statusKey) => {
      const stageId = INTER_REGION_STAGES.find((s) => s.logisticsStatus === statusKey)?.id || statusKey;
      const completed = getStageCompletedAt(order, stageId);
      if (completed) completedAt = Math.max(completedAt, completed);
    });
    if (milestone.id === 'created') {
      completedAt = toMillis(order.createdAt);
    }

    return { ...milestone, state, completedAt: completedAt || null };
  });
}

export function getOpsPipelineCounts(orders) {
  const pipeline = {
    newOrders: 0,
    pickups: 0,
    originHub: 0,
    transport: 0,
    inTransit: 0,
    destinationHub: 0,
    finalDelivery: 0,
    delivered: 0,
    localActive: 0,
    failed: 0,
  };

  (orders || []).forEach((order) => {
    const type = getDeliveryType(order);
    const stageId = getCurrentOpsStageId(order);
    if (type === DELIVERY_TYPES.INTER_REGION) {
      if (stageId === 'awaiting_dispatch') pipeline.newOrders += 1;
      else if (['first_mile_assigned'].includes(stageId)) pipeline.pickups += 1;
      else if (stageId === 'awaiting_hub_intake') pipeline.originHub += 1;
      else if (stageId === 'received_at_hub') pipeline.transport += 1;
      else if (stageId === 'in_transit_carrier') pipeline.inTransit = (pipeline.inTransit || 0) + 1;
      else if (stageId === 'arrived_destination') pipeline.destinationHub += 1;
      else if (stageId === 'out_for_delivery') pipeline.finalDelivery += 1;
      else if (stageId === 'completed') pipeline.delivered += 1;
      else if (['cancelled', 'failed'].includes(stageId)) pipeline.failed += 1;
    } else if (!['delivered', 'cancelled'].includes(stageId)) {
      pipeline.localActive += 1;
    }
  });

  return pipeline;
}

export function getOpsQueueOrders(orders, pageKey, slaOverrides = {}) {
  const page = OPS_QUEUE_PAGES[pageKey];
  if (!page) return [];

  let list = [...(orders || [])];

  if (page.filter === 'attention') {
    return analyzeOpsAttention(list, slaOverrides).items.map((item) => ({
      ...list.find((order) => order.id === item.orderId),
      _attention: item,
    })).filter((row) => row.id);
  }

  if (page.filter === 'overdue') {
    return list.filter((order) => getOpsStageDelay(order, slaOverrides).overdue);
  }

  if (page.filter === 'transport') {
    return list.filter((order) => getDeliveryType(order) === DELIVERY_TYPES.INTER_REGION && getCurrentOpsStageId(order) === 'in_transit_carrier');
  }

  if (page.filter === 'in_transit') {
    return list.filter((order) => getDeliveryType(order) === DELIVERY_TYPES.INTER_REGION && getCurrentOpsStageId(order) === 'in_transit_carrier');
  }

  if (page.filter === 'exceptions') {
    const attention = analyzeOpsAttention(list, slaOverrides);
    const criticalIds = new Set(attention.items.filter((item) => ['critical', 'high'].includes(item.priority)).map((item) => item.orderId));
    return list.filter((order) => {
      const stageId = getCurrentOpsStageId(order);
      if (['failed', 'cancelled'].includes(stageId)) return true;
      if (criticalIds.has(order.id)) return true;
      if (isShipmentStuck(order, slaOverrides)) return true;
      return false;
    });
  }

  if (page.filter === 'returns') {
    return list.filter((order) => normalize(order.returnStatus) === 'return_requested'
      || normalize(order.opsReturnStatus) === 'pending'
      || Boolean(order.returnRequestedAt));
  }

  if (page.filter === 'payments') {
    return list.filter((order) => {
      const stageId = getCurrentOpsStageId(order);
      if (['completed', 'delivered', 'cancelled', 'failed'].includes(stageId)) return false;
      return !order.paidAt && !order.paymentStatus;
    });
  }

  if (page.stages?.length) {
    list = list.filter((order) => {
      if (page.deliveryType === 'inter_region' && getDeliveryType(order) !== DELIVERY_TYPES.INTER_REGION) return false;
      if (page.deliveryType === 'local' && getDeliveryType(order) !== DELIVERY_TYPES.LOCAL) return false;
      const stageId = getCurrentOpsStageId(order);
      const logistics = normalize(order.logisticsStatus);
      return page.stages.includes(stageId) || page.stages.includes(logistics);
    });
  }

  return list;
}

export function getRegionalShipmentCounts(orders) {
  const regions = new Map();
  (orders || []).forEach((order) => {
    if (getDeliveryType(order) !== DELIVERY_TYPES.INTER_REGION) return;
    if (['completed', 'cancelled', 'failed'].includes(getCurrentOpsStageId(order))) return;
    const region = String(order.outsideDestinationCity || order.outsideDestinationLabel || 'Unknown').trim() || 'Unknown';
    regions.set(region, (regions.get(region) || 0) + 1);
  });
  return [...regions.entries()].sort((left, right) => right[1] - left[1]).map(([region, count]) => ({ region, count }));
}

/** Build Firestore patch fields when entering a new ops stage */
export function buildOpsStagePatch(order, nextStageId, actor, options = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const slaOverrides = options.slaOverrides || {};
  const previousStageId = getCurrentOpsStageId(order);
  const sla = getSlaMinutes(order, nextStageId, slaOverrides);
  const computedExpectedAt = sla ? new Date(now.getTime() + sla * 60 * 1000).toISOString() : '';
  const existingExpectedAt = opsStageRecordsSafeGet(order?.opsStageRecords?.[nextStageId]?.expectedAt);

  const opsStageRecords = { ...(order.opsStageRecords || {}) };

  if (previousStageId && previousStageId !== nextStageId) {
    const prev = omitUndefined({
      ...(opsStageRecords[previousStageId] || {}),
      completedAt: opsStageRecords[previousStageId]?.completedAt || nowIso,
      completedBy: opsStageRecords[previousStageId]?.completedBy || actor,
    });
    opsStageRecords[previousStageId] = prev;
  }

  const nextExpectedAt = computedExpectedAt || existingExpectedAt;
  opsStageRecords[nextStageId] = omitUndefined({
    ...(opsStageRecords[nextStageId] || {}),
    startedAt: opsStageRecords[nextStageId]?.startedAt || nowIso,
    expectedAt: nextExpectedAt || undefined,
    responsibleTeam: options.responsibleTeam || getResponsibleTeam({ ...order, logisticsStatus: nextStageId }),
    notes: options.note || opsStageRecords[nextStageId]?.notes || '',
  });

  const activityEntry = {
    type: options.manual ? 'manual_status_change' : 'status_change',
    from: previousStageId,
    to: nextStageId,
    by: actor,
    at: nowIso,
    reason: options.reason || '',
    note: options.note || '',
    deliveryType: getDeliveryType(order),
  };

  const opsActivityLog = [...(Array.isArray(order.opsActivityLog) ? order.opsActivityLog : []), activityEntry];

  return {
    opsStageRecords,
    opsActivityLog,
    deliveryType: getDeliveryType(order),
  };
}

function opsStageRecordsSafeGet(value) {
  return value == null || value === '' ? '' : value;
}

function omitUndefined(payload) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([, value]) => value !== undefined));
}

export function getOrderEtaLabel(order) {
  const deadline = toMillis(order?.outsideEtaDeadlineAt);
  const expressArrival = toMillis(order?.outsideExpressArrivalAt);
  const millis = deadline || expressArrival;
  if (!millis) return 'ETA not available';
  return formatOpsDateTime(millis);
}
