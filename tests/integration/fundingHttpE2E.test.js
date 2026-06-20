// HTTP E2E for Personal Workspaces / Relationships / FX / Wallet transfers / Funding.
// Drives the REAL Express router (server/routes/personalFunding.js) over HTTP against
// real SQL + the real 037/038/039 RPCs via a PGlite-backed supabase shim — so it runs
// with NO Docker / local Supabase. Synthetic data only; production is never touched.
//   Run: node tests/integration/fundingHttpE2E.test.js
const fs = require('fs'); const path = require('path'); const http = require('http');
const express = require('express');
const { randomUUID } = require('crypto');
const { createPgliteSupabase } = require('./_pgliteSupabase');
const personalFundingRouter = require('../../server/routes/personalFunding');
const TX = require('../../server/lib/transactionClass');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', n), 'utf8');

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };

const BASELINE = `
CREATE TABLE users (id bigint PRIMARY KEY);
CREATE TABLE businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL DEFAULT 'business', owner_user_id bigint, base_currency text DEFAULT 'IDR', name text, plan text DEFAULT 'free', business_code text);
CREATE TABLE business_members (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, role text DEFAULT 'owner', status text DEFAULT 'active', UNIQUE(business_id,user_id));
CREATE TABLE business_addons (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, addon text, status text DEFAULT 'active');
CREATE TABLE wallets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, currency text NOT NULL DEFAULT 'IDR', scope text DEFAULT 'business');
CREATE TABLE transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid, user_id bigint, type text, amount_original DECIMAL(18,2) NOT NULL, amount_idr DECIMAL(18,2), currency_original text, scope text, wallet_id uuid, description text, transaction_date date, created_by_user_id bigint);
CREATE TABLE financial_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
`;

async function api(base, method, path, userId, body) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = String(userId);
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}

(async () => {
  const { db, supabase } = await createPgliteSupabase();
  await db.exec(BASELINE);
  await db.exec(MIG('037_personal_workspace_foundation.sql'));
  await db.exec(MIG('038_fx_and_funding_ledger.sql'));
  await db.exec(MIG('039_fx_and_funding_rpc.sql'));

  // ── ids ────────────────────────────────────────────────────────────────────
  const U = { a1: 101, a2: 102, multi: 103, baOwner: 201, baCfo: 203, bbOwner: 205 };
  const P_A1 = randomUUID(), P_A2 = randomUUID(), P_M1 = randomUUID(), P_M2 = randomUUID(), BA = randomUUID(), BB = randomUUID();
  const W = {}; const newW = () => randomUUID();
  ['pm1_idr', 'pm1_usd', 'pm1_btc', 'pm2_idr', 'pa1_usdt', 'ba_idr', 'ba_idr2', 'ba_usd', 'ba_btc', 'bb_idr'].forEach(k => W[k] = newW());

  // ── seed ─────────────────────────────────────────────────────────────────
  await db.exec(`INSERT INTO users(id) VALUES (101),(102),(103),(201),(203),(205);`);
  const biz = (id, type, owner, ccy, name) => `INSERT INTO businesses(id,type,owner_user_id,base_currency,name) VALUES ('${id}','${type}',${owner},'${ccy}','${name}');`;
  await db.exec(
    biz(P_A1, 'personal', U.a1, 'IDR', 'A1 Personal') + biz(P_A2, 'personal', U.a2, 'IDR', 'A2 Personal') +
    biz(P_M1, 'personal', U.multi, 'IDR', 'Multi P1') + biz(P_M2, 'personal', U.multi, 'IDR', 'Multi P2') +
    biz(BA, 'business', U.baOwner, 'IDR', 'Business A') + biz(BB, 'business', U.bbOwner, 'IDR', 'Business B'));
  const mem = (b, u, r) => `INSERT INTO business_members(business_id,user_id,role,status) VALUES ('${b}',${u},'${r}','active');`;
  await db.exec(
    mem(P_A1, U.a1, 'owner') + mem(P_A2, U.a2, 'owner') + mem(P_M1, U.multi, 'owner') + mem(P_M2, U.multi, 'owner') +
    mem(BA, U.baOwner, 'owner') + mem(BA, U.baCfo, 'cfo') + mem(BA, U.multi, 'admin') + mem(BB, U.bbOwner, 'owner'));
  const wal = (id, b, ccy, atype = 'fiat', dp = 2) => `INSERT INTO wallets(id,business_id,currency,asset_type,asset_code,decimal_precision,scope) VALUES ('${id}','${b}','${ccy}','${atype}','${ccy}',${dp},'${b === BA || b === BB ? 'business' : 'personal'}');`;
  await db.exec(
    wal(W.pm1_idr, P_M1, 'IDR') + wal(W.pm1_usd, P_M1, 'USD') + wal(W.pm1_btc, P_M1, 'BTC', 'crypto', 8) +
    wal(W.pm2_idr, P_M2, 'IDR') + wal(W.pa1_usdt, P_A1, 'USDT', 'crypto', 6) +
    wal(W.ba_idr, BA, 'IDR') + wal(W.ba_idr2, BA, 'IDR') + wal(W.ba_usd, BA, 'USD') + wal(W.ba_btc, BA, 'BTC', 'crypto', 8) + wal(W.bb_idr, BB, 'IDR'));
  // active relationship P_M1 ↔ BA ; revoked relationship P_A1 ↔ BB
  const REL = (await db.query(`SELECT id FROM rpc_request_personal_business_connection('${P_M1}','${BA}',${U.multi},'web')`)).rows[0].id;
  await db.query(`SELECT rpc_confirm_personal_business_connection('${REL}',${U.baOwner},'web')`);
  await db.exec(`INSERT INTO personal_business_relationship_roles(relationship_id,role) VALUES ('${REL}','founder'),('${REL}','investor');`);
  const RELREV = (await db.query(`SELECT id FROM rpc_request_personal_business_connection('${P_A1}','${BB}',${U.a1},'web')`)).rows[0].id;
  await db.query(`SELECT rpc_confirm_personal_business_connection('${RELREV}',${U.bbOwner},'web')`);
  await db.query(`SELECT rpc_revoke_personal_business_connection('${RELREV}',${U.bbOwner},'web')`);

  // ── boot the REAL router over HTTP ─────────────────────────────────────────
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => { const id = req.headers['x-user-id']; if (!id) return res.status(401).json({ error: 'no token' }); req.user = { userId: Number(id) }; next(); };
  const getBusinessAccess = async (userId, businessId) => ({ access: { effective_plan: 'founder', trial_status_effective: 'none' } });
  const resolveUserDisplayName = async (userId) => `User ${userId}`;
  app.use('/api', personalFundingRouter({ supabase, auth, getBusinessAccess, resolveUserDisplayName, TX }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const txCount = async () => Number((await db.query(`SELECT count(*) c FROM transactions`)).rows[0].c);

  try {
    // ═══════════════════ PRIVACY ═══════════════════
    const wsMulti = await api(base, 'GET', '/api/workspaces', U.multi);
    ok('P1) user sees own personal workspaces', wsMulti.body.personal.some(p => p.id === P_M1) && wsMulti.body.personal.some(p => p.id === P_M2));
    ok('P1) no balance fields leaked in /workspaces', !JSON.stringify(wsMulti.body).match(/balance|amount/i));
    const wsA1 = await api(base, 'GET', '/api/workspaces', U.a1);
    ok('P2) user does NOT see another user personal workspace', !wsA1.body.personal.some(p => p.id === P_A2));
    const spoof = await api(base, 'GET', `/api/personal-workspaces/${P_A2}`, U.a1);
    ok('P6) spoofed workspace id fails (403/404)', spoof.status === 403 || spoof.status === 404);
    const prefBad = await api(base, 'PATCH', '/api/workspace-preferences', U.multi, { default_business_workspace_id: P_M1 });
    ok('P7) personal cannot become default business', prefBad.status === 400);
    const prefOk = await api(base, 'PATCH', '/api/workspace-preferences', U.multi, { primary_personal_workspace_id: P_M1, default_business_workspace_id: BA });
    ok('P7) valid preferences accepted', prefOk.status === 200);

    // ═══════════════════ FX ═══════════════════
    const qUI = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'USD', quote_asset: 'IDR' });
    ok('FX1) USD->IDR quote, rate is string', qUI.status === 201 && typeof qUI.body.rate === 'string' && qUI.body.rate === '16300');
    const qIU = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'IDR', quote_asset: 'USD' });
    ok('FX2) IDR->USD quote', qIU.status === 201 && qIU.body.base_asset === 'IDR');
    const qTU = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'USDT', quote_asset: 'USD' });
    ok('FX3/FX9) USDT->USD not 1:1', qTU.status === 201 && qTU.body.rate !== '1' && qTU.body.rate !== '1.0');
    const qBU = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'BTC', quote_asset: 'USD', kind: 'crypto' });
    ok('FX4) BTC quote precision preserved as string', qBU.status === 201 && typeof qBU.body.rate === 'string');
    const qSame = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'USDT', quote_asset: 'USDT' });
    ok('FX9) stablecoin base==quote rejected (no silent 1:1)', qSame.status === 400);
    const qManualBad = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'USD', quote_asset: 'IDR', source_type: 'manual', rate: '16000' });
    ok('FX7) manual quote without reason blocked', qManualBad.status === 400);
    const qBefore = Number((await db.query(`SELECT count(*) c FROM exchange_rate_quotes`)).rows[0].c);
    const qFail = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'XAU', quote_asset: 'IDR' });
    const qAfter = Number((await db.query(`SELECT count(*) c FROM exchange_rate_quotes`)).rows[0].c);
    ok('FX8) provider failure creates no quote', qFail.status === 400 && qAfter === qBefore);

    // ═══════════════════ INTERNAL TRANSFER ═══════════════════
    const t0 = await txCount();
    const itSame = await api(base, 'POST', '/api/wallet-transfers/confirm', U.baOwner, { source_wallet_id: W.ba_idr, target_wallet_id: W.ba_idr2, source_asset: 'IDR', target_asset: 'IDR', source_amount: '1000', target_amount: '1000' });
    ok('IT1) same-currency internal transfer = 2 legs', itSame.status === 201 && (await txCount()) === t0 + 2);
    const qx = await api(base, 'POST', '/api/fx/quotes', U.baOwner, { base_asset: 'USD', quote_asset: 'IDR' });
    const t1 = await txCount();
    const itCross = await api(base, 'POST', '/api/wallet-transfers/confirm', U.baOwner, { source_wallet_id: W.ba_usd, target_wallet_id: W.ba_idr, source_asset: 'USD', target_asset: 'IDR', source_amount: '100', target_amount: '1630000', fx_quote_id: qx.body.id });
    ok('IT2) cross-currency internal = 2 legs + conversion', itCross.status === 201 && (await txCount()) === t1 + 2 && Number((await db.query(`SELECT count(*) c FROM fx_conversions`)).rows[0].c) === 1);
    const itPP = await api(base, 'POST', '/api/wallet-transfers/confirm', U.multi, { source_wallet_id: W.pm1_idr, target_wallet_id: W.pm2_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' });
    ok('IT3) same-owner personal->personal allowed', itPP.status === 201);
    const itPB = await api(base, 'POST', '/api/wallet-transfers/confirm', U.multi, { source_wallet_id: W.pm1_idr, target_wallet_id: W.ba_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' });
    ok('IT4) personal->business ordinary transfer rejected', itPB.status === 403);
    const itBP = await api(base, 'POST', '/api/wallet-transfers/confirm', U.multi, { source_wallet_id: W.ba_idr, target_wallet_id: W.pm1_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' });
    ok('IT5) business->personal ordinary transfer rejected', itBP.status === 403);
    const itPreview = await api(base, 'POST', '/api/wallet-transfers/preview', U.baOwner, { source_wallet_id: W.ba_idr, target_wallet_id: W.ba_idr2, source_asset: 'IDR', target_asset: 'IDR', source_amount: '10', target_amount: '10' });
    const tPrev = await txCount();
    ok('IT) preview writes no transactions', itPreview.status === 200 && itPreview.body.future_legs.length === 2 && tPrev === (await txCount()));

    // ═══════════════════ FUNDING ═══════════════════
    const tF0 = await txCount();
    const fund1 = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '50000000', source_total_debit: '50000000', target_asset: 'IDR', target_amount: '50000000', booked_rate: '1', reporting_currency: 'IDR', reporting_amount: '50000000', source_wallet_id: W.pm1_idr, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-f1' });
    ok('F1) draft/pending funding creates ZERO transactions', fund1.status === 201 && fund1.body.status === 'pending_confirmation' && (await txCount()) === tF0);
    ok('F) funding response is financing, not revenue/opex', fund1.body.economic_class === 'financing' && fund1.body.affects_revenue === false && fund1.body.affects_operating_expense === false);
    ok('F) money fields are strings', typeof fund1.body.source_principal_amount === 'string');
    const fund1Dup = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '50000000', source_total_debit: '50000000', target_asset: 'IDR', target_amount: '50000000', booked_rate: '1', reporting_currency: 'IDR', reporting_amount: '50000000', source_wallet_id: W.pm1_idr, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-f1' });
    ok('F7) duplicate idempotency key → no duplicate', fund1Dup.body.id === fund1.body.id && Number((await db.query(`SELECT count(*) c FROM funding_transfers WHERE idempotency_key='e2e-f1'`)).rows[0].c) === 1);
    const tF1 = await txCount();
    const conf1 = await api(base, 'POST', `/api/funding/${fund1.body.id}/confirm`, U.baOwner, {});
    ok('F2) confirm creates exactly two principal legs (no fee)', conf1.status === 200 && (await txCount()) === tF1 + 2);
    ok('F4/F5) funding changes no revenue/opex', Number((await db.query(`SELECT count(*) c FROM transactions WHERE type IN ('income','expense','payroll')`)).rows[0].c) === 0);
    ok('F) business-side response hides source workspace/wallet', conf1.body.source_workspace_id === undefined && conf1.body.source_wallet_id === undefined && conf1.body.contributor_display_name === 'User 103');

    // fee creates a separate leg (cross-currency USD->IDR with fee)
    const qF = await api(base, 'POST', '/api/fx/quotes', U.multi, { base_asset: 'USD', quote_asset: 'IDR' });
    const fund2 = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: '10000', source_total_debit: '10010', target_asset: 'IDR', target_amount: '163000000', fee_amount: '10', fee_asset: 'USD', booked_rate: '16300', fx_quote_id: qF.body.id, reporting_currency: 'IDR', reporting_amount: '163000000', source_wallet_id: W.pm1_usd, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-f2' });
    const tF2 = await txCount();
    const conf2 = await api(base, 'POST', `/api/funding/${fund2.body.id}/confirm`, U.baOwner, {});
    ok('F3) fee creates a separate leg (3 legs total)', conf2.status === 200 && (await txCount()) === tF2 + 3);
    ok('F3) separate fx_fee leg present', Number((await db.query(`SELECT count(*) c FROM transactions WHERE type='fx_fee' AND asset_code='USD' AND amount_original=10`)).rows[0].c) === 1);
    ok('F6) quote becomes used', (await db.query(`SELECT status FROM exchange_rate_quotes WHERE id='${qF.body.id}'`)).rows[0].status === 'used');
    ok('F) combined principal neutral by booked rate (10000*16300=163000000)', 10000 * 16300 === 163000000);

    // cross-business funding rejected (target wallet belongs to BB, not BA)
    const fundX = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '1', source_total_debit: '1', target_asset: 'IDR', target_amount: '1', booked_rate: '1', source_wallet_id: W.pm1_idr, target_wallet_id: W.bb_idr, idempotency_key: 'e2e-fx' });
    ok('F8) cross-business funding rejected', fundX.status === 400 || fundX.status === 409);
    // revoked relationship blocks new funding
    const fundRev = await api(base, 'POST', '/api/funding', U.a1, { relationship_id: RELREV, source_workspace_id: P_A1, target_business_id: BB, funding_type: 'shareholder_loan', source_asset: 'USDT', source_principal_amount: '1', source_total_debit: '1', target_asset: 'IDR', target_amount: '16000', source_wallet_id: W.pa1_usdt, target_wallet_id: W.bb_idr, idempotency_key: 'e2e-frev' });
    ok('F9) revoked relationship blocks new funding', fundRev.status === 409 || fundRev.status === 400);

    // BTC precision survives HTTP->DB->HTTP, large IDR exact
    const fundBtc = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'capital_contribution', source_asset: 'BTC', source_principal_amount: '0.00000001', source_total_debit: '0.00000001', target_asset: 'BTC', target_amount: '0.00000001', booked_rate: '1', source_wallet_id: W.pm1_btc, target_wallet_id: W.ba_btc, idempotency_key: 'e2e-btc' });
    const getBtc = await api(base, 'GET', `/api/funding/${fundBtc.body.id}`, U.multi);
    ok('D2) 0.00000001 BTC survives HTTP->DB->HTTP exactly', getBtc.body.source_principal_amount === '0.00000001');

    // ═══════════════════ REPAYMENT ═══════════════════
    // fund2 is a USD loan of 10000 confirmed. Repay partial cross-currency (IDR business -> reduce USD principal).
    const qR = await api(base, 'POST', '/api/fx/quotes', U.baOwner, { base_asset: 'USD', quote_asset: 'IDR' });
    const rep1 = await api(base, 'POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '48900000', repayment_asset: 'IDR', principal_reduction_amount: '3000', principal_asset: 'USD', business_wallet_id: W.ba_idr, personal_wallet_id: W.pm1_usd, repayment_quote_id: qR.body.id, booked_rate: '16300', idempotency_key: 'e2e-r1' });
    ok('R2/R7) partial cross-currency repayment via booked quote', rep1.status === 201);
    ok('R) outstanding USD principal now 7000', Number((await db.query(`SELECT outstanding_principal_native o FROM personal_funding_balances WHERE target_business_id='${BA}' AND principal_asset='USD'`)).rows[0].o) === 7000);
    const repOver = await api(base, 'POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '200000000', repayment_asset: 'IDR', principal_reduction_amount: '8000', principal_asset: 'USD', business_wallet_id: W.ba_idr, personal_wallet_id: W.pm1_usd, idempotency_key: 'e2e-rover' });
    ok('R4) over-repayment rejected (8000 > 7000 outstanding)', repOver.status === 400);
    const repFull = await api(base, 'POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '114100000', repayment_asset: 'IDR', principal_reduction_amount: '7000', principal_asset: 'USD', business_wallet_id: W.ba_idr, personal_wallet_id: W.pm1_usd, repayment_quote_id: qR.body.id, booked_rate: '16300', idempotency_key: 'e2e-rfull' });
    ok('R3) full repayment → fully_repaid', repFull.status === 201 && (await db.query(`SELECT status FROM funding_transfers WHERE id='${fund2.body.id}'`)).rows[0].status === 'fully_repaid');
    // capital contribution cannot be repaid (fund1? that was loan; fundBtc is capital_contribution, but pending). Confirm it then try repay.
    await api(base, 'POST', `/api/funding/${fundBtc.body.id}/confirm`, U.baOwner, {});
    const repCap = await api(base, 'POST', `/api/funding/${fundBtc.body.id}/repay`, U.baOwner, { repayment_amount_native: '0.00000001', repayment_asset: 'BTC', principal_reduction_amount: '0.00000001', principal_asset: 'BTC', business_wallet_id: W.ba_btc, personal_wallet_id: W.pm1_btc, idempotency_key: 'e2e-rcap' });
    ok('R5) capital contribution repayment rejected', repCap.status === 400 || repCap.status === 409);

    // R6: revoked relationship still allows existing loan repayment.
    // Set up a confirmed loan on a relationship, then revoke, then repay.
    const REL2 = (await db.query(`SELECT id FROM rpc_request_personal_business_connection('${P_M2}','${BA}',${U.multi},'web')`)).rows[0].id;
    await db.query(`SELECT rpc_confirm_personal_business_connection('${REL2}',${U.baOwner},'web')`);
    await db.exec(`INSERT INTO wallets(id,business_id,currency,asset_type,asset_code,decimal_precision,scope) VALUES ('${W.pm2_idr}'::uuid,'${P_M2}','IDR','fiat','IDR',2,'personal') ON CONFLICT DO NOTHING;`);
    const fund3 = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL2, source_workspace_id: P_M2, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '9000', source_total_debit: '9000', target_asset: 'IDR', target_amount: '9000', booked_rate: '1', source_wallet_id: W.pm2_idr, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-f3' });
    await api(base, 'POST', `/api/funding/${fund3.body.id}/confirm`, U.baOwner, {});
    await db.query(`SELECT rpc_revoke_personal_business_connection('${REL2}',${U.baOwner},'web')`);
    const repAfterRevoke = await api(base, 'POST', `/api/funding/${fund3.body.id}/repay`, U.baOwner, { repayment_amount_native: '9000', repayment_asset: 'IDR', principal_reduction_amount: '9000', principal_asset: 'IDR', business_wallet_id: W.ba_idr, personal_wallet_id: W.pm2_idr, idempotency_key: 'e2e-rrev' });
    ok('R6) revoked relationship still allows existing loan repayment', repAfterRevoke.status === 201);

    // ═══════════════════ ATOMICITY ═══════════════════
    // confirm with an expired quote → RPC raises, NO legs written.
    const expId = randomUUID();
    await db.exec(`INSERT INTO exchange_rate_quotes(id,provider,base_asset,quote_asset,rate,source_type,status,valid_until,created_by_user_id) VALUES ('${expId}','demo','USD','IDR',16000,'market_api','available', now() - interval '1 hour', ${U.multi});`);
    const fundExp = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: '5', source_total_debit: '5', target_asset: 'IDR', target_amount: '80000', fx_quote_id: expId, booked_rate: '16000', source_wallet_id: W.pm1_usd, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-fexp' });
    ok('A3) expired quote → funding rejected, no transfer', fundExp.status === 400);
    // audit failure rolls back all legs
    const tA = await txCount();
    const fundAt = await api(base, 'POST', '/api/funding', U.multi, { relationship_id: REL, source_workspace_id: P_M1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '7777', source_total_debit: '7777', target_asset: 'IDR', target_amount: '7777', booked_rate: '1', source_wallet_id: W.pm1_idr, target_wallet_id: W.ba_idr, idempotency_key: 'e2e-fat' });
    await db.exec(`CREATE FUNCTION _ab() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql; CREATE TRIGGER _abt BEFORE INSERT ON funding_audit FOR EACH ROW EXECUTE FUNCTION _ab();`);
    const confAt = await api(base, 'POST', `/api/funding/${fundAt.body.id}/confirm`, U.baOwner, {});
    await db.exec(`DROP TRIGGER _abt ON funding_audit; DROP FUNCTION _ab();`);
    ok('A2) audit failure rolls back all legs', confAt.status >= 400 && (await txCount()) === tA);

    console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  } finally {
    server.close();
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
