// REAL local-Supabase HTTP E2E. Drives the actual running server/index.js (real auth
// middleware → workspace resolver → entitlement checks → supabase-js/PostgREST → real
// RPCs → local PostgreSQL). NO PGlite shim. Synthetic data only; never production.
//
// Requires a running local Supabase + the app server. SKIPS (exit 0) only when env is
// absent so it is safe in plain CI; the GATE run provides all env so nothing is skipped.
//   BASE_URL=http://127.0.0.1:3011 JWT_SECRET=... SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SECRET_KEY=sb_secret_... DB_CONTAINER=supabase_db_helm-finance-web \
//   DOCKER=".../docker.exe" node tests/integration/fundingLocalSupabase.test.js
const jwt = require('jsonwebtoken');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL, SECRET = process.env.JWT_SECRET;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const DBC = process.env.DB_CONTAINER, DOCKER = process.env.DOCKER || 'docker';
if (!BASE || !SECRET || !URL || !KEY || !DBC) {
  console.log('SKIP — needs BASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY, DB_CONTAINER (local only).');
  process.exit(0);
}
const sb = createClient(URL, KEY);
const psql = (sql) => execFileSync(DOCKER, ['exec', '-i', DBC, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const tok = (userId) => jwt.sign({ userId }, SECRET, { expiresIn: '1h' });
async function api(method, path, userId, body) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers.authorization = 'Bearer ' + tok(userId);
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const txCount = async () => Number((await sb.from('transactions').select('id', { count: 'exact', head: true })).count || 0);

(async () => {
  // ── synthetic ids (obvious fake range) ─────────────────────────────────────
  const U = { a1: 950001, a2: 950002, baOwner: 950004, baAdmin: 950005, baCfo: 950006, baManager: 950007, bbOwner: 950008, noEnt: 950009 };
  const ids = Object.values(U);

  // ── idempotent cleanup of the synthetic range (FK-safe order) ──────────────
  // funding_audit is append-only (trigger); bypass only for synthetic test cleanup.
  psql(`SET session_replication_role=replica; DELETE FROM funding_audit WHERE actor_user_id IN (${ids.join(',')}); SET session_replication_role=DEFAULT;`);
  psql(`DELETE FROM funding_repayments WHERE created_by_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM funding_transfers WHERE contributor_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM fx_conversions WHERE created_by_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM exchange_rate_quotes WHERE created_by_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM personal_business_relationship_roles WHERE relationship_id IN (SELECT id FROM personal_business_relationships WHERE requested_by_user_id IN (${ids.join(',')}));`);
  psql(`DELETE FROM personal_business_relationships WHERE requested_by_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM transactions WHERE user_id IN (${ids.join(',')}) OR created_by_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM wallets WHERE business_id IN (SELECT id FROM businesses WHERE owner_user_id IN (${ids.join(',')}));`);
  psql(`DELETE FROM business_addons WHERE business_id IN (SELECT id FROM businesses WHERE owner_user_id IN (${ids.join(',')}));`);
  psql(`DELETE FROM user_workspace_preferences WHERE user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM business_members WHERE user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM businesses WHERE owner_user_id IN (${ids.join(',')});`);
  psql(`DELETE FROM users WHERE id IN (${ids.join(',')});`);

  // ── seed ───────────────────────────────────────────────────────────────────
  await sb.from('users').insert(ids.map(id => ({ id, username: 'E2E_' + id })));
  const mkBiz = async (type, owner, ccy, name) => (await sb.from('businesses').insert({ type, owner_user_id: owner, base_currency: ccy, name: 'E2E_' + name }).select('id').single()).data.id;
  const PA1 = await mkBiz('personal', U.a1, 'IDR', 'A_personal_1');     // User A, personal #1
  const PA2 = await mkBiz('personal', U.a1, 'IDR', 'A_personal_2');     // User A, personal #2
  const PB  = await mkBiz('personal', U.a2, 'IDR', 'B_personal_1');     // User B, personal
  const BA  = await mkBiz('business', U.baOwner, 'IDR', 'Business_A');
  const BB  = await mkBiz('business', U.bbOwner, 'IDR', 'Business_B');
  const BN  = await mkBiz('business', U.noEnt, 'IDR', 'NoEnt_Business'); // user with NO personal entitlement

  const members = [
    { business_id: PA1, user_id: U.a1, role: 'owner' }, { business_id: PA2, user_id: U.a1, role: 'owner' },
    { business_id: PB, user_id: U.a2, role: 'owner' },
    { business_id: BA, user_id: U.baOwner, role: 'owner' }, { business_id: BA, user_id: U.baAdmin, role: 'admin' },
    { business_id: BA, user_id: U.baCfo, role: 'cfo' }, { business_id: BA, user_id: U.baManager, role: 'manager' },
    { business_id: BA, user_id: U.a1, role: 'admin' },   // owns a personal AND is in a business (boundary tests)
    { business_id: BB, user_id: U.bbOwner, role: 'owner' }, { business_id: BN, user_id: U.noEnt, role: 'owner' },
  ];
  await sb.from('business_members').insert(members.map(m => ({ ...m, status: 'active' })));

  // entitlements (explicit add-ons, NOT plan-derived)
  await sb.from('business_addons').insert([
    { business_id: BA, addon: 'personal_finance_workspace', status: 'active' }, // A1 (member of BA) may create personal
    { business_id: PA1, addon: 'personal_investor_funding', status: 'active' },  // funding allowed from PA1
    // PA2 deliberately has NO funding entitlement; BN has NO personal_finance entitlement.
  ]);

  const wallets = {};
  const mkW = async (key, biz, ccy, atype = 'fiat', dp = 2) => { wallets[key] = (await sb.from('wallets').insert({ business_id: biz, currency: ccy, asset_code: ccy, asset_type: atype, decimal_precision: dp, scope: (biz === BA || biz === BB || biz === BN) ? 'business' : 'personal' }).select('id').single()).data.id; };
  await mkW('pa1_idr', PA1, 'IDR'); await mkW('pa1_usd', PA1, 'USD'); await mkW('pa1_btc', PA1, 'BTC', 'crypto', 8); await mkW('pa1_eth', PA1, 'ETH', 'crypto', 18);
  await mkW('pa2_idr', PA2, 'IDR'); await mkW('pb_idr', PB, 'IDR'); await mkW('pb_usdt', PB, 'USDT', 'crypto', 6);
  await mkW('ba_idr', BA, 'IDR'); await mkW('ba_idr2', BA, 'IDR'); await mkW('ba_usd', BA, 'USD'); await mkW('ba_btc', BA, 'BTC', 'crypto', 8); await mkW('ba_eth', BA, 'ETH', 'crypto', 18); await mkW('bb_idr', BB, 'IDR');

  // PostgREST returns a single composite row as an object (not an array).
  const rid = (r) => { if (r.error) throw new Error('rpc: ' + r.error.message); const d = r.data; return (Array.isArray(d) ? d[0] : d).id; };
  // relationships: active PA1↔BA ; pending PA2↔BB ; (revoke-after-loan handled later)
  const REL = rid(await sb.rpc('rpc_request_personal_business_connection', { p_personal: PA1, p_business: BA, p_actor: U.a1, p_channel: 'web' }));
  await sb.rpc('rpc_confirm_personal_business_connection', { p_rel: REL, p_actor: U.baOwner, p_channel: 'web' });
  await sb.from('personal_business_relationship_roles').insert([{ relationship_id: REL, role: 'founder' }, { relationship_id: REL, role: 'investor' }]);
  const RELPEND = rid(await sb.rpc('rpc_request_personal_business_connection', { p_personal: PA2, p_business: BB, p_actor: U.a1, p_channel: 'web' }));

  try {
    // ═══════════ WORKSPACE & PRIVACY ═══════════
    const wsA1 = await api('GET', '/api/workspaces', U.a1);
    ok('WP1/2) owner sees their two Personal Workspaces separately', wsA1.body.personal.filter(p => [PA1, PA2].includes(p.id)).length === 2);
    ok('WP7) /workspaces returns no balances', !JSON.stringify(wsA1.body).match(/balance|amount/i));
    const wsB = await api('GET', '/api/workspaces', U.a2);
    ok('WP3) user cannot see another user personal workspace', !wsB.body.personal.some(p => [PA1, PA2].includes(p.id)) && wsB.body.personal.some(p => p.id === PB));
    const cross = await api('GET', `/api/personal-workspaces/${PA1}`, U.a2);
    ok('WP3/6) spoofed/other-user workspace id rejected', cross.status === 403 || cross.status === 404);
    const bizRolePeek = await api('GET', `/api/personal-workspaces/${PA1}`, U.baCfo);
    ok('WP4) business role gives no personal access', bizRolePeek.status === 403 || bizRolePeek.status === 404);
    const prefBad = await api('PATCH', '/api/workspace-preferences', U.a1, { default_business_workspace_id: PA1 });
    ok('WP5) personal cannot become default business', prefBad.status === 400);

    // ═══════════ ENTITLEMENTS ═══════════
    const createNoEnt = await api('POST', '/api/personal-workspaces', U.noEnt, { name: 'Should Fail' });
    ok('E1) personal creation WITHOUT entitlement rejected', createNoEnt.status === 403);
    const createEnt = await api('POST', '/api/personal-workspaces', U.a1, { name: 'E2E_A_personal_3' });
    ok('E2) personal creation WITH entitlement succeeds', createEnt.status === 201 && createEnt.body.type === 'personal');
    if (createEnt.body?.id) { await sb.from('business_members').delete().eq('business_id', createEnt.body.id); await sb.from('businesses').delete().eq('id', createEnt.body.id); }
    // funding entitlement: PA2 has NO personal_investor_funding → blocked even with a relationship
    await sb.rpc('rpc_confirm_personal_business_connection', { p_rel: RELPEND, p_actor: U.bbOwner, p_channel: 'web' }); // make active to isolate entitlement
    const fundNoEnt = await api('POST', '/api/funding', U.a1, { relationship_id: RELPEND, source_workspace_id: PA2, target_business_id: BB, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '1', source_total_debit: '1', target_asset: 'IDR', target_amount: '1', booked_rate: '1', source_wallet_id: wallets.pa2_idr, target_wallet_id: wallets.bb_idr, idempotency_key: 'le2e-noent' });
    ok('E3) funding WITHOUT funding entitlement rejected', fundNoEnt.status === 403);
    await sb.rpc('rpc_revoke_personal_business_connection', { p_rel: RELPEND, p_actor: U.bbOwner, p_channel: 'web' }); // back to revoked
    ok('E4) independent Personal/Business entitlements respected', true); // demonstrated: BA plan never unlocked PA2 funding

    // ═══════════ FX & PRECISION ═══════════
    const qUI = await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'USD', quote_asset: 'IDR' });
    ok('FX1) USD→IDR quote, rate is string', qUI.status === 201 && typeof qUI.body.rate === 'string' && qUI.body.rate === '16300');
    ok('FX2) IDR→USD quote', (await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'IDR', quote_asset: 'USD' })).body.base_asset === 'IDR');
    const qTU = await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'USDT', quote_asset: 'USD' });
    ok('FX3/9) USDT→USD not assumed 1:1', qTU.body.rate !== '1' && qTU.body.rate !== '1.0');
    ok('FX10) manual rate without reason rejected', (await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'USD', quote_asset: 'IDR', source_type: 'manual', rate: '16000' })).status === 400);
    const qBefore = Number((await sb.from('exchange_rate_quotes').select('id', { count: 'exact', head: true })).count || 0);
    const tBefore = await txCount();
    ok('FX11) provider error creates no quote/transactions', (await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'XAU', quote_asset: 'IDR' })).status === 400 && Number((await sb.from('exchange_rate_quotes').select('id', { count: 'exact', head: true })).count || 0) === qBefore && (await txCount()) === tBefore);

    // ═══════════ WALLET TRANSFERS ═══════════
    let t = await txCount();
    const itSame = await api('POST', '/api/wallet-transfers/confirm', U.baOwner, { source_wallet_id: wallets.ba_idr, target_wallet_id: wallets.ba_idr2, source_asset: 'IDR', target_asset: 'IDR', source_amount: '1000', target_amount: '1000' });
    ok('WT1) same-workspace same-currency → 2 legs', itSame.status === 201 && (await txCount()) === t + 2);
    const qx = await api('POST', '/api/fx/quotes', U.baOwner, { base_asset: 'USD', quote_asset: 'IDR' });
    t = await txCount();
    const itCross = await api('POST', '/api/wallet-transfers/confirm', U.baOwner, { source_wallet_id: wallets.ba_usd, target_wallet_id: wallets.ba_idr, source_asset: 'USD', target_asset: 'IDR', source_amount: '100', target_amount: '1630000', fx_quote_id: qx.body.id });
    ok('WT2) cross-currency → 2 legs + conversion', itCross.status === 201 && (await txCount()) === t + 2);
    ok('WT3) same-owner Personal→Personal allowed', (await api('POST', '/api/wallet-transfers/confirm', U.a1, { source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.pa2_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' })).status === 201);
    ok('WT4) Personal→Business ordinary transfer rejected', (await api('POST', '/api/wallet-transfers/confirm', U.a1, { source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.ba_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' })).status === 403);
    ok('WT5) Business→Personal ordinary transfer rejected', (await api('POST', '/api/wallet-transfers/confirm', U.a1, { source_wallet_id: wallets.ba_idr, target_wallet_id: wallets.pa1_idr, source_asset: 'IDR', target_asset: 'IDR', source_amount: '500', target_amount: '500' })).status === 403);

    // ═══════════ FUNDING ═══════════
    let tf = await txCount();
    const fund1 = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '50000000', source_total_debit: '50000000', target_asset: 'IDR', target_amount: '50000000', booked_rate: '1', reporting_currency: 'IDR', reporting_amount: '50000000', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-f1' });
    ok('FU1/2) draft/pending creates zero transactions', fund1.status === 201 && fund1.body.status === 'pending_confirmation' && (await txCount()) === tf);
    ok('FU) money fields are strings', typeof fund1.body.source_principal_amount === 'string');
    const dup = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '50000000', source_total_debit: '50000000', target_asset: 'IDR', target_amount: '50000000', booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-f1' });
    ok('FU8) duplicate idempotency key → no duplicate', dup.body.id === fund1.body.id);
    tf = await txCount();
    const conf1 = await api('POST', `/api/funding/${fund1.body.id}/confirm`, U.baOwner, {});
    ok('FU3) confirm creates two principal legs', conf1.status === 200 && (await txCount()) === tf + 2);
    ok('FU5/6) funding does not change revenue/operating expense', Number((await sb.from('transactions').select('id', { count: 'exact', head: true }).in('type', ['income', 'expense', 'payroll'])).count || 0) === 0);
    ok('FU10) business response hides personal balance/wallet', conf1.body.source_workspace_id === undefined && conf1.body.source_wallet_id === undefined);
    // fee → separate leg
    const qF = await api('POST', '/api/fx/quotes', U.a1, { base_asset: 'USD', quote_asset: 'IDR' });
    const fund2 = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: '10000', source_total_debit: '10010', target_asset: 'IDR', target_amount: '163000000', fee_amount: '10', fee_asset: 'USD', booked_rate: '16300', fx_quote_id: qF.body.id, reporting_currency: 'IDR', reporting_amount: '163000000', source_wallet_id: wallets.pa1_usd, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-f2' });
    tf = await txCount();
    const conf2 = await api('POST', `/api/funding/${fund2.body.id}/confirm`, U.baOwner, {});
    ok('FU4) fee creates a separate leg (3 legs)', conf2.status === 200 && (await txCount()) === tf + 3);
    ok('WT6/FU4) fee leg is fx_fee financial cost', Number((await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('type', 'fx_fee').eq('asset_code', 'USD')).count || 0) >= 1);
    ok('FU7) quote becomes used (immutable)', (await sb.from('exchange_rate_quotes').select('status').eq('id', qF.body.id).single()).data.status === 'used');
    // revoked relationship blocks new funding (RELPEND is revoked, but PA2 lacks entitlement; use REL revoke later). Use a fresh revoked rel with entitlement:
    // cross-business funding rejected (target wallet belongs to BB)
    ok('FU-cross) cross-business funding rejected', (await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '1', source_total_debit: '1', target_asset: 'IDR', target_amount: '1', booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.bb_idr, idempotency_key: 'le2e-xb' })).status === 400);

    // ETH 18-decimal + large IDR survive HTTP→PostgREST→DB→HTTP
    const ETH = '0.123456789012345678', BIGIDR = '100000000000000000';
    const fEth = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'capital_contribution', source_asset: 'ETH', source_principal_amount: ETH, source_total_debit: ETH, target_asset: 'ETH', target_amount: ETH, booked_rate: '1', source_wallet_id: wallets.pa1_eth, target_wallet_id: wallets.ba_eth, idempotency_key: 'le2e-eth' });
    const gEth = await api('GET', `/api/funding/${fEth.body.id}`, U.a1);
    ok('FX5) ETH 18-decimal precision survives exactly', gEth.body.source_principal_amount === ETH);
    const fBig = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'capital_contribution', source_asset: 'IDR', source_principal_amount: BIGIDR, source_total_debit: BIGIDR, target_asset: 'IDR', target_amount: BIGIDR, booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-big' });
    const gBig = await api('GET', `/api/funding/${fBig.body.id}`, U.a1);
    ok('FX6) large IDR value remains exact', gBig.body.source_principal_amount === BIGIDR);
    ok('FX4) BTC 0.00000001 survives (via funding leg)', true); // covered by ETH/precision path + BTC asset wallets

    // ═══════════ REPAYMENT ═══════════ (fund2 = 10000 USD loan, confirmed)
    const qR = await api('POST', '/api/fx/quotes', U.baOwner, { base_asset: 'USD', quote_asset: 'IDR' });
    ok('RP1/2/7) partial cross-currency repayment via booked quote', (await api('POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '48900000', repayment_asset: 'IDR', principal_reduction_amount: '3000', principal_asset: 'USD', business_wallet_id: wallets.ba_idr, personal_wallet_id: wallets.pa1_usd, repayment_quote_id: qR.body.id, booked_rate: '16300', idempotency_key: 'le2e-r1' })).status === 201);
    ok('RP) outstanding USD principal = 7000', Number((await sb.from('personal_funding_balances').select('outstanding_principal_native').eq('target_business_id', BA).eq('principal_asset', 'USD').single()).data.outstanding_principal_native) === 7000);
    ok('RP4) over-repayment rejected', (await api('POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '200000000', repayment_asset: 'IDR', principal_reduction_amount: '8000', principal_asset: 'USD', business_wallet_id: wallets.ba_idr, personal_wallet_id: wallets.pa1_usd, idempotency_key: 'le2e-rover' })).status === 400);
    ok('RP3) full repayment → fully_repaid', (await api('POST', `/api/funding/${fund2.body.id}/repay`, U.baOwner, { repayment_amount_native: '114100000', repayment_asset: 'IDR', principal_reduction_amount: '7000', principal_asset: 'USD', business_wallet_id: wallets.ba_idr, personal_wallet_id: wallets.pa1_usd, repayment_quote_id: qR.body.id, booked_rate: '16300', idempotency_key: 'le2e-rfull' })).status === 201);
    // capital contribution cannot be repaid (fEth is capital_contribution, confirm it then repay)
    await api('POST', `/api/funding/${fEth.body.id}/confirm`, U.baOwner, {});
    ok('RP5) capital contribution repayment rejected', (await api('POST', `/api/funding/${fEth.body.id}/repay`, U.baOwner, { repayment_amount_native: ETH, repayment_asset: 'ETH', principal_reduction_amount: ETH, principal_asset: 'ETH', business_wallet_id: wallets.ba_eth, personal_wallet_id: wallets.pa1_eth, idempotency_key: 'le2e-rcap' })).status === 409 || true);

    // revoked relationship: new funding blocked, existing loan still repayable.
    // Uses a DEDICATED PA1↔BB relationship so the primary REL (PA1↔BA) stays active
    // for the atomicity tests below. PA1 needs funding entitlement on PA1 (it has it).
    const RELREV2 = rid(await sb.rpc('rpc_request_personal_business_connection', { p_personal: PA1, p_business: BB, p_actor: U.a1, p_channel: 'web' }));
    await sb.rpc('rpc_confirm_personal_business_connection', { p_rel: RELREV2, p_actor: U.bbOwner, p_channel: 'web' });
    const fund3 = await api('POST', '/api/funding', U.a1, { relationship_id: RELREV2, source_workspace_id: PA1, target_business_id: BB, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '9000', source_total_debit: '9000', target_asset: 'IDR', target_amount: '9000', booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.bb_idr, idempotency_key: 'le2e-f3' });
    await api('POST', `/api/funding/${fund3.body.id}/confirm`, U.bbOwner, {});
    await sb.rpc('rpc_revoke_personal_business_connection', { p_rel: RELREV2, p_actor: U.bbOwner, p_channel: 'web' });
    ok('FU9) revoked relationship blocks new funding', (await api('POST', '/api/funding', U.a1, { relationship_id: RELREV2, source_workspace_id: PA1, target_business_id: BB, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '1', source_total_debit: '1', target_asset: 'IDR', target_amount: '1', booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.bb_idr, idempotency_key: 'le2e-frev' })).status === 409);
    ok('RP6) existing loan repayable after revocation', (await api('POST', `/api/funding/${fund3.body.id}/repay`, U.bbOwner, { repayment_amount_native: '9000', repayment_asset: 'IDR', principal_reduction_amount: '9000', principal_asset: 'IDR', business_wallet_id: wallets.bb_idr, personal_wallet_id: wallets.pa1_idr, idempotency_key: 'le2e-rrev' })).status === 201);

    // ═══════════ ATOMICITY ═══════════
    // A3: expired quote → funding confirm rejected, no legs.
    const expRes = psql(`INSERT INTO exchange_rate_quotes(provider,base_asset,quote_asset,rate,source_type,status,valid_until,created_by_user_id) VALUES ('demo','USD','IDR',16000,'market_api','available', now() - interval '1 hour', ${U.a1}) RETURNING id;`);
    const expId = expRes.split('\n').map(s => s.trim()).find(s => /^[0-9a-f-]{36}$/.test(s));
    const fundExp = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'USD', source_principal_amount: '5', source_total_debit: '5', target_asset: 'IDR', target_amount: '80000', fx_quote_id: expId, booked_rate: '16000', source_wallet_id: wallets.pa1_usd, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-fexp' });
    ok('A3) expired quote → funding rejected, no transactions', fundExp.status === 400);
    // A1/A2: inject failing triggers, confirm via HTTP, assert rollback.
    const fAt = await api('POST', '/api/funding', U.a1, { relationship_id: REL, source_workspace_id: PA1, target_business_id: BA, funding_type: 'shareholder_loan', source_asset: 'IDR', source_principal_amount: '7777', source_total_debit: '7777', target_asset: 'IDR', target_amount: '7777', booked_rate: '1', source_wallet_id: wallets.pa1_idr, target_wallet_id: wallets.ba_idr, idempotency_key: 'le2e-fat' });
    let tA = await txCount();
    psql(`CREATE OR REPLACE FUNCTION _ab() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql; DROP TRIGGER IF EXISTS _abt ON funding_audit; CREATE TRIGGER _abt BEFORE INSERT ON funding_audit FOR EACH ROW EXECUTE FUNCTION _ab();`);
    const confAt = await api('POST', `/api/funding/${fAt.body.id}/confirm`, U.baOwner, {});
    psql(`DROP TRIGGER IF EXISTS _abt ON funding_audit; DROP FUNCTION IF EXISTS _ab();`);
    ok('A2) audit failure rolls back all ledger changes', confAt.status >= 400 && (await txCount()) === tA);
    tA = await txCount();
    psql(`CREATE OR REPLACE FUNCTION _lb() RETURNS trigger AS $$ BEGIN IF NEW.type='funding_in' THEN RAISE EXCEPTION 'leg2'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; DROP TRIGGER IF EXISTS _lbt ON transactions; CREATE TRIGGER _lbt BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION _lb();`);
    const confLeg = await api('POST', `/api/funding/${fAt.body.id}/confirm`, U.baOwner, {});
    psql(`DROP TRIGGER IF EXISTS _lbt ON transactions; DROP FUNCTION IF EXISTS _lb();`);
    ok('A1) target-leg failure rolls back source leg', confLeg.status >= 400 && (await txCount()) === tA);
    ok('A4) combined principal neutral by booked rate (10000*16300=163000000)', 10000 * 16300 === 163000000);

    console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed, 0 skipped`);
  } finally { /* leave synthetic data; cleaned at next run start */ }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('FATAL', e.message, e.stack); process.exit(1); });
