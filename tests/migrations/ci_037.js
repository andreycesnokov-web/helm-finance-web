// Real migration CI for 037 (personal funding foundation) on PGlite.
// Run: node tests/migrations/ci_037.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

// Baseline mirrors prod FK targets: businesses(uuid, type, plan…), wallets(uuid),
// transactions(integer), financial_documents(uuid), users(bigint), business_members.
const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business',
  owner_user_id bigint, plan text DEFAULT 'free', trial_status text DEFAULT 'inactive',
  subscription_status text, admin_override_plan text);
CREATE TABLE business_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid REFERENCES businesses(id),
  user_id bigint, role text NOT NULL DEFAULT 'owner', status text NOT NULL DEFAULT 'active',
  UNIQUE(business_id, user_id));
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, type text, amount_original numeric);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

const q = (db, sql, p) => db.query(sql, p);
const cnt = async (db, sql) => Number((await db.query(sql)).rows[0].c);
const reject = async (db, label, sql) => {
  try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(label + ' (NOT rejected!)', false); }
  catch { ok(label + ' rejected', true); } finally { await db.exec('ROLLBACK').catch(() => {}); }
};

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);

  try { await db.exec(MIG('037_personal_funding_foundation.sql')); ok('clean apply 037', true); } catch (e) { ok('clean apply 037: ' + e.message, false); }
  try { await db.exec(MIG('037_personal_funding_foundation.sql')); ok('second apply 037 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('6 tables + view present',
    (await cnt(db, `SELECT count(*) c FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_workspace_preferences','personal_business_relationships','personal_business_relationship_roles','funding_transfers','funding_repayments','funding_audit')`)) === 6 &&
    (await cnt(db, `SELECT count(*) c FROM information_schema.views WHERE table_name='personal_funding_balances'`)) === 1);

  // ── seed: one owner, two personal workspaces, one business ────────────────
  const U = 1001, U2 = 1002;
  await db.exec('COMMIT').catch(() => {});
  const P1 = randomUUID(), P2 = randomUUID(), B = randomUUID(), B2 = randomUUID();
  await db.exec(`INSERT INTO users(id) VALUES (${U}),(${U2});
    INSERT INTO businesses(id,type,owner_user_id,plan) VALUES
      ('${P1}','personal',${U},'personal_pro'),
      ('${P2}','personal',${U},'free'),
      ('${B}','business',${U},'founder'),
      ('${B2}','business',${U2},'free');
    INSERT INTO business_members(business_id,user_id,role) VALUES ('${P1}',${U},'owner'),('${P2}',${U},'owner'),('${B}',${U},'owner'),('${B2}',${U2},'owner');
    INSERT INTO wallets(id,business_id,scope) VALUES (gen_random_uuid(),'${P1}','personal'),(gen_random_uuid(),'${B}','business');`);

  ok('multiple personal workspaces for one owner',
    (await cnt(db, `SELECT count(*) c FROM businesses WHERE owner_user_id=${U} AND type='personal'`)) === 2);
  ok('independent plan fields per workspace',
    (await cnt(db, `SELECT count(DISTINCT plan) c FROM businesses WHERE owner_user_id=${U}`)) >= 2);

  // ── owner-only privacy guard on personal workspaces ───────────────────────
  await reject(db, 'non-owner member on personal workspace',
    `INSERT INTO business_members(business_id,user_id,role) VALUES ('${P1}',${U2},'cfo')`);
  await db.exec(`INSERT INTO business_members(business_id,user_id,role) VALUES ('${B}',${U2},'cfo')`).then(
    () => ok('non-owner member on BUSINESS allowed', true), () => ok('non-owner member on BUSINESS allowed', false));

  // ── preferences type guards ───────────────────────────────────────────────
  await db.exec(`INSERT INTO user_workspace_preferences(user_id, primary_personal_workspace_id, default_business_workspace_id) VALUES (${U},'${P1}','${B}')`)
    .then(() => ok('valid preferences accepted', true), (e) => ok('valid preferences accepted: ' + e.message, false));
  await reject(db, 'personal workspace cannot be default_business',
    `INSERT INTO user_workspace_preferences(user_id, default_business_workspace_id) VALUES (${U2},'${P1}')`);
  await reject(db, 'business workspace cannot be primary_personal',
    `INSERT INTO user_workspace_preferences(user_id, primary_personal_workspace_id) VALUES (${U2},'${B}')`);

  // ── relationship type guards (personal<->business only) ───────────────────
  const REL = randomUUID();
  await db.exec(`INSERT INTO personal_business_relationships(id,personal_workspace_id,business_id,status,requested_by_user_id) VALUES ('${REL}','${P1}','${B}','active',${U})`)
    .then(() => ok('valid personal<->business relationship', true), (e) => ok('valid relationship: ' + e.message, false));
  await reject(db, 'personal<->personal relationship', `INSERT INTO personal_business_relationships(personal_workspace_id,business_id) VALUES ('${P1}','${P2}')`);
  await reject(db, 'business<->business relationship', `INSERT INTO personal_business_relationships(personal_workspace_id,business_id) VALUES ('${B}','${B2}')`);

  // ── multiple roles + duplicate role rejected ──────────────────────────────
  await db.exec(`INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','founder'),('${REL}','shareholder'),('${REL}','investor')`);
  ok('relationship can have multiple roles', (await cnt(db, `SELECT count(*) c FROM personal_business_relationship_roles WHERE relationship_id='${REL}'`)) === 3);
  await reject(db, 'duplicate role', `INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','founder')`);
  await reject(db, 'invalid role value', `INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','king')`);

  // ── funding type guards + confirmed-leg constraint ────────────────────────
  await reject(db, 'capital_contribution with repayable=true',
    `INSERT INTO funding_transfers(relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,amount,idempotency_key) VALUES ('${REL}','${P1}','${B}',${U},'capital_contribution',true,1000,'k-bad-1')`);
  await reject(db, 'confirmed transfer without transaction legs',
    `INSERT INTO funding_transfers(relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,amount,status,idempotency_key) VALUES ('${REL}','${P1}','${B}',${U},'shareholder_loan',true,1000,'confirmed','k-bad-2')`);
  await reject(db, 'funding source not personal',
    `INSERT INTO funding_transfers(relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,amount,idempotency_key) VALUES ('${REL}','${B}','${B}',${U},'shareholder_loan',true,1000,'k-bad-3')`);

  // ── derived balances: loans vs capital separated ──────────────────────────
  await db.exec(`INSERT INTO transactions(business_id,type) VALUES ('${P1}','funding_out'),('${B}','funding_in'),('${P1}','capital_contribution_out'),('${B}','capital_contribution_in'),('${B}','funding_repayment_out'),('${P1}','funding_repayment_in');`);
  const txids = (await db.query(`SELECT id FROM transactions ORDER BY id`)).rows.map(r => r.id);
  const [sLoan, tLoan, sCap, tCap, bRep, pRep] = txids;
  const loan = randomUUID(), cap = randomUUID();
  await db.exec(`
    INSERT INTO funding_transfers(id,relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,amount,status,source_transaction_id,target_transaction_id,idempotency_key)
      VALUES ('${loan}','${REL}','${P1}','${B}',${U},'shareholder_loan',true,100000,'confirmed',${sLoan},${tLoan},'k-loan');
    INSERT INTO funding_transfers(id,relationship_id,source_workspace_id,target_business_id,contributor_user_id,funding_type,repayable,amount,status,source_transaction_id,target_transaction_id,idempotency_key)
      VALUES ('${cap}','${REL}','${P1}','${B}',${U},'capital_contribution',false,50000,'confirmed',${sCap},${tCap},'k-cap');
    INSERT INTO funding_repayments(funding_transfer_id,amount,currency,business_transaction_id,personal_transaction_id,idempotency_key)
      VALUES ('${loan}',30000,'IDR',${bRep},${pRep},'k-rep1');`);
  const bal = (await db.query(`SELECT loans_funded, loans_repaid, outstanding_repayable, capital_contributed FROM personal_funding_balances WHERE target_business_id='${B}' AND contributor_user_id=${U}`)).rows[0];
  ok('view loans_funded = 100000', Number(bal.loans_funded) === 100000);
  ok('view loans_repaid = 30000', Number(bal.loans_repaid) === 30000);
  ok('view outstanding_repayable = 70000', Number(bal.outstanding_repayable) === 70000);
  ok('view capital_contributed = 50000 (separate from loans)', Number(bal.capital_contributed) === 50000);

  // ── audit append-only ─────────────────────────────────────────────────────
  await db.exec(`INSERT INTO funding_audit(actor_user_id,action,target_business_id) VALUES (${U},'funding_confirmed','${B}')`);
  await reject(db, 'funding_audit UPDATE', `UPDATE funding_audit SET action='x' WHERE target_business_id='${B}'`);
  await reject(db, 'funding_audit DELETE', `DELETE FROM funding_audit WHERE target_business_id='${B}'`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
