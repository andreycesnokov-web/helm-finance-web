// CFO Finance MCP OAuth — the OAuthServerProvider the official MCP SDK auth router calls.
//
// The SDK (`@modelcontextprotocol/sdk/server/auth`) implements the protocol: discovery
// metadata, dynamic client registration, the authorize endpoint's parameter/redirect checks,
// PKCE (S256) verification and the token endpoint. This module supplies only what is ours:
//   * which clients may register (redirect-URI allowlist) — and they are always PUBLIC clients;
//   * the authorize step = hand the user to the CFO consent page (existing CFO login);
//   * issuing, rotating, verifying and revoking tokens bound to a CFO user.
//
// Nothing secret is stored in clear: codes and tokens are SHA-256 hashed (see store.js).

const crypto = require('crypto');
const { sha256 } = require('./store');

// cfo:read   — the Phase-1 read tools.
// cfo:drafts — create PENDING-APPROVAL drafts (submit_invoice_draft). Never confirmed records,
//              never payments. Granted only while MCP_WRITE_TOOLS_ENABLED is on, so the consent
//              page never shows the user a capability the server would not actually offer, and a
//              grant made under a read-only consent can never be used to write.
const SCOPES = Object.freeze({ READ: 'cfo:read', DRAFTS: 'cfo:drafts' });
const SUPPORTED_SCOPES = [SCOPES.READ, SCOPES.DRAFTS];
const draftsEnabledFromEnv = () => process.env.MCP_WRITE_TOOLS_ENABLED === 'true';

// What this authorization actually grants. Unknown scopes were already refused. cfo:read is
// always included (every token must be able to identify the company it acts in); cfo:drafts
// only when write tools are on — requested explicitly, or by default when nothing is requested.
function grantedScopes(requested, draftsEnabled) {
  const wantsDrafts = requested.length ? requested.includes(SCOPES.DRAFTS) : true;
  return draftsEnabled && wantsDrafts ? [SCOPES.READ, SCOPES.DRAFTS] : [SCOPES.READ];
}

const TTL = Object.freeze({
  requestSeconds: 10 * 60,       // consent page must be completed within 10 minutes
  codeSeconds: 5 * 60,           // authorization code lifetime
  accessSeconds: 60 * 60,        // access token: 1 hour
  refreshSeconds: 30 * 24 * 3600 // refresh token: 30 days, rotated on every use
});

// Where an AI client may send the user back. Anything else cannot register.
// Claude: https://claude.ai/api/mcp/auth_callback (and the announced claude.com variant).
// ChatGPT: chatgpt.com / chat.openai.com connector callbacks. Loopback: Claude Code, MCP
// Inspector and other native clients (RFC 8252 — any port, http allowed only on loopback).
const ALLOWED_HTTPS_HOSTS = new Set(['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function redirectUriAllowed(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:' && ALLOWED_HTTPS_HOSTS.has(u.hostname)) return true;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname)) return true;
  return false;
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const epochSeconds = (ms) => Math.floor(ms / 1000);
const isoIn = (nowMs, seconds) => new Date(nowMs + seconds * 1000).toISOString();
const expired = (iso, nowMs) => new Date(iso).getTime() <= nowMs;

/**
 * @param {object} opts
 * @param {object} opts.store            store.js implementation
 * @param {string} opts.resourceUrl      canonical MCP resource, e.g. https://app.cfo-ai.site/mcp
 * @param {(id:string)=>string} opts.consentUrlFor   absolute URL of the consent page for a request
 * @param {object} opts.errors           the SDK's auth error classes (server/auth/errors.js)
 * @param {()=>number} [opts.now]        clock (ms) — injectable for tests
 * @param {(event:object)=>void} [opts.onEvent]  audit hook; receives no secrets
 */
function createCfoOAuthProvider(opts) {
  const { store, resourceUrl, consentUrlFor, errors } = opts;
  const now = opts.now || (() => Date.now());
  const onEvent = opts.onEvent || (() => {});
  const draftsEnabled = opts.draftsEnabled || draftsEnabledFromEnv;
  const E = errors;

  function toClientInfo(row) {
    if (!row) return undefined;
    return {
      ...(row.metadata || {}),
      client_id: row.client_id,
      client_name: row.client_name || undefined,
      redirect_uris: row.redirect_uris,
      // Always public: PKCE only, no secret is ever issued or stored.
      token_endpoint_auth_method: 'none',
      client_id_issued_at: row.created_at ? epochSeconds(new Date(row.created_at).getTime()) : undefined,
    };
  }

  // Tokens may only be used for THIS resource (RFC 8707). A client that names another
  // resource is refused rather than issued a token it would replay elsewhere.
  function checkResource(resource) {
    if (resource && resource.href.replace(/\/$/, '') !== resourceUrl.replace(/\/$/, '')) {
      throw new E.InvalidTargetError('This authorization server only issues tokens for the CFO Finance MCP server.');
    }
  }

  async function issueTokens({ clientId, userId, scopes, grantId }) {
    const t = now();
    const access = randomToken();
    const refresh = randomToken();
    await store.insertTokens([
      { token_hash: sha256(access), kind: 'access', grant_id: grantId, client_id: clientId, user_id: userId,
        scopes, resource: resourceUrl, expires_at: isoIn(t, TTL.accessSeconds) },
      { token_hash: sha256(refresh), kind: 'refresh', grant_id: grantId, client_id: clientId, user_id: userId,
        scopes, resource: resourceUrl, expires_at: isoIn(t, TTL.refreshSeconds) },
    ]);
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: TTL.accessSeconds,
      refresh_token: refresh,
      scope: scopes.join(' '),
    };
  }

  const clientsStore = {
    async getClient(clientId) {
      return toClientInfo(await store.getClient(clientId));
    },
    async registerClient(info) {
      const uris = Array.isArray(info.redirect_uris) ? info.redirect_uris : [];
      const bad = uris.filter((u) => !redirectUriAllowed(u));
      if (!uris.length || bad.length) {
        throw new E.InvalidClientMetadataError(
          'redirect_uris must be Claude, ChatGPT or loopback callback URLs.');
      }
      // Public client: drop whatever secret the SDK generated, never store or return it.
      const { client_secret, client_secret_expires_at, ...rest } = info;
      const metadata = { ...rest };
      delete metadata.client_id; delete metadata.client_id_issued_at;
      await store.insertClient({
        client_id: info.client_id,
        client_name: info.client_name ? String(info.client_name).slice(0, 200) : null,
        redirect_uris: uris,
        metadata: { ...metadata, token_endpoint_auth_method: 'none' },
        created_at: new Date(now()).toISOString(),
      });
      onEvent({ action: 'client_registered', client_id: info.client_id, client_name: info.client_name || null });
      return { ...rest, client_id: info.client_id, client_id_issued_at: info.client_id_issued_at,
        token_endpoint_auth_method: 'none' };
    },
  };

  return {
    get clientsStore() { return clientsStore; },

    // Park the validated request and send the user to the CFO consent page. The SDK has
    // already checked client_id, redirect_uri and PKCE (S256) by the time this runs.
    async authorize(client, params, res) {
      checkResource(params.resource);
      const requested = (params.scopes || []).filter(Boolean);
      const unknown = requested.filter((s) => !SUPPORTED_SCOPES.includes(s));
      if (unknown.length) throw new E.InvalidScopeError(`Unsupported scope: ${unknown.join(' ')}`);
      const scopes = grantedScopes(requested, draftsEnabled());
      const id = randomToken();
      await store.createRequest({
        id,
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        state: params.state || null,
        scopes,
        resource: params.resource ? params.resource.href : resourceUrl,
        expires_at: isoIn(now(), TTL.requestSeconds),
      });
      res.redirect(302, consentUrlFor(id));
    },

    async challengeForAuthorizationCode(client, code) {
      const row = await store.getCode(sha256(code));
      if (!row || row.client_id !== client.client_id || row.used_at || expired(row.expires_at, now())) {
        throw new E.InvalidGrantError('Invalid or expired authorization code.');
      }
      return row.code_challenge;
    },

    async exchangeAuthorizationCode(client, code, _codeVerifier, redirectUri, resource) {
      checkResource(resource);
      // Single use: the conditional update succeeds for exactly one caller.
      const row = await store.consumeCode(sha256(code), { now: now() });
      if (!row || row.client_id !== client.client_id) {
        throw new E.InvalidGrantError('Invalid or expired authorization code.');
      }
      if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
        throw new E.InvalidGrantError('redirect_uri does not match the authorization request.');
      }
      const grantId = crypto.randomUUID();
      const tokens = await issueTokens({ clientId: client.client_id, userId: row.user_id, scopes: row.scopes, grantId });
      onEvent({ action: 'tokens_issued', client_id: client.client_id, user_id: row.user_id, grant_id: grantId });
      return tokens;
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      checkResource(resource);
      const hash = sha256(refreshToken);
      const row = await store.getToken(hash);
      if (!row || row.kind !== 'refresh' || row.client_id !== client.client_id) {
        throw new E.InvalidGrantError('Invalid refresh token.');
      }
      if (row.revoked_at) {
        // A rotated refresh token came back: it was copied. Kill the whole grant.
        await store.revokeGrant(row.grant_id, { now: now() });
        onEvent({ action: 'refresh_reuse_detected', client_id: row.client_id, user_id: row.user_id, grant_id: row.grant_id });
        throw new E.InvalidGrantError('Refresh token has already been used.');
      }
      if (expired(row.expires_at, now())) throw new E.InvalidGrantError('Refresh token has expired.');
      const narrowed = scopes && scopes.length ? scopes : row.scopes;
      if (narrowed.some((s) => !row.scopes.includes(s))) {
        throw new E.InvalidScopeError('A refresh cannot widen the granted scopes.');
      }
      // Rotate: exactly one caller revokes the old token; a racing second caller loses.
      const won = await store.revokeTokenIfActive(hash, { now: now() });
      if (!won) {
        await store.revokeGrant(row.grant_id, { now: now() });
        throw new E.InvalidGrantError('Refresh token has already been used.');
      }
      return issueTokens({ clientId: row.client_id, userId: row.user_id, scopes: narrowed, grantId: row.grant_id });
    },

    async verifyAccessToken(token) {
      const row = await store.getToken(sha256(token));
      if (!row || row.kind !== 'access' || row.revoked_at || expired(row.expires_at, now())) {
        throw new E.InvalidTokenError('Invalid or expired access token.');
      }
      return {
        token,
        clientId: row.client_id,
        scopes: row.scopes,
        expiresAt: epochSeconds(new Date(row.expires_at).getTime()),
        resource: row.resource ? new URL(row.resource) : undefined,
        extra: { userId: row.user_id, grantId: row.grant_id },
      };
    },

    // Revoking either token of a consent revokes the whole consent (RFC 7009 allows it).
    async revokeToken(client, request) {
      const row = await store.getToken(sha256(request.token));
      if (!row || row.client_id !== client.client_id) return; // unknown → silently OK (RFC 7009)
      await store.revokeGrant(row.grant_id, { now: now() });
      onEvent({ action: 'grant_revoked', client_id: row.client_id, user_id: row.user_id, grant_id: row.grant_id });
    },
  };
}

module.exports = {
  createCfoOAuthProvider, redirectUriAllowed, SCOPES, SUPPORTED_SCOPES, TTL, randomToken, grantedScopes,
};
