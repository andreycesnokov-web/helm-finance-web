// Unit tests for the credential vault (AES-256-GCM).
// Run: node --test tests/credentialVault.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const VAULT = require('../server/lib/credentialVault');

const KEY_B64 = crypto.randomBytes(32).toString('base64');
const CTX = { business_id: 'biz-1', connection_id: 'conn-1', credential_type: 'server_key' };
const SECRET = 'SB-Mid-server-abcdefghijklmnop';

const withKey = (key, fn) => {
  const prev = process.env[VAULT.KEY_ENV];
  if (key === null) delete process.env[VAULT.KEY_ENV]; else process.env[VAULT.KEY_ENV] = key;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[VAULT.KEY_ENV]; else process.env[VAULT.KEY_ENV] = prev;
  }
};

// ── Fails closed ─────────────────────────────────────────────────────────────────────────
test('a missing key makes encrypt and decrypt throw, with no plaintext fallback', () => {
  withKey(null, () => {
    assert.strictEqual(VAULT.isVaultConfigured(), false);
    assert.throws(() => VAULT.encrypt(SECRET, CTX), /credential_vault_not_configured/);
    assert.throws(() => VAULT.decrypt({ encrypted_value: 'x', encryption_iv: 'x', encryption_tag: 'x' }, CTX),
      /credential_vault_not_configured/);
  });
});

test('a wrong-length key is refused rather than silently weakening AES-256', () => {
  for (const bad of ['', '   ', 'c2hvcnQ=', crypto.randomBytes(16).toString('base64'),
                     crypto.randomBytes(31).toString('base64'), 'not-valid-base64-!!!']) {
    withKey(bad, () => {
      assert.strictEqual(VAULT.isVaultConfigured(), false, `key ${JSON.stringify(bad)} was accepted`);
      assert.throws(() => VAULT.encrypt(SECRET, CTX), /credential_vault_not_configured/);
    });
  }
});

test('the error names the key SHAPE, never the key value', () => {
  const badKey = crypto.randomBytes(16).toString('base64');
  withKey(badKey, () => {
    try { VAULT.encrypt(SECRET, CTX); assert.fail('should have thrown'); }
    catch (e) {
      assert.strictEqual(e.code, 'credential_vault_not_configured');
      assert.strictEqual(e.reason, 'key_wrong_length');
      assert.ok(!JSON.stringify({ m: e.message, r: e.reason }).includes(badKey), 'the key leaked into the error');
    }
  });
});

test('a 32-byte key is accepted as base64 OR hex', () => {
  const raw = crypto.randomBytes(32);
  withKey(raw.toString('base64'), () => assert.strictEqual(VAULT.isVaultConfigured(), true));
  withKey(raw.toString('hex'), () => assert.strictEqual(VAULT.isVaultConfigured(), true));
  withKey(raw.toString('base64'), () => assert.ok(VAULT.getKey().equals(raw)));
  withKey(raw.toString('hex'), () => assert.ok(VAULT.getKey().equals(raw)));
});

// ── Round trip ───────────────────────────────────────────────────────────────────────────
test('encrypt then decrypt returns the exact original secret', () => {
  withKey(KEY_B64, () => {
    const sealed = VAULT.encrypt(SECRET, CTX);
    assert.strictEqual(VAULT.decrypt(sealed, CTX), SECRET);
  });
});

test('the ciphertext never contains the plaintext', () => {
  withKey(KEY_B64, () => {
    const sealed = VAULT.encrypt(SECRET, CTX);
    const blob = JSON.stringify(sealed);
    assert.ok(!blob.includes(SECRET), 'plaintext appeared in the stored shape');
    assert.ok(!Buffer.from(sealed.encrypted_value, 'base64').toString('utf8').includes(SECRET));
  });
});

test('unicode and whitespace-bearing secrets survive intact', () => {
  withKey(KEY_B64, () => {
    for (const s of ['  leading and trailing  ', 'ключ-секрет-значение', 'a'.repeat(4000), 'sk_test_日本語_1234']) {
      assert.strictEqual(VAULT.decrypt(VAULT.encrypt(s, CTX), CTX), s);
    }
  });
});

test('the same secret encrypts differently every time (fresh nonce)', () => {
  withKey(KEY_B64, () => {
    const a = VAULT.encrypt(SECRET, CTX), b = VAULT.encrypt(SECRET, CTX);
    assert.notStrictEqual(a.encryption_iv, b.encryption_iv, 'the IV was reused');
    assert.notStrictEqual(a.encrypted_value, b.encrypted_value);
    // ...but both still decrypt, and both fingerprint identically.
    assert.strictEqual(VAULT.decrypt(a, CTX), SECRET);
    assert.strictEqual(VAULT.decrypt(b, CTX), SECRET);
    assert.strictEqual(a.value_fingerprint, b.value_fingerprint);
  });
});

// ── Authentication / tamper detection ────────────────────────────────────────────────────
test('tampering with the ciphertext or tag is DETECTED, not silently decrypted', () => {
  withKey(KEY_B64, () => {
    const sealed = VAULT.encrypt(SECRET, CTX);
    const flip = (b64) => {
      const buf = Buffer.from(b64, 'base64'); buf[0] ^= 0xff; return buf.toString('base64');
    };
    assert.throws(() => VAULT.decrypt({ ...sealed, encrypted_value: flip(sealed.encrypted_value) }, CTX));
    assert.throws(() => VAULT.decrypt({ ...sealed, encryption_tag: flip(sealed.encryption_tag) }, CTX));
    assert.throws(() => VAULT.decrypt({ ...sealed, encryption_iv: flip(sealed.encryption_iv) }, CTX));
  });
});

test('a ciphertext MOVED to another business or connection fails to decrypt', () => {
  // This is what AAD buys: without it, a row copied between tenants would decrypt cleanly.
  withKey(KEY_B64, () => {
    const sealed = VAULT.encrypt(SECRET, CTX);
    assert.throws(() => VAULT.decrypt(sealed, { ...CTX, business_id: 'biz-2' }), /unable to authenticate|Unsupported state/i);
    assert.throws(() => VAULT.decrypt(sealed, { ...CTX, connection_id: 'conn-2' }));
    assert.throws(() => VAULT.decrypt(sealed, { ...CTX, credential_type: 'api_key' }));
  });
});

test('a different key cannot decrypt', () => {
  const sealed = withKey(KEY_B64, () => VAULT.encrypt(SECRET, CTX));
  withKey(crypto.randomBytes(32).toString('base64'), () => {
    assert.throws(() => VAULT.decrypt(sealed, CTX));
  });
});

// ── Fingerprint ──────────────────────────────────────────────────────────────────────────
test('the fingerprint is a KEYED hmac, not a bare hash of the secret', () => {
  withKey(KEY_B64, () => {
    const fp = VAULT.fingerprint(SECRET);
    const bare = crypto.createHash('sha256').update(SECRET).digest('hex');
    // A bare SHA-256 of a low-entropy secret is brute-forceable straight out of a dump.
    assert.notStrictEqual(fp, bare, 'fingerprint is a plain hash - brute-forceable from a dump');
    assert.match(fp, /^[0-9a-f]{64}$/);
    assert.ok(!fp.includes(SECRET));
  });
});

test('the fingerprint is stable for one key and differs across keys', () => {
  const a = withKey(KEY_B64, () => VAULT.fingerprint(SECRET));
  const b = withKey(KEY_B64, () => VAULT.fingerprint(SECRET));
  const c = withKey(crypto.randomBytes(32).toString('base64'), () => VAULT.fingerprint(SECRET));
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('different secrets fingerprint differently', () => {
  withKey(KEY_B64, () => {
    assert.notStrictEqual(VAULT.fingerprint('secret-value-one'), VAULT.fingerprint('secret-value-two'));
  });
});

// ── last4 ────────────────────────────────────────────────────────────────────────────────
test('last4 is withheld for short secrets, where 4 chars would give too much away', () => {
  assert.strictEqual(VAULT.last4('short123'), null);
  assert.strictEqual(VAULT.last4('elevenchars'), null);
  assert.strictEqual(VAULT.last4('twelvechars1'), 'ars1');
  assert.strictEqual(VAULT.last4('SB-Mid-server-abcdefghijklmnop'), 'mnop');
});

// ── Algorithm parameters ─────────────────────────────────────────────────────────────────
test('the vault uses authenticated encryption with the standard GCM parameters', () => {
  assert.strictEqual(VAULT.ALGORITHM, 'aes-256-gcm');
  assert.strictEqual(VAULT.KEY_BYTES, 32);
  assert.strictEqual(VAULT.IV_BYTES, 12);
  withKey(KEY_B64, () => {
    const s = VAULT.encrypt(SECRET, CTX);
    assert.strictEqual(Buffer.from(s.encryption_iv, 'base64').length, 12);
    assert.strictEqual(Buffer.from(s.encryption_tag, 'base64').length, 16);   // full 128-bit tag
  });
});
