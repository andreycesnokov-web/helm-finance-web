// Unit + decimal-safety + legacy-golden tests for the centralized classifier.
// Run: node tests/transactionClass.test.js
const T = require('../server/lib/transactionClass');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const eq = (m, a, b) => ok(`${m} -> ${a}`, a === b);

// ── new-type behavior table (spec §7) ───────────────────────────────────────
const TABLE = [
  ['fx_transfer_in', 'in', false, false, 'internal_transfer'],
  ['fx_transfer_out', 'out', false, false, 'internal_transfer'],
  ['funding_in', 'in', false, false, 'financing'],
  ['funding_out', 'out', false, false, 'financing'],
  ['funding_repayment_in', 'in', false, false, 'financing'],
  ['funding_repayment_out', 'out', false, false, 'financing'],
  ['capital_contribution_in', 'in', false, false, 'financing'],
  ['capital_contribution_out', 'out', false, false, 'investing'],
  ['fx_fee', 'out', false, false, 'fee'],
  ['network_fee', 'out', false, false, 'fee'],
];
for (const [type, dir, rev, opex, cls] of TABLE) {
  eq(`${type} direction`, T.getTransactionCashDirection(type), dir);
  ok(`${type} revenue=${rev}`, T.isRevenue(type) === rev);
  ok(`${type} operatingExpense=${opex}`, T.isOperatingExpense(type) === opex);
  eq(`${type} class`, T.getTransactionEconomicClass(type), cls);
}

// fee semantics: not revenue, not operating expense, but IS expense / financial cost
ok('fx_fee isFinancialCost', T.isFinancialCost('fx_fee') && T.isFinancialCost('network_fee') && T.isFinancialCost('bank_fee'));
ok('fx_fee isExpense (total cost)', T.isExpense('fx_fee'));
ok('fx_fee NOT operating expense', !T.isOperatingExpense('fx_fee'));
ok('expense IS operating expense', T.isOperatingExpense('expense') && T.isExpense('expense'));

// ── legacy types preserved exactly ──────────────────────────────────────────
eq('income direction', T.getTransactionCashDirection('income'), 'in');
eq('expense direction', T.getTransactionCashDirection('expense'), 'out');
eq('payroll direction', T.getTransactionCashDirection('payroll'), 'out');
eq('transfer direction (neutral)', T.getTransactionCashDirection('transfer'), 'neutral');
eq('owner_injection direction (neutral, not reinterpreted)', T.getTransactionCashDirection('owner_injection'), 'neutral');
eq('owner_withdrawal direction (neutral)', T.getTransactionCashDirection('owner_withdrawal'), 'neutral');
eq('correction direction (signed)', T.getTransactionCashDirection('correction'), 'signed');
ok('income isRevenue', T.isRevenue('income'));
ok('expense/payroll operating expense', T.isOperatingExpense('expense') && T.isOperatingExpense('payroll'));
ok('legacy arrays exact', JSON.stringify(T.CASH_IN_LEGACY) === '["income"]' && JSON.stringify(T.CASH_OUT_LEGACY) === '["expense","payroll"]');

// ── decimal safety (no float) ───────────────────────────────────────────────
eq('0.00000001 BTC round-trips', T.fromScaled(T.toScaled('0.00000001')), '0.00000001');
eq('0.123456789012345678 ETH (18dp) exact', T.fromScaled(T.toScaled('0.123456789012345678')), '0.123456789012345678');
eq('100000000000000000 IDR exact', T.fromScaled(T.toScaled('100000000000000000')), '100000000000000000');
eq('0.1 + 0.2 == 0.3 (float would fail)', T.addDec('0.1', '0.2'), '0.3');
eq('fee + principal (10000 + 10)', T.addDec('10000', '10'), '10010');
eq('cross-currency partial repayment (10000 - 3000)', T.subDec('10000', '3000'), '7000');
eq('BTC fee+principal 0.5 + 0.00000001', T.addDec('0.5', '0.00000001'), '0.50000001');
// repeating inverse: provider supplies a fixed-precision string; we never re-derive via float
eq('inverse rate string preserved (1/16300 truncated by provider)', T.addDec('0.000061349693251533', '0'), '0.000061349693251533');

// ── cash impact (signed, decimal) ───────────────────────────────────────────
eq('native impact income +', T.calculateNativeCashImpact({ type: 'income', amount_original: '163000000' }), '163000000');
eq('native impact funding_out -', T.calculateNativeCashImpact({ type: 'funding_out', amount_original: '10000' }), '-10000');
eq('native impact transfer neutral', T.calculateNativeCashImpact({ type: 'transfer', amount_original: '500' }), '0');
eq('native impact correction signed', T.calculateNativeCashImpact({ type: 'correction', amount_original: '-250' }), '-250');
eq('reporting impact uses amount_reporting', T.calculateReportingCashImpact({ type: 'funding_in', amount_reporting: '163000000', amount_idr: '0' }), '163000000');
eq('reporting impact falls back to amount_idr', T.calculateReportingCashImpact({ type: 'income', amount_idr: '5000' }), '5000');

// ── LEGACY GOLDEN: old inline formula vs new module on every existing type ──
// Old inline behavior (reconstructed): CASH_IN=['income'], CASH_OUT=['expense','payroll'],
// correction = signed amount, everything else neutral.
const fixture = [
  { type: 'income', amount_original: 1000000 },
  { type: 'expense', amount_original: 400000 },
  { type: 'payroll', amount_original: 250000 },
  { type: 'transfer', amount_original: 999999 },
  { type: 'owner_injection', amount_original: 5000000 },
  { type: 'owner_withdrawal', amount_original: 3000000 },
  { type: 'correction', amount_original: -150000 },
];
const OLD_CASH_IN = ['income'], OLD_CASH_OUT = ['expense', 'payroll'];
const oldTotal = fixture.filter(t => OLD_CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0)
  - fixture.filter(t => OLD_CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0)
  + fixture.filter(t => t.type === 'correction').reduce((s, t) => s + Number(t.amount_original), 0);
const newTotal = fixture.reduce((acc, t) => T.addDec(acc, T.calculateNativeCashImpact({ ...t, amount_original: String(t.amount_original) })), '0');
ok(`legacy golden: old total ${oldTotal} == new total ${newTotal}`, String(oldTotal) === newTotal);
const oldRevenue = fixture.filter(t => OLD_CASH_IN.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
const newRevenue = fixture.filter(t => T.isRevenue(t.type)).reduce((s, t) => T.addDec(s, String(t.amount_original)), '0');
ok(`legacy golden: revenue ${oldRevenue} unchanged`, String(oldRevenue) === newRevenue);
const oldOpex = fixture.filter(t => OLD_CASH_OUT.includes(t.type)).reduce((s, t) => s + Number(t.amount_original), 0);
const newOpex = fixture.filter(t => T.isOperatingExpense(t.type)).reduce((s, t) => T.addDec(s, String(t.amount_original)), '0');
ok(`legacy golden: operating expense ${oldOpex} unchanged`, String(oldOpex) === newOpex);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
