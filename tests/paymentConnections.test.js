// Unit tests for payment connection validation (pure, no I/O, no network).
// Run: node --test tests/paymentConnections.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const PC = require('../server/lib/paymentConnections');

const base = () => ({ provider: 'midtrans' });
const ok = (b) => { const r = PC.validateCreate(b); assert.strictEqual(r.ok, true, `expected ok, got ${r.error}`); return r.value; };
const bad = (b) => { const r = PC.validateCreate(b); assert.strictEqual(r.ok, false, 'expected a rejection'); return r; };

// ── Credentials are REFUSED, never silently stripped ─────────────────────────────────────
test('a request carrying any credential-shaped field is refused', () => {
  // Silently dropping the key would let the caller believe it was stored, and would put the
  // secret through request logs on its way to being discarded.
  for (const field of ['secret_key', 'api_key', 'apiKey', 'webhook_secret', 'credentials',
                       'access_token', 'password', 'client_secret', 'private_key',
                       'midtrans_server_key', 'serverKey', 'authToken']) {
    const r = PC.validateCreate({ ...base(), [field]: 'super-secret-value' });
    assert.strictEqual(r.ok, false, `${field} was accepted`);
    assert.strictEqual(r.error, 'credentials_not_accepted', `${field} gave ${r.error}`);
    assert.ok(r.fields.includes(field), `${field} not named in the error`);
  }
});

test('the refusal names the offending fields so the caller can remove them', () => {
  const r = PC.validateCreate({ ...base(), api_key: 'x', webhook_secret: 'y' });
  assert.deepStrictEqual(r.fields.sort(), ['api_key', 'webhook_secret']);
  assert.match(r.message, /api_key/);
});

test('the secret refusal never leaks the VALUE back to the caller', () => {
  const r = PC.validateCreate({ ...base(), secret_key: 'sk_live_do_not_echo_me' });
  assert.ok(!JSON.stringify(r).includes('sk_live_do_not_echo_me'), 'the secret value was echoed');
});

test('PATCH refuses credentials too', () => {
  const r = PC.validatePatch({ status: 'connected', api_key: 'x' });
  assert.strictEqual(r.error, 'credentials_not_accepted');
});

test('provider_account_id is NOT treated as a secret - it is a public merchant id', () => {
  assert.strictEqual(ok({ ...base(), provider_account_id: 'G123456789' }).provider_account_id, 'G123456789');
});

// ── Provider vocabulary ──────────────────────────────────────────────────────────────────
test('all eight supported providers are accepted', () => {
  for (const p of ['midtrans', 'xendit', 'doku', 'hitpay', 'duitku', 'ipaymu', 'manual', 'bank']) {
    assert.strictEqual(ok({ provider: p }).provider, p);
  }
});

test('provider is a CLOSED vocabulary here, unlike incoming_payments.provider', () => {
  // A connection is a deliberate configuration choice, so an unrecognised value is a
  // mistake. A receipt from an unknown gateway is different and stays free text.
  assert.strictEqual(bad({ provider: 'brandnewpay' }).error, 'invalid_provider');
  assert.strictEqual(bad({}).error, 'missing_provider');
  assert.strictEqual(ok({ provider: 'MidTrans' }).provider, 'midtrans', 'case should fold');
});

// ── Environment ──────────────────────────────────────────────────────────────────────────
test('environment defaults to sandbox - production must be deliberate', () => {
  assert.strictEqual(ok(base()).environment, 'sandbox');
  assert.strictEqual(ok({ ...base(), environment: 'production' }).environment, 'production');
  assert.strictEqual(bad({ ...base(), environment: 'staging' }).error, 'invalid_environment');
});

// ── Status ───────────────────────────────────────────────────────────────────────────────
test('a connection is born disconnected', () => {
  assert.strictEqual(ok(base()).status, 'disconnected');
});

test('a client cannot plant the error status', () => {
  // 'error' is a diagnosis a future sync records, not a claim a caller may assert.
  assert.strictEqual(bad({ ...base(), status: 'error' }).error, 'status_not_settable');
  assert.strictEqual(PC.validatePatch({ status: 'error' }).error, 'status_not_settable');
});

test('the settable statuses work', () => {
  for (const s of ['disconnected', 'connected', 'disabled']) {
    assert.strictEqual(ok({ ...base(), status: s }).status, s);
    assert.strictEqual(PC.validatePatch({ status: s }).value.status, s);
  }
  assert.strictEqual(bad({ ...base(), status: 'live' }).error, 'invalid_status');
});

// ── Field allow-list ─────────────────────────────────────────────────────────────────────
test('server-owned columns are never taken from the body', () => {
  const v = ok({ ...base(), business_id: 'attacker', created_by_user_id: 999,
                 last_sync_at: '2026-01-01', last_webhook_at: '2026-01-01',
                 last_error: 'fake', id: 'planted', created_at: 'x', updated_at: 'x' });
  for (const k of ['business_id', 'created_by_user_id', 'last_sync_at', 'last_webhook_at',
                   'last_error', 'id', 'created_at', 'updated_at']) {
    assert.ok(!(k in v), `${k} leaked from the request body`);
  }
});

test('provider and environment are immutable after creation', () => {
  // Re-pointing them in place would silently redirect accounting routing for everything
  // already attributed to the connection.
  assert.strictEqual(PC.validatePatch({ provider: 'xendit' }).error, 'field_not_patchable');
  assert.strictEqual(PC.validatePatch({ environment: 'production' }).error, 'field_not_patchable');
  assert.ok(!PC.PATCHABLE_FIELDS.includes('provider'));
});

test('an empty patch is refused rather than issuing a no-op write', () => {
  assert.strictEqual(PC.validatePatch({}).error, 'empty_patch');
});

test('a patch returns ONLY the keys actually supplied', () => {
  const v = PC.validatePatch({ display_name: 'Main' }).value;
  assert.deepStrictEqual(Object.keys(v), ['display_name']);
});

test('patchable text fields can be explicitly cleared', () => {
  const v = PC.validatePatch({ display_name: null, provider_account_id: null, linked_wallet_id: null }).value;
  assert.strictEqual(v.display_name, null);
  assert.strictEqual(v.provider_account_id, null);
  assert.strictEqual(v.linked_wallet_id, null);
});

// ── Shape ────────────────────────────────────────────────────────────────────────────────
test('a non-object body is refused', () => {
  assert.strictEqual(PC.validateCreate(null).error, 'invalid_body');
  assert.strictEqual(PC.validateCreate([]).error, 'invalid_body');
  assert.strictEqual(PC.validatePatch('x').error, 'invalid_body');
});

test('text fields are trimmed, emptied to null, and bounded', () => {
  assert.strictEqual(ok({ ...base(), display_name: '  Main  ' }).display_name, 'Main');
  assert.strictEqual(ok({ ...base(), display_name: '   ' }).display_name, null);
  assert.strictEqual(ok({ ...base(), display_name: 'x'.repeat(9999) }).display_name.length, 255);
});
