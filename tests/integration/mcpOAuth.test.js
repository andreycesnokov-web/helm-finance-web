// CFO Finance MCP OAuth — the full "Sign in with CFO Finance" flow over real HTTP, driven
// through the official MCP SDK auth router (discovery, dynamic client registration, authorize,
// PKCE, token, revoke) with our provider, the consent API and an in-memory store that mirrors
// the production conditional-update semantics. The clock is injected so expiry is testable.
//
// What must hold:
//   * a client can only register Claude / ChatGPT / loopback callbacks, and never gets a secret;
//   * only a signed-in CFO user can approve, and the tokens belong to THAT user;
//   * PKCE is enforced, codes are single-use and short-lived, redirect_uri must match;
//   * refresh tokens rotate, and replaying an old one revokes the whole grant;
//   * revoked / expired / foreign-resource tokens cannot call /mcp;
//   * with MCP_OAUTH_ENABLED off, none of this exists.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { attachMcp } = require('../../server/mcp');
const { createMemoryOAuthStore } = require('../../server/mcp/oauth/store');
const { redirectUriAllowed } = require('../../server/mcp/oauth/provider');
const { clientKey } = require('../../server/mcp/oauth');

const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const OWNER = -1;

let server; let base; let store; let clock; const events = []; const calls = [];
const ENV_KEYS = ['MCP_SERVER_ENABLED', 'MCP_OAUTH_ENABLED', 'MCP_PUBLIC_BASE_URL', 'MCP_DEV_TOKEN', 'MCP_ALLOW_UNAUTHENTICATED', 'MCP_WRITE_TOOLS_ENABLED'];
const savedEnv = {};

// Stand-in for the web app's JWT middleware: the test says who is signed in.
function fakeAuth(req, res, next) {
  const uid = req.headers['x-test-user'];
  if (!uid) return res.status(401).json({ error: 'No token' });
  req.user = { userId: Number(uid) };
  next();
}
const services = {
  listAccessibleWorkspaces: async (uid) => { calls.push(['list', uid]); return [{ role: 'owner', businesses: { id: 'biz-a', name: 'Helm Care Indonesia', type: 'business' } }]; },
  findDefaultBusiness: async () => ({ business: { id: 'biz-a' } }),
};

before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  store = createMemoryOAuthStore();
  clock = Date.UTC(2026, 9, 1, 12, 0, 0);
  const app = express();
  app.use(express.json());
  attachMcp(app, { JWT_SECRET: 'test-secret', oauthStore: store, auth: fakeAuth, now: () => clock,
    onOAuthEvent: (e) => events.push(e), services });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
beforeEach(() => {
  process.env.MCP_SERVER_ENABLED = 'true';
  process.env.MCP_OAUTH_ENABLED = 'true';
  process.env.MCP_PUBLIC_BASE_URL = base;
  delete process.env.MCP_DEV_TOKEN; delete process.env.MCP_ALLOW_UNAUTHENTICATED;
  delete process.env.MCP_WRITE_TOOLS_ENABLED;
});

/* ── helpers ──────────────────────────────────────────────────────────────── */
function request(method, path, { json, form, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const body = json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : null;
    const h = { ...headers };
    if (json) h['content-type'] = 'application/json';
    if (form) h['content-type'] = 'application/x-www-form-urlencoded';
    if (body) h['content-length'] = Buffer.byteLength(body);
    const req = http.request(base + path, { method, headers: h }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let data = null; try { data = JSON.parse(buf); } catch {
          const line = buf.split('\n').find((l) => l.startsWith('data:'));
          if (line) { try { data = JSON.parse(line.slice(5)); } catch { /* raw */ } }
        }
        resolve({ status: res.statusCode, headers: res.headers, data, raw: buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
async function registerClaude() {
  const r = await request('POST', '/register', { json: {
    client_name: 'Claude', redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  } });
  assert.strictEqual(r.status, 201, r.raw);
  return r.data;
}
async function startAuthorize(clientId, { challenge, scope = 'cfo:read', state = 'st-1', resource } = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE_CB,
    code_challenge: challenge, code_challenge_method: 'S256', state, ...(scope ? { scope } : {}),
    ...(resource ? { resource } : {}) });
  return request('GET', `/authorize?${q}`);
}
async function consent(requestId, approve, user = OWNER) {
  return request('POST', `/api/mcp-oauth/requests/${encodeURIComponent(requestId)}/decision`,
    { json: { approve }, headers: { 'x-test-user': String(user) } });
}
const requestIdFrom = (location) => new URL(location).searchParams.get('request');
async function fullGrant(user = OWNER, scope = 'cfo:read') {
  const client = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge, scope });
  const c = await consent(requestIdFrom(a.headers.location), true, user);
  const code = new URL(c.data.redirect_to).searchParams.get('code');
  const t = await request('POST', '/token', { form: { grant_type: 'authorization_code', code,
    code_verifier: p.verifier, client_id: client.client_id, redirect_uri: CLAUDE_CB } });
  assert.strictEqual(t.status, 200, t.raw);
  return { client, tokens: t.data, code, verifier: p.verifier };
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
const mcp = (token, body = INIT) => request('POST', '/mcp', { json: body,
  headers: { accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

/* ── discovery ────────────────────────────────────────────────────────────── */
test('discovery: authorization-server and protected-resource metadata point at this server', async () => {
  const as = await request('GET', '/.well-known/oauth-authorization-server');
  assert.strictEqual(as.status, 200);
  assert.strictEqual(as.data.authorization_endpoint, `${base}/authorize`);
  assert.strictEqual(as.data.token_endpoint, `${base}/token`);
  assert.strictEqual(as.data.registration_endpoint, `${base}/register`);
  assert.deepStrictEqual(as.data.code_challenge_methods_supported, ['S256']);
  const rs = await request('GET', '/.well-known/oauth-protected-resource/mcp');
  assert.strictEqual(rs.status, 200);
  assert.strictEqual(rs.data.resource, `${base}/mcp`);
  assert.deepStrictEqual(rs.data.scopes_supported, ['cfo:read', 'cfo:drafts']);
});

test('/mcp without a token answers 401 and tells the client where to sign in', async () => {
  const r = await mcp(null);
  assert.strictEqual(r.status, 401);
  assert.match(r.headers['www-authenticate'], new RegExp(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`));
});

/* ── registration ─────────────────────────────────────────────────────────── */
test('registration: only Claude / ChatGPT / loopback callbacks, and never a client secret', async () => {
  const evil = await request('POST', '/register', { json: { client_name: 'x', redirect_uris: ['https://evil.example/cb'] } });
  assert.strictEqual(evil.status, 400);
  assert.strictEqual(evil.data.error, 'invalid_client_metadata');
  const ok = await registerClaude();
  assert.ok(ok.client_id);
  assert.strictEqual(ok.client_secret, undefined, 'a client secret was issued');
  assert.strictEqual(ok.token_endpoint_auth_method, 'none');
  assert.strictEqual(JSON.stringify(store._tables.clients.get(ok.client_id)).includes('client_secret"'), false);
});

test('redirect allowlist unit', () => {
  for (const u of [CLAUDE_CB, 'https://claude.com/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost:33418/callback', 'http://127.0.0.1:9/cb']) assert.ok(redirectUriAllowed(u), u);
  for (const u of ['http://claude.ai/api/mcp/auth_callback', 'https://claude.ai.evil.com/cb', 'https://evil.com/claude.ai',
    'javascript:alert(1)', 'https://claude.ai/cb#frag', 'not a url']) assert.ok(!redirectUriAllowed(u), u);
});

/* ── authorize + consent ──────────────────────────────────────────────────── */
test('authorize sends the user to the CFO consent page; only a signed-in user can read or decide', async () => {
  const client = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge });
  assert.strictEqual(a.status, 302);
  assert.ok(a.headers.location.startsWith(`${base}/oauth/consent?request=`), a.headers.location);
  const id = requestIdFrom(a.headers.location);

  assert.strictEqual((await request('GET', `/api/mcp-oauth/requests/${id}`)).status, 401);
  const view = await request('GET', `/api/mcp-oauth/requests/${id}`, { headers: { 'x-test-user': String(OWNER) } });
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.data.client_name, 'Claude');
  assert.strictEqual(view.data.redirect_host, 'claude.ai');
  assert.deepStrictEqual(view.data.scopes.map((s) => s.scope), ['cfo:read']);

  assert.strictEqual((await request('POST', `/api/mcp-oauth/requests/${id}/decision`, { json: { approve: true } })).status, 401);
  const c = await consent(id, true);
  const back = new URL(c.data.redirect_to);
  assert.strictEqual(back.origin + back.pathname, CLAUDE_CB);
  assert.ok(back.searchParams.get('code'));
  assert.strictEqual(back.searchParams.get('state'), 'st-1');
  // Decided once.
  assert.strictEqual((await consent(id, true)).status, 410);
  assert.ok(events.some((e) => e.action === 'consent_granted' && e.user_id === OWNER));
});

test('deny returns access_denied to the client and issues no code', async () => {
  const client = await registerClaude();
  const a = await startAuthorize(client.client_id, { challenge: pkce().challenge, state: 'st-deny' });
  const c = await consent(requestIdFrom(a.headers.location), false);
  const back = new URL(c.data.redirect_to);
  assert.strictEqual(back.searchParams.get('error'), 'access_denied');
  assert.strictEqual(back.searchParams.get('code'), null);
  assert.strictEqual(back.searchParams.get('state'), 'st-deny');
});

test('unsupported scope and a foreign resource are refused at authorize', async () => {
  const client = await registerClaude();
  const s = await startAuthorize(client.client_id, { challenge: pkce().challenge, scope: 'cfo:write' });
  assert.strictEqual(new URL(s.headers.location).searchParams.get('error'), 'invalid_scope');
  const r = await startAuthorize(client.client_id, { challenge: pkce().challenge, resource: 'https://other.example/mcp' });
  assert.strictEqual(new URL(r.headers.location).searchParams.get('error'), 'invalid_target');
});

test('a consent request expires', async () => {
  const client = await registerClaude();
  const a = await startAuthorize(client.client_id, { challenge: pkce().challenge });
  clock += 11 * 60 * 1000;
  try { assert.strictEqual((await consent(requestIdFrom(a.headers.location), true)).status, 410); }
  finally { clock -= 11 * 60 * 1000; }
});

/* ── token endpoint ───────────────────────────────────────────────────────── */
test('PKCE is enforced, the code is single-use, and the tokens belong to the approving user', async () => {
  const client = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge });
  const c = await consent(requestIdFrom(a.headers.location), true, OWNER);
  const code = new URL(c.data.redirect_to).searchParams.get('code');
  const form = { grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: CLAUDE_CB };

  const bad = await request('POST', '/token', { form: { ...form, code_verifier: pkce().verifier } });
  assert.strictEqual(bad.status, 400); assert.strictEqual(bad.data.error, 'invalid_grant');
  const ok = await request('POST', '/token', { form: { ...form, code_verifier: p.verifier } });
  assert.strictEqual(ok.status, 200, ok.raw);
  assert.ok(ok.data.access_token && ok.data.refresh_token);
  assert.strictEqual(ok.data.scope, 'cfo:read');
  const again = await request('POST', '/token', { form: { ...form, code_verifier: p.verifier } });
  assert.strictEqual(again.status, 400, 'a code was accepted twice');

  // Only hashes are stored.
  const stored = JSON.stringify([...store._tables.tokens.values(), ...store._tables.codes.values()]);
  assert.ok(!stored.includes(ok.data.access_token) && !stored.includes(code), 'plaintext secret in the store');
  const row = [...store._tables.tokens.values()].find((t) => t.kind === 'access' && t.client_id === client.client_id);
  assert.strictEqual(row.user_id, OWNER);
});

test('a code bound to one client or redirect cannot be redeemed with another', async () => {
  const { client } = { client: await registerClaude() };
  const other = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge });
  const code = new URL((await consent(requestIdFrom(a.headers.location), true)).data.redirect_to).searchParams.get('code');
  const foreign = await request('POST', '/token', { form: { grant_type: 'authorization_code', code,
    code_verifier: p.verifier, client_id: other.client_id, redirect_uri: CLAUDE_CB } });
  assert.strictEqual(foreign.status, 400);
  const wrongRedirect = await request('POST', '/token', { form: { grant_type: 'authorization_code', code,
    code_verifier: p.verifier, client_id: client.client_id, redirect_uri: 'https://claude.com/api/mcp/auth_callback' } });
  assert.strictEqual(wrongRedirect.status, 400);
});

test('an authorization code expires after 5 minutes', async () => {
  const client = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge });
  const code = new URL((await consent(requestIdFrom(a.headers.location), true)).data.redirect_to).searchParams.get('code');
  clock += 6 * 60 * 1000;
  try {
    const t = await request('POST', '/token', { form: { grant_type: 'authorization_code', code,
      code_verifier: p.verifier, client_id: client.client_id, redirect_uri: CLAUDE_CB } });
    assert.strictEqual(t.status, 400);
  } finally { clock -= 6 * 60 * 1000; }
});

/* ── using the token on /mcp ──────────────────────────────────────────────── */
test('the access token opens /mcp as the approving CFO user', async () => {
  const { tokens } = await fullGrant(OWNER);
  assert.strictEqual((await mcp(tokens.access_token)).status, 200);
  calls.length = 0;
  const r = await mcp(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'get_company_context', arguments: {} } });
  assert.strictEqual(r.status, 200, r.raw);
  assert.deepStrictEqual(calls[0], ['list', OWNER], 'tools ran as someone other than the approving user');
});

test('an expired access token is refused with invalid_token', async () => {
  const { tokens } = await fullGrant();
  clock += 61 * 60 * 1000;
  try {
    const r = await mcp(tokens.access_token);
    assert.strictEqual(r.status, 401);
    assert.match(r.headers['www-authenticate'], /error="invalid_token"/);
  } finally { clock -= 61 * 60 * 1000; }
});

test('refresh rotates; replaying the old refresh token revokes the whole grant', async () => {
  const { client, tokens } = await fullGrant();
  const r1 = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, client_id: client.client_id } });
  assert.strictEqual(r1.status, 200, r1.raw);
  assert.notStrictEqual(r1.data.refresh_token, tokens.refresh_token);
  assert.strictEqual((await mcp(r1.data.access_token)).status, 200);

  const replay = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, client_id: client.client_id } });
  assert.strictEqual(replay.status, 400);
  // The thief's replay killed every token of that consent, including the fresh ones.
  assert.strictEqual((await mcp(r1.data.access_token)).status, 401);
  const r2 = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: r1.data.refresh_token, client_id: client.client_id } });
  assert.strictEqual(r2.status, 400);
  assert.ok(events.some((e) => e.action === 'refresh_reuse_detected'));
});

test('a refresh cannot widen scope', async () => {
  const { client, tokens } = await fullGrant();
  const r = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, client_id: client.client_id, scope: 'cfo:read cfo:write' } });
  assert.strictEqual(r.status, 400);
});

test('revoking the token disconnects the client', async () => {
  const { client, tokens } = await fullGrant();
  const rv = await request('POST', '/revoke', { form: { token: tokens.access_token, client_id: client.client_id } });
  assert.strictEqual(rv.status, 200, rv.raw);
  assert.strictEqual((await mcp(tokens.access_token)).status, 401);
  const rf = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, client_id: client.client_id } });
  assert.strictEqual(rf.status, 400, 'refresh still worked after revocation');
});

test('a random or JWT-shaped bearer is not an OAuth token', async () => {
  assert.strictEqual((await mcp(crypto.randomBytes(32).toString('base64url'))).status, 401);
  assert.strictEqual((await mcp('a.b.c')).status, 401);
});

/* ── write scope (cfo:drafts) ────────────────────────────────────────────── */
const toolNames = async (token) => {
  const r = await mcp(token, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  assert.strictEqual(r.status, 200, r.raw);
  return r.data.result.tools.map((t) => t.name);
};

test('a grant made under the read-only consent never gets the write tool, even after write tools are turned on', async () => {
  const { client, tokens } = await fullGrant(OWNER, ''); // no scope requested, write tools OFF
  assert.strictEqual(tokens.scope, 'cfo:read');
  process.env.MCP_WRITE_TOOLS_ENABLED = 'true';
  const names = await toolNames(tokens.access_token);
  assert.strictEqual(names.length, 4);
  assert.ok(!names.includes('submit_invoice_draft'), 'read-only grant can write');
  // Refreshing that grant cannot pick the write scope up either.
  const rf = await request('POST', '/token', { form: { grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token, client_id: client.client_id, scope: 'cfo:read cfo:drafts' } });
  assert.strictEqual(rf.status, 400, rf.raw);
  assert.strictEqual(rf.data.error, 'invalid_scope');
});

test('with write tools on, the consent page lists cfo:drafts and that grant sees submit_invoice_draft', async () => {
  process.env.MCP_WRITE_TOOLS_ENABLED = 'true';
  const client = await registerClaude();
  const p = pkce();
  const a = await startAuthorize(client.client_id, { challenge: p.challenge, scope: '' });
  const id = requestIdFrom(a.headers.location);
  const view = await request('GET', `/api/mcp-oauth/requests/${id}`, { headers: { 'x-test-user': String(OWNER) } });
  assert.deepStrictEqual(view.data.scopes.map((s) => s.scope), ['cfo:read', 'cfo:drafts']);
  assert.match(view.data.scopes[1].description, /approval/);
  const c = await consent(id, true);
  const code = new URL(c.data.redirect_to).searchParams.get('code');
  const t = await request('POST', '/token', { form: { grant_type: 'authorization_code', code,
    code_verifier: p.verifier, client_id: client.client_id, redirect_uri: CLAUDE_CB } });
  assert.strictEqual(t.data.scope, 'cfo:read cfo:drafts');
  assert.ok((await toolNames(t.data.access_token)).includes('submit_invoice_draft'));
  // Turning the server flag off hides the tool again, whatever the grant says.
  delete process.env.MCP_WRITE_TOOLS_ENABLED;
  assert.ok(!(await toolNames(t.data.access_token)).includes('submit_invoice_draft'));
});

test('cfo:drafts is not granted while write tools are off, even when the client asks for it', async () => {
  const client = await registerClaude();
  const a = await startAuthorize(client.client_id, { challenge: pkce().challenge, scope: 'cfo:read cfo:drafts' });
  const view = await request('GET', `/api/mcp-oauth/requests/${requestIdFrom(a.headers.location)}`,
    { headers: { 'x-test-user': String(OWNER) } });
  assert.deepStrictEqual(view.data.scopes.map((s) => s.scope), ['cfo:read']);
  // An explicit read-only request stays read-only when write tools are on.
  process.env.MCP_WRITE_TOOLS_ENABLED = 'true';
  const b = await startAuthorize(client.client_id, { challenge: pkce().challenge, scope: 'cfo:read' });
  const vb = await request('GET', `/api/mcp-oauth/requests/${requestIdFrom(b.headers.location)}`,
    { headers: { 'x-test-user': String(OWNER) } });
  assert.deepStrictEqual(vb.data.scopes.map((s) => s.scope), ['cfo:read']);
});

/* ── off switch ───────────────────────────────────────────────────────────── */
test('with MCP_OAUTH_ENABLED off nothing OAuth exists, and /mcp sends no sign-in hint', async () => {
  delete process.env.MCP_OAUTH_ENABLED;
  assert.notStrictEqual((await request('GET', '/.well-known/oauth-authorization-server')).status, 200);
  assert.notStrictEqual((await request('POST', '/register', { json: { redirect_uris: [CLAUDE_CB] } })).status, 201);
  assert.strictEqual((await request('GET', '/api/mcp-oauth/requests/x', { headers: { 'x-test-user': '-1' } })).status, 404);
  const r = await mcp(null);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.headers['www-authenticate'], undefined);
});

/* ── rate-limit key behind the proxy ─────────────────────────────────────── */
test('rate-limit key uses the proxy-appended client IP, not a spoofed first entry', () => {
  assert.strictEqual(clientKey({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, socket: {} }), '203.0.113.9');
  assert.strictEqual(clientKey({ headers: {}, socket: { remoteAddress: '::ffff:198.51.100.4' } }), '198.51.100.4');
  assert.strictEqual(clientKey({ headers: { 'x-forwarded-for': '2001:db8:1:2:3:4:5:6' }, socket: {} }), '2001:db8:1:2::/64');
});
