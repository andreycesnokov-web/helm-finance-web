'use strict';
// Route contract of server/lib/passwordAuth.js with a fake GoTrue and a fake Supabase RPC layer (no network, no DB).
// The real GoTrue + Mailpit + PostgreSQL flow is covered by the clean-install rehearsal (V2_CLEAN_INSTALL_REHEARSAL_REPORT.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { install, passwordProblem } = require('../server/lib/passwordAuth');

const SECRET = 'password-auth-unit-secret-0123456789abcdef';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const gotrueToken = (claims) => `${b64({ alg: 'HS256' })}.${b64({ iat: Math.floor(Date.now() / 1000), ...claims })}.sig`;

function harness({ gotrue = {}, rpc = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url), path = u.pathname.replace('/auth/v1', ''), body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init.method, query: Object.fromEntries(u.searchParams), body, auth: init.headers.authorization });
    const h = gotrue[`${init.method} ${path}`] || (() => ({ status: 200, data: {} }));
    const r = await h({ body, auth: init.headers.authorization, query: Object.fromEntries(u.searchParams) });
    return { ok: r.status < 300, status: r.status, json: async () => r.data };
  };
  const rpcCalls = [];
  const supabase = { rpc: async (name, args) => { rpcCalls.push({ name, args }); return (rpc[name] || (() => ({ data: null, error: { message: 'unexpected rpc' } })))(args); } };
  const buckets = new Map();
  const rateLimited = (key, max) => { const n = (buckets.get(key) || 0) + 1; buckets.set(key, n); return n > max; };
  const app = express(); app.use(express.json());
  const auth = (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization).replace('Bearer ', ''), SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); } };
  install(app, { auth, supabase, enabled: true, gotrueUrl: 'http://gotrue.test', apiKey: 'service-key', jwtSecret: SECRET, appBaseUrl: 'https://app.test', rateLimited, fetchImpl, log: { error() {}, warn() {} } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (p, body, token, ip = '198.51.100.' + Math.floor(Math.random() * 250)) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { post, calls, rpcCalls, close: () => server.close() };
}

test('password policy: length, bcrypt byte limit, not the email', () => {
  assert.equal(passwordProblem('short', 'a@b.co'), 'password_too_short');
  assert.equal(passwordProblem('я'.repeat(40), 'a@b.co'), 'password_too_long');
  assert.equal(passwordProblem('A@B.co12345', 'a@b.co12345'), 'password_weak');
  assert.equal(passwordProblem('a-good-passphrase', 'a@b.co'), null);
});

test('disabled: no route is mounted', async () => {
  const app = express(); assert.deepEqual(install(app, { enabled: false }), { enabled: false });
  assert.equal(app._router, undefined);
});

test('register forwards once to GoTrue with the confirm redirect and answers the same for existing accounts', async () => {
  const h = harness({ gotrue: { 'POST /signup': ({ body }) => body.email === 'taken@x.co' ? { status: 422, data: { error_code: 'user_already_exists' } } : { status: 200, data: { id: 'u' } } } });
  try {
    const a = await h.post('/auth/password/register', { email: 'New@X.co', password: 'a-good-passphrase' });
    const b = await h.post('/auth/password/register', { email: 'taken@x.co', password: 'a-good-passphrase' });
    assert.deepEqual(a.body, b.body); assert.equal(a.status, 200);
    assert.equal(h.calls[0].body.email, 'new@x.co'); assert.equal(h.calls[0].query.redirect_to, 'https://app.test/auth/confirmed');
    assert.equal((await h.post('/auth/password/register', { email: 'x@x.co', password: 'short' })).body.error, 'password_too_short');
    assert.equal(h.calls.length, 2, 'invalid input must not reach GoTrue');
  } finally { h.close(); }
});

test('login: unknown email and wrong password are indistinguishable; unconfirmed is refused; no app session without confirmation', async () => {
  const h = harness({ gotrue: { 'POST /token': ({ body }) => body.email === 'unconfirmed@x.co' ? { status: 400, data: { error_code: 'email_not_confirmed' } } : { status: 400, data: { error_code: 'invalid_credentials' } } } });
  try {
    const a = await h.post('/auth/password/login', { email: 'nobody@x.co', password: 'whatever-123' });
    const b = await h.post('/auth/password/login', { email: 'known@x.co', password: 'wrong-123456' });
    assert.equal(a.status, 401); assert.deepEqual(a.body, b.body);
    const c = await h.post('/auth/password/login', { email: 'unconfirmed@x.co', password: 'right-123456' });
    assert.equal(c.status, 403); assert.equal(c.body.error, 'email_not_confirmed'); assert.equal(h.rpcCalls.length, 0);
  } finally { h.close(); }
});

test('login: confirmed user gets the app JWT contract plus a server session id; the GoTrue session is discarded', async () => {
  const h = harness({
    gotrue: { 'POST /token': () => ({ status: 200, data: { access_token: 'gt-access', user: { id: '6f1c0e1e-0000-4000-8000-000000000001', email: 'a@x.co', email_confirmed_at: '2026-10-16T00:00:00Z' } } }) },
    rpc: { rpc_auth_password_session: () => ({ data: { user_id: -7, display_name: 'a', session_id: '11111111-2222-4333-8444-555555555555', expires_at: '2026-11-15T00:00:00Z' }, error: null }) },
  });
  try {
    const r = await h.post('/auth/password/login', { email: 'A@x.co', password: 'right-123456' });
    assert.equal(r.status, 200);
    const c = jwt.verify(r.body.token, SECRET);
    assert.equal(c.userId, -7); assert.equal(c.auth_channel, 'email'); assert.equal(c.auth_method, 'password'); assert.equal(c.sid, '11111111-2222-4333-8444-555555555555');
    assert.equal(c.exp - c.iat, 30 * 24 * 3600);
    assert.equal(h.rpcCalls[0].args.p_email_confirmed_at, '2026-10-16T00:00:00Z');
    await new Promise((x) => setTimeout(x, 20));
    assert.ok(h.calls.some((x) => x.path === '/logout' && x.auth === 'Bearer gt-access'), 'GoTrue session not discarded');
  } finally { h.close(); }
});

test('login: a refused identity link is reported, never worked around', async () => {
  const h = harness({
    gotrue: { 'POST /token': () => ({ status: 200, data: { access_token: 't', user: { id: '6f1c0e1e-0000-4000-8000-000000000002', email: 'u@x.co', email_confirmed_at: '2026-10-16T00:00:00Z' } } }) },
    rpc: { rpc_auth_password_session: () => ({ data: null, error: { message: 'auth_link_unverified_identity' } }) },
  });
  try {
    const r = await h.post('/auth/password/login', { email: 'u@x.co', password: 'right-123456' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'account_link_required'); assert.ok(!r.body.token);
  } finally { h.close(); }
});

test('login: failed attempts per account are throttled, successful sign-ins are not', async () => {
  let ok = false;
  const h = harness({
    gotrue: { 'POST /token': () => ok ? { status: 200, data: { access_token: 't', user: { id: '6f1c0e1e-0000-4000-8000-000000000003', email: 'b@x.co', email_confirmed_at: 'x' } } } : { status: 400, data: { error_code: 'invalid_credentials' } } },
    rpc: { rpc_auth_password_session: () => ({ data: { user_id: -8, session_id: '11111111-2222-4333-8444-555555555556' }, error: null }) },
  });
  try {
    ok = true; for (let i = 0; i < 15; i++) assert.equal((await h.post('/auth/password/login', { email: 'b@x.co', password: 'right-123456' })).status, 200);
    ok = false; const codes = []; for (let i = 0; i < 12; i++) codes.push((await h.post('/auth/password/login', { email: 'b@x.co', password: 'guess-' + i + '-xxxx' })).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(401)); assert.equal(codes[10], 429);
  } finally { h.close(); }
});

test('reset: only a fresh emailed-link session (amr otp/recovery) may set a password; a password session never; sessions are revoked', async () => {
  const user = { status: 200, data: { id: '6f1c0e1e-0000-4000-8000-000000000004' } };
  const h = harness({
    gotrue: { 'GET /user': () => user, 'PUT /user': () => ({ status: 200, data: {} }), 'POST /logout': () => ({ status: 204, data: null }) },
    rpc: { rpc_auth_revoke_all_sessions: () => ({ data: { revoked: 2 }, error: null }) },
  });
  try {
    const viaPassword = gotrueToken({ amr: [{ method: 'password' }] }), stale = gotrueToken({ amr: [{ method: 'otp' }], iat: Math.floor(Date.now() / 1000) - 7200 });
    assert.equal((await h.post('/auth/password/reset', { access_token: viaPassword, password: 'new-passphrase-1' })).status, 401);
    assert.equal((await h.post('/auth/password/reset', { access_token: stale, password: 'new-passphrase-1' })).status, 401);
    assert.ok(!h.calls.some((c) => c.method === 'PUT'), 'password changed with a non-link session');
    const r = await h.post('/auth/password/reset', { access_token: gotrueToken({ amr: [{ method: 'otp' }] }), password: 'new-passphrase-1' });
    assert.equal(r.status, 200); assert.equal(r.body.sessions_revoked, true);
    assert.deepEqual(h.rpcCalls.at(-1), { name: 'rpc_auth_revoke_all_sessions', args: { p_auth_user_id: user.data.id, p_reason: 'password_reset' } });
    assert.ok(h.calls.some((c) => c.path === '/logout' && c.query.scope === 'global'));
  } finally { h.close(); }
});

test('forgot and resend: same answer for unknown addresses and inside GoTrue\'s email interval', async () => {
  const h = harness({ gotrue: { 'POST /recover': ({ body }) => body.email === 'soon@x.co' ? { status: 429, data: { error_code: 'over_email_send_rate_limit' } } : { status: 200, data: {} }, 'POST /resend': () => ({ status: 200, data: {} }) } });
  try {
    for (const email of ['nobody@x.co', 'soon@x.co']) assert.deepEqual((await h.post('/auth/password/forgot', { email })).body, { ok: true });
    assert.equal(h.calls.find((c) => c.path === '/recover').query.redirect_to, 'https://app.test/auth/reset');
    assert.deepEqual((await h.post('/auth/password/resend', { email: 'a@x.co' })).body, { ok: true });
    assert.equal(h.calls.find((c) => c.path === '/resend').body.type, 'signup');
  } finally { h.close(); }
});

test('logout ends the server session of a password token; other channels end on the client', async () => {
  const h = harness({ rpc: { rpc_auth_end_session: () => ({ data: { revoked: 1 }, error: null }) } });
  try {
    const pw = jwt.sign({ userId: -9, auth_channel: 'email', auth_method: 'password', sid: '11111111-2222-4333-8444-555555555557' }, SECRET);
    assert.deepEqual((await h.post('/auth/logout', {}, pw)).body, { ok: true, revoked: 1 });
    assert.deepEqual(h.rpcCalls[0].args, { p_user_id: -9, p_session_id: '11111111-2222-4333-8444-555555555557' });
    const tg = jwt.sign({ userId: 5, auth_channel: 'telegram' }, SECRET);
    assert.deepEqual((await h.post('/auth/logout', {}, tg)).body, { ok: true, revoked: 0 });
  } finally { h.close(); }
});
