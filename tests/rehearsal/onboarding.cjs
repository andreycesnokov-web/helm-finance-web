'use strict';
// Phases E (customer onboarding, plan selection, trial), F (fresh companies) and I (billing enforcement, flag ON).
// Starter/Control/Pro are published here with their SEEDED PRICES, the OWNER-APPROVED limits already in the drafts
// (users, transactions, documents, AI Assistant) and REHEARSAL-ONLY values for the limits and features that are still
// PENDING APPROVAL (V2_DYNAMIC_PLAN_MATRIX.md): as shipped the drafts cannot be published (billing_terms_incomplete).
const { assert, call, ensureUser, collector, db, key, state, signIn } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/onboarding.json');
const APPROVED = { starter: { users: 2, transactions: 1000, documents: 100, ai: 50 }, control: { users: 5, transactions: 5000, documents: 500, ai: 300 },
  pro: { users: 15, transactions: 20000, documents: 2000, ai: 1000 } };
const PENDING_TEST = { starter: { companies: 1, imports: 10, bank_rows: 1000, accounts: 5, storage_mb: 2048, integrations: 0, mcp: 0, ai_accountant: 0, ai_extraction: 100 },
  control: { companies: 1, imports: 50, bank_rows: 5000, accounts: 15, storage_mb: 10240, integrations: 1, mcp: 1000, ai_accountant: 100, ai_extraction: 500 },
  pro: { companies: 3, imports: 200, bank_rows: 20000, accounts: 50, storage_mb: 51200, integrations: 5, mcp: 10000, ai_accountant: 500, ai_extraction: 2000 } };
const MATRIX = {
  starter: { features: { documents: true, ai: false, import: true, payroll: false, team: false, approvals: false, export: true, integrations: false, cfo_ai: false, ai_accountant: false, api: false },
    limits: { ...APPROVED.starter, ...PENDING_TEST.starter } },
  control: { features: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: false, cfo_ai: true, ai_accountant: false, api: false },
    limits: { ...APPROVED.control, ...PENDING_TEST.control } },
  pro: { features: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: true, cfo_ai: true, ai_accountant: true, api: true },
    limits: { ...APPROVED.pro, ...PENDING_TEST.pro } },
};
const SPEC = { starter: 5900, control: 14900, pro: 29900 };
(async () => {
  const c = await db();
  const st = state();
  const admin = await signIn('admin.root@rehearsal.test', st.admin_password);
  const alphaPw = st.alpha_password || 'Alpha-Owner-Reset-2026', betaPw = st.beta_password || 'Beta-Owner-Pass-' + key().slice(0, 8);
  state({ alpha_password: alphaPw, beta_password: betaPw });
  const alpha = await ensureUser('owner.alpha@rehearsal.test', alphaPw);
  const beta = await ensureUser('owner.beta@rehearsal.test', betaPw);
  const companies = {};

  await check('catalog prices match the commercial specification (Starter $59, Control $149, Pro $299, USD, monthly, 168 h)', async () => {
    const rows = (await c.query("SELECT plan, version, price_minor, currency, billing_interval, trial_hours FROM plan_versions WHERE plan IN ('starter','control','pro') ORDER BY plan, version")).rows;
    assert.ok(rows.length >= 6, 'v1 + v2 draft per plan');
    for (const r of rows) { assert.equal(Number(r.price_minor), SPEC[r.plan], r.plan); assert.equal(r.currency, 'USD'); assert.equal(r.billing_interval, 'month'); assert.equal(r.trial_hours, 168); }
    return { rows };
  });
  await check('seeded drafts carry exactly the owner-approved limits and are NOT publishable until the PENDING limits are decided (billing_terms_incomplete)', async () => {
    const cat = (await call('GET', '/admin/billing/catalog', { token: admin.token })).body;
    for (const code of ['starter', 'control', 'pro']) {
      const p = cat.plans.find((x) => x.plan === code), v = cat.versions.find((x) => x.id === p.current_version_id);
      if (v.approval_status === 'approved') continue;   // re-run after publishing
      assert.deepEqual(v.features, {}); assert.deepEqual(v.limits, APPROVED[code], code);
      const r = await call('POST', `/admin/billing/catalog/${code}/preview`, { token: admin.token, body: { expected_version: Number(p.catalog_version), terms: { action: 'publish', confirm_publish: true, publish: true, approval_status: 'approved', name_i18n: v.name_i18n, description_i18n: v.description_i18n, price_minor: Number(v.price_minor), currency: v.currency, trial_hours: v.trial_hours, terms_version: v.terms_version, features: v.features, limits: v.limits } } });
      assert.equal(r.body.error, 'billing_terms_incomplete', code);
    }
  });
  const published = {};
  await check('REHEARSAL ONLY: admin publishes Starter/Control/Pro at the seeded prices with a test feature/limit matrix (confirmed, versioned, audited)', async () => {
    let cat = (await call('GET', '/admin/billing/catalog', { token: admin.token })).body;
    for (const code of ['starter', 'control', 'pro']) {
      const p = cat.plans.find((x) => x.plan === code), v = cat.versions.find((x) => x.id === p.current_version_id);
      if (v.approval_status === 'approved') { published[code] = v.id; continue; }
      const terms = { action: 'publish', confirm_publish: true, publish: true, approval_status: 'approved', name_i18n: v.name_i18n, description_i18n: v.description_i18n,
        price_minor: Number(v.price_minor), currency: v.currency, trial_hours: 168, terms_version: 'rehearsal-only-2026-10-16', effective_at: new Date(Date.now() - 60000).toISOString(), ...MATRIX[code] };
      const noConfirm = await call('POST', `/admin/billing/catalog/${code}`, { token: admin.token, body: { request_key: key(), expected_version: Number(p.catalog_version), terms: { ...terms, confirm_publish: false } } });
      assert.equal(noConfirm.body.error, 'billing_publish_not_confirmed', code);
      const r = await call('POST', `/admin/billing/catalog/${code}`, { token: admin.token, body: { request_key: key(), expected_version: Number(p.catalog_version), terms } });
      assert.equal(r.status, 200, code + ' ' + JSON.stringify(r.body).slice(0, 300));
      published[code] = r.body.terms.id; assert.equal(Number(r.body.terms.price_minor), SPEC[code]);
      cat = (await call('GET', '/admin/billing/catalog', { token: admin.token })).body;
    }
    await assert.rejects(c.query("UPDATE plan_versions SET price_minor = 1 WHERE id = $1", [published.starter]), /immutable|not allowed|permission|forbidden/i);
    state({ published });
    return published;
  });
  const create = async (u, name) => {
    const r = await call('POST', '/businesses', { token: u.token, body: { name, request_key: key(), base_currency: 'IDR', country: 'Indonesia', timezone: 'Asia/Jakarta' } });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.business.id;
  };
  await check('a new customer creates a company: owner membership only, commercial policy, empty books, no inherited data', async () => {
    companies.A1 = await create(alpha, 'Alpha Trading (rehearsal)');
    companies.A2 = await create(alpha, 'Alpha Holdings (rehearsal)');
    companies.B1 = await create(beta, 'Beta Studio (rehearsal)');
    for (const [k, id] of Object.entries(companies)) {
      const m = (await c.query('SELECT user_id, role, status FROM business_members WHERE business_id=$1', [id])).rows;
      assert.equal(m.length, 1, k); assert.equal(m[0].role, 'owner'); assert.equal(Number(m[0].user_id), k === 'B1' ? beta.id : alpha.id);
      const b = (await c.query('SELECT billing_policy, owner_user_id FROM businesses WHERE id=$1', [id])).rows[0]; assert.equal(b.billing_policy, 'commercial_v2', k);
      for (const t of ['wallets', 'transactions', 'debts']) assert.equal(Number((await c.query(`SELECT count(*) n FROM ${t} WHERE business_id=$1`, [id])).rows[0].n), 0, k + ' ' + t);
    }
    assert.equal(new Set(Object.values(companies)).size, 3);
    state({ companies });
    return companies;
  });
  const billing = async (u, biz) => (await call('GET', '/billing', { token: u.token, biz })).body;
  await check('before a plan: billing shows commercial policy and no trial; financial writes are refused server-side (402)', async () => {
    const b = await billing(alpha, companies.A1); assert.equal(b.policy, 'commercial_v2');
    const w = await call('POST', '/wallets', { token: alpha.token, biz: companies.A1, body: { request_key: key(), name: 'Too early', currency: 'IDR' } });
    assert.equal(w.status, 402, JSON.stringify(w.body)); assert.ok(w.body.billing_url);
    const prof = await call('PUT', '/accountant/profile', { token: alpha.token, biz: companies.A1, body: { expected_version: 0, request_key: key(), brand_name: 'Too early' } });
    assert.equal(prof.status, 402, 'profile write before the trial: ' + prof.status);
    return { account_state: b.account?.state || b.account?.status || null, access: b.access };
  });
  const start = async (u, biz, plan) => {
    let b = await billing(u, biz);
    const sel = await call('POST', '/billing/plan', { token: u.token, biz, body: { request_key: key(), plan_version_id: published[plan], expected_version: Number(b.account.version) } });
    assert.equal(sel.status, 200, 'select ' + JSON.stringify(sel.body)); b = await billing(u, biz);
    const k = key(), body = { request_key: k, plan_version_id: published[plan], expected_version: Number(b.account.version) };
    const tr = await call('POST', '/billing/trial', { token: u.token, biz, body }); assert.equal(tr.status, 200, 'trial ' + JSON.stringify(tr.body));
    return { body, tr: tr.body };
  };
  await check('plan selection + trial: exactly 168 h, selected plan stored, bound to the company, idempotent replay', async () => {
    const r = await start(alpha, companies.A1, 'control');
    const a = (await c.query('SELECT selected_plan_version_id, trial_started_at, trial_ends_at, business_id FROM billing_accounts WHERE business_id=$1', [companies.A1])).rows[0];
    assert.equal(a.selected_plan_version_id, published.control);
    assert.equal(new Date(a.trial_ends_at) - new Date(a.trial_started_at), 168 * 3600e3);
    const replay = await call('POST', '/billing/trial', { token: alpha.token, biz: companies.A1, body: r.body }); assert.equal(replay.status, 200);
    assert.equal(Number((await c.query('SELECT count(*) n FROM billing_accounts WHERE business_id=$1', [companies.A1])).rows[0].n), 1);
    return { trial_started_at: a.trial_started_at, trial_ends_at: a.trial_ends_at };
  });
  await check('company profile (after the trial, as the v2 flow does) is saved with optimistic version and request key; a stale version is refused', async () => {
    const g = await call('GET', '/accountant/profile', { token: alpha.token, biz: companies.A1 }); assert.equal(g.status, 200, JSON.stringify(g.body).slice(0, 200));
    const ver = g.body.profile?.profile_version ?? g.body.profile_version ?? 0;
    const r = await call('PUT', '/accountant/profile', { token: alpha.token, biz: companies.A1, body: { expected_version: Number(ver), request_key: key(), company_legal_name: 'PT Alpha Trading Rehearsal', brand_name: 'Alpha', industry: 'trading', reporting_currency: 'IDR' } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const stale = await call('PUT', '/accountant/profile', { token: alpha.token, biz: companies.A1, body: { expected_version: Number(ver), request_key: key(), brand_name: 'Stale' } });
    assert.ok(stale.status === 409, 'stale profile write accepted: ' + stale.status);
  });
  await check('one trial per company: a second activation (new key, other plan) opens no new window and changes no plan; another company of the same owner gets its own', async () => {
    const b = await billing(alpha, companies.A1);
    const row0 = (await c.query('SELECT selected_plan_version_id, trial_ends_at FROM billing_accounts WHERE business_id=$1', [companies.A1])).rows[0];
    const again = await call('POST', '/billing/trial', { token: alpha.token, biz: companies.A1, body: { request_key: key(), plan_version_id: published.pro, expected_version: Number(b.account.version) } });
    assert.ok(again.status >= 400 || again.body.already_started === true, 'second trial: ' + JSON.stringify(again.body).slice(0, 200));
    const row1 = (await c.query('SELECT selected_plan_version_id, trial_ends_at FROM billing_accounts WHERE business_id=$1', [companies.A1])).rows[0];
    assert.equal(String(row1.trial_ends_at), String(row0.trial_ends_at)); assert.equal(row1.selected_plan_version_id, row0.selected_plan_version_id);
    const before = row1.trial_ends_at;
    await start(alpha, companies.A2, 'pro');
    assert.equal(String((await c.query('SELECT trial_ends_at FROM billing_accounts WHERE business_id=$1', [companies.A1])).rows[0].trial_ends_at), String(before));
  });
  await check('concurrent trial activations for one company (different keys): exactly one wins, one trial window', async () => {
    let b = await billing(beta, companies.B1);
    const sel = await call('POST', '/billing/plan', { token: beta.token, biz: companies.B1, body: { request_key: key(), plan_version_id: published.starter, expected_version: Number(b.account.version) } });
    assert.equal(sel.status, 200); b = await billing(beta, companies.B1);
    const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/billing/trial', { token: beta.token, biz: companies.B1, body: { request_key: key(), plan_version_id: published.starter, expected_version: Number(b.account.version) } })));
    const started = rs.filter((r) => r.status === 200 && r.body.already_started === false && r.body.is_replay === false);
    assert.equal(started.length, 1, rs.map((r) => r.status + ':' + r.body?.already_started).join(','));
    assert.ok(rs.every((r) => r.status === 200 || (r.status >= 400 && r.status < 500)), rs.map((r) => r.status).join(','));
    const a = (await c.query('SELECT trial_started_at, trial_ends_at FROM billing_accounts WHERE business_id=$1', [companies.B1])).rows[0];
    assert.equal(new Date(a.trial_ends_at) - new Date(a.trial_started_at), 168 * 3600e3);
    return { statuses: rs.map((r) => r.status) };
  });
  await check('only the owner manages billing: a non-member cannot read or start a trial for another company', async () => {
    assert.ok([403, 404].includes((await call('GET', '/billing', { token: beta.token, biz: companies.A1 })).status));
    const b = await billing(alpha, companies.A1);
    const r = await call('POST', '/billing/trial', { token: beta.token, biz: companies.A1, body: { request_key: key(), plan_version_id: published.pro, expected_version: Number(b.account.version) } });
    assert.ok([403, 404].includes(r.status), String(r.status));
  });
  await check('plan entitlements enforced server-side: AI CFO refused on Starter (402 feature), admitted on Control/Pro', async () => {
    const ask = (u, biz) => call('POST', '/ai-cfo/ask', { token: u.token, biz, headers: { 'Idempotency-Key': key() }, body: { question: 'Rehearsal: what is my cash?' } });
    const s = await ask(beta, companies.B1); assert.equal(s.status, 402, JSON.stringify(s.body)); assert.ok(s.body.billing_url);
    for (const [u, biz] of [[alpha, companies.A1], [alpha, companies.A2]]) { const r = await ask(u, biz); assert.notEqual(r.status, 402, JSON.stringify(r.body)); }
    return { starter: s.body.error };
  });
  await check('active trial: financial writes allowed on every plan', async () => {
    for (const [u, biz] of [[alpha, companies.A1], [alpha, companies.A2], [beta, companies.B1]]) {
      const w = await call('POST', '/wallets', { token: u.token, biz, body: { request_key: key(), name: 'Operating ' + biz.slice(0, 4), currency: 'IDR', opening_balance: 1000000 } });
      assert.equal(w.status, 200, JSON.stringify(w.body).slice(0, 200));
    }
  });
  await check('expired trial (controlled time): writes 402 with upgrade path, own data readable and exportable, no bypass by company switch or header', async () => {
    await c.query("ALTER TABLE billing_accounts DISABLE TRIGGER USER");
    try { await c.query("UPDATE billing_accounts SET trial_started_at = now() - interval '169 hours', trial_ends_at = now() - interval '1 hour' WHERE business_id = $1", [companies.B1]); }
    finally { await c.query("ALTER TABLE billing_accounts ENABLE TRIGGER USER"); }
    const b = await billing(beta, companies.B1);
    const w = await call('POST', '/transactions/batch', { token: beta.token, biz: companies.B1, body: { request_key: key(), transactions: [{ type: 'income', amount: 5, currency: 'IDR', scope: 'business', description: 'after expiry' }] } });
    assert.equal(w.status, 402, JSON.stringify(w.body)); assert.equal(w.body.billing_url, '/business/billing');
    for (const p of ['/transactions', '/wallets', '/debts', '/pulse']) assert.equal((await call('GET', p, { token: beta.token, biz: companies.B1 })).status, 200, p);
    const exp = await call('GET', '/accountant/operation-documents/package?month=' + new Date().toISOString().slice(0, 7), { token: beta.token, biz: companies.B1, raw: true });
    assert.notEqual(exp.status, 402, 'own-data export blocked by plan');
    const other = await call('POST', '/transactions/batch', { token: beta.token, biz: companies.A1, body: { request_key: key(), transactions: [{ type: 'income', amount: 5, currency: 'IDR', scope: 'business', description: 'switch bypass' }] } });
    assert.ok([403, 404].includes(other.status), 'cross-company write: ' + other.status);
    const none = await call('POST', '/transactions/batch', { token: beta.token, body: { request_key: key(), transactions: [{ type: 'income', amount: 5, currency: 'IDR', scope: 'business', description: 'no header' }] } });
    assert.ok(none.status >= 400, 'write without company header: ' + none.status);
    assert.equal(Number((await c.query("SELECT count(*) n FROM transactions WHERE description IN ('after expiry','switch bypass','no header')")).rows[0].n), 0);
    return { restricted: b.access?.restricted, source: b.access?.effective_access_source, export_status: exp.status, export_type: exp.headers.get('content-type') };
  });
  await check('admin grant restores access for an expired company (audited, admin-only), revoke takes it away again', async () => {
    const probe = () => call('POST', '/wallets', { token: beta.token, biz: companies.B1, body: { request_key: key(), name: 'Grant probe ' + key().slice(0, 6), currency: 'IDR' } });
    assert.equal((await probe()).status, 402);
    const ver = async () => Number((await call('GET', '/admin/billing/companies/' + companies.B1, { token: admin.token })).body?.account?.version ?? (await billing(beta, companies.B1)).account.version);
    const body = (action, payload) => ({ request_key: key(), expected_version: 0, payload });
    const cmd = async (action, payload, token = admin.token) => { const b = body(action, payload); b.expected_version = await ver(); return call('POST', '/admin/billing/companies/' + companies.B1 + '/' + action, { token, body: b }); };
    const denied = await cmd('grant', { plan_version_id: published.pro, ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), reason: 'customer self-grant attempt' }, beta.token);
    assert.equal(denied.status, 403);
    const g = await cmd('grant', { plan_version_id: published.pro, ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), reason: 'Rehearsal: support grant after trial expiry' });
    assert.equal(g.status, 200, JSON.stringify(g.body).slice(0, 300));
    assert.equal((await probe()).status, 200, 'grant did not restore access');
    const gid = (await c.query('SELECT id FROM billing_grants WHERE business_id=$1 AND revoked_at IS NULL', [companies.B1])).rows[0].id;
    const r = await cmd('revoke', { grant_id: gid, reason: 'Rehearsal: grant withdrawn' }); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.equal((await probe()).status, 402, 'revoked grant still admits writes');
    const audit = (await call('GET', '/admin/billing/audit', { token: admin.token })).body;
    return { audit_mentions_company: JSON.stringify(audit).includes(companies.B1) };
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('ONBOARDING CRASHED', e); process.exit(1); });
