'use strict';
// Real Express + real PostgreSQL (production schema snapshot): a session JWT opens nothing unless it
// is signed with the current secret, its user exists, and it is not older than that user (an id
// reused after a database reset). Needs DATABASE_URL naming a disposable local PostgreSQL superuser.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');
const { createRealPgSupabase } = require('./_realPgSupabase');

const JWT_SECRET = 'session-user-http-test-secret-0123456789abcdef';
const OLD_SECRET = 'session-user-http-OLD-rotated-secret-0123456789';
const LIVE = -1001, REUSED = -1002, GHOST = -28;
let db, admin, server, BASE, supa;
const sign = (payload, secret = JWT_SECRET) => jwt.sign(payload, secret, { expiresIn: '1h' });
const get = async (path, token) => (await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })).status;

describe('Session JWT must belong to a live user (real PostgreSQL)', () => {
  let skipped = false;
  before(async () => {
    db = await createProdSchemaDatabase('hf_session_user', []);
    if (!db) { skipped = true; return; }
    admin = new Client({ connectionString: db.connectionString });
    await admin.connect();
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [LIVE]);
    // REUSED: the row is "created" now, but a token for this id was issued a day earlier (before a reset).
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [REUSED]);
    supa = createRealPgSupabase(db.connectionString);
    const lib = require.resolve('@supabase/supabase-js'), real = require(lib);
    require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { ...real, createClient: () => supa } };
    Object.assign(process.env, { PORT: '0', NODE_ENV: 'test', JWT_SECRET, SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SECRET_KEY: 'test-service-key', BOT_TOKEN: 'fake_bot_token', TELEGRAM_WEBHOOK_SECRET: 'fake_tg_secret', INCOMING_PAYMENTS_ENABLED: 'false', EMAIL_AUTH_ENABLED: 'true' });
    const listen = http.Server.prototype.listen, interval = global.setInterval;
    http.Server.prototype.listen = function patched(...a) { server = this; return listen.apply(this, a); };
    global.setInterval = (...a) => { const t = interval(...a); t.unref(); return t; };
    try { require('../../server/index.js'); } finally { http.Server.prototype.listen = listen; global.setInterval = interval; }
    if (!server.listening) await new Promise(r => server.once('listening', r));
    BASE = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => {
    if (server?.listening) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    try { await supa?.pool.end(); } catch { /* */ }
    try { await admin?.end(); } catch { /* */ }
    if (db) await db.drop();
  });

  it('a live user with a current token is accepted', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    assert.strictEqual(await get('/workspaces', sign({ userId: LIVE })), 200);
  });

  it('a token signed with the old (rotated) secret is refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    assert.strictEqual(await get('/workspaces', sign({ userId: LIVE }, OLD_SECRET)), 401);
  });

  it('a token for a user that does not exist is refused on every session entry point', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const ghost = sign({ userId: GHOST });
    assert.strictEqual(await get('/workspaces', ghost), 401);
    assert.strictEqual(await get('/me/profile', ghost), 401);
    assert.strictEqual(await get(`/debts/1/receipt?token=${encodeURIComponent(ghost)}`), 401);
  });

  it('a token issued before its user existed (id reused after a reset) is refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const yesterday = Math.floor(Date.now() / 1000) - 86400;
    assert.strictEqual(await get('/workspaces', sign({ userId: REUSED, iat: yesterday })), 401);
    assert.strictEqual(await get('/workspaces', sign({ userId: REUSED })), 200, 'the same id with a fresh token works');
  });

  it('a deleted user is refused', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const gone = -1003;
    await admin.query('INSERT INTO public.users (id) VALUES ($1)', [gone]);
    const token = sign({ userId: gone });
    await admin.query('DELETE FROM public.users WHERE id = $1', [gone]);
    assert.strictEqual(await get('/workspaces', token), 401);
  });
});
