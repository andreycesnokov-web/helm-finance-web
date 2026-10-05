// FX rate provider abstraction. Config-driven (env FX_PROVIDER). Returns normalized
// quotes with decimal STRINGS (never floats) or numbers for valuation.
// Sources:
// - Bank Indonesia JISDOR (Jakarta Interbank Spot Dollar Rate) for USD/IDR official fixing.
// - ExchangeRate-API (Central Bank feeds / Open Exchange Rates) for EUR, SGD, MYR, THB, CNY, AUD, GBP, JPY.
// - CoinGecko for USDT (crypto market price; never equated 1:1 to USD).
// - Deterministic mock provider for tests when FX_PROVIDER='mock'.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('./transactionClass');

// Deterministic demo rates (base→quote). Strings only.
const MOCK_RATES = {
  'USD/IDR': '16300', 'IDR/USD': '0.000061349693251533',
  'EUR/IDR': '17800', 'IDR/EUR': '0.000056179775280899',
  'SGD/IDR': '12500', 'IDR/SGD': '0.000080000000000000',
  'USDT/IDR': '16290', 'IDR/USDT': '0.000061387354205033',
  'MYR/IDR': '3850', 'IDR/MYR': '0.000259740259740260',
  'THB/IDR': '490', 'IDR/THB': '0.002040816326530612',
  'CNY/IDR': '2320', 'IDR/CNY': '0.000431034482758621',
  'AUD/IDR': '10800', 'IDR/AUD': '0.000092592592592593',
  'GBP/IDR': '21500', 'IDR/GBP': '0.000046511627906977',
  'JPY/IDR': '110', 'IDR/JPY': '0.009090909090909091',
  'USD/USDT': '1.0005', 'USDT/USD': '0.99950024987506',
  'EUR/USD': '1.0920', 'USD/EUR': '0.9157509157509158',
  'SGD/USD': '0.7668', 'USD/SGD': '1.3041210224308816',
  'BTC/USD': '64000.00', 'USD/BTC': '0.0000156250',
  'ETH/USD': '3400.00', 'USD/ETH': '0.000294117647058824',
};

const SUPPORTED_CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'USDT', 'MYR', 'THB', 'CNY', 'AUD', 'GBP', 'JPY'];

const ID_MONTHS = {
  januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
  juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12'
};

const isoNow = () => new Date().toISOString();
const plusMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

function parseIndonesianDate(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = ID_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function parseIndonesianAmount(str) {
  if (!str) return null;
  const clean = str.replace(/[^\d.,]/g, '').trim();
  const normalized = clean.replace(/\./g, '').replace(',', '.');
  const val = parseFloat(normalized);
  return Number.isFinite(val) ? val : null;
}

function parseJisdorHtml(html) {
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rawDate = match[1].replace(/<[^>]*>/g, '').trim();
    const rawRate = match[2].replace(/<[^>]*>/g, '').trim();
    const effectiveDate = parseIndonesianDate(rawDate);
    const rateVal = parseIndonesianAmount(rawRate);
    if (effectiveDate && rateVal) {
      return {
        currency: 'USD',
        pair: 'USD/IDR',
        rate: rateVal,
        rate_str: String(rateVal),
        rate_effective_date: effectiveDate,
        source: 'bi_jisdor',
        rate_type: 'official_fixing',
        raw_date_string: rawDate,
        raw_rate_string: rawRate,
      };
    }
  }
  return null;
}

// ── Cache & Persistence Management ──────────────────────────────────────────
const DEFAULT_CACHE_PATH = path.join(__dirname, '..', 'data', 'fx_rates_cache.json');
function getCacheFilePath() {
  if (process.env.FX_CACHE_FILE) return process.env.FX_CACHE_FILE;
  if ((process.env.NODE_ENV === 'test' || process.argv.some(a => String(a).includes('test'))) && !process.env.FX_LIVE_ENABLE_PROD_CACHE) {
    return path.join(__dirname, '..', 'data', 'test_fx_rates_cache.json');
  }
  return DEFAULT_CACHE_PATH;
}

class LiveFxState {
  constructor() {
    this.rates = new Map();
    this.metadata = {
      source: 'bi_jisdor_hybrid',
      primary_source: 'Bank Indonesia JISDOR (USD), ExchangeRate-API (Fiat), CoinGecko (USDT)',
      status: 'uninitialized',
      last_success_at: null,
      last_attempt_at: null,
      last_error: null,
      rate_effective_date: null,
      as_of_date: new Date().toISOString().slice(0, 10),
      currencies_available: [],
    };
    this.customConnector = null;
    this.schedulerTimer = null;
    this.isRefreshing = false;
    this.minRefreshIntervalMs = 5 * 60 * 1000; // 5 minutes throttle
    this.loadFromDisk();
    if (this.rates.size === 0) {
      this.initDefaultFixedRates();
    }
  }

  initDefaultFixedRates() {
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    this.rates.set('IDR', {
      currency: 'IDR',
      pair: 'IDR/IDR',
      direction: 'identity',
      rate: 1,
      rate_str: '1',
      source: 'base_currency',
      rate_type: 'base_currency',
      rate_effective_date: today,
      verified_at: today,
      retrieved_at: nowIso,
      calculated_at: nowIso,
      as_of: today,
      status: 'fresh',
      is_fixed_accounting: true,
    });
    for (const cur of ['USD', 'EUR', 'SGD', 'USDT', 'MYR', 'THB', 'CNY', 'AUD', 'GBP', 'JPY']) {
      const rateStr = MOCK_RATES[`${cur}/IDR`];
      if (rateStr) {
        this.rates.set(cur, {
          currency: cur,
          pair: `${cur}/IDR`,
          direction: 'base_to_quote',
          rate: Number(rateStr),
          rate_str: rateStr,
          source: 'fixed_accounting_table',
          rate_type: 'fixed_accounting_rate',
          rate_effective_date: null,
          verified_at: null,
          retrieved_at: nowIso,
          calculated_at: nowIso,
          as_of: today,
          status: 'fresh',
          is_fixed_accounting: true,
        });
      }
    }
    this.metadata.status = 'fixed_accounting_table';
    this.metadata.source = 'fixed_accounting_table';
    this.metadata.primary_source = 'Fixed Accounting Table';
    this.metadata.rate_effective_date = null;
    this.metadata.currencies_available = Array.from(this.rates.keys());
  }

  loadFromDisk() {
    try {
      const cachePath = getCacheFilePath();
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.rates && typeof data.rates === 'object') {
          this.rates.clear();
          for (const [cur, entry] of Object.entries(data.rates)) {
            this.rates.set(cur, entry);
          }
          if (data.metadata) {
            this.metadata = { ...this.metadata, ...data.metadata };
            // On reload from disk without network, mark as cached if not fresh
            if (this.metadata.status === 'fresh') {
              this.metadata.status = 'cached';
            }
          }
        }
      }
    } catch (_) {
      // Fail open: cache file missing or invalid JSON
    }
  }

  saveToDisk() {
    try {
      const cachePath = getCacheFilePath();
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serializableRates = {};
      for (const [cur, entry] of this.rates.entries()) {
        serializableRates[cur] = entry;
      }
      const payload = {
        version: 1,
        saved_at: isoNow(),
        metadata: this.metadata,
        rates: serializableRates,
      };
      fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_) {
      // Disk write failure shouldn't crash app (e.g. read-only container)
    }
  }

  setConnector(connectorFn) {
    this.customConnector = connectorFn;
  }

  reset() {
    this.rates.clear();
    this.metadata = {
      source: 'bi_jisdor_hybrid',
      primary_source: 'Bank Indonesia JISDOR (USD), ExchangeRate-API (Fiat), CoinGecko (USDT)',
      status: 'uninitialized',
      last_success_at: null,
      last_attempt_at: null,
      last_error: null,
      rate_effective_date: null,
      as_of_date: new Date().toISOString().slice(0, 10),
      currencies_available: [],
    };
    this.customConnector = null;
  }

  async fetchJisdorLive() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx', {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`jisdor_http_${res.status}`);
      const html = await res.text();
      const parsed = parseJisdorHtml(html);
      if (!parsed) throw new Error('jisdor_parse_failed');
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchExchangeRateApiLive() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`exchangerate_api_http_${res.status}`);
      const data = await res.json();
      if (!data || !data.rates || !data.rates.IDR) throw new Error('exchangerate_api_invalid_payload');
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchCoinGeckoUsdtLive() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr,usd&include_last_updated_at=true', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`coingecko_http_${res.status}`);
      const data = await res.json();
      if (!data?.tether?.idr) throw new Error('coingecko_invalid_payload');
      return data.tether;
    } finally {
      clearTimeout(timeout);
    }
  }

  isWeekendOrHolding(nowDate = new Date()) {
    const day = nowDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
    // Also Monday morning before 08:15 UTC (~15:15 WIB): JISDOR fixing not yet published today
    if (day === 0 || day === 6) return true;
    if (day === 1 && nowDate.getUTCHours() < 9) return true;
    return false;
  }

  async refreshRates({ force = false } = {}) {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = nowIso.slice(0, 10);

    // Throttle if not forced
    if (!force && this.metadata.last_attempt_at) {
      const elapsed = Date.now() - new Date(this.metadata.last_attempt_at).getTime();
      if (elapsed < this.minRefreshIntervalMs && this.rates.size > 0) {
        return { ok: true, rates: this.getRatesMap(), metadata: this.metadata };
      }
    }

    if (this.isRefreshing) {
      return { ok: true, rates: this.getRatesMap(), metadata: this.metadata };
    }
    this.isRefreshing = true;
    this.metadata.last_attempt_at = nowIso;
    this.metadata.as_of_date = today;

    // ── Setup base IDR rate ─────────────────────────────────────────────────
    const baseIdr = {
      currency: 'IDR',
      pair: 'IDR/IDR',
      direction: 'identity',
      rate: 1,
      rate_str: '1',
      source: 'base_currency',
      rate_type: 'base_currency',
      rate_effective_date: today,
      retrieved_at: nowIso,
      calculated_at: nowIso,
      as_of: today,
      status: 'fresh',
      is_fixed_accounting: true,
    };
    this.rates.set('IDR', baseIdr);

    // ── If mock provider is forced ──────────────────────────────────────────
    if (process.env.FX_PROVIDER === 'mock') {
      for (const cur of ['USD', 'EUR', 'SGD', 'USDT', 'MYR', 'THB', 'CNY', 'AUD', 'GBP', 'JPY']) {
        const rateStr = MOCK_RATES[`${cur}/IDR`];
        if (rateStr) {
          this.rates.set(cur, {
            currency: cur,
            pair: `${cur}/IDR`,
            direction: 'base_to_quote',
            rate: Number(rateStr),
            rate_str: rateStr,
            source: 'fixed_accounting_table',
            rate_type: 'fixed_accounting_rate',
            rate_effective_date: null,
            retrieved_at: nowIso,
            calculated_at: nowIso,
            as_of: today,
            status: 'fresh',
            is_fixed_accounting: true,
          });
        }
      }
      this.metadata.status = 'fresh';
      this.metadata.source = 'fixed_accounting_table';
      this.metadata.primary_source = 'Deterministic test fixture';
      this.metadata.last_success_at = nowIso;
      this.metadata.last_error = null;
      this.metadata.currencies_available = Array.from(this.rates.keys());
      this.isRefreshing = false;
      this.saveToDisk();
      return { ok: true, rates: this.getRatesMap(), metadata: this.metadata };
    }

    // ── Custom connector injection for tests ────────────────────────────────
    if (this.customConnector) {
      try {
        const connResult = await this.customConnector();
        if (connResult && connResult.rates) {
          for (const [cur, entry] of Object.entries(connResult.rates)) {
            this.rates.set(cur, entry);
          }
          this.metadata.status = connResult.status || 'fresh';
          this.metadata.last_success_at = nowIso;
          this.metadata.last_error = null;
          this.metadata.rate_effective_date = connResult.rate_effective_date || today;
          this.metadata.currencies_available = Array.from(this.rates.keys());
          this.isRefreshing = false;
          this.saveToDisk();
          return { ok: true, rates: this.getRatesMap(), metadata: this.metadata };
        }
      } catch (err) {
        this.metadata.last_error = err.message;
        if (this.rates.size > 1) {
          this.metadata.status = 'stale';
        } else {
          this.metadata.status = 'failed';
        }
        this.isRefreshing = false;
        return { ok: false, error: err.message, rates: this.getRatesMap(), metadata: this.metadata };
      }
    }

    // ── Live Network Execution ──────────────────────────────────────────────
    let jisdorResult = null;
    let fiatResult = null;
    let cryptoResult = null;
    const errors = [];

    const [pJisdor, pFiat, pCrypto] = await Promise.allSettled([
      this.fetchJisdorLive(),
      this.fetchExchangeRateApiLive(),
      this.fetchCoinGeckoUsdtLive(),
    ]);

    if (pJisdor.status === 'fulfilled') jisdorResult = pJisdor.value;
    else errors.push(`jisdor: ${pJisdor.reason.message}`);

    if (pFiat.status === 'fulfilled') fiatResult = pFiat.value;
    else errors.push(`fiat: ${pFiat.reason.message}`);

    if (pCrypto.status === 'fulfilled') cryptoResult = pCrypto.value;
    else errors.push(`crypto: ${pCrypto.reason.message}`);

    let hasAnySuccess = false;

    // 1. USD: priority Bank Indonesia JISDOR
    if (jisdorResult) {
      this.rates.set('USD', {
        currency: 'USD',
        pair: 'USD/IDR',
        direction: 'base_to_quote',
        rate: jisdorResult.rate,
        rate_str: String(jisdorResult.rate),
        source: 'bi_jisdor',
        rate_type: 'official_fixing',
        rate_effective_date: jisdorResult.rate_effective_date,
        retrieved_at: nowIso,
        calculated_at: nowIso,
        as_of: today,
        status: 'fresh',
        is_fixed_accounting: false,
      });
      this.metadata.rate_effective_date = jisdorResult.rate_effective_date;
      hasAnySuccess = true;
    } else if (fiatResult && fiatResult.rates?.IDR) {
      // Fallback USD rate from ExchangeRate-API with honest source
      const effectiveDate = new Date(fiatResult.time_last_update_utc).toISOString().slice(0, 10);
      this.rates.set('USD', {
        currency: 'USD',
        pair: 'USD/IDR',
        direction: 'base_to_quote',
        rate: Number(fiatResult.rates.IDR),
        rate_str: String(fiatResult.rates.IDR),
        source: 'exchangerate_api',
        rate_type: 'market_api',
        rate_effective_date: effectiveDate,
        retrieved_at: nowIso,
        calculated_at: nowIso,
        as_of: today,
        status: 'fresh',
        is_fixed_accounting: false,
      });
      hasAnySuccess = true;
    }

    // 2. Fiat: ExchangeRate-API
    if (fiatResult && fiatResult.rates) {
      const effectiveDate = new Date(fiatResult.time_last_update_utc).toISOString().slice(0, 10);
      const idrBase = Number(fiatResult.rates.IDR);
      for (const cur of ['EUR', 'SGD', 'MYR', 'THB', 'CNY', 'AUD', 'GBP', 'JPY']) {
        const curPerUsd = Number(fiatResult.rates[cur]);
        if (curPerUsd > 0) {
          const rateToIdr = idrBase / curPerUsd;
          this.rates.set(cur, {
            currency: cur,
            pair: `${cur}/IDR`,
            direction: 'base_to_quote',
            rate: Math.round(rateToIdr * 10000) / 10000,
            rate_str: String(rateToIdr),
            source: 'exchangerate_api',
            rate_type: 'market_api',
            rate_effective_date: effectiveDate,
            retrieved_at: nowIso,
            calculated_at: nowIso,
            as_of: today,
            status: 'fresh',
            is_fixed_accounting: false,
          });
        }
      }
      hasAnySuccess = true;
    }

    // 3. USDT: CoinGecko (Never equated automatically to USD)
    if (cryptoResult && cryptoResult.idr) {
      const effectiveDate = cryptoResult.last_updated_at
        ? new Date(cryptoResult.last_updated_at * 1000).toISOString().slice(0, 10)
        : today;
      this.rates.set('USDT', {
        currency: 'USDT',
        pair: 'USDT/IDR',
        direction: 'base_to_quote',
        rate: Number(cryptoResult.idr),
        rate_str: String(cryptoResult.idr),
        rate_usd: Number(cryptoResult.usd),
        source: 'coingecko',
        rate_type: 'crypto_market_api',
        rate_effective_date: effectiveDate,
        retrieved_at: nowIso,
        calculated_at: nowIso,
        as_of: today,
        status: 'fresh',
        is_fixed_accounting: false,
      });
      hasAnySuccess = true;
    }

    if (hasAnySuccess) {
      this.metadata.source = 'bi_jisdor_hybrid';
      this.metadata.primary_source = 'Bank Indonesia JISDOR (USD), ExchangeRate-API (Fiat), CoinGecko (USDT)';
      this.metadata.last_success_at = nowIso;
      this.metadata.last_error = errors.length ? errors.join('; ') : null;
      if (this.isWeekendOrHolding(now)) {
        this.metadata.status = 'weekend_holding';
      } else {
        this.metadata.status = errors.length ? 'degraded' : 'fresh';
      }
      this.metadata.currencies_available = Array.from(this.rates.keys());
      this.saveToDisk();
    } else {
      this.metadata.last_error = errors.join('; ') || 'all_sources_failed';
      // If cached rates existed, preserve them with stale status
      if (this.rates.size > 1) {
        this.metadata.status = 'stale';
      } else {
        this.metadata.status = 'failed';
      }
    }

    this.isRefreshing = false;
    return {
      ok: hasAnySuccess,
      error: this.metadata.last_error,
      rates: this.getRatesMap(),
      metadata: this.metadata,
    };
  }

  getQuote(currency) {
    const cur = String(currency || 'IDR').toUpperCase().trim();
    return this.rates.get(cur) || null;
  }

  getRatesMap(asOfDate = null, calculatedAt = null) {
    const asOf = asOfDate || this.metadata.as_of_date || new Date().toISOString().slice(0, 10);
    const calcAt = calculatedAt || new Date().toISOString();
    const map = {};

    for (const cur of SUPPORTED_CURRENCIES) {
      const q = this.rates.get(cur);
      if (q) {
        map[cur] = {
          ...q,
          as_of: asOf,
          calculated_at: calcAt,
          date: asOf,
          verified_at: cur === 'IDR' ? asOf : (q.verified_at !== undefined ? q.verified_at : q.rate_effective_date),
        };
      }
    }
    return map;
  }

  getMetadata() {
    return { ...this.metadata };
  }

  initScheduler(intervalMs = 3600000) { // Default: 1 hour
    if (this.schedulerTimer) return;
    // Initial async refresh in background (don't block)
    this.refreshRates().catch(() => {});
    this.schedulerTimer = setInterval(() => {
      this.refreshRates().catch(() => {});
    }, intervalMs);
    // Unref so timer doesn't keep node test or script alive
    if (this.schedulerTimer && typeof this.schedulerTimer.unref === 'function') {
      this.schedulerTimer.unref();
    }
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}

const liveState = new LiveFxState();

// ── Legacy Compatibility & Public API ───────────────────────────────────────
function mockRate(base, quote) {
  if (base === quote) return '1';
  const r = MOCK_RATES[`${base}/${quote}`];
  if (!r) throw new Error(`no_rate_for_pair:${base}/${quote}`);
  return r;
}

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
    valid_until: valid_until || plusMinutes(2),
    rate_effective_date: rate_effective_date || null,
    source_type: source_type || 'market_api',
    manual_reason: manual_reason || null,
    raw_metadata: { engine: provider },
  };
}

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
    return normalize({ provider: 'mock', base, quote, rate: mockRate(base, quote), source_type: 'exchange_rate', valid_until: plusMinutes(0.5) });
  },
};

const hybridProvider = {
  name: 'hybrid',
  async getCurrentQuote(base, quote) {
    const cur = String(base).toUpperCase();
    const q = liveState.getQuote(cur);
    if (q && q.rate != null && quote === 'IDR') {
      return normalize({
        provider: q.source,
        base: cur,
        quote: 'IDR',
        rate: String(q.rate),
        source_type: q.rate_type || 'market_api',
        rate_effective_date: q.rate_effective_date,
      });
    }
    // Fall back to mock if rate not available
    return mockProvider.getCurrentQuote(base, quote);
  },
  async getHistoricalQuote(base, quote, effectiveDate) {
    // If quote on effectiveDate matches live/cached effectiveDate
    const cur = String(base).toUpperCase();
    const q = liveState.getQuote(cur);
    if (q && q.rate_effective_date === effectiveDate && quote === 'IDR') {
      return normalize({
        provider: q.source,
        base: cur,
        quote: 'IDR',
        rate: String(q.rate),
        source_type: q.rate_type || 'market_api',
        rate_effective_date: effectiveDate,
      });
    }
    return mockProvider.getHistoricalQuote(base, quote, effectiveDate);
  },
  async getCryptoQuote(base, quote) {
    const cur = String(base).toUpperCase();
    const q = liveState.getQuote(cur);
    if (q && q.rate != null && quote === 'IDR') {
      return normalize({
        provider: q.source,
        base: cur,
        quote: 'IDR',
        rate: String(q.rate),
        source_type: 'exchange_rate',
        valid_until: plusMinutes(0.5),
        rate_effective_date: q.rate_effective_date,
      });
    }
    return mockProvider.getCryptoQuote(base, quote);
  },
};

const PROVIDERS = { mock: mockProvider, hybrid: hybridProvider };
function selectProvider() {
  const name = process.env.FX_PROVIDER || 'hybrid';
  const p = PROVIDERS[name] || PROVIDERS.hybrid;
  return p;
}

const getCurrentQuote = (base, quote) => selectProvider().getCurrentQuote(base, quote);
const getHistoricalQuote = (base, quote, effectiveDate) => selectProvider().getHistoricalQuote(base, quote, effectiveDate);
const getCryptoQuote = (base, quote) => selectProvider().getCryptoQuote(base, quote);

function manualQuote({ base, quote, rate, source, reason, actor, effectiveDate }) {
  if (!reason) throw new Error('manual_rate_requires_reason');
  if (actor === undefined || actor === null) throw new Error('manual_rate_requires_actor');
  if (!source) throw new Error('manual_rate_requires_source');
  const q = normalize({ provider: source, base, quote, rate, source_type: 'manual', manual_reason: reason, rate_effective_date: effectiveDate || null });
  q.created_by_user_id = actor;
  return q;
}

// ── Unified toIdr helper (RULES.md §3 Rule 2) ───────────────────────────────
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

  // 1. Check live provider state
  const q = liveState.getQuote(cur);
  if (q && q.rate != null && Number.isFinite(Number(q.rate))) {
    return Number(q.rate);
  }

  // 2. Fall back to mock table if in mock mode or fallback configured
  if (process.env.FX_PROVIDER === 'mock' || !liveState.rates.size) {
    const rateStr = MOCK_RATES[`${cur}/IDR`];
    if (rateStr) return Number(rateStr);
  }

  throw new Error(`unsupported_currency:${cur}`);
}

function getQuote(currency) {
  const cur = String(currency || 'IDR').toUpperCase().trim();
  if (cur === 'IDR') {
    return liveState.getQuote('IDR') || {
      currency: 'IDR', pair: 'IDR/IDR', direction: 'identity', rate: 1, rate_str: '1',
      source: 'base_currency', rate_type: 'base_currency', is_fixed_accounting: true,
      rate_effective_date: new Date().toISOString().slice(0, 10)
    };
  }
  return liveState.getQuote(cur);
}

function getRatesMap(asOfDate = null, calculatedAt = null) {
  return liveState.getRatesMap(asOfDate, calculatedAt);
}

function getProviderMetadata() {
  return liveState.getMetadata();
}

function refreshRates(opts) {
  return liveState.refreshRates(opts);
}

function initScheduler(intervalMs) {
  liveState.initScheduler(intervalMs);
}

function stopScheduler() {
  liveState.stopScheduler();
}

function setMockConnector(connectorFn) {
  liveState.setConnector(connectorFn);
}

function resetProviderState() {
  liveState.reset();
}

// Build balanced double-entry legs for cross-currency transfers (RULES.md §3 Rule 5)
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
  getQuote,
  getRatesMap,
  getProviderMetadata,
  refreshRates,
  initScheduler,
  stopScheduler,
  setMockConnector,
  resetProviderState,
  parseJisdorHtml,
  parseIndonesianDate,
  parseIndonesianAmount,
  buildTransferLegs,
  MOCK_RATES,
  SUPPORTED_CURRENCIES,
  LiveFxState,
};
