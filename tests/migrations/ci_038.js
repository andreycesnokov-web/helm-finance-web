// Real migration CI for 038 (personal funding RPCs) on PGlite.
// Run: node tests/migrations/ci_038.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('crypto');

const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business', owner_user_id bigint);
CREATE TABLE business_members (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid REFERENCES businesses(id), user_id bigint, role text DEFAULT 'owner', status text DEFAULT 'active', UNIQUE(business_id,user_id));
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, currency text DEFAULT 'IDR', scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, type text, amount_original numeric, amount_idr numeric, currency_original text, scope text, wallet_id uuid, description text, transaction_date date, created_by_user_id bigint);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

const cnt = async (db, sql) => Number((await db.query(sql)).rows[0].c);
const reject = async (db, label, sql) => {
  try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(label + ' (NOT rejected!)', false); }
  catch { ok(label + ' rejected', true); } finally { await db.exec('ROLLBACK').catch(() => {}); }
};

(async () => {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(MIG('037_personal_funding_foundation.sql'));
  try { await db.exec(MIG('038_personal_funding_rpc.sql')); ok('clean apply 038', true); } catch (e) { ok('clean apply 038: ' + e.message, false); }
  try { await db.exec(MIG('038_personal_funding_rpc.sql')); ok('second apply 038 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('7 rpc functions + PUBLIC revoked on all',
    (await cnt(db, `SELECT count(*) c FROM information_schema.routines WHERE routine_schema='public' AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%')`)) === 7 &&
    (await cnt(db, `SELECT count(*) c FROM information_schema.routine_privileges WHERE grantee='PUBLIC' AND (routine_name LIKE 'rpc_%funding%' OR routine_name LIKE 'rpc_%connection%' OR routine_name IN ('fn_funding_leg','fn_wallet_check'))`)) === 0);

  // ── seed ──────────────────────────────────────────────────────────────────
  const U = 2001; const P = randomUUID(), B = randomUUID(), BX = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO users(id) VALUES (${U});
    INSERT INTO businesses(id,type,owner_user_id) VALUES ('${P}','personal',${U}),('${B}','business',${U}),('${BX}','business',${U});
    INSERT INTO business_members(business_id,user_id) VALUES ('${P}',${U}),('${B}',${U}),('${BX}',${U});`);
  const wP = randomUUID(), wB = randomUUID(), wBX = randomUUID(), wUSD = randomUUID();
  await db.exec(`INSERT INTO wallets(id,business_id,currency,scope) VALUES
    ('${wP}','${P}','IDR','personal'),('${wB}','${B}','IDR','business'),('${wBX}','${BX}','IDR','business'),('${wUSD}','${P}','USD','personal');`);
  // active relationship
  const REL = (await db.query(`SELECT * FROM rpc_request_personal_business_connection('${P}','${B}',${U},'web')`)).rows[0].id;
  await db.query(`SELECT rpc_confirm_personal_business_connection('${REL}',${U},'web')`);
  ok('relationship active', (await cnt(db, `SELECT count(*) c FROM personal_business_relationships WHERE id='${REL}' AND status='active'`)) === 1);

  const fundJson = (idem, type, amount, srcW = wP, tgtW = wB, cur = 'IDR') => JSON.stringify({
    relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U,
    funding_type: type, amount, currency: cur, source_wallet_id: srcW, target_wallet_id: tgtW, idempotency_key: idem });
  const create = (j) => db.query(`SELECT * FROM rpc_create_funding_transfer($1::jsonb, ${U}, 'web')`, [j]);

  // ── create (pending) → zero legs ──────────────────────────────────────────
  const f1 = (await create(fundJson('idem-1', 'shareholder_loan', 100000))).rows[0];
  ok('pending funding creates ZERO transactions', (await cnt(db, `SELECT count(*) c FROM transactions`)) === 0);
  ok('funding status pending_confirmation', f1.status === 'pending_confirmation');

  // idempotency: same key → same record, no duplicate
  const f1b = (await create(fundJson('idem-1', 'shareholder_loan', 100000))).rows[0];
  ok('duplicate idempotency key → no duplicate', f1b.id === f1.id && (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE idempotency_key='idem-1'`)) === 1);

  // ── confirm → exactly two legs, neutral, no revenue/opex ──────────────────
  await db.query(`SELECT rpc_confirm_funding_transfer('${f1.id}',${U},'web')`);
  ok('confirmed funding creates EXACTLY two transactions', (await cnt(db, `SELECT count(*) c FROM transactions`)) === 2);
  ok('source personal wallet decreased once (funding_out)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE wallet_id='${wP}' AND type='funding_out'`)) === 1);
  ok('target business wallet increased once (funding_in)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE wallet_id='${wB}' AND type='funding_in'`)) === 1);
  const neutral = (await db.query(`SELECT (SELECT COALESCE(SUM(amount_original),0) FROM transactions WHERE type='funding_in') - (SELECT COALESCE(SUM(amount_original),0) FROM transactions WHERE type='funding_out') AS net`)).rows[0].net;
  ok('combined ecosystem cash neutral (in − out = 0)', Number(neutral) === 0);
  ok('business revenue unchanged (no income rows)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type='income'`)) === 0);
  ok('operating expenses unchanged (no expense/payroll)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type IN ('expense','payroll')`)) === 0);

  // ── repayment: partial then full; over-repay rejected ─────────────────────
  await db.query(`SELECT rpc_repay_funding_transfer('${f1.id}',30000,'${wB}','${wP}','rep-1',${U},'web')`);
  ok('partial repayment → status partially_repaid', (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE id='${f1.id}' AND status='partially_repaid'`)) === 1);
  ok('partial repayment created two legs', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type IN ('funding_repayment_out','funding_repayment_in')`)) === 2);
  ok('outstanding now 70000', Number((await db.query(`SELECT outstanding_repayable o FROM personal_funding_balances WHERE target_business_id='${B}'`)).rows[0].o) === 70000);
  await reject(db, 'over-repayment (80000 > 70000)', `SELECT rpc_repay_funding_transfer('${f1.id}',80000,'${wB}','${wP}','rep-over',${U},'web')`);
  await db.query(`SELECT rpc_repay_funding_transfer('${f1.id}',70000,'${wB}','${wP}','rep-2',${U},'web')`);
  ok('full repayment → status fully_repaid', (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE id='${f1.id}' AND status='fully_repaid'`)) === 1);
  ok('outstanding now 0', Number((await db.query(`SELECT outstanding_repayable o FROM personal_funding_balances WHERE target_business_id='${B}'`)).rows[0].o) === 0);
  // duplicate repayment idempotency
  const repDup = (await db.query(`SELECT * FROM rpc_repay_funding_transfer('${f1.id}',70000,'${wB}','${wP}','rep-2',${U},'web')`)).rows[0];
  ok('duplicate repayment idem → no duplicate', (await cnt(db, `SELECT count(*) c FROM funding_repayments WHERE idempotency_key='rep-2'`)) === 1);

  // ── capital contribution cannot be repaid ─────────────────────────────────
  const cap = (await create(fundJson('idem-cap', 'capital_contribution', 50000))).rows[0];
  await db.query(`SELECT rpc_confirm_funding_transfer('${cap.id}',${U},'web')`);
  await reject(db, 'capital_contribution repayment', `SELECT rpc_repay_funding_transfer('${cap.id}',10000,'${wB}','${wP}','rep-cap',${U},'web')`);
  ok('capital_contributed = 50000 (separate from loans)', Number((await db.query(`SELECT capital_contributed c FROM personal_funding_balances WHERE target_business_id='${B}'`)).rows[0].c) === 50000);

  // ── cross-workspace + currency rejection at create ────────────────────────
  await reject(db, 'cross-workspace wallet (target wallet of other business)', `SELECT rpc_create_funding_transfer('${fundJson('idem-x', 'shareholder_loan', 1000, wP, wBX)}'::jsonb, ${U}, 'web')`);
  await reject(db, 'different currency (USD source vs IDR funding)', `SELECT rpc_create_funding_transfer('${fundJson('idem-cur', 'shareholder_loan', 1000, wUSD, wB)}'::jsonb, ${U}, 'web')`);

  // ── cancel before confirm → zero legs ─────────────────────────────────────
  const fc = (await create(fundJson('idem-cancel', 'founder_advance', 5000))).rows[0];
  const txBefore = await cnt(db, `SELECT count(*) c FROM transactions`);
  await db.query(`SELECT rpc_cancel_funding_transfer('${fc.id}',${U},'web')`);
  ok('cancelled funding → still zero new legs', (await cnt(db, `SELECT count(*) c FROM transactions`)) === txBefore);
  ok('cancelled funding status cancelled', (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE id='${fc.id}' AND status='cancelled'`)) === 1);
  await reject(db, 'cannot confirm a cancelled funding', `SELECT rpc_confirm_funding_transfer('${fc.id}',${U},'web')`);

  // ── atomic rollback: audit failure rolls back both legs ───────────────────
  const fa = (await create(fundJson('idem-audit', 'shareholder_loan', 9000))).rows[0];
  const txPre = await cnt(db, `SELECT count(*) c FROM transactions`);
  await db.exec(`CREATE FUNCTION _aud_boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER _aud_boom_t BEFORE INSERT ON funding_audit FOR EACH ROW EXECUTE FUNCTION _aud_boom();`);
  let auditThrew = false;
  try { await db.exec(`BEGIN; SELECT rpc_confirm_funding_transfer('${fa.id}',${U},'web'); COMMIT;`); } catch { auditThrew = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('audit failure aborts confirm', auditThrew);
  ok('audit failure rolled back BOTH legs', (await cnt(db, `SELECT count(*) c FROM transactions`)) === txPre);
  await db.exec(`DROP TRIGGER _aud_boom_t ON funding_audit; DROP FUNCTION _aud_boom();`);

  // ── atomic rollback: second-leg failure rolls back first leg ──────────────
  const fb = (await create(fundJson('idem-leg2', 'shareholder_loan', 8000))).rows[0];
  const txPre2 = await cnt(db, `SELECT count(*) c FROM transactions`);
  await db.exec(`CREATE FUNCTION _leg2_boom() RETURNS trigger AS $$ BEGIN IF NEW.type='funding_in' THEN RAISE EXCEPTION 'second leg fail'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER _leg2_boom_t BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION _leg2_boom();`);
  let legThrew = false;
  try { await db.exec(`BEGIN; SELECT rpc_confirm_funding_transfer('${fb.id}',${U},'web'); COMMIT;`); } catch { legThrew = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('second-leg failure aborts confirm', legThrew);
  ok('second-leg failure rolled back first leg', (await cnt(db, `SELECT count(*) c FROM transactions`)) === txPre2);
  await db.exec(`DROP TRIGGER _leg2_boom_t ON transactions; DROP FUNCTION _leg2_boom();`);

  // ── inactive relationship cannot fund ─────────────────────────────────────
  const P2 = randomUUID(); await db.exec(`INSERT INTO businesses(id,type,owner_user_id) VALUES ('${P2}','personal',${U}); INSERT INTO business_members(business_id,user_id) VALUES ('${P2}',${U}); INSERT INTO wallets(id,business_id,currency,scope) VALUES (gen_random_uuid(),'${P2}','IDR','personal');`);
  const relPending = (await db.query(`SELECT * FROM rpc_request_personal_business_connection('${P2}','${B}',${U},'web')`)).rows[0].id;
  await reject(db, 'funding through non-active relationship',
    `SELECT rpc_create_funding_transfer('${JSON.stringify({ relationship_id: relPending, source_workspace_id: P2, target_business_id: B, contributor_user_id: U, funding_type: 'shareholder_loan', amount: 1000, currency: 'IDR', source_wallet_id: wP, target_wallet_id: wB, idempotency_key: 'idem-inactive' })}'::jsonb, ${U}, 'web')`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
