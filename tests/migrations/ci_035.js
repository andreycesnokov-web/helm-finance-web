// Real migration CI for 035_document_audit on ephemeral PostgreSQL (PGlite).
// Applies the post-031 minimal schema, then 035 twice (idempotency), and checks
// the append-only guard. Run: node tests/migrations/ci_035.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m) => { console.log('OK  ' + m); pass++; };
const bad = (m) => { console.log('XX  ' + m); fail++; };

const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);

  try { await db.exec(MIG('035_document_audit.sql')); ok('clean apply 035'); } catch (e) { bad('clean apply: ' + e.message); }
  try { await db.exec(MIG('035_document_audit.sql')); ok('second apply 035 (idempotent)'); } catch (e) { bad('second apply: ' + e.message); }

  const cnt = async (sql) => Number((await db.query(sql)).rows[0].c);
  ((await cnt(`SELECT count(*) c FROM information_schema.tables WHERE table_name='document_audit'`)) === 1)
    ? ok('document_audit table present') : bad('table missing');

  const A = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO businesses(id) VALUES ('${A}')`);

  // append works
  try { await db.exec(`INSERT INTO document_audit(business_id, action) VALUES ('${A}','uploaded')`); ok('append insert works'); }
  catch (e) { bad('append insert: ' + e.message); }

  // update blocked
  try { await db.exec(`BEGIN; UPDATE document_audit SET action='x' WHERE business_id='${A}'; COMMIT;`); bad('UPDATE not blocked!'); }
  catch { ok('UPDATE blocked (append-only)'); } finally { await db.exec('ROLLBACK').catch(() => {}); }

  // delete blocked
  try { await db.exec(`BEGIN; DELETE FROM document_audit WHERE business_id='${A}'; COMMIT;`); bad('DELETE not blocked!'); }
  catch { ok('DELETE blocked (append-only)'); } finally { await db.exec('ROLLBACK').catch(() => {}); }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
