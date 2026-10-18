// CFO Finance MCP — Account Integrations API (Settings → Connections → AI Assistants).
//
// Endpoints for managing Model Context Protocol (MCP) authorized connections:
//   GET  /api/account/integrations/ai-assistants         List connections for current user
//   POST /api/account/integrations/ai-assistants/:id/revoke  Revoke connection immediately
//
// Security & Tenant Isolation:
//   * Gated by the standard CFO web authentication (auth middleware).
//   * A user can ONLY inspect and revoke grants bound to their own public.users.id.
//   * Never exposes raw access tokens, refresh tokens, or token hashes.
//   * Server-side revocation immediately updates revoked_at in mcp_oauth_tokens,
//     which causes provider.verifyAccessToken and exchangeRefreshToken to reject the client.
//   * Company access scope reflects the user's active business memberships (personal
//     workspaces are strictly excluded per multi-tenant boundaries).

const express = require('express');
const { SCOPE_TEXT } = require('./oauth/consent');

function createAiAssistantsRouter({ store, supabase, services, now = () => Date.now(), onOAuthEvent = () => {}, publicBaseUrl = () => null }) {
  const router = express.Router();

  // GET / — List all authorized AI assistant connections for the signed-in user
  router.get('/', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (userId == null) return res.status(401).json({ error: 'unauthorized' });

      // 1. Resolve user profile & email
      let email = null;
      if (supabase) {
        try {
          const { data: identities } = await supabase.from('user_email_identities')
            .select('email').eq('user_id', userId).not('email_verified_at', 'is', null)
            .order('email_verified_at', { ascending: true }).limit(1);
          email = identities?.[0]?.email || null;
        } catch { /* ignore */ }
      }

      let displayName = null;
      if (supabase) {
        try {
          const { data: prof } = await supabase.from('user_profiles')
            .select('display_name').eq('user_id', userId).limit(1);
          displayName = prof?.[0]?.display_name || null;
        } catch { /* ignore */ }
        if (!displayName) {
          try {
            const { data: u } = await supabase.from('users')
              .select('first_name, last_name, username').eq('id', userId).limit(1);
            const userRow = u?.[0];
            displayName = [userRow?.first_name, userRow?.last_name].filter(Boolean).join(' ') || userRow?.username || null;
          } catch { /* ignore */ }
        }
      }

      // 2. Resolve accessible business companies (exclude personal workspaces)
      let companies = [];
      if (typeof services?.listAccessibleWorkspaces === 'function') {
        try {
          const workspaces = await services.listAccessibleWorkspaces(userId);
          companies = (workspaces || [])
            .filter((w) => w.businesses && w.businesses.type !== 'personal')
            .map((w) => ({
              id: w.businesses.id,
              name: w.businesses.name || 'Unnamed Company',
              role: w.role,
              business_code: w.businesses.business_code || null,
            }));
        } catch (e) {
          console.warn('[ai-assistants] listAccessibleWorkspaces failed:', e.message);
        }
      }

      // 3. Query grants from store
      const grants = store?.listGrantsForUser ? await store.listGrantsForUser(userId) : [];

      const currentTime = now();
      const connections = (grants || []).map((g) => {
        let clientType = 'custom';
        const uris = g.redirect_uris || [];
        const nameLower = String(g.client_name || '').toLowerCase();
        const hasHost = (hosts) => uris.some((u) => {
          try { return hosts.includes(new URL(u).hostname); } catch { return false; }
        });

        if (hasHost(['chatgpt.com', 'chat.openai.com']) || nameLower.includes('chatgpt') || nameLower.includes('openai')) {
          clientType = 'chatgpt';
        } else if (hasHost(['claude.ai', 'claude.com']) || nameLower.includes('claude') || nameLower.includes('anthropic')) {
          clientType = 'claude';
        } else if (uris.some((u) => {
          try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname); } catch { return false; }
        })) {
          clientType = 'local';
        }

        let status = 'connected';
        if (g.revoked_at) {
          status = 'revoked';
        } else if (g.expires_at && new Date(g.expires_at).getTime() <= currentTime) {
          status = 'expired';
        }

        const lastActivityMs = g.last_activity ? new Date(g.last_activity).getTime() : new Date(g.created_at).getTime();
        const recentlyActive = status === 'connected' && (currentTime - lastActivityMs <= 24 * 3600 * 1000);

        const scopes = Array.isArray(g.scopes) && g.scopes.length ? g.scopes : ['cfo:read'];
        const permissions = scopes.map((s) => ({
          scope: s,
          description: SCOPE_TEXT[s] || s,
        }));

        return {
          grant_id: g.grant_id,
          client_id: g.client_id,
          client_name: g.client_name || (clientType === 'chatgpt' ? 'ChatGPT' : clientType === 'claude' ? 'Claude' : 'AI Assistant'),
          client_type: clientType,
          status,
          recently_active: recentlyActive,
          created_at: g.created_at,
          last_activity: g.last_activity || g.created_at,
          expires_at: g.expires_at,
          revoked_at: g.revoked_at || null,
          scopes,
          permissions,
          user: {
            id: userId,
            email: email || `user-${userId}@cfo-ai.local`,
            display_name: displayName || `User ${userId}`,
          },
          companies,
        };
      });

      // Sort: active connected first, then recently active, then expired/revoked
      connections.sort((a, b) => {
        if (a.status === 'connected' && b.status !== 'connected') return -1;
        if (a.status !== 'connected' && b.status === 'connected') return 1;
        return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
      });

      const base = (typeof publicBaseUrl === 'function' ? publicBaseUrl() : null) || `${req.protocol}://${req.get('host')}`;

      res.json({
        ok: true,
        connections,
        mcp_url: `${base}/mcp`,
        mcp_server_enabled: process.env.MCP_SERVER_ENABLED === 'true',
        mcp_oauth_enabled: process.env.MCP_OAUTH_ENABLED === 'true',
      });
    } catch (e) {
      console.error('[ai-assistants] list failed:', e.message);
      res.status(500).json({ error: 'list_failed' });
    }
  });

  // POST /:grantId/revoke — Revoke an authorized grant immediately
  router.post('/:grantId/revoke', async (req, res) => {
    try {
      const userId = req.user?.userId;
      if (userId == null) return res.status(401).json({ error: 'unauthorized' });

      const grantId = String(req.params.grantId || '').trim();
      if (!grantId) return res.status(400).json({ error: 'invalid_grant_id' });

      const grant = store?.getGrant ? await store.getGrant(grantId) : null;
      if (!grant || grant.user_id !== userId) {
        return res.status(404).json({ error: 'grant_not_found', message: 'Connection not found.' });
      }

      if (grant.revoked_at) {
        return res.json({ ok: true, status: 'revoked', grant_id: grantId, already_revoked: true });
      }

      await store.revokeGrant(grantId, { now: now() });
      onOAuthEvent({
        action: 'grant_revoked',
        client_id: grant.client_id,
        user_id: userId,
        grant_id: grantId,
      });

      res.json({ ok: true, status: 'revoked', grant_id: grantId });
    } catch (e) {
      console.error('[ai-assistants] revoke failed:', e.message);
      res.status(500).json({ error: 'revoke_failed' });
    }
  });

  return router;
}

module.exports = { createAiAssistantsRouter };
