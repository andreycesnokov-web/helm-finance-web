// Channel identity resolver (PR2a) — external account ⇄ platform user.
//
// Runs against REAL SQL: the 045 migration is applied to PGlite and the resolver queries it
// through a minimal supabase-shaped shim. That matters because the resolver's correctness
// depends on the partial unique indexes 045 creates — "at most one active link" is a
// database guarantee, not a JS one, and a test against a hand-rolled object would prove
// nothing about it.
//
// A local shim rather than tests/integration/_pgliteSupabase.js: that one is scoped to
// personalFunding's query shapes and does not support .is(). Extending it is out of scope
// for PR2a, and this file needs only four methods.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const R = require('../../server/lib/channelIdentity');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../migrations/045_channel_identity_foundation.sql'), 'utf8');

const TG_USER = 1057134807;   // positive: Telegram-origin (legacy conflation)
const TG_OTHER = 7700002;
const EMAIL_USER = -42;       // negative: email-origin (app_user_id_seq, 042)
const EMAIL_OTHER = -43;

// ── minimal supabase shim over real Postgres ────────────────────────────────
function shim(db) {
  const lit = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`);
  return {
    from(table) {
      const f = [];
      let cols = '*', lim = null;
      const q = {
        select(c) { cols = c; return q; },
        eq(col, val) { f.push(`"${col}" = ${lit(val)}`); return q; },
        is(col, val) { f.push(`"${col}" IS ${val === null ? 'NULL' : lit(val)}`); return q; },
        limit(n) { lim = n; return q; },
        then(res, rej) {
          const sql = `SELECT ${cols} FROM ${table}`
            + (f.length ? ` WHERE ${f.join(' AND ')}` : '')
            + (lim ? ` LIMIT ${lim}` : '');
          return db.query(sql)
            .then((r) => ({ data: r.rows, error: null }))
            .then(res, rej);
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
    INSERT INTO users VALUES (${TG_USER}), (${TG_OTHER}), (${EMAIL_USER}), (${EMAIL_OTHER});`);
  await db.exec(MIGRATION);
  return { db, supabase: shim(db) };
}

const link = (db, { external, userId, revoked = false, handle = null }) => db.exec(
  `INSERT INTO user_channel_links (channel, external_user_id, user_id, display_handle, revoked_at)
   VALUES ('telegram','${external}',${userId},${handle ? `'${handle}'` : 'NULL'},${revoked ? 'now()' : 'NULL'});`);

// ════════════════════════════════════════════════════════════════════════════
// normalizeChannelExternalUserId
// ════════════════════════════════════════════════════════════════════════════
// NB: no default parameter for `channel`. A default would swallow an explicitly passed
// `undefined`, so the "rejects an unknown channel" case would silently test 'telegram'.
const NO_CHANNEL = Symbol('absent');
const norm = (externalUserId, channel = NO_CHANNEL) =>
  R.normalizeChannelExternalUserId(
    channel === NO_CHANNEL ? { channel: 'telegram', externalUserId } : { channel, externalUserId });

test('accepts a Telegram id as a number and as a string, canonically as a string', () => {
  assert.deepStrictEqual(norm(1057134807), { status: 'ok', channel: 'telegram', externalUserId: '1057134807' });
  assert.deepStrictEqual(norm('1057134807'), { status: 'ok', channel: 'telegram', externalUserId: '1057134807' });
});

test('trims surrounding whitespace', () => {
  for (const v of ['  1057134807', '1057134807  ', '\t1057134807\n'])
    assert.strictEqual(norm(v).externalUserId, '1057134807', JSON.stringify(v));
});

test('rejects empty and whitespace-only', () => {
  for (const v of ['', '   ', '\t'])
    assert.strictEqual(norm(v).status, 'invalid', JSON.stringify(v));
});

test('rejects null and undefined', () => {
  assert.strictEqual(norm(null).reason, 'missing_external_user_id');
  assert.strictEqual(norm(undefined).reason, 'missing_external_user_id');
});

test('rejects negative values, in either type', () => {
  for (const v of [-1057134807, '-1057134807', '-1'])
    assert.strictEqual(norm(v).status, 'invalid', JSON.stringify(v));
});

test('rejects a leading plus', () => {
  assert.strictEqual(norm('+1057134807').status, 'invalid');
});

test('rejects non-digits, including an @username', () => {
  // A handle is mutable and can be re-registered by a different person, so it must never
  // identify anyone.
  for (const v of ['@cfoai', 'cfoai', '105713abc', '10 57', '1057.0', '1e9', '١٠٥٧'])
    assert.strictEqual(norm(v).status, 'invalid', JSON.stringify(v));
});

test('rejects leading zeros, and rejects "0" itself', () => {
  // Otherwise one account would have several spellings, and the partial unique index would
  // not actually prevent duplicates.
  for (const v of ['0', '00', '007', '01057134807'])
    assert.strictEqual(norm(v).status, 'invalid', JSON.stringify(v));
  assert.strictEqual(norm(0).status, 'invalid');
});

test('rejects a float or an unsafe integer — precision is already lost', () => {
  for (const v of [1.5, 1e21, Number.MAX_SAFE_INTEGER + 2, NaN, Infinity])
    assert.strictEqual(norm(v).status, 'invalid', String(v));
});

test('rejects non-string, non-number types', () => {
  // String([]) is '', which would otherwise look like an ordinary empty value.
  for (const v of [[], {}, true, false])
    assert.strictEqual(norm(v).status, 'invalid', JSON.stringify(v));
});

test('rejects an id wrapped in an array — coercion would accept it', () => {
  // The case that makes the type check load-bearing rather than decorative:
  // String([1057134807]) === '1057134807', which matches the id pattern exactly. Without an
  // explicit type refusal, a JSON body sending `telegram_id: [123]` would resolve as 123.
  for (const v of [[1057134807], ['1057134807'], [[1057134807]]])
    assert.strictEqual(R.normalizeChannelExternalUserId({ channel: 'telegram', externalUserId: v }).reason,
      'not_a_string_or_number', JSON.stringify(v));
});

test('rejects anything longer than int64 can hold', () => {
  assert.strictEqual(norm('1'.repeat(20)).status, 'invalid');
  assert.strictEqual(norm('9'.repeat(19)).status, 'ok');
});

test('rejects an unknown channel', () => {
  // Called directly: a default parameter fires on an explicitly passed `undefined`, so a
  // helper with a default would quietly test 'telegram' for the undefined case.
  for (const channel of ['whatsapp', 'sms', '', null, undefined, 'TELEGRAM', 0, {}])
    assert.strictEqual(
      R.normalizeChannelExternalUserId({ channel, externalUserId: '1057134807' }).status,
      'invalid', `channel=${String(channel)}`);
  // …and the case-sensitivity above matters: 'TELEGRAM' must not slip through.
  assert.strictEqual(
    R.normalizeChannelExternalUserId({ channel: 'telegram', externalUserId: '1057134807' }).status, 'ok');
});

// ════════════════════════════════════════════════════════════════════════════
// resolveChannelUser — external → user
// ════════════════════════════════════════════════════════════════════════════
const fwd = (supabase, externalUserId) => R.resolveTelegramUser({ supabase, telegramId: externalUserId });

test('an active link resolves to the linked user', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER });
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.userId, EMAIL_USER);
  assert.strictEqual(r.via, 'link');
});

test('an active link maps a Telegram id to a NEGATIVE user — the point of PR1', async () => {
  // The case the legacy model made impossible: an email-primary user owning a Telegram account.
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_OTHER });
  const r = await fwd(supabase, '888111');
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.userId, EMAIL_OTHER);
});

test('a revoked link ALONE resolves to revoked, never linked', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER, revoked: true });
  const r = await fwd(supabase, '888111');
  assert.strictEqual(r.status, 'revoked');
  assert.strictEqual(r.userId, null);
  assert.strictEqual(r.via, null);
});

test('no link + a positive legacy users row resolves to legacy', async () => {
  const { supabase } = await freshDb();
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.status, 'legacy');
  assert.strictEqual(r.userId, TG_USER);
  assert.strictEqual(r.via, 'legacy');
});

test('no link and no user resolves to unlinked', async () => {
  const { supabase } = await freshDb();
  const r = await fwd(supabase, '999999999');
  assert.strictEqual(r.status, 'unlinked');
  assert.strictEqual(r.userId, null);
});

test('a NEGATIVE id is never a legacy Telegram fallback', async () => {
  // Not a heuristic — a negative number cannot be a Telegram id, so this is a type check.
  const { supabase } = await freshDb();
  const r = await fwd(supabase, String(EMAIL_USER));
  assert.strictEqual(r.status, 'invalid');
  assert.strictEqual(r.userId, null);
});

test('an ACTIVE link always beats the legacy row — evidence over coincidence', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER });
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.userId, EMAIL_USER, 'the legacy positive id must not win');
  assert.strictEqual(r.via, 'link');
});

test('the legacy conflict is SURFACED, not resolved away', async () => {
  // The expected shape of a successful migration: an email user links the Telegram account
  // whose old positive-id row still exists. Reported so it is visible in logs and admin.
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER });
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.legacyConflictUserId, TG_USER);
});

test('no conflict is reported when the link points at the legacy user itself', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: TG_USER });
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.legacyConflictUserId, null);
});

test('a revoked link plus a legacy row falls back to the account\'s own row', async () => {
  // Revocation withdraws a link; it does not block an account from being itself.
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER, revoked: true });
  const r = await fwd(supabase, TG_USER);
  assert.strictEqual(r.status, 'legacy');
  assert.strictEqual(r.userId, TG_USER);
  assert.strictEqual(r.revokedLinkUserId, EMAIL_USER, 'the withdrawn link must stay visible');
});

test('revoke-then-relink resolves to the NEW user', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER, revoked: true });
  await link(db, { external: '888111', userId: EMAIL_OTHER });
  const r = await fwd(supabase, '888111');
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.userId, EMAIL_OTHER);
});

test('display_handle is ignored entirely for identity', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER, handle: 'cfoai' });
  assert.strictEqual((await fwd(supabase, '888111')).userId, EMAIL_USER);
  assert.strictEqual((await fwd(supabase, 'cfoai')).status, 'invalid', 'a handle is not an id');
  assert.strictEqual((await fwd(supabase, '@cfoai')).status, 'invalid');
});

test('resolving MUTATES NOTHING', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER });
  const before = await db.query(`SELECT
      (SELECT count(*)::int FROM user_channel_links)  AS links,
      (SELECT count(*)::int FROM channel_link_tokens) AS tokens,
      (SELECT count(*)::int FROM user_channel_state)  AS state,
      (SELECT count(*)::int FROM users)               AS users`);
  for (const id of [TG_USER, '999999999', String(EMAIL_USER), '@x', '']) await fwd(supabase, id);
  const after = await db.query(`SELECT
      (SELECT count(*)::int FROM user_channel_links)  AS links,
      (SELECT count(*)::int FROM channel_link_tokens) AS tokens,
      (SELECT count(*)::int FROM user_channel_state)  AS state,
      (SELECT count(*)::int FROM users)               AS users`);
  assert.deepStrictEqual(after.rows[0], before.rows[0]);
  assert.strictEqual(after.rows[0].state, 0, 'PR2a must not touch user_channel_state');
});

test('the resolver returns no business_id, role or membership', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: String(TG_USER), userId: EMAIL_USER });
  const r = await fwd(supabase, TG_USER);
  for (const k of Object.keys(r))
    assert.ok(!/business|role|member|permission/i.test(k), `identity result leaked ${k}`);
});

test('a lookup failure degrades to error, never throws', async () => {
  const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.reject(new Error('boom')) }) }) }) };
  const r = await R.resolveTelegramUser({ supabase: broken, telegramId: TG_USER });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.userId, null);
});

// supabase-js RESOLVES with { data, error } rather than rejecting, so the `error` field is
// the realistic failure mode — a rejected promise is the rare one. Returning `unlinked` here
// would tell a legitimately linked user "your Telegram is not connected" during a transient
// database blip: a confusing state dressed up as a definite answer.
const erroringClient = (failOn) => ({
  from(table) {
    const q = {
      select: () => q, eq: () => q, is: () => q, limit: () => q,
      then: (res) => res(table === failOn
        ? { data: null, error: { message: 'transient failure' } }
        : { data: [], error: null }),
    };
    return q;
  },
});

test('a { error } response on the LINK lookup is an error, not unlinked', async () => {
  const r = await R.resolveTelegramUser({ supabase: erroringClient('user_channel_links'), telegramId: TG_USER });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.reason, 'link_lookup_failed');
  assert.strictEqual(r.userId, null);
});

test('a { error } response on the USERS lookup is an error, not unlinked', async () => {
  const r = await R.resolveTelegramUser({ supabase: erroringClient('users'), telegramId: TG_USER });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.reason, 'user_lookup_failed');
  assert.strictEqual(r.userId, null);
});

test('the reverse resolver also reports a { error } response as error', async () => {
  const r = await R.resolveTelegramExternalId({ supabase: erroringClient('user_channel_links'), userId: EMAIL_USER });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.reason, 'link_lookup_failed');
  assert.strictEqual(r.externalUserId, null);
});

test('a missing client is an error, not a crash', async () => {
  const r = await R.resolveTelegramUser({ supabase: null, telegramId: TG_USER });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.reason, 'no_client');
});

// ════════════════════════════════════════════════════════════════════════════
// resolveChannelExternalId — user → external
// ════════════════════════════════════════════════════════════════════════════
const rev = (supabase, userId) => R.resolveTelegramExternalId({ supabase, userId });

test('an active link returns the external id', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER });
  const r = await rev(supabase, EMAIL_USER);
  assert.strictEqual(r.status, 'linked');
  assert.strictEqual(r.externalUserId, '888111');
  assert.strictEqual(r.via, 'link');
});

test('an active link for a NEGATIVE user returns an external id — enables notifications', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_OTHER });
  assert.strictEqual((await rev(supabase, EMAIL_OTHER)).externalUserId, '888111');
});

test('a revoked link alone returns revoked and NO external id', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER, revoked: true });
  const r = await rev(supabase, EMAIL_USER);
  assert.strictEqual(r.status, 'revoked');
  assert.strictEqual(r.externalUserId, null);
});

test('a positive user id falls back to itself as the Telegram id', async () => {
  const { supabase } = await freshDb();
  const r = await rev(supabase, TG_USER);
  assert.strictEqual(r.status, 'legacy');
  assert.strictEqual(r.externalUserId, String(TG_USER));
  assert.strictEqual(r.via, 'legacy');
});

test('a NEGATIVE user id with no link returns unlinked and null', async () => {
  // The bug this prevents: today the notification path would use -42 AS a chat id, and a
  // negative chat id is a GROUP in Telegram.
  const { supabase } = await freshDb();
  const r = await rev(supabase, EMAIL_USER);
  assert.strictEqual(r.status, 'unlinked');
  assert.strictEqual(r.externalUserId, null);
});

test('a NEGATIVE external id can NEVER be returned, whatever is stored', async () => {
  // 045 cannot constrain the shape of a TEXT column, so the guarantee is enforced on read.
  const { db, supabase } = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','-1001234567890',${EMAIL_USER});`);
  const r = await rev(supabase, EMAIL_USER);
  assert.notStrictEqual(r.status, 'linked');
  assert.strictEqual(r.externalUserId, null, 'a negative chat id must never escape');
});

test('a malformed stored external id is refused rather than passed through', async () => {
  const { db, supabase } = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','@cfoai',${EMAIL_USER});`);
  const r = await rev(supabase, EMAIL_USER);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.externalUserId, null);
});

test('a positive user with a revoked link still resolves legacy, and shows the revoked one', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: TG_USER, revoked: true });
  const r = await rev(supabase, TG_USER);
  assert.strictEqual(r.status, 'legacy');
  assert.strictEqual(r.externalUserId, String(TG_USER));
  assert.strictEqual(r.revokedLinkExternalId, '888111');
});

test('a malformed user id is invalid', async () => {
  const { supabase } = await freshDb();
  for (const v of [0, 1.5, NaN, null, undefined, '', 'abc', {}, []])
    assert.strictEqual((await rev(supabase, v)).status, 'invalid', JSON.stringify(v));
});

test('the reverse resolver mutates nothing', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER });
  const q = `SELECT (SELECT count(*)::int FROM user_channel_links) AS l,
                    (SELECT count(*)::int FROM users) AS u`;
  const before = await db.query(q);
  for (const id of [EMAIL_USER, TG_USER, 0, null]) await rev(supabase, id);
  assert.deepStrictEqual((await db.query(q)).rows[0], before.rows[0]);
});

test('forward and reverse agree for a linked pair', async () => {
  const { db, supabase } = await freshDb();
  await link(db, { external: '888111', userId: EMAIL_USER });
  const f = await fwd(supabase, '888111');
  const b = await rev(supabase, f.userId);
  assert.strictEqual(f.userId, EMAIL_USER);
  assert.strictEqual(b.externalUserId, '888111');
});

test('an unsupported channel is refused by both directions', async () => {
  const { supabase } = await freshDb();
  assert.strictEqual((await R.resolveChannelUser({ supabase, channel: 'whatsapp', externalUserId: '62811' })).status, 'invalid');
  assert.strictEqual((await R.resolveChannelExternalId({ supabase, channel: 'whatsapp', userId: 1 })).status, 'invalid');
});

// ════════════════════════════════════════════════════════════════════════════
// PR2a is a library only
// ════════════════════════════════════════════════════════════════════════════
const SERVER = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
const LIB = fs.readFileSync(path.join(__dirname, '../../server/lib/channelIdentity.js'), 'utf8');

test('server/index.js does NOT import or call the resolver yet', async () => {
  // Wiring is PR2.5, behind a flag, so it can revert without touching this module.
  assert.ok(!/channelIdentity/.test(SERVER), 'server/index.js already imports the resolver');
  for (const fn of ['resolveChannelUser', 'resolveChannelExternalId', 'resolveTelegramExternalId'])
    assert.ok(!SERVER.includes(fn), `server/index.js already calls ${fn}`);
});

test('the resolver never references user_channel_state — that is PR3', async () => {
  assert.ok(!/user_channel_state/.test(LIB));
});

test('the resolver performs no writes', async () => {
  const code = LIB.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
  for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc'])
    assert.ok(!new RegExp('\\.' + verb + '\\s*\\(').test(code), `the resolver calls .${verb}()`);
});

test('the resolver reads no business or membership table', async () => {
  for (const t of ['business_members', 'businesses', 'debts', 'telegram_user_state'])
    assert.ok(!LIB.includes(`'${t}'`), `the resolver reads ${t} — identity must not imply access`);
});

test('only telegram is supported', async () => {
  assert.deepStrictEqual(R.SUPPORTED_CHANNELS, ['telegram']);
  // Comment-free view: the module's prose legitimately explains why there is NO registry,
  // and matching that prose would fire on its own documentation.
  const code = LIB.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
  for (const forbidden of ['whatsapp', 'sms', 'signal', 'PROVIDERS', 'registry'])
    assert.ok(!new RegExp(forbidden, 'i').test(code), `PR2a must not add ${forbidden} support`);
  // The channel list is the single place a future channel gets enabled.
  assert.strictEqual((code.match(/SUPPORTED_CHANNELS\s*=/g) || []).length, 1);
});
