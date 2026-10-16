'use strict';
// The payment adapter contract: nothing is connected, and only complete verified events would be accepted.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {adapter,validateEvent}=require('../server/lib/paymentAdapter');
const good={type:'payment_succeeded',provider:'test',eventId:'evt_1',providerPaymentId:'pay_1',businessId:'11111111-1111-4111-8111-111111111111',
 planVersionId:'22222222-2222-4222-8222-222222222222',amountMinor:14900,currency:'USD',environment:'sandbox',periodStart:'2026-11-01T00:00:00Z',periodEnd:'2026-12-01T00:00:00Z'};
test('no payment provider is connected: checkout, webhooks and lookups all refuse',async()=>{
 const a=adapter();assert.equal(a.connected,false);
 await assert.rejects(a.createCheckout({}),/payments_not_connected/);
 assert.equal(a.verifyWebhook(Buffer.from('{}'),{}),false);
 assert.throws(()=>a.parseEvent('{}'),/payments_not_connected/);
 await assert.rejects(a.fetchPayment('x'),/payments_not_connected/);
});
test('a normalized event needs ids, amount, environment and a valid paid period',()=>{
 assert.deepEqual(validateEvent({...good}),good);
 for(const bad of [{type:'paid'},{eventId:''},{businessId:'x'},{amountMinor:1.5},{currency:'usd'},{environment:'prod'},{periodEnd:'2026-10-01T00:00:00Z'},{periodStart:undefined}])
  assert.throws(()=>validateEvent({...good,...bad}),/payment_event_invalid/,JSON.stringify(bad));
 assert.ok(validateEvent({...good,type:'payment_failed',periodStart:undefined,periodEnd:undefined}));
});
