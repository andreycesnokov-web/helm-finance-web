// CI for 064 (P-03 business funding register). PGlite, in memory. Run: node tests/migrations/ci_064.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => { try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); } };
const accepts = async (db, label, sql) => { try { await db.exec(sql); ok(label + ' accepted', true); } catch (e) { ok(label + ': ' + e.message, false); } };
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const CA = 'cccccccc-0000-4000-8000-00000000000a', CB = 'cccccccc-0000-4000-8000-00000000000b';
const L = 'aaaaaaaa-0000-4000-8000-0000000000a1', E = 'aaaaaaaa-0000-4000-8000-0000000000e1', LB = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY, name text, type text);
CREATE TABLE counterparties (id uuid PRIMARY KEY, business_id uuid);
CREATE TABLE transactions (id integer PRIMARY KEY, business_id uuid, amount_original numeric);
-- The bridge's own tables from 038 exist and must not be touched.
CREATE TABLE funding_repayments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text);
INSERT INTO funding_repayments (note) VALUES ('bridge row');
INSERT INTO businesses VALUES ('${A}','A','business'),('${B}','B','business');
INSERT INTO counterparties VALUES ('${CA}','${A}'),('${CB}','${B}');
INSERT INTO transactions VALUES (1,'${A}',100000000),(2,'${A}',2500000),(3,'${B}',1),(4,'${A}',2500000);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  try { await db.exec(MIG('064_business_funding_register.sql')); ok('clean apply 064', true); } catch (e) { ok('clean apply 064: ' + e.message, false); }
  try { await db.exec(MIG('064_business_funding_register.sql')); ok('second apply 064 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('new tables have row-level security on, like 037 (pre-release review)', (await db.query(`SELECT count(*)::int n FROM pg_class WHERE relname IN ('business_funding_records', 'business_funding_repayments') AND relrowsecurity`)).rows[0].n === 2);
  ok('the bridge table funding_repayments is untouched', (await db.query(`SELECT count(*)::int n FROM funding_repayments`)).rows[0].n === 1
    && (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='funding_repayments'`)).rows[0].n === 2);
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('business_funding_records','business_funding_repayments')`)).rows.map((r) => r.column_name);
  ok('no link to Personal: no workspace, wallet or bridge column', !cols.some((c) => /personal|wallet|workspace|relationship|bridge/.test(c)));

  await accepts(db, 'founder loan with interest and a due date', `INSERT INTO business_funding_records (id, business_id, source_kind, instrument, lender_name, amount, received_on, received_transaction_id, interest_rate_annual, due_on)
    VALUES ('${L}','${A}','founder','loan','Founder',100000000,'2026-01-10',1,6,'2027-01-10')`);
  await accepts(db, 'investor equity linked to a counterparty', `INSERT INTO business_funding_records (id, business_id, source_kind, instrument, counterparty_id, amount, received_on) VALUES ('${E}','${A}','investor','equity','${CA}',50000000,'2026-02-01')`);
  await accepts(db, 'a loan in business B', `INSERT INTO business_funding_records (id, business_id, source_kind, instrument, lender_name, amount, received_on) VALUES ('${LB}','${B}','bank','loan','Bank B',1000,'2026-02-01')`);
  await rejects(db, 'equity with interest', `INSERT INTO business_funding_records (business_id, source_kind, instrument, lender_name, amount, received_on, interest_rate_annual) VALUES ('${A}','investor','equity','X',1,'2026-01-01',5)`);
  await rejects(db, 'no lender at all', `INSERT INTO business_funding_records (business_id, source_kind, instrument, amount, received_on) VALUES ('${A}','bank','loan',1,'2026-01-01')`);
  await rejects(db, 'zero amount', `INSERT INTO business_funding_records (business_id, source_kind, instrument, lender_name, amount, received_on) VALUES ('${A}','bank','loan','X',0,'2026-01-01')`);
  await rejects(db, 'unknown source', `INSERT INTO business_funding_records (business_id, source_kind, instrument, lender_name, amount, received_on) VALUES ('${A}','personal_wallet','loan','X',1,'2026-01-01')`);
  await rejects(db, 'due before received', `INSERT INTO business_funding_records (business_id, source_kind, instrument, lender_name, amount, received_on, due_on) VALUES ('${A}','bank','loan','X',1,'2026-05-01','2026-01-01')`);
  await rejects(db, 'isolation: another business’s lender', `INSERT INTO business_funding_records (business_id, source_kind, instrument, counterparty_id, amount, received_on) VALUES ('${A}','bank','loan','${CB}',1,'2026-01-01')`);
  await rejects(db, 'isolation: another business’s transaction', `INSERT INTO business_funding_records (business_id, source_kind, instrument, lender_name, amount, received_on, received_transaction_id) VALUES ('${A}','bank','loan','X',1,'2026-01-01',3)`);

  await accepts(db, 'a scheduled repayment with principal and interest', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal, interest) VALUES ('${A}','${L}','2026-11-10',2000000,500000)`);
  await accepts(db, 'a paid repayment linked to its payment', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal, interest, paid_on, paid_transaction_id) VALUES ('${A}','${L}','2026-10-10',2000000,500000,'2026-10-10',2)`);
  await rejects(db, 'the same payment settling two repayments', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal, paid_on, paid_transaction_id) VALUES ('${A}','${L}','2026-12-10',1,'2026-12-10',2)`);
  await rejects(db, 'a repayment on equity', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal) VALUES ('${A}','${E}','2026-11-10',1)`);
  await rejects(db, 'an empty repayment', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on) VALUES ('${A}','${L}','2026-11-10')`);
  await rejects(db, 'a payment link without a paid date', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal, paid_transaction_id) VALUES ('${A}','${L}','2026-11-10',1,4)`);
  await rejects(db, 'isolation: a repayment filed under another business', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal) VALUES ('${B}','${L}','2026-11-10',1)`);
  await rejects(db, 'isolation: a repayment paid from another business’s transaction', `INSERT INTO business_funding_repayments (business_id, funding_record_id, due_on, principal, paid_on, paid_transaction_id) VALUES ('${A}','${L}','2026-11-10',1,'2026-11-10',3)`);
  await rejects(db, 'isolation: moving a record with a lender to another business', `UPDATE business_funding_records SET business_id='${B}' WHERE id='${E}'`);

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
