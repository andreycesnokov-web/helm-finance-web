// Pre-release review fixes (design v2, batch 13). Run: node tests/releaseHardening.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../server/lib/businessFunding');
const A = require('../server/lib/assetRegister');
const M = require('../server/lib/incomingPaymentMatching');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const block = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n});', i)); };

console.log('\nRelease hardening');

t('money inputs must be finite and at most 1e15 IDR (funding and assets)', () => {
  const base = { source_kind: 'bank', instrument: 'loan', received_on: '2026-09-01', lender_name: 'Bank Mandiri' };
  for (const bad of [Infinity, 1e16, Number.MAX_VALUE]) {
    assert.strictEqual(F.recordFromBody({ ...base, amount: bad }).error, 'invalid_amount', String(bad));
    assert.strictEqual(F.repaymentFromBody({ due_on: '2026-10-01', principal: bad }).error, 'invalid_repayment_amounts', String(bad));
    assert.strictEqual(A.assetFromBody({ name: 'X', asset_type: 'machines', cost: bad, acquired_on: '2026-09-01' }, []).error, 'invalid_cost', String(bad));
  }
  assert.ok(!F.recordFromBody({ ...base, amount: 250000000 }).error, 'a normal amount still passes');
});

t('payment matching: outstanding subtracts tax withheld; unchanged without withholding', () => {
  assert.strictEqual(M.outstandingAmount({ original_amount: 1000, paid_amount: 100 }), 900);
  assert.strictEqual(M.outstandingAmount({ original_amount: 1000, paid_amount: 100, withholding_allocated: 20 }), 880);
  assert.strictEqual(M.outstandingAmount({ original_amount: 1000, paid_amount: 990, withholding_allocated: 20 }), 0);
});

t('the incoming-payments route attaches this business\'s withholdings before matching', () => {
  assert.match(src, /DW\.attachWithholdings\(debtRes\.data \|\| \[\], await loadWithholdings\(businessId\)\)/);
});

t('PATCH /api/debts/:settle writes an audit row', () => {
  const h = block("app.patch('/api/debts/:id/settle'");
  assert.match(h, /recordAudit\(\{[\s\S]*action: 'debt_settled'/);
});

t('PATCH /api/debts/:id: amount cannot drop below paid + withheld', () => {
  const h = block("app.patch('/api/debts/:id', auth");
  assert.match(h, /withheld > 0 && amt < Number\(debt\.paid_amount \|\| 0\) \+ withheld/);
});

t('invoice settlement view counts withholding allocations as settled', () => {
  assert.match(src, /settlement_source_type === 'withholding_record'\)[\s\S]{0,120}allocated_amount/);
  assert.match(src, /allocations: \[paidAmount, withheldAmount\]/);
});

t('loadWithholdings pages past 1,000 rows and chunks the id lookup', () => {
  const h = src.slice(src.indexOf('async function loadWithholdings'), src.indexOf('async function enrichDebtsFor'));
  assert.match(h, /\.range\(from, from \+ 999\)/);
  assert.match(h, /ids\.slice\(i, i \+ 100\)/);
});

t('migrations 062–064 put RLS on their new tables and revoke anon/authenticated', () => {
  for (const [f, tables] of [['062_pnl_groups_industry_templates.sql', ['industry_templates']], ['063_asset_register.sql', ['assets']],
    ['064_business_funding_register.sql', ['business_funding_records', 'business_funding_repayments']]]) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/, f);
    assert.match(sql, /REVOKE ALL ON public\.%I FROM %I/, f);
    for (const tb of tables) assert.ok(sql.includes(`'${tb}'`), `${f}: ${tb}`);
    assert.ok(sql.indexOf('ENABLE ROW LEVEL SECURITY') < sql.lastIndexOf('COMMIT;'), `${f}: inside the transaction`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
