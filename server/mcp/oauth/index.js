// CFO Finance MCP OAuth — wiring.
//
// Gated by MCP_OAUTH_ENABLED (default OFF) on top of MCP_SERVER_ENABLED, and fail-closed on
// configuration: with no https public base URL the OAuth endpoints simply do not exist. That
// lets the code ship before migration 057 is applied, with nothing reachable until the flag
// is turned on.
//
// Public endpoints (installed at the application root, as the SDK requires):
//   /.well-known/oauth-authorization-server         RFC 8414 metadata
//   /.well-known/oauth-protected-resource/mcp       RFC 9728 metadata for /mcp
//   /authorize  /token  /register  /revoke          SDK handlers
// Web-app endpoints (CFO login required): /api/mcp-oauth/requests/:id[/decision]

const { createSupabaseOAuthStore } = require('./store');
const { createCfoOAuthProvider, SUPPORTED_SCOPES } = require('./provider');
const { createConsentRouter } = require('./consent');

const SDK_PATHS = new Set(['/authorize', '/token', '/register', '/revoke']);
const isOAuthPath = (p) => SDK_PATHS.has(p) || p.startsWith('/.well-known/oauth-');

function oauthEnabled() {
  return process.env.MCP_SERVER_ENABLED === 'true' && process.env.MCP_OAUTH_ENABLED === 'true';
}

// https://app.cfo-ai.site — the issuer and the host of /mcp. http only for loopback (dev).
function publicBaseUrl(env = process.env) {
  const raw = String(env.MCP_PUBLIC_BASE_URL || env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(loopback && u.protocol === 'http:')) return null;
    if (u.search || u.hash) return null;
    return u.origin + (u.pathname === '/' ? '' : u.pathname);
  } catch { return null; }
}

// Rate-limit key behind Railway's proxy: the right-most X-Forwarded-For entry is the one
// Railway's edge added (a client can prepend fake entries, not append after the proxy).
// The app does not set `trust proxy`, so req.ip would be the proxy for everyone. IPv6 is
// grouped by /64 so one host cannot rotate addresses inside its own subnet.
function clientKey(req) {
  const xff = String((req.headers && req.headers['x-forwarded-for']) || '');
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  let ip = parts.length ? parts[parts.length - 1] : ((req.socket && req.socket.remoteAddress) || 'unknown');
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':') + '::/64';
  return ip;
}
const RATE_LIMIT = { keyGenerator: clientKey, validate: false };

/**
 * @param {object} deps  { supabase, auth, store?, now?, onEvent? }  — store/now for tests
 */
function createOAuthIntegration(deps = {}) {
  const store = deps.store || (deps.supabase ? createSupabaseOAuthStore(deps.supabase) : null);
  const onEvent = deps.onEvent || (() => {});
  let built = null; // Promise<{ router, provider, base }>

  function build() {
    if (built) return built;
    built = (async () => {
      const base = publicBaseUrl();
      if (!base) throw new Error('mcp_oauth_not_configured: set MCP_PUBLIC_BASE_URL to the https origin');
      if (!store) throw new Error('mcp_oauth_not_configured: no store');
      const [{ mcpAuthRouter }, errors] = await Promise.all([
        import('@modelcontextprotocol/sdk/server/auth/router.js'),
        import('@modelcontextprotocol/sdk/server/auth/errors.js'),
      ]);
      const resourceUrl = `${base}/mcp`;
      const provider = createCfoOAuthProvider({
        store, resourceUrl, errors, now: deps.now, onEvent,
        consentUrlFor: (id) => `${base}/oauth/consent?request=${encodeURIComponent(id)}`,
      });
      const router = mcpAuthRouter({
        provider,
        issuerUrl: new URL(base),
        resourceServerUrl: new URL(resourceUrl),
        scopesSupported: SUPPORTED_SCOPES,
        resourceName: 'CFO AI',
        serviceDocumentationUrl: new URL(base),
        authorizationOptions: { rateLimit: RATE_LIMIT },
        tokenOptions: { rateLimit: RATE_LIMIT },
        clientRegistrationOptions: { rateLimit: RATE_LIMIT },
        revocationOptions: { rateLimit: RATE_LIMIT },
      });
      return { router, provider, base, resourceUrl };
    })().catch((e) => { built = null; throw e; });
    return built;
  }

  // Root middleware: only OAuth paths reach the SDK router, and only when enabled.
  async function sdkEndpoints(req, res, next) {
    if (!isOAuthPath(req.path) || !oauthEnabled()) return next();
    try {
      const { router } = await build();
      return router(req, res, next);
    } catch (e) {
      console.error('[mcp-oauth] unavailable:', e.message);
      return res.status(503).json({ error: 'oauth_unavailable' });
    }
  }

  const consent = store ? createConsentRouter({ store, auth: deps.auth, now: deps.now, onEvent }) : null;
  function consentApi(req, res, next) {
    if (!oauthEnabled() || !consent) return res.status(404).json({ error: 'not_found' });
    return consent(req, res, next);
  }

  // For /mcp: null when OAuth is off (the caller then only knows dev/JWT identities).
  async function verifyAccessToken(token) {
    const { provider } = await build();
    return provider.verifyAccessToken(token);
  }

  function resourceMetadataUrl() {
    const base = publicBaseUrl();
    return base ? `${base}/.well-known/oauth-protected-resource/mcp` : null;
  }

  return { sdkEndpoints, consentApi, verifyAccessToken, resourceMetadataUrl, enabled: oauthEnabled,
    resourceUrl: () => { const b = publicBaseUrl(); return b ? `${b}/mcp` : null; } };
}

module.exports = { createOAuthIntegration, publicBaseUrl, clientKey, oauthEnabled };
