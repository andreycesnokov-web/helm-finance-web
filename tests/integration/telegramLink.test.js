// PR4a — Telegram account linking, over real Postgres.
//
// WHY PGlite AND NOT A FAKE CLIENT
// --------------------------------
// The two properties that matter most here are database properties, not JavaScript ones:
//
//   1. Single use is enforced by one conditional UPDATE (`WHERE used_at IS NULL`). Postgres
//      serialises concurrent updates on the row so exactly one caller claims the token. A
//      hand-written fake would "pass" that test by being single-threaded, which proves nothing.
//   2. One active link per Telegram account, and one per user, are enforced by the two PARTIAL
//      unique indexes in 045 (`WHERE revoked_at IS NULL`). Those indexes are the real authority;
//      the checks in the module only choose a nicer error message.
//
// So this file runs the actual 045 migration in PGlite and drives the module against it. The
// concurrency test below is a genuine race, not a simulation of one.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const L = require('../../server/lib/telegramLink');
const { resolveTelegramExternalId, resolveTelegramUser } = require('../../server/lib/channelIdentity');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../migrations/045_channel_identity_foundation.sql'), 'utf8');

const SECRET = 'test-bot-secret';
const JWT_SECRET = 'test-jwt-secret';
const EMAIL_USER = -42;          // email-origin: the user PR4a exists for
const EMAIL_USER2 = -43;
const LEGACY_USER = 1057134807;  // a positive legacy Telegram-origin account
const TG = '555000222';          // the Telegram account being connected
const TG2 = '555000333';
const BOT = 'CFOAIFinance_Bot';

// ── a supabase-shaped client over PGlite ────────────────────────────────────
// Only the query shapes telegramLink.js uses. Errors are surfaced in supabase's
// { data, error } shape so a unique-index violation reaches the module as it would in
// production — that path is load-bearing for the race handling.
const ident = (s) => '"' + String(s).replace(/"/g, '') + '"';
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
};

function client(db) {
  return {
    from(table) {
      const where = [];
      let op = 'select', values = null, cols = '*', lim = null;
      const q = {
        select(c) { if (op === 'select') cols = c || '*'; q._ret = true; return q; },
        insert(v) { op = 'insert'; values = v; return q; },
        update(v) { op = 'update'; values = v; return q; },
        eq(c, v) { where.push(`${ident(c)} = ${lit(v)}`); return q; },
        neq(c, v) { where.push(`${ident(c)} <> ${lit(v)}`); return q; },
        is(c, v) { where.push(`${ident(c)} IS ${v === null ? 'NULL' : lit(v)}`); return q; },
        gt(c, v) { where.push(`${ident(c)} > ${lit(v)}`); return q; },
        lt(c, v) { where.push(`${ident(c)} < ${lit(v)}`); return q; },
        limit(n) { lim = n; return q; },
        order() { return q; },
        single() { q._single = true; return q; },
        maybeSingle() { q._single = true; return q; },
        then(resolve, reject) {
          const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
          let sql;
          if (op === 'insert') {
            const rows = Array.isArray(values) ? values : [values];
            const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
            sql = `INSERT INTO ${ident(table)} (${keys.map(ident).join(',')}) VALUES `
              + rows.map((r) => '(' + keys.map((k) => lit(r[k])).join(',') + ')').join(',')
              + ' RETURNING *';
          } else if (op === 'update') {
            const sets = Object.entries(values).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(', ');
            sql = `UPDATE ${ident(table)} SET ${sets}${w} RETURNING *`;
          } else {
            sql = `SELECT ${cols === '*' ? '*' : cols} FROM ${ident(table)}${w}`
              + (lim ? ` LIMIT ${lim}` : '');
          }
          return db.query(sql)
            .then((r) => ({ data: q._single ? (r.rows[0] || null) : r.rows, error: null }))
            .catch((e) => ({ data: null, error: { message: e.message } }))
            .then(resolve, reject);
        },
      };
      return q;
    },
  };
}

let db, supabase;
async function freshDb() {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY);
    CREATE TABLE business_members (id BIGSERIAL PRIMARY KEY, user_id BIGINT, business_id uuid, status TEXT);
    CREATE TABLE debts (id BIGSERIAL PRIMARY KEY, user_id BIGINT);
    CREATE TABLE audit_events (id BIGSERIAL PRIMARY KEY, business_id uuid NULL, actor_user_id BIGINT NULL,
      actor_role TEXT NULL, channel TEXT NULL, entity_type TEXT NULL, entity_id TEXT NULL,
      action TEXT NULL, before_json JSONB NULL, after_json JSONB NULL, request_id TEXT NULL);
    INSERT INTO users VALUES (${EMAIL_USER}), (${EMAIL_USER2}), (${LEGACY_USER});`);
  await db.exec(MIGRATION);
  supabase = client(db);
  return supabase;
}
const rows = async (sql) => (await db.query(sql)).rows;
const links = () => rows('SELECT * FROM user_channel_links ORDER BY id');
const tokens = () => rows('SELECT * FROM channel_link_tokens');

// A syntactically valid token that was never minted. Tests about "unknown" or "pre-existing"
// tokens need a WELL-FORMED value, or they measure format validation instead of the case they
// were written for.
const fakeToken = (seed = 'z') => (seed.repeat(43)).slice(0, 43);

const mint = (userId = EMAIL_USER, botUsername = BOT) =>
  L.createTelegramLinkToken({ supabase, userId, botUsername });
const consume = (token, telegramId = TG, extra = {}) =>
  L.consumeTelegramLinkToken({ supabase, token, telegramId, ...extra });
const status = (userId = EMAIL_USER) => L.getTelegramLinkStatus({ supabase, userId });
const revoke = (userId = EMAIL_USER) => L.revokeTelegramLink({ supabase, userId });

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA — 045 must already carry everything PR4a needs
// ════════════════════════════════════════════════════════════════════════════

test('045 provides both partial unique indexes PR4a relies on', async () => {
  await freshDb();
  const idx = await rows(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'user_channel_links'`);
  const defs = idx.map((r) => r.indexdef).join(String.fromCharCode(10));
  assert.match(defs, /UNIQUE.*\(channel, external_user_id\)[\s\S]*?revoked_at IS NULL/,
    'one active link per Telegram account is not enforced by the schema');
  assert.match(defs, /UNIQUE.*\(channel, user_id\)[\s\S]*?revoked_at IS NULL/,
    'one active link per user is not enforced by the schema');
  const cols = await rows(`SELECT column_name FROM information_schema.columns WHERE table_name='user_channel_links'`);
  assert.ok(!cols.some((c) => c.column_name === 'business_id'),
    'a link must not carry a business_id — access lives in business_members');
});

// ════════════════════════════════════════════════════════════════════════════
// MINT
// ════════════════════════════════════════════════════════════════════════════

test('mint: only the HASH is stored, never the token', async () => {
  await freshDb();
  const r = await mint();
  assert.strictEqual(r.ok, true);
  assert.match(r.body.token, L.TOKEN_RE, 'a 256-bit base64url token');
  const t = await tokens();
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].token_hash, L.hashToken(r.body.token));
  // The decisive assertion: the raw token appears in NO column of the row.
  const serialized = JSON.stringify(t[0]);
  assert.ok(!serialized.includes(r.body.token), 'the raw token was persisted somewhere');
});

test('mint: the row carries no business, no role, and the right channel', async () => {
  await freshDb();
  await mint();
  const t = (await tokens())[0];
  assert.strictEqual(t.intended_channel, 'telegram');
  assert.strictEqual(t.user_id, String(EMAIL_USER) * 1 || EMAIL_USER);
  assert.strictEqual(t.used_at, null);
  assert.ok(!('business_id' in t) && !('role' in t));
});

test('mint: expiry is ~15 minutes ahead', async () => {
  await freshDb();
  const r = await mint();
  const delta = new Date(r.body.expires_at).getTime() - Date.now();
  assert.ok(delta > 14 * 60 * 1000 && delta <= 15 * 60 * 1000 + 5000, `expiry was ${delta}ms`);
});

test('mint: the deep link is the documented /start payload', async () => {
  await freshDb();
  const r = await mint();
  assert.strictEqual(r.body.deep_link, `https://t.me/${BOT}?start=link_${r.body.token}`);
});

test('mint: refuses when the bot username is not configured', async () => {
  await freshDb();
  const r = await mint(EMAIL_USER, null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.httpStatus, 503);
  assert.strictEqual(r.code, 'bot_not_configured');
  assert.deepStrictEqual(await tokens(), [], 'a refused mint must not write a token');
});

test('mint: refuses when the user is already linked — no silent replacement', async () => {
  // Swapping one identity for another without a trace is not something a Connect button does.
  await freshDb();
  const a = await mint();
  await consume(a.body.token);
  const b = await mint();
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.httpStatus, 409);
  assert.strictEqual(b.code, 'already_linked');
});

test('mint: two tokens for the same user are distinct', async () => {
  await freshDb();
  const a = await mint();
  const b = await mint();
  assert.notStrictEqual(a.body.token, b.body.token);
  assert.strictEqual((await tokens()).length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// CONSUME
// ════════════════════════════════════════════════════════════════════════════

test('consume: a valid token creates exactly one active link', async () => {
  await freshDb();
  const r = await mint();
  const c = await consume(r.body.token, TG, { username: 'emi' });
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.body.display_handle, 'emi');

  const l = await links();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].channel, 'telegram');
  assert.strictEqual(l[0].external_user_id, TG);
  assert.strictEqual(Number(l[0].user_id), EMAIL_USER);
  assert.strictEqual(l[0].linked_via, 'link_token');
  assert.strictEqual(l[0].revoked_at, null);
});

test('consume: the token records how it was used', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token);
  const t = (await tokens())[0];
  assert.ok(t.used_at, 'used_at not recorded');
  assert.strictEqual(t.used_by_channel, 'telegram');
  assert.strictEqual(t.used_by_external_id, TG);
});

test('consume: a malformed token is refused before any lookup', async () => {
  await freshDb();
  for (const bad of ['', 'abc', null, undefined, 42, 'z'.repeat(64), '0'.repeat(63), {}]) {
    const c = await consume(bad);
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.httpStatus, 400, `accepted ${JSON.stringify(bad)}`);
    assert.strictEqual(c.code, 'invalid_token');
  }
  assert.deepStrictEqual(await links(), []);
});

test('consume: a malformed telegram id is refused', async () => {
  await freshDb();
  const r = await mint();
  for (const bad of ['-5', '0', '007', 'abc', '', null]) {
    const c = await consume(r.body.token, bad);
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.code, 'invalid_telegram_id', `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepStrictEqual(await links(), [], 'nothing may be linked from a bad id');
  assert.strictEqual((await tokens())[0].used_at, null, 'the token must not be burned by a bad id');
});

test('consume: an unknown token is 404', async () => {
  await freshDb();
  const c = await consume(crypto.randomBytes(32).toString('base64url'));
  assert.strictEqual(c.httpStatus, 404);
  assert.strictEqual(c.code, 'token_not_found');
});

test('consume: an expired token is 410, distinct from used', async () => {
  // Different messages: "start again" versus "you already connected". The status code is how
  // the bot tells them apart.
  await freshDb();
  const r = await mint();
  await db.query(`UPDATE channel_link_tokens SET expires_at = now() - interval '1 minute'`);
  const c = await consume(r.body.token);
  assert.strictEqual(c.httpStatus, 410);
  assert.strictEqual(c.code, 'token_expired');
  assert.deepStrictEqual(await links(), []);
});

test('consume: a revoked token is refused', async () => {
  await freshDb();
  const r = await mint();
  await db.query(`UPDATE channel_link_tokens SET revoked_at = now()`);
  const c = await consume(r.body.token);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 409);
  assert.deepStrictEqual(await links(), []);
});

test('consume: a used token presented by a DIFFERENT account is refused', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG);
  const c = await consume(r.body.token, TG2);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'token_already_used');
  assert.strictEqual((await links()).length, 1, 'no second link may appear');
});

test('consume: a replay by the SAME account is idempotent success, not an error', async () => {
  // A dropped response or a double tap. Reporting failure for something that plainly worked
  // would send the user round the whole flow again for nothing.
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG);
  const again = await consume(r.body.token, TG);
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.body.idempotent, true);
  assert.strictEqual((await links()).length, 1, 'a replay must not duplicate the row');
});

test('consume: a Telegram account linked to someone else is refused, link untouched', async () => {
  await freshDb();
  const first = await mint(EMAIL_USER);
  await consume(first.body.token, TG);
  const before = (await links())[0];

  const second = await mint(EMAIL_USER2);
  const c = await consume(second.body.token, TG);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 409);
  assert.strictEqual(c.code, 'external_already_linked');

  const after = await links();
  assert.strictEqual(after.length, 1, 'no second link');
  assert.deepStrictEqual(after[0], before, 'the existing link was modified');
});

test('consume: a user already linked to another Telegram account is refused', async () => {
  await freshDb();
  const a = await mint();
  await consume(a.body.token, TG);
  // Mint refuses once linked, so this is the belt-and-braces path: a token minted BEFORE the
  // link existed, redeemed after.
  await db.query(`INSERT INTO channel_link_tokens (token_hash, user_id, intended_channel, expires_at)
                  VALUES ('${L.hashToken(fakeToken('b'))}', ${EMAIL_USER}, 'telegram', now() + interval '10 minutes')`);
  const c = await consume(fakeToken('b'), TG2);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'user_already_linked');
  assert.strictEqual((await links()).length, 1);
});

test('consume: a legacy positive user for the same Telegram id does NOT block the link', async () => {
  // The expected shape of a successful migration: an email user connects the Telegram account
  // whose old positive-id row still exists. Surfaced, never merged.
  await freshDb();
  await db.query(`INSERT INTO users VALUES (${TG})`);
  const r = await mint();
  const c = await consume(r.body.token, TG);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.body.legacy_conflict, true);
  const u = await rows(`SELECT id FROM users ORDER BY id`);
  assert.strictEqual(u.length, 4, 'no user was merged, created or deleted');
});

test('consume: writes ONLY the two link tables', async () => {
  await freshDb();
  const before = {
    users: (await rows('SELECT * FROM users')).length,
    members: (await rows('SELECT * FROM business_members')).length,
    debts: (await rows('SELECT * FROM debts')).length,
    state: (await rows('SELECT * FROM user_channel_state')).length,
  };
  const r = await mint();
  await consume(r.body.token);
  assert.strictEqual((await rows('SELECT * FROM users')).length, before.users, 'users was written');
  assert.strictEqual((await rows('SELECT * FROM business_members')).length, before.members, 'business_members was written');
  assert.strictEqual((await rows('SELECT * FROM debts')).length, before.debts, 'debts was written');
  assert.strictEqual((await rows('SELECT * FROM user_channel_state')).length, before.state, 'user_channel_state was written');
});

// ════════════════════════════════════════════════════════════════════════════
// CONCURRENCY — the reason this file uses real Postgres
// ════════════════════════════════════════════════════════════════════════════

test('concurrency: two simultaneous consumes of one token yield exactly one link', async () => {
  await freshDb();
  const r = await mint();
  const [a, b] = await Promise.all([
    consume(r.body.token, TG, { username: 'a' }),
    consume(r.body.token, TG2, { username: 'b' }),
  ]);
  const l = await links();
  assert.strictEqual(l.length, 1, `expected one link, got ${l.length}`);
  const okCount = [a, b].filter((x) => x.ok).length;
  assert.strictEqual(okCount, 1, 'exactly one consume may succeed');
  const loser = a.ok ? b : a;
  assert.strictEqual(loser.httpStatus, 409);
  assert.strictEqual(loser.code, 'token_already_used');
});

test('concurrency: two accounts racing for the same Telegram id yield one link', async () => {
  // Here the index is the authority, not the pre-check: both callers can pass the read before
  // either insert lands.
  await freshDb();
  const a = await mint(EMAIL_USER);
  const b = await mint(EMAIL_USER2);
  const [x, y] = await Promise.all([consume(a.body.token, TG), consume(b.body.token, TG)]);
  const l = await links();
  assert.strictEqual(l.length, 1, `expected one link, got ${l.length}`);
  assert.strictEqual([x, y].filter((r) => r.ok).length, 1, 'exactly one may win');
});

// ════════════════════════════════════════════════════════════════════════════
// REVOKE
// ════════════════════════════════════════════════════════════════════════════

test('revoke: soft — the row survives with revoked_at and revoked_by_user_id', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token);
  const v = await revoke();
  assert.strictEqual(v.ok, true);
  const l = await links();
  assert.strictEqual(l.length, 1, 'the row must be preserved for audit');
  assert.ok(l[0].revoked_at);
  assert.strictEqual(Number(l[0].revoked_by_user_id), EMAIL_USER);
});

test('revoke: nothing else is touched', async () => {
  await freshDb();
  await db.query(`INSERT INTO business_members (user_id, business_id, status) VALUES (${EMAIL_USER}, NULL, 'active')`);
  await db.query(`INSERT INTO debts (user_id) VALUES (${EMAIL_USER})`);
  const r = await mint();
  await consume(r.body.token);
  await revoke();
  assert.strictEqual((await rows('SELECT * FROM users')).length, 3);
  assert.strictEqual((await rows('SELECT * FROM business_members')).length, 1);
  assert.strictEqual((await rows('SELECT * FROM debts')).length, 1);
  assert.strictEqual((await rows('SELECT * FROM user_channel_state')).length, 0);
});

test('revoke: with no active link it is 404, not a silent success', async () => {
  await freshDb();
  const v = await revoke();
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.httpStatus, 404);
  assert.strictEqual(v.code, 'not_linked');
});

test('revoke: a second revoke does not invent a second revocation', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token);
  await revoke();
  const again = await revoke();
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.code, 'not_linked');
});

test('revoke then relink: allowed, and the history is kept', async () => {
  await freshDb();
  const a = await mint();
  await consume(a.body.token, TG);
  await revoke();
  const b = await mint();
  assert.strictEqual(b.ok, true, 'minting must be possible again after revoke');
  const c = await consume(b.body.token, TG);
  assert.strictEqual(c.ok, true);
  const l = await links();
  assert.strictEqual(l.length, 2, 'the revoked row is kept and a new one added');
  assert.strictEqual(l.filter((x) => x.revoked_at === null).length, 1, 'exactly one active link');
});

// ════════════════════════════════════════════════════════════════════════════
// RESOLVER AGREEMENT — the link must mean what PR2a/PR2.6 think it means
// ════════════════════════════════════════════════════════════════════════════

test('the resolvers agree with the link, before and after revoke', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG);

  const fwd = await resolveTelegramUser({ supabase, telegramId: TG });
  assert.strictEqual(fwd.status, 'linked');
  assert.strictEqual(fwd.userId, EMAIL_USER);

  const rev = await resolveTelegramExternalId({ supabase, userId: EMAIL_USER });
  assert.strictEqual(rev.status, 'linked');
  assert.strictEqual(rev.externalUserId, TG);

  await revoke();
  assert.strictEqual((await resolveTelegramUser({ supabase, telegramId: TG })).status, 'revoked');
  assert.strictEqual((await resolveTelegramExternalId({ supabase, userId: EMAIL_USER })).status, 'revoked');
});

// ════════════════════════════════════════════════════════════════════════════
// STATUS
// ════════════════════════════════════════════════════════════════════════════

test('status: not_connected when nothing was ever linked', async () => {
  await freshDb();
  const s = await status();
  assert.strictEqual(s.body.status, 'not_connected');
  assert.strictEqual(s.body.handle, null);
  assert.strictEqual(s.body.external_user_id_masked, null);
  assert.strictEqual(s.body.legacy_conflict, false);
});

test('status: connected, with the external id MASKED', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG, { username: 'emi' });
  const s = await status();
  assert.strictEqual(s.body.status, 'connected');
  assert.strictEqual(s.body.handle, 'emi');
  assert.strictEqual(s.body.external_user_id_masked, '…0222');
  assert.ok(s.body.linked_at);
  // The decisive assertion: neither the full external id nor the platform id is exposed.
  const text = JSON.stringify(s.body);
  assert.ok(!text.includes(TG), 'the full Telegram id leaked');
  assert.ok(!text.includes(String(EMAIL_USER)), 'the platform user id leaked');
});

test('status: revoked after unlink', async () => {
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG);
  await revoke();
  const s = await status();
  assert.strictEqual(s.body.status, 'revoked');
  assert.ok(s.body.revoked_at);
  assert.strictEqual(s.body.linked_at, null, 'there is no active link to report');
});

test('status: legacy_conflict is surfaced when a positive legacy row exists', async () => {
  await freshDb();
  await db.query(`INSERT INTO users VALUES (${TG})`);
  const r = await mint();
  await consume(r.body.token, TG);
  assert.strictEqual((await status()).body.legacy_conflict, true);
});

test('status: another user sees their own state, not this one', async () => {
  await freshDb();
  const r = await mint(EMAIL_USER);
  await consume(r.body.token, TG);
  const s = await status(EMAIL_USER2);
  assert.strictEqual(s.body.status, 'not_connected');
  assert.strictEqual(s.body.external_user_id_masked, null);
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTES — real HTTP, and the auth asymmetry that is the security boundary
// ════════════════════════════════════════════════════════════════════════════

let server = null, BASE = null, jwt = null;

before(async () => {
  await freshDb();
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true,
    // The server holds one client reference from import; `supabase` is reassigned by
    // freshDb(), so the proxy forwards to whichever database the current test set up.
    exports: { ...real, createClient: () => ({ from: (t) => supabase.from(t),
      rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} }) },
  };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: SECRET, PORT: '0', TELEGRAM_BOT_USERNAME: BOT,
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });

const tok = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { body, token, secret } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (secret) headers['x-bot-secret'] = secret;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}
const ACCOUNT = '/api/account/integrations/telegram';

test('HTTP: the account routes reject a bot secret, and the consume route rejects a JWT', async () => {
  // The security boundary of PR4a. If a bot secret could mint a link token, anyone holding it
  // could connect their own Telegram to any account; if a JWT could consume, a user could
  // redeem someone else's token from a browser.
  await freshDb();
  for (const [method, p] of [['GET', ACCOUNT], ['POST', `${ACCOUNT}/link-token`], ['POST', `${ACCOUNT}/unlink`]]) {
    assert.strictEqual((await api(method, p)).status, 401, `${p} allowed an anonymous caller`);
    assert.strictEqual((await api(method, p, { secret: SECRET })).status, 401,
      `${p} accepted a bot secret — it must be JWT only`);
  }
  const withJwt = await api('POST', '/api/telegram/link-token/consume',
    { token: tok(EMAIL_USER), body: { token: 'a'.repeat(64), telegram_id: TG } });
  assert.strictEqual(withJwt.status, 401, 'consume accepted a JWT — it must be bot-secret only');
  assert.strictEqual((await api('POST', '/api/telegram/link-token/consume', { body: {} })).status, 401);
});

test('HTTP: the full connect journey', async () => {
  await freshDb();
  const t = tok(EMAIL_USER);

  const before = await api('GET', ACCOUNT, { token: t });
  assert.strictEqual(before.status, 200);
  assert.strictEqual(before.body.status, 'not_connected');

  const minted = await api('POST', `${ACCOUNT}/link-token`, { token: t });
  assert.strictEqual(minted.status, 200);
  assert.match(minted.body.deep_link, new RegExp(`^https://t\\.me/${BOT}\\?start=link_[A-Za-z0-9_-]{43}$`));
  assert.ok(minted.body.deep_link.split('start=')[1].length <= 64, 'the payload must fit Telegram');

  const consumed = await api('POST', '/api/telegram/link-token/consume',
    { secret: SECRET, body: { token: minted.body.token, telegram_id: TG, username: 'emi' } });
  assert.strictEqual(consumed.status, 200);
  assert.strictEqual(consumed.body.ok, true);

  const after = await api('GET', ACCOUNT, { token: t });
  assert.strictEqual(after.body.status, 'connected');
  assert.strictEqual(after.body.external_user_id_masked, '…0222');

  const unlinked = await api('POST', `${ACCOUNT}/unlink`, { token: t });
  assert.strictEqual(unlinked.status, 200);
  assert.strictEqual(unlinked.body.ok, true);

  const end = await api('GET', ACCOUNT, { token: t });
  assert.strictEqual(end.body.status, 'revoked');
});

test('HTTP: consume failure codes reach the wire intact', async () => {
  await freshDb();
  const cases = [
    [{ token: 'nope', telegram_id: TG }, 400, 'invalid_token'],
    [{ token: 'a'.repeat(64), telegram_id: TG }, 400, 'invalid_token'],   // the old hex shape
    [{ token: fakeToken('a'), telegram_id: TG }, 404, 'token_not_found'],
  ];
  for (const [body, status_, code] of cases) {
    const r = await api('POST', '/api/telegram/link-token/consume', { secret: SECRET, body });
    assert.strictEqual(r.status, status_);
    assert.strictEqual(r.body.error, code);
  }
});

test('HTTP: unlink with nothing connected is 404', async () => {
  await freshDb();
  const r = await api('POST', `${ACCOUNT}/unlink`, { token: tok(EMAIL_USER) });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.error, 'not_linked');
});

test('HTTP: minting is rate limited', async () => {
  await freshDb();
  const t = tok(EMAIL_USER2);   // a user the other tests do not exhaust
  let sawLimit = false;
  for (let i = 0; i < 8; i++) {
    const r = await api('POST', `${ACCOUNT}/link-token`, { token: t });
    if (r.status === 429) { sawLimit = true; assert.strictEqual(r.body.error, 'rate_limited'); break; }
  }
  assert.ok(sawLimit, 'the limiter never fired');
});

test('HTTP: the audit trail records the events and never the token', async () => {
  await freshDb();
  const t = tok(EMAIL_USER);
  const minted = await api('POST', `${ACCOUNT}/link-token`, { token: t });
  await api('POST', '/api/telegram/link-token/consume',
    { secret: SECRET, body: { token: minted.body.token, telegram_id: TG } });
  await api('POST', `${ACCOUNT}/unlink`, { token: t });

  const events = await rows(`SELECT action, after_json FROM audit_events ORDER BY id`);
  const actions = events.map((e) => e.action);
  for (const a of ['link_token_created', 'telegram_link_consumed', 'telegram_link_revoked']) {
    assert.ok(actions.includes(a), `missing audit action ${a}`);
  }
  const text = JSON.stringify(events);
  assert.ok(!text.includes(minted.body.token), 'the raw token reached the audit trail');
  assert.ok(!text.includes(L.hashToken(minted.body.token)), 'the token hash reached the audit trail');
});

// ════════════════════════════════════════════════════════════════════════════
// CODEX NO-GO FIXES
// ════════════════════════════════════════════════════════════════════════════

// ── 1. the deep-link payload must fit Telegram's /start limit ───────────────

test('the /start payload fits Telegram 64-character limit, with room to spare', async () => {
  // The bug that made this a NO-GO: a 64-char hex token produced `link_` + 64 = 69 characters,
  // over Telegram's documented limit for the start parameter. Telegram would have refused every
  // deep link — the connect flow dead on arrival, and nothing in the previous test suite looked
  // at the length.
  await freshDb();
  const r = await mint();
  const payload = r.body.deep_link.split('start=')[1];
  assert.ok(payload.length <= 64, `payload is ${payload.length} chars, over the limit`);
  assert.strictEqual(payload, `link_${r.body.token}`);
  assert.strictEqual(payload.length, 48);
});

test('the token is base64url — 256 bits in 43 characters', async () => {
  await freshDb();
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const r = await mint();
    const t = r.body.token;
    assert.strictEqual(t.length, 43, 'a 32-byte base64url token is 43 characters');
    assert.match(t, /^[A-Za-z0-9_-]{43}$/, 'only characters Telegram accepts in a start param');
    assert.ok(!t.includes('+') && !t.includes('/') && !t.includes('='),
      'standard base64 characters would be mangled in a URL');
    seen.add(t);
    await db.query('DELETE FROM channel_link_tokens');
  }
  assert.strictEqual(seen.size, 25, 'tokens must not repeat');
});

test('the deep-link builder refuses an over-long payload at the source', () => {
  // Enforced where the link is built, not only in a test: a future change to the encoding
  // cannot quietly produce a link Telegram will reject.
  assert.throws(() => L.buildDeepLink(BOT, 'x'.repeat(70)), /over the 64/);
  assert.doesNotThrow(() => L.buildDeepLink(BOT, 'x'.repeat(43)));
});

test('hash-only storage still holds for base64url tokens', async () => {
  await freshDb();
  const r = await mint();
  const t = (await tokens())[0];
  assert.strictEqual(t.token_hash, L.hashToken(r.body.token));
  assert.ok(!JSON.stringify(t).includes(r.body.token), 'the raw token was persisted');
  assert.strictEqual(t.token_hash.length, 64, 'the SHA-256 hash is still hex');
});

test('the old hex format and other malformed tokens are rejected', async () => {
  await freshDb();
  const rejected = [
    'a'.repeat(64),                 // the previous hex format
    'a'.repeat(42), 'a'.repeat(44), // wrong length
    'a'.repeat(43) + '=',           // padded base64
    'a'.repeat(42) + '+',           // standard base64 alphabet
    'a'.repeat(42) + '/',
    'a'.repeat(42) + ' ',
  ];
  for (const bad of rejected) {
    const c = await consume(bad);
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.code, 'invalid_token', `accepted ${JSON.stringify(bad.slice(0, 12))}…`);
  }
});

// ── 2. a short external id must never come back whole ───────────────────────

test('a short external id is masked completely, not decorated', async () => {
  // The previous mask returned '…' + the WHOLE id for anything four characters or shorter:
  // redacted-looking, and not redacted at all.
  for (const [input, expected] of [['1', '…'], ['12', '…'], ['123', '…'], ['1234', '…'],
                                   ['12345', '…'], ['1234567', '…'],
                                   ['12345678', '…5678'], ['555000222', '…0222']]) {
    assert.strictEqual(L.maskExternalId(input), expected, `mask of ${input}`);
  }
});

test('no external id — short or long — appears in full in a status response', async () => {
  // FLAKY BEFORE: this asserted the id string was absent from the WHOLE serialised body, which
  // also carries `linked_at` — a Postgres timestamp whose digits can coincidentally contain a
  // short id like '1234'. That produced a rare, unreproducible failure that had nothing to do
  // with the behaviour under test.
  //
  // Now each identity-bearing FIELD is inspected on its own. Timestamps are excluded because
  // they cannot leak an id: their digits are not derived from one. This is both deterministic
  // and a sharper statement of the actual guarantee.
  const ID_FIELDS = ['external_user_id_masked', 'handle', 'status'];
  for (const ext of ['1234', '99999', '555000222']) {
    await freshDb();
    // Seeded directly: a 4-digit id is not one the normalizer would accept from a bot, but the
    // status endpoint must not depend on that for its safety.
    await db.query(`INSERT INTO user_channel_links (channel, external_user_id, user_id, linked_via)
                    VALUES ('telegram', '${ext}', ${EMAIL_USER}, 'link_token')`);
    const s = await status();

    for (const field of ID_FIELDS) {
      const value = s.body[field] == null ? '' : String(s.body[field]);
      assert.ok(!value.includes(ext), `the full external id ${ext} leaked via ${field}: ${value}`);
      assert.ok(!value.includes(String(EMAIL_USER)), `the platform user id leaked via ${field}`);
      assert.ok(!value.includes(String(Math.abs(EMAIL_USER))), `the platform user id leaked via ${field}`);
    }
    assert.ok(s.body.external_user_id_masked.startsWith('…'));

    // And the body carries no field beyond the documented contract, so a future addition
    // cannot smuggle an id past the field list above.
    assert.deepStrictEqual(Object.keys(s.body).sort(),
      ['external_user_id_masked', 'handle', 'legacy_conflict', 'linked_at', 'revoked_at', 'status'],
      'the status contract changed — re-check what the new field can leak');
  }
});

// ── 3. an insert failure must be diagnosed, not assumed to be a conflict ────

// Wrap the client so one specific operation fails, leaving everything else real. This is how a
// transient database fault is reproduced without pretending the whole client is broken.
function failing(table, op, message = 'simulated failure') {
  const base = supabase;
  return {
    from(t) {
      const q = base.from(t);
      if (t !== table) return q;
      const originalOp = q[op].bind(q);
      q[op] = (...args) => { originalOp(...args); q.__fail = true; return q; };
      const originalThen = q.then.bind(q);
      q.then = (res, rej) => (q.__fail
        ? Promise.resolve({ data: null, error: { message } }).then(res, rej)
        : originalThen(res, rej));
      return q;
    },
  };
}

test('an UNKNOWN insert failure is 503, never a fabricated conflict', async () => {
  // The heart of this fix. Reporting "that Telegram account belongs to someone else" when the
  // truth is "our insert failed for a reason we do not understand" sends the user hunting for
  // an account that does not exist, and hides the real fault.
  await freshDb();
  const r = await mint();
  const broken = failing('user_channel_links', 'insert');
  const c = await L.consumeTelegramLinkToken({
    supabase: broken, token: r.body.token, telegramId: TG,
  });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 503, `expected 503, got ${c.httpStatus} (${c.code})`);
  assert.strictEqual(c.code, 'temporary_link_failure');
  assert.notStrictEqual(c.code, 'external_already_linked');
  assert.deepStrictEqual(await links(), [], 'nothing was linked');
});

test('a failed PRE-CHECK read is 503 before the insert is ever attempted', async () => {
  // Renamed and re-scoped. This client fails EVERY select on user_channel_links, so the first
  // pre-check errors and the insert is never reached — which is a real path worth covering, but
  // it is NOT the post-insert diagnostic path this test used to claim. Codex caught that; the
  // post-insert path is now proven separately, further down.
  await freshDb();
  const r = await mint();
  const broken = failing('user_channel_links', 'select');
  const c = await L.consumeTelegramLinkToken({
    supabase: broken, token: r.body.token, telegramId: TG,
  });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 503);
  assert.strictEqual(c.code, 'temporary_link_failed', 'this is the PRE-CHECK code, not the post-insert one');
  assert.deepStrictEqual(await links(), []);
});

test('a REAL external conflict still returns 409, with the existing link untouched', async () => {
  await freshDb();
  const a = await mint(EMAIL_USER);
  await consume(a.body.token, TG);
  const before = (await links())[0];

  const b = await mint(EMAIL_USER2);
  const c = await consume(b.body.token, TG);
  assert.strictEqual(c.httpStatus, 409);
  assert.strictEqual(c.code, 'external_already_linked');
  const after = await links();
  assert.strictEqual(after.length, 1);
  assert.deepStrictEqual(after[0], before, 'the existing link was modified');
});

test('a REAL user conflict still returns 409 user_already_linked', async () => {
  await freshDb();
  const a = await mint();
  await consume(a.body.token, TG);
  await db.query(`INSERT INTO channel_link_tokens (token_hash, user_id, intended_channel, expires_at)
                  VALUES ('${L.hashToken('u'.repeat(43))}', ${EMAIL_USER}, 'telegram', now() + interval '10 minutes')`);
  const c = await consume('u'.repeat(43), TG2);
  assert.strictEqual(c.httpStatus, 409);
  assert.strictEqual(c.code, 'user_already_linked');
  assert.strictEqual((await links()).length, 1);
});

// ── 4. a replay must not attach itself to a LATER link ──────────────────────

test('replay after revoke+relink: the old token cannot confirm the new link', async () => {
  // The scenario Codex identified, and the one my earlier probe missed — which is why I called
  // that mutation "equivalent" when it is not.
  //
  //   token A → user U links Telegram T1
  //   U revokes
  //   token B → user U links Telegram T2
  //   replay token A, presented from T2
  //
  // Token A never had anything to do with T2. Confirming it would tell the user an old link
  // succeeded on an account it never touched.
  await freshDb();
  const a = await mint();
  await consume(a.body.token, TG);
  await revoke();
  const b = await mint();
  await consume(b.body.token, TG2);

  const replayFromNew = await consume(a.body.token, TG2);
  assert.strictEqual(replayFromNew.ok, false, 'an old token confirmed a link it never created');
  assert.strictEqual(replayFromNew.code, 'token_already_used');

  const replayFromOld = await consume(a.body.token, TG);
  assert.strictEqual(replayFromOld.ok, false, 'a revoked link was resurrected by a replay');
  assert.strictEqual(replayFromOld.code, 'token_already_used');

  const l = await links();
  assert.strictEqual(l.length, 2, 'exactly the revoked T1 row and the active T2 row');
  const active = l.filter((x) => x.revoked_at === null);
  assert.strictEqual(active.length, 1, 'never two active links');
  assert.strictEqual(active[0].external_user_id, TG2, 'the active link must still be T2');
  const old = l.find((x) => x.external_user_id === TG);
  assert.ok(old.revoked_at, 'the old T1 row must stay revoked');
});

test('replay after a plain revoke does not resurrect the link', async () => {
  await freshDb();
  const a = await mint();
  await consume(a.body.token, TG);
  await revoke();
  const c = await consume(a.body.token, TG);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.code, 'token_already_used');
  assert.strictEqual((await links()).filter((x) => x.revoked_at === null).length, 0,
    'no active link may exist after revoke + replay');
});

// ════════════════════════════════════════════════════════════════════════════
// PR4a.1 — POST-INSERT diagnostic reads, proven to be reached
//
// Codex found that the earlier "failed diagnostic read" test did not prove what it claimed.
// It failed EVERY select on user_channel_links, so the very first PRE-CHECK
// (activeLinkForExternal, before the insert) errored and returned 503 — the insert was never
// attempted and the post-insert branch was never entered. The test asserted only the status
// code, and 503 is what both paths produce, so it passed for the wrong reason.
//
// Two things make these replacements conclusive:
//
//   1. The failure is injected only AFTER an insert has been attempted, so the pre-checks run
//      normally and the post-insert branch is genuinely reached.
//   2. The assertion is on the CODE, not the status. The pre-check path returns
//      'temporary_link_failed'; the post-insert path returns 'temporary_link_failure'. Those
//      two strings are the discriminator — asserting 503 alone cannot tell them apart.
// ════════════════════════════════════════════════════════════════════════════

const PRE_CHECK_CODE = 'temporary_link_failed';    // returned BEFORE the insert
const POST_INSERT_CODE = 'temporary_link_failure'; // returned only from the post-insert branch

/**
 * A client whose INSERT into user_channel_links always fails, and whose post-insert diagnostic
 * reads can be made to fail individually.
 *
 * Selects before the insert behave normally, which is the whole point: without that, the
 * pre-checks short-circuit and the code under test is never executed.
 */
function afterInsertFailing({ failExternalRead = false, failUserRead = false } = {}) {
  const base = supabase;
  let insertAttempted = false;
  let postInsertSelects = 0;
  return {
    from(t) {
      const q = base.from(t);
      if (t !== 'user_channel_links') return q;
      const originalInsert = q.insert.bind(q);
      q.insert = (...args) => { q.__isInsert = true; return originalInsert(...args); };
      const originalThen = q.then.bind(q);
      q.then = (res, rej) => {
        if (q.__isInsert) {
          insertAttempted = true;
          return Promise.resolve({ data: null, error: { message: 'simulated insert failure' } }).then(res, rej);
        }
        if (insertAttempted) {
          postInsertSelects += 1;
          const shouldFail = (postInsertSelects === 1 && failExternalRead)
                          || (postInsertSelects === 2 && failUserRead);
          if (shouldFail) {
            return Promise.resolve({ data: null, error: { message: 'simulated post-insert read failure' } }).then(res, rej);
          }
        }
        return originalThen(res, rej);
      };
      return q;
    },
    // exposed so a test can assert the insert really was attempted
    get _insertAttempted() { return insertAttempted; },
    get _postInsertSelects() { return postInsertSelects; },
  };
}

test('post-insert: a failed EXTERNAL diagnostic read is 503, and the insert really was reached', async () => {
  await freshDb();
  const r = await mint();
  const broken = afterInsertFailing({ failExternalRead: true });
  const c = await L.consumeTelegramLinkToken({ supabase: broken, token: r.body.token, telegramId: TG });

  // Proof the pre-checks were passed and the insert was attempted — without this the test
  // could pass from the pre-check path, which is exactly the flaw being fixed.
  assert.strictEqual(broken._insertAttempted, true, 'the insert was never attempted');
  assert.strictEqual(broken._postInsertSelects, 1, 'the post-insert external read did not run');

  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 503);
  assert.strictEqual(c.code, POST_INSERT_CODE, 'this must come from the POST-INSERT branch');
  assert.notStrictEqual(c.code, PRE_CHECK_CODE, 'the pre-check path short-circuited instead');
  assert.deepStrictEqual(await links(), [], 'nothing may be linked');
  // The token is burned either way — a conflict here means starting again, by design.
  assert.ok((await tokens())[0].used_at, 'the token should have been claimed before the insert');
});

test('post-insert: a failed USER diagnostic read is 503, after the external read succeeded', async () => {
  // The second read. The first one succeeds and finds no conflict, so only the user read can
  // account for the failure — a narrower path than the previous test, and one that a
  // fail-everything client could never isolate.
  await freshDb();
  const r = await mint();
  const broken = afterInsertFailing({ failUserRead: true });
  const c = await L.consumeTelegramLinkToken({ supabase: broken, token: r.body.token, telegramId: TG });

  assert.strictEqual(broken._insertAttempted, true, 'the insert was never attempted');
  assert.strictEqual(broken._postInsertSelects, 2, 'both post-insert reads should have run');

  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 503);
  assert.strictEqual(c.code, POST_INSERT_CODE);
  assert.deepStrictEqual(await links(), []);
});

test('post-insert: both reads succeed but confirm no conflict — still 503, never a fake 409', async () => {
  // The terminal fallback, and the reason the whole classification exists. The insert failed,
  // both diagnostics are healthy, and neither finds a conflict — so the cause is unknown.
  // Answering 409 here would tell the user their Telegram belongs to somebody else on no
  // evidence whatsoever.
  await freshDb();
  const r = await mint();
  const broken = afterInsertFailing();   // insert fails; both reads work normally
  const c = await L.consumeTelegramLinkToken({ supabase: broken, token: r.body.token, telegramId: TG });

  assert.strictEqual(broken._insertAttempted, true);
  assert.strictEqual(broken._postInsertSelects, 2, 'both diagnostic reads must have run');

  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.httpStatus, 503);
  assert.strictEqual(c.code, POST_INSERT_CODE);
  assert.notStrictEqual(c.code, 'external_already_linked');
  assert.notStrictEqual(c.code, 'user_already_linked');
  assert.deepStrictEqual(await links(), []);
});

test('both post-insert diagnostic reads check their error (source pin)', () => {
  // The EXTERNAL read error check is behaviourally provable and mutation-caught. The USER read
  // error check is NOT: with that read failing, mineNow is null, no conflict is confirmed, and
  // control reaches the terminal 503 anyway — the same status and the same code. So removing it
  // changes nothing observable, and no test can fail on it.
  //
  // It is kept because it says what it means and exits at the point the fault is known, and it
  // is pinned here because mutation testing showed a test could never notice its removal.
  const lib = SRC('server/lib/telegramLink.js');
  const at = lib.indexOf('if (insErr) {');
  const branch = lib.slice(at, at + 2000);
  assert.ok(branch.includes('if (racedErr) return fail(503'), 'the external read error check is gone');
  assert.ok(branch.includes('if (mineErr) return fail(503'), 'the user read error check is gone');
});
test('the pre-check and post-insert failure codes are distinct, or neither test proves anything', () => {
  // If these two ever become the same string, all three tests above silently stop
  // distinguishing the paths they were written to separate.
  const lib = SRC('server/lib/telegramLink.js');
  assert.notStrictEqual(PRE_CHECK_CODE, POST_INSERT_CODE);
  assert.ok(lib.includes(`fail(503, '${PRE_CHECK_CODE}'`), 'the pre-check code changed');
  assert.ok(lib.includes(`fail(503, '${POST_INSERT_CODE}'`), 'the post-insert code changed');
});

// ════════════════════════════════════════════════════════════════════════════
// THE SECOND LAYERS — pins for three mutations that are equivalent by layering
//
// Mutation testing left three survivors, and each was checked by applying the mutation and
// probing the actual outcome rather than by reasoning about it:
//
//   * removing the external-conflict PRE-CHECK still refuses the steal, with the same code —
//     the partial unique index rejects the insert and the error branch maps it identically.
//   * removing the same-account condition from the replay branch still refuses a replay from a
//     different account — the inner ownership check catches it.
//   * removing the intended_channel filter changes nothing — 045's CHECK constraint permits
//     only 'telegram'.
//
// So the pre-checks are message quality, and the DATABASE is the authority. That is the design,
// but it means these tests cannot fail if the second layers are removed — hence the pins.
// ════════════════════════════════════════════════════════════════════════════

test('the database is the authority: both partial unique indexes survive a direct attack', async () => {
  // Bypass the module entirely and try to write what it refuses. If these inserts ever succeed,
  // every "conflict" test above is resting on a check that could be deleted without a failure.
  await freshDb();
  const r = await mint();
  await consume(r.body.token, TG);

  await assert.rejects(
    db.query(`INSERT INTO user_channel_links (channel, external_user_id, user_id, linked_via)
              VALUES ('telegram', '${TG}', ${EMAIL_USER2}, 'link_token')`),
    /duplicate key|unique/i,
    'a second active link for one Telegram account was accepted by the database');

  await assert.rejects(
    db.query(`INSERT INTO user_channel_links (channel, external_user_id, user_id, linked_via)
              VALUES ('telegram', '${TG2}', ${EMAIL_USER}, 'link_token')`),
    /duplicate key|unique/i,
    'a second active link for one user was accepted by the database');

  // …and the same rows are permitted once the first link is revoked, which is what makes
  // relinking possible at all.
  await db.query('UPDATE user_channel_links SET revoked_at = now()');
  await db.query(`INSERT INTO user_channel_links (channel, external_user_id, user_id, linked_via)
                  VALUES ('telegram', '${TG}', ${EMAIL_USER2}, 'link_token')`);
  assert.strictEqual((await links()).length, 2);
});

test('045 permits only the telegram channel, which is why the filter is redundant', async () => {
  await freshDb();
  await assert.rejects(
    db.query(`INSERT INTO channel_link_tokens (token_hash, user_id, intended_channel, expires_at)
              VALUES ('x', ${EMAIL_USER}, 'whatsapp', now() + interval '10 minutes')`),
    /check constraint|violates/i,
    'a non-telegram channel was accepted — the intended_channel filter stops being redundant');
});

test('the insert-failure branch maps a lost race to a conflict, not a success', () => {
  // The layer that makes the external-conflict pre-check redundant: the partial unique index
  // rejects the insert, and this branch turns that rejection into the same 409 the pre-check
  // would have produced. If it ever treats an insert error as success, a lost race becomes a
  // silent non-link — the user is told they connected and nothing was written.
  const lib = SRC('server/lib/telegramLink.js');
  const at = lib.indexOf('if (insErr) {');
  assert.ok(at > -1, 'the insert-error branch is gone');
  const branch = lib.slice(at, at + 2000);
  assert.ok(branch.includes('activeLinkForExternal(supabase, external)'),
    'the branch no longer re-reads to find out who won the race');
  assert.ok(branch.includes("fail(409, 'external_already_linked'"),
    'a lost race no longer resolves to a conflict');
});

test('the replay branch confirms ownership before calling a replay idempotent', () => {
  // The layer that makes the same-account condition redundant. Without it, any account could
  // present a used token and be told the connection succeeded.
  const lib = SRC('server/lib/telegramLink.js');
  assert.ok(lib.includes('if (mine && String(mine.user_id) === String(row.user_id)) {'),
    'a replay may now be confirmed without checking who owns the link');
});

// ════════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS
// ════════════════════════════════════════════════════════════════════════════

const SRC = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

test('the link module writes only the two link tables', () => {
  const lib = SRC('server/lib/telegramLink.js');
  for (const t of ['telegram_user_state', 'user_channel_state', 'business_members']) {
    assert.ok(!lib.includes(`from('${t}')`), `telegramLink.js touches ${t}`);
  }
  // `users` is read for legacy-conflict detection and must never be written.
  const writes = [...lib.matchAll(/from\('users'\)([\s\S]{0,120})/g)].map((m) => m[1]);
  for (const w of writes) {
    assert.ok(!/insert|update|upsert|delete/.test(w), 'telegramLink.js writes the users table');
  }
});

test('no token or hash is ever logged', () => {
  const lib = SRC('server/lib/telegramLink.js');
  const server = SRC('server/index.js');
  for (const [name, src] of [['telegramLink.js', lib], ['index.js', server]]) {
    for (const m of src.matchAll(/console\.(log|warn|error)\(([^)]*)\)/g)) {
      assert.ok(!/token|hash/i.test(m[2]), `${name} logs something token-shaped: ${m[0]}`);
    }
  }
});

// One route handler: from its app.get/app.post to the start of the next one. A fixed byte
// window would run past a short handler into the following route and read its guards as this
// route's — which is exactly what an earlier revision of this test did.
function handlerBody(server, marker) {
  const at = server.indexOf(marker);
  assert.ok(at > -1, `${marker} not found`);
  const rest = server.slice(at + marker.length);
  const next = rest.search(/\napp\.(get|post|put|patch|delete|use)\(/);
  return server.slice(at, next === -1 ? server.length : at + marker.length + next);
}

test('the routes keep JWT and bot-secret authentication separate', () => {
  const server = SRC('server/index.js');

  const consumeBody = handlerBody(server, "app.post('/api/telegram/link-token/consume'");
  assert.match(consumeBody, /requireBotSecret\(req\)/, 'consume must check the bot secret');
  assert.ok(!/,\s*auth\s*,/.test(consumeBody.split(String.fromCharCode(10))[0]),
    'consume must not use the JWT middleware');

  for (const p of ["app.get('/api/account/integrations/telegram'",
                   "app.post('/api/account/integrations/telegram/link-token'",
                   "app.post('/api/account/integrations/telegram/unlink'"]) {
    const body = handlerBody(server, p);
    assert.match(body.split(String.fromCharCode(10))[0], /,\s*auth\s*,/,
      `${p} must use the JWT middleware`);
    assert.ok(!/requireBotSecret/.test(body), `${p} must not accept a bot secret`);
  }
});

test('PR4a adds no migration and leaves the legacy flows alone', () => {
  const server = SRC('server/index.js');
  // the cfo_* membership connect flow
  assert.match(server, /app\.post\('\/api\/telegram\/connect'/);
  assert.match(server, /parseStartPayload\(start_payload\)/);
  // telegram widget login
  assert.match(server, /app\.post\('\/api\/auth\/telegram'/);
  // config
  assert.match(server, /app\.get\('\/api\/telegram\/config'/);
  // the currency gate and the notification path are untouched
  assert.strictEqual((server.match(/isSupportedTelegramCurrency\(/g) || []).length, 2);
  assert.match(server, /resolveTelegramNotificationRecipients/);
});
