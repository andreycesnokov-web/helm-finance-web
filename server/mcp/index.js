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

    // Transport-layer auth. Enforced whenever a dev token is configured (i.e. any shared or
    // deployed environment). A pure-local MCP Inspector run leaves MCP_DEV_TOKEN unset so the
    // protocol can be exercised without auth during local bring-up.
    if (process.env.MCP_DEV_TOKEN && !mcpUser) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    try {
      await handleMcpRequest(req, res, { mcpUser });
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error', message: e.message });
    }
  });
}

module.exports = { attachMcp };
