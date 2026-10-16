'use strict';
// A session JWT authenticates only while it still belongs to a live user:
//   * the user row must exist (a token for a deleted user opens nothing), and
//   * the token must not predate that user: a token issued before the row was created belongs to
//     someone else who once had the same id (ids restart after a database reset), so it is refused.
// Positive answers are cached briefly (one lookup per user per TTL); a missing user is never cached;
// a database error refuses the session instead of letting it through.
const ISSUED_BEFORE_USER_TOLERANCE_S = 60; // row insert and jwt.sign happen in the same request
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SessionCheckUnavailable extends Error {
  constructor() { super('session_check_unavailable'); this.code = 'session_check_unavailable'; }
}

function createSessionUserCheck(supabase, { ttlMs = 30000, now = () => Date.now(), max = 5000 } = {}) {
  const live = new Map(); // userId -> { createdAtS, at }
  return async function sessionUserAllowed(payload) {
    const id = Number(payload && payload.userId);
    const iat = Number(payload && payload.iat);
    if (!Number.isSafeInteger(id) || id === 0 || !Number.isFinite(iat)) return false;
    let row = live.get(id);
    if (!row || now() - row.at >= ttlMs) {
      const { data, error } = await supabase.from('users').select('id, created_at').eq('id', id).limit(1);
      if (error) throw new SessionCheckUnavailable();
      if (!data || !data.length) { live.delete(id); return false; }
      const created = Date.parse(data[0].created_at);
      row = { createdAtS: Number.isFinite(created) ? Math.floor(created / 1000) : null, at: now() };
      if (live.size >= max) live.clear();
      live.set(id, row);
    }
    if (row.createdAtS !== null && iat < row.createdAtS - ISSUED_BEFORE_USER_TOLERANCE_S) return false;
    // Password sessions (migration 074) are server-side: the session row must exist, belong to this user and be
    // neither revoked (logout, password reset) nor expired. Never cached, so a revocation takes effect at once.
    if (payload.auth_method === 'password' || payload.sid !== undefined) {
      if (!SESSION_ID.test(String(payload.sid || ''))) return false;
      const { data, error } = await supabase.from('auth_app_sessions').select('user_id, expires_at, revoked_at').eq('id', payload.sid).limit(1);
      if (error) throw new SessionCheckUnavailable();
      const s = data && data[0];
      if (!s || Number(s.user_id) !== id || s.revoked_at || !(Date.parse(s.expires_at) > now())) return false;
    }
    return true;
  };
}

module.exports = { createSessionUserCheck, SessionCheckUnavailable, ISSUED_BEFORE_USER_TOLERANCE_S };
