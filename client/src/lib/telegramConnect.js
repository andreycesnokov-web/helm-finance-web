// PR4b2 — the decisions behind the Telegram connect card, kept out of the component.
//
// WHY THIS FILE EXISTS
// --------------------
// The client has no test framework (no vitest, no testing-library, no jsdom), so a React
// component cannot be rendered in a test here. Rather than ship the interesting parts untested
// — or bolt a whole test stack onto the app in a UI PR — the logic that can actually be got
// wrong lives here as plain functions, and the repo's existing `node --test` runner exercises
// them directly. The component keeps the parts a test could only re-describe: markup and CSS.
//
// What that buys: error mapping, link validation and state derivation are covered by real
// assertions. What it does not: that the card renders those states. That boundary is stated in
// the report rather than papered over.

// The bot the product actually runs on. Used only when /api/telegram/config cannot be reached.
// The fallback is deliberately the real bot: a retired name or a placeholder would render a link
// that dead-ends, which is worse than a link that is merely slightly stale.
export const DEFAULT_BOT_USERNAME = 'CFOAIFinance_Bot'

// A link payload is `link_` + 43 base64url characters = 48, inside Telegram's 64-char /start
// limit. The bot enforces the same shape; if these two ever disagree, links mint fine and fail
// on arrival, so the constant is worth stating in both places.
const DEEP_LINK_RE = /^https:\/\/t\.me\/[A-Za-z0-9_]{1,32}\?start=link_[A-Za-z0-9_-]{43}$/

/**
 * The card's state, derived from the status endpoint.
 *
 * `revoked` is deliberately distinct from `not_connected`: the user disconnected on purpose and
 * the copy should acknowledge that rather than pretend they were never connected.
 */
export function connectionState(status) {
  if (!status) return 'loading'
  switch (status.status) {
    case 'connected': return 'connected'
    case 'revoked': return 'revoked'
    case 'not_connected': return 'not_connected'
    default: return 'error'
  }
}

/**
 * Is the backend-provided deep link safe to open?
 *
 * The backend builds this and already enforces the length limit, but the UI is what puts it in
 * front of the user — so it is re-checked here rather than trusted. A link that fails this is a
 * bug worth surfacing, not something to render and hope.
 */
export function isSafeDeepLink(url) {
  return typeof url === 'string' && DEEP_LINK_RE.test(url)
}

/**
 * Backend failure → the message key the user should see.
 *
 * A positive map, not a fallback chain: an unfamiliar code becomes a temporary problem, which is
 * the honest answer for something we do not recognise. Anything that mapped an unknown code to a
 * definite statement ("already linked elsewhere") would be guessing about the user's account.
 */
const ERROR_KEYS = {
  already_linked: 'telegram.errAlreadyLinked',
  user_already_linked: 'telegram.errAlreadyLinked',
  external_already_linked: 'telegram.errExternalLinked',
  not_linked: 'telegram.errNotLinked',
  bot_not_configured: 'telegram.errBotNotConfigured',
  rate_limited: 'telegram.errRateLimited',
  temporary_link_failure: 'telegram.errTemporary',
  temporary_link_lookup_failed: 'telegram.errTemporary',
  token_create_failed: 'telegram.errTemporary',
  revoke_failed: 'telegram.errTemporary',
}

/**
 * @param {{status?: number, message?: string}} err  as thrown by apiFetch: `message` is the
 *        backend's error CODE and `status` the HTTP status.
 * @returns {{key: string, authExpired: boolean}}
 */
export function errorKey(err) {
  const code = err && typeof err.message === 'string' ? err.message : ''
  const status = err && typeof err.status === 'number' ? err.status : 0

  // 401 is not a Telegram problem — the session ended. The caller hands it to the app's
  // existing auth handling rather than rendering it inside the card.
  if (status === 401) return { key: 'telegram.errAuth', authExpired: true }

  const byCode = ERROR_KEYS[code]
  if (byCode) return { key: byCode, authExpired: false }

  if (status === 429) return { key: 'telegram.errRateLimited', authExpired: false }
  if (status === 503) return { key: 'telegram.errTemporary', authExpired: false }
  // Includes a network failure, where apiFetch rejects with no status at all.
  return { key: 'telegram.errTemporary', authExpired: false }
}

/** Whole minutes left before a minted link expires; 0 once it has. */
export function minutesUntil(expiresAt, now = Date.now()) {
  if (!expiresAt) return 0
  const ms = new Date(expiresAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.round(ms / 60000))
}

/** Has a minted link passed its expiry? Drives the "generate a new one" state. */
export function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false
  const t = new Date(expiresAt).getTime()
  return Number.isFinite(t) && t <= now
}
