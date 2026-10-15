'use strict';
// A session token opens nothing unless its user exists and the token is not older than that user.
const test = require('node:test');
const assert = require('node:assert');
const { createSessionUserCheck, SessionCheckUnavailable, ISSUED_BEFORE_USER_TOLERANCE_S } = require('../server/lib/sessionUser');

function fakeSupabase(rows, { fail = false } = {}) {
  const calls = { n: 0 };
  return {
    calls,
    from(table) {
      assert.strictEqual(table, 'users');
      const q = { id: null };
      const chain = {
        select() { return chain; },
        eq(col, v) { assert.strictEqual(col, 'id'); q.id = v; return chain; },
        async limit() { calls.n++; if (fail) return { data: null, error: { message: 'db down' } }; return { data: rows.filter(r => r.id === q.id), error: null }; },
      };
      return chain;
    },
  };
}
const CREATED = '2026-10-15T12:00:00Z';
const createdS = Date.parse(CREATED) / 1000;

test('a token for a user that does not exist is refused', async () => {
  const check = createSessionUserCheck(fakeSupabase([]));
  assert.strictEqual(await check({ userId: -28, iat: createdS }), false);
});

test('a live user with a token issued after the user was created passes', async () => {
  const check = createSessionUserCheck(fakeSupabase([{ id: -1001, created_at: CREATED }]));
  assert.strictEqual(await check({ userId: -1001, iat: createdS + 5 }), true);
  assert.strictEqual(await check({ userId: -1001, iat: createdS - ISSUED_BEFORE_USER_TOLERANCE_S + 1 }), true, 'insert and sign in one request');
});

test('a token issued before the user existed (an id reused after a reset) is refused', async () => {
  const check = createSessionUserCheck(fakeSupabase([{ id: -8, created_at: CREATED }]));
  assert.strictEqual(await check({ userId: -8, iat: createdS - 86400 }), false);
});

test('a token without iat or with a non-numeric / zero user id is refused', async () => {
  const check = createSessionUserCheck(fakeSupabase([{ id: -5, created_at: CREATED }]));
  for (const p of [{ userId: -5 }, { userId: 'x', iat: createdS }, { userId: 0, iat: createdS }, null]) assert.strictEqual(await check(p), false);
});

test('a database error refuses the session (fail closed), never lets it through', async () => {
  const check = createSessionUserCheck(fakeSupabase([], { fail: true }));
  await assert.rejects(check({ userId: -1, iat: createdS }), SessionCheckUnavailable);
});

test('live users are cached briefly; missing users are not cached', async () => {
  let t = 0;
  const db = fakeSupabase([{ id: -2, created_at: CREATED }]);
  const check = createSessionUserCheck(db, { ttlMs: 1000, now: () => t });
  await check({ userId: -2, iat: createdS }); await check({ userId: -2, iat: createdS });
  assert.strictEqual(db.calls.n, 1);
  t = 1500; await check({ userId: -2, iat: createdS });
  assert.strictEqual(db.calls.n, 2, 'refreshed after the TTL');
  await check({ userId: -3, iat: createdS }); await check({ userId: -3, iat: createdS });
  assert.strictEqual(db.calls.n, 4, 'a missing user is looked up every time');
});

test('every place that accepts an app session goes through the session-user check', () => {
  const fs = require('node:fs'), path = require('node:path');
  const index = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.strictEqual((index.match(/verifyAppToken\(token, JWT_SECRET\)/g) || []).length, 1, 'only inside verifySession');
  assert.ok((index.match(/await verifySession\(token\)/g) || []).length >= 3, 'auth, receipt and training');
  assert.match(index, /attachMcp\(app, \{\s*JWT_SECRET,\s*sessionUserAllowed,/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'mcp', 'auth.js'), 'utf8'), /opts\.sessionUserAllowed/);
});
