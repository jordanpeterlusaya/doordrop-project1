const assert = require('assert');
const { isCustomerCancelledRecord } = require('./carrier-cancel');

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

console.log('customer-cancel predicates ok');
