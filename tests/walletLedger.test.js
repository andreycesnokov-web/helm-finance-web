'use strict';
// No manual outflow may take a money account below zero; balances read every row.
const test = require('node:test');
const assert = require('node:assert');
const WL = require('../server/lib/walletLedger');

const W = { id: 'w1', name: 'BCA Bank (HCI)', currency: 'IDR', type: 'bank' };

test('ledger balance: income in, expense and payroll out, correction signed, transfer type ignored', () => {
  const txs = [
    { wallet_id: 'w1', type: 'income', amount_original: 1000 },
    { wallet_id: 'w1', type: 'expense', amount_original: 300 },
    { wallet_id: 'w1', type: 'payroll', amount_original: 200 },
    { wallet_id: 'w1', type: 'correction', amount_original: -50 },
    { wallet_id: 'w1', type: 'transfer', amount_original: 999 },
    { wallet_id: null, source: 'BCA Bank (HCI)', type: 'income', amount_idr: 100 },
    { wallet_id: 'w2', type: 'income', amount_original: 5000 },
  ];
  assert.strictEqual(WL.ledgerBalance(txs, W), 550);
});

test('an outflow within the balance is allowed, to exactly zero too', () => {
  assert.strictEqual(WL.outflowRefusal({ wallet: W, balance: 1000, amount: 400 }), null);
  assert.strictEqual(WL.outflowRefusal({ wallet: W, balance: 1000, amount: 1000 }), null);
});

test('an outflow beyond the balance is refused with the shortfall', () => {
  const r = WL.outflowRefusal({ wallet: W, balance: 29600000, amount: 114256000 });
  assert.strictEqual(r.error, 'insufficient_balance');
  assert.strictEqual(r.balance_after, -84656000);
  assert.strictEqual(r.shortfall, 84656000);
  assert.strictEqual(r.wallet_id, 'w1');
});

test('a wallet already below zero refuses any outflow and says records are missing', () => {
  const r = WL.outflowRefusal({ wallet: W, balance: -62900000, amount: 1 });
  assert.strictEqual(r.error, 'wallet_balance_negative');
  assert.match(r.message, /missing/);
});

test('cash, e-wallet and gateway accounts follow the same rule; only credit types may go negative', () => {
  for (const type of ['cash', 'ewallet', 'payment_gateway', 'other', undefined]) {
    assert.ok(WL.outflowRefusal({ wallet: { ...W, type }, balance: 0, amount: 1 }), `type ${type}`);
  }
  for (const type of WL.MAY_GO_NEGATIVE) {
    assert.strictEqual(WL.outflowRefusal({ wallet: { ...W, type }, balance: 0, amount: 1 }), null, `type ${type}`);
  }
});

test('no wallet or no amount: nothing to check', () => {
  assert.strictEqual(WL.outflowRefusal({ wallet: null, balance: 0, amount: 10 }), null);
  assert.strictEqual(WL.outflowRefusal({ wallet: W, balance: 0, amount: 0 }), null);
});

test('fetchAllRows pages past the 1000-row cap and stops on a short page', async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
  const calls = [];
  const build = () => ({ range: async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; } });
  const all = await WL.fetchAllRows(build);
  assert.strictEqual(all.length, 2345);
  assert.deepStrictEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('fetchAllRows: exactly 1000 rows asks once more and gets an empty page', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const build = () => ({ range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }) });
  assert.strictEqual((await WL.fetchAllRows(build)).length, 1000);
});

test('fetchAllRows surfaces a query error and works with doubles that have no range()', async () => {
  await assert.rejects(WL.fetchAllRows(() => ({ range: async () => ({ data: null, error: new Error('boom') }) })), /boom/);
  const plain = () => Promise.resolve({ data: [{ id: 1 }], error: null });
  assert.deepStrictEqual(await WL.fetchAllRows(plain), [{ id: 1 }]);
});
