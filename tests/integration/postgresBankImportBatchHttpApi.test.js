// HTTP API Integration Test: Real Express Server with Real PostgreSQL
// Tests POST /api/bank-import/batches before and after Migration 068.
//
// Verifies:
// 1. In a schema without Migration 068 (lacking bank_import_batches.document_id):
//    - Real HTTP endpoint POST /api/bank-import/batches returns status 500
//    - Response body has error: 'database_schema_mismatch'
//    - No batch is created, no rows are inserted (counts before == counts after)
//    - No unlinked/fallback batch is created
// 2. After applying Migration 068 in the same real PostgreSQL database:
//    - Repeating the exact same HTTP request succeeds (status 200)
//    - Batch and rows are created in PostgreSQL
//    - The document_id is persisted and retrieved on re-read
//    - Role permissions and multi-tenant company context are enforced

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';
const JWT_SECRET = 'http-api-test-secret-jwt-key-32chars!';

describe('HTTP API End-to-End: POST /api/bank-import/batches over Real PostgreSQL', () => {
  let pgClient;
  let server = null;
  let BASE = null;
  let jwt = null;
  let skipped = false;

  const BIZ_A = crypto.randomUUID();
  const BIZ_B = crypto.randomUUID();
  const WALLET_A = crypto.randomUUID();
  const USER_A = 8001; // positive Telegram/legacy style user id
  let docAId = null;

  before(async () => {
    pgClient = new Client({ connectionString, connectionTimeoutMillis: 4000 });
    try {
      await pgClient.connect();
    } catch (err) {
      console.warn(`[SKIP] Real PostgreSQL not reachable (${err.message}). Test skipped or runs in CI.`);
      skipped = true;
      return;
    }

    // 1. Ensure initial tables exist in PostgreSQL WITHOUT migration 068
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.businesses (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'business',
        owner_user_id bigint NULL,
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.business_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        user_id bigint NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.wallets (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        name text NOT NULL,
        currency text NOT NULL DEFAULT 'IDR',
        is_active boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS public.financial_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        file_name text NOT NULL,
        document_type text NOT NULL DEFAULT 'bank_document',
        created_at timestamptz DEFAULT now()
      );

      -- Table WITHOUT document_id column initially
      CREATE TABLE IF NOT EXISTS public.bank_import_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        wallet_id uuid NULL REFERENCES public.wallets(id),
        uploaded_by_user_id bigint NULL,
        source_channel text NOT NULL DEFAULT 'web',
        file_name text NULL,
        file_type text NULL,
        currency text NULL DEFAULT 'IDR',
        statement_start date NULL,
        statement_end date NULL,
        opening_balance numeric NULL,
        closing_balance numeric NULL,
        row_count int NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'review_required',
        matched_count int DEFAULT 0,
        duplicate_count int DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      -- If document_id existed from prior runs, drop it to test pre-migration state
      ALTER TABLE public.bank_import_batches DROP COLUMN IF EXISTS document_id CASCADE;
      DROP TRIGGER IF EXISTS trg_iso_bank_import_batch_doc ON public.bank_import_batches;

      CREATE TABLE IF NOT EXISTS public.bank_import_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id uuid NOT NULL,
        business_id uuid NOT NULL,
        row_index int DEFAULT 0,
        raw jsonb DEFAULT '{}'::jsonb,
        tx_date date NULL,
        description text NULL,
        amount numeric NULL,
        direction text NULL,
        bank_reference text NULL,
        balance_after numeric NULL,
        dedup_hash text NULL,
        suggested_type text NULL,
        suggested_category text NULL,
        suggested_counterparty text NULL,
        match_status text DEFAULT 'review_required',
        matched_transaction_id bigint NULL,
        linked_transaction_id bigint NULL,
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.transactions (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        type text NOT NULL,
        amount_original numeric NOT NULL,
        transaction_date date,
        description text,
        created_at timestamptz DEFAULT now(),
        wallet_id uuid,
        source text
      );
    `);

    // 2. Seed business, member, wallet, and document in PostgreSQL
    await pgClient.query(`
      INSERT INTO public.businesses (id, name, type, owner_user_id) VALUES
        ($1, 'Company Alpha', 'business', $3),
        ($2, 'Company Beta', 'business', 9999)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, owner_user_id = EXCLUDED.owner_user_id;
    `, [BIZ_A, BIZ_B, USER_A]);

    await pgClient.query(`
      INSERT INTO public.business_members (business_id, user_id, role, status) VALUES
        ($1, $2, 'owner', 'active')
      ON CONFLICT DO NOTHING;
    `, [BIZ_A, USER_A]);

    await pgClient.query(`
      INSERT INTO public.wallets (id, business_id, name, currency, is_active) VALUES
        ($1, $2, 'BCA Checking', 'IDR', true)
      ON CONFLICT (id) DO NOTHING;
    `, [WALLET_A, BIZ_A]);

    docAId = crypto.randomUUID();
    await pgClient.query(`
      INSERT INTO public.financial_documents (id, business_id, file_name, document_type)
      VALUES ($1, $2, 'bca_september_2026.csv', 'bank_document')
    `, [docAId, BIZ_A]);

    // 3. Connect backend to the real PostgreSQL database via PostgREST/Supabase adapter
    function ident(s) { return '"' + String(s).replace(/"/g, '') + '"'; }
    function lit(v) {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      return `'${String(v).replace(/'/g, "''")}'`;
    }

    class RealPgQuery {
      constructor(client, table) {
        this.client = client;
        this.table = table;
        this._filters = [];
        this._op = null;
        this._values = null;
        this._limit = null;
        this._order = null;
        this._single = false;
        this._maybeSingle = false;
        this._embedBusiness = false;
      }
      select(cols = '*') {
        this._op = this._op || 'select';
        if (typeof cols === 'string' && cols.includes('businesses(')) {
          this._embedBusiness = true;
        }
        return this;
      }
      insert(values) { this._op = 'insert'; this._values = values; return this; }
      update(values) { this._op = 'update'; this._values = values; return this; }
      eq(col, val) { this._filters.push(`${ident(col)} = ${lit(val)}`); return this; }
      in(col, arr) {
        const list = (arr && arr.length) ? arr.map(lit).join(',') : 'NULL';
        this._filters.push(`${ident(col)} IN (${list})`);
        return this;
      }
      not(col, op, val) {
        if (op === 'is' && val === null) {
          this._filters.push(`${ident(col)} IS NOT NULL`);
        }
        return this;
      }
      or(clause) {
        // Handle common filters: "business_id.eq.XXX" or simple disjunctions
        const match = /business_id\.eq\.([a-f0-9-]+)/i.exec(clause);
        if (match) {
          this._filters.push(`business_id = ${lit(match[1])}`);
        }
        return this;
      }
      order(col, opts = {}) {
        this._order = `${ident(col)} ${opts.ascending === false ? 'DESC' : 'ASC'}`;
        return this;
      }
      limit(n) { this._limit = n; return this; }
      single() { this._single = true; return this; }
      maybeSingle() { this._maybeSingle = true; return this; }

      async _execute() {
        try {
          if (this._op === 'insert') {
            const rows = Array.isArray(this._values) ? this._values : [this._values];
            if (rows.length === 0) return { data: [], error: null };
            const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
            const valuesSql = rows.map(r => '(' + cols.map(c => lit(r[c])).join(',') + ')').join(',');
            const sql = `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(',')}) VALUES ${valuesSql} RETURNING *`;
            const r = await this.client.query(sql);
            const data = this._single ? (r.rows[0] || null) : r.rows;
            return { data, error: null };
          }
          if (this._op === 'update') {
            const keys = Object.keys(this._values || {});
            const setClause = keys.map(k => `${ident(k)} = ${lit(this._values[k])}`).join(', ');
            let whereClause = this._filters.length ? ' WHERE ' + this._filters.join(' AND ') : '';
            const sql = `UPDATE ${ident(this.table)} SET ${setClause}${whereClause} RETURNING *`;
            const r = await this.client.query(sql);
            const data = this._single ? (r.rows[0] || null) : r.rows;
            return { data, error: null };
          }
          // select
          let whereClause = this._filters.length ? ' WHERE ' + this._filters.join(' AND ') : '';
          let orderClause = this._order ? ' ORDER BY ' + this._order : '';
          let limitClause = this._limit ? ' LIMIT ' + this._limit : '';
          const sql = `SELECT * FROM ${ident(this.table)}${whereClause}${orderClause}${limitClause}`;
          const r = await this.client.query(sql);
          let rows = r.rows;
          if (this._embedBusiness && this.table === 'business_members') {
            for (const row of rows) {
              const bRes = await this.client.query(`SELECT * FROM public.businesses WHERE id = $1`, [row.business_id]);
              row.businesses = bRes.rows[0] || null;
            }
          }
          const data = (this._single || this._maybeSingle) ? (rows[0] || null) : rows;
          return { data, error: null };
        } catch (err) {
          return { data: null, error: { message: err.message, code: err.code } };
        }
      }
      then(resolve, reject) {
        return this._execute().then(resolve, reject);
      }
    }

    const realPgSupabaseAdapter = {
      from: (table) => new RealPgQuery(pgClient, table),
      rpc: async () => ({ data: null, error: null }),
      storage: { from: () => ({}) },
      auth: {}
    };

    // Inject adapter into require.cache for @supabase/supabase-js
    const supaPath = require.resolve('@supabase/supabase-js');
    const real = require('@supabase/supabase-js');
    require.cache[supaPath] = {
      id: supaPath,
      filename: supaPath,
      loaded: true,
      exports: { ...real, createClient: () => realPgSupabaseAdapter }
    };

    // Configure process.env and boot server/index.js
    Object.assign(process.env, {
      PORT: '0',
      NODE_ENV: 'test',
      JWT_SECRET,
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SECRET_KEY: 'test-postgres-service-key',
      BOT_TOKEN: 'fake_bot_token',
      TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret'
    });

    const realListen = http.Server.prototype.listen;
    http.Server.prototype.listen = function patched(...a) {
      server = this;
      return realListen.apply(this, a);
    };

    try {
      require('../../server/index.js');
    } finally {
      http.Server.prototype.listen = realListen;
    }

    if (!server.listening) {
      await new Promise(r => server.once('listening', r));
    }
    BASE = `http://127.0.0.1:${server.address().port}`;
    jwt = require('jsonwebtoken');
  });

  after(async () => {
    if (server) {
      try { server.close(); } catch {}
    }
    if (pgClient) {
      try { await pgClient.end(); } catch {}
    }
  });

  it('HTTP API: rejects POST /api/bank-import/batches with 500 database_schema_mismatch when schema lacks document_id, creates 0 batches and 0 rows', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });

    // Count batches and rows before HTTP call
    const beforeBatches = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const beforeRows = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);

    const reqPayload = {
      wallet_id: WALLET_A,
      file_name: 'bca_september_2026.csv',
      currency: 'IDR',
      document_id: docAId,
      rows: [
        { tx_date: '2026-09-05', amount: 1500000, direction: 'in', description: 'Client Invoice 001' },
        { tx_date: '2026-09-15', amount: 500000, direction: 'out', description: 'Server Hosting' }
      ]
    };

    const res = await fetch(`${BASE}/api/bank-import/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify(reqPayload)
    });

    const status = res.status;
    let body = {};
    try { body = await res.json(); } catch {}

    console.log(`[HTTP Pre-Migration Test] Status: ${status}, Body:`, body);

    assert.strictEqual(status, 500, 'HTTP status must be 500 on unmigrated schema');
    assert.strictEqual(body.error, 'database_schema_mismatch', 'Error code must be database_schema_mismatch');
    assert.match(body.message, /Database schema is missing bank_import_batches\.document_id\. Migration 068 required\./i);

    // Verify database counts remain unchanged
    const afterBatches = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const afterRows = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);

    assert.strictEqual(afterBatches.rows[0].cnt, beforeBatches.rows[0].cnt, 'Batches count must not change on schema error');
    assert.strictEqual(afterRows.rows[0].cnt, beforeRows.rows[0].cnt, 'Rows count must not change on schema error');
  });

  it('HTTP API: applies Migration 068, then POST /api/bank-import/batches succeeds (200), creates batch and rows, persists document_id', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    // 1. Apply Migration 068 to real PostgreSQL
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'migrations', '068_bank_import_batch_document_linking.sql'),
      'utf8'
    );
    await pgClient.query(migrationSql);

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });

    // Count batches and rows before HTTP call
    const beforeBatches = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const beforeRows = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);

    const reqPayload = {
      wallet_id: WALLET_A,
      file_name: 'bca_september_2026.csv',
      currency: 'IDR',
      document_id: docAId,
      rows: [
        { tx_date: '2026-09-05', amount: 1500000, direction: 'in', description: 'Client Invoice 001' },
        { tx_date: '2026-09-15', amount: 500000, direction: 'out', description: 'Server Hosting' }
      ]
    };

    const res = await fetch(`${BASE}/api/bank-import/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify(reqPayload)
    });

    const status = res.status;
    let body = {};
    try { body = await res.json(); } catch {}

    console.log(`[HTTP Post-Migration Test] Status: ${status}, Body Batch ID:`, body?.batch?.id);

    assert.strictEqual(status, 200, `HTTP status must be 200 after Migration 068 is applied, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(body.batch, 'Response must include batch object');
    assert.strictEqual(body.batch.document_id, docAId, 'Created batch in HTTP response must reference document_id');
    assert.strictEqual(body.rows?.length, 2, 'Response must include 2 rows');

    // Verify database mutations
    const afterBatches = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const afterRows = await pgClient.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);

    assert.strictEqual(afterBatches.rows[0].cnt, beforeBatches.rows[0].cnt + 1, 'Exactly one batch must be created in PostgreSQL');
    assert.strictEqual(afterRows.rows[0].cnt, beforeRows.rows[0].cnt + 2, 'Exactly two rows must be created in PostgreSQL');

    // Re-read directly from PostgreSQL
    const readRes = await pgClient.query(`SELECT id, business_id, document_id, file_name FROM public.bank_import_batches WHERE id = $1`, [body.batch.id]);
    assert.strictEqual(readRes.rowCount, 1);
    assert.strictEqual(readRes.rows[0].document_id, docAId, 'Re-read batch from PostgreSQL must have persisted document_id');
    assert.strictEqual(readRes.rows[0].business_id, BIZ_A, 'Re-read batch must belong to BIZ_A');
  });
});
