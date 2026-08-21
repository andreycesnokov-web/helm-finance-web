// Channel identity resolution: external channel account  ⇄  platform user.
//
// PR2a. This module is a LIBRARY ONLY — nothing imports it yet. PR2.5 wires it into the
// Telegram routes behind a flag; PR3 moves active-workspace state; PR4 adds the web connect
// flow. Building it unwired means the risky half (letting it decide production traffic) can
// ship separately and revert without touching the resolver.
//
// WHAT PROBLEM THIS SOLVES
// -----------------------
// Today `users.id` IS the Telegram user id for Telegram-origin accounts (positive ids),
// while email-origin accounts get negative ids from app_user_id_seq (042). The id SIGN is
// therefore load-bearing for "does this person have Telegram", and an email-primary user can
// never link Telegram at all. `user_channel_links` (045) replaces that assumption with a
// row, and this module is the only place that decides what a row means.
//
//   channel + external_user_id  →  user_id  →  business_members  →  workspace
//                                              └── NOT this module's job
//
// Membership, role and workspace stay in business_members and are resolved elsewhere. A link
// answers "who is this", never "what may they do". Nothing here reads or returns business_id.
//
// EVERY FUNCTION IS READ-ONLY. No insert, no update, no upsert, no delete — resolving an
// identity must never have a side effect, and in particular must never auto-link or merge.
//
// Results are returned as structured objects rather than thrown, matching the fail-closed
// style used elsewhere in this codebase: the caller gets an explicit status it must handle,
// and an unexpected failure degrades to `error` rather than an exception mid-request.

const CHANNEL_TELEGRAM = 'telegram';
const SUPPORTED_CHANNELS = [CHANNEL_TELEGRAM];

// Telegram user ids are positive int64. This pattern rejects, in one place:
//   * empty / whitespace-only
//   * a leading '+' or '-'
//   * non-digits, including an @username — a handle is mutable and can be re-registered by a
//     DIFFERENT person, so it must never identify anyone
//   * leading zeros ('007'), which would let one account have several spellings
//   * '0' itself, which is not a real Telegram account
//   * anything longer than int64 can hold
const TELEGRAM_EXTERNAL_ID = /^[1-9][0-9]{0,18}$/;

const invalid = (channel, reason, extra = {}) =>
  ({ status: 'invalid', channel: channel ?? null, reason, ...extra });

/**
 * Canonical form of an external channel id.
 *
 * Accepts a string or a number and returns a decimal STRING, because `external_user_id` is
 * TEXT: future channels are not numeric, and a numeric round-trip would silently lose
 * precision on large ids. Comparisons must always be made on this canonical string.
 *
 * @returns {{status:'ok', channel:string, externalUserId:string}
 *         | {status:'invalid', channel:string|null, reason:string}}
 */
function normalizeChannelExternalUserId({ channel, externalUserId } = {}) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    return invalid(channel, 'unsupported_channel');
  }
  if (externalUserId === null || externalUserId === undefined) {
    return invalid(channel, 'missing_external_user_id');
  }

  let raw;
  if (typeof externalUserId === 'number') {
    // A float or an id beyond Number.MAX_SAFE_INTEGER has already lost information by the
    // time it reaches us, so it cannot be trusted as an identity.
    if (!Number.isSafeInteger(externalUserId)) return invalid(channel, 'not_a_safe_integer');
    raw = String(externalUserId);
  } else if (typeof externalUserId === 'string') {
    raw = externalUserId.trim();
  } else {
    // Booleans, objects, arrays: `String([])` is '', which would otherwise look like an
    // ordinary empty value rather than the type error it is.
    return invalid(channel, 'not_a_string_or_number');
  }

  if (!raw) return invalid(channel, 'empty_external_user_id');
  if (!TELEGRAM_EXTERNAL_ID.test(raw)) return invalid(channel, 'malformed_external_user_id');

  return { status: 'ok', channel, externalUserId: raw };
}

/** A platform user id: a non-zero safe integer. Negative ids are email-origin and legitimate. */
function normalizeUserId(userId) {
  if (typeof userId === 'string' && /^-?[1-9][0-9]{0,18}$/.test(userId.trim())) {
    const n = Number(userId.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId === 0) return null;
  return userId;
}

// ── forward: external account → platform user ───────────────────────────────

/**
 * Resolve an external channel account to a platform user.
 *
 * Precedence, and the reasoning for it:
 *
 *   1. ACTIVE LINK wins, always. A link is a deliberate act by an authenticated web user
 *      (PR4's token flow); a legacy id match is a historical coincidence of how the account
 *      was created. Evidence beats inference.
 *   2. LEGACY fallback, read-only, positive ids only. A negative id can never equal a
 *      Telegram id, so the sign check is not a heuristic — it is a type check.
 *   3. REVOKED, when the only thing on file is a withdrawn link.
 *   4. UNLINKED.
 *
 * `legacyConflictUserId` is surfaced whenever an active link points at one user while a
 * legacy row exists for the same external id under a DIFFERENT user. That is not an error —
 * it is the expected shape of a successful migration (an email user links the Telegram
 * account whose old positive-id row still exists) — but it is worth logging and showing in
 * admin, because it is also what a mistaken link would look like.
 *
 * @returns {{status:'linked'|'legacy'|'revoked'|'unlinked'|'invalid'|'error',
 *            channel:string|null, externalUserId:string|null, userId:number|null,
 *            via:'link'|'legacy'|null, legacyConflictUserId?:number|null,
 *            revokedLinkUserId?:number|null, reason?:string}}
 */
async function resolveChannelUser({ supabase, channel, externalUserId } = {}) {
  const norm = normalizeChannelExternalUserId({ channel, externalUserId });
  if (norm.status !== 'ok') {
    return { ...norm, externalUserId: null, userId: null, via: null };
  }
  const external = norm.externalUserId;
  const base = { channel, externalUserId: external, userId: null, via: null };

  if (!supabase) return { ...base, status: 'error', reason: 'no_client' };

  try {
    // Every link for this external id, active and revoked. One round trip; the active-link
    // partial unique index guarantees at most one row has revoked_at IS NULL.
    const { data: links, error: linkErr } = await supabase
      .from('user_channel_links')
      .select('user_id, revoked_at')
      .eq('channel', channel)
      .eq('external_user_id', external);
    if (linkErr) return { ...base, status: 'error', reason: 'link_lookup_failed' };

    const rows = Array.isArray(links) ? links : [];
    const active = rows.find((r) => r.revoked_at === null || r.revoked_at === undefined);
    const revoked = rows.find((r) => r.revoked_at !== null && r.revoked_at !== undefined);

    // The legacy row is looked up in BOTH branches: when a link exists it is what makes a
    // conflict visible, and when none exists it is the fallback itself.
    const legacyId = Number(external);
    let legacyUserId = null;
    if (Number.isSafeInteger(legacyId) && legacyId > 0) {
      const { data: users, error: userErr } = await supabase
        .from('users').select('id').eq('id', legacyId).limit(1);
      if (userErr) return { ...base, status: 'error', reason: 'user_lookup_failed' };
      legacyUserId = users?.[0]?.id ?? null;
    }

    if (active) {
      const linkedUserId = normalizeUserId(active.user_id);
      if (linkedUserId === null) {
        // A stored id we cannot trust is worse than none: fail closed rather than guess.
        return { ...base, status: 'error', reason: 'link_user_id_unusable' };
      }
      const conflict =
        legacyUserId !== null && Number(legacyUserId) !== linkedUserId ? Number(legacyUserId) : null;
      return {
        ...base, status: 'linked', userId: linkedUserId, via: 'link',
        legacyConflictUserId: conflict,
      };
    }

    if (legacyUserId !== null) {
      return {
        ...base, status: 'legacy', userId: Number(legacyUserId), via: 'legacy',
        // If a link to a DIFFERENT user was revoked, the fallback now resolves to the
        // account's own original row. Surfaced so an operator can see that a withdrawn link
        // is not the same thing as a blocked account.
        revokedLinkUserId: revoked ? (normalizeUserId(revoked.user_id) ?? null) : null,
      };
    }

    if (revoked) {
      return { ...base, status: 'revoked', revokedLinkUserId: normalizeUserId(revoked.user_id) ?? null };
    }

    return { ...base, status: 'unlinked' };
  } catch (e) {
    return { ...base, status: 'error', reason: 'exception' };
  }
}

// ── reverse: platform user → external account ───────────────────────────────

/**
 * Resolve a platform user to their external channel account.
 *
 * Needed for OUTBOUND notifications. Today that path uses `business_members.user_id`
 * directly as the Telegram chat id, which is correct only by accident of the legacy
 * conflation — for a negative (email-origin) id it is not merely wrong, it is a NEGATIVE
 * chat id, which Telegram interprets as a GROUP. Sending there could deliver a business's
 * finances to an unrelated chat.
 *
 * Hence the hard guarantee below: this function never returns a negative external id, no
 * matter what is stored.
 *
 * @returns {{status:'linked'|'legacy'|'revoked'|'unlinked'|'invalid'|'error',
 *            channel:string|null, userId:number|null, externalUserId:string|null,
 *            via:'link'|'legacy'|null, revokedLinkExternalId?:string|null, reason?:string}}
 */
async function resolveChannelExternalId({ supabase, channel, userId } = {}) {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    return { status: 'invalid', channel: channel ?? null, userId: null, externalUserId: null, via: null, reason: 'unsupported_channel' };
  }
  const uid = normalizeUserId(userId);
  if (uid === null) {
    return { status: 'invalid', channel, userId: null, externalUserId: null, via: null, reason: 'malformed_user_id' };
  }
  const base = { channel, userId: uid, externalUserId: null, via: null };

  if (!supabase) return { ...base, status: 'error', reason: 'no_client' };

  try {
    const { data: links, error } = await supabase
      .from('user_channel_links')
      .select('external_user_id, revoked_at')
      .eq('channel', channel)
      .eq('user_id', uid);
    if (error) return { ...base, status: 'error', reason: 'link_lookup_failed' };

    const rows = Array.isArray(links) ? links : [];
    const active = rows.find((r) => r.revoked_at === null || r.revoked_at === undefined);
    const revoked = rows.find((r) => r.revoked_at !== null && r.revoked_at !== undefined);

    if (active) {
      // Re-validate on READ. The column is TEXT and 045 cannot constrain its shape, so a row
      // written by a future bug must not become a chat id. This is the guarantee that keeps
      // a negative value from ever reaching the Telegram API.
      const check = normalizeChannelExternalUserId({ channel, externalUserId: active.external_user_id });
      if (check.status !== 'ok') return { ...base, status: 'error', reason: 'stored_external_id_unusable' };
      return { ...base, status: 'linked', externalUserId: check.externalUserId, via: 'link' };
    }

    // Legacy fallback: a POSITIVE user id is itself the Telegram id. A negative id is
    // email-origin and has no Telegram account unless explicitly linked — which is the whole
    // reason this function exists.
    if (uid > 0) {
      const check = normalizeChannelExternalUserId({ channel, externalUserId: uid });
      if (check.status !== 'ok') return { ...base, status: 'error', reason: 'legacy_user_id_unusable' };
      return {
        ...base, status: 'legacy', externalUserId: check.externalUserId, via: 'legacy',
        revokedLinkExternalId: revoked ? (revoked.external_user_id ?? null) : null,
      };
    }

    if (revoked) {
      return { ...base, status: 'revoked', revokedLinkExternalId: revoked.external_user_id ?? null };
    }

    return { ...base, status: 'unlinked' };
  } catch (e) {
    return { ...base, status: 'error', reason: 'exception' };
  }
}

// ── Telegram convenience wrappers ───────────────────────────────────────────
// Thin, deliberately. No provider registry, no channel plug-in points: 'telegram' is the
// only channel 045's CHECK constraint permits, and adding another is a schema decision
// before it is a code one.

const resolveTelegramUser = ({ supabase, telegramId }) =>
  resolveChannelUser({ supabase, channel: CHANNEL_TELEGRAM, externalUserId: telegramId });

const resolveTelegramExternalId = ({ supabase, userId }) =>
  resolveChannelExternalId({ supabase, channel: CHANNEL_TELEGRAM, userId });

module.exports = {
  CHANNEL_TELEGRAM,
  SUPPORTED_CHANNELS,
  normalizeChannelExternalUserId,
  resolveChannelUser,
  resolveChannelExternalId,
  resolveTelegramUser,
  resolveTelegramExternalId,
};
