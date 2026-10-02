// MCP identity resolution.
//
// The /mcp surface resolves the caller to a CFO user (public.users.id) from, in order:
//   1. an OAuth access token issued by this server's authorization server ("Sign in with
//      CFO Finance" — Claude Connectors, ChatGPT, Claude Code via OAuth). Requires the
//      cfo:read scope and a token issued for THIS resource (RFC 8707);
//   2. a configured shared dev token (MCP_DEV_TOKEN -> MCP_DEV_USER_ID) — development and
//      header-only clients;
//   3. the existing CFO custom JWT (same secret the web app uses) — development.
// All three end at a public.users id; from there the EXISTING tenant/role checks
// (resolveActiveBusiness / role gates) apply unchanged.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const READ_SCOPE = 'cfo:read';
const DRAFTS_SCOPE = 'cfo:drafts';

// May this caller use the write (pending-draft) tools? An OAuth caller only when the user
// granted cfo:drafts on the consent page — a grant made under the read-only consent stays
// read-only even after MCP_WRITE_TOOLS_ENABLED is turned on. The dev token and the CFO JWT are
// the account owner's own credentials (not a third-party grant), so they are not scope-limited.
function canWriteDrafts(mcpUser) {
  if (!mcpUser) return false;
  if (mcpUser.via !== 'oauth') return true;
  return Array.isArray(mcpUser.scopes) && mcpUser.scopes.includes(DRAFTS_SCOPE);
}

// Constant-time string compare (avoids leaking the dev token via response timing).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function bearerToken(req) {
  const raw = (req.headers && req.headers.authorization) || '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
}

/**
 * @param {object} req
 * @param {object} opts
 * @param {string} opts.JWT_SECRET
 * @param {(token:string)=>Promise<object>} [opts.verifyOAuth]  provider.verifyAccessToken, when OAuth is on
 * @param {string} [opts.resourceUrl]   canonical /mcp URL the token must be issued for
 * @returns {Promise<{userId:number, via:string, clientId?:string, scopes?:string[]}|null>}
 */
async function resolveMcpUser(req, opts = {}) {
  const token = bearerToken(req);
  if (!token) return null;

  // 1. Dev token (constant-time). Checked first so a dev token never hits the database.
  if (process.env.MCP_DEV_TOKEN && safeEqual(token, process.env.MCP_DEV_TOKEN)) {
    // Fail closed on a missing/blank/non-integer id (Number('') is 0, which must not pass).
    const raw = String(process.env.MCP_DEV_USER_ID || '').trim();
    const uid = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(uid) && uid !== 0 ? { userId: uid, via: 'dev_token' } : null;
  }

  // 2. OAuth access token. Ours are opaque base64url (no dots); a JWT is never looked up.
  if (opts.verifyOAuth && !token.includes('.')) {
    try {
      const info = await opts.verifyOAuth(token);
      if (!Array.isArray(info.scopes) || !info.scopes.includes(READ_SCOPE)) return null;
      if (opts.resourceUrl && info.resource
        && info.resource.href.replace(/\/$/, '') !== opts.resourceUrl.replace(/\/$/, '')) return null;
      const uid = Number(info.extra && info.extra.userId);
      return Number.isSafeInteger(uid) && uid !== 0
        ? { userId: uid, via: 'oauth', clientId: info.clientId, scopes: info.scopes.slice() }
        : null;
    } catch { return null; }
  }

  // 3. Existing CFO custom JWT.
  try {
    const d = jwt.verify(token, opts.JWT_SECRET);
    if (d && d.userId != null) return { userId: d.userId, via: 'app_jwt' };
  } catch { /* invalid/expired token → unauthenticated */ }

  return null;
}

module.exports = { resolveMcpUser, bearerToken, canWriteDrafts, READ_SCOPE, DRAFTS_SCOPE };
