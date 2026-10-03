// CI for 063 (P-11 asset register). PGlite, in memory. Run: node tests/migrations/ci_063.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => { try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); } };
const accepts = async (db, label, sql) => { try { await db.exec(sql); ok(label + ' accepted', true); } catch (e) { ok(label + ': ' + e.message, false); } };

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const CA = 'cccccccc-0000-4000-8000-00000000000a', CB = 'cccccccc-0000-4000-8000-00000000000b';
const FA = 'ffffffff-0000-4000-8000-00000000000a', FB = 'ffffffff-0000-4000-8000-00000000000b';
const DA = 'dddddddd-0000-4000-8000-00000000000a', DB = 'dddddddd-0000-4000-8000-00000000000b';
const R = 'eeeeeeee-0000-4000-8000-000000000001';
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY, name text);
CREATE TABLE counterparties (id uuid PRIMARY KEY, business_id uuid);
CREATE TABLE debts (id integer PRIMARY KEY, business_id uuid, amount numeric);
CREATE TABLE transactions (id integer PRIMARY KEY, business_id uuid, amount_original numeric);
CREATE TABLE document_files (id uuid PRIMARY KEY, business_id uuid);
CREATE TABLE financial_documents (id uuid PRIMARY KEY, business_id uuid, file_id uuid);
CREATE TABLE tax_rules (id uuid PRIMARY KEY, obligation_type text);
INSERT INTO businesses VALUES ('${A}','A'),('${B}','B');
INSERT INTO counterparties VALUES ('${CA}','${A}'),('${CB}','${B}');
INSERT INTO debts VALUES (1,'${A}',7000000),(2,'${B}',100);
INSERT INTO transactions VALUES (10,'${A}',7000000),(20,'${B}',100);
INSERT INTO document_files VALUES ('${FA}','${A}'),('${FB}','${B}');
INSERT INTO financial_documents VALUES ('${DA}','${A}','${FA}'),('${DB}','${B}','${FB}');
INSERT INTO tax_rules VALUES ('${R}','depreciation');
`;
const ins = (extra = {}) => {
  const row = { business_id: `'${A}'`, name: `'Floor scrubber'`, asset_type: `'machines'`, cost: 7000000, acquired_on: `'2026-09-15'`, ...extra };
  return `INSERT INTO assets (${Object.keys(row).join(',')}) VALUES (${Object.values(row).join(',')})`;
};

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  const counts = async () => (await db.query(`SELECT (SELECT count(*) FROM debts)::int d, (SELECT count(*) FROM transactions)::int t`)).rows[0];
  const before = await counts();
  try { await db.exec(MIG('063_asset_register.sql')); ok('clean apply 063', true); } catch (e) { ok('clean apply 063: ' + e.message, false); }
  try { await db.exec(MIG('063_asset_register.sql')); ok('second apply 063 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  const after = await counts();
  ok('existing data unchanged', after.d === before.d && after.t === before.t);
  ok('table starts empty', (await db.query('SELECT count(*)::int n FROM assets')).rows[0].n === 0);

  await accepts(db, 'asset without a verified rule (no life, no rule)', ins());
  await accepts(db, 'asset with a life set by a rule', ins({ name: `'Laptop'`, asset_type: `'computers'`, cost: 15000000, useful_life_months: 48, depreciation_rule_id: `'${R}'`, asset_group: `'group_1'` }));
  await accepts(db, 'asset linked to its own bill, payment, document and supplier', ins({ name: `'Van'`, asset_type: `'vehicles'`, purchase_debt_id: 1, purchase_transaction_id: 10, purchase_document_id: `'${DA}'`, supplier_counterparty_id: `'${CA}'` }));

  await rejects(db, 'a life without the rule that set it', ins({ useful_life_months: 48 }));
  await rejects(db, 'a rule without a life', ins({ depreciation_rule_id: `'${R}'` }));
  await rejects(db, 'zero cost', ins({ cost: 0 }));
  await rejects(db, 'zero quantity', ins({ quantity: 0 }));
  await rejects(db, 'unknown asset type', ins({ asset_type: `'jewellery'` }));
  await rejects(db, 'another depreciation method', ins({ depreciation_method: `'declining_balance'` }));
  await rejects(db, 'life over 50 years', ins({ useful_life_months: 601, depreciation_rule_id: `'${R}'` }));
  await rejects(db, 'disposed before acquired', ins({ disposed_on: `'2026-01-01'` }));
  await rejects(db, 'blank name', ins({ name: `'  '` }));
  await rejects(db, 'the same bill registered twice', ins({ name: `'Van again'`, purchase_debt_id: 1 }));
  await rejects(db, 'isolation: another business’s bill', ins({ purchase_debt_id: 2 }));
  await rejects(db, 'isolation: another business’s payment', ins({ purchase_transaction_id: 20 }));
  await rejects(db, 'isolation: another business’s document', ins({ purchase_document_id: `'${DB}'` }));
  await rejects(db, 'isolation: another business’s supplier', ins({ supplier_counterparty_id: `'${CB}'` }));
  await rejects(db, 'isolation: moving an asset with links to another business', `UPDATE assets SET business_id='${B}' WHERE name='Van'`);
  await accepts(db, 'disposal on or after acquisition', `UPDATE assets SET disposed_on='2026-12-31' WHERE name='Laptop'`);

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
