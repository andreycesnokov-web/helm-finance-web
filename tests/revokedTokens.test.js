'use strict';
// A revoked session JWT never authenticates, at every place that accepts an app session token.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const RT = require('../server/lib/revokedTokens');

const SECRET = 'revoked-tokens-test-secret-0123456789';
const token = jwt.sign({ userId: 4242, firstName: 'Test' }, SECRET, { expiresIn: '1h' });

test('a valid, unlisted token verifies exactly like jwt.verify', () => {
  assert.strictEqual(RT.isRevokedToken(token), false);
  assert.strictEqual(RT.verifyAppToken(token, SECRET).userId, 4242);
});

test('a token listed by its full digest is refused with a JsonWebTokenError', () => {
  const list = [RT.tokenDigest(token)];
  assert.strictEqual(RT.isRevokedToken(token, list), true);
  assert.throws(() => RT.verifyAppToken(token, SECRET, undefined, list), jwt.JsonWebTokenError);
});

test('a digest prefix entry refuses the token; surrounding whitespace does not dodge it', () => {
  const list = [RT.tokenDigest(token).slice(0, 8)];
  assert.strictEqual(RT.isRevokedToken(token, list), true);
  assert.strictEqual(RT.isRevokedToken(`  ${token}\n`, list), true);
  const other = jwt.sign({ userId: 4243 }, SECRET);
  assert.strictEqual(RT.isRevokedToken(other, list), false);
});

test('empty tokens are not "revoked" (the caller still answers 401 for a missing token)', () => {
  for (const t of [undefined, null, '']) assert.strictEqual(RT.isRevokedToken(t), false);
});

test('the shipped list holds only digests: full 64-hex or a prefix of at least 8 hex', () => {
  assert.ok(RT.REVOKED_TOKEN_HASHES.length >= 1);
  for (const h of RT.REVOKED_TOKEN_HASHES) assert.match(h, /^[0-9a-f]{8,64}$/);
  assert.ok(Object.isFrozen(RT.REVOKED_TOKEN_HASHES));
});

// Guard: every app-session verification goes through verifyAppToken. uploadLink.js verifies its
// own token type with a key derived from the secret, so a session JWT never passes there.
test('no server code verifies an app session JWT without the revocation check', () => {
  const root = path.join(__dirname, '..', 'server');
  const allowed = new Set(['lib/revokedTokens.js', 'lib/uploadLink.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(c|m)?js$/.test(e.name)) continue;
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (!allowed.has(rel) && /\bjwt\.verify\s*\(/.test(fs.readFileSync(p, 'utf8'))) offenders.push(rel);
    }
  };
  walk(root);
  assert.deepStrictEqual(offenders, []);
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  // One verification point (verifySession = revocation + session-user check), used by auth, receipt and training.
  assert.strictEqual((index.match(/verifyAppToken\(token, JWT_SECRET\)/g) || []).length, 1, 'only inside verifySession');
  assert.ok((index.match(/await verifySession\(token\)/g) || []).length >= 3, 'auth, receipt and training sites');
  assert.match(fs.readFileSync(path.join(root, 'mcp', 'auth.js'), 'utf8'), /verifyAppToken\(token, opts\.JWT_SECRET\)/);
});
