// Decimal-safe money utility for the frontend. NEVER uses Number()/parseFloat for
// financial math — money flows in as decimal STRINGS from the API and is added /
// subtracted via BigInt scaled to 18 decimals. Mirrors server/lib/transactionClass.js.
//
// Display precision is asset-specific; native totals are per-asset only — wallets of
// different native assets are NEVER summed into one number.

const SCALE = 18;
const POW = 10n ** BigInt(SCALE);

// Per-asset display precision (decimal places shown to the user).
export const ASSET_PRECISION = { IDR: 0, USD: 2, USDT: 2, BTC: 8, ETH: 18 };
const displayDigits = (asset) => (ASSET_PRECISION[asset] ?? 2);

// ── scaled BigInt core (string in / string out) ────────────────────────────
export function toScaled(v) {
  if (v === null || v === undefined || v === '') return 0n;
  let s = typeof v === 'string' ? v.trim() : String(v);
  if (s === '' || s === '-' || s === '+') return 0n;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  const [int, frac = ''] = s.split('.');
  const fracPad = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const big = BigInt(int || '0') * POW + BigInt(fracPad || '0');
  return neg ? -big : big;
}
export function fromScaled(b) {
  const neg = b < 0n; const x = neg ? -b : b;
  const int = (x / POW).toString();
  const frac = (x % POW).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

export const add = (a, b) => fromScaled(toScaled(a) + toScaled(b));
export const sub = (a, b) => fromScaled(toScaled(a) - toScaled(b));
export const cmp = (a, b) => { const x = toScaled(a) - toScaled(b); return x < 0n ? -1 : x > 0n ? 1 : 0; };
// Sum a list of decimal strings (single asset) — never crosses assets.
export const sum = (arr) => (arr || []).reduce((acc, v) => add(acc, v ?? '0'), '0');

// ── asset-specific formatting (rounds half-up to the asset's display digits) ─
export function formatAmount(value, asset) {
  const digits = displayDigits(asset);
  const scaled = toScaled(value ?? '0');
  const neg = scaled < 0n;
  let x = neg ? -scaled : scaled;
  // round half-up at the display precision
  const cut = 10n ** BigInt(SCALE - digits);
  if (cut > 1n) { const rem = x % cut; x = x - rem + (rem * 2n >= cut ? cut : 0n); }
  const intPart = (x / POW).toString();
  const fracFull = (x % POW).toString().padStart(SCALE, '0');
  const frac = digits > 0 ? fracFull.slice(0, digits) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + intGrouped + (digits > 0 ? '.' + frac : '');
}
// "1 234.56 USD"
export const formatMoney = (value, asset) => `${formatAmount(value, asset)} ${asset}`;

// ── native vs reporting totals ──────────────────────────────────────────────
// Group wallet/transaction amounts by their native asset. Returns { ASSET: total }.
// Different native assets are kept SEPARATE — never collapsed into one number.
export function nativeTotalsByAsset(items, { assetKey = 'asset_code', amountKey = 'amount_original' } = {}) {
  const totals = {};
  for (const it of items || []) {
    const asset = it[assetKey] || it.currency || 'IDR';
    totals[asset] = add(totals[asset] || '0', it[amountKey] ?? '0');
  }
  return totals;
}
// Reporting-currency total: every item already carries amount_reporting in the SAME
// reporting currency, so these may be summed. Caller asserts a single reporting currency.
export function reportingTotal(items, { amountKey = 'amount_reporting' } = {}) {
  return sum((items || []).map((it) => it[amountKey] ?? it.amount_idr ?? '0'));
}

export default { toScaled, fromScaled, add, sub, cmp, sum, formatAmount, formatMoney, nativeTotalsByAsset, reportingTotal, ASSET_PRECISION };
