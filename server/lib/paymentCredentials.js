// Payment credential validation (pure, no I/O, no crypto side effects).
//
// Decides whether a submitted credential is well-formed. It never logs, echoes, hashes or
// returns the value itself -- the value is passed through to the vault and nowhere else.

const CREDENTIAL_TYPES = ['api_key', 'secret_key', 'server_key', 'client_key',
                          'webhook_secret', 'merchant_id', 'other'];
const STATUSES = ['active', 'revoked'];

// v1 is sandbox-only. Production keys are a materially different risk: they move real money,
// and storing them needs key rotation, access review and an incident path that do not exist
// yet. The refusal lives here rather than in the schema because `environment` belongs to the
// connection and the policy may widen in a later phase.
const ALLOWED_ENVIRONMENTS = ['sandbox'];

// A secret shorter than this is almost certainly a typo or a placeholder, and storing it
// would create a credential row that looks real and is not.
const MIN_VALUE_LENGTH = 8;
const MAX_VALUE_LENGTH = 4096;

function fail(error, message, extra = {}) { return { ok: false, error, message, ...extra }; }

/**
 * Validate a credential-create request.
 *
 * Returns { ok:true, value:{ credential_type, plaintext } } or a failure. `plaintext` is
 * handed straight to the vault by the caller; it is never stored on the returned object
 * beyond that hop, never logged, and never placed in a response.
 */
function validateCreate(body = {}, connection = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected a credential object.');
  }

  const credential_type = typeof body.credential_type === 'string'
    ? body.credential_type.trim().toLowerCase() : null;
  if (!credential_type) return fail('missing_credential_type', 'credential_type is required.');
  if (!CREDENTIAL_TYPES.includes(credential_type)) {
    return fail('invalid_credential_type',
      'Supported credential types: ' + CREDENTIAL_TYPES.join(', ') + '.');
  }

  // Deliberately NOT trimmed: leading/trailing whitespace can be significant in a secret,
  // and silently altering a key would produce a credential that fails against the provider
  // for reasons nobody could see. Only the emptiness check tolerates whitespace.
  const value = body.value;
  if (typeof value !== 'string' || !value.trim()) {
    return fail('missing_value', 'value is required.');
  }
  if (value.length < MIN_VALUE_LENGTH) {
    return fail('value_too_short',
      `A credential must be at least ${MIN_VALUE_LENGTH} characters.`);
  }
  if (value.length > MAX_VALUE_LENGTH) {
    return fail('value_too_long',
      `A credential cannot exceed ${MAX_VALUE_LENGTH} characters.`);
  }

  // Sandbox-only gate. Checked against the CONNECTION, never against anything the caller
  // sent, so a client cannot claim sandbox for a production connection.
  if (!ALLOWED_ENVIRONMENTS.includes(connection.environment)) {
    return fail('production_credentials_not_enabled',
      'Only sandbox credentials can be stored in this version. Production keys are not enabled yet.');
  }

  return { ok: true, value: { credential_type, plaintext: value } };
}

/**
 * Shape returned to clients. METADATA ONLY.
 *
 * The ciphertext, IV and tag are as deliberately absent as the plaintext: none of them is
 * useful to a UI, and returning them would move key-recovery material into browser memory,
 * logs and screenshots for no benefit. Everything a human needs to recognise and manage a
 * credential -- type, status, last4, when it was created and revoked -- is here.
 */
function toMetadata(row = {}) {
  return {
    id: row.id,
    connection_id: row.connection_id,
    credential_type: row.credential_type,
    status: row.status,
    value_last4: row.value_last4 ?? null,
    value_fingerprint: row.value_fingerprint ?? null,
    created_at: row.created_at,
    created_by_user_id: row.created_by_user_id ?? null,
    revoked_at: row.revoked_at ?? null,
    revoked_by_user_id: row.revoked_by_user_id ?? null,
  };
}

// Keys that must never appear in a metadata response. Used by both the route and its tests,
// so the guarantee is asserted in one place rather than restated.
const FORBIDDEN_RESPONSE_KEYS = ['encrypted_value', 'encryption_iv', 'encryption_tag',
                                 'value', 'plaintext', 'secret'];

module.exports = {
  CREDENTIAL_TYPES, STATUSES, ALLOWED_ENVIRONMENTS,
  MIN_VALUE_LENGTH, MAX_VALUE_LENGTH, FORBIDDEN_RESPONSE_KEYS,
  validateCreate, toMetadata,
};
