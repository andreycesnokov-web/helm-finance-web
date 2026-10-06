// Minimal supabase-js-compatible client backed by plain JavaScript objects.
//
// COMPLEMENTS _pgliteSupabase.js, it does not replace it. Use PGlite when the test
// needs REAL SQL semantics (constraints, FKs, triggers, RPCs). Use this one when the
// test needs to boot the whole of server/index.js, which _pgliteSupabase cannot do
// because it implements neither `.or()` nor `.gte()` — both of which the Pulse and
// business-scoping code paths depend on.
//
// WHAT THIS IS: enough of the PostgREST query-builder surface to let the real Express
// routes run, so route logic, auth, the business resolver and server-side field
// stamping are all exercised for real, and every written row can be inspected.
//
// WHAT THIS IS NOT: a database. No RLS, no CHECK/FK constraints, no triggers, no
// types. A test that depends on any of those belongs on PGlite or a real Supabase.
//
// Usage — inject before requiring the server:
//   const Module = require('module');
//   const mem = require('./_memorySupabase');
//   const orig = Module._load;
//   Module._load = function (r) { return r === '@supabase/supabase-js' ? mem : orig.apply(this, arguments); };
const crypto = require('crypto');

const DB = {};                       // table -> rows[]
const seq = {};                      // table -> integer id counter
const table = (t) => (DB[t] ||= []);
const nextId = (t) => (seq[t] = (seq[t] || 0) + 1);

function applyEmbeds(t, rows, cols) {
  // Supports `businesses(*)` on business_members and `official_sources(*)` on tax_rules.
  if (!cols) return rows;
  if (/businesses\s*\(/.test(cols)) {
    return rows.map((r) => ({ ...r, businesses: table('businesses').find((b) => b.id === r.business_id) || null }));
  }
  if (/official_sources\s*\(/.test(cols)) {
    return rows.map((r) => ({ ...r, official_sources: table('official_sources').find((s) => s.id === r.official_source_id) || null }));
  }
  return rows;
}

class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.filters = []; this.cols = '*'; this.opts = {}; this._limit = null; this._single = false; }
  select(cols = '*', opts = {}) { this.cols = cols; this.opts = opts; if (this.op === 'select') this.op = 'select'; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  upsert(row) { this.op = 'upsert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this; }
  neq(c, v) { this.filters.push((r) => String(r[c]) !== String(v)); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  in(c, vs) { this.filters.push((r) => vs.map(String).includes(String(r[c]))); return this; }
  is(c, v) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  // PostgREST LIKE: % is the wildcard. Used by the entitlement/addon lookups.
  // Split on % first, escape each literal segment, then rejoin with .* so a % in the
  // pattern can never be mistaken for a regex metacharacter.
  like(c, pat) {
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('^' + String(pat).split('%').map(esc).join('.*') + '$');
    this.filters.push((r) => rx.test(String(r[c] == null ? '' : r[c])));
    return this;
  }
  ilike(c, pat) { return this.like(c, pat); }
  or(expr) {
    const parts = String(expr).split(',').map((p) => {
      const mNull = p.match(/^(\w+)\.is\.null$/);
      if (mNull) return (r) => r[mNull[1]] == null;
      const m = p.match(/^(\w+)\.eq\.(.*)$/);
      if (m) {
        const val = m[2];
        return (r) => {
          if (val === 'false') return r[m[1]] === false || r[m[1]] === 'false' || r[m[1]] == null;
          if (val === 'true') return r[m[1]] === true || r[m[1]] === 'true';
          return String(r[m[1]]) === val;
        };
      }
      return () => false;
    });
    this.filters.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._single = true; this._maybe = true; return this; }

  _run() {
    const rows = table(this.t);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const made = list.map((r) => ({ id: r.id ?? nextId(this.t), created_at: new Date().toISOString(), ...r }));
      rows.push(...made);
      const out = this._single ? made[0] : made;
      return { data: out, error: null };
    }
    if (this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const made = list.map((r) => {
        const key = r.id != null ? 'id' : (r.user_id != null ? 'user_id' : null);
        const existing = key ? rows.find((x) => String(x[key]) === String(r[key])) : null;
        if (existing) {
          Object.assign(existing, r);
          return existing;
        }
        const created = { id: r.id ?? nextId(this.t), created_at: new Date().toISOString(), ...r };
        rows.push(created);
        return created;
      });
      const out = this._single ? made[0] : made;
      return { data: out, error: null };
    }
    if (this.op === 'update') {
      const hit = match(); hit.forEach((r) => Object.assign(r, this.payload));
      return { data: this._single ? hit[0] ?? null : hit, error: null };
    }
    if (this.op === 'delete') {
      const hit = match(); DB[this.t] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    }
    let hit = match();
    if (this.opts.count === 'exact' && this.opts.head) return { data: null, error: null, count: hit.length };
    if (this._limit != null) hit = hit.slice(0, this._limit);
    hit = applyEmbeds(this.t, hit, this.cols);
    if (this._single) {
      if (hit.length !== 1 && !this._maybe) return { data: hit[0] ?? null, error: hit.length ? null : { message: 'no rows' } };
      return { data: hit[0] ?? null, error: null };
    }
    return { data: hit, error: null, count: hit.length };
  }
  then(res, rej) { try { return Promise.resolve(this._run()).then(res, rej); } catch (e) { return Promise.resolve({ data: null, error: { message: e.message } }).then(res, rej); } }
}

const client = {
  from: (t) => new Q(t),
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }) }) },
  rpc: async (name, args = {}) => {
    if (name === 'rpc_execute_wallet_transfer') {
      const {
        p_business_id,
        p_user_id,
        p_from_wallet_id,
        p_to_wallet_id,
        p_source_amount,
        p_source_currency,
        p_source_amount_idr,
        p_source_booked_rate,
        p_target_amount,
        p_target_currency,
        p_target_amount_idr,
        p_target_booked_rate,
        p_rate_source,
        p_description,
        p_transaction_date,
        p_transfer_id,
        p_scope,
      } = args;
      const txs = table('transactions');
      const existing = txs.filter((t) => t.transfer_id === p_transfer_id);
      if (existing.length > 0) {
        return {
          data: {
            ok: true,
            success: true,
            is_replay: true,
            transfer_id: p_transfer_id,
            debit_tx_id: existing[0]?.id,
            credit_tx_id: existing[1]?.id,
          },
          error: null,
        };
      }
      const fromW = table('wallets').find((w) => w.id === p_from_wallet_id);
      const toW = table('wallets').find((w) => w.id === p_to_wallet_id);
      const debitId = nextId('transactions');
      const creditId = nextId('transactions');
      const now = new Date().toISOString();
      const legOut = {
        id: debitId,
        business_id: p_business_id,
        created_by_user_id: p_user_id,
        wallet_id: p_from_wallet_id,
        source: fromW ? fromW.name : null,
        type: 'expense',
        amount_original: p_source_amount,
        currency_original: p_source_currency,
        amount_idr: p_source_amount_idr,
        booked_rate: p_source_booked_rate,
        rate_source: p_rate_source,
        description: p_description || `Transfer to ${toW?.name || ''}`,
        transaction_date: p_transaction_date || now.slice(0, 10),
        created_at: now,
        transfer_id: p_transfer_id,
        scope: p_scope || 'business',
      };
      const legIn = {
        id: creditId,
        business_id: p_business_id,
        created_by_user_id: p_user_id,
        wallet_id: p_to_wallet_id,
        source: toW ? toW.name : null,
        type: 'income',
        amount_original: p_target_amount,
        currency_original: p_target_currency,
        amount_idr: p_target_amount_idr,
        booked_rate: p_target_booked_rate,
        rate_source: p_rate_source,
        description: p_description || `Transfer from ${fromW?.name || ''}`,
        transaction_date: p_transaction_date || now.slice(0, 10),
        created_at: now,
        transfer_id: p_transfer_id,
        scope: p_scope || 'business',
      };
      txs.push(legOut, legIn);
      return {
        data: {
          ok: true,
          success: true,
          is_replay: false,
          transfer_id: p_transfer_id,
          debit_tx_id: debitId,
          credit_tx_id: creditId,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  },
};

module.exports = {
  createClient: () => client,
  __db: DB,
  __seed(t, rows) { table(t).push(...rows); return rows; },
  __uuid: () => crypto.randomUUID(),
};
