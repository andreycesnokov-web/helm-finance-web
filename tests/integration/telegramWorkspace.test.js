// PR3 — the active workspace: which company a Telegram message posts to.
//
// Three properties dominate this file, and everything else is supporting detail:
//
//   1. DEFAULT OFF IS TODAY. With both flags off the resolver reads and writes
//      telegram_user_state for a positive id and never touches user_channel_state. Production
//      has one live 043 row; if this file cannot prove that row keeps working, PR3 is not
//      shippable.
//
//   2. A FAILED LOOKUP IS NOT AN ANSWER. The code this replaces discarded every Supabase
//      error, so a failed membership query returned { status:'none' } — which the bot
//      classifies as "not connected" and answers with the onboarding message. A database blip
//      told a linked user to re-connect an account they had already connected. Every error
//      path below asserts 503, and asserts specifically that it is NOT 'none' or 'choose'.
//
//   3. AN ARCHIVED WORKSPACE IS NOT A WORKSPACE. Archiving sets businesses.status='archived'
//      and deliberately leaves memberships active so it can be undone. Every member-facing
//      query filters memberships only, so an archived company stayed selectable and postable.
//
// The routes are exercised over real HTTP against the real Express app (same in-process
// harness as telegramActorRouteMapping.test.js): @supabase/supabase-js is replaced in
// require.cache before the server loads, and the listening socket is captured by wrapping
// Server#listen. Nothing in production code was changed to make this testable.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const W = require('../../server/lib/telegramWorkspace');

const RESOLVER_FLAG = 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED';
const STATE_FLAG = 'TELEGRAM_ACTIVE_WORKSPACE_STATE_ENABLED';
const SECRET = 'test-bot-secret';
const TG_USER = 1057134807;      // positive: Telegram-origin (legacy conflation)
const EMAIL_USER = -42;          // negative: email-origin (042). Can never equal a Telegram id.
const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const ARCHIVED = '33333333-3333-3333-3333-333333333333';
const PERSONAL = '44444444-4444-4444-4444-444444444444';
const GONE = '55555555-5555-5555-5555-555555555555';   // a valid uuid nobody is a member of

// ── fake Supabase ───────────────────────────────────────────────────────────
// Writes are recorded, never applied: "which table did this touch, with what" is the whole
// question for the state-migration matrix, and counting is the only way to answer it.
const scenario = { rows: {}, failTables: new Set(), failWrites: new Set() };
const writes = [];

const biz = (id, name, type = 'business', status = 'active') =>
  ({ id, name, business_code: name.toUpperCase(), type, status, owner_user_id: TG_USER });
const member = (userId, business) =>
  ({ user_id: userId, business_id: business.id, status: 'active', role: 'owner', businesses: business });

function reset(userId = TG_USER, businesses = [biz(BIZ_A, 'acme')]) {
  scenario.rows = {
    business_members: businesses.map((b) => member(userId, b)),
    users: [{ id: userId, username: 'u', first_name: 'U' }],
    user_channel_links: [],
    user_channel_state: [],
    telegram_user_state: [],
    businesses: businesses.slice(),
    debts: [],
  };
  scenario.failTables = new Set();
  scenario.failWrites = new Set();
  writes.length = 0;
}

const linkRow = (userId) =>
  ({ channel: 'telegram', external_user_id: String(TG_USER), user_id: userId, revoked_at: null });

function match(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'is') return val === null ? (v === null || v === undefined) : v === val;
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
    neq() { return q; }, not() { return q; }, or() { return q; }, order() { return q; },
    limit(n) { limit = n; return q; },
    single() { q._single = true; return q; },
    maybeSingle() { q._single = true; return q; },
    insert(values) { op = 'insert'; writes.push({ table, op, values }); return q; },
    update(values) { op = 'update'; writes.push({ table, op, values }); return q; },
    upsert(values) { op = 'upsert'; writes.push({ table, op, values }); return q; },
    delete() { op = 'delete'; writes.push({ table, op }); return q; },
    then(resolve, reject) {
      let out;
      if (scenario.failTables.has(table) || (op !== 'select' && scenario.failWrites.has(table))) {
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
const supabase = { from: fakeFrom, rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({}) }, auth: {} };

// ── flags ───────────────────────────────────────────────────────────────────
const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
async function withFlags(resolver, state, fn) {
  const r0 = process.env[RESOLVER_FLAG], s0 = process.env[STATE_FLAG];
  set(RESOLVER_FLAG, resolver); set(STATE_FLAG, state);
  try { return await fn(); } finally { set(RESOLVER_FLAG, r0); set(STATE_FLAG, s0); }
}
const LEGACY = (fn) => withFlags(undefined, undefined, fn);      // both off — production today
const IDENTITY_ONLY = (fn) => withFlags('true', undefined, fn);  // resolver on, state on 043
const FULL = (fn) => withFlags('true', 'true', fn);              // both on

const resolve = (telegram_id) => W.resolveTelegramActiveWorkspace({ supabase, telegram_id, routeName: 'test' });
const select = (telegram_id, business_id) => W.setTelegramActiveWorkspace({ supabase, telegram_id, business_id, routeName: 'test' });
const wrote = (table) => writes.filter((w) => w.table === table);

// ── the real server ─────────────────────────────────────────────────────────
let server = null, BASE = null;

before(async () => {
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true, exports: { ...real, createClient: () => supabase },
  };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET: 'j', TELEGRAM_WEBHOOK_SECRET: SECRET, PORT: '0',
    TELEGRAM_ACTIVE_BUSINESS_ENABLED: 'true',   // captured at import: the routes must exist
  });
  delete process.env[RESOLVER_FLAG];
  delete process.env[STATE_FLAG];

  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;

  // from-receipt reaches fetchTelegramFile after the identity/workspace decisions. Dropping the
  // token makes it return null without a network call, so the route terminates deterministically
  // at 'amount_not_recognized' — past everything this file is testing.
  delete process.env.BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
});
after(() => { if (server) server.close(); });

async function api(method, path, { body, secret = SECRET } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-bot-secret'] = secret;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}
const getWs = (id) => api('GET', `/api/telegram/active-business?telegram_id=${id}`);
const setWs = (telegram_id, business_id) => api('POST', '/api/telegram/active-business', { body: { telegram_id, business_id } });
const receipt = (telegram_id) => api('POST', '/api/telegram/debts/from-receipt',
  { body: { telegram_id, file_id: 'f1', kind: 'payable' } });

// ════════════════════════════════════════════════════════════════════════════
// FLAGS
// ════════════════════════════════════════════════════════════════════════════

test('both flags default OFF', async () => {
  await withFlags(undefined, undefined, () => {
    assert.strictEqual(W.isResolverEnabled(), false);
    assert.strictEqual(W.isWorkspaceStateEnabled(), false);
  });
});

test('the state flag is IGNORED unless the resolver flag is also on', async () => {
  // The dangerous combination. user_channel_state keyed by an unresolved raw Telegram id would
  // hold rows meaning something different from every other row in the table, and PR4 would
  // have to tell them apart. Failing towards "keep using 043" is failing towards today.
  await withFlags(undefined, 'true', () => {
    assert.strictEqual(W.isWorkspaceStateEnabled(), false, 'state must not activate alone');
  });
  await withFlags('false', 'true', () => assert.strictEqual(W.isWorkspaceStateEnabled(), false));
  await FULL(() => assert.strictEqual(W.isWorkspaceStateEnabled(), true));
});

test('the flags are read per call, not captured at import', async () => {
  await LEGACY(() => assert.strictEqual(W.isResolverEnabled(), false));
  await FULL(() => assert.strictEqual(W.isResolverEnabled(), true));
  await LEGACY(() => assert.strictEqual(W.isResolverEnabled(), false));
});

test('only the exact string "true" enables either flag', async () => {
  for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
    await withFlags(v, v, () => {
      assert.strictEqual(W.isResolverEnabled(), false, `resolver accepted ${JSON.stringify(v)}`);
      assert.strictEqual(W.isWorkspaceStateEnabled(), false, `state accepted ${JSON.stringify(v)}`);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FLAGS OFF — production today
// ════════════════════════════════════════════════════════════════════════════

test('OFF: a legacy user reads and writes telegram_user_state, and nothing else', async () => {
  reset();
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'auto');
    assert.strictEqual(r.business.id, BIZ_A);
    assert.strictEqual(r.userId, TG_USER, 'the OFF path uses Number(telegram_id)');
  });
  assert.strictEqual(wrote('telegram_user_state').length, 1, 'the auto-selection must persist to 043');
  assert.strictEqual(wrote('user_channel_state').length, 0, 'OFF must never touch 045 state');
});

test('OFF: an existing 043 selection is honoured — the production row keeps working', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: BIZ_B }];
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'active');
    assert.strictEqual(r.business.id, BIZ_B, 'the saved workspace must win over re-resolution');
  });
  assert.deepStrictEqual(writes, [], 'a valid saved selection needs no write at all');
});

test('OFF: two workspaces and no selection is still choose', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'choose');
    assert.strictEqual(r.options.length, 2);
  });
});

test('OFF: no workspaces is none — and none still means none', async () => {
  reset(TG_USER, []);
  await LEGACY(async () => assert.strictEqual((await resolve(TG_USER)).status, 'none'));
});

test('OFF: a string telegram_id still coerces, with no new validation', async () => {
  reset();
  await LEGACY(async () => {
    const r = await resolve(String(TG_USER));
    assert.strictEqual(r.userId, TG_USER);
    assert.strictEqual(typeof r.userId, 'number');
  });
  // A malformed id keeps falling through to a lookup that finds nothing, exactly as before —
  // it must not become a new 400 that the OFF path never produced.
  reset(TG_USER, []);
  await LEGACY(async () => {
    const r = await resolve('not-an-id');
    assert.strictEqual(r.ok, true, 'OFF must not start rejecting ids the old code accepted');
    assert.strictEqual(r.status, 'none');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RESOLVER ON, STATE OFF
// ════════════════════════════════════════════════════════════════════════════

test('resolver ON: a linked negative user NEVER writes into telegram_user_state', async () => {
  // 043 keys on user_id with the implicit meaning "this is also the Telegram id". A negative
  // row there is a value that contradicts every other row in the table.
  reset(EMAIL_USER);
  scenario.rows.user_channel_links = [linkRow(EMAIL_USER)];
  await IDENTITY_ONLY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.userId, EMAIL_USER, 'the link must decide the acting user');
    assert.strictEqual(r.status, 'auto');
  });
  assert.strictEqual(wrote('telegram_user_state').length, 0, 'a negative id reached 043');
  assert.strictEqual(wrote('user_channel_state').length, 0, 'the state store is off');
});

test('resolver ON: a legacy positive user still uses 043', async () => {
  reset();
  await IDENTITY_ONLY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.userId, TG_USER);
  });
  assert.strictEqual(wrote('telegram_user_state').length, 1);
  assert.strictEqual(wrote('user_channel_state').length, 0);
});

test('resolver ON: an explicit selection by a negative user does not claim to persist', async () => {
  // Resolver on, state store off, negative id: there is nowhere to put the selection. Saying
  // "saved" would be a lie the user only discovers when their next message files elsewhere.
  reset(EMAIL_USER);
  scenario.rows.user_channel_links = [linkRow(EMAIL_USER)];
  await IDENTITY_ONLY(async () => {
    const r = await select(TG_USER, BIZ_A);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.persisted, false, 'persistence must be reported honestly');
  });
  assert.deepStrictEqual(writes, [], 'nothing may be written for a negative id with 045 off');
});

// ════════════════════════════════════════════════════════════════════════════
// BOTH ON — state on user_channel_state
// ════════════════════════════════════════════════════════════════════════════

test('ON: a linked negative user reads and writes user_channel_state only', async () => {
  reset(EMAIL_USER);
  scenario.rows.user_channel_links = [linkRow(EMAIL_USER)];
  await FULL(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.userId, EMAIL_USER);
    assert.strictEqual(r.status, 'auto');
  });
  assert.strictEqual(wrote('user_channel_state').length, 1);
  assert.strictEqual(wrote('telegram_user_state').length, 0, 'a negative id must never mirror to 043');
});

test('ON: a positive user mirrors the write to BOTH tables', async () => {
  // The mirror is what makes the flag reversible: without it, a user who selects with the flag
  // on and is rolled back reads stale 043 state and silently posts to the wrong company.
  reset();
  await FULL(async () => await select(TG_USER, BIZ_A));
  assert.strictEqual(wrote('user_channel_state').length, 1, 'primary write missing');
  assert.strictEqual(wrote('telegram_user_state').length, 1, 'rollback mirror missing');
  assert.strictEqual(wrote('telegram_user_state')[0].values.active_business_id, BIZ_A);
});

test('ON: user_channel_state wins over a disagreeing telegram_user_state', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.user_channel_state = [{ user_id: TG_USER, channel: 'telegram', active_business_id: BIZ_B }];
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: BIZ_A }];
  await FULL(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.business.id, BIZ_B, '045 must take precedence over 043');
  });
});

test('ON: a legacy 043 selection is the fallback when 045 has nothing', async () => {
  // Migration by use: production has a live 043 row and no 045 rows at all. If this fails, the
  // cutover silently moves that user to a different company.
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: BIZ_B }];
  await FULL(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'active');
    assert.strictEqual(r.business.id, BIZ_B, 'the legacy selection must survive the cutover');
  });
});

test('ON: a 045 row with a NULL selection falls through to 043 rather than resetting', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.user_channel_state = [{ user_id: TG_USER, channel: 'telegram', active_business_id: null }];
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: BIZ_A }];
  await FULL(async () => assert.strictEqual((await resolve(TG_USER)).business.id, BIZ_A));
});

test('ON: 043 is not even queried for a negative id', async () => {
  // Nothing could be there — its Telegram id was never a user id — so the query would be a
  // round trip that can only return empty.
  reset(EMAIL_USER);
  scenario.rows.user_channel_links = [linkRow(EMAIL_USER)];
  scenario.failTables.add('telegram_user_state');   // any read would surface as a 503
  await FULL(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.ok, true, '043 was queried for a negative id');
    assert.strictEqual(r.status, 'auto');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION: archived / personal / membership
// ════════════════════════════════════════════════════════════════════════════

test('an archived workspace is excluded from the options', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(ARCHIVED, 'old', 'business', 'archived')]);
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'auto', 'one live workspace remains, so it auto-selects');
    assert.deepStrictEqual(r.options.map((o) => o.id), [BIZ_A]);
  });
});

test('a saved archived workspace is ignored and cleared', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(ARCHIVED, 'old', 'business', 'archived')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: ARCHIVED }];
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.notStrictEqual(r.business?.id, ARCHIVED, 'an archived workspace stayed active');
    assert.strictEqual(r.business.id, BIZ_A);
  });
  assert.ok(wrote('telegram_user_state').some((w) => w.op === 'update' && w.values.active_business_id === null),
    'the stale selection was not cleared');
});

test('an archived workspace cannot be selected', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(ARCHIVED, 'old', 'business', 'archived')]);
  await LEGACY(async () => {
    const r = await select(TG_USER, ARCHIVED);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.httpStatus, 400);
    assert.strictEqual(r.code, 'workspace_archived', 'the reason must be nameable, not a flat refusal');
  });
  assert.deepStrictEqual(writes.filter((w) => w.op !== 'select'), [], 'a refused selection wrote something');
});

test('a personal workspace is excluded and cannot be selected', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(PERSONAL, 'me', 'personal')]);
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.deepStrictEqual(r.options.map((o) => o.id), [BIZ_A]);
    const s = await select(TG_USER, PERSONAL);
    assert.strictEqual(s.ok, false);
    assert.strictEqual(s.code, 'business_workspace_required');
  });
});

test('a workspace the user is not a member of is refused', async () => {
  reset();
  await LEGACY(async () => {
    const r = await select(TG_USER, GONE);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.httpStatus, 403);
    assert.strictEqual(r.code, 'not_a_member');
  });
});

test('a saved workspace the user has left is ignored and cleared', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: GONE }];
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.status, 'choose', 'a stale selection must re-resolve, not persist');
  });
  assert.ok(wrote('telegram_user_state').some((w) => w.op === 'update'), 'stale value not cleared');
});

test('a stale 045 selection is cleared in 045, not in 043', async () => {
  // Clearing the wrong table leaves the bad value in place and re-reads it next time.
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.user_channel_state = [{ user_id: TG_USER, channel: 'telegram', active_business_id: GONE }];
  await FULL(async () => await resolve(TG_USER));
  assert.ok(wrote('user_channel_state').some((w) => w.op === 'update'), '045 was not cleared');
  assert.ok(!wrote('telegram_user_state').some((w) => w.op === 'update'), '043 was cleared instead');
});

// ════════════════════════════════════════════════════════════════════════════
// ERROR SEMANTICS — the bug this rewrite exists to remove
// ════════════════════════════════════════════════════════════════════════════

test('a membership query failure is 503 — never none', async () => {
  reset();
  scenario.failTables.add('business_members');
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.httpStatus, 503);
    assert.strictEqual(r.code, 'temporary_workspace_lookup_failed');
    assert.notStrictEqual(r.status, 'none', 'a failed lookup was reported as "no workspaces"');
  });
});

test('a state read failure is 503 — never choose', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.failTables.add('telegram_user_state');
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.httpStatus, 503, 'a failed state read re-prompted instead of failing');
    assert.notStrictEqual(r.status, 'choose');
  });
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.failTables.add('user_channel_state');
  await FULL(async () => assert.strictEqual((await resolve(TG_USER)).httpStatus, 503));
});

test('a selection write failure is 503 — never a false ok', async () => {
  reset();
  scenario.failWrites.add('telegram_user_state');
  await LEGACY(async () => {
    const r = await select(TG_USER, BIZ_A);
    assert.strictEqual(r.ok, false, 'a failed save reported success');
    assert.strictEqual(r.httpStatus, 503);
    assert.strictEqual(r.code, 'workspace_state_write_failed');
  });
});

test('a failed ROLLBACK MIRROR is surfaced, not shrugged off', async () => {
  // The selection is stored, so this could plausibly be ignored — but a silently missing
  // mirror means the rollback path is broken, and nobody would find out until a rollback.
  reset();
  scenario.failWrites.add('telegram_user_state');   // only the MIRROR leg fails
  await FULL(async () => {
    const r = await select(TG_USER, BIZ_A);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.httpStatus, 503);
  });
});

test('an auto-select whose write fails still returns the right workspace', async () => {
  // The deliberate exception. Auto-select only fires when there is exactly ONE candidate, so
  // the next call resolves identically — the failure is self-correcting, and turning a correct
  // answer into a 503 would be worse than not persisting it.
  reset();
  scenario.failWrites.add('telegram_user_state');   // the READ must still succeed
  await LEGACY(async () => {
    const r = await resolve(TG_USER);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 'auto');
    assert.strictEqual(r.business.id, BIZ_A);
  });
});

test('actor statuses keep their own codes', async () => {
  reset(EMAIL_USER, []);
  scenario.rows.users = [];
  await IDENTITY_ONLY(async () => {
    const unlinked = await resolve(TG_USER);
    assert.strictEqual(unlinked.httpStatus, 403);
    assert.strictEqual(unlinked.code, 'not_linked');

    const invalid = await resolve('not-an-id');
    assert.strictEqual(invalid.httpStatus, 400);
    assert.strictEqual(invalid.code, 'invalid_telegram_id');

    scenario.rows.user_channel_links = [{ ...linkRow(EMAIL_USER), revoked_at: '2026-01-01T00:00:00Z' }];
    const revoked = await resolve(TG_USER);
    assert.strictEqual(revoked.httpStatus, 403);
    assert.strictEqual(revoked.code, 'link_revoked');

    scenario.failTables.add('user_channel_links');
    const err = await resolve(TG_USER);
    assert.strictEqual(err.httpStatus, 503);
    assert.strictEqual(err.code, 'temporary_identity_lookup_failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTES — real HTTP
// ════════════════════════════════════════════════════════════════════════════

test('routes: no bot secret is 401, before any workspace or identity lookup', async () => {
  reset();
  scenario.failTables.add('business_members');   // would be 503 if it were reached
  for (const secret of [null, 'wrong']) {
    const g = await api('GET', `/api/telegram/active-business?telegram_id=${TG_USER}`, { secret });
    assert.strictEqual(g.status, 401);
    const p = await api('POST', '/api/telegram/active-business', { body: { telegram_id: TG_USER, business_id: BIZ_A }, secret });
    assert.strictEqual(p.status, 401);
  }
  assert.deepStrictEqual(writes, [], 'an unauthenticated request touched state');
});

test('GET active-business: the wire shape is exactly what the bot already parses', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: BIZ_B }];
  const r = await getWs(TG_USER);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.body).sort(), ['business', 'options', 'status']);
  assert.strictEqual(r.body.status, 'active');
  assert.strictEqual(r.body.business.id, BIZ_B);
  assert.ok(!('userId' in r.body), 'internal fields must not reach the wire');
});

test('GET active-business: none stays a bare { status: none }', async () => {
  reset(TG_USER, []);
  const r = await getWs(TG_USER);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { status: 'none' });
});

test('GET active-business: a lookup failure is 503, and the bot will fail closed on it', async () => {
  // The bot's verifyLinkage() treats any unrecognised answer as "unverified" and refuses to
  // process — so this status needs no bot change to be handled safely.
  reset();
  scenario.failTables.add('business_members');
  const r = await getWs(TG_USER);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.error, 'temporary_workspace_lookup_failed');
  assert.notStrictEqual(r.body.status, 'none');
});

test('POST active-business: selecting an archived workspace is refused over HTTP', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(ARCHIVED, 'old', 'business', 'archived')]);
  const r = await setWs(TG_USER, ARCHIVED);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'workspace_archived');
});

test('POST active-business: a valid selection answers with the legacy body', async () => {
  reset();
  const r = await setWs(TG_USER, BIZ_A);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.business.id, BIZ_A);
  assert.strictEqual(r.body.business.role, 'owner');
});

test('POST active-business: a failed save is 503, not { ok: true }', async () => {
  reset();
  scenario.failTables.add('telegram_user_state');
  const r = await setWs(TG_USER, BIZ_A);
  assert.strictEqual(r.status, 503);
  assert.notStrictEqual(r.body.ok, true);
});

test('from-receipt: a linked negative user is no longer told not_linked', async () => {
  // The PR3 fix. This lookup used to read .eq('id', telegram_id), so a linked email-origin
  // account could resolve a workspace and be rejected by the very next query.
  reset(EMAIL_USER);
  scenario.rows.user_channel_links = [linkRow(EMAIL_USER)];
  scenario.rows.users = [{ id: EMAIL_USER, username: 'e', first_name: 'E' }];
  await FULL(async () => {
    const r = await receipt(TG_USER);
    assert.notStrictEqual(r.body?.error, 'not_linked', 'the raw telegram id was used for the lookup');
    assert.strictEqual(r.status, 422, 'it should reach OCR and stop there in this harness');
  });
});

test('from-receipt: choose still returns 409 with options', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(BIZ_B, 'beta')]);
  const r = await receipt(TG_USER);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'company_selection_required');
  assert.strictEqual(r.body.options.length, 2);
});

test('from-receipt: no workspace is still 403 not_member', async () => {
  reset(TG_USER, []);
  const r = await receipt(TG_USER);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error, 'not_member');
});

test('from-receipt: a workspace lookup failure is 503, not not_member', async () => {
  reset();
  scenario.failTables.add('business_members');
  const r = await receipt(TG_USER);
  assert.strictEqual(r.status, 503);
  assert.notStrictEqual(r.body.error, 'not_member');
});

test('from-receipt: an archived saved workspace does not become the posting target', async () => {
  reset(TG_USER, [biz(BIZ_A, 'acme'), biz(ARCHIVED, 'old', 'business', 'archived')]);
  scenario.rows.telegram_user_state = [{ user_id: TG_USER, active_business_id: ARCHIVED }];
  const r = await receipt(TG_USER);
  assert.notStrictEqual(r.status, 409, 'only one live workspace remains');
  assert.ok(!writes.some((w) => w.table === 'debts'), 'nothing may be filed into an archived workspace');
});

// ════════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS
// ════════════════════════════════════════════════════════════════════════════

const fs = require('node:fs');
const path = require('node:path');
const SRC = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

test('workspace state is reached only through lib/telegramWorkspace.js', () => {
  const server = SRC('server/index.js').split(String.fromCharCode(10))
    .filter((l) => /telegram_user_state|user_channel_state/.test(l) && !l.trim().startsWith('//'));
  assert.deepStrictEqual(server, [], 'server/index.js must not touch workspace state directly');
});

test('PR3 writes no links and mints no tokens', () => {
  const ws = SRC('server/lib/telegramWorkspace.js');
  assert.ok(!/user_channel_links|channel_link_tokens/.test(ws),
    'linking is PR4 — this module resolves identity through the PR2a library, it does not create it');
  for (const verb of ['insert(', 'delete(']) {
    assert.ok(!ws.includes(verb), `the workspace module must not ${verb.slice(0, -1)}`);
  }
});

test('every 043 write is guarded by userId > 0', () => {
  const ws = SRC('server/lib/telegramWorkspace.js');
  for (const m of ws.matchAll(/from\('telegram_user_state'\)[\s\S]{0,200}?upsert/g)) {
    assert.match(ws.slice(Math.max(0, m.index - 400), m.index), /userId > 0/,
      'an unguarded 043 write could store a negative user id');
  }
});

test('the non-IDR block, notifications and auth routes are untouched by PR3', () => {
  const server = SRC('server/index.js');
  assert.strictEqual((server.match(/isSupportedTelegramCurrency\(/g) || []).length, 2,
    'both Telegram currency doors must still be gated');
  assert.ok(server.includes('const chatIds = [...new Set(adminUserIds)];'),
    'the notification path belongs to PR2.6');
  assert.ok(!/resolveChannelExternalId|resolveTelegramExternalId/.test(server),
    'the reverse resolver must not be wired');
});
