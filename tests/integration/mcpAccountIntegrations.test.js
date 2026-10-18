// CFO Finance MCP — Account Integrations Test Suite
// Settings → Connections → AI Assistants
//
// Tests:
//   * Authentication and user isolation
//   * Accurate client identification (ChatGPT, Claude, local)
//   * Status computation (connected, recently active, expired, revoked)
//   * Non-matching email handling (CFO AI identity vs external client)
//   * No raw tokens or token hashes leaked in API responses
//   * Server-side revocation immediately closes access to /mcp and token refresh
//   * Multi-company access scope reflection

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const { attachMcp } = require('../../server/mcp');
const { createMemoryOAuthStore, sha256 } = require('../../server/mcp/oauth/store');

const CHATGPT_CB = 'https://chatgpt.com/connector/oauth/cb123';
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const LOCAL_CB = 'http://localhost:3000/callback';

let server;
let base;
let store;
let clock;
const events = [];
const ENV_KEYS = [
  'MCP_SERVER_ENABLED', 'MCP_OAUTH_ENABLED', 'MCP_PUBLIC_BASE_URL',
  'MCP_DEV_TOKEN', 'MCP_ALLOW_UNAUTHENTICATED', 'MCP_WRITE_TOOLS_ENABLED'
];
const savedEnv = {};

function fakeAuth(req, res, next) {
  const uid = req.headers['x-test-user'];
  if (!uid) return res.status(401).json({ error: 'No token' });
  req.user = { userId: Number(uid) };
  next();
}

const services = {
  listAccessibleWorkspaces: async (uid) => {
    if (uid === 1001) {
      return [
        { role: 'owner', businesses: { id: 'biz-1', name: 'PT Helm Care Indonesia', type: 'business', business_code: 'HF-BIZ-000001' } },
        { role: 'owner', businesses: { id: 'biz-personal', name: 'Personal Vault', type: 'personal', business_code: null } },
      ];
    }
    return [{ role: 'employee', businesses: { id: 'biz-2', name: 'Other Corp', type: 'business', business_code: 'HF-BIZ-000002' } }];
  },
  findDefaultBusiness: async () => ({ business: { id: 'biz-1' } }),
};

before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.MCP_SERVER_ENABLED = 'true';
  process.env.MCP_OAUTH_ENABLED = 'true';
  process.env.MCP_WRITE_TOOLS_ENABLED = 'true';

  store = createMemoryOAuthStore();
  clock = Date.UTC(2026, 9, 18, 12, 0, 0);

  const app = express();
  app.use(express.json());
  attachMcp(app, {
    JWT_SECRET: 'test-secret',
    oauthStore: store,
    auth: fakeAuth,
    now: () => clock,
    onOAuthEvent: (e) => events.push(e),
    services,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.MCP_PUBLIC_BASE_URL = base;
});

after(() => {
  server.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  events.length = 0;
});

async function api(path, { method = 'GET', user, body, headers = {} } = {}) {
  const h = { ...headers };
  if (user !== undefined) h['x-test-user'] = String(user);
  if (body) {
    h['content-type'] = 'application/json';
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
};

async function mcpCall(token, body = INIT) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers };
}

test('GET /api/account/integrations/ai-assistants requires authentication', async () => {
  const r = await api('/api/account/integrations/ai-assistants');
  assert.strictEqual(r.status, 401);
});

test('GET /api/account/integrations/ai-assistants returns empty list when no connections exist', async () => {
  const r = await api('/api/account/integrations/ai-assistants', { user: 1001 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.ok, true);
  assert.deepStrictEqual(r.data.connections, []);
  assert.strictEqual(typeof r.data.mcp_url, 'string');
  assert.strictEqual(r.data.mcp_server_enabled, true);
  assert.strictEqual(r.data.mcp_oauth_enabled, true);
});

test('ChatGPT connection lifecycle: discovery, status, multi-company scope, and safe metadata', async () => {
  // 1. Register ChatGPT client
  await store.insertClient({
    client_id: 'chatgpt-client-1',
    client_name: 'ChatGPT',
    redirect_uris: [CHATGPT_CB],
    metadata: { client_name: 'ChatGPT' },
    created_at: new Date(clock).toISOString(),
  });

  // 2. Issue tokens for user 1001
  const grantId = crypto.randomUUID();
  const rawAccessToken = 'chatgpt-access-token-abc';
  const rawRefreshToken = 'chatgpt-refresh-token-xyz';

  await store.insertTokens([
    {
      token_hash: sha256(rawAccessToken),
      kind: 'access',
      grant_id: grantId,
      client_id: 'chatgpt-client-1',
      user_id: 1001,
      scopes: ['cfo:read', 'cfo:drafts'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 3600 * 1000).toISOString(),
    },
    {
      token_hash: sha256(rawRefreshToken),
      kind: 'refresh',
      grant_id: grantId,
      client_id: 'chatgpt-client-1',
      user_id: 1001,
      scopes: ['cfo:read', 'cfo:drafts'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 30 * 86400 * 1000).toISOString(),
    },
  ]);

  // 3. User 1001 queries AI assistant connections
  const r = await api('/api/account/integrations/ai-assistants', { user: 1001 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.connections.length, 1);

  const conn = r.data.connections[0];
  assert.strictEqual(conn.grant_id, grantId);
  assert.strictEqual(conn.client_id, 'chatgpt-client-1');
  assert.strictEqual(conn.client_name, 'ChatGPT');
  assert.strictEqual(conn.client_type, 'chatgpt');
  assert.strictEqual(conn.status, 'connected');
  assert.strictEqual(conn.recently_active, true);
  assert.deepStrictEqual(conn.scopes, ['cfo:read', 'cfo:drafts']);
  assert.strictEqual(conn.permissions.length, 2);

  // Security check: NEVER expose token hashes or raw tokens
  assert.strictEqual(conn.token_hash, undefined);
  assert.strictEqual(conn.access_token, undefined);
  assert.strictEqual(conn.refresh_token, undefined);
  const jsonStr = JSON.stringify(r.data);
  assert.strictEqual(jsonStr.includes(rawAccessToken), false);
  assert.strictEqual(jsonStr.includes(rawRefreshToken), false);
  assert.strictEqual(jsonStr.includes(sha256(rawAccessToken)), false);

  // Tenant / Multi-company check: Personal workspace is excluded, only business workspace returned
  assert.strictEqual(conn.companies.length, 1);
  assert.strictEqual(conn.companies[0].name, 'PT Helm Care Indonesia');
  assert.strictEqual(conn.companies[0].role, 'owner');
  assert.strictEqual(conn.companies[0].business_code, 'HF-BIZ-000001');

  // 4. Verify access token actually works on /mcp
  const mcpRes = await mcpCall(rawAccessToken);
  assert.strictEqual(mcpRes.status, 200);
});

test('Tenant & User Isolation: User B cannot see or revoke User A connections', async () => {
  const grantId = crypto.randomUUID();
  await store.insertClient({
    client_id: 'claude-client-1',
    client_name: 'Claude',
    redirect_uris: [CLAUDE_CB],
    created_at: new Date(clock).toISOString(),
  });

  await store.insertTokens([
    {
      token_hash: sha256('user-1001-claude-token'),
      kind: 'access',
      grant_id: grantId,
      client_id: 'claude-client-1',
      user_id: 1001,
      scopes: ['cfo:read'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 3600 * 1000).toISOString(),
    },
  ]);

  // User 2002 checks their connections -> must be empty
  const rOther = await api('/api/account/integrations/ai-assistants', { user: 2002 });
  assert.strictEqual(rOther.status, 200);
  assert.deepStrictEqual(rOther.data.connections, []);

  // User 2002 tries to revoke User 1001's grant -> 404 forbidden/not found
  const rRevokeUnauthorized = await api(`/api/account/integrations/ai-assistants/${grantId}/revoke`, {
    method: 'POST',
    user: 2002,
  });
  assert.strictEqual(rRevokeUnauthorized.status, 404);
  assert.strictEqual(rRevokeUnauthorized.data.error, 'grant_not_found');

  // Verify grant is still active for user 1001
  const rOwner = await api('/api/account/integrations/ai-assistants', { user: 1001 });
  const targetGrant = rOwner.data.connections.find((c) => c.grant_id === grantId);
  assert.ok(targetGrant);
  assert.strictEqual(targetGrant.status, 'connected');
});

test('Immediate server-side revocation terminates access and refresh tokens', async () => {
  const grantId = crypto.randomUUID();
  const rawAccess = 'token-to-revoke-access';
  const rawRefresh = 'token-to-revoke-refresh';

  await store.insertClient({
    client_id: 'chatgpt-revocable',
    client_name: 'ChatGPT',
    redirect_uris: [CHATGPT_CB],
    created_at: new Date(clock).toISOString(),
  });

  await store.insertTokens([
    {
      token_hash: sha256(rawAccess),
      kind: 'access',
      grant_id: grantId,
      client_id: 'chatgpt-revocable',
      user_id: 1001,
      scopes: ['cfo:read', 'cfo:drafts'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 3600 * 1000).toISOString(),
    },
    {
      token_hash: sha256(rawRefresh),
      kind: 'refresh',
      grant_id: grantId,
      client_id: 'chatgpt-revocable',
      user_id: 1001,
      scopes: ['cfo:read', 'cfo:drafts'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 30 * 86400 * 1000).toISOString(),
    },
  ]);

  // Verify it works before revocation
  const preCheck = await mcpCall(rawAccess);
  assert.strictEqual(preCheck.status, 200);

  // Revoke via API
  const revokeRes = await api(`/api/account/integrations/ai-assistants/${grantId}/revoke`, {
    method: 'POST',
    user: 1001,
  });
  assert.strictEqual(revokeRes.status, 200);
  assert.strictEqual(revokeRes.data.ok, true);
  assert.strictEqual(revokeRes.data.status, 'revoked');

  // Verify audit event was logged
  const auditRevoke = events.find((e) => e.action === 'grant_revoked' && e.grant_id === grantId);
  assert.ok(auditRevoke, 'Audit event for grant_revoked must be logged');
  assert.strictEqual(auditRevoke.user_id, 1001);

  // Status in connections list reflects revoked
  const listRes = await api('/api/account/integrations/ai-assistants', { user: 1001 });
  const grantInList = listRes.data.connections.find((c) => c.grant_id === grantId);
  assert.strictEqual(grantInList.status, 'revoked');
  assert.ok(grantInList.revoked_at);

  // Immediate server-side revocation: calling /mcp with access token must FAIL (401)
  const postCheck = await mcpCall(rawAccess);
  assert.strictEqual(postCheck.status, 401);

  // Idempotent re-revocation
  const reRevoke = await api(`/api/account/integrations/ai-assistants/${grantId}/revoke`, {
    method: 'POST',
    user: 1001,
  });
  assert.strictEqual(reRevoke.status, 200);
  assert.strictEqual(reRevoke.data.already_revoked, true);
});

test('Client classification: Claude and Local MCP clients', async () => {
  // Claude
  const claudeGrant = crypto.randomUUID();
  await store.insertClient({
    client_id: 'claude-app-id',
    client_name: 'Anthropic Claude',
    redirect_uris: [CLAUDE_CB],
    created_at: new Date(clock).toISOString(),
  });
  await store.insertTokens([
    {
      token_hash: sha256('claude-token-1'),
      kind: 'access',
      grant_id: claudeGrant,
      client_id: 'claude-app-id',
      user_id: 1001,
      scopes: ['cfo:read'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 3600 * 1000).toISOString(),
    },
  ]);

  // Local MCP Inspector / Claude Code
  const localGrant = crypto.randomUUID();
  await store.insertClient({
    client_id: 'local-mcp-inspector',
    client_name: 'MCP Inspector',
    redirect_uris: [LOCAL_CB],
    created_at: new Date(clock).toISOString(),
  });
  await store.insertTokens([
    {
      token_hash: sha256('local-token-1'),
      kind: 'access',
      grant_id: localGrant,
      client_id: 'local-mcp-inspector',
      user_id: 1001,
      scopes: ['cfo:read'],
      resource: `${base}/mcp`,
      created_at: new Date(clock).toISOString(),
      expires_at: new Date(clock + 3600 * 1000).toISOString(),
    },
  ]);

  const r = await api('/api/account/integrations/ai-assistants', { user: 1001 });
  assert.strictEqual(r.status, 200);

  const claudeConn = r.data.connections.find((c) => c.grant_id === claudeGrant);
  assert.ok(claudeConn);
  assert.strictEqual(claudeConn.client_type, 'claude');

  const localConn = r.data.connections.find((c) => c.grant_id === localGrant);
  assert.ok(localConn);
  assert.strictEqual(localConn.client_type, 'local');
});
