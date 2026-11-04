const assert = require('assert');
const { forwardStage, stageFromFacts } = require('./order-stage');

const samples = [
  [{}, { shipmentStatus: 'assigned' }, 'new'],
  [{ haulStage: 'new', statusVersion: 1 }, { shipmentStatus: 'accepted', carrierId: 'c1', trackStep: 'received' }, 'verified'],
  [{ haulStage: 'verified', statusVersion: 2 }, { shipmentStatus: 'in_transit', trackStep: 'transit' }, 'in_transit'],
  [{ haulStage: 'in_transit', statusVersion: 3 }, { shipmentStatus: 'delivered', trackStep: 'handed' }, 'delivered'],
  [{ haulStage: 'in_transit', statusVersion: 4 }, { shipmentStatus: 'accepted', trackStep: 'received' }, 'in_transit'],
  [{ haulStage: 'delivered', statusVersion: 5 }, { shipmentStatus: 'assigned', trackStep: '' }, 'delivered'],
];

for (const [current, incoming, expected] of samples) {
  const next = forwardStage(current, incoming);
  assert.strictEqual(next.haulStage, expected, JSON.stringify({ current, incoming, next }));
  if (current.haulStage && RANK_SAFE(current.haulStage) > RANK_SAFE(expected)) {
    throw new Error('stage moved backwards');
  }
  if (current.statusVersion) assert.ok(next.statusVersion >= current.statusVersion);
}

assert.strictEqual(stageFromFacts({ carrierTrackStep: 'handed' }), 'delivered');
assert.strictEqual(stageFromFacts({ carrierMatchStatus: 'accepted' }), 'verified');

function RANK_SAFE(name) {
  return { new: 0, verified: 1, in_transit: 2, delivered: 3 }[name] ?? 0;
}

const started = process.hrtime.bigint();
const iterations = 20000;
let cursor = { haulStage: 'new', statusVersion: 1 };
const steps = [
  { shipmentStatus: 'accepted', carrierId: 'c', trackStep: 'received' },
  { shipmentStatus: 'in_transit', trackStep: 'transit' },
  { shipmentStatus: 'delivered', trackStep: 'handed' },
  { shipmentStatus: 'accepted', trackStep: 'received' },
];
const timings = [];
for (let i = 0; i < iterations; i += 1) {
  const t0 = process.hrtime.bigint();
  cursor = forwardStage(cursor, steps[i % steps.length]);
  timings.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
timings.sort((a, b) => a - b);
const pick = (p) => timings[Math.min(timings.length - 1, Math.floor((timings.length - 1) * p))];
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.strictEqual(cursor.haulStage, 'delivered');
console.log(JSON.stringify({
  iterations,
  elapsedMs: Math.round(elapsedMs * 100) / 100,
  p50Ms: pick(0.5),
  p95Ms: pick(0.95),
  p99Ms: pick(0.99),
  finalStage: cursor.haulStage,
  finalVersion: cursor.statusVersion,
}));
