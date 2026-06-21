// Single source of truth for transaction classification + decimal-safe cash math.
// No floating point: monetary values are strings; arithmetic uses BigInt scaled
// to 18 decimals. Unit-tested in tests/transactionClass.test.js and proven
// byte-identical to the legacy inline formulas in tests/legacyGolden.test.js.

const SCALE = 18;
const TEN = 10n;
const POW = TEN ** BigInt(SCALE);

// ── decimal-safe helpers (string in/out; never Number()/parseFloat for math) ─
function toScaled(v) {
  if (v === null || v === undefined || v === '') return 0n;
  let s = typeof v === 'string' ? v.trim() : String(v);
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  const [int, frac = ''] = s.split('.');
  const fracPad = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const big = BigInt(int || '0') * POW + BigInt(fracPad || '0');
  return neg ? -big : big;
}
function fromScaled(b) {
  const neg = b < 0n; const x = neg ? -b : b;
  let int = (x / POW).toString();
  let frac = (x % POW).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}
const addDec = (a, b) => fromScaled(toScaled(a) + toScaled(b));
const subDec = (a, b) => fromScaled(toScaled(a) - toScaled(b));
const negDec = (a) => fromScaled(-toScaled(a));
const cmpDec = (a, b) => { const x = toScaled(a) - toScaled(b); return x < 0n ? -1 : x > 0n ? 1 : 0; };

// ── classification maps ─────────────────────────────────────────────────────
// LEGACY types preserve exact historical behavior (see golden test).
const DIRECTION = {
  income: 'in', expense: 'out', payroll: 'out',
  transfer: 'neutral', correction: 'signed',
  owner_injection: 'neutral', owner_withdrawal: 'neutral',   // NOT reinterpreted yet
  // new multi-currency / funding types:
  fx_transfer_in: 'in', fx_transfer_out: 'out',
  funding_in: 'in', funding_out: 'out',
  funding_repayment_in: 'in', funding_repayment_out: 'out',
  capital_contribution_in: 'in', capital_contribution_out: 'out',
  fx_fee: 'out', network_fee: 'out', bank_fee: 'out',
};
const ECONOMIC_CLASS = {
  income: 'operating', expense: 'operating', payroll: 'operating',
  transfer: 'internal_transfer', correction: 'correction',
  owner_injection: 'financing', owner_withdrawal: 'financing',
  fx_transfer_in: 'internal_transfer', fx_transfer_out: 'internal_transfer',
  funding_in: 'financing', funding_out: 'financing',
  funding_repayment_in: 'financing', funding_repayment_out: 'financing',
  capital_contribution_in: 'financing', capital_contribution_out: 'investing',
  fx_fee: 'fee', network_fee: 'fee', bank_fee: 'fee',
};

const getTransactionCashDirection = (type) => DIRECTION[type] || 'neutral';
const getTransactionEconomicClass = (type) => ECONOMIC_CLASS[type] || 'operating';
const isRevenue = (type) => type === 'income';
const isOperatingExpense = (type) => ECONOMIC_CLASS[type] === 'operating' && DIRECTION[type] === 'out';
const isFinancialCost = (type) => ECONOMIC_CLASS[type] === 'fee';
const isExpense = (type) => isOperatingExpense(type) || isFinancialCost(type);  // appears in total cost
const isFinancingFlow = (type) => ECONOMIC_CLASS[type] === 'financing' || ECONOMIC_CLASS[type] === 'investing';
const isInternalTransfer = (type) => ECONOMIC_CLASS[type] === 'internal_transfer';

// Signed cash impact in NATIVE asset (decimal string). correction = stored signed delta.
function calculateNativeCashImpact(tx) {
  const amt = tx.amount_original ?? tx.amount ?? '0';
  const dir = getTransactionCashDirection(tx.type);
  if (dir === 'in') return addDec('0', amt);
  if (dir === 'out') return negDec(amt);
  if (dir === 'signed') return addDec('0', amt);   // correction keeps its stored sign
  return '0';
}
// Signed cash impact in REPORTING currency (amount_reporting, fallback legacy amount_idr).
function calculateReportingCashImpact(tx) {
  const amt = tx.amount_reporting ?? tx.amount_idr ?? tx.amount_original ?? '0';
  const dir = getTransactionCashDirection(tx.type);
  if (dir === 'in') return addDec('0', amt);
  if (dir === 'out') return negDec(amt);
  if (dir === 'signed') return addDec('0', amt);
  return '0';
}

// ── LEGACY arrays — the exact historical CASH_IN/CASH_OUT, for call-site swap ─
// New types are intentionally NOT in these arrays, so legacy cash totals are
// unchanged until funding runtime explicitly opts in (golden test enforces this).
const CASH_IN_LEGACY = Object.freeze(['income']);
const CASH_OUT_LEGACY = Object.freeze(['expense', 'payroll']);

module.exports = {
  SCALE, toScaled, fromScaled, addDec, subDec, negDec, cmpDec,
  DIRECTION, ECONOMIC_CLASS,
  getTransactionCashDirection, getTransactionEconomicClass,
  isRevenue, isExpense, isOperatingExpense, isFinancialCost, isFinancingFlow, isInternalTransfer,
  calculateNativeCashImpact, calculateReportingCashImpact,
  CASH_IN_LEGACY, CASH_OUT_LEGACY,
};
