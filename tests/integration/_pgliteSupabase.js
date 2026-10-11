// Minimal supabase-js-compatible client backed by PGlite, supporting exactly the
// query shapes used by server/routes/personalFunding.js. This lets the REAL Express
// router run end-to-end over HTTP against real SQL + the real 037/038/039 RPCs,
// with no Docker/local-Supabase required. Not a general PostgREST emulator.
const { PGlite } = require('@electric-sql/pglite');

function ident(s) { return '"' + String(s).replace(/"/g, '') + '"'; }
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

class Query {
  constructor(db, table) { this.db = db; this.table = table; this._filters = []; this._embed = null; this._limit = null; this._order = null; this._single = false; this._maybeSingle = false; this._op = null; this._values = null; this._returning = false; this._onConflict = null; }
  select(cols = '*') {
    this._op = this._op || 'select';
    if (this._op === 'select') {
      const m = /([a-z_]+)\s*(?:!inner)?\s*\(/i.exec(cols || '');
      // embedded resource like businesses(*) or businesses!inner(...)
      const em = /(businesses)\s*!?(?:inner)?\s*\(/i.exec(cols || '');
      if (em) this._embed = 'businesses';
    } else { this._returning = true; }
    return this;
  }
  insert(values) { this._op = 'insert'; this._values = values; return this; }
  upsert(values, opts = {}) { this._op = 'upsert'; this._values = values; this._onConflict = opts.onConflict || null; return this; }
  update(values) { this._op = 'update'; this._values = values; return this; }
  eq(col, val) { this._filters.push([col, '=', val]); return this; }
  in(col, arr) { this._filters.push([col, 'in', arr]); return this; }
  like(col, pat) { this._filters.push([col, 'like', pat]); return this; }
  order(col, opts = {}) { this._order = `${ident(col)} ${opts.ascending === false ? 'DESC' : 'ASC'}`; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }
  _where() {
    if (!this._filters.length) return '';
    const parts = this._filters.map(([c, op, v]) => {
      if (op === 'in') return `${ident(c)} IN (${(v.length ? v : [null]).map(lit).join(',')})`;
      if (op === 'like') return `${ident(c)} LIKE ${lit(v)}`;
      return `${ident(c)} = ${lit(v)}`;
    });
    return ' WHERE ' + parts.join(' AND ');
  }
  async _run() {
    try {
      if (this._op === 'insert' || this._op === 'upsert') {
        const rows = Array.isArray(this._values) ? this._values : [this._values];
        const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
        const valuesSql = rows.map(r => '(' + cols.map(c => lit(r[c])).join(',') + ')').join(',');
        let sql = `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(',')}) VALUES ${valuesSql}`;
        if (this._op === 'upsert' && this._onConflict) {
          const conflict = this._onConflict.split(',').map(c => ident(c.trim())).join(',');
          const updates = cols.filter(c => !this._onConflict.split(',').map(x => x.trim()).includes(c));
          sql += ` ON CONFLICT (${conflict}) DO UPDATE SET ` + (updates.length ? updates.map(c => `${ident(c)}=EXCLUDED.${ident(c)}`).join(',') : `${ident(cols[0])}=EXCLUDED.${ident(cols[0])}`);
        } else if (this._op === 'upsert') {
          sql += ' ON CONFLICT DO NOTHING';
        }
        if (this._returning || this._single) sql += ' RETURNING *';
        const r = await this.db.query(sql);
        const data = this._single ? (r.rows[0] || null) : r.rows;
        return { data, error: null };
      }
      // select
      let sql = `SELECT * FROM ${ident(this.table)}${this._where()}`;
      if (this._order) sql += ` ORDER BY ${this._order}`;
      if (this._limit) sql += ` LIMIT ${this._limit}`;
      const r = await this.db.query(sql);
      let rows = r.rows;
      if (this._embed === 'businesses') {
        for (const row of rows) {
          const b = await this.db.query(`SELECT * FROM businesses WHERE id = ${lit(row.business_id)} LIMIT 1`);
          row.businesses = b.rows[0] || null;
        }
      }
      const data = (this._single || this._maybeSingle) ? (rows[0] || null) : rows;
      return { data, error: null };
    } catch (e) { return { data: null, error: { message: e.message } }; }
  }
  then(resolve, reject) { return this._run().then(resolve, reject); }
}

function makeClient(db) {
  return {
    _db: db,
    from(table) { return new Query(db, table); },
    async rpc(name, args = {}) {
      try {
        const keys = Object.keys(args);
        const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
        const params = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
        const r = await db.query(`SELECT * FROM ${name}(${named})`, params);
        return { data: r.rows, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };
}

async function createPgliteSupabase() {
  const db = new PGlite();
  return { db, supabase: makeClient(db) };
}

module.exports = { createPgliteSupabase, makeClient };
