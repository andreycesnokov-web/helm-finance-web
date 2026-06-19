// CI for PROPOSED migration 036 (atomic document mutation + audit RPCs).
// Proves the mutation and the audit insert are atomic: when the audit insert
// fails, the mutation is rolled back. Run: node tests/migrations/ci_036.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE debts (id bigint PRIMARY KEY, business_id uuid);
CREATE TABLE document_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE financial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, file_id uuid,
  document_type text, document_number text, document_date date, currency text,
  gross_amount numeric, issuer_counterparty_id uuid, archived_at timestamptz, updated_at timestamptz);
CREATE TABLE document_debt_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, document_id uuid, debt_id bigint, created_by_user_id bigint);
`;

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(MIG('035_document_audit.sql'));
  try { await db.exec(MIG('036_document_audit_rpc.sql')); ok('clean apply 036', true); } catch (e) { ok('clean apply 036: ' + e.message, false); }
  try { await db.exec(MIG('036_document_audit_rpc.sql')); ok('second apply 036 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const cnt = async (sql) => Number((await db.query(sql)).rows[0].c);
  ok('rpc functions created', (await cnt(`SELECT count(*) c FROM information_schema.routines WHERE routine_name LIKE 'rpc_document_%'`)) >= 4);

  const A = randomUUID(), doc = randomUUID(), file = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO businesses(id) VALUES ('${A}');
    INSERT INTO document_files(id,business_id) VALUES ('${file}','${A}');
    INSERT INTO financial_documents(id,business_id,file_id,document_type) VALUES ('${doc}','${A}','${file}','other');
    INSERT INTO debts(id,business_id) VALUES (1,'${A}');`);

  // Happy path: archive writes BOTH the mutation and the audit row.
  await db.query(`SELECT rpc_document_archive('${doc}','${A}', 42)`);
  ok('archive set archived_at', (await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${doc}' AND archived_at IS NOT NULL`)) === 1);
  ok('archive wrote audit row', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${doc}' AND action='archived'`)) === 1);

  // Atomicity: break the audit table so the audit insert fails, then attempt a
  // mutation — the mutation MUST roll back (no partial success).
  await db.exec(`ALTER TABLE document_audit ADD COLUMN must_be_present int NOT NULL DEFAULT 0;
                 ALTER TABLE document_audit ALTER COLUMN must_be_present DROP DEFAULT;`);
  const before = await cnt(`SELECT count(*) c FROM document_debt_links`);
  let threw = false;
  try { await db.query(`SELECT rpc_document_link('${doc}','${A}','debt','1', 42)`); } catch { threw = true; }
  await db.exec('ROLLBACK').catch(() => {});
  const after = await cnt(`SELECT count(*) c FROM document_debt_links`);
  ok('audit failure aborts the RPC', threw);
  ok('mutation rolled back when audit fails (atomic)', after === before);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
