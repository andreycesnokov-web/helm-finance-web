// CI for 058 (per-business runway target, Design v2 P-01). PGlite, in memory — touches no
// real database. Run: node tests/migrations/ci_058.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); }
};

// businesses as it is before 058: the columns other routes read, plus legacy rows.
const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, type text NOT NULL DEFAULT 'business',
  owner_user_id bigint, base_currency text DEFAULT 'IDR', timezone text, updated_at timestamptz DEFAULT now());
INSERT INTO businesses (id, name, type, owner_user_id) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Helm Care Indonesia', 'business', 900),
  ('22222222-2222-4222-8222-222222222222', 'Personal', 'personal', 900);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  const before = (await db.query('SELECT id, name, type, owner_user_id FROM businesses ORDER BY id')).rows;
  try { await db.exec(MIG('058_business_runway_target.sql')); ok('clean apply 058', true); } catch (e) { ok('clean apply 058: ' + e.message, false); }
  try { await db.exec(MIG('058_business_runway_target.sql')); ok('second apply 058 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const col = (await db.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='businesses' AND column_name='runway_target_days'`)).rows[0];
  ok('column exists, integer, nullable', col && col.data_type === 'integer' && col.is_nullable === 'YES');
  const after = (await db.query('SELECT id, name, type, owner_user_id, runway_target_days FROM businesses ORDER BY id')).rows;
  ok('existing rows untouched and NULL (= 60-day default)', after.length === before.length
    && after.every((r, i) => r.name === before[i].name && r.type === before[i].type && r.runway_target_days === null));

  await db.exec(`UPDATE businesses SET runway_target_days = 90 WHERE name = 'Helm Care Indonesia'`);
  ok('a sane target is stored', (await db.query(`SELECT runway_target_days d FROM businesses WHERE name='Helm Care Indonesia'`)).rows[0].d === 90);
  await db.exec(`UPDATE businesses SET runway_target_days = NULL WHERE name = 'Helm Care Indonesia'`);
  ok('it can be cleared back to the default', (await db.query(`SELECT runway_target_days d FROM businesses WHERE name='Helm Care Indonesia'`)).rows[0].d === null);
  await rejects(db, 'zero days', `UPDATE businesses SET runway_target_days = 0`);
  await rejects(db, 'negative days', `UPDATE businesses SET runway_target_days = -5`);
  await rejects(db, 'more than two years', `UPDATE businesses SET runway_target_days = 731`);
  const cols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='businesses'`)).rows[0].n;
  ok('exactly one column added', cols === 7 + 1);

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
