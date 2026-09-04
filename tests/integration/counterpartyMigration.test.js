// Migration smoke for migrations/055_counterparty_intelligence_v1.sql
//
// Applies the migration to a real Postgres (PGlite, in-process) on top of the schema as
// it exists TODAY, with legacy rows already in it. Proves the migration is additive,
// that existing data survives unchanged, and that the new constraints and trigger
// actually fire.
//
// This touches no real database. PGlite is created fresh in memory per run.
//
// Run: node tests/integration/counterpartyMigration.test.js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATION = path.join(__dirname, '..', '..', 'migrations',
  '055_counterparty_intelligence_v1.sql');

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';

// The schema as it is in production today: counterparties from migration 002 plus
// the business_id column added by 017. Nothing from migration 055.
const PRE_MIGRATION = `
  CREATE TABLE businesses (
    id uuid PRIMARY KEY, owner_user_id bigint, name text, type text, created_at timestamptz DEFAULT now());
  CREATE TABLE counterparties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    group_name TEXT NULL,
    type TEXT NULL,
    email TEXT NULL,
    phone TEXT NULL,
    notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    business_id UUID NULL REFERENCES businesses(id));
`;

// Legacy rows, including the awkward ones: legacy `type` values a CHECK would
// reject, an inactive row, and a row with no business_id at all.
const SEED = `
  INSERT INTO businesses (id, owner_user_id, name, type) VALUES
    ('${BIZ_A}', 900, 'Helm Care Indonesia', 'company'),
    ('${BIZ_B}', 901, 'Helm Care Pay', 'company');
  INSERT INTO counterparties (user_id, name, type, email, is_active, business_id) VALUES
    (900, 'PT Circleka Indonesia Utama', 'supplier', 'ap@circleka.co.id', TRUE, '${BIZ_A}'),
    (900, 'PT Legacy Franchisee',        'franchisee', NULL,              TRUE, '${BIZ_A}'),
    (900, 'PT Retired Vendor',           'owner',      NULL,              FALSE, '${BIZ_A}'),
    (901, 'PT Pay Side Vendor',          'client',     NULL,              TRUE, '${BIZ_B}'),
    (900, 'PT Orphan No Business',       NULL,         NULL,              TRUE, NULL);
`;

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  const db = new PGlite();
  await db.exec(PRE_MIGRATION);
  await db.exec(SEED);

  const before = await db.query('SELECT id, name, type, is_active FROM counterparties ORDER BY name');
  const beforeCount = before.rows.length;

  console.log('\nApply');
  await t('the migration applies cleanly to the current schema', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await db.exec(sql);
  });

  await t('and is re-runnable — applying it twice changes nothing', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await db.exec(sql);
    const after = await db.query('SELECT count(*)::int AS n FROM counterparties');
    assert.strictEqual(after.rows[0].n, beforeCount, 'row count must not change');
  });

  console.log('\nExisting data survives');
  await t('every legacy row is still present, with name and type untouched', async () => {
    const after = await db.query('SELECT id, name, type, is_active FROM counterparties ORDER BY name');
    assert.strictEqual(after.rows.length, beforeCount);
    for (let i = 0; i < beforeCount; i++) {
      assert.strictEqual(after.rows[i].id, before.rows[i].id);
      assert.strictEqual(after.rows[i].name, before.rows[i].name);
      assert.strictEqual(after.rows[i].type, before.rows[i].type, 'legacy type values must survive');
    }
  });

  await t('legacy `type` values that a CHECK would reject are still there', async () => {
    const r = await db.query("SELECT type FROM counterparties WHERE type IN ('franchisee','owner','client','supplier') ORDER BY type");
    assert.deepStrictEqual(r.rows.map((x) => x.type), ['client', 'franchisee', 'owner', 'supplier']);
  });

  await t('a row with no business_id is not broken by the migration', async () => {
    const r = await db.query("SELECT status, display_name FROM counterparties WHERE name = 'PT Orphan No Business'");
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].status, 'active');
  });

  console.log('\nBackfill');
  await t('display_name and legal_name are backfilled from name', async () => {
    const r = await db.query('SELECT name, display_name, legal_name FROM counterparties');
    for (const row of r.rows) {
      assert.strictEqual(row.display_name, row.name);
      assert.strictEqual(row.legal_name, row.name);
    }
  });

  await t('status mirrors the pre-existing is_active flag', async () => {
    const r = await db.query("SELECT name, status FROM counterparties WHERE is_active = FALSE");
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].status, 'archived');
    const active = await db.query("SELECT count(*)::int AS n FROM counterparties WHERE is_active AND status = 'active'");
    assert.strictEqual(active.rows[0].n, beforeCount - 1);
  });

  console.log('\nNew columns and constraints');
  await t('all V1 columns exist', async () => {
    const r = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'counterparties'`);
    const cols = r.rows.map((x) => x.column_name);
    for (const c of ['legal_name', 'display_name', 'npwp', 'pkp_status', 'address', 'aliases',
      'default_category', 'default_tax_treatment', 'status',
      'source_system', 'external_id', 'external_url', 'last_synced_at']) {
      assert.ok(cols.includes(c), `missing column ${c}`);
    }
  });

  await t('status and pkp_status CHECKs reject bad values', async () => {
    await assert.rejects(db.query(
      `UPDATE counterparties SET status = 'nonsense' WHERE name = 'PT Legacy Franchisee'`));
    await assert.rejects(db.query(
      `UPDATE counterparties SET pkp_status = 'maybe' WHERE name = 'PT Legacy Franchisee'`));
    await db.query(`UPDATE counterparties SET pkp_status = 'pkp' WHERE name = 'PT Legacy Franchisee'`);
  });

  await t('aliases accepts an array', async () => {
    await db.query(`UPDATE counterparties SET aliases = ARRAY['Circle K','CIRCLEKA'] WHERE name = 'PT Circleka Indonesia Utama'`);
    const r = await db.query(`SELECT aliases FROM counterparties WHERE name = 'PT Circleka Indonesia Utama'`);
    assert.deepStrictEqual(r.rows[0].aliases, ['Circle K', 'CIRCLEKA']);
  });

  console.log('\nBank accounts');
  const cpA = await db.query(`SELECT id FROM counterparties WHERE name = 'PT Circleka Indonesia Utama'`);
  const cpAId = cpA.rows[0].id;

  await t('account_number_normalized is generated, not supplied', async () => {
    await db.query(`INSERT INTO counterparty_bank_accounts (business_id, counterparty_id, bank_name, account_number, account_name, is_primary)
      VALUES ('${BIZ_A}', '${cpAId}', 'BCA', '075-3020192', 'CIRCLEKA INDONESIA UTAMA', TRUE)`);
    const r = await db.query(`SELECT account_number, account_number_normalized FROM counterparty_bank_accounts`);
    assert.strictEqual(r.rows[0].account_number, '075-3020192');
    assert.strictEqual(r.rows[0].account_number_normalized, '0753020192');
  });

  await t('the same account cannot be registered twice, however it is punctuated', async () => {
    await assert.rejects(db.query(
      `INSERT INTO counterparty_bank_accounts (business_id, counterparty_id, bank_name, account_number)
       VALUES ('${BIZ_A}', '${cpAId}', 'BCA', '0753020192')`),
    /duplicate key|unique/i);
  });

  await t('the isolation trigger blocks a cross-business bank account', async () => {
    await assert.rejects(db.query(
      `INSERT INTO counterparty_bank_accounts (business_id, counterparty_id, bank_name, account_number)
       VALUES ('${BIZ_B}', '${cpAId}', 'BCA', '999-8887776')`),
    /isolation/i);
  });

  console.log('\nIntegration keys');
  await t('the external upsert key is unique per business', async () => {
    await db.query(`UPDATE counterparties SET source_system = 'crm', external_id = 'X1'
      WHERE name = 'PT Circleka Indonesia Utama'`);
    await assert.rejects(db.query(
      `UPDATE counterparties SET source_system = 'crm', external_id = 'X1'
       WHERE name = 'PT Legacy Franchisee'`), /duplicate key|unique/i);
  });

  await t('rows without source_system are exempt from that uniqueness', async () => {
    const r = await db.query(`SELECT count(*)::int AS n FROM counterparties WHERE source_system IS NULL`);
    assert.ok(r.rows[0].n >= 3, 'partial index must not constrain NULL source_system');
  });

  console.log('\nExisting query shapes still work');
  await t('the queries the current API routes run are unaffected', async () => {
    // GET /api/counterparties
    const list = await db.query(`SELECT * FROM counterparties WHERE business_id = '${BIZ_A}' ORDER BY name`);
    assert.ok(list.rows.length >= 3);
    // POST /api/counterparties — the exact column set the route inserts today
    await db.query(`INSERT INTO counterparties (user_id, business_id, name, group_name, type, email, phone, notes)
      VALUES (900, '${BIZ_A}', 'PT Inserted By Legacy Route', NULL, 'supplier', NULL, NULL, NULL)`);
    const r = await db.query(`SELECT status, display_name FROM counterparties WHERE name = 'PT Inserted By Legacy Route'`);
    assert.strictEqual(r.rows[0].status, 'active', 'new rows default to active');
    assert.strictEqual(r.rows[0].display_name, null, 'the legacy route does not set display_name — app must fall back to name');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
