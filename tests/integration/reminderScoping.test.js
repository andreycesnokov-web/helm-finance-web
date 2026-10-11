// POST /api/reminders — business scoping contract.
//
// Boots the REAL server/index.js (real Express routes, real `auth` middleware, real
// requireBusiness -> resolveActiveBusiness, real buildReminderRow) over the in-memory
// supabase shim, then drives real HTTP. No database is touched.
//
// THE BUG THIS LOCKS DOWN
// The route used to insert `{ ...req.body, user_id }`, so business_id came straight
// from the client. Two consequences, both covered below: a caller could target any
// business, and the web form — which sends no business_id — produced rows with
// business_id NULL that GET /api/pulse can never return, because it filters strictly
// on business_id.
//
// Run: node tests/integration/reminderScoping.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');

process.env.SUPABASE_URL = 'http://localhost:0/fake';
process.env.SUPABASE_SECRET_KEY = 'fake';
process.env.BOT_TOKEN = 'fake';
process.env.JWT_SECRET = 'reminder-scope-test-secret';
process.env.TELEGRAM_WEBHOOK_SECRET = 'fake';
process.env.PORT = '5601';
process.env.NODE_ENV = 'test';

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

// ── fixture ──────────────────────────────────────────────────────────────────
// BIZ_A / BIZ_B: OWNER belongs to A only. OTHER owns B.
// PERSONAL: a type='personal' workspace OWNER belongs to.
// LONER: an email-first user with no business at all.
const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const PERSONAL = '33333333-3333-4333-8333-333333333333';
const OWNER = 900101, OTHER = 900102, MANAGER = 900103, LONER = -900104;

mem.__seed('businesses', [
  { id: BIZ_A, name: 'A', type: 'company', owner_user_id: OWNER, created_at: '2026-01-01' },
  { id: BIZ_B, name: 'B', type: 'company', owner_user_id: OTHER, created_at: '2026-01-02' },
  { id: PERSONAL, name: 'Personal', type: 'personal', owner_user_id: OWNER, created_at: '2026-01-03' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: OWNER, business_id: BIZ_A, role: 'owner', status: 'active' },
  { id: 2, user_id: OTHER, business_id: BIZ_B, role: 'owner', status: 'active' },
  { id: 3, user_id: OWNER, business_id: PERSONAL, role: 'owner', status: 'active' },
  { id: 4, user_id: MANAGER, business_id: BIZ_A, role: 'manager', status: 'active' },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

async function post(pathname, { user, biz, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user !== undefined) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + pathname, {
    method: 'POST', headers, body: JSON.stringify(body === undefined ? {} : body),
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}
const reminders = () => mem.__db.reminders || [];

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));   // let app.listen bind

  console.log('\nBusiness reminders');

  await t('1. owner can create a reminder in the active business', async () => {
    const r = await post('/reminders', { user: OWNER, biz: BIZ_A, body: { title: 'Owner reminder', due_date: '2026-10-10' } });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.business_id, BIZ_A);
    assert.strictEqual(r.body.user_id, OWNER);
  });

  await t('1b. a non-owner member can create one too, attributed to the ACTOR', async () => {
    const r = await post('/reminders', { user: MANAGER, biz: BIZ_A, body: { title: 'Manager reminder' } });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.business_id, BIZ_A);
    // Not the business owner: PATCH /done and /snooze filter by user_id, so stamping
    // the owner here would leave the manager unable to complete their own reminder.
    assert.strictEqual(r.body.user_id, MANAGER);
  });

  await t('2. a business_id in the BODY is overwritten by the active workspace', async () => {
    const r = await post('/reminders', {
      user: OWNER, biz: BIZ_A,
      body: { title: 'Spoof attempt', business_id: BIZ_B, user_id: OTHER },
    });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.business_id, BIZ_A, 'body business_id must not win');
    assert.strictEqual(r.body.user_id, OWNER, 'body user_id must not win');
    assert.ok(!reminders().some((x) => x.business_id === BIZ_B), 'nothing may land in B');
  });

  await t('3. cannot create a reminder in an inaccessible business', async () => {
    const before = reminders().length;
    const r = await post('/reminders', { user: OWNER, biz: BIZ_B, body: { title: 'Into B' } });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'workspace_not_accessible');
    assert.strictEqual(reminders().length, before, 'no row may be written');
  });

  await t('3b. body business_id alone cannot reach another business either', async () => {
    // resolveActiveBusiness also reads req.body.business_id, so this must be refused
    // by the membership check rather than silently honoured.
    const before = reminders().length;
    const r = await post('/reminders', { user: OWNER, body: { title: 'Body-only B', business_id: BIZ_B } });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(reminders().length, before);
  });

  await t('4. Tax Split deadline lands in the active business only', async () => {
    // Exactly the payload client/src/pages/business/TaxSplit.jsx sends.
    const r = await post('/reminders', {
      user: OWNER, biz: BIZ_A,
      body: { title: 'Suggested: remit PPh Final Pasal 4(2) for INV-001 — confirm date with accountant', due_date: '2026-10-10' },
    });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.business_id, BIZ_A);
    assert.ok(/PPh Final/.test(r.body.title));
  });

  console.log('\nPersonal / no-business context');

  await t('5. the Add.jsx payload still works and is no longer orphaned', async () => {
    // client/src/pages/Add.jsx sends exactly {title, due_date, meta} and NO business_id.
    const r = await post('/reminders', {
      user: OWNER, biz: BIZ_A,
      body: { title: 'From /add', due_date: '2026-11-01', meta: 'note' },
    });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.meta, 'note', 'unrelated fields must still be written');
    assert.strictEqual(r.body.business_id, BIZ_A,
      'previously this row got business_id NULL and was invisible in GET /api/pulse');
  });

  await t('6. the caller needs no knowledge of business_id — the server resolves it', async () => {
    // No x-business-id header and no business_id in the body: exactly what the web form
    // sends when the Personal workspace is active (getActiveBusinessId() returns null).
    const r = await post('/reminders', { user: OWNER, body: { title: 'No scope supplied' } });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.business_id, BIZ_A, 'falls back to the default business workspace');
  });

  await t('7. a personal workspace can never become a company reminder', async () => {
    const before = reminders().length;
    const r = await post('/reminders', { user: OWNER, biz: PERSONAL, body: { title: 'Personal' } });
    assert.strictEqual(r.status, 403, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'business_workspace_required');
    assert.strictEqual(reminders().length, before);
    assert.ok(!reminders().some((x) => x.business_id === PERSONAL));
  });

  await t('7b. a user with no business gets a clean 409, not an invisible row', async () => {
    const before = reminders().length;
    const r = await post('/reminders', { user: LONER, body: { title: 'Homeless' } });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'no_business');
    assert.strictEqual(reminders().length, before,
      'better a loud 409 than a row no UI can ever show');
  });

  console.log('\nRegression');

  await t('8. unauthenticated request is still rejected', async () => {
    const r = await post('/reminders', { body: { title: 'anon' } });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  await t('9. every reminder written is scoped to Business A', async () => {
    assert.ok(reminders().length >= 5, `only ${reminders().length} rows`);
    assert.ok(reminders().every((x) => x.business_id === BIZ_A),
      'a row escaped the active business');
    assert.ok(reminders().every((x) => x.user_id === OWNER || x.user_id === MANAGER));
  });

  await t('10. the pulse read filter would now return these rows', async () => {
    // GET /api/pulse reads reminders with `.or(business_id.eq.<active>).eq('is_done', false)`.
    // Before the fix these rows had business_id NULL and could never match the first
    // predicate — that is the bug this asserts against.
    //
    // Only the business_id predicate is checked here: the shim applies no column
    // DEFAULTs, so a row inserted without is_done leaves it undefined, whereas the real
    // table declares `is_done BOOLEAN DEFAULT FALSE` (migration_v3.sql) and supplies it.
    // Asserting is_done here would test the shim, not the code.
    const { data } = await mem.createClient().from('reminders').select('*').or(`business_id.eq.${BIZ_A}`);
    assert.strictEqual(data.length, reminders().length, 'all rows must be visible to pulse');
  });

  await t('10b. reminders.scope is left untouched — it is not the personal/business switch', async () => {
    // `reminders.scope TEXT DEFAULT 'personal'` exists but nothing reads it: the pulse
    // query filters on business_id only. The personal-workspace pattern documented at
    // server/index.js ("business_id = personal_workspace_id AND scope='personal'") covers
    // wallets/transactions/cashflow_categories, NOT reminders. The route must therefore
    // not start writing scope, which would invent a meaning the readers do not honour.
    assert.ok(reminders().every((x) => x.scope === undefined),
      'the route must not set scope; the column default owns it');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);

  // Let the process end on its own instead of process.exit(): calling exit() while the
  // Express server still holds a listening handle trips a libuv assertion on Windows
  // that overwrites the exit code (a green run reported 127). Unreference every handle
  // and the event loop drains cleanly, preserving the real result for CI.
  process.exitCode = fail === 0 ? 0 : 1;
  for (const handle of process._getActiveHandles()) {
    try { handle.unref?.(); } catch { /* not all handles are unref-able */ }
  }
})();
