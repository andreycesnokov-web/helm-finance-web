// CI for 060 (counterparty entity form + payment terms, Design v2 P-04). PGlite, in memory.
// Applies on top of the real 055 so the table is the one production has.
// Run: node tests/migrations/ci_060.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); }
};

const BIZ = '11111111-1111-4111-8111-111111111111';
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY, owner_user_id bigint, name text, type text, created_at timestamptz DEFAULT now());
CREATE TABLE counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL, name TEXT NOT NULL, group_name TEXT NULL,
  type TEXT NULL, email TEXT NULL, phone TEXT NULL, notes TEXT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_id UUID NULL REFERENCES businesses(id));
INSERT INTO businesses (id, owner_user_id, name, type) VALUES ('${BIZ}', 900, 'Helm Care Indonesia', 'company');
INSERT INTO counterparties (user_id, name, type, business_id) VALUES
  (900, 'PT Circleka Indonesia Utama', 'supplier', '${BIZ}'),
  (900, 'PT Legacy Franchisee', 'franchisee', '${BIZ}'),
  (900, 'PT Orphan', NULL, NULL);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  await db.exec(MIG('055_counterparty_intelligence_v1.sql'));
  const before = (await db.query('SELECT id, name, type, legal_name, status FROM counterparties ORDER BY name')).rows;
  try { await db.exec(MIG('060_counterparty_tax_fields.sql')); ok('clean apply 060', true); } catch (e) { ok('clean apply 060: ' + e.message, false); }
  try { await db.exec(MIG('060_counterparty_tax_fields.sql')); ok('second apply 060 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const after = (await db.query('SELECT id, name, type, legal_name, status, entity_form, payment_terms_days FROM counterparties ORDER BY name')).rows;
  ok('every legacy row survives with name/type/status untouched', after.length === before.length
    && after.every((r, i) => r.id === before[i].id && r.name === before[i].name && r.type === before[i].type && r.status === before[i].status));
  ok('new fields NULL on existing rows', after.every((r) => r.entity_form === null && r.payment_terms_days === null));

  for (const f of ['pt', 'cv', 'person', 'foreign', 'other']) {
    try { await db.exec(`UPDATE counterparties SET entity_form='${f}' WHERE name='PT Circleka Indonesia Utama'`); ok(`entity form ${f} accepted`, true); }
    catch (e) { ok(`entity form ${f}: ${e.message}`, false); }
  }
  await rejects(db, 'unknown entity form', `UPDATE counterparties SET entity_form='llc'`);
  await rejects(db, 'upper-case entity form', `UPDATE counterparties SET entity_form='PT'`);
  await db.exec(`UPDATE counterparties SET payment_terms_days = 30 WHERE name='PT Circleka Indonesia Utama'`);
  ok('payment terms 30 stored', (await db.query(`SELECT payment_terms_days d FROM counterparties WHERE name='PT Circleka Indonesia Utama'`)).rows[0].d === 30);
  await rejects(db, 'negative payment terms', `UPDATE counterparties SET payment_terms_days = -1`);
  await rejects(db, 'payment terms over a year', `UPDATE counterparties SET payment_terms_days = 366`);

  // Landlord / lender are application roles stored in `type`, which stays unconstrained.
  await db.exec(`UPDATE counterparties SET type='landlord' WHERE name='PT Legacy Franchisee'`);
  ok('landlord role fits the existing type column (no constraint added)', (await db.query(`SELECT type FROM counterparties WHERE name='PT Legacy Franchisee'`)).rows[0].type === 'landlord');
  ok('legacy type values still accepted', (await db.query(`UPDATE counterparties SET type='franchisee' WHERE name='PT Legacy Franchisee' RETURNING type`)).rows[0].type === 'franchisee');

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
