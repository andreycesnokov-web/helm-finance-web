// Real PostgreSQL Migration 068 & Bank Import Isolation Verification
// Runs in CI with PostgreSQL service (or locally when DATABASE_URL is available)

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgrespassword@localhost:5432/testdb';

describe('Real PostgreSQL: Migration 068 & Bank Import Batch Document Linking', () => {
  let client;
  let skipped = false;

  const BIZ_A = crypto.randomUUID();
  const BIZ_B = crypto.randomUUID();
  const USER_ID = 1001;

  before(async () => {
    client = new Client({ connectionString, connectionTimeoutMillis: 4000 });
    try {
      await client.connect();
    } catch (err) {
      console.warn(`[SKIP] Real PostgreSQL not reachable (${err.message}). Tests skipped or run in CI.`);
      skipped = true;
      return;
    }

    // Prepare core prerequisite tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.businesses (
        id uuid PRIMARY KEY,
        name text NOT NULL
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
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.bank_import_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id uuid NOT NULL,
        business_id uuid NOT NULL,
        raw jsonb DEFAULT '{}'::jsonb,
        amount numeric NULL,
        direction text NULL,
        created_at timestamptz DEFAULT now()
      );
    `);

    // Seed test businesses & wallets
    await client.query(`
      INSERT INTO public.businesses (id, name) VALUES
        ($1, 'Company Alpha'),
        ($2, 'Company Beta')
      ON CONFLICT (id) DO NOTHING;
    `, [BIZ_A, BIZ_B]);
  });

  after(async () => {
    if (client) {
      try { await client.end(); } catch {}
    }
  });

  it('Scenario 0: Direct SQL returns controlled error when schema lacks document_id, creates no batch or rows, no silent fallback', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    // Create a document belonging to Company A
    const docId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.financial_documents (id, business_id, file_name, document_type)
      VALUES ($1, $2, 'pre_migration_statement.csv', 'bank_document')
    `, [docId, BIZ_A]);

    // Count existing batches and rows before request
    const beforeBatches = await client.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const beforeRows = await client.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);

    // Simulate API logic before migration 068 when column document_id does not exist
    const docRow = await client.query(`SELECT id, business_id FROM public.financial_documents WHERE id = $1`, [docId]);
    assert.strictEqual(docRow.rowCount, 1);
    assert.strictEqual(docRow.rows[0].business_id, BIZ_A);

    let caughtError = null;
    try {
      await client.query(`
        INSERT INTO public.bank_import_batches (id, business_id, file_name, document_id, status)
        VALUES ($1, $2, 'pre_migration_statement.csv', $3, 'review_required')
      `, [crypto.randomUUID(), BIZ_A, docId]);
    } catch (err) {
      caughtError = err;
    }

    // Verify error is captured (column does not exist)
    assert.ok(caughtError, 'Insert must fail when document_id column does not exist');
    assert.match(caughtError.message, /column "document_id" of relation "bank_import_batches" does not exist/i);

    // Verify NO batch was created and NO fallback row was inserted
    const afterBatches = await client.query(`SELECT count(*)::int as cnt FROM public.bank_import_batches WHERE business_id = $1`, [BIZ_A]);
    const afterRows = await client.query(`SELECT count(*)::int as cnt FROM public.bank_import_rows WHERE business_id = $1`, [BIZ_A]);
    assert.strictEqual(afterBatches.rows[0].cnt, beforeBatches.rows[0].cnt, 'No batch should be created on schema mismatch');
    assert.strictEqual(afterRows.rows[0].cnt, beforeRows.rows[0].cnt, 'No rows should be created on schema mismatch');
  });

  it('Scenario 1: Legacy batches exist with NULL document_id before migration, preserved after migration', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    // Insert legacy batch before migration
    const legacyBatchId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.bank_import_batches (id, business_id, file_name, status)
      VALUES ($1, $2, 'legacy_statement.csv', 'imported')
    `, [legacyBatchId, BIZ_A]);

    // Apply migration 068
    const migrationSql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '068_bank_import_batch_document_linking.sql'), 'utf8');
    await client.query(migrationSql);

    // Verify legacy batch is intact with document_id IS NULL
    const res = await client.query(`SELECT id, document_id, file_name FROM public.bank_import_batches WHERE id = $1`, [legacyBatchId]);
    assert.strictEqual(res.rowCount, 1);
    assert.strictEqual(res.rows[0].document_id, null);
    assert.strictEqual(res.rows[0].file_name, 'legacy_statement.csv');
  });

  it('Scenario 2: New batch saves document_id and is retrievable on re-read', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const docId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.financial_documents (id, business_id, file_name, document_type)
      VALUES ($1, $2, 'bca_sept_2026.csv', 'bank_document')
    `, [docId, BIZ_A]);

    const batchId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.bank_import_batches (id, business_id, file_name, document_id, status)
      VALUES ($1, $2, 'bca_sept_2026.csv', $3, 'review_required')
    `, [batchId, BIZ_A, docId]);

    const readRes = await client.query(`SELECT id, document_id FROM public.bank_import_batches WHERE id = $1`, [batchId]);
    assert.strictEqual(readRes.rowCount, 1);
    assert.strictEqual(readRes.rows[0].document_id, docId);
  });

  it('Scenario 3: Non-existent document_id is rejected by foreign key constraint', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    const nonExistentDocId = crypto.randomUUID();
    const batchId = crypto.randomUUID();

    await assert.rejects(
      async () => {
        await client.query(`
          INSERT INTO public.bank_import_batches (id, business_id, file_name, document_id, status)
          VALUES ($1, $2, 'fail.csv', $3, 'review_required')
        `, [batchId, BIZ_A, nonExistentDocId]);
      },
      /(foreign key|isolation: bank_import_batches document_id belongs to another business)/i
    );
  });

  it('Scenario 4: Document belonging to another business is rejected by isolation trigger', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');

    // Document in Company B
    const docBId = crypto.randomUUID();
    await client.query(`
      INSERT INTO public.financial_documents (id, business_id, file_name, document_type)
      VALUES ($1, $2, 'company_b_doc.csv', 'bank_document')
    `, [docBId, BIZ_B]);

    // Attempt to link to Company A batch
    const batchAId = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await client.query(`
          INSERT INTO public.bank_import_batches (id, business_id, file_name, document_id, status)
          VALUES ($1, $2, 'cross_biz.csv', $3, 'review_required')
        `, [batchAId, BIZ_A, docBId]);
      },
      /isolation: bank_import_batches document_id belongs to another business/i
    );
  });
});
