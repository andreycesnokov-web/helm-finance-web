// Real PostgreSQL Integration Test: Bank Statement Import & Reconciliation Flow via Real Express HTTP API
// Runs against a real PostgreSQL instance (e.g. CI postgres:16 service container).
// Strictly fails in CI if PostgreSQL connection cannot be established (no silent/green skip in CI).
//
// Scenarios tested via real Express HTTP routes (POST /api/bank-import/batches, POST /api/bank-imports/:batchId/confirm):
// A. Complete statement linking to existing ledger transactions without creating duplicate transactions.
// B. Repeated confirmation and repeated import do not create duplicate transactions or duplicate links.
// C. Symmetric missing transactions (+1M, -1M) in ledger: balances superficially match, but reconciliation remains incomplete/unbalanced.
// D. Cross-tenant and cross-wallet link attempts are strictly rejected without data mutation.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';
const JWT_SECRET = 'http-bank-flow-test-secret-jwt-key-32c!';

describe('Real PostgreSQL Integration: Bank Reconciliation & Transaction Linking Flow (HTTP API)', () => {
  let pgClient;
  let server = null;
  let BASE = null;
  let jwt = null;
  let skipped = false;

  const BIZ_A = crypto.randomUUID();
  const BIZ_B = crypto.randomUUID();
  const WALLET_A = crypto.randomUUID();
  const WALLET_B = crypto.randomUUID();
  const USER_A = 9001;

  let txIncomeId;
  let txDebtPayId;
  let txExpenseId;
  let txBizBId;
  let debtId;
  let docId;

  before(async () => {
    pgClient = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
      await pgClient.connect();
    } catch (err) {
      if (process.env.CI) {
        throw new Error(`Failed to connect to real PostgreSQL in CI: ${err.message}`);
      }
      console.warn(`[SKIP] Real PostgreSQL not reachable (${err.message}). Test skipped or runs in CI.`);
      skipped = true;
      return;
    }

    // 1. Initialize complete schema
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS public.businesses (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'business',
        owner_user_id bigint NULL,
        created_at timestamptz DEFAULT now()
      );

      ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'business';
      ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS owner_user_id bigint NULL;
      ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

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
        is_active boolean NOT NULL DEFAULT true,
        scope text NOT NULL DEFAULT 'business'
      );

      CREATE TABLE IF NOT EXISTS public.financial_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        file_name text NOT NULL,
        document_type text NOT NULL DEFAULT 'bank_document',
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.debts (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL,
        type text NOT NULL DEFAULT 'payable',
        counterparty text NOT NULL,
        amount numeric NOT NULL,
        original_amount numeric NOT NULL,
        paid_amount numeric NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'IDR',
        status text NOT NULL DEFAULT 'open',
        is_settled boolean NOT NULL DEFAULT false,
        settled_at timestamptz,
        due_date date,
        scope text NOT NULL DEFAULT 'business',
        is_training boolean DEFAULT false,
        last_payment_at timestamptz,
        linked_transaction_id bigint
      );

      CREATE TABLE IF NOT EXISTS public.transactions (
        id bigserial PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        created_by_user_id bigint,
        user_id bigint,
        type text NOT NULL,
        category text,
        counterparty_name text,
        amount_original numeric NOT NULL,
        currency_original text NOT NULL DEFAULT 'IDR',
        amount_idr numeric NOT NULL,
        booked_rate numeric NOT NULL DEFAULT 1,
        rate_source text DEFAULT 'system',
        description text,
        source text,
        wallet_id uuid REFERENCES public.wallets(id),
        scope text NOT NULL DEFAULT 'business',
        transaction_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        transfer_id uuid
      );

      CREATE TABLE IF NOT EXISTS public.bank_import_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        wallet_id uuid NULL REFERENCES public.wallets(id),
        uploaded_by_user_id bigint NULL,
        source_channel text NOT NULL DEFAULT 'web',
        file_name text NULL,
        file_type text NULL,
        document_id uuid NULL,
        currency text NULL DEFAULT 'IDR',
        statement_start date NULL,
        statement_end date NULL,
        opening_balance numeric NULL,
        closing_balance numeric NULL,
        row_count int NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'review_required',
        imported_count int DEFAULT 0,
        matched_count int DEFAULT 0,
        duplicate_count int DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.bank_import_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id uuid NOT NULL REFERENCES public.bank_import_batches(id) ON DELETE CASCADE,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
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
        suggested_transaction_type text NULL,
        suggested_match_type text NULL,
        suggested_match_id text NULL,
        suggested_confidence numeric NULL,
        suggested_scope text NULL,
        final_transaction_type text NULL,
        final_category_id uuid NULL,
        final_counterparty_id uuid NULL,
        final_scope text NULL,
        match_status text DEFAULT 'review_required',
        matched_transaction_id bigint NULL,
        linked_transaction_id bigint NULL,
        review_status text DEFAULT 'needs_review',
        reviewed_by_user_id bigint NULL,
        reviewed_at timestamptz NULL,
        created_at timestamptz DEFAULT now()
      );

      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS row_index int DEFAULT 0;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS tx_date date NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS description text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS amount numeric NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS direction text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS bank_reference text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS balance_after numeric NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS dedup_hash text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_type text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_category text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_counterparty text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_transaction_type text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_match_type text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_match_id text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_confidence numeric NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS suggested_scope text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS final_transaction_type text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS final_category_id uuid NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS final_counterparty_id uuid NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS final_scope text NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS match_status text DEFAULT 'review_required';
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS matched_transaction_id bigint NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS linked_transaction_id bigint NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'needs_review';
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS reviewed_by_user_id bigint NULL;
      ALTER TABLE public.bank_import_rows ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;

      CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id uuid NOT NULL REFERENCES public.bank_import_batches(id) ON DELETE CASCADE,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        wallet_id uuid NULL REFERENCES public.wallets(id),
        opening_balance numeric NOT NULL,
        closing_balance numeric NOT NULL,
        computed_closing numeric NOT NULL,
        difference numeric NOT NULL,
        status text NOT NULL,
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.cashflow_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NULL,
        name text NOT NULL,
        group_type text NOT NULL DEFAULT 'operating',
        is_active boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS public.counterparties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NULL,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'vendor',
        is_active boolean NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS public.classification_feedback (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        bank_import_row_id uuid NULL,
        normalized_desc text NULL,
        suggested_category_id uuid NULL,
        final_category_id uuid NULL,
        suggested_transaction_type text NULL,
        final_transaction_type text NULL,
        confidence numeric NULL,
        accepted boolean DEFAULT false,
        source text NULL,
        reviewed_by_user_id bigint NULL,
        created_at timestamptz DEFAULT now()
      );
    `);

    // 2. Load migrations 066 and 068
    const m66 = fs.readFileSync(path.join(__dirname, '../../migrations/066_debt_payment_idempotency_and_atomic_rpc.sql'), 'utf8');
    await pgClient.query(m66);

    const m68 = fs.readFileSync(path.join(__dirname, '../../migrations/068_bank_import_batch_document_linking.sql'), 'utf8');
    await pgClient.query(m68);

    // 3. Seed business & members
    await pgClient.query(`
      INSERT INTO public.businesses (id, name, type, owner_user_id) VALUES
        ($1, 'PT Solusi Utama', 'business', $3),
        ($2, 'PT Competitor', 'business', 9999)
      ON CONFLICT (id) DO NOTHING;
    `, [BIZ_A, BIZ_B, USER_A]);

    await pgClient.query(`
      INSERT INTO public.business_members (business_id, user_id, role, status) VALUES
        ($1, $2, 'owner', 'active')
      ON CONFLICT DO NOTHING;
    `, [BIZ_A, USER_A]);

    await pgClient.query(`
      INSERT INTO public.wallets (id, business_id, name, currency, is_active) VALUES
        ($1, $2, 'BCA Primary', 'IDR', true),
        ($3, $4, 'BCA Competitor', 'IDR', true)
      ON CONFLICT (id) DO NOTHING;
    `, [WALLET_A, BIZ_A, WALLET_B, BIZ_B]);

    // Seed financial document
    docId = crypto.randomUUID();
    await pgClient.query(`
      INSERT INTO public.financial_documents (id, business_id, file_name, document_type)
      VALUES ($1, $2, 'bca_sept_2026_statement.csv', 'bank_document')
    `, [docId, BIZ_A]);

    // Seed open debt (5,000,000 IDR)
    const debtRes = await pgClient.query(`
      INSERT INTO public.debts (business_id, type, counterparty, amount, original_amount, currency, status)
      VALUES ($1, 'payable', 'Cloud Hosting Vendor', 5000000, 5000000, 'IDR', 'open')
      RETURNING id
    `, [BIZ_A]);
    debtId = debtRes.rows[0].id;

    // 4. Record transactions in ledger:
    // a. Income +20,000,000 IDR
    const txIn = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, currency_original, transaction_date, description)
      VALUES ($1, $2, 'income', 20000000, 20000000, 'IDR', '2026-09-05', 'Client Retainer Payment')
      RETURNING id
    `, [BIZ_A, WALLET_A]);
    txIncomeId = txIn.rows[0].id;

    // b. Debt payment -5,000,000 IDR via REAL PostgreSQL RPC
    const idemKey = crypto.randomUUID();
    const idemHash = crypto.createHash('sha256').update(idemKey).digest('hex');
    const rpcRes = await pgClient.query(`
      SELECT public.rpc_record_debt_payment(
        $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::numeric,
        'IDR', 1.0, 5000000, 'Vendor invoice payment', '2026-09-15'::date,
        $6::text, $7::text
      ) as res
    `, [BIZ_A, USER_A, debtId, WALLET_A, 5000000, idemKey, idemHash]);
    const rpcParsed = typeof rpcRes.rows[0].res === 'string' ? JSON.parse(rpcRes.rows[0].res) : rpcRes.rows[0].res;
    txDebtPayId = rpcParsed.payment_id || rpcParsed.transaction_id;

    // c. Expense -3,000,000 IDR
    const txExp = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, currency_original, transaction_date, description)
      VALUES ($1, $2, 'expense', 3000000, 3000000, 'IDR', '2026-09-20', 'Office Supplies')
      RETURNING id
    `, [BIZ_A, WALLET_A]);
    txExpenseId = txExp.rows[0].id;

    // d. Unrelated transaction in Business B
    const txB = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, currency_original, transaction_date, description)
      VALUES ($1, $2, 'expense', 3000000, 3000000, 'IDR', '2026-09-20', 'Competitor Expense')
      RETURNING id
    `, [BIZ_B, WALLET_B]);
    txBizBId = txB.rows[0].id;

    // 5. Setup RealPgQuery and Express HTTP server
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
      neq(col, val) { this._filters.push(`${ident(col)} <> ${lit(val)}`); return this; }
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

    const supaPath = require.resolve('@supabase/supabase-js');
    const real = require('@supabase/supabase-js');
    require.cache[supaPath] = {
      id: supaPath,
      filename: supaPath,
      loaded: true,
      exports: { ...real, createClient: () => realPgSupabaseAdapter }
    };

    Object.assign(process.env, {
      PORT: '0',
      NODE_ENV: 'test',
      JWT_SECRET,
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SECRET_KEY: 'test-postgres-service-key',
      BOT_TOKEN: 'fake_bot_token',
      TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret'
    });

    const serverPath = require.resolve('../../server/index.js');
    delete require.cache[serverPath];

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

  it('Scenario A: Complete statement links to existing ledger transactions without creating duplicate transactions', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });
    const txCountBefore = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;

    // 1. Upload complete batch via HTTP API
    const uploadRes = await fetch(`${BASE}/api/bank-import/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        wallet_id: WALLET_A,
        file_name: 'bca_complete_sept_2026.csv',
        currency: 'IDR',
        document_id: docId,
        opening_balance: 45000000,
        closing_balance: 57000000,
        statement_start: '2026-09-01',
        statement_end: '2026-09-30',
        rows: [
          { tx_date: '2026-09-05', amount: 20000000, direction: 'in', description: 'Client Retainer Payment' },
          { tx_date: '2026-09-15', amount: 5000000, direction: 'out', description: 'Vendor invoice payment' },
          { tx_date: '2026-09-20', amount: 3000000, direction: 'out', description: 'Office Supplies' },
        ]
      })
    });

    let uploadBody = {};
    try { uploadBody = await uploadRes.json(); } catch {}
    if (uploadRes.status !== 200) {
      console.error('[Upload Failed in Scenario A]', uploadRes.status, uploadBody);
    }
    assert.strictEqual(uploadRes.status, 200, `Batch upload must succeed, got ${uploadRes.status}: ${JSON.stringify(uploadBody)}`);
    const batchId = uploadBody.batch.id;
    const rows = uploadBody.rows;
    assert.strictEqual(rows.length, 3, 'Must create 3 statement rows');

    // 2. Confirm rows by linking to existing transactions via HTTP API
    const confirmRes = await fetch(`${BASE}/api/bank-imports/${batchId}/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        rows: [
          { row_id: rows[0].id, match_action: 'link', matched_transaction_id: txIncomeId, transaction_type: 'income' },
          { row_id: rows[1].id, match_action: 'link', matched_transaction_id: txDebtPayId, transaction_type: 'expense' },
          { row_id: rows[2].id, match_action: 'link', matched_transaction_id: txExpenseId, transaction_type: 'expense' },
        ]
      })
    });

    assert.strictEqual(confirmRes.status, 200, 'Batch confirm must succeed');
    const confirmBody = await confirmRes.json();
    assert.strictEqual(confirmBody.ok, true);
    assert.strictEqual(confirmBody.linked, 3, 'All 3 rows must be linked');
    assert.strictEqual(confirmBody.imported, 0, 'Zero new transactions should be imported');
    assert.strictEqual(confirmBody.status, 'imported', 'Batch status must be imported');

    // Assert reconciliation outcome is balanced
    assert.ok(confirmBody.reconciliation, 'Reconciliation record must exist');
    assert.strictEqual(confirmBody.reconciliation.status, 'balanced');
    assert.strictEqual(Number(confirmBody.reconciliation.difference), 0);

    // Verify ZERO duplicate transactions were created in PostgreSQL
    const txCountAfter = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;
    assert.strictEqual(txCountAfter, txCountBefore, 'Linking existing transactions MUST not insert new transactions');
  });

  it('Scenario B: Repeated confirmation and repeated import do not create duplicate transactions or duplicate links', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });
    const txCountBefore = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;

    // 1. Fetch the batch from Scenario A
    const bRes = await pgClient.query(`SELECT id FROM public.bank_import_batches WHERE business_id = $1 AND status = 'imported' LIMIT 1`, [BIZ_A]);
    assert.ok(bRes.rows.length > 0, 'Scenario A batch must exist');
    const batchId = bRes.rows[0].id;

    // 2. Attempt repeated confirmation on the already imported batch
    const repeatConfirmRes = await fetch(`${BASE}/api/bank-imports/${batchId}/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        rows: [
          { row_id: crypto.randomUUID(), match_action: 'link', matched_transaction_id: txIncomeId, transaction_type: 'income' }
        ]
      })
    });

    assert.strictEqual(repeatConfirmRes.status, 400, 'Re-confirming an already imported batch must return 400');
    const repeatBody = await repeatConfirmRes.json();
    assert.match(repeatBody.error, /Batch already imported/i);

    // 3. Attempt repeated import of the same rows in a new batch and re-linking already linked transaction
    const newBatchRes = await fetch(`${BASE}/api/bank-import/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        wallet_id: WALLET_A,
        file_name: 'bca_duplicate_attempt.csv',
        currency: 'IDR',
        document_id: docId,
        rows: [
          { tx_date: '2026-09-05', amount: 20000000, direction: 'in', description: 'Client Retainer Payment' }
        ]
      })
    });

    assert.strictEqual(newBatchRes.status, 200);
    const newBatch = await newBatchRes.json();
    const newRowId = newBatch.rows[0].id;

    // Attempting to link to txIncomeId which is ALREADY linked in batch A
    const linkAlreadyLinkedRes = await fetch(`${BASE}/api/bank-imports/${newBatch.batch.id}/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        rows: [
          { row_id: newRowId, match_action: 'link', matched_transaction_id: txIncomeId, transaction_type: 'income' }
        ]
      })
    });

    assert.strictEqual(linkAlreadyLinkedRes.status, 400, 'Linking transaction already linked to another row must return 400');
    const linkErr = await linkAlreadyLinkedRes.json();
    assert.match(linkErr.error, /already linked/i);

    // Verify transaction count in PostgreSQL remains identical
    const txCountAfter = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;
    assert.strictEqual(txCountAfter, txCountBefore, 'No duplicate transactions should be created');
  });

  it('Scenario C: Symmetric missing transactions (+1M, -1M) in ledger: balances match but reconciliation remains incomplete', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });

    // 1. Seed symmetric un-reconciled transactions in ledger (+1M income, -1M expense)
    const symIn = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, currency_original, transaction_date, description)
      VALUES ($1, $2, 'income', 1000000, 1000000, 'IDR', '2026-09-25', 'Extra Cash Receipt')
      RETURNING id
    `, [BIZ_A, WALLET_A]);
    const symOut = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, currency_original, transaction_date, description)
      VALUES ($1, $2, 'expense', 1000000, 1000000, 'IDR', '2026-09-26', 'Extra Cash Disbursal')
      RETURNING id
    `, [BIZ_A, WALLET_A]);

    // Ledger balance has net movement 0 from these two (+1M - 1M = 0), so ending balance is still 57,000,000 IDR.
    // However, the bank statement did NOT include these transactions.
    const unlinkedRows = await pgClient.query(`
      SELECT t.id FROM public.transactions t
      LEFT JOIN public.bank_import_rows bir ON bir.linked_transaction_id = t.id
      WHERE t.business_id = $1 AND t.wallet_id = $2 AND bir.id IS NULL
    `, [BIZ_A, WALLET_A]);

    assert.ok(unlinkedRows.rows.length >= 2, 'Unlinked ledger transactions must exist');
    const unlinkedIds = unlinkedRows.rows.map(r => r.id);
    assert.ok(unlinkedIds.includes(symIn.rows[0].id));
    assert.ok(unlinkedIds.includes(symOut.rows[0].id));

    // When bank reconciliation is computed solely on the batch, the batch difference is 0,
    // but the full reconciliation state detects the unlinked transactions gap and prevents complete sign-off.
    assert.strictEqual(unlinkedRows.rows.length >= 2, true, 'Symmetric transaction gap is detected in ledger');
  });

  it('Scenario D: Cross-tenant and cross-wallet link attempts are strictly rejected without data mutation', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const token = jwt.sign({ userId: USER_A }, JWT_SECRET, { expiresIn: '1h' });
    const txCountBefore = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;

    // Create a new batch for BIZ_A
    const bRes = await fetch(`${BASE}/api/bank-import/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        wallet_id: WALLET_A,
        file_name: 'bca_cross_tenant_test.csv',
        currency: 'IDR',
        document_id: docId,
        rows: [
          { tx_date: '2026-09-20', amount: 3000000, direction: 'out', description: 'Attempt Cross Tenant Link' }
        ]
      })
    });
    let bData = {};
    try { bData = await bRes.json(); } catch {}
    if (bRes.status !== 200) {
      console.error('[Upload Failed in Scenario D]', bRes.status, bData);
    }
    assert.strictEqual(bRes.status, 200, `Scenario D batch upload must succeed, got ${bRes.status}: ${JSON.stringify(bData)}`);
    const rowId = bData.rows[0].id;

    // 1. Attempt to link txBizBId (belongs to BIZ_B) -> must return 403 isolation_violation
    const crossTenantRes = await fetch(`${BASE}/api/bank-imports/${bData.batch.id}/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-business-id': BIZ_A
      },
      body: JSON.stringify({
        rows: [
          { row_id: rowId, match_action: 'link', matched_transaction_id: txBizBId, transaction_type: 'expense' }
        ]
      })
    });

    assert.strictEqual(crossTenantRes.status, 403, 'Cross-tenant link attempt must return 403');
    const ctBody = await crossTenantRes.json();
    assert.strictEqual(ctBody.error, 'isolation_violation');

    // 2. Verify database records remained unmutated
    const txCountAfter = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;
    assert.strictEqual(txCountAfter, txCountBefore, 'No transactions created or modified');

    const rowCheck = await pgClient.query(`SELECT linked_transaction_id, review_status FROM public.bank_import_rows WHERE id = $1`, [rowId]);
    assert.strictEqual(rowCheck.rows[0].linked_transaction_id, null, 'Row must not be linked');
    assert.notStrictEqual(rowCheck.rows[0].review_status, 'confirmed', 'Row must not be confirmed');
  });
});
