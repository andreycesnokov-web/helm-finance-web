// Onboarding ENDPOINTS over real HTTP (migration 054).
//
// The assertions that matter: the flag hides the feature before any DB access, opening
// onboarding never provisions a business or a trial, one user cannot touch another's
// progress, locales resolve with English fallback, and onboarding mutates nothing financial.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'ONBOARDING_ENABLED';

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER_A = 7001, OWNER_B = 7004, LONER = 7005;   // LONER: positive id, NO business
const ADMIN = -1;

const FLOW_QUICK = 'f0000000-0000-0000-0000-000000000001';
const S1 = 's0000000-0000-0000-0000-000000000001';   // required
const S2 = 's0000000-0000-0000-0000-000000000002';
const S3 = 's0000000-0000-0000-0000-000000000003';   // not skippable

const dbState = {};
const dbTouches = { tables: [] };

function seed() {
  Object.assign(dbState, {
    businesses: [
      { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', status: 'active' },
      { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', status: 'active' },
    ],
    business_members: [
      { id: 'm1', user_id: OWNER_A, business_id: BIZ_A, role: 'owner', status: 'active' },
      { id: 'm4', user_id: OWNER_B, business_id: BIZ_B, role: 'owner', status: 'active' },
      { id: 'm5', user_id: ADMIN, business_id: BIZ_A, role: 'owner', status: 'active' },
    ],
    users: [OWNER_A, OWNER_B, LONER, ADMIN].map(id => ({ id })),
    onboarding_flows: [{
      id: FLOW_QUICK, flow_key: 'quick_business_setup', title: 'Quick setup',
      description: 'Fast start', mode: 'quick_setup', audience: 'business_owner',
      is_active: true, sort_order: 10, metadata: {},
      title_i18n: { ru: 'Быстрая настройка', id: 'Penyiapan cepat' },
      description_i18n: { ru: 'Быстрый старт' },   // deliberately no `id` -> falls back
    }],
    onboarding_steps: [
      { id: S1, flow_id: FLOW_QUICK, step_key: 'one', title: 'Step one', description: 'First',
        title_i18n: { ru: 'Шаг один' }, description_i18n: {}, instructions_i18n: { en: 'Do it', ru: 'Сделайте' },
        page_path: '/business/pulse', action_type: 'read', product_area: 'general',
        required: true, skippable: true, sort_order: 10, metadata: {} },
      { id: S2, flow_id: FLOW_QUICK, step_key: 'two', title: 'Step two', description: 'Second',
        title_i18n: {}, description_i18n: {}, instructions_i18n: {},
        page_path: '/business/accounts', action_type: 'add_wallet', product_area: 'accounts',
        required: false, skippable: true, sort_order: 20, metadata: {} },
      { id: S3, flow_id: FLOW_QUICK, step_key: 'three', title: 'Step three', description: 'Third',
        title_i18n: {}, description_i18n: {}, instructions_i18n: {},
        page_path: '/business/settings', action_type: 'read', product_area: 'settings',
        required: false, skippable: false, sort_order: 30, metadata: {} },
    ],
    onboarding_progress: [], onboarding_step_progress: [], onboarding_events: [],
    onboarding_context_snapshots: [],
    // Financial + support tables, asserted untouched.
    transactions: [], wallets: [], debts: [], incoming_payments: [],
    payment_provider_credentials: [], payment_provider_connections: [],
    support_conversations: [], audit_events: [],
  });
  dbTouches.tables = [];
}

function fakeFrom(table) {
  dbTouches.tables.push(table);
  const st = { filters: [], ins: [], isNull: [], single: false, maybeSingle: false, op: 'select',
               values: null, wantBiz: false, limit: null, cols: null };
  const rows = () => (dbState[table] = dbState[table] || []);
  const match = (r) => st.filters.every(([c, v]) => String(r[c]) === String(v))
    && st.ins.every(({ c, v }) => v.map(String).includes(String(r[c])))
    && st.isNull.every((c) => r[c] === null || r[c] === undefined);
  const embed = (list) => list.map(r => (st.wantBiz && table === 'business_members'
    ? { ...r, businesses: dbState.businesses.find(b => b.id === r.business_id) || null } : r));
  const project = (list) => (!st.cols ? list
    : list.map(r => Object.fromEntries(st.cols.filter(c => c in r).map(c => [c, r[c]]))));
  const q = {
    select(cols) {
      if (typeof cols !== 'string' || cols === '*') return q;
      if (cols.includes('(')) { if (cols.includes('businesses(')) st.wantBiz = true; return q; }
      st.cols = cols.split(',').map(c => c.trim()).filter(Boolean);
      return q;
    },
    eq(c, v) { st.filters.push([c, v]); return q; },
    is(c, v) { if (v === null) st.isNull.push(c); return q; },
    in(c, v) { st.ins.push({ c, v }); return q; },
    or() { return q; }, order() { return q; },
    limit(n) { st.limit = n; return q; },
    single() { st.single = true; return q; },
    maybeSingle() { st.maybeSingle = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      let out;
      if (st.op === 'insert') {
        const arr = (Array.isArray(st.values) ? st.values : [st.values]).map(r => ({
          id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(), business_id: r.business_id ?? null, ...r }));
        for (const r of arr) rows().push(r);
        const p = project(arr);
        out = { data: st.single ? p[0] : p, error: null };
      } else if (st.op === 'update') {
        const hits = rows().filter(match);
        for (const r of hits) Object.assign(r, st.values, { updated_at: new Date().toISOString() });
        const p = project(hits);
        out = { data: st.single ? (p[0] || null) : p, error: null };
      } else {
        let list = embed(rows().filter(match));
        if (st.limit) list = list.slice(0, st.limit);
        list = project(list);
        out = (st.single || st.maybeSingle) ? { data: list[0] || null, error: null } : { data: list, error: null };
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return q;
}
const supabase = { from: fakeFrom, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} };

let server = null, BASE = null, jwt = null;
before(async () => {
  seed();
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true,
    exports: { ...real, createClient: () => supabase } };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: 's', PORT: '0',
    [FLAG]: 'true', ADMIN_TELEGRAM_IDS: String(ADMIN),
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise(r => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });
beforeEach(() => { seed(); process.env[FLAG] = 'true'; });

const tok = (u) => jwt.sign({ userId: u }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { token, business, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (business) headers['x-business-id'] = business;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const asA = { token: tok(OWNER_A), business: BIZ_A };
const start = (opts = asA) => api('POST', '/api/onboarding/flows/quick_business_setup/start', opts);
const step = (id, action, opts = asA) => api('POST', `/api/onboarding/steps/${id}/${action}`, opts);
const progressOf = (u = OWNER_A) => dbState.onboarding_progress.find(p => String(p.user_id) === String(u));

// ── Flag ─────────────────────────────────────────────────────────────────────────────────
test('flag OFF: every route is 404 and NO table is touched', async () => {
  process.env[FLAG] = 'false';
  dbTouches.tables = [];
  for (const [m, p] of [['GET', '/api/onboarding/flows'], ['GET', '/api/onboarding/flows/quick_business_setup'],
                        ['GET', '/api/onboarding/progress'], ['POST', '/api/onboarding/flows/quick_business_setup/start'],
                        ['POST', `/api/onboarding/steps/${S1}/view`], ['POST', `/api/onboarding/steps/${S1}/complete`],
                        ['POST', `/api/onboarding/steps/${S1}/skip`], ['POST', '/api/onboarding/flows/quick_business_setup/dismiss'],
                        ['POST', '/api/onboarding/flows/quick_business_setup/reset'],
                        ['GET', '/api/admin/onboarding/flows'], ['GET', '/api/admin/onboarding/progress'],
                        ['GET', '/api/admin/onboarding/events']]) {
    assert.strictEqual((await api(m, p, { token: tok(m.startsWith('GET') && p.includes('admin') ? ADMIN : OWNER_A), business: BIZ_A })).status, 404, `${m} ${p}`);
  }
  assert.deepStrictEqual(dbTouches.tables, [], `DB touched with the flag off: ${dbTouches.tables}`);
});

// ── Locale resolution ────────────────────────────────────────────────────────────────────
test('locale=en returns the English fallback', async () => {
  const r = await api('GET', '/api/onboarding/flows?locale=en', asA);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.locale, 'en');
  assert.strictEqual(r.body.flows[0].title, 'Quick setup');
  assert.strictEqual(r.body.flows[0].description, 'Fast start');
});

test('locale=ru resolves Russian where present', async () => {
  const r = await api('GET', '/api/onboarding/flows?locale=ru', asA);
  assert.strictEqual(r.body.locale, 'ru');
  assert.strictEqual(r.body.flows[0].title, 'Быстрая настройка');
  assert.strictEqual(r.body.flows[0].description, 'Быстрый старт');
});

test('locale=id resolves Indonesian where present and falls back per-field where absent', async () => {
  const r = await api('GET', '/api/onboarding/flows?locale=id', asA);
  assert.strictEqual(r.body.flows[0].title, 'Penyiapan cepat');
  // description_i18n has no `id` key -> English column, not a blank string.
  assert.strictEqual(r.body.flows[0].description, 'Fast start');
});

test('an unsupported locale falls back to English rather than erroring', async () => {
  for (const l of ['fr', 'zh-Hans', 'klingon', '']) {
    const r = await api('GET', `/api/onboarding/flows?locale=${l}`, asA);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.locale, 'en');
    assert.strictEqual(r.body.flows[0].title, 'Quick setup');
  }
});

test('a step with no translation falls back, and instructions resolve per locale', async () => {
  const r = await api('GET', '/api/onboarding/flows/quick_business_setup?locale=ru', asA);
  const s1 = r.body.steps.find(s => s.step_key === 'one');
  const s2 = r.body.steps.find(s => s.step_key === 'two');
  assert.strictEqual(s1.title, 'Шаг один');
  assert.strictEqual(s1.instructions, 'Сделайте');
  assert.strictEqual(s2.title, 'Step two', 'untranslated step should fall back');
  assert.strictEqual(s2.instructions, null, 'no instructions means null, not an empty string');
});

test('user routes never expose raw i18n maps', async () => {
  const r = await api('GET', '/api/onboarding/flows?locale=ru', asA);
  assert.ok(!('title_i18n' in r.body.flows[0]));
  const d = await api('GET', '/api/onboarding/flows/quick_business_setup', asA);
  assert.ok(!('title_i18n' in d.body.steps[0]));
});

test('admin routes MAY expose raw i18n maps for content management', async () => {
  const r = await api('GET', '/api/admin/onboarding/flows', { token: tok(ADMIN) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.flows[0].title_i18n, { ru: 'Быстрая настройка', id: 'Penyiapan cepat' });
  assert.ok('instructions_i18n' in r.body.flows[0].steps[0]);
});

// ── Start / progress ─────────────────────────────────────────────────────────────────────
test('starting a flow creates progress and one step-progress row per step', async () => {
  const r = await start();
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.progress.status, 'in_progress');
  assert.strictEqual(dbState.onboarding_step_progress.length, 3);
  assert.strictEqual(dbState.onboarding_events.filter(e => e.event_type === 'flow_started').length, 1);
});

test('viewing marks viewed but does not advance completion', async () => {
  await start();
  const r = await step(S1, 'view');
  assert.strictEqual(r.body.step_progress.status, 'viewed');
  assert.ok(r.body.step_progress.first_viewed_at);
  assert.strictEqual(Number(r.body.progress.progress_percent), 0);
});

test('completing and skipping recalculate progress_percent', async () => {
  await start();
  assert.strictEqual(Number((await step(S1, 'complete')).body.progress.progress_percent), 33.33);
  assert.strictEqual(Number((await step(S2, 'skip')).body.progress.progress_percent), 66.67);
  const last = await step(S3, 'complete');
  assert.strictEqual(Number(last.body.progress.progress_percent), 100);
  assert.strictEqual(last.body.progress.status, 'completed');
  assert.ok(last.body.progress.completed_at);
});

test('a non-skippable step cannot be skipped', async () => {
  await start();
  const r = await step(S3, 'skip');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'step_not_skippable');
});

test('viewing an already-completed step is a no-op, not a downgrade', async () => {
  await start();
  await step(S1, 'complete');
  const r = await step(S1, 'view');
  assert.strictEqual(r.body.unchanged, true);
  assert.strictEqual(dbState.onboarding_step_progress.find(p => p.step_id === S1).status, 'completed');
});

test('acting on a step without starting the flow is a 404, and creates nothing', async () => {
  const r = await step(S1, 'complete');
  assert.strictEqual(r.status, 404);
  assert.strictEqual(dbState.onboarding_progress.length, 0);
  assert.strictEqual(dbState.onboarding_step_progress.length, 0);
});

// ── Dismiss / reset ──────────────────────────────────────────────────────────────────────
test('dismiss records the decision and keeps history', async () => {
  await start();
  await step(S1, 'complete');
  const r = await api('POST', '/api/onboarding/flows/quick_business_setup/dismiss', asA);
  assert.strictEqual(r.body.progress.status, 'dismissed');
  assert.ok(r.body.progress.dismissed_at);
  assert.strictEqual(dbState.onboarding_step_progress.filter(p => p.status === 'completed').length, 1,
    'dismiss destroyed step history');
});

test('dismissing a flow never started still records the decision', async () => {
  const r = await api('POST', '/api/onboarding/flows/quick_business_setup/dismiss', asA);
  assert.strictEqual(r.body.progress.status, 'dismissed');
});

test('a dismissed flow is not revived by completing a step inside it', async () => {
  await start();
  await api('POST', '/api/onboarding/flows/quick_business_setup/dismiss', asA);
  await step(S1, 'complete');
  assert.strictEqual(progressOf().status, 'dismissed');
});

test('reset clears step progress but keeps the event history', async () => {
  await start();
  await step(S1, 'complete');
  await step(S2, 'skip');
  const before = dbState.onboarding_events.length;
  const r = await api('POST', '/api/onboarding/flows/quick_business_setup/reset', asA);
  assert.strictEqual(Number(r.body.progress.progress_percent), 0);
  assert.strictEqual(r.body.progress.status, 'in_progress');
  assert.ok(dbState.onboarding_step_progress.every(p => p.status === 'not_started'));
  assert.ok(dbState.onboarding_events.length > before, 'reset deleted analytics history');
});

test('resetting a flow that was never started is a 404', async () => {
  assert.strictEqual((await api('POST', '/api/onboarding/flows/quick_business_setup/reset', asA)).status, 404);
});

// ── No provisioning ──────────────────────────────────────────────────────────────────────
test('onboarding NEVER creates a business or starts a trial', async () => {
  // LONER is a positive id with no membership - the exact case where ensureDefaultBusiness
  // would bootstrap a workspace with a 7-day trial.
  const before = dbState.businesses.length;
  const r = await start({ token: tok(LONER) });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.progress.business_id, null);
  assert.strictEqual(dbState.businesses.length, before, 'onboarding provisioned a business');
  assert.strictEqual(dbState.business_members.filter(m => m.user_id === LONER).length, 0);
});

test('a user with no business gets their own progress scope', async () => {
  await start({ token: tok(LONER) });
  const r = await api('GET', '/api/onboarding/progress', { token: tok(LONER) });
  assert.strictEqual(r.body.business_id, null);
  assert.strictEqual(r.body.progress.length, 1);
});

// ── Cross-user isolation ─────────────────────────────────────────────────────────────────
test('one user cannot see or touch another user progress', async () => {
  await start();                                   // OWNER_A starts
  await step(S1, 'complete');

  const bList = await api('GET', '/api/onboarding/progress', { token: tok(OWNER_B), business: BIZ_B });
  assert.strictEqual(bList.body.progress.length, 0, "another user's progress was visible");

  // OWNER_B acting on the same step id has no progress row of their own -> 404, and A's
  // record is untouched.
  assert.strictEqual((await step(S1, 'skip', { token: tok(OWNER_B), business: BIZ_B })).status, 404);
  assert.strictEqual(dbState.onboarding_step_progress.find(p => p.step_id === S1).status, 'completed');
});

test('a flow detail response only ever carries the caller own progress', async () => {
  await start();
  await step(S1, 'complete');
  const r = await api('GET', '/api/onboarding/flows/quick_business_setup', { token: tok(OWNER_B), business: BIZ_B });
  assert.strictEqual(r.body.progress, null);
  assert.ok(r.body.steps.every(s => s.progress.status === 'not_started'));
});

// ── Admin ────────────────────────────────────────────────────────────────────────────────
test('admin sees aggregate progress and events', async () => {
  await start();
  await step(S1, 'complete');
  const p = await api('GET', '/api/admin/onboarding/progress', { token: tok(ADMIN) });
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.body.summary.quick_business_setup.started, 1);
  assert.strictEqual(p.body.progress[0].flow_key, 'quick_business_setup');

  const e = await api('GET', '/api/admin/onboarding/events', { token: tok(ADMIN) });
  assert.ok(e.body.events.some(x => x.event_type === 'step_completed'));
});

test('a non-admin cannot reach any admin onboarding route', async () => {
  for (const p of ['/api/admin/onboarding/flows', '/api/admin/onboarding/progress', '/api/admin/onboarding/events']) {
    const r = await api('GET', p, asA);
    assert.ok([401, 403].includes(r.status), `${p} gave ${r.status}`);
  }
});

// ── Financial safety ─────────────────────────────────────────────────────────────────────
test('THE core guarantee: onboarding mutates nothing financial and opens no support thread', async () => {
  await start();
  await step(S1, 'view');
  await step(S1, 'complete');
  await step(S2, 'skip');
  await api('POST', '/api/onboarding/flows/quick_business_setup/dismiss', asA);
  await api('POST', '/api/onboarding/flows/quick_business_setup/reset', asA);

  for (const t of ['transactions', 'wallets', 'debts', 'incoming_payments',
                   'payment_provider_credentials', 'payment_provider_connections',
                   'support_conversations']) {
    assert.strictEqual(dbState[t].length, 0, `onboarding mutated ${t}`);
  }
});
