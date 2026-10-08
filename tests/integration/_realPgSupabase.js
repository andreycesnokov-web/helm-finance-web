// A supabase-js-shaped client over a real pg Pool, for running the REAL Express routes against
// real PostgreSQL. Results are produced by PostgreSQL as JSON (like PostgREST), so numeric and
// bigint values arrive as JSON numbers. Every query takes a connection from the pool, so two
// concurrent HTTP requests really use two database connections. Covers the query shapes used by
// the bank-import routes and business resolution — it is not a general PostgREST emulator.
const { Pool } = require('pg');

const ident = (s) => '"' + String(s).replace(/"/g, '') + '"';

class Query {
  constructor(pool, table) {
    Object.assign(this, { pool, table, op: 'select', cols: '*', where: [], params: [], ord: null, lim: null,
      one: false, maybeOne: false, values: null, returning: false, countMode: null, head: false });
  }
  _p(v) { this.params.push(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)); return `$${this.params.length}`; }
  select(cols = '*', opts = {}) {
    if (this.op === 'select') { this.cols = cols; this.countMode = opts.count || null; this.head = !!opts.head; }
    else this.returning = true;
    return this;
  }
  insert(values) { this.op = 'insert'; this.values = values; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.where.push(`t.${ident(c)}::text = ${this._p(v)}`); return this; }
  neq(c, v) { this.where.push(`t.${ident(c)}::text IS DISTINCT FROM ${this._p(v)}`); return this; }
  in(c, arr) { this.where.push(`t.${ident(c)}::text = ANY(${this._p('{' + (arr || []).map(x => '"' + String(x).replace(/"/g, '\\"') + '"').join(',') + '}')}::text[])`); return this; }
  is(c, v) { this.where.push(`t.${ident(c)} IS ${v === null ? 'NULL' : v ? 'TRUE' : 'FALSE'}`); return this; }
  not(c, op, v) { if (op === 'is' && v === null) this.where.push(`t.${ident(c)} IS NOT NULL`); else throw new Error(`unsupported not(${op})`); return this; }
  gte(c, v) { this.where.push(`t.${ident(c)} >= ${this._p(v)}`); return this; }
  lte(c, v) { this.where.push(`t.${ident(c)} <= ${this._p(v)}`); return this; }
  or(expr) {
    const parts = String(expr).split(',').map((term) => {
      const m = /^([a-z_]+)\.(eq|is)\.(.*)$/i.exec(term.trim());
      if (!m) throw new Error(`unsupported or() term ${term}`);
      return m[2] === 'is' ? `t.${ident(m[1])} IS ${m[3] === 'null' ? 'NULL' : m[3]}` : `t.${ident(m[1])}::text = ${this._p(m[3])}`;
    });
    this.where.push('(' + parts.join(' OR ') + ')');
    return this;
  }
  order(c, opts = {}) { this.ord = `t.${ident(c)} ${opts.ascending === false ? 'DESC' : 'ASC'}`; return this; }
  limit(n) { this.lim = Number(n); return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.maybeOne = true; return this; }

  _selectList() {
    const out = [];
    for (const raw of String(this.cols).split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean)) {
      const emb = /^([a-z_]+)(?:!inner)?\((.*)\)$/i.exec(raw);
      if (emb) {   // embedded parent, e.g. businesses(*) via business_id
        const parent = emb[1];
        const fk = (/ies$/.test(parent) ? parent.replace(/ies$/, 'y') : /(ss|x|ch|sh)es$/.test(parent) ? parent.replace(/es$/, '') : parent.replace(/s$/, '')) + '_id';
        out.push(`(SELECT to_json(e) FROM public.${ident(parent)} e WHERE e.id = t.${ident(fk)}) AS ${ident(parent)}`);
      } else out.push(raw === '*' ? 't.*' : `t.${ident(raw)}`);
    }
    return out.join(', ');
  }
  _where() { return this.where.length ? ' WHERE ' + this.where.join(' AND ') : ''; }

  async _run() {
    const T = `public.${ident(this.table)}`;
    let sql;
    if (this.op === 'select') {
      if (this.head) {
        sql = `SELECT json_build_array(json_build_object('n', count(*))) AS j FROM ${T} t${this._where()}`;
      } else {
        sql = `SELECT coalesce(json_agg(q), '[]'::json) AS j FROM (SELECT ${this._selectList()} FROM ${T} t${this._where()}`
          + (this.ord ? ` ORDER BY ${this.ord}` : '') + (this.lim ? ` LIMIT ${this.lim}` : '') + ') q';
      }
    } else if (this.op === 'insert') {
      const rows = Array.isArray(this.values) ? this.values : [this.values];
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].map(ident).join(', ');
      sql = `WITH t AS (INSERT INTO ${T} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${T}, ${this._p(rows)}::json) RETURNING *) SELECT coalesce(json_agg(t), '[]'::json) AS j FROM t`;
    } else if (this.op === 'update') {
      const cols = Object.keys(this.values).map(ident).join(', ');
      const v = this._p(this.values);
      sql = `WITH u AS (UPDATE ${T} t SET (${cols}) = (SELECT ${cols} FROM json_populate_record(NULL::${T}, ${v}::json))${this._where()} RETURNING t.*) SELECT coalesce(json_agg(u), '[]'::json) AS j FROM u`;
    } else if (this.op === 'delete') {
      sql = `WITH d AS (DELETE FROM ${T} t${this._where()} RETURNING t.*) SELECT coalesce(json_agg(d), '[]'::json) AS j FROM d`;
    }
    try {
      const r = await this.pool.query(sql, this.params);
      let rows = r.rows[0].j;
      if (typeof rows === 'string') rows = JSON.parse(rows);
      if (this.head) return { data: null, count: Number(rows[0].n), error: null };
      if (this.one) {
        if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: rows[0], error: null };
      }
      if (this.maybeOne) return { data: rows[0] || null, error: null };
      return { data: this.op === 'select' || this.returning ? rows : null, error: null, count: this.countMode ? rows.length : undefined };
    } catch (e) {
      if (process.env.DEBUG_SQL) console.log('SQLERR', this.op, this.table, e.message);
      return { data: null, error: { message: e.message, code: e.code } };
    }
  }
  then(resolve, reject) { return this._run().then(resolve, reject); }
}

function createRealPgSupabase(connectionString) {
  const pool = new Pool({ connectionString, max: 8 });
  return {
    pool,
    from: (table) => new Query(pool, table),
    async rpc(fn, args = {}) {
      const params = [];
      const named = Object.entries(args).map(([k, v]) => {
        params.push(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
        return `${ident(k)} => $${params.length}`;
      });
      try {
        const r = await pool.query(`SELECT to_json(public.${ident(fn)}(${named.join(', ')})) AS j`, params);
        let data = r.rows[0].j;
        if (typeof data === 'string') data = JSON.parse(data);
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code } };
      }
    },
    storage: { from: () => ({}) },
    auth: {},
  };
}

module.exports = { createRealPgSupabase };
