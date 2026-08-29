// Payment provider connections — pure validation (no I/O, no network, unit-tested).
//
// A connection records WHICH provider a business receives money through and where that
// money should be routed for accounting. It is configuration, not a session.
//
// NO CREDENTIALS. This module accepts no secret of any kind and actively REFUSES a request
// that carries one, rather than stripping it silently. Silent stripping would let a caller
// believe a key was stored, and would put the secret in request logs on its way to being
// discarded. Refusing is the only honest answer while there is nowhere safe to put it.
//
// INERT. Nothing here creates an incoming payment, a transaction, a debt, or a wallet
// movement, and nothing contacts a provider.

const PROVIDERS = ['midtrans', 'xendit', 'doku', 'hitpay', 'duitku', 'ipaymu', 'manual', 'bank'];
const ENVIRONMENTS = ['sandbox', 'production'];
const STATUSES = ['disconnected', 'connected', 'error', 'disabled'];

// Only these may be written by a client. Everything else on the table -- last_sync_at,
// last_webhook_at, last_error, created_by_user_id, timestamps -- is server-owned, so an
// allow-list is used rather than a deny-list: a column added later is not writable by
// accident.
const CREATABLE_FIELDS = ['provider', 'environment', 'display_name', 'provider_account_id',
                          'linked_wallet_id', 'status'];
// A connection cannot be renamed to a different provider or environment after creation --
// that is a different connection, and mutating it in place would silently re-point
// accounting routing for every payment already attributed to it.
const PATCHABLE_FIELDS = ['display_name', 'provider_account_id', 'linked_wallet_id', 'status'];

// Any key whose NAME suggests a secret is refused. Matched by pattern, not by an exact
// list, so a caller inventing `midtrans_server_key` or `clientSecret` is caught too.
const SECRET_KEY_PATTERN = /(secret|api[_-]?key|apikey|token|password|passwd|credential|private[_-]?key|client[_-]?secret|webhook[_-]?secret|server[_-]?key|auth)/i;

const MAX_TEXT = 255;

function fail(error, message, extra = {}) { return { ok: false, error, message, ...extra }; }

function cleanText(raw, max = MAX_TEXT) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Refuse any request carrying something that looks like a credential.
 * Returns null when clean, or a failure object naming the offending fields.
 */
function rejectCredentials(body = {}) {
  const offending = Object.keys(body).filter((k) => SECRET_KEY_PATTERN.test(k));
  if (!offending.length) return null;
  return fail('credentials_not_accepted',
    'Credentials are not stored by this endpoint. Remove these fields and try again: '
    + offending.join(', ') + '.',
    { fields: offending });
}

/**
 * Validate a create request.
 * Returns { ok:true, value } or { ok:false, error, message }.
 *
 * `value` never contains business_id (the server takes it from the ACTIVE workspace) and
 * never contains a server-owned observability column.
 */
function validateCreate(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected a connection object.');
  }
  const secret = rejectCredentials(body);
  if (secret) return secret;

  const provider = cleanText(body.provider)?.toLowerCase() || null;
  if (!provider) return fail('missing_provider', 'provider is required.');
  if (!PROVIDERS.includes(provider)) {
    return fail('invalid_provider',
      'That provider is not supported. Supported: ' + PROVIDERS.join(', ') + '.');
  }

  const environment = (cleanText(body.environment) || 'sandbox').toLowerCase();
  if (!ENVIRONMENTS.includes(environment)) {
    return fail('invalid_environment', 'environment must be sandbox or production.');
  }

  // A connection is born disconnected unless an operator states otherwise. 'error' is not
  // client-settable: it is a diagnosis a future sync would record, not a claim a caller
  // may plant.
  const status = (cleanText(body.status) || 'disconnected').toLowerCase();
  if (!STATUSES.includes(status)) return fail('invalid_status', 'That status is not recognised.');
  if (status === 'error') {
    return fail('status_not_settable',
      'The error status is set by the system when a sync fails; it cannot be assigned.');
  }

  return {
    ok: true,
    value: {
      provider,
      environment,
      status,
      display_name: cleanText(body.display_name),
      provider_account_id: cleanText(body.provider_account_id),
      // Validated against the active business by the route; carried through here only so
      // the caller sees it echoed in one place.
      linked_wallet_id: cleanText(body.linked_wallet_id),
    },
  };
}

/**
 * Validate a patch request. Only a subset of fields may change after creation.
 * Returns { ok:true, value } with ONLY the keys actually supplied.
 */
function validatePatch(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected an object.');
  }
  const secret = rejectCredentials(body);
  if (secret) return secret;

  const supplied = Object.keys(body);
  const forbidden = supplied.filter((k) => !PATCHABLE_FIELDS.includes(k));
  if (forbidden.length) {
    return fail('field_not_patchable',
      'These fields cannot be changed after creation: ' + forbidden.join(', ') + '.',
      { fields: forbidden });
  }
  if (!supplied.length) return fail('empty_patch', 'Nothing to update.');

  const value = {};
  if ('status' in body) {
    const status = cleanText(body.status)?.toLowerCase();
    if (!status || !STATUSES.includes(status)) return fail('invalid_status', 'That status is not recognised.');
    if (status === 'error') {
      return fail('status_not_settable',
        'The error status is set by the system when a sync fails; it cannot be assigned.');
    }
    value.status = status;
  }
  // These three are explicitly clearable: sending null unsets them.
  if ('display_name' in body) value.display_name = cleanText(body.display_name);
  if ('provider_account_id' in body) value.provider_account_id = cleanText(body.provider_account_id);
  if ('linked_wallet_id' in body) value.linked_wallet_id = cleanText(body.linked_wallet_id);

  return { ok: true, value };
}

module.exports = {
  PROVIDERS, ENVIRONMENTS, STATUSES,
  CREATABLE_FIELDS, PATCHABLE_FIELDS,
  rejectCredentials, validateCreate, validatePatch,
};
