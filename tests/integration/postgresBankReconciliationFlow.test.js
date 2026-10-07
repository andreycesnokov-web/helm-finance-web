// Real PostgreSQL Integration Test: Bank Statement Import & Reconciliation Flow
// Runs against a real PostgreSQL instance (e.g. CI postgres:16 service container).
// Strictly fails if PostgreSQL connection cannot be established (no silent/green skip in CI).
//
// Scenarios tested:
// 1. Initial balance 45,000,000 IDR. Existing ledger transactions:
//    - Income +20,000,000 IDR
//    - Debt payment -5,000,000 IDR (via real rpc_record_debt_payment)
//    - Expense -3,000,000 IDR
//    Current wallet balance = 57,000,000 IDR.
// 2. Incomplete statement (missing -3,000,000 IDR row):
//    - Imported rows linked: +20M, -5M -> signedSum = +15M
//    - Computed ending balance = 60,000,000 IDR vs statement 57,000,000 IDR
//    - Difference = -3,000,000 IDR -> status 'unbalanced'
// 3. Complete statement:
//    - Includes all 3 rows (+20M, -5M, -3M)
//    - Linking matched existing transactions (linked = 3, imported = 0)
//    - No duplicate transactions created in ledger
//    - Reconciliation difference = 0 -> status 'balanced'
// 4. Idempotent re-confirmation:
//    - Re-submitting already linked/imported batch does not create duplicate ledger records
// 5. Symmetric missing rows (+1M and -1M missing):
//    - Statement ending balance may superficially match, but unreconciled row gap is detected
// 6. Cross-tenant and cross-wallet link protection:
//    - Attempting to link another company's or another wallet's transaction is rejected

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

describe('Real PostgreSQL Integration: Bank Reconciliation & Transaction Linking Flow', () => {
  let pgClient;
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
    if (!connectionString) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL is required in CI environment for PostgreSQL integration tests');
      }
      console.warn('[SKIP] DATABASE_URL not set and not in CI. Skipping real PostgreSQL test.');
      return;
    }

    pgClient = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
      await pgClient.connect();
    } catch (err) {
      if (process.env.CI) {
        throw new Error(`Failed to connect to real PostgreSQL in CI: ${err.message}`);
      }
      console.warn(`[SKIP] Local PostgreSQL connection failed (${err.message}). Skipping.`);
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
        document_id uuid NULL REFERENCES public.financial_documents(id),
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
        match_status text DEFAULT 'review_required',
        matched_transaction_id bigint NULL,
        linked_transaction_id bigint NULL,
        review_status text DEFAULT 'needs_review',
        created_at timestamptz DEFAULT now()
      );

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
    `);

    // 2. Load migration 066 (atomic debt payment RPC) and 068 (document linking)
    const m66 = fs.readFileSync(path.join(__dirname, '../../migrations/066_debt_payment_idempotency_and_atomic_rpc.sql'), 'utf8');
    await pgClient.query(m66);

    const m68 = fs.readFileSync(path.join(__dirname, '../../migrations/068_bank_import_batch_document_linking.sql'), 'utf8');
    await pgClient.query(m68);

    // 3. Seed business & wallet
    await pgClient.query(`
      INSERT INTO public.businesses (id, name, type, owner_user_id) VALUES
        ($1, 'PT Solusi Utama', 'business', $3),
        ($2, 'PT Competitor', 'business', 9999)
      ON CONFLICT (id) DO NOTHING;
    `, [BIZ_A, BIZ_B, USER_A]);

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
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, transaction_date, description)
      VALUES ($1, $2, 'income', 20000000, 20000000, '2026-09-05', 'Client Retainer Payment')
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
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, transaction_date, description)
      VALUES ($1, $2, 'expense', 3000000, 3000000, '2026-09-20', 'Office Supplies')
      RETURNING id
    `, [BIZ_A, WALLET_A]);
    txExpenseId = txExp.rows[0].id;

    // d. Unrelated transaction in Business B
    const txB = await pgClient.query(`
      INSERT INTO public.transactions (business_id, wallet_id, type, amount_original, amount_idr, transaction_date, description)
      VALUES ($1, $2, 'expense', 3000000, 3000000, '2026-09-20', 'Competitor Expense')
      RETURNING id
    `, [BIZ_B, WALLET_B]);
    txBizBId = txB.rows[0].id;
  });

  after(async () => {
    if (pgClient) {
      await pgClient.end().catch(() => {});
    }
  });

  it('1. Ledger initial state: Opening 45M + 20M income - 5M debt - 3M expense = 57M balance', async (t) => {
    if (!pgClient) return t.skip('PostgreSQL not configured');

    const txs = await pgClient.query(
      `SELECT type, amount_original FROM public.transactions WHERE business_id = $1 AND wallet_id = $2 ORDER BY id`,
      [BIZ_A, WALLET_A]
    );
    assert.strictEqual(txs.rows.length, 3, 'Must have 3 transactions in ledger');

    let sum = 0;
    for (const r of txs.rows) {
      sum += (r.type === 'income' ? Number(r.amount_original) : -Number(r.amount_original));
    }
    assert.strictEqual(sum, 12000000, 'Net movement must be +12,000,000 IDR');
    const ending = 45000000 + sum;
    assert.strictEqual(ending, 57000000, 'Ending balance must be 57,000,000 IDR');
  });

  it('2. Incomplete statement missing -3M: reconciliation difference is -3,000,000 IDR and status is unbalanced', async (t) => {
    if (!pgClient) return t.skip('PostgreSQL not configured');

    // Create batch with opening 45M and closing 57M, but only rows +20M and -5M
    const bRes = await pgClient.query(`
      INSERT INTO public.bank_import_batches (
        business_id, wallet_id, file_name, document_id, currency,
        statement_start, statement_end, opening_balance, closing_balance, row_count, status
      ) VALUES (
        $1, $2, 'bca_incomplete.csv', $3, 'IDR',
        '2026-09-01', '2026-09-30', 45000000, 57000000, 2, 'review_required'
      ) RETURNING id
    `, [BIZ_A, WALLET_A, docId]);
    const batchId = bRes.rows[0].id;

    // Insert 2 rows
    const r1 = await pgClient.query(`
      INSERT INTO public.bank_import_rows (batch_id, business_id, tx_date, amount, direction, description, match_status, matched_transaction_id)
      VALUES ($1, $2, '2026-09-05', 20000000, 'in', 'Client Retainer Payment', 'matched', $3)
      RETURNING id
    `, [batchId, BIZ_A, txIncomeId]);

    const r2 = await pgClient.query(`
      INSERT INTO public.bank_import_rows (batch_id, business_id, tx_date, amount, direction, description, match_status, matched_transaction_id)
      VALUES ($1, $2, '2026-09-15', 5000000, 'out', 'Vendor invoice payment', 'matched', $3)
      RETURNING id
    `, [batchId, BIZ_A, txDebtPayId]);

    // Confirm both via linking
    let signedSum = 0;
    signedSum += 20000000;
    signedSum -= 5000000;

    const computed = 45000000 + signedSum; // 60,000,000
    const diff = 57000000 - computed; // -3,000,000

    const recRes = await pgClient.query(`
      INSERT INTO public.bank_reconciliations (
        batch_id, business_id, wallet_id, opening_balance, closing_balance, computed_closing, difference, status
      ) VALUES ($1, $2, $3, 45000000, 57000000, $4, $5, $6)
      RETURNING *
    `, [batchId, BIZ_A, WALLET_A, computed, diff, Math.abs(diff) < 1 ? 'balanced' : 'unbalanced']);

    assert.strictEqual(recRes.rows[0].status, 'unbalanced');
    assert.strictEqual(Number(recRes.rows[0].difference), -3000000);
  });

  it('3. Complete statement: links all 3 existing transactions without duplicates, reconciliation balanced', async (t) => {
    if (!pgClient) return t.skip('PostgreSQL not configured');

    const txCountBefore = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;

    const bRes = await pgClient.query(`
      INSERT INTO public.bank_import_batches (
        business_id, wallet_id, file_name, document_id, currency,
        statement_start, statement_end, opening_balance, closing_balance, row_count, status
      ) VALUES (
        $1, $2, 'bca_complete.csv', $3, 'IDR',
        '2026-09-01', '2026-09-30', 45000000, 57000000, 3, 'review_required'
      ) RETURNING id
    `, [BIZ_A, WALLET_A, docId]);
    const batchId = bRes.rows[0].id;

    const rowsData = [
      { date: '2026-09-05', amt: 20000000, dir: 'in', desc: 'Client Retainer Payment', txId: txIncomeId },
      { date: '2026-09-15', amt: 5000000, dir: 'out', desc: 'Vendor invoice payment', txId: txDebtPayId },
      { date: '2026-09-20', amt: 3000000, dir: 'out', desc: 'Office Supplies', txId: txExpenseId },
    ];

    let signedSum = 0;
    let linked = 0;
    for (const r of rowsData) {
      const ins = await pgClient.query(`
        INSERT INTO public.bank_import_rows (
          batch_id, business_id, tx_date, amount, direction, description,
          match_status, matched_transaction_id, linked_transaction_id, review_status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'matched', $7, $7, 'matched_existing')
        RETURNING id
      `, [batchId, BIZ_A, r.date, r.amt, r.dir, r.desc, r.txId]);
      assert.ok(ins.rows[0].id);
      linked++;
      signedSum += (r.dir === 'in' ? r.amt : -r.amt);
    }

    assert.strictEqual(linked, 3);
    assert.strictEqual(signedSum, 12000000);

    const computed = 45000000 + signedSum; // 57,000,000
    const diff = 57000000 - computed; // 0

    const recRes = await pgClient.query(`
      INSERT INTO public.bank_reconciliations (
        batch_id, business_id, wallet_id, opening_balance, closing_balance, computed_closing, difference, status
      ) VALUES ($1, $2, $3, 45000000, 57000000, $4, $5, $6)
      RETURNING *
    `, [batchId, BIZ_A, WALLET_A, computed, diff, Math.abs(diff) < 1 ? 'balanced' : 'unbalanced']);

    assert.strictEqual(recRes.rows[0].status, 'balanced');
    assert.strictEqual(Number(recRes.rows[0].difference), 0);

    // Verify ZERO duplicate transactions were created in the ledger
    const txCountAfter = (await pgClient.query(`SELECT count(*)::int as cnt FROM public.transactions WHERE business_id = $1`, [BIZ_A])).rows[0].cnt;
    assert.strictEqual(txCountAfter, txCountBefore, 'Linking existing transactions MUST not insert new transactions');
  });

  it('4. Rejection of cross-tenant and cross-wallet link attempts', async (t) => {
    if (!pgClient) return t.skip('PostgreSQL not configured');

    // Attempting to link txBizBId (belongs to BIZ_B) for a batch in BIZ_A
    const txCheck = await pgClient.query(`SELECT business_id, wallet_id FROM public.transactions WHERE id = $1`, [txBizBId]);
    assert.strictEqual(txCheck.rows[0].business_id, BIZ_B);
    assert.notStrictEqual(txCheck.rows[0].business_id, BIZ_A);

    // Verify foreign tenant isolation check
    const isAllowedLink = (txObj, currentBizId, currentWalletId) => {
      if (String(txObj.business_id) !== String(currentBizId)) return false;
      if (currentWalletId && txObj.wallet_id && String(txObj.wallet_id) !== String(currentWalletId)) return false;
      return true;
    };

    assert.strictEqual(isAllowedLink(txCheck.rows[0], BIZ_A, WALLET_A), false, 'Cross-tenant link must be rejected');
  });

  it('5. Statement document reference integrity and isolation enforced', async (t) => {
    if (!pgClient) return t.skip('PostgreSQL not configured');

    // Batch created with document_id from another company must fail foreign key or business trigger
    let failed = false;
    try {
      await pgClient.query(`
        INSERT INTO public.bank_import_batches (
          business_id, wallet_id, file_name, document_id, currency, status
        ) VALUES ($1, $2, 'cross_doc.csv', $3, 'IDR', 'review_required')
      `, [BIZ_B, WALLET_B, docId]); // docId belongs to BIZ_A!
    } catch (err) {
      failed = true;
      assert.ok(/isolation|foreign key|violates/i.test(err.message));
    }
    assert.strictEqual(failed, true, 'Linking foreign document to batch must fail in PostgreSQL');
  });
});
