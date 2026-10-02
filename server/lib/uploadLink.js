// Upload links for AI assistants (MCP upload_document, link mode).
//
// Owner decision (2026-10-02): no table — a signed, short-lived token. 15 minutes, ONE user,
// ONE company. The /upload page additionally requires the user to be signed in to CFO AI as
// that same user, so a forwarded link is useless to anyone else. Accepted trade-off: a link
// cannot be revoked before it expires (that would need a table of issued links).
//
// The signing key is DERIVED from the app secret for this purpose only (plus a distinct
// audience), so an upload-link token can never verify as a CFO session token and a session
// token can never verify as an upload link. Pure: no DB, no network.
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TTL_SECONDS = 15 * 60;
const AUDIENCE = 'cfo-ai/mcp-upload-link';
const TYP = 'upload_link';

const keyFrom = (secret) => crypto.createHash('sha256').update(`${secret}\u0000mcp-upload-link\u0000v1`).digest();

/**
 * @param secret  the app secret (JWT_SECRET)
 * @param claims  { userId, businessId, documentType?, link? }
 * @returns { token, expires_at, issued_at }
 */
function issueUploadLinkToken(secret, { userId, businessId, documentType = null, link = null }, { ttlSeconds = TTL_SECONDS, now = Date.now() } = {}) {
  if (!secret) throw new Error('upload_link_secret_missing');
  if (userId == null || !businessId) throw new Error('upload_link_claims_missing');
  const iat = Math.floor(now / 1000);
  const token = jwt.sign(
    { typ: TYP, uid: userId, bid: businessId, dt: documentType || undefined, lk: link || undefined, iat },
    keyFrom(secret),
    { algorithm: 'HS256', audience: AUDIENCE, expiresIn: ttlSeconds, jwtid: crypto.randomUUID() },
  );
  return {
    token,
    issued_at: new Date(iat * 1000).toISOString(),
    expires_at: new Date((iat + ttlSeconds) * 1000).toISOString(),
  };
}

/** The claims of a valid, unexpired upload link, or null. */
function verifyUploadLinkToken(secret, token, { now = Date.now() } = {}) {
  if (!secret || !token) return null;
  try {
    const p = jwt.verify(String(token), keyFrom(secret), {
      algorithms: ['HS256'], audience: AUDIENCE, clockTimestamp: Math.floor(now / 1000),
    });
    if (!p || p.typ !== TYP || p.uid == null || !p.bid) return null;
    return { userId: p.uid, businessId: p.bid, documentType: p.dt || null, link: p.lk || null,
      expires_at: new Date(p.exp * 1000).toISOString() };
  } catch {
    return null;
  }
}

module.exports = { issueUploadLinkToken, verifyUploadLinkToken, TTL_SECONDS, AUDIENCE };
