const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isCustomerCancelledRecord } = require('./carrier-cancel');
const { isCustomerCancelFacts } = require('./order-stage');

assert.strictEqual(isCustomerCancelledRecord({ status: 'cancelled', cancelledBy: 'customer' }), true);
assert.strictEqual(isCustomerCancelledRecord({ shipmentStatus: 'assigned', cancelledBy: 'customer' }), true);
assert.strictEqual(isCustomerCancelledRecord({ haulStage: 'cancelled', shipmentStatus: 'assigned' }), true);
assert.strictEqual(isCustomerCancelledRecord({ haulStage: 'canceled' }), true);
assert.strictEqual(isCustomerCancelledRecord({ status: 'cancelled' }), true);
assert.strictEqual(isCustomerCancelledRecord({ shipmentStatus: 'cancelled', quoteStatus: 'declined' }), true);
assert.strictEqual(isCustomerCancelledRecord({ quoteStatus: 'declined', shipmentStatus: 'assigned' }), true);
assert.strictEqual(isCustomerCancelledRecord({ status: 'cancelled', cancelledBy: 'dispatch' }), false);
assert.strictEqual(isCustomerCancelledRecord({ status: 'cancelled', cancelledBy: 'driver' }), false);
assert.strictEqual(isCustomerCancelledRecord({ shipmentStatus: 'assigned' }), false);
assert.strictEqual(isCustomerCancelledRecord({ status: 'pending_assignment', haulStage: 'new' }), false);
assert.strictEqual(isCustomerCancelledRecord(null), false);

const cases = [
  { status: 'cancelled', cancelledBy: 'customer' },
  { shipmentStatus: 'assigned', cancelledBy: 'customer' },
  { haulStage: 'cancelled', shipmentStatus: 'assigned', carrierId: 'co' },
  { haulStage: 'canceled' },
  { status: 'cancelled' },
  { shipmentStatus: 'cancelled', quoteStatus: 'declined' },
  { quoteStatus: 'declined', shipmentStatus: 'assigned', offeredCarrierId: 'co' },
  { status: 'cancelled', cancelledBy: 'dispatch' },
  { status: 'cancelled', cancelledBy: 'driver' },
  { shipmentStatus: 'assigned', offeredCarrierId: 'co' },
  { status: 'pending_assignment', haulStage: 'new', quoteStatus: 'awaiting_company' },
  { quoteStatus: 'confirmed', shipmentStatus: 'accepted', carrierId: 'co', customerAcceptedQuote: true },
  null,
];

const portalSrc = fs.readFileSync(path.join(__dirname, '../haul-cargo-transporters/order-flow.mjs'), 'utf8');
const actors = portalSrc.match(/const NON_CUSTOMER_ACTORS = new Set\(\[[^\]]*\]\);/);
const fn = portalSrc.match(/export function customerCancelled\(input\) \{[\s\S]*?\n\}/);
if (!actors || !fn) throw new Error('portal customerCancelled block not found');
const portal = new Function(`${actors[0]}\n${fn[0].replace(/^export /m, '')}\nreturn customerCancelled;`)();

for (const sample of cases) {
  const backend = isCustomerCancelledRecord(sample);
  const facts = isCustomerCancelFacts(sample);
  const desk = portal(sample);
  assert.strictEqual(facts, backend, `stage facts disagree ${JSON.stringify(sample)}`);
  assert.strictEqual(desk, backend, `portal desk disagrees ${JSON.stringify(sample)}`);
}

console.log('customer-cancel predicates ok');
