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

// ── currency presentation ───────────────────────────────────────────────────
// How each currency is written in front of its amount. A currency the product
// has not been taught is written as a code and a space ("CHF 1 200") rather than
// borrowed from another currency's symbol — showing "Rp" in front of dollars is
// exactly the failure this module exists to prevent.
export const CURRENCY_PREFIX = {
  IDR: 'Rp ', USD: '$', EUR: '\u20AC', SGD: 'S$', MYR: 'RM ', THB: '\u0E3F', CNY: 'CN\u00A5',
};
// ISO 4217 code -> the name a person reads. Shown beside the code wherever a
// currency is chosen, because "SGD" and "S$" are not obvious to everyone who has
// to pick the right one for a bank account.
export const CURRENCY_NAMES = {
  IDR: 'Indonesian Rupiah', USD: 'US Dollar', EUR: 'Euro', SGD: 'Singapore Dollar',
  MYR: 'Malaysian Ringgit', THB: 'Thai Baht', CNY: 'Chinese Yuan',
};

export const currencyPrefix = (currency) => {
  const c = String(currency || '').trim().toUpperCase();
  return CURRENCY_PREFIX[c] || (c ? c + ' ' : '');
};

/** "Rp 152 450 000" / "$1 200.50" — the exact amount, in its own currency. */
export const formatCurrency = (value, currency) =>
  currencyPrefix(currency) + formatAmount(String(value ?? 0), String(currency || '').toUpperCase());

/**
 * Display-only compaction for a headline figure: "Rp 152.5M", "$1.2M".
 *
 * Returns null below a million, so a caller renders the exact amount instead —
 * that is what keeps "Rp 0" from becoming "Rp 0.0M". The exact figure is always
 * shown too (Pulse puts it in the caption, Wallets in the supporting line), so
 * nothing is rounded away from the reader.
 *
 * Number() is safe here in a way it is not above: this is a label, never an input
 * to arithmetic, and the value it summarises is rendered in full alongside it.
 *
 * Lived in PulseBlocks.jsx until Wallets needed the same headline treatment.
 * Copying it would have let the product's two money headlines drift apart.
 */
export function compactAmount(value, currency) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs < 1e6) return null;             // "Rp 0", never "Rp 0.0M"
  const sign = n < 0 ? '-' : '';
  const pre = currencyPrefix(currency);
  const UNITS = [[1e6, 'M'], [1e9, 'B'], [1e12, 'T']];
  let i = 0;
  while (i + 1 < UNITS.length && abs >= UNITS[i + 1][0]) i++;
  let [div, suffix] = UNITS[i];
  // Half-up on the tenth, computed on integers. (152.45).toFixed(1) is "152.4",
  // because 152.45 has no exact binary representation — so a card headed
  // "Rp 152.4M" sat above a supporting line reading Rp 152 450 000. Dividing
  // first (152 450 000 / 100 000 = 1524.5, exact) and rounding that gives 152.5,
  // which is also the half-up rule formatAmount above already follows.
  let tenths = Math.round(abs / (div / 10));
  // Rounding can tip a figure into the next unit: 999 999 999 would otherwise
  // read "Rp 1000.0M" rather than "Rp 1.0B".
  if (tenths >= 10000 && i + 1 < UNITS.length) {
    i++;
    [div, suffix] = UNITS[i];
    tenths = Math.round(abs / (div / 10));
  }
  return `${pre}${sign}${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
}

/** The IDR-only shorthand Pulse has always used. */
export const compactIdr = (value) => compactAmount(value, 'IDR');

/**
 * Group wallet-shaped rows by their own currency, and say plainly which rows
 * could not be grouped.
 *
 * This is the whole safety rule in one function: a balance belongs to exactly one
 * currency, so a total may only ever cover rows that share one. Rows whose
 * currency is missing or is not a currency code are NOT guessed into a default —
 * they are returned separately so the page can ask for the currency instead of
 * inventing one. Nothing here converts anything.
 *
 * Returns { groups: [{ currency, total, wallets }] sorted by size, unknown: [...] }.
 */
export function walletsByCurrency(wallets, { balanceKey = 'balance', currencyKey = 'currency' } = {}) {
  const byCur = new Map();
  const unknown = [];
  for (const w of wallets || []) {
    const raw = w?.[currencyKey];
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    // A currency code, not a guess: three letters or it does not count.
    if (!/^[A-Z]{3}$/.test(code)) { unknown.push(w); continue; }
    if (!byCur.has(code)) byCur.set(code, { currency: code, total: 0, wallets: [] });
    const g = byCur.get(code);
    g.total += Number(w?.[balanceKey] || 0);
    g.wallets.push(w);
  }
  const groups = [...byCur.values()].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total) || a.currency.localeCompare(b.currency));
  return { groups, unknown };
}

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

export default { toScaled, fromScaled, add, sub, cmp, sum, formatAmount, formatMoney,
  formatCurrency, currencyPrefix, compactAmount, compactIdr, walletsByCurrency, CURRENCY_NAMES,
  nativeTotalsByAsset, reportingTotal, ASSET_PRECISION, CURRENCY_PREFIX };
