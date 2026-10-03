// CI for 059 (minimum cash + weekly brief schedule, Design v2 P-08). PGlite, in memory.
// Run: node tests/migrations/ci_059.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const rejects = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' (NOT rejected!)', false); } catch { ok(label + ' rejected', true); }
};
const accepts = async (db, label, sql) => {
  try { await db.exec(sql); ok(label + ' accepted', true); } catch (e) { ok(label + ': ' + e.message, false); }
};

const BASELINE = `
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, type text NOT NULL DEFAULT 'business',
  owner_user_id bigint, base_currency text DEFAULT 'IDR', timezone text, updated_at timestamptz DEFAULT now());
INSERT INTO businesses (name, owner_user_id) VALUES ('Helm Care Indonesia', 900), ('Helm Care Pay', 901);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  // 059 extends 058; apply in order, as the owner will.
  await db.exec(MIG('058_business_runway_target.sql'));
  try { await db.exec(MIG('059_business_targets_alerts.sql')); ok('clean apply 059', true); } catch (e) { ok('clean apply 059: ' + e.message, false); }
  try { await db.exec(MIG('059_business_targets_alerts.sql')); ok('second apply 059 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  const cols = (await db.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='businesses' AND column_name IN ('min_cash_idr','weekly_brief_cron') ORDER BY column_name`)).rows;
  ok('both columns exist and are nullable', cols.length === 2 && cols.every((c) => c.is_nullable === 'YES'));
  ok('existing rows keep NULL', (await db.query(`SELECT count(*)::int n FROM businesses WHERE min_cash_idr IS NULL AND weekly_brief_cron IS NULL`)).rows[0].n === 2);

  await accepts(db, 'minimum cash 25,000,000.50', `UPDATE businesses SET min_cash_idr = 25000000.50 WHERE name='Helm Care Indonesia'`);
  ok('minimum cash keeps cents', (await db.query(`SELECT min_cash_idr::text v FROM businesses WHERE name='Helm Care Indonesia'`)).rows[0].v === '25000000.50');
  await accepts(db, 'minimum cash zero', `UPDATE businesses SET min_cash_idr = 0 WHERE name='Helm Care Pay'`);
  await rejects(db, 'negative minimum cash', `UPDATE businesses SET min_cash_idr = -1`);

  await accepts(db, 'Monday 08:00', `UPDATE businesses SET weekly_brief_cron = '0 8 * * 1' WHERE name='Helm Care Indonesia'`);
  await accepts(db, 'Sunday 23:59', `UPDATE businesses SET weekly_brief_cron = '59 23 * * 0'`);
  await accepts(db, 'cleared', `UPDATE businesses SET weekly_brief_cron = NULL`);
  for (const bad of ['* * * * *', '0 8 * * *', '0 */1 * * 1', '0 24 * * 1', '60 8 * * 1', '0 8 * * 7', '0 8 1 * 1', '0 8 * * 1,3', '', ' 0 8 * * 1', "0 8 * * 1'; DROP TABLE businesses; --"]) {
    await rejects(db, `schedule ${JSON.stringify(bad)}`, `UPDATE businesses SET weekly_brief_cron = '${bad.replace(/'/g, "''")}'`);
  }
  ok('runway target from 058 still works alongside', (await db.query(`UPDATE businesses SET runway_target_days = 45 RETURNING runway_target_days d`)).rows.every((r) => r.d === 45));

  console.log(`\n${fail ? 'FAILED' : 'ALL PASS'} — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
