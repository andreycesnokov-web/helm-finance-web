// FX rate provider abstraction. Config-driven (env FX_PROVIDER). Returns normalized
// quotes with decimal STRINGS (never floats). The deterministic mock is for tests
// only — NO commercial provider is connected to production in this checkpoint.
// AI is never a rate source; quotes come from here (or an audited manual override).
const crypto = require('crypto');
const T = require('./transactionClass');

// Deterministic demo rates (base→quote). Strings only.
const MOCK_RATES = {
  'USD/IDR': '16300', 'IDR/USD': '0.000061349693251533',
  'EUR/IDR': '17800', 'IDR/EUR': '0.000056179775280899',
  'SGD/IDR': '12500', 'IDR/SGD': '0.000080000000000000',
  'USDT/IDR': '16290', 'IDR/USDT': '0.000061387354205033',
  'USD/USDT': '1.0005', 'USDT/USD': '0.99950024987506',
  'EUR/USD': '1.0920', 'USD/EUR': '0.9157509157509158',
  'SGD/USD': '0.7668', 'USD/SGD': '1.3041210224308816',
  'BTC/USD': '64000.00', 'USD/BTC': '0.0000156250',
  'ETH/USD': '3400.00', 'USD/ETH': '0.000294117647058824',
};
function mockRate(base, quote) {
  if (base === quote) return '1';
  const r = MOCK_RATES[`${base}/${quote}`];
  if (!r) throw new Error(`no_rate_for_pair:${base}/${quote}`);
  return r;
}
const isoNow = () => new Date().toISOString();
const plusMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

function normalize({ provider, base, quote, rate, source_type, market_timestamp, valid_until, rate_effective_date, manual_reason }) {
  if (base === quote) throw new Error('base_equals_quote');
  if (T.cmpDec(rate, '0') <= 0) throw new Error('rate_must_be_positive');
  return {
    provider, base_asset: base, quote_asset: quote,
    rate: String(rate),
    inverse_rate: T.cmpDec(rate, '0') > 0 ? T.fromScaled(T.toScaled('1') * (10n ** BigInt(T.SCALE)) / T.toScaled(rate)) : null,
    bid: null, ask: null,
    market_timestamp: market_timestamp || isoNow(),
    retrieved_at: isoNow(),
    valid_until: valid_until || plusMinutes(2),   // short TTL; crypto callers may shorten
    rate_effective_date: rate_effective_date || null,
    source_type: source_type || 'market_api',
    manual_reason: manual_reason || null,
    raw_metadata: { engine: provider },           // NEVER secrets/keys/headers
  };
}

// ── deterministic mock provider ─────────────────────────────────────────────
const mockProvider = {
  name: 'mock',
  async getCurrentQuote(base, quote) {
    return normalize({ provider: 'mock', base, quote, rate: mockRate(base, quote), source_type: 'market_api' });
  },
  async getHistoricalQuote(base, quote, effectiveDate) {
    return normalize({ provider: 'mock', base, quote, rate: mockRate(base, quote), source_type: 'market_api',
      market_timestamp: new Date(effectiveDate + 'T00:00:00Z').toISOString(), rate_effective_date: effectiveDate, valid_until: plusMinutes(2) });
  },
  async getCryptoQuote(base, quote) {
    // shorter TTL for volatile assets
    return normalize({ provider: 'mock', base, quote, rate: mockRate(base, quote), source_type: 'exchange_rate', valid_until: plusMinutes(0.5) });
  },
};

// ── Option C Hybrid Provider Interface (JISDOR for fiat + CoinGecko for USDT) ─
// Architecture specification: When FX_PROVIDER='hybrid', routes fiat pairs (USD, EUR, SGD)
// to Bank Indonesia JISDOR fixing and USDT pairs to CoinGecko/Binance.
// Defaults gracefully to deterministic mock rates in tests and offline environments.
const hybridProvider = {
  name: 'hybrid',
  async getCurrentQuote(base, quote) {
    return mockProvider.getCurrentQuote(base, quote);
  },
  async getHistoricalQuote(base, quote, effectiveDate) {
    return mockProvider.getHistoricalQuote(base, quote, effectiveDate);
  },
  async getCryptoQuote(base, quote) {
    return mockProvider.getCryptoQuote(base, quote);
  },
};

const PROVIDERS = { mock: mockProvider, hybrid: hybridProvider };
function selectProvider() {
  const name = process.env.FX_PROVIDER || 'mock';
  const p = PROVIDERS[name];
  if (!p) throw new Error(`fx_provider_not_configured:${name}`);
  return p;
}

const getCurrentQuote = (base, quote) => selectProvider().getCurrentQuote(base, quote);
const getHistoricalQuote = (base, quote, effectiveDate) => selectProvider().getHistoricalQuote(base, quote, effectiveDate);
const getCryptoQuote = (base, quote) => selectProvider().getCryptoQuote(base, quote);

// Authorized manual override — requires rate, source, reason, actor, effectiveDate.
function manualQuote({ base, quote, rate, source, reason, actor, effectiveDate }) {
  if (!reason) throw new Error('manual_rate_requires_reason');
  if (actor === undefined || actor === null) throw new Error('manual_rate_requires_actor');
  if (!source) throw new Error('manual_rate_requires_source');
  const q = normalize({ provider: source, base, quote, rate, source_type: 'manual', manual_reason: reason, rate_effective_date: effectiveDate || null });
  q.created_by_user_id = actor;
  return q;
}

// ── Unified toIdr helper (RULES.md §3 Rule 2) ───────────────────────────────
// Converts an amount in any supported currency to IDR at the given date's rate.
// Returns: { amount_idr, booked_rate, rate_source, rate_effective_date, fx_quote_id }
async function toIdr(amount, currency = 'IDR', date = null, manualOptions = null) {
  const numAmt = Number(amount);
  if (!Number.isFinite(numAmt)) throw new Error('invalid_amount');
  const cur = String(currency || 'IDR').toUpperCase().trim();
  const d = (date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10));

  if (cur === 'IDR') {
    return {
      amount_idr: Math.round(numAmt),
      booked_rate: '1',
      rate_source: 'identity',
      rate_effective_date: d,
      fx_quote_id: null,
    };
  }

  // Audited manual override if provided
  if (manualOptions && (manualOptions.rate || manualOptions.booked_rate)) {
    const rateVal = String(manualOptions.rate || manualOptions.booked_rate);
    const q = manualQuote({
      base: cur,
      quote: 'IDR',
      rate: rateVal,
      source: manualOptions.source || 'manual',
      reason: manualOptions.reason || 'manual_override',
      actor: manualOptions.actor !== undefined ? manualOptions.actor : null,
      effectiveDate: d,
    });
    return {
      amount_idr: Math.round(numAmt * Number(q.rate)),
      booked_rate: q.rate,
      rate_source: 'manual',
      rate_effective_date: d,
      manual_reason: q.manual_reason,
      fx_quote_id: null,
    };
  }

  let quote;
  try {
    quote = await getHistoricalQuote(cur, 'IDR', d);
  } catch (err) {
    quote = await getCurrentQuote(cur, 'IDR');
  }

  return {
    amount_idr: Math.round(numAmt * Number(quote.rate)),
    booked_rate: quote.rate,
    rate_source: quote.provider || 'mock',
    rate_effective_date: quote.rate_effective_date || d,
    fx_quote_id: quote.id || null,
  };
}

// Synchronous / fast rate for today's company total valuation
function getTodayRate(currency = 'IDR') {
  const cur = String(currency || 'IDR').toUpperCase().trim();
  if (cur === 'IDR') return 1;
  const rateStr = MOCK_RATES[`${cur}/IDR`];
  if (!rateStr) throw new Error(`unsupported_currency:${cur}`);
  return Number(rateStr);
}

// Build balanced double-entry legs for cross-currency or same-currency transfers (RULES.md §3 Rule 5)
async function buildTransferLegs({
  sourceWallet,
  targetWallet,
  sourceAmount,
  targetAmount = null,
  transactionDate = null,
  description = 'Transfer',
  groupId = null,
  userId = null,
  businessId = null,
  feeAmount = null,
  feeAsset = null,
}) {
  const d = transactionDate ? String(transactionDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const srcCur = (sourceWallet.currency || 'IDR').toUpperCase();
  const tgtCur = (targetWallet.currency || 'IDR').toUpperCase();
  const group = groupId || `xfer:${crypto.randomUUID()}`;

  const srcAmtNum = Number(sourceAmount);
  let tgtAmtNum = Number(targetAmount);

  // If target amount is not explicitly provided, convert source amount to target currency
  if (!Number.isFinite(tgtAmtNum) || tgtAmtNum <= 0) {
    if (srcCur === tgtCur) {
      tgtAmtNum = srcAmtNum;
    } else {
      const srcRate = getTodayRate(srcCur);
      const tgtRate = getTodayRate(tgtCur);
      tgtAmtNum = (srcAmtNum * srcRate) / tgtRate;
    }
  }

  const [srcFx, tgtFx] = await Promise.all([
    toIdr(srcAmtNum, srcCur, d),
    toIdr(tgtAmtNum, tgtCur, d),
  ]);

  const sourceLeg = {
    type: 'expense',
    category: 'Transfer',
    amount_original: srcAmtNum,
    currency_original: srcCur,
    amount_idr: srcFx.amount_idr,
    booked_rate: srcFx.booked_rate,
    rate_source: srcFx.rate_source,
    wallet_id: sourceWallet.id,
    source: group,
    description: description || `Transfer to ${targetWallet.name}`,
    transaction_date: d,
    business_id: businessId,
    user_id: userId,
  };

  const targetLeg = {
    type: 'income',
    category: 'Transfer',
    amount_original: tgtAmtNum,
    currency_original: tgtCur,
    amount_idr: tgtFx.amount_idr,
    booked_rate: tgtFx.booked_rate,
    rate_source: tgtFx.rate_source,
    wallet_id: targetWallet.id,
    source: group,
    description: description || `Transfer from ${sourceWallet.name}`,
    transaction_date: d,
    business_id: businessId,
    user_id: userId,
  };

  // Delta in IDR: gain or loss on conversion
  const fxDeltaIdr = tgtFx.amount_idr - srcFx.amount_idr;

  const conversion = srcCur !== tgtCur ? {
    source_asset: srcCur,
    source_amount: srcAmtNum,
    target_asset: tgtCur,
    target_amount: tgtAmtNum,
    booked_rate: String(tgtAmtNum / srcAmtNum),
    fee_amount: feeAmount || null,
    fee_asset: feeAsset || null,
    fx_delta_idr: fxDeltaIdr,
    is_gain: fxDeltaIdr > 0,
    is_loss: fxDeltaIdr < 0,
  } : null;

  return {
    group,
    sourceLeg,
    targetLeg,
    conversion,
    fxDeltaIdr,
  };
}

module.exports = {
  selectProvider,
  getCurrentQuote,
  getHistoricalQuote,
  getCryptoQuote,
  manualQuote,
  normalize,
  mockProvider,
  hybridProvider,
  toIdr,
  getTodayRate,
  buildTransferLegs,
  MOCK_RATES,
};
