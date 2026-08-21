// Route-level Telegram actor resolution (PR2.5).
//
// Sits between the Telegram routes and server/lib/channelIdentity.js, and owns one decision:
// given a telegram_id from a bot-authenticated request, WHICH platform user is acting — and
// if that cannot be established, what the route must do about it.
//
// Everything here is gated by TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED, default OFF.
//
//   OFF → `Number(telegram_id)`, exactly what every route does today. No validation is added,
//         deliberately: the point of the OFF path is that behaviour is unchanged, and a route
//         that today lets a malformed id fall through to a failed lookup must keep doing so.
//   ON  → resolveTelegramUser(), with the status mapping below.
//
// THE MAPPING THAT MATTERS MOST
// ----------------------------
// `error` MUST NOT collapse into `unlinked`. They look similar — neither yields a user — but
// they mean opposite things:
//
//   unlinked → "we know this account is not connected"  → onboarding is the right answer
//   error    → "we could not find out"                  → onboarding is a LIE
//
// A transient database blip that answers "not connected" tells a linked user to go and link
// an account they already linked, and it is indistinguishable from the PR5a.1 fail-closed
// guard working correctly. So `error` maps to a distinct temporary-unavailable code, and the
// route must not create, mutate or onboard on it.

const { resolveTelegramUser } = require('./channelIdentity');

const FLAG = 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED';

/** Read at call time, not at import, so tests can flip it without re-requiring the module. */
function isResolverEnabled() {
  return process.env[FLAG] === 'true';
}

// Counters for observability: how much traffic still resolves through the legacy id match is
// the number that says whether the PR4 migration is actually progressing. Process-local and
// deliberately not persisted — this is a signal, not a record.
const counters = { legacy: 0, linked: 0, unlinked: 0, revoked: 0, invalid: 0, error: 0, off: 0 };
const getCounters = () => ({ ...counters });
const resetCounters = () => { for (const k of Object.keys(counters)) counters[k] = 0; };

/**
 * Resolve the acting platform user for a bot-authenticated Telegram route.
 *
 * Never throws. Never writes. Callers must check `ok` before using `userId`.
 *
 * @returns {{ok:boolean, status:string, userId:number|null, externalUserId:string|null,
 *            via:'link'|'legacy'|null, legacyConflictUserId?:number|null,
 *            httpStatus?:number, code?:string, safeMessage?:string}}
 */
async function resolveTelegramActorForRoute({ supabase, telegram_id: telegramId, routeName } = {}) {
  // ── flag OFF: today's behaviour, unchanged ────────────────────────────────
  if (!isResolverEnabled()) {
    counters.off++;
    return {
      ok: true,
      status: 'legacy',
      userId: Number(telegramId),   // no validation: identical to the current inline code
      externalUserId: telegramId === null || telegramId === undefined ? null : String(telegramId),
      via: 'legacy',
    };
  }

  const r = await resolveTelegramUser({ supabase, telegramId });
  const base = {
    status: r.status,
    userId: r.userId ?? null,
    externalUserId: r.externalUserId ?? null,
    via: r.via ?? null,
  };

  switch (r.status) {
    case 'linked': {
      counters.linked++;
      if (r.legacyConflictUserId !== null && r.legacyConflictUserId !== undefined) {
        // Expected during migration: an email user linked the Telegram account whose old
        // positive-id row still exists. Logged because it is ALSO what a mistaken link looks
        // like. Ids only — no handle, no metadata, no secrets.
        console.warn(`[channel-identity] legacy conflict route=${routeName} `
          + `external=${r.externalUserId} linked_user=${r.userId} legacy_user=${r.legacyConflictUserId}`);
      }
      return { ok: true, ...base, legacyConflictUserId: r.legacyConflictUserId ?? null };
    }

    case 'legacy':
      counters.legacy++;
      return { ok: true, ...base };

    case 'unlinked':
      counters.unlinked++;
      return { ok: false, ...base, httpStatus: 403, code: 'not_linked',
        safeMessage: 'This Telegram account is not connected to CFO AI.' };

    case 'revoked':
      // Distinguished from not_linked so an operator can tell "never connected" from
      // "connection withdrawn". No legacy fallback here: channelIdentity already applied it
      // if one was available, so reaching this means there was none.
      counters.revoked++;
      return { ok: false, ...base, httpStatus: 403, code: 'link_revoked',
        safeMessage: 'This Telegram connection was removed. Reconnect in the CFO AI web app.' };

    case 'invalid':
      counters.invalid++;
      return { ok: false, ...base, httpStatus: 400, code: 'invalid_telegram_id',
        safeMessage: 'Invalid Telegram account id.' };

    case 'error':
    default:
      // 503, not 403. The caller cannot tell the difference from the body alone, so the
      // status code is what stops this being mistaken for a definite "not connected".
      counters.error++;
      console.warn(`[channel-identity] identity lookup failed route=${routeName} reason=${r.reason || 'unknown'}`);
      return { ok: false, ...base, status: 'error', httpStatus: 503,
        code: 'temporary_identity_lookup_failed',
        safeMessage: 'Cannot verify your Telegram connection right now. Please try again.' };
  }
}

/** Uniform failure body. Never leaks a reason string, a handle or an internal id. */
const actorErrorResponse = (actor) => ({
  error: actor.code || 'identity_unavailable',
  message: actor.safeMessage || 'Identity could not be resolved.',
});

/**
 * Send an actor failure as its OWN status, and nothing else.
 *
 * Why this exists: this module computed 400/403/503 carefully, and then four debt routes threw
 * that away with `if (r.error) return res.status(403).json({ error: 'forbidden' })`. A lookup
 * failure (503, "try again") arrived at the bot as a flat "you do not have access" — the exact
 * collapse the status mapping was written to prevent, and the one that turns a transient
 * Supabase blip into a user who believes their account was disconnected.
 *
 * The fallback is 503, never 403: if a status is somehow missing, "we could not tell" is the
 * honest answer. Saying "forbidden" asserts a fact about the user that we do not have.
 *
 * The body is error + message only — no reason, no telegram id, no handle, no metadata.
 */
function sendTelegramActorError(res, actor) {
  return res.status(actor.httpStatus || 503).json(actorErrorResponse(actor));
}

/**
 * Did this `{ error }` result come from identity resolution, or from business logic?
 *
 * Routes receive both through the same channel. Only actor failures carry a prepared status,
 * and they are tagged explicitly rather than sniffed, so a future business error that happens
 * to include an httpStatus cannot start impersonating an identity failure.
 */
const isActorError = (r) => Boolean(r && r.actorError);

module.exports = {
  FLAG,
  isResolverEnabled,
  resolveTelegramActorForRoute,
  actorErrorResponse,
  sendTelegramActorError,
  isActorError,
  getCounters,
  resetCounters,
};
