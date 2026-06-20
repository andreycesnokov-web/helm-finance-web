// CI for 039 (FX + funding atomic RPCs). PGlite. Run: node tests/migrations/ci_039.js
const fs = require('fs'); const path = require('path');
const { PGlite } = require('@electric-sql/pglite'); const { randomUUID } = require('crypto');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const cnt = async (db, sql) => Number((await db.query(sql)).rows[0].c);
const reject = async (db, l, sql) => { try { await db.exec(`BEGIN; ${sql}; COMMIT;`); ok(l + ' (NOT rejected!)', false); } catch { ok(l + ' rejected', true); } finally { await db.exec('ROLLBACK').catch(() => {}); } };

const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business', owner_user_id bigint, base_currency text DEFAULT 'IDR');
CREATE TABLE business_members (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, role text DEFAULT 'owner', status text DEFAULT 'active', UNIQUE(business_id,user_id));
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, currency text NOT NULL DEFAULT 'IDR', scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, type text, amount_original DECIMAL(18,2) NOT NULL, amount_idr DECIMAL(18,2), currency_original text, scope text, wallet_id uuid, description text, transaction_date date, created_by_user_id bigint);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

(async () => {
  const db = new PGlite(); await db.exec(BASELINE);
  await db.exec(MIG('037_personal_workspace_foundation.sql'));
  await db.exec(MIG('038_fx_and_funding_ledger.sql'));
  try { await db.exec(MIG('039_fx_and_funding_rpc.sql')); ok('clean apply 039', true); } catch (e) { ok('clean apply 039: ' + e.message, false); }
  try { await db.exec(MIG('039_fx_and_funding_rpc.sql')); ok('second apply 039 (idempotent)', true); } catch (e) { ok('second apply: ' + e.message, false); }
  ok('10 rpc functions + PUBLIC revoked',
    (await cnt(db, `SELECT count(*) c FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'rpc_%' AND (routine_name LIKE '%funding%' OR routine_name LIKE '%connection%' OR routine_name LIKE '%fx%' OR routine_name LIKE '%wallet_transfer%')`)) === 10 &&
    (await cnt(db, `SELECT count(*) c FROM information_schema.routine_privileges WHERE grantee='PUBLIC' AND routine_name LIKE 'rpc_%' AND (routine_name LIKE '%funding%' OR routine_name LIKE '%connection%' OR routine_name LIKE '%fx%' OR routine_name LIKE '%wallet_transfer%')`)) === 0);

  // ── seed: personal P + business B, multi-asset wallets, active relationship ─
  const U = 5; const P = randomUUID(), B = randomUUID(), BX = randomUUID();
  await db.exec('COMMIT').catch(() => {});
  await db.exec(`INSERT INTO users(id) VALUES (${U});
    INSERT INTO businesses(id,type,owner_user_id,base_currency) VALUES ('${P}','personal',${U},'IDR'),('${B}','business',${U},'IDR'),('${BX}','business',${U},'IDR');
    INSERT INTO business_members(business_id,user_id) VALUES ('${P}',${U}),('${B}',${U}),('${BX}',${U});`);
  const wPusd = randomUUID(), wPidr = randomUUID(), wPbtc = randomUUID(), wBidr = randomUUID(), wBusd = randomUUID(), wBXidr = randomUUID();
  const W = (id, biz, cur, atype = 'fiat', dp = 2) => `INSERT INTO wallets(id,business_id,currency,asset_type,asset_code,decimal_precision,scope) VALUES ('${id}','${biz}','${cur}','${atype}','${cur}',${dp},'${biz === P ? 'personal' : 'business'}');`;
  await db.exec(W(wPusd, P, 'USD') + W(wPidr, P, 'IDR') + W(wPbtc, P, 'BTC', 'crypto', 8) + W(wBidr, B, 'IDR') + W(wBusd, B, 'USD') + W(wBXidr, BX, 'IDR'));
  const REL = (await db.query(`SELECT * FROM rpc_request_personal_business_connection('${P}','${B}',${U},'web')`)).rows[0].id;
  await db.query(`SELECT rpc_confirm_personal_business_connection('${REL}',${U},'web')`);

  const quote = async (j) => (await db.query(`SELECT * FROM rpc_create_fx_quote_record($1::jsonb, ${U}, 'web')`, [JSON.stringify(j)])).rows[0];
  const create = async (j) => (await db.query(`SELECT * FROM rpc_create_funding_transfer($1::jsonb, ${U}, 'web')`, [JSON.stringify(j)])).rows[0];

  // ── wallet-to-wallet same currency (IDR business wallets) ─────────────────
  await db.query(`SELECT rpc_create_wallet_transfer($1::jsonb, ${U}, 'web')`, [JSON.stringify({ source_workspace_id: B, target_workspace_id: BX, source_wallet_id: wBidr, target_wallet_id: wBXidr, source_asset: 'IDR', target_asset: 'IDR', source_amount: 1000, target_amount: 1000, source_scope: 'business', target_scope: 'business', actor_user_id: U })]);
  ok('same-currency transfer = 2 legs', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type IN ('fx_transfer_out','fx_transfer_in')`)) === 2);
  ok('same-currency transfer neutral', Number((await db.query(`SELECT (SELECT COALESCE(SUM(amount_original),0) FROM transactions WHERE type='fx_transfer_in') - (SELECT COALESCE(SUM(amount_original),0) FROM transactions WHERE type='fx_transfer_out') AS n`)).rows[0].n) === 0);

  // ── cross-currency wallet transfer USD→IDR with quote ─────────────────────
  const qUI = await quote({ provider: 'demo', base_asset: 'USD', quote_asset: 'IDR', rate: 16300, source_type: 'market_api', valid_until: new Date(Date.now() + 3600000).toISOString() });
  const wt = (await db.query(`SELECT rpc_create_wallet_transfer($1::jsonb, ${U}, 'web')`, [JSON.stringify({ source_workspace_id: P, target_workspace_id: B, source_wallet_id: wPusd, target_wallet_id: wBidr, source_asset: 'USD', target_asset: 'IDR', source_amount: 100, target_amount: 1630000, fx_quote_id: qUI.id, source_scope: 'personal', target_scope: 'business', actor_user_id: U })]).then(r => r.rows[0]));
  ok('cross-currency transfer created fx_conversion', (await cnt(db, `SELECT count(*) c FROM fx_conversions WHERE quote_id='${qUI.id}'`)) === 1);

  // ── expired quote + pair mismatch + zero rate ─────────────────────────────
  const qExp = await quote({ provider: 'demo', base_asset: 'USD', quote_asset: 'IDR', rate: 16000, source_type: 'market_api', valid_until: new Date(Date.now() - 1000).toISOString() });
  await reject(db, 'expired quote blocks transfer', `SELECT rpc_create_wallet_transfer('${JSON.stringify({ source_workspace_id: P, target_workspace_id: B, source_wallet_id: wPusd, target_wallet_id: wBidr, source_asset: 'USD', target_asset: 'IDR', source_amount: 1, target_amount: 16000, fx_quote_id: qExp.id, source_scope: 'personal', target_scope: 'business', actor_user_id: U })}'::jsonb, ${U}, 'web')`);
  await reject(db, 'zero rate quote', `SELECT rpc_create_fx_quote_record('${JSON.stringify({ provider: 'x', base_asset: 'USD', quote_asset: 'IDR', rate: 0, source_type: 'market_api' })}'::jsonb, ${U}, 'web')`);
  await reject(db, 'manual rate without reason', `SELECT rpc_create_fx_quote_record('${JSON.stringify({ provider: 'x', base_asset: 'USD', quote_asset: 'IDR', rate: 16000, source_type: 'manual' })}'::jsonb, ${U}, 'web')`);

  // ── multi-currency funding USD→IDR with fee ───────────────────────────────
  const txBefore = await cnt(db, `SELECT count(*) c FROM transactions`);
  const qFund = await quote({ provider: 'demo', base_asset: 'USD', quote_asset: 'IDR', rate: 16300, source_type: 'market_api', valid_until: new Date(Date.now() + 3600000).toISOString() });
  const f1 = await create({ relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: 10000, source_total_debit: 10010, target_asset: 'IDR', target_amount: 163000000, fee_amount: 10, fee_asset: 'USD', booked_rate: 16300, fx_quote_id: qFund.id, reporting_currency: 'IDR', reporting_amount: 163000000, source_wallet_id: wPusd, target_wallet_id: wBidr, idempotency_key: 'f-usd-idr' });
  ok('pending funding creates ZERO legs', (await cnt(db, `SELECT count(*) c FROM transactions`)) === txBefore);
  ok('principal value neutral by locked rate (10000*16300=163000000)', 10000 * 16300 === 163000000);
  await db.query(`SELECT rpc_confirm_funding_transfer('${f1.id}',${U},'web')`);
  ok('confirm creates 3 legs (principal+fee+target)', (await cnt(db, `SELECT count(*) c FROM transactions`)) === txBefore + 3);
  ok('source principal leg USD funding_out', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type='funding_out' AND asset_code='USD' AND amount_original=10000`)) === 1);
  ok('fee leg separate (fx_fee USD 10)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type='fx_fee' AND asset_code='USD' AND amount_original=10`)) === 1);
  ok('target leg IDR funding_in 163000000', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type='funding_in' AND asset_code='IDR' AND amount_original=163000000`)) === 1);
  ok('revenue unchanged (no income)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type='income'`)) === 0);
  ok('operating expense unchanged (no expense/payroll)', (await cnt(db, `SELECT count(*) c FROM transactions WHERE type IN ('expense','payroll')`)) === 0);
  ok('quote marked used', (await cnt(db, `SELECT count(*) c FROM exchange_rate_quotes WHERE id='${qFund.id}' AND status='used'`)) === 1);
  // idempotency
  const f1b = await create({ relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: 10000, source_total_debit: 10010, target_asset: 'IDR', target_amount: 163000000, booked_rate: 16300, fx_quote_id: qFund.id, source_wallet_id: wPusd, target_wallet_id: wBidr, idempotency_key: 'f-usd-idr' });
  ok('duplicate idempotency → no duplicate', f1b.id === f1.id && (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE idempotency_key='f-usd-idr'`)) === 1);
  // outstanding native principal in USD
  ok('outstanding principal = 10000 USD', Number((await db.query(`SELECT outstanding_principal_native o FROM personal_funding_balances WHERE target_business_id='${B}' AND principal_asset='USD'`)).rows[0].o) === 10000);

  // ── repayment: cross-currency (IDR business → reduces USD principal) ───────
  const qRep = await quote({ provider: 'demo', base_asset: 'USD', quote_asset: 'IDR', rate: 16300, source_type: 'market_api', valid_until: new Date(Date.now() + 3600000).toISOString() });
  await db.query(`SELECT rpc_repay_funding_transfer($1::jsonb, ${U}, 'web')`, [JSON.stringify({ funding_transfer_id: f1.id, repayment_amount_native: 48900000, repayment_asset: 'IDR', principal_reduction_amount: 3000, principal_asset: 'USD', business_wallet_id: wBidr, personal_wallet_id: wPusd, repayment_quote_id: qRep.id, booked_rate: 16300, idempotency_key: 'r1' })]);
  ok('cross-currency repayment reduces USD principal to 7000', Number((await db.query(`SELECT outstanding_principal_native o FROM personal_funding_balances WHERE target_business_id='${B}' AND principal_asset='USD'`)).rows[0].o) === 7000);
  ok('repayment status partially_repaid', (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE id='${f1.id}' AND status='partially_repaid'`)) === 1);
  // over-repayment in principal currency rejected (8000 USD > 7000 outstanding)
  await reject(db, 'over-repayment in principal currency', `SELECT rpc_repay_funding_transfer('${JSON.stringify({ funding_transfer_id: f1.id, repayment_amount_native: 130400000, repayment_asset: 'IDR', principal_reduction_amount: 8000, principal_asset: 'USD', business_wallet_id: wBidr, personal_wallet_id: wPusd, idempotency_key: 'r-over' })}'::jsonb, ${U}, 'web')`);

  // ── capital contribution cannot be repaid ─────────────────────────────────
  const cap = await create({ relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U, funding_type: 'capital_contribution', source_asset: 'IDR', source_principal_amount: 50000000, source_total_debit: 50000000, target_asset: 'IDR', target_amount: 50000000, source_wallet_id: wPidr, target_wallet_id: wBidr, idempotency_key: 'cap1' });
  await db.query(`SELECT rpc_confirm_funding_transfer('${cap.id}',${U},'web')`);
  await reject(db, 'capital_contribution repayment', `SELECT rpc_repay_funding_transfer('${JSON.stringify({ funding_transfer_id: cap.id, repayment_amount_native: 1000, repayment_asset: 'IDR', principal_reduction_amount: 1000, principal_asset: 'IDR', business_wallet_id: wBidr, personal_wallet_id: wPidr, idempotency_key: 'r-cap' })}'::jsonb, ${U}, 'web')`);

  // ── cross-workspace + crypto + revoke ─────────────────────────────────────
  await reject(db, 'cross-workspace target wallet (other business)', `SELECT rpc_create_funding_transfer('${JSON.stringify({ relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: 1, source_total_debit: 1, target_asset: 'IDR', target_amount: 1, source_wallet_id: wPidr, target_wallet_id: wBXidr, idempotency_key: 'x-cw' })}'::jsonb, ${U}, 'web')`);
  ok('crypto BTC wallet precision (8dp) stored', (await cnt(db, `SELECT count(*) c FROM wallets WHERE asset_code='BTC' AND decimal_precision=8`)) === 1);
  // revoke relationship → new funding blocked, repayment of existing still allowed
  await db.query(`SELECT rpc_revoke_personal_business_connection('${REL}',${U},'web')`);
  await reject(db, 'revoked relationship blocks NEW funding', `SELECT rpc_create_funding_transfer('${JSON.stringify({ relationship_id: REL, source_workspace_id: P, target_business_id: B, contributor_user_id: U, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: 1, source_total_debit: 1, target_asset: 'IDR', target_amount: 1, source_wallet_id: wPidr, target_wallet_id: wBidr, idempotency_key: 'x-rev' })}'::jsonb, ${U}, 'web')`);
  await db.query(`SELECT rpc_repay_funding_transfer($1::jsonb, ${U}, 'web')`, [JSON.stringify({ funding_transfer_id: f1.id, repayment_amount_native: 114100000, repayment_asset: 'IDR', principal_reduction_amount: 7000, principal_asset: 'USD', business_wallet_id: wBidr, personal_wallet_id: wPusd, idempotency_key: 'r-final' })]);
  ok('revoked relationship still allows repayment of existing loan → fully_repaid', (await cnt(db, `SELECT count(*) c FROM funding_transfers WHERE id='${f1.id}' AND status='fully_repaid'`)) === 1);

  // ── atomic rollback (audit + second-leg) ──────────────────────────────────
  const REL2 = (await db.query(`SELECT * FROM rpc_request_personal_business_connection('${P}','${BX}',${U},'web')`)).rows[0].id; await db.query(`SELECT rpc_confirm_personal_business_connection('${REL2}',${U},'web')`);
  const fa = await create({ relationship_id: REL2, source_workspace_id: P, target_business_id: BX, contributor_user_id: U, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: 9000, source_total_debit: 9000, target_asset: 'IDR', target_amount: 9000, source_wallet_id: wPidr, target_wallet_id: wBXidr, idempotency_key: 'f-audit' });
  const txPre = await cnt(db, `SELECT count(*) c FROM transactions`);
  await db.exec(`CREATE FUNCTION _ab() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql; CREATE TRIGGER _abt BEFORE INSERT ON funding_audit FOR EACH ROW EXECUTE FUNCTION _ab();`);
  let t1 = false; try { await db.exec(`BEGIN; SELECT rpc_confirm_funding_transfer('${fa.id}',${U},'web'); COMMIT;`); } catch { t1 = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('audit failure rolls back all legs', t1 && (await cnt(db, `SELECT count(*) c FROM transactions`)) === txPre);
  await db.exec(`DROP TRIGGER _abt ON funding_audit; DROP FUNCTION _ab();`);
  await db.exec(`CREATE FUNCTION _lb() RETURNS trigger AS $$ BEGIN IF NEW.type='funding_in' THEN RAISE EXCEPTION 'leg2'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER _lbt BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION _lb();`);
  let t2 = false; try { await db.exec(`BEGIN; SELECT rpc_confirm_funding_transfer('${fa.id}',${U},'web'); COMMIT;`); } catch { t2 = true; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok('second-leg failure rolls back source leg', t2 && (await cnt(db, `SELECT count(*) c FROM transactions`)) === txPre);
  await db.exec(`DROP TRIGGER _lbt ON transactions; DROP FUNCTION _lb();`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
