// PR2.5 — route-level Telegram actor resolution behind a runtime flag.
//
// The flag is TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED, default OFF. Two properties matter
// more than the rest, and most of this file exists to pin them:
//
//   1. OFF is today's behaviour exactly: Number(telegram_id), with NO added validation. A
//      route that currently lets a malformed id fall through to a failed lookup must keep
//      doing that, or "default off" is not actually a safe default.
//
//   2. `error` must never collapse into `unlinked`. Both yield no user, but they mean
//      opposite things — "not connected" versus "we could not find out". Answering onboarding
//      on a database blip tells a linked user to connect an account they already connected,
//      and it is indistinguishable from the PR5a.1 guard working correctly.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const A = require('../../server/lib/telegramActor');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../migrations/045_channel_identity_foundation.sql'), 'utf8');

const TG_USER = 1057134807;   // positive: Telegram-origin (legacy conflation)
const EMAIL_USER = -42;       // negative: email-origin (042)
const FLAG = 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED';

// ── harness ─────────────────────────────────────────────────────────────────
function shim(db) {
  const lit = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`);
  return {
    from(table) {
      const f = []; let cols = '*', lim = null;
      const q = {
        select(c) { cols = c; return q; },
        eq(col, val) { f.push(`"${col}" = ${lit(val)}`); return q; },
        is(col, val) { f.push(`"${col}" IS ${val === null ? 'NULL' : lit(val)}`); return q; },
        limit(n) { lim = n; return q; },
        then(res, rej) {
          const sql = `SELECT ${cols} FROM ${table}`
            + (f.length ? ` WHERE ${f.join(' AND ')}` : '') + (lim ? ` LIMIT ${lim}` : '');
          return db.query(sql).then((r) => ({ data: r.rows, error: null })).then(res, rej);
        },
      };
      return q;
    },
  };
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (${TG_USER}), (${EMAIL_USER});`);
  await db.exec(MIGRATION);
  return { db, supabase: shim(db) };
}

const link = (db, external, userId, revoked = false) => db.exec(
  `INSERT INTO user_channel_links (channel, external_user_id, user_id, revoked_at)
   VALUES ('telegram','${external}',${userId},${revoked ? 'now()' : 'NULL'});`);

async function withFlag(value, fn) {
  const saved = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
  try { return await fn(); } finally {
    if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved;
  }
}

const actor = (supabase, telegram_id, routeName = 'test') =>
  A.resolveTelegramActorForRoute({ supabase, telegram_id, routeName });

const countAll = (db) => db.query(`SELECT
  (SELECT count(*)::int FROM user_channel_links)  AS links,
  (SELECT count(*)::int FROM channel_link_tokens) AS tokens,
  (SELECT count(*)::int FROM user_channel_state)  AS state,
  (SELECT count(*)::int FROM users)               AS users`).then((r) => r.rows[0]);

// ════════════════════════════════════════════════════════════════════════════
// FLAG OFF — today's behaviour, unchanged
// ════════════════════════════════════════════════════════════════════════════
test('OFF is the default: an unset flag behaves as off', async () => {
  const { supabase } = await freshDb();
  await withFlag(undefined, async () => {
    assert.strictEqual(A.isResolverEnabled(), false);
    const r = await actor(supabase, TG_USER);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.userId, TG_USER);
  });
});

test('OFF: only the exact string "true" enables the resolver', async () => {
  for (const v of ['false', '1', 'TRUE', 'yes', 'on', ''])
    await withFlag(v, async () => assert.strictEqual(A.isResolverEnabled(), false, `flag=${v}`));
  await withFlag('true', async () => assert.strictEqual(A.isResolverEnabled(), true));
});

test('OFF: a positive Telegram user resolves to itself, as today', async () => {
  const { supabase } = await freshDb();
  await withFlag('false', async () => {
    const r = await actor(supabase, TG_USER);
    assert.deepStrictEqual(
      { ok: r.ok, userId: r.userId, via: r.via, status: r.status },
      { ok: true, userId: TG_USER, via: 'legacy', status: 'legacy' });
  });
});

test('OFF: an ACTIVE LINK is ignored — the flag really is the switch', async () => {
  // If a link changed behaviour with the flag off, "default off" would be a lie.
  const { db, supabase } = await freshDb();
  await link(db, String(TG_USER), EMAIL_USER);
  await withFlag('false', async () => {
    assert.strictEqual((await actor(supabase, TG_USER)).userId, TG_USER, 'link must not apply when off');
  });
  await withFlag('true', async () => {
    assert.strictEqual((await actor(supabase, TG_USER)).userId, EMAIL_USER, 'link must apply when on');
  });
});

test('OFF: NO validation is added — a malformed id still falls through', async () => {
  // The current routes do Number(telegram_id) with no checking, and a bad value simply fails
  // the downstream lookup. Adding a 400 here would be a behaviour change dressed as a fix.
  const { supabase } = await freshDb();
  await withFlag('false', async () => {
    for (const bad of ['@cfoai', '-1', '0', 'abc']) {
      const r = await actor(supabase, bad);
      assert.strictEqual(r.ok, true, `${bad} must not be rejected while the flag is off`);
      assert.ok(!r.httpStatus, 'no HTTP status may be produced when off');
    }
  });
});

test('OFF: the resolver is never consulted, so a broken client cannot break a route', async () => {
  const exploding = { from() { throw new Error('resolver must not be called'); } };
  await withFlag('false', async () => {
    const r = await actor(exploding, TG_USER);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.userId, TG_USER);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FLAG ON — status mapping
// ════════════════════════════════════════════════════════════════════════════
test('ON: a legacy positive user still works', async () => {
  const { supabase } = await freshDb();
  await withFlag('true', async () => {
    const r = await actor(supabase, TG_USER);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 'legacy');
    assert.strictEqual(r.userId, TG_USER);
  });
});

test('ON: an explicit link resolves to a NEGATIVE email user', async () => {
  // The capability the legacy model made impossible.
  const { db, supabase } = await freshDb();
  await link(db, '888111', EMAIL_USER);
  await withFlag('true', async () => {
    const r = await actor(supabase, '888111');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 'linked');
    assert.strictEqual(r.userId, EMAIL_USER);
    assert.strictEqual(r.via, 'link');
  });
});

test('ON: an explicit link beats a legacy conflict, and surfaces it', async () => {
  const { db, supabase } = await freshDb();
  await link(db, String(TG_USER), EMAIL_USER);
  await withFlag('true', async () => {
    const r = await actor(supabase, TG_USER);
    assert.strictEqual(r.userId, EMAIL_USER, 'the link must win');
    assert.strictEqual(r.legacyConflictUserId, TG_USER, 'the conflict must be visible');
  });
});

test('ON: unlinked fails closed as not_linked, with no user', async () => {
  const { supabase } = await freshDb();
  await withFlag('true', async () => {
    const r = await actor(supabase, '999999999');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'not_linked');
    assert.strictEqual(r.httpStatus, 403);
    assert.strictEqual(r.userId, null);
  });
});

test('ON: revoked fails closed and is DISTINGUISHABLE from never-connected', async () => {
  const { db, supabase } = await freshDb();
  await link(db, '888111', EMAIL_USER, true);
  await withFlag('true', async () => {
    const r = await actor(supabase, '888111');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'link_revoked');
    assert.notStrictEqual(r.code, 'not_linked', 'an operator must be able to tell these apart');
    assert.strictEqual(r.userId, null);
  });
});

test('ON: an invalid telegram id fails closed as 400', async () => {
  const { supabase } = await freshDb();
  await withFlag('true', async () => {
    for (const bad of ['@cfoai', '-1', '0', '007', '', null, [123]]) {
      const r = await actor(supabase, bad);
      assert.strictEqual(r.ok, false, JSON.stringify(bad));
      assert.strictEqual(r.code, 'invalid_telegram_id');
      assert.strictEqual(r.httpStatus, 400);
    }
  });
});

// ── the mapping that matters most ───────────────────────────────────────────
const erroringClient = {
  from() {
    const q = {
      select: () => q, eq: () => q, is: () => q, limit: () => q,
      then: (res) => res({ data: null, error: { message: 'transient' } }),
    };
    return q;
  },
};

test('ON: a lookup error is 503 temporary — NOT unlinked, NOT onboarding', async () => {
  await withFlag('true', async () => {
    const r = await actor(erroringClient, TG_USER);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(r.code, 'temporary_identity_lookup_failed');
    assert.strictEqual(r.httpStatus, 503);
    assert.notStrictEqual(r.code, 'not_linked');
    assert.notStrictEqual(r.httpStatus, 403, 'a 403 would read as a definite answer');
  });
});

test('ON: a thrown lookup is also 503, never unlinked', async () => {
  const throwing = {
    from() {
      const q = {
        select: () => q, eq: () => q, is: () => q, limit: () => q,
        then: (_res, rej) => rej(new Error('boom')),
      };
      return q;
    },
  };
  await withFlag('true', async () => {
    const r = await actor(throwing, TG_USER);
    assert.strictEqual(r.httpStatus, 503);
    assert.strictEqual(r.code, 'temporary_identity_lookup_failed');
  });
});

test('the error response body leaks no reason string or internal id', async () => {
  await withFlag('true', async () => {
    const body = A.actorErrorResponse(await actor(erroringClient, TG_USER));
    assert.deepStrictEqual(Object.keys(body).sort(), ['error', 'message']);
    assert.ok(!/transient|supabase|user_channel_links|sql/i.test(JSON.stringify(body)));
  });
});

// ── no writes, ever ─────────────────────────────────────────────────────────
test('resolving writes NOTHING, in either flag state', async () => {
  const { db, supabase } = await freshDb();
  await link(db, String(TG_USER), EMAIL_USER);
  const before = await countAll(db);
  for (const flag of ['false', 'true']) {
    await withFlag(flag, async () => {
      for (const id of [TG_USER, '999999999', '@bad', '', null]) await actor(supabase, id);
    });
  }
  const after = await countAll(db);
  assert.deepStrictEqual(after, before, 'no auto-link, no backfill, no user creation');
  assert.strictEqual(after.state, 0, 'PR2.5 must not touch user_channel_state — that is PR3');
  assert.strictEqual(after.tokens, 0, 'PR2.5 must not create link tokens — that is PR4');
});

test('counters separate legacy from linked traffic', async () => {
  // How the PR4 migration is observed actually finishing.
  const { db, supabase } = await freshDb();
  await link(db, '888111', EMAIL_USER);
  A.resetCounters();
  await withFlag('true', async () => {
    await actor(supabase, TG_USER);      // legacy
    await actor(supabase, '888111');     // linked
    await actor(supabase, '999999999');  // unlinked
  });
  const c = A.getCounters();
  assert.strictEqual(c.legacy, 1);
  assert.strictEqual(c.linked, 1);
  assert.strictEqual(c.unlinked, 1);
  A.resetCounters();
});

// ════════════════════════════════════════════════════════════════════════════
// Source guards — scope of PR2.5
// ════════════════════════════════════════════════════════════════════════════
const SERVER = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
const LIB = fs.readFileSync(path.join(__dirname, '../../server/lib/telegramActor.js'), 'utf8');

test('the flag name and default are exactly as specified', () => {
  assert.strictEqual(A.FLAG, 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED');
  assert.match(LIB, /process\.env\[FLAG\] === 'true'/, 'default must be OFF');
});

test('the flag is read at CALL time, not captured at import', () => {
  // A module-level const would freeze whatever the environment was at require(), making the
  // flag untestable and un-flippable without a restart.
  assert.ok(!/^const\s+\w*ENABLED\s*=/m.test(LIB), 'the flag must not be captured at import');
});

test('the identity resolver knows nothing about workspace state', () => {
  // Was "PR2.5 does not touch telegram_user_state — that is PR3". PR3 has now happened, so the
  // 043 statements have moved out of server/index.js into lib/telegramWorkspace.js. What must
  // still hold is the separation the original guard was really protecting: identity resolution
  // answers "who is this" and must never read or write "where are they posting".
  assert.ok(!/telegram_user_state|user_channel_state/.test(LIB),
    'telegramActor.js must not touch workspace state');
  const direct = SERVER.split('\n')
    .filter((l) => /telegram_user_state|user_channel_state/.test(l) && !l.trim().startsWith('//'));
  assert.deepStrictEqual(direct, [],
    'workspace state must be reached only through lib/telegramWorkspace.js');
});

test('the routes PR2.5 must not change are untouched', () => {
  for (const route of ["app.post('/api/auth/telegram'", "app.post('/api/telegram/connect'",
                       "app.get('/api/telegram/config'"])
    assert.ok(SERVER.includes(route), `${route} disappeared`);
  // /api/auth/telegram still upserts users — deliberately out of scope for this PR.
  const auth = SERVER.slice(SERVER.indexOf("app.post('/api/auth/telegram'"),
                            SERVER.indexOf('// --- Auth middleware'));
  assert.ok(!/resolveTelegramActorForRoute/.test(auth), '/api/auth/telegram must not be wired');
});

test('the non-IDR block is untouched and still gated at every door', () => {
  assert.strictEqual((SERVER.match(/isSupportedTelegramCurrency\(/g) || []).length, 2);
  assert.strictEqual((SERVER.match(/currencyNotSupported\(/g) || []).length, 2);
});

test('the actor helper performs no writes of its own', () => {
  const code = LIB.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc'])
    assert.ok(!new RegExp('\\.' + verb + '\\s*\\(').test(code), `.${verb}( found`);
});

test('bot-secret authentication still runs BEFORE identity resolution', () => {
  // Identity must never become a pre-auth oracle.
  for (const marker of ["app.post('/api/debts/from-telegram'",
                        "app.post('/api/telegram/debts/attach-receipt'"]) {
    const at = SERVER.indexOf(marker);
    assert.ok(at > -1, `${marker} not found`);
    const body = SERVER.slice(at, at + 2500);
    const auth = body.search(/requireBotSecret|x-bot-secret/);
    const ident = body.indexOf('resolveTelegramActorForRoute');
    assert.ok(auth > -1 && ident > -1 && auth < ident, `${marker}: identity resolved before auth`);
  }
});

test('no migration was added by PR2.5', () => {
  const migs = fs.readdirSync(path.join(__dirname, '../../migrations')).filter((f) => /^\d{3}_/.test(f));
  // 046_company_notification_grants is a deliberate, separately-reviewed feature (Company Admin
  // Notification Grants), not something that slipped in with the telegram-actor wiring. It is
  // allowed by name; the guard still catches any OTHER unexpected 046+ migration.
  const ALLOWED = new Set(['046_company_notification_grants.sql']);
  const unexpected = migs.filter((f) => /^04[6-9]_|^0[5-9]\d_/.test(f) && !ALLOWED.has(f));
  assert.strictEqual(unexpected.length, 0, `unexpected migration(s): ${unexpected.join(', ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
// Gaps found by mutation testing
//
// Five mutations survived the first run. Three were real coverage gaps, one was a guard that
// a comment could satisfy, one was a mutation too weak to matter with no guard behind it.
// Each test below is named for the mutation it now kills.
// ════════════════════════════════════════════════════════════════════════════

test('OFF: a STRING telegram id is coerced to a NUMBER, exactly as before', async () => {
  // Survivor: dropping Number() from the OFF path passed every test, because they all fed a
  // number, so Number(x) === x. But req.query.telegram_id is a STRING, and a string id
  // silently fails .eq('id', ...) against a bigint column. The OFF path must reproduce the
  // inline code it replaced, string inputs included.
  const { supabase } = await freshDb();
  await withFlag('false', async () => {
    const r = await actor(supabase, String(TG_USER));
    assert.strictEqual(typeof r.userId, 'number', 'the OFF path must coerce, as Number() did');
    assert.strictEqual(r.userId, TG_USER);
    assert.strictEqual(r.externalUserId, String(TG_USER));
  });
});

test('ON: a STRING telegram id also yields a numeric user id', async () => {
  const { supabase } = await freshDb();
  await withFlag('true', async () => {
    const r = await actor(supabase, String(TG_USER));
    assert.strictEqual(typeof r.userId, 'number');
    assert.strictEqual(r.userId, TG_USER);
  });
});

// A comment-free view of the server, as an array of lines.
//
// The routes' own comments mention 'x-bot-secret', so a guard reading raw text can pass on
// prose sitting above code that has been deleted — which is exactly how the auth guard was
// fooled. Line-based, never a block-comment regex: server/index.js has more '/*' than '*/'
// because some live inside regex literals, and a lazy [\s\S]*? match eats a quarter of the file.
const SERVER_LINES = SERVER.split(/\r?\n/)
  .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/(^|[^:])\/\/.*$/, '$1')));
const SERVER_CODE = SERVER_LINES.join('\n');

// The `span` lines starting at `marker` — one route body, rather than a byte count that can
// silently run past the end of the route it meant to inspect.
function region(marker, span) {
  const i = SERVER_LINES.findIndex((l) => l.includes(marker));
  assert.ok(i > -1, `not found in the comment-stripped source: ${marker}`);
  return SERVER_LINES.slice(i, i + span).join('\n');
}

test('every Telegram route CALLS requireBotSecret before resolving identity', () => {
  // Survivor: deleting the whole bot-secret block from from-telegram still satisfied a guard
  // matching /requireBotSecret|x-bot-secret/, because six lines above the deleted call a
  // comment reads "x-bot-secret: <TELEGRAM_WEBHOOK_SECRET>".
  for (const [marker, span] of [
    ["app.post('/api/debts/from-telegram'", 70],
    ["app.post('/api/telegram/debts/attach-receipt'", 20],
  ]) {
    const body = region(marker, span);
    const auth = body.indexOf('requireBotSecret(req)');
    const ident = body.indexOf('resolveTelegramActorForRoute');
    assert.ok(auth > -1, `${marker}: the bot-secret CALL is gone (a comment is not a check)`);
    assert.ok(ident > -1, `${marker}: identity is never resolved`);
    assert.ok(auth < ident, `${marker}: identity is resolved before authentication`);
  }
});

test('the wired lookups use actor.userId, never the raw telegram_id', () => {
  // Survivor: reverting from-telegram's users lookup to .eq('id', telegram_id) broke nothing,
  // because grep -c 'actor.userId' over this file returned 0 — the route-level wiring, which
  // is the entire point of PR2.5, was unasserted.
  for (const [marker, span, re] of [
    ["app.post('/api/debts/from-telegram'", 70, /\.select\('id, username, first_name'\)\.eq\('id', actor\.userId\)/],
    ['async function resolveTelegramMember', 12, /\.select\('id, username, first_name'\)\.eq\('id', actor\.userId\)/],
    ['async function resolveBotApprover', 30, /\.select\('role'\)\.eq\('user_id', actor\.userId\)/],
  ]) {
    assert.match(region(marker, span), re, `${marker}: the lookup does not use the resolved id`);
  }
  // training-submission assigns the resolved id instead of Number(telegram_id).
  assert.match(region("app.post('/api/team/onboarding/training-submission'", 26), /actingUserId = actor\.userId;/);
  assert.ok(!/actingUserId = Number\(telegram_id\)/.test(SERVER_CODE), 'the raw-id assignment must be gone');
});

test('attach-receipt keeps the external id and the platform id apart', () => {
  // The Telegram id identifies the CHANNEL account; actor.userId identifies the PLATFORM
  // account. Rows written before linking carry the former and rows written after the latter,
  // so the ownership filter has to accept both — without confusing one for the other.
  const body = region("app.post('/api/telegram/debts/attach-receipt'", 20);
  assert.match(body, /created_by_telegram_id\.eq\.\$\{actor\.externalUserId\}/);
  assert.match(body, /created_by_user_id\.eq\.\$\{actor\.userId\}/);
});

test('the 043 statements survived the move to lib/telegramWorkspace.js intact', () => {
  // Was a byte-for-byte pin on server/index.js. PR3 moved these statements into the workspace
  // module, so the pin moved with them rather than being dropped: production has a live 043
  // row, and the legacy read/write shape is what keeps that user's selection working across
  // the cutover. What changed on purpose is the WRITE guard (`userId > 0`) and the clear,
  // which now names the table it is clearing.
  const WS = fs.readFileSync(path.join(__dirname, '../../server/lib/telegramWorkspace.js'), 'utf8');
  const stmts = WS.split(String.fromCharCode(10))
    .filter((l) => /supabase\.from\('telegram_user_state'\)/.test(l))
    .map((l) => l.trim());
  assert.strictEqual(stmts.length, 3, 'expected one read, one mirror write and one legacy write');
  assert.match(WS, /\.select\('active_business_id'\)\.eq\('user_id', userId\)\.limit\(1\)/);
  assert.match(WS, /\.upsert\(\{ user_id: userId, active_business_id: businessId \}, \{ onConflict: 'user_id' \}\)/);
  // A negative id must never reach 043 — guarded, not merely intended.
  for (const m of WS.matchAll(/from\('telegram_user_state'\)[\s\S]{0,200}?upsert/g)) {
    const before = WS.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /userId > 0/, 'a 043 write is not guarded by userId > 0');
  }
});

test('the notification path resolves its recipients (PR2.6 landed)', () => {
  // PR2.5 pinned this line as "the known bug PR2.6 fixes", and PR2.6 has now fixed it: chat
  // ids are resolved rather than assumed. What PR2.5 actually cared about — that identity
  // resolution and notification routing never end up half-wired into each other — still holds,
  // and is now expressed as "the reverse resolver is reached only through its own helper".
  assert.ok(!/resolveChannelExternalId|resolveTelegramExternalId/.test(SERVER_CODE),
    'server/index.js must reach the reverse resolver through lib/telegramNotifications.js');
  assert.ok(!SERVER_LINES.some((l) => l.includes('const chatIds = [...new Set(adminUserIds)]')),
    'chat ids are being taken straight from membership rows again');
  assert.match(SERVER_CODE, /resolveTelegramNotificationRecipients\(\{/,
    'the notification fan-out must resolve its recipients');
});
