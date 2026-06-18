// Real migration CI for 030 on ephemeral PostgreSQL (PGlite).
// Run: node tests/migrations/ci_030.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const MIG = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '030_business_registry.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { console.log('OK  ' + m); pass++; };
const bad = (m) => { console.log('XX  ' + m); fail++; };

(async () => {
  const db = new PGlite();
  // baseline stand-in (users + businesses with the existing columns)
  await db.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, first_name text, username text);
    CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id bigint, name text,
      base_currency text, timezone text, country text, status text, plan text DEFAULT 'free',
      trial_status text, trial_started_at timestamptz, trial_ends_at timestamptz, subscription_status text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    INSERT INTO users(id,first_name) VALUES (1,'Owner');
    INSERT INTO businesses(name,owner_user_id) VALUES ('HelmCare Indonesia',1),('Andrey Business',1),('Stanislav',1);
  `);

  const exec = (sql) => db.exec(sql);
  const noVerify = MIG.replace(/SELECT id, name.*ORDER BY business_code;/s, '');

  try { await exec(MIG); ok('clean apply 030'); } catch (e) { bad('clean apply: ' + e.message); }
  let codes = (await db.query('select business_code from businesses order by business_code')).rows.map(r => r.business_code);
  (codes.length === 3 && codes.every(c => /^HF-BIZ-\d{6}$/.test(c))) ? ok('3 codes assigned (' + codes.join(',') + ')') : bad('codes wrong: ' + codes.join(','));

  try { await exec(noVerify); ok('second apply (idempotent)'); } catch (e) { bad('second apply: ' + e.message); }
  const codes2 = (await db.query('select business_code from businesses order by business_code')).rows.map(r => r.business_code);
  JSON.stringify(codes) === JSON.stringify(codes2) ? ok('existing codes stable after rerun') : bad('codes changed on rerun');

  await db.exec(`INSERT INTO businesses(name,owner_user_id) VALUES ('New Co',1)`);
  const newCode = (await db.query(`select business_code from businesses where name='New Co'`)).rows[0].business_code;
  /^HF-BIZ-\d{6}$/.test(newCode) ? ok('new business auto-code (' + newCode + ')') : bad('new business no code');

  const dupTry = async (label, sql) => { try { await db.exec(sql); bad(label + ' (NOT rejected)'); } catch { ok(label + ' rejected'); } finally { await db.exec('ROLLBACK').catch(() => {}); } };
  await dupTry('duplicate business_code rejected', `BEGIN; UPDATE businesses SET business_code='HF-BIZ-000001' WHERE name='New Co'; COMMIT;`);
  await dupTry('business_code UPDATE (immutable) rejected', `BEGIN; UPDATE businesses SET business_code='HF-BIZ-999999' WHERE name='HelmCare Indonesia'; COMMIT;`);
  await dupTry('invalid type rejected by CHECK', `BEGIN; INSERT INTO businesses(name,owner_user_id,type) VALUES ('X',1,'galaxy'); COMMIT;`);

  // append-only access_audit
  await db.exec(`INSERT INTO access_audit(business_id,action) SELECT id,'override_created' FROM businesses LIMIT 1`);
  await dupTry('access_audit UPDATE blocked (append-only)', `BEGIN; UPDATE access_audit SET action='x'; COMMIT;`);
  await dupTry('access_audit DELETE blocked (append-only)', `BEGIN; DELETE FROM access_audit; COMMIT;`);

  // null/duplicate code checks
  const nulls = Number((await db.query(`select count(*) c from businesses where business_code is null`)).rows[0].c);
  nulls === 0 ? ok('business_code null count = 0') : bad('null codes: ' + nulls);
  const dups = Number((await db.query(`select count(*) c from (select business_code from businesses group by business_code having count(*)>1) x`)).rows[0].c);
  dups === 0 ? ok('duplicate code count = 0') : bad('dup codes: ' + dups);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
