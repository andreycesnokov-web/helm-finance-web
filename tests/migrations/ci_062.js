// CI for 062 (P-10: cashflow_categories.pnl_group + industry_templates). PGlite, in memory.
// Run: node tests/migrations/ci_062.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); }
};
const GROUPS = ['revenue', 'direct_cost', 'operating_cost', 'interest', 'other_income', 'tax', 'asset_purchase', 'funding', 'transfer'];
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

// cashflow_categories as it stands after 002 + 010 + 017, with a global template and two businesses.
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY, name text);
CREATE TABLE cashflow_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id bigint NULL, name text NOT NULL, group_type text NOT NULL,
  activity_type text NULL, sub_category text NULL, description text NULL, is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), language text DEFAULT 'en', is_template boolean NOT NULL DEFAULT false,
  source text DEFAULT 'user', business_id uuid NULL REFERENCES businesses(id));
INSERT INTO businesses VALUES ('${A}','A'),('${B}','B');
INSERT INTO cashflow_categories (user_id, name, group_type, activity_type, is_system, is_active, is_template, source) VALUES
  (NULL, 'Закупка товара', 'outflow', 'operating', true, false, true, 'helm_care_template');
INSERT INTO cashflow_categories (user_id, name, group_type, business_id) VALUES
  (900, 'Sales', 'inflow', '${A}'), (900, 'Fuel', 'outflow', '${A}'), (901, 'Sales', 'inflow', '${B}');
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  const before = (await db.query('SELECT id, name, group_type, is_active, business_id FROM cashflow_categories ORDER BY id')).rows;
  try { await db.exec(MIG('062_pnl_groups_industry_templates.sql')); ok('clean apply 062', true); } catch (e) { ok('clean apply 062: ' + e.message, false); }
  const seeded = (await db.query('SELECT count(*)::int n FROM industry_templates')).rows[0].n;
  try { await db.exec(MIG('062_pnl_groups_industry_templates.sql')); ok('second apply 062 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('new tables have row-level security on, like 037 (pre-release review)', (await db.query(`SELECT count(*)::int n FROM pg_class WHERE relname IN ('industry_templates') AND relrowsecurity`)).rows[0].n === 1);
  ok('second apply adds no template rows', (await db.query('SELECT count(*)::int n FROM industry_templates')).rows[0].n === seeded);

  const after = (await db.query('SELECT id, name, group_type, is_active, business_id, pnl_group FROM cashflow_categories ORDER BY id')).rows;
  ok('existing categories unchanged, pnl_group NULL everywhere', after.length === before.length && after.every((r, i) =>
    r.id === before[i].id && r.name === before[i].name && r.group_type === before[i].group_type && r.is_active === before[i].is_active && r.pnl_group === null));

  const per = Object.fromEntries((await db.query(`SELECT kbli_prefix k, count(*)::int n FROM industry_templates GROUP BY 1`)).rows.map((r) => [r.k, r.n]));
  ok('seeded generic, 81210 and 47999 suggestions', per['*'] === 50 && per['81210'] === 9 && per['47999'] === 8);
  const gs = (await db.query('SELECT DISTINCT pnl_group g FROM industry_templates')).rows.map((r) => r.g);
  ok('every seeded group is one of the 9', gs.every((g) => GROUPS.includes(g)));
  ok('all 46 system category names have a suggestion', (await db.query(`SELECT count(*)::int n FROM industry_templates WHERE kbli_prefix='*' AND category_name ~ '[А-Яа-я]'`)).rows[0].n === 46);
  ok('interest and other_income are separate groups in the seed', gs.includes('interest') && gs.includes('other_income'));

  for (const g of GROUPS) {
    try { await db.exec(`UPDATE cashflow_categories SET pnl_group='${g}' WHERE name='Sales' AND business_id='${A}'`); ok(`group ${g} accepted`, true); }
    catch (e) { ok(`group ${g}: ${e.message}`, false); }
  }
  await rejects(db, 'unknown group', `UPDATE cashflow_categories SET pnl_group='cogs' WHERE business_id='${A}'`);
  await rejects(db, 'upper-case group', `UPDATE cashflow_categories SET pnl_group='REVENUE' WHERE business_id='${A}'`);
  await rejects(db, 'a group on a global template row (isolation)', `UPDATE cashflow_categories SET pnl_group='direct_cost' WHERE business_id IS NULL`);
  await db.exec(`UPDATE cashflow_categories SET pnl_group='revenue' WHERE name='Sales' AND business_id='${A}'`);
  ok("business A's mapping does not touch business B", (await db.query(`SELECT pnl_group g FROM cashflow_categories WHERE business_id='${B}'`)).rows[0].g === null);
  await db.exec(`UPDATE cashflow_categories SET pnl_group=NULL WHERE business_id='${A}'`);
  ok('a mapping can be cleared', (await db.query(`SELECT count(*)::int n FROM cashflow_categories WHERE pnl_group IS NOT NULL`)).rows[0].n === 0);

  await rejects(db, 'template with an unknown group', `INSERT INTO industry_templates (kbli_prefix, category_name, pnl_group) VALUES ('81210','X','cogs')`);
  await rejects(db, 'template with a bad KBLI prefix', `INSERT INTO industry_templates (kbli_prefix, category_name, pnl_group) VALUES ('abc','X','revenue')`);
  await rejects(db, 'template with an empty name', `INSERT INTO industry_templates (kbli_prefix, category_name, pnl_group) VALUES ('81210','  ','revenue')`);
  await rejects(db, 'duplicate template row', `INSERT INTO industry_templates (kbli_prefix, category_name, pnl_group) VALUES ('81210','Cleaning service income','revenue')`);
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='industry_templates'`)).rows.map((r) => r.column_name);
  ok('templates hold no business data (no business_id column)', !cols.includes('business_id'));

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
