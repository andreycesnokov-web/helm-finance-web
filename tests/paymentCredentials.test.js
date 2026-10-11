// Unit tests for credential validation + the metadata projection (pure, no I/O).
// Run: node --test tests/paymentCredentials.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../server/lib/paymentCredentials');

const SANDBOX = { environment: 'sandbox' };
const PROD = { environment: 'production' };
const body = (o = {}) => ({ credential_type: 'server_key', value: 'SB-Mid-server-abcdefgh', ...o });
const ok = (b, c = SANDBOX) => { const r = P.validateCreate(b, c); assert.strictEqual(r.ok, true, `expected ok, got ${r.error}`); return r.value; };
const bad = (b, c = SANDBOX) => { const r = P.validateCreate(b, c); assert.strictEqual(r.ok, false, 'expected a rejection'); return r; };

// ── Sandbox-only gate ────────────────────────────────────────────────────────────────────
test('a PRODUCTION connection cannot receive a credential in v1', () => {
  const r = bad(body(), PROD);
  assert.strictEqual(r.error, 'production_credentials_not_enabled');
});

test('the environment is read from the CONNECTION, never from the request', () => {
  // A client claiming sandbox for a production connection must not get through.
  const r = P.validateCreate({ ...body(), environment: 'sandbox' }, PROD);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'production_credentials_not_enabled');
});

test('an unknown environment is refused (fails closed, not open)', () => {
  assert.strictEqual(bad(body(), { environment: 'staging' }).error, 'production_credentials_not_enabled');
  assert.strictEqual(bad(body(), {}).error, 'production_credentials_not_enabled');
});

// ── Credential type ──────────────────────────────────────────────────────────────────────
test('all seven credential types are accepted', () => {
  for (const t of ['api_key', 'secret_key', 'server_key', 'client_key', 'webhook_secret', 'merchant_id', 'other']) {
    assert.strictEqual(ok(body({ credential_type: t })).credential_type, t);
  }
});

test('credential_type is required, closed, and case-folded', () => {
  assert.strictEqual(bad(body({ credential_type: undefined })).error, 'missing_credential_type');
  assert.strictEqual(bad(body({ credential_type: 'root_password' })).error, 'invalid_credential_type');
  assert.strictEqual(ok(body({ credential_type: '  Server_Key ' })).credential_type, 'server_key');
});

// ── Value ────────────────────────────────────────────────────────────────────────────────
test('a value is required and length-bounded', () => {
  assert.strictEqual(bad(body({ value: undefined })).error, 'missing_value');
  assert.strictEqual(bad(body({ value: '   ' })).error, 'missing_value');
  assert.strictEqual(bad(body({ value: 123 })).error, 'missing_value');
  assert.strictEqual(bad(body({ value: 'short' })).error, 'value_too_short');
  assert.strictEqual(bad(body({ value: 'x'.repeat(P.MAX_VALUE_LENGTH + 1) })).error, 'value_too_long');
});

test('the value is NOT trimmed - whitespace can be significant in a secret', () => {
  // Silently altering a key would produce a credential that fails against the provider for
  // reasons nobody could see from the UI.
  const v = ok(body({ value: '  sk_test_with_spaces  ' }));
  assert.strictEqual(v.plaintext, '  sk_test_with_spaces  ');
});

test('a validation failure never echoes the submitted secret', () => {
  const r = P.validateCreate(body({ value: 'x'.repeat(P.MAX_VALUE_LENGTH + 1) }), SANDBOX);
  assert.ok(!JSON.stringify(r).includes('xxxxxxxxxx'), 'the value appeared in the failure');
});

test('a non-object body is refused', () => {
  assert.strictEqual(P.validateCreate(null, SANDBOX).error, 'invalid_body');
  assert.strictEqual(P.validateCreate([], SANDBOX).error, 'invalid_body');
});

// ── Metadata projection ──────────────────────────────────────────────────────────────────
test('toMetadata strips every value-bearing column', () => {
  const row = {
    id: 'c1', connection_id: 'conn-1', business_id: 'biz-1', credential_type: 'server_key',
    status: 'active', value_last4: 'mnop', value_fingerprint: 'ab12', created_at: 'x',
    created_by_user_id: 7, revoked_at: null, revoked_by_user_id: null,
    // The things that must never reach a client:
    encrypted_value: 'CIPHERTEXT', encryption_iv: 'IVIVIV', encryption_tag: 'TAGTAG',
  };
  const m = P.toMetadata(row);
  for (const k of P.FORBIDDEN_RESPONSE_KEYS) {
    assert.ok(!(k in m), `${k} survived into the metadata projection`);
  }
  const blob = JSON.stringify(m);
  assert.ok(!blob.includes('CIPHERTEXT') && !blob.includes('IVIVIV') && !blob.includes('TAGTAG'),
    'key material leaked into the metadata');
});

test('toMetadata keeps what a human needs to manage the credential', () => {
  const m = P.toMetadata({ id: 'c1', connection_id: 'conn-1', credential_type: 'api_key',
    status: 'revoked', value_last4: '1234', created_at: 'T1', revoked_at: 'T2', revoked_by_user_id: 9 });
  assert.strictEqual(m.credential_type, 'api_key');
  assert.strictEqual(m.status, 'revoked');
  assert.strictEqual(m.value_last4, '1234');
  assert.strictEqual(m.revoked_at, 'T2');
});

test('toMetadata tolerates a sparse row without inventing values', () => {
  const m = P.toMetadata({ id: 'c1' });
  assert.strictEqual(m.value_last4, null);
  assert.strictEqual(m.revoked_at, null);
});
