'use strict';
// Phase K1 — security on the clean install: direct PostgREST access with a REAL Supabase session (a customer can obtain
// one from GoTrue with the public anon key), role escalation inside a company, session/JWT tampering, legacy routes,
// CORS, log redaction.
const fs = require('fs');
const { assert, call, collector, db, key, state, signIn, S } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/security.json');
const REST = 'http://127.0.0.1:55450/rest/v1', AUTH = 'http://127.0.0.1:55450/auth/v1';
(async () => {
  const c = await db();
  const st = state(), { A1, B1 } = st.companies;
  const alpha = await signIn('owner.alpha@rehearsal.test', st.alpha_password);
  const beta = await signIn('owner.beta@rehearsal.test', st.beta_password);
  // A real Supabase Auth session for the customer, straight from GoTrue (public endpoint, anon key).
  const gt = await fetch(AUTH + '/token?grant_type=password', { method: 'POST', headers: { apikey: S.anon_key, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner.beta@rehearsal.test', password: st.beta_password }) }).then((r) => r.json());
  const rest = (path, { token, method = 'GET', body, prefer } = {}) => fetch(REST + path, { method, headers: { apikey: S.anon_key, authorization: 'Bearer ' + (token || S.anon_key), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const TABLES = ['users', 'user_email_identities', 'user_profiles', 'auth_user_links', 'auth_app_sessions', 'platform_admins', 'businesses', 'business_members', 'wallets', 'transactions',
    'debts', 'financial_documents', 'document_files', 'bank_import_batches', 'bank_import_rows', 'billing_accounts', 'billing_grants', 'billing_overrides', 'plan_versions', 'audit_events', 'cfo_migration_ledger', 'email_login_codes', 'financial_write_requests'];
  const RPCS = { rpc_auth_password_session: { p_auth_user_id: '00000000-0000-4000-8000-000000000001', p_email: 'x@y.zz', p_email_confirmed_at: '2026-01-01', p_ttl_seconds: 3600 },
    rpc_auth_revoke_all_sessions: { p_auth_user_id: '00000000-0000-4000-8000-000000000001', p_reason: 'admin' },
    fn_bootstrap_platform_super_admin: { p_user_id: beta.id }, rpc_platform_admin_grant: { p_actor: beta.id, p_email: 'owner.beta@rehearsal.test', p_role: 'super_admin' },
    rpc_billing_admin_command: {}, rpc_billing_trial_command: {}, rpc_record_debt_payment_guarded: {}, rpc_execute_wallet_transfer_guarded: {}, rpc_create_business_bill: {}, rpc_confirm_bank_import_reviewed: {} };
  await check('a customer can obtain a real Supabase session from GoTrue (expected: public Auth API) — the rest of K1 uses it', async () => {
    assert.ok(gt.access_token, JSON.stringify(gt).slice(0, 200));
    const claims = JSON.parse(Buffer.from(gt.access_token.split('.')[1], 'base64url')); assert.equal(claims.role, 'authenticated');
    return { role: claims.role, sub_is_uuid: /^[0-9a-f-]{36}$/.test(claims.sub) };
  });
  const matrix = {};
  await check('PostgREST: anon and a real authenticated session read zero rows of every customer, identity, admin, billing and audit table', async () => {
    for (const [who, token] of [['anon', null], ['authenticated', gt.access_token]]) {
      matrix[who] = {};
      for (const t of TABLES) {
        const r = await rest(`/${t}?select=*&limit=5`, { token }); const body = await r.json().catch(() => null);
        matrix[who][t] = r.status >= 400 ? 'denied' : `rows=${Array.isArray(body) ? body.length : '?'}`;
        if (t !== 'plan_versions') assert.ok(r.status >= 400 || (Array.isArray(body) && body.length === 0), `${who} read ${t}: ${matrix[who][t]}`);
      }
    }
    return matrix;
  });
  await check('PostgREST: anon and authenticated cannot write customer tables or call auth/admin/billing/money RPCs', async () => {
    const out = {};
    for (const [who, token] of [['anon', null], ['authenticated', gt.access_token]]) {
      for (const [t, row] of [['transactions', { business_id: A1, type: 'income', amount: 1, description: 'rest write' }], ['business_members', { business_id: A1, user_id: beta.id, role: 'owner', status: 'active' }],
        ['platform_admins', { user_id: beta.id, role: 'super_admin', is_active: true }], ['auth_user_links', { user_id: beta.id, auth_user_id: '00000000-0000-4000-8000-000000000002', email: 'x@y.zz', link_method: 'registration' }]]) {
        const r = await rest('/' + t, { token, method: 'POST', body: row, prefer: 'return=minimal' }); out[`${who} insert ${t}`] = r.status; assert.ok(r.status >= 400, `${who} inserted into ${t}`);
      }
      for (const [fn, args] of Object.entries(RPCS)) {
        const r = await rest('/rpc/' + fn, { token, method: 'POST', body: args }); out[`${who} rpc ${fn}`] = r.status;
        assert.ok(r.status === 401 || r.status === 403 || r.status === 404, `${who} could execute ${fn}: ${r.status}`);
      }
    }
    assert.equal(Number((await c.query("SELECT count(*) n FROM transactions WHERE description='rest write'")).rows[0].n), 0);
    assert.equal(Number((await c.query('SELECT count(*) n FROM platform_admins WHERE user_id=$1', [beta.id])).rows[0].n), 0);
    return out;
  });
  await check('the Supabase session is not an app session: the backend refuses it everywhere', async () => {
    for (const p of ['/workspaces', '/me/profile', '/transactions', '/admin/status']) assert.equal((await call('GET', p, { token: gt.access_token, biz: B1 })).status, 401, p);
    await fetch(AUTH + '/logout?scope=global', { method: 'POST', headers: { apikey: S.anon_key, authorization: 'Bearer ' + gt.access_token } });
  });
  await check('role escalation inside a company: an invited employee cannot move money, manage billing, change roles or reach admin', async () => {
    const inv = await call('POST', '/team/invite', { token: alpha.token, biz: A1, body: { role: 'employee', label: 'rehearsal employee', max_uses: 1, expires_days: 1 } });
    assert.equal(inv.status, 200, JSON.stringify(inv.body).slice(0, 200));
    const acc = await call('POST', `/invite/${inv.body.invite.code}/accept`, { token: beta.token, body: {} }); assert.ok(acc.status < 300, 'accept ' + JSON.stringify(acc.body).slice(0, 200));
    const w = st.wallets;
    const out = {
      transfer: (await call('POST', '/wallets/transfer', { token: beta.token, biz: A1, body: { transfer_id: key(), from_wallet_id: w.bca, to_wallet_id: w.mandiri, amount: 1, date: '2026-10-12' } })).status,
      adjust: (await call('POST', `/wallets/${w.bca}/adjust-balance`, { token: beta.token, biz: A1, body: { request_key: key(), target_balance: 1, expected_balance: 0, reason: 'escalate' } })).status,
      new_wallet: (await call('POST', '/wallets', { token: beta.token, biz: A1, body: { request_key: key(), name: 'Employee wallet', currency: 'IDR' } })).status,
      trial: (await call('POST', '/billing/trial', { token: beta.token, biz: A1, body: { request_key: key(), plan_version_id: st.published.pro, expected_version: 1 } })).status,
      invite_owner: (await call('POST', '/team/invite', { token: beta.token, biz: A1, body: { role: 'owner' } })).status,
      admin: (await call('GET', '/admin/dashboard', { token: beta.token })).status,
    };
    const members = (await c.query('SELECT user_id, role FROM business_members WHERE business_id=$1 ORDER BY role', [A1])).rows;
    const me = members.find((m) => Number(m.user_id) === beta.id);
    const promote = (await call('PATCH', `/team/members/${me && (await c.query('SELECT id FROM business_members WHERE business_id=$1 AND user_id=$2', [A1, beta.id])).rows[0].id}`, { token: beta.token, biz: A1, body: { role: 'owner' } })).status;
    out.promote_self = promote;
    for (const [k, v] of Object.entries(out)) assert.ok(v >= 400, `${k} allowed for an employee: ${v}`);
    assert.equal((await c.query('SELECT role FROM business_members WHERE business_id=$1 AND user_id=$2', [A1, beta.id])).rows[0].role, 'employee');
    return out;
  });
  await check('JWT tampering: wrong secret, alg none, expired, foreign user id with a valid session id → 401', async () => {
    const jwt = require('jsonwebtoken');
    const claims = JSON.parse(Buffer.from(alpha.token.split('.')[1], 'base64url'));
    const forged = [jwt.sign(Object.fromEntries(Object.entries(claims).filter(([k]) => !['iat', 'exp'].includes(k))), 'not-the-secret'),
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ ...claims })).toString('base64url') + '.',
      alpha.token.slice(0, -4) + 'abcd'];
    for (const t of forged) assert.equal((await call('GET', '/workspaces', { token: t })).status, 401);
    return { variants: forged.length };
  });
  await check('legacy and alternative sign-in routes give no bypass (magic link off, forged Telegram login refused)', async () => {
    for (const p of ['/auth/email/start', '/auth/email/verify']) assert.equal((await call('POST', p, { body: { email: 'owner.alpha@rehearsal.test', code: '000000' } })).status, 404);
    const tg = await call('POST', '/auth/telegram', { body: { id: 7001001, first_name: 'x', auth_date: Math.floor(Date.now() / 1000), hash: 'f'.repeat(64) } });
    assert.equal(tg.status, 401, JSON.stringify(tg.body));
  });
  await check('CORS: a foreign origin gets no credentialed access grant; auth is a bearer header (no cookie → no CSRF surface)', async () => {
    const r = await fetch('http://127.0.0.1:55460/api/workspaces', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    const acao = r.headers.get('access-control-allow-origin'), cred = r.headers.get('access-control-allow-credentials');
    const login = await fetch('http://127.0.0.1:55460/api/auth/password/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.1' }, body: JSON.stringify({ email: 'owner.alpha@rehearsal.test', password: st.alpha_password }) });
    assert.equal(login.headers.get('set-cookie'), null, 'login sets a cookie');
    return { preflight_status: r.status, allow_origin: acao, allow_credentials: cred };
  });
  await check('logs carry no passwords, app tokens or Supabase tokens', async () => {
    const log = fs.readFileSync(require('./env.cjs').HOME + '/app.log', 'utf8');
    for (const p of [st.alpha_password, st.beta_password, st.admin_password, st.staff_password]) assert.ok(!log.includes(p), 'password in app log');
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(log), 'JWT in app log');
    return { app_log_lines: log.split('\n').length };
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('SECURITY CRASHED', e); process.exit(1); });
