// FX rate provider abstraction. Config-driven (env FX_PROVIDER). Returns normalized
// quotes with decimal STRINGS (never floats). The deterministic mock is for tests
// only — NO commercial provider is connected to production in this checkpoint.
// AI is never a rate source; quotes come from here (or an audited manual override).
const T = require('./transactionClass');

// Deterministic demo rates (base→quote). Strings only.
const MOCK_RATES = {
  'USD/IDR': '16300', 'IDR/USD': '0.000061349693251533',
  'USD/USDT': '1.0005', 'USDT/USD': '0.99950024987506',
  'USDT/IDR': '16290', 'IDR/USDT': '0.000061387354205033',
  'BTC/USD': '64000.00', 'USD/BTC': '0.0000156250',
  'ETH/USD': '3400.00', 'USD/ETH': '0.000294117647058824',
};
function mockRate(base, quote) {
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

const PROVIDERS = { mock: mockProvider };
function selectProvider() {
  const name = process.env.FX_PROVIDER || 'mock';
  const p = PROVIDERS[name];
  if (!p) throw new Error(`fx_provider_not_configured:${name}`);
  return p;   // NOTE: only the mock exists here; no commercial provider in this checkpoint.
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

module.exports = { selectProvider, getCurrentQuote, getHistoricalQuote, getCryptoQuote, manualQuote, normalize, mockProvider };
