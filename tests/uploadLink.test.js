// Upload links for AI assistants — server/lib/uploadLink.js.
// Run: node tests/uploadLink.test.js
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const U = require('../server/lib/uploadLink');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const SECRET = 'test-app-secret';
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

t('a link round-trips: one user, one company, intent kept', () => {
  const l = U.issueUploadLinkToken(SECRET, { userId: -1, businessId: 'biz-a', documentType: 'vendor_invoice',
    link: { target_type: 'debt', target_id: '42' } }, { now: NOW });
  const p = U.verifyUploadLinkToken(SECRET, l.token, { now: NOW + 60_000 });
  assert.strictEqual(p.userId, -1);
  assert.strictEqual(p.businessId, 'biz-a');
  assert.strictEqual(p.documentType, 'vendor_invoice');
  assert.deepStrictEqual(p.link, { target_type: 'debt', target_id: '42' });
  assert.strictEqual(l.expires_at, new Date(NOW + 15 * 60_000).toISOString());
});

t('it stops working after 15 minutes', () => {
  const l = U.issueUploadLinkToken(SECRET, { userId: -1, businessId: 'biz-a' }, { now: NOW });
  assert.ok(U.verifyUploadLinkToken(SECRET, l.token, { now: NOW + 14 * 60_000 }));
  assert.strictEqual(U.verifyUploadLinkToken(SECRET, l.token, { now: NOW + 16 * 60_000 }), null);
});

t('a tampered company or user does not verify', () => {
  const l = U.issueUploadLinkToken(SECRET, { userId: -1, businessId: 'biz-a' }, { now: NOW });
  const [h, , s] = l.token.split('.');
  const forged = Buffer.from(JSON.stringify({ typ: 'upload_link', uid: -1, bid: 'biz-OTHER', aud: U.AUDIENCE,
    iat: NOW / 1000, exp: NOW / 1000 + 900 })).toString('base64url');
  assert.strictEqual(U.verifyUploadLinkToken(SECRET, `${h}.${forged}.${s}`, { now: NOW }), null);
});

t('another secret does not verify', () => {
  const l = U.issueUploadLinkToken(SECRET, { userId: -1, businessId: 'biz-a' }, { now: NOW });
  assert.strictEqual(U.verifyUploadLinkToken('other-secret', l.token, { now: NOW }), null);
});

t('an upload link is NOT a CFO session token, and a session token is not an upload link', () => {
  const l = U.issueUploadLinkToken(SECRET, { userId: -1, businessId: 'biz-a' }, { now: NOW });
  assert.throws(() => jwt.verify(l.token, SECRET), 'an upload link verified with the app secret');
  const session = jwt.sign({ userId: -1 }, SECRET);
  assert.strictEqual(U.verifyUploadLinkToken(SECRET, session, { now: NOW }), null);
  // Even a session-shaped token carrying upload claims, signed with the app secret, is refused.
  const sneaky = jwt.sign({ typ: 'upload_link', uid: -1, bid: 'biz-a' }, SECRET, { audience: U.AUDIENCE });
  assert.strictEqual(U.verifyUploadLinkToken(SECRET, sneaky, { now: Date.now() }), null);
});

t('missing claims or secret are refused at issue', () => {
  assert.throws(() => U.issueUploadLinkToken('', { userId: -1, businessId: 'b' }));
  assert.throws(() => U.issueUploadLinkToken(SECRET, { userId: null, businessId: 'b' }));
  assert.throws(() => U.issueUploadLinkToken(SECRET, { userId: -1 }));
  assert.strictEqual(U.verifyUploadLinkToken(SECRET, ''), null);
});

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
