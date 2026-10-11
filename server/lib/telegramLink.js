// PR4a — connecting a Telegram account to a platform user, and disconnecting it.
//
// WHAT A LINK IS, AND IS NOT
// --------------------------
// A row in user_channel_links says "this Telegram account is this person". It says nothing
// about what they may do: membership and role live in business_members, which stays the single
// authority. So nothing here writes a business_id, a role, or a workspace — and nothing here
// writes `users`, `business_members`, `telegram_user_state` or `user_channel_state` either.
// The only tables this module touches are `channel_link_tokens` and `user_channel_links`.
//
// SINGLE USE WITHOUT A TRANSACTION
// --------------------------------
// PostgREST gives us no transaction, so "read the token, decide, then write" would be a race:
// two bots consuming the same token concurrently would both read `used_at IS NULL` and both
// proceed. Instead the token is CLAIMED with one conditional statement —
//
//     UPDATE channel_link_tokens SET used_at = now()
//      WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
//
// — which Postgres serialises on the row lock. Exactly one caller sees a row come back; every
// other sees zero. That is a real compare-and-swap, not an imitation of one.
//
// The read that follows a failed claim is for DIAGNOSIS only — to tell "expired" from "already
// used" from "never existed" — and never grants anything.
//
// WHY REPLAY IS SUCCESS, NOT AN ERROR
// -----------------------------------
// If the same token is presented twice by the same Telegram account, the second attempt fails
// the claim and the diagnosis read shows it was used by that very account. That is a retry —
// a dropped response, a tapped link twice — not an attack, and answering 409 would tell a user
// their connection failed when it plainly worked. A DIFFERENT account presenting a used token
// is refused.

const crypto = require('crypto');
const { normalizeChannelExternalUserId } = require('./channelIdentity');

const CHANNEL = 'telegram';
const TOKEN_TTL_MS = 15 * 60 * 1000;
// 256 bits, encoded base64url rather than hex.
//
// This is a hard constraint, not a preference: Telegram's /start deep-link parameter accepts at
// most 64 characters, and it only accepts [A-Za-z0-9_-]. Hex spent 64 of those 64 characters on
// the token alone, so `link_` + 64 = 69 and the link would have been rejected by Telegram —
// the whole connect flow, dead on arrival. base64url carries the same 256 bits in 43 characters,
// leaving `link_` + 43 = 48 and room to spare.
const TOKEN_BYTES = 32;
const TOKEN_ENCODING = 'base64url';
// 43 chars is 32 bytes in base64url with no padding. The alphabet is exactly what Telegram
// permits, so a valid token is always a valid start parameter.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// Telegram's documented limit for the /start payload.
const TELEGRAM_START_PARAM_MAX = 64;
const TOKEN_PREFIX = 'link_';

const newToken = () => crypto.randomBytes(TOKEN_BYTES).toString(TOKEN_ENCODING);
/** Only the hash is ever stored. The raw token exists in exactly one HTTP response, once. */
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const fail = (httpStatus, code, message) => ({ ok: false, httpStatus, code, message });

/**
 * The bot deep link, with the payload length enforced where it is built.
 *
 * Asserting here rather than only in a test means a future change to the token encoding cannot
 * quietly produce a link Telegram will refuse: the failure surfaces at mint time, in the only
 * place that constructs the payload.
 */
function buildDeepLink(botUsername, token) {
  const payload = TOKEN_PREFIX + token;
  if (payload.length > TELEGRAM_START_PARAM_MAX) {
    throw new Error(`telegram start payload is ${payload.length} chars, over the ${TELEGRAM_START_PARAM_MAX} limit`);
  }
  return `https://t.me/${botUsername}?start=${payload}`;
}

/**
 * Show enough of an external id to be recognisable, never enough to be reused.
 *
 * A Telegram id is not a secret in the way a token is, but it identifies a person across every
 * chat they are in, and this endpoint is reachable by anyone with a session. The last four
 * digits are enough for "yes, that is my account".
 *
 * The threshold matters. An earlier version returned '…' + the WHOLE id for anything four
 * characters or shorter, which is not a mask at all — it revealed a short id completely while
 * looking redacted. Revealing four of five characters is barely better, so the tail is only
 * shown when there is a meaningful amount left hidden; anything shorter is masked entirely.
 * Real Telegram ids are 9-10 digits, so the ellipsis-only branch is a safety floor rather than
 * a case users will meet.
 */
const MASK_MIN_LENGTH = 8;
function maskExternalId(external) {
  const s = String(external || '');
  if (!s) return null;
  if (s.length < MASK_MIN_LENGTH) return '…';
  return '…' + s.slice(-4);
}

/** A display handle we are willing to store and echo back. */
function safeHandle({ username, first_name } = {}) {
  const raw = (username || first_name || '').toString().trim().slice(0, 64);
  if (!raw) return null;
  // Strip control characters and line separators. This string is echoed back into a Telegram
  // message and shown in admin views, so it must not carry anything that can break either —
  // and it arrives from a Telegram profile, which the user controls.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim();
  return cleaned || null;
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * The connection state for one platform user.
 *
 * `legacy_conflict` means: this Telegram account ALSO exists as a legacy positive `users` row
 * belonging to somebody else. That is the expected shape of a successful migration — an email
 * user linking the Telegram account whose old positive-id row still exists — and it is exactly
 * what a mistaken link would look like too, which is why it is surfaced rather than hidden.
 */
async function getTelegramLinkStatus({ supabase, userId } = {}) {
  const { data: rows, error } = await supabase.from('user_channel_links')
    .select('external_user_id, display_handle, linked_at, revoked_at, user_id')
    .eq('channel', CHANNEL).eq('user_id', userId);
  if (error) return fail(503, 'temporary_link_lookup_failed', 'Cannot read your Telegram connection right now.');

  const all = Array.isArray(rows) ? rows : [];
  const active = all.find((r) => r.revoked_at === null || r.revoked_at === undefined);
  // Most recent revocation, for the "previously connected" state.
  const revoked = all.filter((r) => r.revoked_at).sort((a, b) => String(b.revoked_at).localeCompare(String(a.revoked_at)))[0];
  const row = active || revoked || null;

  let legacyConflict = false;
  if (active) {
    const legacyId = Number(active.external_user_id);
    if (Number.isSafeInteger(legacyId) && legacyId > 0 && legacyId !== Number(userId)) {
      const { data: legacy } = await supabase.from('users').select('id').eq('id', legacyId).limit(1);
      legacyConflict = Boolean(legacy?.[0]);
    }
  }

  return {
    ok: true,
    body: {
      status: active ? 'connected' : (revoked ? 'revoked' : 'not_connected'),
      handle: row?.display_handle ?? null,
      // Masked, always. The full id never leaves this module.
      external_user_id_masked: row ? maskExternalId(row.external_user_id) : null,
      linked_at: active?.linked_at ?? null,
      revoked_at: revoked?.revoked_at ?? null,
      legacy_conflict: legacyConflict,
    },
  };
}

// ── mint ────────────────────────────────────────────────────────────────────

/**
 * Create a one-time link token for an authenticated user.
 *
 * Refuses when the user already has an active link rather than silently replacing it: swapping
 * one identity for another without a trace is not something a "Connect" button should do.
 */
async function createTelegramLinkToken({ supabase, userId, botUsername } = {}) {
  if (!botUsername) {
    return fail(503, 'bot_not_configured', 'Telegram is not configured on this deployment.');
  }

  const { data: existing, error: exErr } = await supabase.from('user_channel_links')
    .select('id').eq('channel', CHANNEL).eq('user_id', userId).is('revoked_at', null).limit(1);
  if (exErr) return fail(503, 'temporary_link_lookup_failed', 'Please try again.');
  if (existing?.[0]) return fail(409, 'already_linked', 'This account is already connected to Telegram.');

  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error } = await supabase.from('channel_link_tokens').insert({
    token_hash: hashToken(token),
    user_id: userId,
    intended_channel: CHANNEL,
    expires_at: expiresAt,
  });
  if (error) return fail(503, 'token_create_failed', 'Could not start the connection. Please try again.');

  return {
    ok: true,
    // The ONLY time the raw token exists outside the caller's browser. Never logged, never
    // stored, not recoverable — a lost token is replaced by minting another.
    body: { token, deep_link: buildDeepLink(botUsername, token), expires_at: expiresAt },
  };
}

// ── consume ─────────────────────────────────────────────────────────────────

async function activeLinkForExternal(supabase, external) {
  const { data, error } = await supabase.from('user_channel_links')
    .select('id, user_id').eq('channel', CHANNEL).eq('external_user_id', external)
    .is('revoked_at', null).limit(1);
  return { row: data?.[0] || null, error };
}

async function activeLinkForUser(supabase, userId) {
  const { data, error } = await supabase.from('user_channel_links')
    .select('id, external_user_id').eq('channel', CHANNEL).eq('user_id', userId)
    .is('revoked_at', null).limit(1);
  return { row: data?.[0] || null, error };
}

/**
 * Consume a link token presented by the bot and create the link.
 *
 * @returns {{ok:true, body:object} | {ok:false, httpStatus:number, code:string, message:string}}
 */
async function consumeTelegramLinkToken({ supabase, token, telegramId, username, first_name } = {}) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token.trim())) {
    return fail(400, 'invalid_token', 'That connection link is not valid.');
  }
  const norm = normalizeChannelExternalUserId({ channel: CHANNEL, externalUserId: telegramId });
  if (norm.status !== 'ok') {
    return fail(400, 'invalid_telegram_id', 'Invalid Telegram account id.');
  }
  const external = norm.externalUserId;
  const hash = hashToken(token.trim());
  const nowIso = new Date().toISOString();

  // ── the claim ────────────────────────────────────────────────────────────
  // One conditional statement. Postgres serialises concurrent updates on the row, so exactly
  // one caller gets a row back and everyone else gets none — without a transaction.
  const { data: claimedRows, error: claimErr } = await supabase.from('channel_link_tokens')
    .update({ used_at: nowIso, used_by_channel: CHANNEL, used_by_external_id: external })
    .eq('token_hash', hash)
    .eq('intended_channel', CHANNEL)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .select();
  if (claimErr) return fail(503, 'temporary_link_failed', 'Could not connect right now. Please try again.');

  const claimed = claimedRows?.[0] || null;

  if (!claimed) {
    // Diagnosis only — this read authorises nothing, it just chooses the message.
    const { data: found } = await supabase.from('channel_link_tokens')
      .select('user_id, used_at, used_by_external_id, revoked_at, expires_at')
      .eq('token_hash', hash).limit(1);
    const row = found?.[0];
    if (!row) return fail(404, 'token_not_found', 'That connection link is no longer valid.');
    if (row.revoked_at) return fail(409, 'token_already_used', 'That connection link was cancelled.');
    if (row.used_at) {
      // A retry by the SAME Telegram account is a retry, not an attack: a dropped response or a
      // double tap. Confirm the link that already exists rather than reporting a failure for
      // something that plainly worked.
      // Idempotent ONLY when this exact token, this exact Telegram account, and the link it
      // actually created are all still the same thing.
      //
      // Both conditions are load-bearing. Without the first, a user who revoked and relinked to
      // a DIFFERENT Telegram account could replay the old token from the new account and be told
      // it succeeded — confirming a connection the token never made. Without the second, a
      // replay would be confirmed after the link it created had been revoked.
      if (String(row.used_by_external_id) === external) {
        const { row: mine, error: mineErr } = await activeLinkForExternal(supabase, external);
        if (mineErr) return fail(503, 'temporary_link_failure', 'Please try again.');
        if (mine && String(mine.user_id) === String(row.user_id)) {
          return { ok: true, body: { ok: true, display_handle: safeHandle({ username, first_name }), idempotent: true } };
        }
      }
      return fail(409, 'token_already_used', 'That connection link has already been used.');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return fail(410, 'token_expired', 'That connection link has expired. Please start again.');
    }
    return fail(409, 'token_already_used', 'That connection link is no longer usable.');
  }

  // ── the link ─────────────────────────────────────────────────────────────
  // The token is now burned. Every path below leaves it burned: a conflict here means the user
  // must start again, which is correct — the conflict is about identity, and retrying the same
  // token would not change the answer.
  const linkUserId = claimed.user_id;

  const { row: byExternal, error: exErr } = await activeLinkForExternal(supabase, external);
  if (exErr) return fail(503, 'temporary_link_failed', 'Could not connect right now. Please try again.');
  if (byExternal) {
    if (String(byExternal.user_id) === String(linkUserId)) {
      // Already connected to this very account — nothing to do, and no duplicate row.
      return { ok: true, body: { ok: true, display_handle: safeHandle({ username, first_name }), idempotent: true } };
    }
    // Someone else's Telegram account. Never merged, never stolen, existing link untouched.
    return fail(409, 'external_already_linked', 'That Telegram account is already connected to a different CFO AI account.');
  }

  const { row: byUser, error: usErr } = await activeLinkForUser(supabase, linkUserId);
  if (usErr) return fail(503, 'temporary_link_failed', 'Could not connect right now. Please try again.');
  if (byUser) return fail(409, 'user_already_linked', 'This account is already connected to a different Telegram account.');

  const { error: insErr } = await supabase.from('user_channel_links').insert({
    channel: CHANNEL,
    external_user_id: external,
    user_id: linkUserId,
    display_handle: safeHandle({ username, first_name }),
    linked_via: 'link_token',
    linked_at: nowIso,
    revoked_at: null,
  });
  if (insErr) {
    // An insert can fail for two very different reasons, and they must not be conflated.
    //
    // A UNIQUE violation means somebody linked in the milliseconds between our checks and this
    // write — a real conflict, and a 409. Anything else (a dropped connection, a permissions
    // problem, a column that no longer exists) is OUR failure, and reporting it as "that
    // Telegram account belongs to someone else" would be a confident lie: the user would go
    // looking for an account that does not exist while the real fault went unnoticed.
    //
    // So the conflict is CONFIRMED by re-reading, and if it cannot be confirmed the answer is
    // 503. Both diagnostic reads must succeed to draw a conclusion from them.
    const { row: raced, error: racedErr } = await activeLinkForExternal(supabase, external);
    if (racedErr) return fail(503, 'temporary_link_failure', 'Could not complete the connection. Please try again.');
    const { row: mineNow, error: mineErr } = await activeLinkForUser(supabase, linkUserId);
    if (mineErr) return fail(503, 'temporary_link_failure', 'Could not complete the connection. Please try again.');

    if (raced && String(raced.user_id) === String(linkUserId)) {
      // The link we were trying to create already exists, for this user and this account.
      return { ok: true, body: { ok: true, display_handle: safeHandle({ username, first_name }), idempotent: true } };
    }
    if (raced) {
      return fail(409, 'external_already_linked', 'That Telegram account is already connected to a different CFO AI account.');
    }
    if (mineNow && String(mineNow.external_user_id) !== external) {
      return fail(409, 'user_already_linked', 'This account is already connected to a different Telegram account.');
    }
    // Neither conflict is present, so the insert failed for a reason we do not understand.
    // Say so, rather than inventing a conflict that the data does not support.
    return fail(503, 'temporary_link_failure', 'Could not complete the connection. Please try again.');
  }

  // Surfaced, never acted on: no merge, no identity transfer, no membership change.
  let legacyConflict = false;
  const legacyId = Number(external);
  if (Number.isSafeInteger(legacyId) && legacyId > 0 && legacyId !== Number(linkUserId)) {
    const { data: legacy } = await supabase.from('users').select('id').eq('id', legacyId).limit(1);
    legacyConflict = Boolean(legacy?.[0]);
  }

  return {
    ok: true,
    body: { ok: true, display_handle: safeHandle({ username, first_name }), legacy_conflict: legacyConflict },
    linkedUserId: linkUserId,
  };
}

// ── revoke ──────────────────────────────────────────────────────────────────

/**
 * Withdraw the active link.
 *
 * A soft revoke: the row survives with `revoked_at` set, so the history stays auditable and a
 * later relink is a new row rather than a resurrection. Nothing else is touched — not the user,
 * not their memberships, not a single financial record.
 */
async function revokeTelegramLink({ supabase, userId } = {}) {
  const { row, error } = await activeLinkForUser(supabase, userId);
  if (error) return fail(503, 'temporary_link_lookup_failed', 'Please try again.');
  if (!row) return fail(404, 'not_linked', 'No Telegram account is connected.');

  const revokedAt = new Date().toISOString();
  const { data: updated, error: upErr } = await supabase.from('user_channel_links')
    .update({ revoked_at: revokedAt, revoked_by_user_id: userId })
    .eq('id', row.id).is('revoked_at', null).select();
  if (upErr) return fail(503, 'revoke_failed', 'Could not disconnect Telegram. Please try again.');
  if (!updated?.[0]) return fail(404, 'not_linked', 'No Telegram account is connected.');

  return { ok: true, body: { ok: true, revoked_at: revokedAt } };
}

module.exports = {
  CHANNEL,
  TOKEN_TTL_MS,
  TOKEN_RE,
  TELEGRAM_START_PARAM_MAX,
  TOKEN_PREFIX,
  buildDeepLink,
  hashToken,
  maskExternalId,
  safeHandle,
  getTelegramLinkStatus,
  createTelegramLinkToken,
  consumeTelegramLinkToken,
  revokeTelegramLink,
};
