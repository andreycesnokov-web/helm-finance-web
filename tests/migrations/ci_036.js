// CI for migration 036 (atomic document mutation + audit RPCs) on PGlite.
// Proves: finalize/archive/metadata/link/unlink each write mutation + audit in
// one transaction; cross-business links rejected inside the function; archived
// docs can't be re-mutated; and an induced audit failure rolls back the mutation.
// Run: node tests/migrations/ci_036.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE counterparties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE debts (id bigint PRIMARY KEY, business_id uuid);
CREATE TABLE transactions (id bigint PRIMARY KEY, business_id uuid);
CREATE TABLE compliance_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
CREATE TABLE document_files (
  id uuid PRIMARY KEY, business_id uuid, storage_path text, file_name text, mime_type text,
  file_size bigint, sha256_hash text, upload_channel text, uploaded_by_user_id bigint, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX document_files_dedup_idx ON document_files(business_id, sha256_hash);
CREATE TABLE financial_documents (
  id uuid PRIMARY KEY, business_id uuid, file_id uuid, document_type text, document_number text,
  document_date date, period_start date, period_end date, issuer_counterparty_id uuid, currency text,
  gross_amount numeric, extraction_status text, review_status text, extracted_json jsonb,
  created_by_user_id bigint, archived_at timestamptz, updated_at timestamptz);
CREATE TABLE document_debt_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, document_id uuid, debt_id bigint, created_by_user_id bigint);
CREATE TABLE document_transaction_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, document_id uuid, transaction_id bigint, created_by_user_id bigint);
CREATE TABLE document_compliance_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, document_id uuid, compliance_event_id uuid, created_by_user_id bigint);
`;

const q = (db, sql, params) => db.query(sql, params);

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(MIG('035_document_audit.sql'));
  try { await db.exec(MIG('036_document_audit_rpc.sql')); ok('clean apply 036', true); } catch (e) { ok('clean apply 036: ' + e.message, false); }
  try { await db.exec(MIG('036_document_audit_rpc.sql')); ok('second apply 036 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const cnt = async (sql) => Number((await db.query(sql)).rows[0].c);
  ok('5 rpc functions created', (await cnt(`SELECT count(*) c FROM information_schema.routines WHERE routine_name LIKE 'rpc_document_%'`)) >= 5);
  ok('execute revoked from PUBLIC', (await cnt(`SELECT count(*) c FROM information_schema.routine_privileges WHERE grantee='PUBLIC' AND routine_name LIKE 'rpc_document_%'`)) === 0);

  const A = randomUUID(), B = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO businesses(id) VALUES ('${A}'),('${B}');
    INSERT INTO debts(id,business_id) VALUES (1,'${A}'),(2,'${B}');
    INSERT INTO transactions(id,business_id) VALUES (10,'${A}');`);

  // finalize_upload: document_files + financial_documents + audit, atomically.
  const fileId = randomUUID(), docId = randomUUID();
  const pFile = JSON.stringify({ id: fileId, business_id: A, storage_path: 'p', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 10, sha256_hash: 'a'.repeat(64), upload_channel: 'web' });
  const pDoc = JSON.stringify({ id: docId, business_id: A, document_type: 'other', currency: 'IDR' });
  await q(db, `SELECT rpc_document_finalize_upload($1::jsonb,$2::jsonb,$3,'web')`, [pFile, pDoc, 42]);
  ok('finalize created document_files', (await cnt(`SELECT count(*) c FROM document_files WHERE id='${fileId}'`)) === 1);
  ok('finalize created financial_documents', (await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${docId}'`)) === 1);
  ok('finalize wrote uploaded audit', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${docId}' AND action='uploaded'`)) === 1);

  // metadata update + audit.
  await q(db, `SELECT rpc_document_update_metadata('${docId}','${A}',42,$1::jsonb,'web')`, [JSON.stringify({ document_number: 'INV-1' })]);
  ok('metadata updated', (await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${docId}' AND document_number='INV-1'`)) === 1);
  ok('metadata wrote audit', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${docId}' AND action='metadata_changed'`)) === 1);

  // link to own-business debt + audit.
  const linkRow = await q(db, `SELECT rpc_document_link('${docId}','${A}','debt','1',42,'web') AS id`);
  const linkId = linkRow.rows[0].id;
  ok('link created', (await cnt(`SELECT count(*) c FROM document_debt_links WHERE document_id='${docId}'`)) === 1);
  ok('link wrote audit', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${docId}' AND action='linked'`)) === 1);

  // cross-business link rejected INSIDE the function (debt 2 is business B).
  let xb = false;
  try { await db.exec(`BEGIN; SELECT rpc_document_link('${docId}','${A}','debt','2',42,'web'); COMMIT;`); } catch { xb = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('cross-business link rejected in-function', xb);

  // unlink + audit (works on the existing link).
  await q(db, `SELECT rpc_document_unlink('${linkId}','${docId}','${A}',42,'web')`);
  ok('unlink removed link', (await cnt(`SELECT count(*) c FROM document_debt_links WHERE id='${linkId}'`)) === 0);
  ok('unlink wrote audit', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${docId}' AND action='unlinked'`)) === 1);

  // archive + audit, then archived doc cannot be re-mutated (metadata/link).
  await q(db, `SELECT rpc_document_archive('${docId}','${A}',42,'web')`);
  ok('archive set archived_at', (await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${docId}' AND archived_at IS NOT NULL`)) === 1);
  ok('archive wrote audit', (await cnt(`SELECT count(*) c FROM document_audit WHERE document_id='${docId}' AND action='archived'`)) === 1);
  let archBlocked = false;
  try { await db.exec(`BEGIN; SELECT rpc_document_update_metadata('${docId}','${A}',42,'{"document_number":"X"}'::jsonb,'web'); COMMIT;`); } catch { archBlocked = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('archived document cannot be modified', archBlocked);

  // Atomicity: force the audit INSERT to fail via a raising trigger → the
  // mutation must roll back (no partial success).
  await db.exec(`UPDATE financial_documents SET archived_at=NULL WHERE id='${docId}';
    CREATE FUNCTION _audit_boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER _audit_boom_t BEFORE INSERT ON document_audit FOR EACH ROW EXECUTE FUNCTION _audit_boom();`);
  const before = await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${docId}' AND document_number='SHOULD_NOT_PERSIST'`);
  let threw = false;
  try {
    await db.exec(`BEGIN; SELECT rpc_document_update_metadata('${docId}','${A}',42,'{"document_number":"SHOULD_NOT_PERSIST"}'::jsonb,'web'); COMMIT;`);
  } catch { threw = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  const after = await cnt(`SELECT count(*) c FROM financial_documents WHERE id='${docId}' AND document_number='SHOULD_NOT_PERSIST'`);
  ok('audit failure aborts the RPC', threw);
  ok('mutation rolled back when audit fails (atomic)', after === before);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
