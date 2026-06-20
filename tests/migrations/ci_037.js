// CI for 037 (workspace foundation + multi-asset wallets + precision). PGlite.
// Run: node tests/migrations/ci_037.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite'); const { randomUUID } = require('crypto');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const cnt = async (db, sql) => Number((await db.query(sql)).rows[0].c);
const reject = async (db, l, sql) => { try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(l + ' (NOT rejected!)', false); } catch { ok(l + ' rejected', true); } finally { await db.exec('ROLLBACK').catch(() => {}); } };

// Legacy-shaped baseline: amount_original DECIMAL(18,2) (the production type to widen).
const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business', owner_user_id bigint, base_currency text DEFAULT 'IDR', plan text DEFAULT 'free');
CREATE TABLE business_members (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid REFERENCES businesses(id), user_id bigint, role text DEFAULT 'owner', status text DEFAULT 'active', UNIQUE(business_id,user_id));
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, currency text NOT NULL DEFAULT 'IDR', scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, type text, amount_original DECIMAL(18,2) NOT NULL, amount_idr DECIMAL(18,2), currency_original text, scope text, wallet_id uuid);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
INSERT INTO users(id) VALUES (1);
INSERT INTO businesses(id,type,owner_user_id) VALUES ('11111111-1111-1111-1111-111111111111','business',1);
INSERT INTO wallets(id,business_id,currency) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','IDR');
INSERT INTO transactions(business_id,type,amount_original,amount_idr,currency_original) VALUES ('11111111-1111-1111-1111-111111111111','income',1500000.50,1500000.50,'IDR');
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  ok('legacy precision is 2dp before 037', (await db.query(`SELECT numeric_scale s FROM information_schema.columns WHERE table_name='transactions' AND column_name='amount_original'`)).rows[0].s === 2);
  try { await db.exec(MIG('037_personal_workspace_foundation.sql')); ok('clean apply 037', true); } catch (e) { ok('clean apply 037: ' + e.message, false); }
  try { await db.exec(MIG('037_personal_workspace_foundation.sql')); ok('second apply 037 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }

  // precision widened + legacy value preserved
  ok('precision widened to scale 18', (await db.query(`SELECT numeric_scale s FROM information_schema.columns WHERE table_name='transactions' AND column_name='amount_original'`)).rows[0].s === 18);
  ok('legacy IDR value preserved exactly', Number((await db.query(`SELECT amount_original a FROM transactions WHERE currency_original='IDR'`)).rows[0].a) === 1500000.50);
  // crypto precision now storable
  await db.exec(`INSERT INTO transactions(business_id,type,amount_original,currency_original,asset_code) VALUES ('11111111-1111-1111-1111-111111111111','income',0.00000001,'BTC','BTC')`);
  ok('crypto 0.00000001 BTC stored exactly', (await db.query(`SELECT amount_original::text a FROM transactions WHERE asset_code='BTC'`)).rows[0].a.startsWith('0.00000001'));

  // wallet asset metadata + immutability
  ok('wallets gained asset metadata, backfilled', (await cnt(db, `SELECT count(*) c FROM wallets WHERE asset_code='IDR' AND asset_type='fiat'`)) === 1);
  await db.exec(`INSERT INTO transactions(business_id,type,amount_original,currency_original,asset_code,wallet_id) VALUES ('11111111-1111-1111-1111-111111111111','income',100,'IDR','IDR','22222222-2222-2222-2222-222222222222')`);
  await reject(db, 'wallet asset change after a transaction', `UPDATE wallets SET asset_code='USD' WHERE id='22222222-2222-2222-2222-222222222222'`);
  // a fresh wallet with no transactions CAN set its asset
  await db.exec(`INSERT INTO wallets(id,business_id,currency,asset_type,asset_code,decimal_precision) VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','USDT','crypto','USDT',6)`).then(() => ok('crypto wallet creatable', true), (e) => ok('crypto wallet creatable: ' + e.message, false));

  // foundation: multi personal WS, owner-only, prefs, relationships, roles
  const U = 9; const P1 = randomUUID(), P2 = randomUUID(), B = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO users(id) VALUES (${U}); INSERT INTO businesses(id,type,owner_user_id,plan) VALUES ('${P1}','personal',${U},'personal_pro'),('${P2}','personal',${U},'free'),('${B}','business',${U},'founder');
    INSERT INTO business_members(business_id,user_id) VALUES ('${P1}',${U}),('${P2}',${U}),('${B}',${U});`);
  ok('multiple personal workspaces for one owner', (await cnt(db, `SELECT count(*) c FROM businesses WHERE owner_user_id=${U} AND type='personal'`)) === 2);
  ok('independent plan fields', (await cnt(db, `SELECT count(DISTINCT plan) c FROM businesses WHERE owner_user_id=${U}`)) >= 2);
  await reject(db, 'non-owner member on personal workspace', `INSERT INTO business_members(business_id,user_id) VALUES ('${P1}',999)`);
  await reject(db, 'personal cannot be default_business', `INSERT INTO user_workspace_preferences(user_id,default_business_workspace_id) VALUES (${U},'${P1}')`);
  await db.exec(`INSERT INTO user_workspace_preferences(user_id,primary_personal_workspace_id,default_business_workspace_id) VALUES (${U},'${P1}','${B}')`).then(() => ok('valid prefs', true), (e) => ok('valid prefs: ' + e.message, false));
  const REL = randomUUID();
  await db.exec(`INSERT INTO personal_business_relationships(id,personal_workspace_id,business_id,status) VALUES ('${REL}','${P1}','${B}','active')`);
  await reject(db, 'personal<->personal relationship', `INSERT INTO personal_business_relationships(personal_workspace_id,business_id) VALUES ('${P1}','${P2}')`);
  await reject(db, 'business<->business relationship', `INSERT INTO personal_business_relationships(personal_workspace_id,business_id) VALUES ('${B}','11111111-1111-1111-1111-111111111111')`);
  await db.exec(`INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','founder'),('${REL}','investor')`);
  ok('relationship multiple roles', (await cnt(db, `SELECT count(*) c FROM personal_business_relationship_roles WHERE relationship_id='${REL}'`)) === 2);
  await reject(db, 'duplicate role', `INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','founder')`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
