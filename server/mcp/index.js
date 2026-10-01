// CFO Finance MCP adapter — mount point.
//
// Clean module boundary over the existing Express backend, so the MCP server can later be
// extracted into its own service WITHOUT touching accounting/business logic. The adapter
// only ever calls existing services; it never duplicates accounting logic.
//
// Phase 1 is READ-ONLY and gated by MCP_SERVER_ENABLED (default OFF → 404). Identity is
// resolved by the dev-only resolver (see auth.js / mcp-identity-mapping-findings.md); OAuth
// 2.1 via Supabase Auth replaces it in PR2.

const { resolveMcpUser } = require('./auth');
const { handleMcpRequest } = require('./server');

function attachMcp(app, deps = {}) {
  const JWT_SECRET = deps.JWT_SECRET;

  app.all('/mcp', async (req, res) => {
    // Feature flag, read per request (consistent with the rest of the app).
    if (process.env.MCP_SERVER_ENABLED !== 'true') {
      return res.status(404).json({ error: 'not_found' });
    }

    const mcpUser = resolveMcpUser(req, JWT_SECRET);

    // Transport-layer auth — SECURE BY DEFAULT. When the server is enabled it requires an
    // authenticated identity (dev token or CFO JWT in Phase 1; OAuth in PR2). The ONLY way to
    // run it open is an explicit local opt-in (MCP_ALLOW_UNAUTHENTICATED=true) for MCP Inspector
    // bring-up — so enabling the flag in a deployed env never silently exposes an open endpoint.
    const allowUnauthenticated = process.env.MCP_ALLOW_UNAUTHENTICATED === 'true';
    if (!allowUnauthenticated && !mcpUser) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      await handleMcpRequest(req, res, { mcpUser });
    } catch (e) {
      // Do not leak internal error detail to the client; log it server-side.
      console.error('[mcp] request error:', e && e.message);
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error' });
    }
  });
}

module.exports = { attachMcp };
