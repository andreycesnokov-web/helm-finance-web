// MCP identity resolution — PHASE 1 (dev-only).
//
// There is NO Supabase Auth mapping for existing CFO users yet
// (see _specs/mcp-identity-mapping-findings.md). Until the OAuth 2.1 + explicit
// account-linking work in PR2, the /mcp surface resolves identity from either:
//   1. a configured shared dev token (MCP_DEV_TOKEN -> MCP_DEV_USER_ID), or
//   2. the existing CFO custom JWT (same secret the web app uses).
// Both resolve to a public.users id. From there the EXISTING tenant/role checks
// (resolveActiveBusiness / requireBusiness) apply unchanged. OAuth replaces this
// resolver in PR2 without changing anything downstream.

const jwt = require('jsonwebtoken');

function resolveMcpUser(req, JWT_SECRET) {
  const raw = (req.headers && req.headers.authorization) || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return null;

  // Dev token path (shared/staging testing only).
  if (process.env.MCP_DEV_TOKEN && token === process.env.MCP_DEV_TOKEN) {
    const uid = Number(process.env.MCP_DEV_USER_ID);
    return Number.isFinite(uid) ? { userId: uid, via: 'dev_token' } : null;
  }

  // Existing CFO custom JWT path.
  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (d && d.userId != null) return { userId: d.userId, via: 'app_jwt' };
  } catch { /* invalid/expired token → unauthenticated */ }

  return null;
}

module.exports = { resolveMcpUser };
