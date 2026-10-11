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
  };
}

module.exports = { sha256, createSupabaseOAuthStore, createMemoryOAuthStore };
