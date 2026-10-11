// Credential vault — AES-256-GCM encryption for payment provider secrets.
//
// The key lives ONLY in PAYMENT_CREDENTIALS_ENCRYPTION_KEY (env), never in the database.
// A database dump therefore yields no usable secret: that separation is the whole point,
// and every design choice below protects it.
//
// FAILS CLOSED. A missing, malformed or wrong-length key makes every encrypt and decrypt
// throw `credential_vault_not_configured`. There is no fallback, no plaintext path, and no
// "store it unencrypted for now" branch -- a vault that silently degrades to plaintext is
// worse than no vault, because the UI would still say the secret is protected.
//
// NEVER LOGS PLAINTEXT. Nothing here writes a secret, or anything derived from it that
// could be reversed, to a log or an error message. Errors carry codes, not values.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;   // AES-256
const IV_BYTES = 12;    // 96-bit nonce, the GCM standard
const KEY_ENV = 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY';

class VaultNotConfiguredError extends Error {
  constructor(reason) {
    super('credential_vault_not_configured');
    this.code = 'credential_vault_not_configured';
    // The reason describes the KEY's shape, never its value.
    this.reason = reason;
  }
}

/**
 * Load and validate the master key.
 *
 * Accepts base64 (the documented format) and falls back to hex, since an operator
 * generating a key with `openssl rand -hex 32` is a predictable and harmless variation.
 * Anything that does not decode to exactly 32 bytes is refused: a short key would silently
 * weaken AES-256, and Node would happily accept a truncated buffer for some encodings.
 */
function getKey() {
  const raw = (process.env[KEY_ENV] || '').trim();
  if (!raw) throw new VaultNotConfiguredError('key_missing');

  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');                 // 32 bytes as hex
  } else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== KEY_BYTES) {
    throw new VaultNotConfiguredError('key_wrong_length');
  }
  return key;
}

/** True when a usable key is present. Lets a route answer cleanly instead of throwing. */
function isVaultConfigured() {
  try { getKey(); return true; } catch { return false; }
}

/**
 * Additional Authenticated Data.
 *
 * Binds a ciphertext to the exact row it belongs to. Without AAD, a ciphertext copied from
 * one credential row into another -- a different business, a different connection, a
 * different credential type -- would still decrypt cleanly. With it, GCM authentication
 * fails and the move is detected.
 */
function buildAad({ business_id, connection_id, credential_type }) {
  return Buffer.from(`v1|${business_id}|${connection_id}|${credential_type}`, 'utf8');
}

/**
 * Keyed fingerprint of a plaintext value.
 *
 * HMAC, not a bare hash. Provider secrets are often low-entropy enough to brute-force from
 * a plain SHA-256 -- a merchant id, a short sandbox key -- so the digest is taken under a
 * key derived from the master key. The derivation gives domain separation, so the
 * fingerprint can never act as an encryption oracle.
 *
 * Used only to recognise that the same value was submitted again. It is not reversible and
 * is never compared against anything supplied by a client.
 */
function fingerprint(value) {
  const fpKey = crypto.createHmac('sha256', getKey()).update('fingerprint-v1').digest();
  return crypto.createHmac('sha256', fpKey).update(String(value), 'utf8').digest('hex');
}

/**
 * Last 4 characters, for human recognition in the UI.
 *
 * Withheld for short values: revealing 4 characters of an 8-character secret gives away
 * half of it. The threshold is deliberately conservative.
 */
function last4(value) {
  const s = String(value);
  return s.length >= 12 ? s.slice(-4) : null;
}

/**
 * Encrypt a plaintext secret.
 * @returns { encrypted_value, encryption_iv, encryption_tag, value_fingerprint, value_last4 }
 * All base64 except the hex fingerprint. Throws VaultNotConfiguredError if the key is unusable.
 */
function encrypt(plaintext, context) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);          // fresh nonce per encryption, never reused
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(buildAad(context));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    encrypted_value: ct.toString('base64'),
    encryption_iv: iv.toString('base64'),
    encryption_tag: cipher.getAuthTag().toString('base64'),
    value_fingerprint: fingerprint(plaintext),
    value_last4: last4(plaintext),
  };
}

/**
 * Decrypt a stored credential.
 *
 * NO ROUTE CALLS THIS. It exists so the stored shape is provably reversible (round-trip
 * tested) and so a later provider-integration phase has one reviewed way in. When that
 * phase arrives the plaintext must go straight to the provider client and never into a
 * response body, a log line, or an error.
 *
 * Throws on any tampering: a modified ciphertext, a swapped tag, or a row moved to another
 * business all fail GCM authentication rather than returning wrong plaintext.
 */
function decrypt(row, context) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(row.encryption_iv, 'base64'));
  decipher.setAAD(buildAad(context));
  decipher.setAuthTag(Buffer.from(row.encryption_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_value, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = {
  ALGORITHM, KEY_BYTES, IV_BYTES, KEY_ENV,
  VaultNotConfiguredError,
  getKey, isVaultConfigured, buildAad, fingerprint, last4, encrypt, decrypt,
};
