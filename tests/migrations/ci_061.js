// CI for 061 (bill checklist: accountant check, Design v2 P-05, option B — no slip column).
// PGlite, in memory. Run: node tests/migrations/ci_061.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); }
};

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY, name text);
CREATE TABLE debts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid REFERENCES businesses(id),
  user_id bigint, type text, counterparty text, amount numeric(18,2), status text DEFAULT 'open',
  approval_status text, created_at timestamptz DEFAULT now());
INSERT INTO businesses VALUES ('${A}','A'),('${B}','B');
INSERT INTO debts (business_id, user_id, type, counterparty, amount, approval_status) VALUES
  ('${A}', 900, 'payable', 'PT Vendor A', 11000000, 'approved'),
  ('${B}', 901, 'payable', 'PT Vendor B', 5000000, 'pending_approval');
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  const before = (await db.query('SELECT * FROM debts ORDER BY id')).rows;
  const triggersBefore = (await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`)).rows[0].n;
  try { await db.exec(MIG('061_bill_checklist_status.sql')); ok('clean apply 061', true); } catch (e) { ok('clean apply 061: ' + e.message, false); }
  try { await db.exec(MIG('061_bill_checklist_status.sql')); ok('second apply 061 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='debts' ORDER BY column_name`)).rows.map((r) => r.column_name);
  ok('adds exactly accountant_checked_at and accountant_checked_by', cols.includes('accountant_checked_at') && cols.includes('accountant_checked_by') && cols.length === 9 + 2);
  ok('option B: no withholding slip column on debts', !cols.includes('withholding_slip_document_id'));
  ok('option B: no trigger added', (await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`)).rows[0].n === triggersBefore);

  const after = (await db.query('SELECT * FROM debts ORDER BY id')).rows;
  ok('existing bills unchanged, new fields NULL', after.length === before.length && after.every((r, i) =>
    r.amount === before[i].amount && r.status === before[i].status && r.approval_status === before[i].approval_status
    && r.accountant_checked_at === null && r.accountant_checked_by === null));

  await db.exec(`UPDATE debts SET accountant_checked_at = now(), accountant_checked_by = 77 WHERE business_id='${A}'`);
  ok('accountant check stored with who and when', Number((await db.query(`SELECT accountant_checked_by b FROM debts WHERE business_id='${A}'`)).rows[0].b) === 77);
  ok('setting it on one business leaves the other untouched', (await db.query(`SELECT accountant_checked_at a FROM debts WHERE business_id='${B}'`)).rows[0].a === null);
  await rejects(db, 'checked-at without checked-by', `UPDATE debts SET accountant_checked_at = now() WHERE business_id='${B}'`);
  await rejects(db, 'checked-by without checked-at', `UPDATE debts SET accountant_checked_by = 5 WHERE business_id='${B}'`);
  await db.exec(`UPDATE debts SET accountant_checked_at = NULL, accountant_checked_by = NULL WHERE business_id='${A}'`);
  ok('check can be cleared as a pair', (await db.query(`SELECT accountant_checked_at a FROM debts WHERE business_id='${A}'`)).rows[0].a === null);

  await db.exec(`UPDATE debts SET status='paid' WHERE business_id='${B}'`);
  ok('unrelated debt updates still work', (await db.query(`SELECT status FROM debts WHERE business_id='${B}'`)).rows[0].status === 'paid');
  await db.exec(`INSERT INTO debts (business_id, type, amount) VALUES ('${B}','receivable', 1)`);
  ok('inserts without the check still work', (await db.query(`SELECT count(*)::int n FROM debts`)).rows[0].n === 3);

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
