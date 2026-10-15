'use strict';
// Session JWTs that must never authenticate again, even though they still verify against
// JWT_SECRET. Rotating JWT_SECRET is the real fix and makes this list redundant; it exists
// because a leaked session token is still inside its 30-day lifetime and the secret has not
// been rotated yet (incident 2026-10, see C:/tmp/helm-incident-2026-10/02-plan-rotacii-jwt-secret.md).
//
// Entries are SHA-256 hex digests of the exact token string, so no token value lives in the
// repository. A full 64-char digest matches one token. A shorter entry is a digest PREFIX,
// used only where the incident record kept just the prefix: a 32-bit prefix collides with an
// unrelated token about once in 4 billion, and such a session would only need to sign in again.
//
// Every place that accepts an app session JWT must verify through verifyAppToken; the guard
// test tests/revokedTokens.test.js fails when a new jwt.verify(…, JWT_SECRET) bypasses it.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const REVOKED_TOKEN_HASHES = Object.freeze([
  'd6d06b643010c1596f9575ca9fc907d3697036605ac0773fbdc52d2a2db0fc05', // listed by PR #147 (dac9b1d)
  '16d44b41', // leaked token B, valid until 2026-11-04 (incident record keeps only the prefix)
]);

function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token).trim()).digest('hex');
}

function isRevokedToken(token, revoked = REVOKED_TOKEN_HASHES) {
  if (token === null || token === undefined || token === '') return false;
  const digest = tokenDigest(token);
  return revoked.some(entry => (entry.length === 64 ? digest === entry : digest.startsWith(entry)));
}

// Drop-in for jwt.verify(token, secret, options): throws the same error class for a revoked
// token, so every existing catch keeps answering 401 / unauthenticated.
function verifyAppToken(token, secret, options, revoked = REVOKED_TOKEN_HASHES) {
  if (isRevokedToken(token, revoked)) throw new jwt.JsonWebTokenError('token revoked');
  return jwt.verify(token, secret, options);
}

module.exports = { REVOKED_TOKEN_HASHES, isRevokedToken, verifyAppToken, tokenDigest };
