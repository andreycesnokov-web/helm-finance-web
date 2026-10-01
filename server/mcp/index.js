// CFO Finance MCP adapter — mount point.
//
// Clean module boundary over the existing Express backend, so the MCP server can later be
// extracted into its own service WITHOUT touching accounting/business logic. The adapter
// only ever calls existing services; it never duplicates accounting logic.
//
// Read-only tools, gated by MCP_SERVER_ENABLED (default OFF → 404). Identity: OAuth 2.1
// "Sign in with CFO Finance" (gated by MCP_OAUTH_ENABLED, see oauth/), plus the development
// dev-token / CFO-JWT paths (see auth.js).

const { resolveMcpUser, bearerToken } = require('./auth');
const { handleMcpRequest } = require('./server');
const { createOAuthIntegration } = require('./oauth');

function attachMcp(app, deps = {}) {
  const JWT_SECRET = deps.JWT_SECRET;
  // Existing CFO services injected by server/index.js (the same functions the web routes
  // call). The MCP layer never reaches the business database on its own.
  const services = deps.services || {};

  const oauth = createOAuthIntegration({
    supabase: deps.supabase, store: deps.oauthStore, auth: deps.auth,
    now: deps.now, onEvent: deps.onOAuthEvent,
  });

  // ── OAuth (only when MCP_OAUTH_ENABLED) ────────────────────────────────────
  // Consent API for the web app's /oauth/consent page — CFO login required.
  app.use('/api/mcp-oauth', oauth.consentApi);
  // The consent page must never render inside someone else's frame (clickjacking).
  app.get('/oauth/consent', (req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // SDK endpoints at the application root (/.well-known/oauth-*, /authorize, /token, ...).
  app.use(oauth.sdkEndpoints);

  // ── MCP endpoint ───────────────────────────────────────────────────────────
  app.all('/mcp', async (req, res) => {
    // Feature flag, read per request (consistent with the rest of the app).
    if (process.env.MCP_SERVER_ENABLED !== 'true') {
      return res.status(404).json({ error: 'not_found' });
    }

    const oauthOn = oauth.enabled();
    const mcpUser = await resolveMcpUser(req, {
      JWT_SECRET,
      verifyOAuth: oauthOn ? oauth.verifyAccessToken : null,
      resourceUrl: oauthOn ? oauth.resourceUrl() : null,
    });

    // Transport-layer auth — SECURE BY DEFAULT. When the server is enabled it requires an
    // authenticated identity. The ONLY way to run it open is an explicit local opt-in
    // (MCP_ALLOW_UNAUTHENTICATED=true) for MCP Inspector bring-up.
    const allowUnauthenticated = process.env.MCP_ALLOW_UNAUTHENTICATED === 'true';
    if (!allowUnauthenticated && !mcpUser) {
      // Tell OAuth clients where to sign in (RFC 9728 / MCP authorization spec).
      const metadataUrl = oauthOn ? oauth.resourceMetadataUrl() : null;
      if (metadataUrl) {
        const invalid = bearerToken(req) ? ', error="invalid_token"' : '';
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"${invalid}`);
      }
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      await handleMcpRequest(req, res, { mcpUser, services });
    } catch (e) {
      // Do not leak internal error detail to the client; log it server-side.
      console.error('[mcp] request error:', e && e.message);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error' });
    }
  });
}

module.exports = { attachMcp };
