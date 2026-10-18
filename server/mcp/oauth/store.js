// CFO Finance MCP OAuth — persistence (migration 057_mcp_oauth.sql).
//
// One small interface, two implementations:
//   * createSupabaseOAuthStore(supabase) — production, service-role client.
//   * createMemoryOAuthStore()           — tests; same semantics, including the atomic
//                                          "only if still unused / undecided / active" updates.
//
// The store never sees a plaintext code or token: callers pass SHA-256 hashes. Every state
// transition that must happen at most once (deciding a request, using a code, revoking a token)
// is a single conditional UPDATE … RETURNING, so two concurrent requests cannot both win.

const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const nowIso = (now) => new Date(now).toISOString();

function unwrap({ data, error }, what) {
  if (error) {
    const e = new Error(`mcp_oauth_store_${what}_failed`);
    e.cause = error.message; // logged by callers, never returned to a client
    throw e;
  }
  return data;
}

/* ── production ─────────────────────────────────────────────────────────── */
function createSupabaseOAuthStore(supabase) {
  return {
    async getClient(clientId) {
      return unwrap(await supabase.from('mcp_oauth_clients').select('*')
        .eq('client_id', clientId).maybeSingle(), 'get_client');
    },
    async insertClient(row) {
      unwrap(await supabase.from('mcp_oauth_clients').insert(row), 'insert_client');
    },

    async createRequest(row) {
      unwrap(await supabase.from('mcp_oauth_requests').insert(row), 'create_request');
    },
    async getRequest(id) {
      return unwrap(await supabase.from('mcp_oauth_requests').select('*')
        .eq('id', id).maybeSingle(), 'get_request');
    },
    // Decide once: only an undecided, unexpired request is updated.
    async decideRequest(id, { decision, userId, now }) {
      return unwrap(await supabase.from('mcp_oauth_requests')
        .update({ decided_at: nowIso(now), decision, decided_by_user_id: userId })
        .eq('id', id).is('decided_at', null).gt('expires_at', nowIso(now))
        .select().maybeSingle(), 'decide_request');
    },

    async insertCode(row) {
      unwrap(await supabase.from('mcp_oauth_codes').insert(row), 'insert_code');
    },
    async getCode(codeHash) {
      return unwrap(await supabase.from('mcp_oauth_codes').select('*')
        .eq('code_hash', codeHash).maybeSingle(), 'get_code');
    },
    // Use once: only an unused, unexpired code is consumed.
    async consumeCode(codeHash, { now }) {
      return unwrap(await supabase.from('mcp_oauth_codes')
        .update({ used_at: nowIso(now) })
        .eq('code_hash', codeHash).is('used_at', null).gt('expires_at', nowIso(now))
        .select().maybeSingle(), 'consume_code');
    },

    async insertTokens(rows) {
      unwrap(await supabase.from('mcp_oauth_tokens').insert(rows), 'insert_tokens');
    },
    async getToken(tokenHash) {
      return unwrap(await supabase.from('mcp_oauth_tokens').select('*')
        .eq('token_hash', tokenHash).maybeSingle(), 'get_token');
    },
    // Revoke once: returns the row only if THIS call revoked it.
    async revokeTokenIfActive(tokenHash, { now }) {
      return unwrap(await supabase.from('mcp_oauth_tokens')
        .update({ revoked_at: nowIso(now) })
        .eq('token_hash', tokenHash).is('revoked_at', null)
        .select().maybeSingle(), 'revoke_token');
    },
    async revokeGrant(grantId, { now }) {
      unwrap(await supabase.from('mcp_oauth_tokens')
        .update({ revoked_at: nowIso(now) })
        .eq('grant_id', grantId).is('revoked_at', null), 'revoke_grant');
    },
    async listGrantsForUser(userId) {
      const tokens = unwrap(await supabase.from('mcp_oauth_tokens')
        .select('grant_id, client_id, scopes, created_at, expires_at, revoked_at, kind')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }), 'list_tokens_for_user');
      if (!tokens || !tokens.length) return [];

      const grantsMap = new Map();
      for (const t of tokens) {
        let g = grantsMap.get(t.grant_id);
        if (!g) {
          g = {
            grant_id: t.grant_id,
            client_id: t.client_id,
            user_id: userId,
            scopes: t.scopes || [],
            created_at: t.created_at,
            last_activity: t.created_at,
            expires_at: t.expires_at,
            tokens: [t],
          };
          grantsMap.set(t.grant_id, g);
        } else {
          if (new Date(t.created_at) < new Date(g.created_at)) g.created_at = t.created_at;
          if (new Date(t.created_at) > new Date(g.last_activity)) g.last_activity = t.created_at;
          if (new Date(t.expires_at) > new Date(g.expires_at)) g.expires_at = t.expires_at;
          if (t.scopes && t.scopes.length) g.scopes = t.scopes;
          g.tokens.push(t);
        }
      }

      // Determine revoked_at: A grant is revoked ONLY IF all of its tokens are revoked.
      // (Token rotation revokes the old refresh token while issuing new active tokens;
      // the grant remains active as long as at least one token is unrevoked).
      for (const g of grantsMap.values()) {
        const hasUnrevoked = g.tokens.some((t) => !t.revoked_at);
        if (hasUnrevoked) {
          g.revoked_at = null;
        } else {
          let latestRevoked = null;
          for (const t of g.tokens) {
            if (t.revoked_at && (!latestRevoked || new Date(t.revoked_at) > new Date(latestRevoked))) {
              latestRevoked = t.revoked_at;
            }
          }
          g.revoked_at = latestRevoked;
        }
        delete g.tokens;
      }

      const clientIds = [...new Set([...grantsMap.values()].map((g) => g.client_id))];
      const clientsData = clientIds.length ? unwrap(await supabase.from('mcp_oauth_clients')
        .select('client_id, client_name, redirect_uris, metadata, created_at')
        .in('client_id', clientIds), 'get_clients_for_grants') : [];
      const clientMap = new Map((clientsData || []).map((c) => [c.client_id, c]));

      return [...grantsMap.values()].map((g) => {
        const client = clientMap.get(g.client_id) || {};
        return {
          ...g,
          client_name: client.client_name || null,
          redirect_uris: client.redirect_uris || [],
          client_metadata: client.metadata || {},
        };
      });
    },
    async getGrant(grantId) {
      const tokens = unwrap(await supabase.from('mcp_oauth_tokens')
        .select('grant_id, client_id, user_id, scopes, created_at, expires_at, revoked_at, kind')
        .eq('grant_id', grantId)
        .order('created_at', { ascending: false }), 'get_grant_tokens');
      if (!tokens || !tokens.length) return null;

      const first = tokens[0];
      let createdAt = first.created_at;
      let lastActivity = first.created_at;
      let expiresAt = first.expires_at;
      let scopes = first.scopes;

      for (const t of tokens) {
        if (new Date(t.created_at) < new Date(createdAt)) createdAt = t.created_at;
        if (new Date(t.created_at) > new Date(lastActivity)) lastActivity = t.created_at;
        if (new Date(t.expires_at) > new Date(expiresAt)) expiresAt = t.expires_at;
        if (t.scopes && t.scopes.length) scopes = t.scopes;
      }

      const hasUnrevoked = tokens.some((t) => !t.revoked_at);
      let revokedAt = null;
      if (!hasUnrevoked) {
        for (const t of tokens) {
          if (t.revoked_at && (!revokedAt || new Date(t.revoked_at) > new Date(revokedAt))) {
            revokedAt = t.revoked_at;
          }
        }
      }

      const client = unwrap(await supabase.from('mcp_oauth_clients').select('*')
        .eq('client_id', first.client_id).maybeSingle(), 'get_client_for_grant');

      return {
        grant_id: grantId,
        client_id: first.client_id,
        user_id: first.user_id,
        scopes,
        created_at: createdAt,
        last_activity: lastActivity,
        expires_at: expiresAt,
        revoked_at: revokedAt,
        client_name: client?.client_name || null,
        redirect_uris: client?.redirect_uris || [],
        client_metadata: client?.metadata || {},
      };
    },
  };
}

/* ── tests ──────────────────────────────────────────────────────────────── */
function createMemoryOAuthStore() {
  const t = { clients: new Map(), requests: new Map(), codes: new Map(), tokens: new Map() };
  const copy = (v) => (v ? JSON.parse(JSON.stringify(v)) : null);
  const later = (iso, now) => new Date(iso).getTime() > new Date(now).getTime();
  return {
    _tables: t,
    async getClient(id) { return copy(t.clients.get(id)); },
    async insertClient(row) {
      if (t.clients.has(row.client_id)) throw new Error('mcp_oauth_store_insert_client_failed');
      t.clients.set(row.client_id, copy(row));
    },
    async createRequest(row) { t.requests.set(row.id, copy({ decided_at: null, decision: null, ...row })); },
    async getRequest(id) { return copy(t.requests.get(id)); },
    async decideRequest(id, { decision, userId, now }) {
      const r = t.requests.get(id);
      if (!r || r.decided_at || !later(r.expires_at, now)) return null;
      Object.assign(r, { decided_at: nowIso(now), decision, decided_by_user_id: userId });
      return copy(r);
    },
    async insertCode(row) { t.codes.set(row.code_hash, copy({ used_at: null, ...row })); },
    async getCode(h) { return copy(t.codes.get(h)); },
    async consumeCode(h, { now }) {
      const c = t.codes.get(h);
      if (!c || c.used_at || !later(c.expires_at, now)) return null;
      c.used_at = nowIso(now);
      return copy(c);
    },
    async insertTokens(rows) { for (const r of rows) t.tokens.set(r.token_hash, copy({ revoked_at: null, ...r })); },
    async getToken(h) { return copy(t.tokens.get(h)); },
    async revokeTokenIfActive(h, { now }) {
      const r = t.tokens.get(h);
      if (!r || r.revoked_at) return null;
      r.revoked_at = nowIso(now);
      return copy(r);
    },
    async revokeGrant(grantId, { now }) {
      for (const r of t.tokens.values()) if (r.grant_id === grantId && !r.revoked_at) r.revoked_at = nowIso(now);
    },
    async listGrantsForUser(userId) {
      const tokens = [...t.tokens.values()].filter((r) => r.user_id === userId);
      if (!tokens.length) return [];
      const grantsMap = new Map();
      for (const token of tokens) {
        let g = grantsMap.get(token.grant_id);
        if (!g) {
          g = {
            grant_id: token.grant_id,
            client_id: token.client_id,
            user_id: userId,
            scopes: token.scopes || [],
            created_at: token.created_at,
            last_activity: token.created_at,
            expires_at: token.expires_at,
            tokens: [token],
          };
          grantsMap.set(token.grant_id, g);
        } else {
          if (new Date(token.created_at) < new Date(g.created_at)) g.created_at = token.created_at;
          if (new Date(token.created_at) > new Date(g.last_activity)) g.last_activity = token.created_at;
          if (new Date(token.expires_at) > new Date(g.expires_at)) g.expires_at = token.expires_at;
          if (token.scopes && token.scopes.length) g.scopes = token.scopes;
          g.tokens.push(token);
        }
      }

      for (const g of grantsMap.values()) {
        const hasUnrevoked = g.tokens.some((token) => !token.revoked_at);
        if (hasUnrevoked) {
          g.revoked_at = null;
        } else {
          let latestRevoked = null;
          for (const token of g.tokens) {
            if (token.revoked_at && (!latestRevoked || new Date(token.revoked_at) > new Date(latestRevoked))) {
              latestRevoked = token.revoked_at;
            }
          }
          g.revoked_at = latestRevoked;
        }
        delete g.tokens;
      }

      return [...grantsMap.values()].map((g) => {
        const client = t.clients.get(g.client_id) || {};
        return copy({
          ...g,
          client_name: client.client_name || null,
          redirect_uris: client.redirect_uris || [],
          client_metadata: client.metadata || {},
        });
      });
    },
    async getGrant(grantId) {
      const tokens = [...t.tokens.values()].filter((r) => r.grant_id === grantId);
      if (!tokens.length) return null;
      const first = tokens[0];
      let createdAt = first.created_at;
      let lastActivity = first.created_at;
      let expiresAt = first.expires_at;
      let scopes = first.scopes;

      for (const token of tokens) {
        if (new Date(token.created_at) < new Date(createdAt)) createdAt = token.created_at;
        if (new Date(token.created_at) > new Date(lastActivity)) lastActivity = token.created_at;
        if (new Date(token.expires_at) > new Date(expiresAt)) expiresAt = token.expires_at;
        if (token.scopes && token.scopes.length) scopes = token.scopes;
      }

      const hasUnrevoked = tokens.some((token) => !token.revoked_at);
      let revokedAt = null;
      if (!hasUnrevoked) {
        for (const token of tokens) {
          if (token.revoked_at && (!revokedAt || new Date(token.revoked_at) > new Date(revokedAt))) {
            revokedAt = token.revoked_at;
          }
        }
      }

      const client = t.clients.get(first.client_id) || {};
      return copy({
        grant_id: grantId,
        client_id: first.client_id,
        user_id: first.user_id,
        scopes,
        created_at: createdAt,
        last_activity: lastActivity,
        expires_at: expiresAt,
        revoked_at: revokedAt,
        client_name: client.client_name || null,
        redirect_uris: client.redirect_uris || [],
        client_metadata: client.metadata || {},
      });
    },
  };
}

module.exports = { sha256, createSupabaseOAuthStore, createMemoryOAuthStore };
