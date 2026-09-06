// Radar's forecast arithmetic, pinned.
//
// The design-system migration rewrote every pixel of Radar and must not have
// moved a single figure. These values were computed from the PREVIOUS
// implementation's expressions before the markup changed, so if the migration
// had altered an operator, a sign or an order of operations, this file fails.
//
// It also pins the three scenarios the product requires — best, expected and
// worst — and the runway/burn pair the header and the KPI row both read.
//
// Pure functions, no browser, no build. Run: node tests/design/radarFigures.test.mjs
import assert from 'node:assert';
import { radarFigures } from '../../client/src/lib/radarFigures.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

// The same shape GET /api/pulse?scope=business returns.
const FIXTURE = {
  totalBalance: 122850000,
  burnRate: 3282833,
  burnWindowDays: 30,
  debts: [
    { id: 'r1', type: 'receivable', counterparty: 'PT Sinar Abadi', amount: 48200000 },
    { id: 'r2', type: 'receivable', counterparty: 'Bali Retail Group', amount: 17650000 },
    { id: 'p1', type: 'payable', counterparty: 'Kantor Pajak', amount: 21400000 },
    { id: 'p2', type: 'payable', counterparty: 'Supplier Nusantara', amount: 9800000 },
  ],
};

console.log('\nradar — the forecast the migration must not have moved');

t('receivables and payables are split and summed as before', () => {
  const f = radarFigures(FIXTURE);
  assert.strictEqual(f.receivables.length, 2);
  assert.strictEqual(f.payables.length, 2);
  assert.strictEqual(f.totalIn, 65850000);
  assert.strictEqual(f.totalOut, 31200000);
});

t('the three scenarios are unchanged', () => {
  const f = radarFigures(FIXTURE);
  // expected: everything planned lands, burn continues 30 days
  assert.strictEqual(f.proj30, 59015010);
  // best: all income received, half the payables actually leave
  assert.strictEqual(f.projBest, 173100000);
  // worst: no receivable arrives, every payable does, burn continues
  assert.strictEqual(f.projWorst, -6834990);
  // The scenarios must stay ordered — a best case below the worst case would
  // mean the formulas had been swapped.
  assert.ok(f.projBest > f.proj30, 'best case is not above expected');
  assert.ok(f.projWorst < f.proj30, 'worst case is not below expected');
});

t('burn and runway are unchanged', () => {
  const f = radarFigures(FIXTURE);
  assert.strictEqual(f.monthlyBurn, 98484990);
  assert.strictEqual(f.runway, 37);
  assert.strictEqual(f.isHealthy, true);
});

t('a negative expected balance flips the health flag, not the arithmetic', () => {
  const f = radarFigures({ ...FIXTURE, totalBalance: 1000000 });
  assert.strictEqual(f.proj30, 1000000 + 65850000 - 31200000 - 3282833 * 30);
  assert.ok(f.proj30 < 0);
  assert.strictEqual(f.isHealthy, false);
});

t('no burn means no runway, never a division by zero', () => {
  const f = radarFigures({ ...FIXTURE, burnRate: 0 });
  assert.strictEqual(f.runway, null, 'runway must be null, not Infinity');
  assert.strictEqual(f.monthlyBurn, 0);
  // With no burn the expected balance is simply balance + in − out.
  assert.strictEqual(f.proj30, 122850000 + 65850000 - 31200000);
});

t('an empty or missing payload produces zeros, not NaN', () => {
  for (const input of [undefined, null, {}, { debts: [] }]) {
    const f = radarFigures(input);
    for (const k of ['balance', 'burnRate', 'totalIn', 'totalOut',
                     'proj30', 'projBest', 'projWorst', 'monthlyBurn']) {
      assert.ok(Number.isFinite(f[k]), `${k} is ${f[k]} for ${JSON.stringify(input)}`);
    }
    assert.strictEqual(f.runway, null);
  }
});

t('a debt of an unknown type is counted in neither direction', () => {
  const f = radarFigures({ ...FIXTURE, debts: [
    ...FIXTURE.debts, { id: 'x', type: 'something_else', amount: 999999999 }] });
  assert.strictEqual(f.totalIn, 65850000, 'an unknown type leaked into income');
  assert.strictEqual(f.totalOut, 31200000, 'an unknown type leaked into payments');
  assert.strictEqual(f.proj30, 59015010, 'an unknown type moved the forecast');
});

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
