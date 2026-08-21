// PR2.5 follow-up — route-level HTTP mapping of actor failures.
//
// Codex found the gap this file exists to close: server/lib/telegramActor.js computed
// 400/403/503 carefully, and then four debt routes threw it away with
//
//     if (r.error) return res.status(403).json({ error: 'forbidden' });
//
// so a transient identity-lookup failure (503, "try again in a moment") reached the bot as a
// flat "you do not have access to this request". That is the exact collapse the status mapping
// was written to prevent: it tells a correctly-linked user their account is not connected,
// on nothing more than a Supabase blip.
//
// The existing wiring tests asserted the HELPER's mapping. They could not have caught this,
// because the helper was right — the routes discarded its answer. So these tests speak HTTP:
// the real Express app, the real route handlers, real status codes off the wire.
//
// HOW THE REAL SERVER RUNS HERE
// -----------------------------
// server/index.js requires @supabase/supabase-js at import and listens on import. Both are
// handled without touching production code: the module is replaced in require.cache before
// the server is loaded, and the listening socket is captured by wrapping Server#listen. The
// route handlers themselves are the genuine article — nothing about them is reimplemented,
// which is the whole point after a bug that lived in a route rather than in a library.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const FLAG = 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED';
const SECRET = 'test-bot-secret';
const TG_USER = 1057134807;     // positive: Telegram-origin (legacy conflation)
const EMAIL_USER = -42;         // negative: email-origin (042)
const DEBT_ID = 4242;
const BUSINESS_ID = '11111111-1111-1111-1111-111111111111';

// ── the fake Supabase ───────────────────────────────────────────────────────
// Only the query shapes these routes actually use. `scenario` is rewritten per test, so one
// server serves every case. Writes are recorded rather than performed: an actor failure must
// reach the client having touched nothing, and the only way to prove that is to count.
const scenario = { rows: {}, failTables: new Set() };
const writes = [];

function resetScenario() {
  scenario.rows = {
    debts: [{
      id: DEBT_ID, business_id: BUSINESS_ID, user_id: TG_USER, created_by_user_id: TG_USER,
      approval_status: 'pending_approval', status: 'unpaid', type: 'payable',
      counterparty: 'Acme', amount: 1000, original_amount: 1000,
    }],
    users: [{ id: TG_USER }],
    user_channel_links: [],
    business_members: [],
    businesses: [{ id: BUSINESS_ID, owner_user_id: TG_USER, name: 'Acme', type: 'business' }],
  };
  scenario.failTables = new Set();
  writes.length = 0;
}

function match(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'is') return val === null ? (v === null || v === undefined) : v === val;
    if (op === 'neq') return String(v) !== String(val);
    return true;
  });
}

function fakeFrom(table) {
  const filters = [];
  let limit = null, op = 'select';
  const q = {
    select() { return q; },
    eq(c, v) { filters.push(['eq', c, v]); return q; },
    is(c, v) { filters.push(['is', c, v]); return q; },
    neq(c, v) { filters.push(['neq', c, v]); return q; },
    not() { return q; },
    or() { return q; },
    order() { return q; },
    limit(n) { limit = n; return q; },
    single() { q._single = true; return q; },
    maybeSingle() { q._single = true; return q; },
    insert(values) { op = 'insert'; writes.push({ table, op, values }); return q; },
    update(values) { op = 'update'; writes.push({ table, op, values }); return q; },
    upsert(values) { op = 'upsert'; writes.push({ table, op, values }); return q; },
    delete() { op = 'delete'; writes.push({ table, op }); return q; },
    then(resolve, reject) {
      let out;
      if (scenario.failTables.has(table)) {
        out = { data: null, error: { message: `simulated ${table} failure` } };
      } else if (op !== 'select') {
        out = { data: q._single ? {} : [], error: null };
      } else {
        let rows = (scenario.rows[table] || []).filter((r) => match(r, filters));
        if (limit) rows = rows.slice(0, limit);
        out = q._single ? { data: rows[0] || null, error: null } : { data: rows, error: null };
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return q;
}

const fakeClient = {
  from: fakeFrom,
  rpc: () => Promise.resolve({ data: null, error: null }),
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  auth: {},
};

// ── boot the real server ────────────────────────────────────────────────────
let server = null;
let BASE = null;

before(async () => {
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true, exports: { ...real, createClient: () => fakeClient },
  };

  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake',
    SUPABASE_SECRET_KEY: 'fake-key',
    BOT_TOKEN: 'fake-bot-token',
    JWT_SECRET: 'fake-jwt-secret',
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    PORT: '0',                          // ephemeral: never collides with a real dev server
  });
  delete process.env[FLAG];
  delete process.env.TELEGRAM_ACTIVE_BUSINESS_ENABLED;   // from-receipt must take the fallback

  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...args) {
    server = this;
    return realListen.apply(this, args);
  };
  try {
    require('../../server/index.js');
  } finally {
    http.Server.prototype.listen = realListen;
  }

  assert.ok(server, 'the server never called listen()');
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => { if (server) server.close(); });

async function post(path, body, { secret = SECRET } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-bot-secret'] = secret;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: json };
}

// A link row as the resolver reads it: it filters on channel + external_user_id, so a row
// missing those columns is a row that silently does not exist.
const link = (userId, revokedAt) => ({
  channel: 'telegram', external_user_id: String(TG_USER), user_id: userId, revoked_at: revokedAt,
});

// The four states a route must keep distinct, and how each is produced.
const UNLINKED = () => { scenario.rows.users = []; };                       // no link, no legacy row
const REVOKED = () => {
  scenario.rows.users = [];
  scenario.rows.user_channel_links = [link(EMAIL_USER, '2026-01-01T00:00:00Z')];
};
const LOOKUP_ERROR = () => { scenario.failTables.add('user_channel_links'); };
const LINKED = () => {
  scenario.rows.user_channel_links = [link(EMAIL_USER, null)];
  scenario.rows.business_members = [{ user_id: EMAIL_USER, business_id: BUSINESS_ID, role: 'owner', status: 'active' }];
};

const DEBT_ROUTES = [
  `/api/telegram/debts/${DEBT_ID}/approve`,
  `/api/telegram/debts/${DEBT_ID}/reject`,
  `/api/telegram/debts/${DEBT_ID}/request-info`,
  `/api/telegram/debts/${DEBT_ID}/decision`,
];

// ════════════════════════════════════════════════════════════════════════════
// The Codex finding: the four debt routes, over HTTP
// ════════════════════════════════════════════════════════════════════════════

test('debt actions: a lookup failure is 503, NOT 403', async () => {
  // The regression itself. 403 says "we know who you are and you may not do this"; 503 says
  // "we could not find out". A bot that sees 403 tells the user to reconnect an account that
  // was never disconnected.
  for (const path of DEBT_ROUTES) {
    resetScenario(); LOOKUP_ERROR();
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: TG_USER });
    assert.strictEqual(r.status, 503, `${path}: expected 503, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'temporary_identity_lookup_failed', `${path}: wrong code`);
    assert.notStrictEqual(r.body?.error, 'forbidden', `${path}: collapsed into forbidden`);
  }
});

test('debt actions: an invalid telegram id is 400, NOT 403', async () => {
  for (const path of DEBT_ROUTES) {
    resetScenario();
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: 'not-a-telegram-id' });
    assert.strictEqual(r.status, 400, `${path}: expected 400, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'invalid_telegram_id', `${path}: wrong code`);
  }
});

test('debt actions: a revoked link is 403 link_revoked, distinct from forbidden', async () => {
  for (const path of DEBT_ROUTES) {
    resetScenario(); REVOKED();
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: TG_USER });
    assert.strictEqual(r.status, 403, `${path}: expected 403, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'link_revoked', `${path}: a revoked link must be nameable`);
  }
});

test('debt actions: an unlinked account is 403 not_linked, distinct from forbidden', async () => {
  // Same status code as link_revoked, deliberately — both mean "no usable identity" — but a
  // different code, because one is "connect your account" and the other is "your connection
  // was withdrawn". A bot cannot write the right message from the status alone.
  for (const path of DEBT_ROUTES) {
    resetScenario(); UNLINKED();
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: TG_USER });
    assert.strictEqual(r.status, 403, `${path}: expected 403, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'not_linked', `${path}: wrong code`);
  }
});

test('debt actions: a real membership refusal is still a plain 403 forbidden', async () => {
  // The other half of the fix: identity mapping must not swallow business-logic refusals.
  // The user resolves fine and simply is not a member of the debt's business.
  for (const path of DEBT_ROUTES) {
    resetScenario();
    scenario.rows.business_members = [];      // resolves (legacy row exists), no membership
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: TG_USER });
    assert.strictEqual(r.status, 403, `${path}: expected 403, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'forbidden', `${path}: a membership refusal must stay 'forbidden'`);
  }
});

test('debt actions: a missing debt is still 404, ahead of any identity work', async () => {
  for (const path of DEBT_ROUTES) {
    resetScenario();
    scenario.rows.debts = [];
    process.env[FLAG] = 'true';
    const r = await post(path, { telegram_id: TG_USER });
    assert.strictEqual(r.status, 404, `${path}: expected 404, got ${r.status}`);
    assert.strictEqual(r.body?.error, 'not_found');
  }
});

test('debt actions: no bot secret is 401, before any identity state is revealed', async () => {
  // Authentication first, always. An unauthenticated caller must not be able to use these
  // routes as an oracle for "is this Telegram id linked / revoked / unknown".
  for (const path of DEBT_ROUTES) {
    for (const secret of [null, 'wrong-secret']) {
      resetScenario(); REVOKED();
      process.env[FLAG] = 'true';
      const r = await post(path, { telegram_id: TG_USER }, { secret });
      assert.strictEqual(r.status, 401, `${path}: expected 401, got ${r.status}`);
      assert.ok(!['link_revoked', 'not_linked', 'invalid_telegram_id', 'temporary_identity_lookup_failed']
        .includes(r.body?.error), `${path}: leaked identity state to an unauthenticated caller`);
    }
  }
});

test('debt actions: an actor failure writes nothing', async () => {
  // A 503 that had already flipped approval_status would be worse than the wrong status code.
  for (const path of DEBT_ROUTES) {
    for (const setup of [LOOKUP_ERROR, UNLINKED, REVOKED]) {
      resetScenario(); setup();
      process.env[FLAG] = 'true';
      await post(path, { telegram_id: TG_USER });
      assert.deepStrictEqual(writes, [], `${path}: wrote ${JSON.stringify(writes)} on an actor failure`);
    }
  }
});

test('debt actions: the error body carries no reason, id or metadata', async () => {
  resetScenario(); LOOKUP_ERROR();
  process.env[FLAG] = 'true';
  const r = await post(DEBT_ROUTES[0], { telegram_id: TG_USER });
  assert.deepStrictEqual(Object.keys(r.body).sort(), ['error', 'message'],
    'the failure body must be exactly { error, message }');
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(String(TG_USER)), 'the telegram id must not be echoed back');
  assert.ok(!/link_lookup_failed|user_lookup_failed|exception|user_channel_links|supabase/i.test(text),
    'the internal reason must not leak');
});

// ════════════════════════════════════════════════════════════════════════════
// The second collapse site: from-receipt's resolveTelegramMember fallback
// ════════════════════════════════════════════════════════════════════════════

const FROM_RECEIPT = '/api/telegram/debts/from-receipt';

test('from-receipt: the member fallback preserves 503 / 400 / 403 mapping', async () => {
  const cases = [
    [LOOKUP_ERROR, 503, 'temporary_identity_lookup_failed', TG_USER],
    [UNLINKED, 403, 'not_linked', TG_USER],
    [REVOKED, 403, 'link_revoked', TG_USER],
    [() => {}, 400, 'invalid_telegram_id', 'not-a-telegram-id'],
  ];
  for (const [setup, status, code, id] of cases) {
    resetScenario(); setup();
    process.env[FLAG] = 'true';
    const r = await post(FROM_RECEIPT, { telegram_id: id, file_id: 'f1', kind: 'payable' });
    assert.strictEqual(r.status, status, `${code}: expected ${status}, got ${r.status}`);
    assert.strictEqual(r.body?.error, code);
  }
});

test('from-receipt: multiple_businesses is still 409, not an identity error', async () => {
  resetScenario();
  scenario.rows.business_members = [
    { user_id: TG_USER, business_id: BUSINESS_ID, role: 'owner', status: 'active' },
    { user_id: TG_USER, business_id: '22222222-2222-2222-2222-222222222222', role: 'owner', status: 'active' },
  ];
  process.env[FLAG] = 'true';
  const r = await post(FROM_RECEIPT, { telegram_id: TG_USER, file_id: 'f1', kind: 'payable' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body?.error, 'multiple_businesses');
});

// ════════════════════════════════════════════════════════════════════════════
// Flag OFF — the mapping change must be invisible in production today
// ════════════════════════════════════════════════════════════════════════════

test('OFF: identity never fails, so the routes behave exactly as before', async () => {
  // With the flag off the actor helper returns legacy unconditionally: no lookup, no failure
  // path, nothing for the new mapping to do. Even the scenario that produces 503 with the flag
  // on must produce the ordinary business answer here — that is what "default off" means.
  for (const path of [...DEBT_ROUTES, FROM_RECEIPT]) {
    resetScenario(); LOOKUP_ERROR();
    process.env[FLAG] = 'false';
    const r = await post(path, { telegram_id: TG_USER, file_id: 'f1', kind: 'payable' });
    assert.notStrictEqual(r.status, 503, `${path}: the OFF path must never 503 on identity`);
    assert.ok(!['temporary_identity_lookup_failed', 'not_linked', 'link_revoked', 'invalid_telegram_id']
      .includes(r.body?.error), `${path}: OFF produced an identity error: ${r.body?.error}`);
  }
});

test('OFF: a malformed telegram id still falls through, it is not newly rejected', async () => {
  // The OFF path adds no validation. A malformed id reaches the same failed lookup it always
  // did — 403, not the new 400. Turning OFF into a stricter path would make the flag unsafe
  // to leave off, which is backwards.
  resetScenario();
  scenario.rows.users = [];
  process.env[FLAG] = 'false';
  const r = await post(DEBT_ROUTES[0], { telegram_id: 'not-a-telegram-id' });
  assert.notStrictEqual(r.status, 400, 'OFF must not start rejecting ids the old code accepted');
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body?.error, 'forbidden');
});

// ════════════════════════════════════════════════════════════════════════════
// ON + resolvable — the routes still work
// ════════════════════════════════════════════════════════════════════════════

test('ON: a linked user is not blocked by identity at all', async () => {
  // The mapping must not turn into a wall. A user with an active link and a membership gets
  // past identity — whatever the route then decides on its own merits.
  resetScenario(); LINKED();
  process.env[FLAG] = 'true';
  const r = await post(DEBT_ROUTES[0], { telegram_id: TG_USER });
  assert.ok(![400, 401, 503].includes(r.status), `identity blocked a linked user: ${r.status}`);
  assert.ok(!['temporary_identity_lookup_failed', 'not_linked', 'link_revoked', 'invalid_telegram_id']
    .includes(r.body?.error), `identity error for a linked user: ${r.body?.error}`);
});

// ════════════════════════════════════════════════════════════════════════════
// The helper's own fallback
// ════════════════════════════════════════════════════════════════════════════

test('an actor failure with NO prepared status falls back to 503, never 403', () => {
  // Unreachable through the routes today — every failure the helper produces carries an
  // httpStatus — so no route-level test can reach it, and mutation testing found it
  // unguarded. It is pinned here because the direction of the default is the whole design:
  // 403 asserts a fact about the user ("you may not"), and a code path that reached this
  // line is by definition one where we do not have that fact. 503 says so honestly.
  const { sendTelegramActorError } = require('../../server/lib/telegramActor');
  const sent = {};
  const res = {
    status(code) { sent.code = code; return res; },
    json(body) { sent.body = body; return res; },
  };
  sendTelegramActorError(res, { ok: false, status: 'error', code: 'identity_unavailable' });
  assert.strictEqual(sent.code, 503, 'a statusless failure must not be reported as forbidden');
  assert.deepStrictEqual(Object.keys(sent.body).sort(), ['error', 'message']);
});

test('a prepared status always wins over the fallback', () => {
  const { sendTelegramActorError } = require('../../server/lib/telegramActor');
  for (const [httpStatus, code] of [[400, 'invalid_telegram_id'], [403, 'not_linked'],
                                    [403, 'link_revoked'], [503, 'temporary_identity_lookup_failed']]) {
    const sent = {};
    const res = { status(c) { sent.code = c; return res; }, json(b) { sent.body = b; return res; } };
    sendTelegramActorError(res, { ok: false, httpStatus, code, safeMessage: 'x' });
    assert.strictEqual(sent.code, httpStatus, `${code} must keep its own status`);
    assert.strictEqual(sent.body.error, code);
  }
});
