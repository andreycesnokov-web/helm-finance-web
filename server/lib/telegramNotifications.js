// PR2.6 — who may receive an outbound Telegram message, and what their chat id is.
//
// THE BUG THIS CLOSES
// -------------------
// Every outbound path used a platform user id directly as a Telegram chat id, on the strength
// of a comment that appeared twice in server/index.js: "users.id IS the Telegram chat id".
// That was true while every account came from Telegram. Migration 042 added email-origin
// accounts with NEGATIVE ids, and Telegram reads a negative chat_id as a GROUP.
//
// So the failure mode is not "the message does not arrive". It is "a business's amounts,
// counterparties and approval buttons arrive in an unrelated group chat". That is a data
// disclosure with a plausible-looking success response behind it.
//
// WHY THE NEGATIVE GUARD IS NOT BEHIND A FLAG
// -------------------------------------------
// There is no configuration of this system in which sending a negative number as chat_id is
// the intended behaviour. It was never correct, under any flag, at any point in the product's
// history. Putting the guard behind a flag would imply a setting where the hazard is
// acceptable. Reverse RESOLUTION is flagged, because that genuinely changes who gets messages;
// the guard is not, because it only removes an always-wrong path.
//
// FAIL CLOSED
// -----------
// Every ambiguous answer drops the recipient. A dropped recipient is a message nobody reads —
// annoying, recoverable, visible in logs. A wrongly-resolved recipient is company financials
// in a stranger's chat. Those are not symmetric, so the tie is not broken by availability.

const { resolveTelegramExternalId } = require('./channelIdentity');

const NOTIFY_FLAG = 'TELEGRAM_NOTIFY_REVERSE_RESOLVER_ENABLED';

/** Is reverse resolution on? Read per call — never captured at import. */
const isNotifyResolverEnabled = () => process.env[NOTIFY_FLAG] === 'true';

// A Telegram user id: positive int64, no leading zeros. Same shape the resolver enforces, kept
// here as an independent check so this module cannot emit a bad chat id even if something
// upstream changes.
const TELEGRAM_CHAT_ID = /^[1-9][0-9]{0,18}$/;

/**
 * The last line of defence, applied to every chat id this module returns.
 *
 * Deliberately paranoid about types: a Number that is not an integer, a string with a sign, a
 * bare '0', an object that stringifies to something plausible — all refused. The cost of a
 * false refusal is one undelivered notification; the cost of a false acceptance is the group
 * chat scenario above.
 */
function isSendableChatId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value !== 'string') return false;
  return TELEGRAM_CHAT_ID.test(value);
}

/** A platform user id: a non-zero safe integer. Negative ids are email-origin and legitimate. */
function normalizeUserId(value) {
  if (typeof value === 'string' && /^-?[1-9][0-9]{0,18}$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) return null;
  return value;
}

/**
 * Resolve platform user ids to Telegram chat ids.
 *
 * @param {object}   args
 * @param {object}   args.supabase
 * @param {number[]} args.userIds     platform user ids (business_members.user_id, etc.)
 * @param {string}   args.reason      short label for logs ('debt-submitted', 'ceo-test', …)
 * @param {boolean}  args.allowLegacy may a positive id stand in for its own chat id?
 *
 * @returns {Promise<{chatIds:string[], recipients:{userId:number, chatId:string, via:string}[],
 *                    dropped:{userId:(number|null), reason:string}[]}>}
 *
 * Never throws, never returns a negative or malformed chat id, and never returns a chat id for
 * a negative user id that has no active link.
 */
async function resolveTelegramNotificationRecipients({
  supabase, userIds = [], reason = 'notification', allowLegacy = true,
} = {}) {
  const recipients = [];
  const dropped = [];
  const seenUserIds = new Set();
  // De-duplication happens HERE, on the resolved chat id — not on the input user ids.
  //
  // Two different platform users can legitimately resolve to the SAME Telegram account during
  // the migration: a legacy positive user 123, and an email-origin user linked to external id
  // 123. That is the `legacyConflictUserId` case PR2a surfaces, and de-duping on user ids
  // would send that person the same message twice.
  const seenChatIds = new Set();

  const drop = (userId, why) => {
    dropped.push({ userId: userId ?? null, reason: why });
    // Safe metadata only: an id and a reason. No payload, no amounts, no counterparties —
    // a log line about a notification must not become the disclosure the drop prevented.
    console.warn(`[notify-resolve] dropped recipient reason=${why} user=${userId ?? 'null'} for=${reason}`);
  };

  const accept = (userId, chatId, via) => {
    const id = String(chatId);
    if (!isSendableChatId(id)) { drop(userId, 'unsendable_chat_id'); return; }
    if (seenChatIds.has(id)) return;     // same person reached twice; not an error
    seenChatIds.add(id);
    recipients.push({ userId, chatId: id, via });
  };

  for (const raw of Array.isArray(userIds) ? userIds : []) {
    const userId = normalizeUserId(raw);
    if (userId === null) { drop(null, 'invalid_user_id'); continue; }
    if (seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);

    if (!isNotifyResolverEnabled()) {
      // Flag off: today's behaviour for positive ids, and ONLY for positive ids. The negative
      // branch is the unconditional guard — with the flag off there is no link table being
      // consulted, so a negative id has no way to become a chat id and must be dropped.
      if (userId > 0 && allowLegacy) accept(userId, userId, 'legacy');
      else drop(userId, userId > 0 ? 'legacy_not_allowed' : 'negative_user_id_unresolvable');
      continue;
    }

    let r;
    try {
      r = await resolveTelegramExternalId({ supabase, userId });
    } catch (e) {
      // The resolver is written not to throw; if it somehow does, that is still not a reason
      // to guess a chat id.
      drop(userId, 'resolver_exception');
      continue;
    }

    switch (r.status) {
      case 'linked':
        accept(userId, r.externalUserId, 'link');
        break;
      case 'legacy':
        // The resolver only produces `legacy` for a positive id, so this cannot be a negative
        // fallback. `allowLegacy` exists for callers who want links-only delivery.
        if (allowLegacy) accept(userId, r.externalUserId, 'legacy');
        else drop(userId, 'legacy_not_allowed');
        break;
      case 'revoked':
        // A withdrawn link is a decision, not a gap. Falling back to a legacy id here would
        // quietly undo it.
        drop(userId, 'link_revoked');
        break;
      case 'unlinked':
        drop(userId, 'not_linked');
        break;
      case 'invalid':
        drop(userId, 'invalid_user_id');
        break;
      case 'error':
      default:
        // Fail closed. "We could not look it up" is not permission to guess.
        drop(userId, 'identity_lookup_failed');
        break;
    }
  }

  return { chatIds: recipients.map((x) => x.chatId), recipients, dropped };
}

/**
 * Resolve exactly one user, for routes where delivery IS the operation.
 *
 * Returns the same shape so callers can report `dropped[0].reason` verbatim instead of
 * re-deriving why nobody was reachable.
 */
async function resolveSingleTelegramRecipient({ supabase, userId, reason, allowLegacy = true } = {}) {
  const r = await resolveTelegramNotificationRecipients({ supabase, userIds: [userId], reason, allowLegacy });
  return { chatId: r.recipients[0]?.chatId || null, via: r.recipients[0]?.via || null,
    dropped: r.dropped[0]?.reason || null };
}

module.exports = {
  NOTIFY_FLAG,
  isNotifyResolverEnabled,
  isSendableChatId,
  resolveTelegramNotificationRecipients,
  resolveSingleTelegramRecipient,
};
