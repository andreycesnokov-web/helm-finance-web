// PR3 — the active WORKSPACE for a Telegram user: which company their next message posts to.
//
// This replaces the body of resolveTelegramActiveBusiness. Three things change, and it is
// worth being explicit about which of them are new behaviour and which are bug fixes:
//
//   1. IDENTITY. The workspace is resolved for the PLATFORM user (PR2.5's actor), not for a
//      raw Telegram id. Flag off ⇒ Number(telegram_id), exactly as before.
//   2. STATE. The selection moves from telegram_user_state (043) to user_channel_state (045),
//      behind its own flag, with 043 as a read fallback so nobody loses their selection.
//   3. ERRORS. The old code discarded every Supabase error. A failed membership query
//      produced `{status:'none'}`, which the bot classifies as "not connected" — so a database
//      blip told a linked user to re-onboard. That is the same error→unlinked collapse PR2.5
//      removed from the debt routes; this module refuses it too. A lookup that FAILED is 503,
//      never `none` and never `choose`.
//
// WHAT THIS MODULE DOES NOT DO
// ----------------------------
// No linking, no auto-linking, no backfill, no merging. It reads identity through the PR2a
// resolver and reads/writes exactly one thing: which workspace is active on this channel.

const { resolveTelegramActorForRoute } = require('./telegramActor');

const CHANNEL = 'telegram';
const RESOLVER_FLAG = 'TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED';
const STATE_FLAG = 'TELEGRAM_ACTIVE_WORKSPACE_STATE_ENABLED';

/** Is PR2.5 identity resolution on? Read per call — never captured at import. */
const isResolverEnabled = () => process.env[RESOLVER_FLAG] === 'true';

let warnedOrphanState = false;
/**
 * Is the 045 state store on?
 *
 * The state flag REQUIRES the resolver flag. Writing user_channel_state keyed by an
 * unresolved raw Telegram id would create rows that mean something different from every other
 * row in that table, and PR4 would have to tell them apart afterwards. So the dangerous
 * combination is ignored rather than honoured — the safe direction to fail is "keep using
 * 043", which is what production does today anyway.
 *
 * Ignored rather than fatal: this is a running server, and killing it because someone set one
 * env var without the other would turn a configuration slip into an outage.
 */
function isWorkspaceStateEnabled() {
  const wanted = process.env[STATE_FLAG] === 'true';
  if (!wanted) return false;
  if (isResolverEnabled()) return true;
  if (!warnedOrphanState) {
    warnedOrphanState = true;
    console.warn(`[workspace-state] ${STATE_FLAG}=true is IGNORED because ${RESOLVER_FLAG} is not true. `
      + 'Workspace state stays on telegram_user_state (043).');
  }
  return false;
}

// Failures are returned, never thrown: the caller must handle an explicit status, and a
// mid-request exception is exactly how the old code ended up swallowing things.
const fail = (httpStatus, code, safeMessage) =>
  ({ ok: false, actorError: true, httpStatus, code, error: code, safeMessage });

const LOOKUP_FAILED = () => fail(503, 'temporary_workspace_lookup_failed',
  'Cannot check your workspaces right now. Please try again.');
const WRITE_FAILED = () => fail(503, 'workspace_state_write_failed',
  'Could not save your workspace selection. Please try again.');

/**
 * Resolve the acting platform user id for a workspace operation.
 *
 * Flag off returns Number(telegram_id) with no validation, which is what the inline code did:
 * a malformed id keeps falling through to a lookup that finds nothing, rather than becoming a
 * new 400 that the OFF path never produced.
 */
async function resolveWorkspaceActor({ supabase, telegram_id, routeName }) {
  const actor = await resolveTelegramActorForRoute({ supabase, telegram_id, routeName });
  if (!actor.ok) {
    return fail(actor.httpStatus, actor.code, actor.safeMessage);
  }
  return { ok: true, userId: actor.userId, via: actor.via };
}

/**
 * Every workspace this user may post to, newest rules applied.
 *
 * Excluded, and why each matters:
 *   * personal workspaces — a Telegram payable is a company record; this was already excluded
 *   * ARCHIVED businesses — new here. Archiving sets businesses.status='archived' and
 *     deliberately leaves memberships active so it can be undone, so a membership-only filter
 *     keeps offering an archived company in /company and accepting postings into it. Note the
 *     comparison is `!== 'archived'`: rows predating the status column hold NULL and are live.
 */
async function loadWorkspaces(supabase, userId) {
  const { data, error } = await supabase.from('business_members')
    .select('role, business_id, businesses(id, name, business_code, type, status, owner_user_id)')
    .eq('user_id', userId).eq('status', 'active');
  if (error) {
    // The line this replaces was `const { data: mem } = await …` — the error was not read, so
    // a failed query became "you have no workspaces".
    console.warn('[workspace] membership lookup failed:', error.message);
    return { error: LOOKUP_FAILED() };
  }
  const rows = (data || []).filter((m) => m.businesses
    && m.businesses.type !== 'personal'
    && m.businesses.status !== 'archived');
  return { rows };
}

const toOption = (m, userId) => ({
  id: m.business_id,
  name: m.businesses.name,
  business_code: m.businesses.business_code || null,
  role: m.role,
  owner_user_id: m.businesses.owner_user_id || userId,
});

// ── state: read ─────────────────────────────────────────────────────────────

/**
 * The saved selection, and WHERE it came from.
 *
 * Precedence is user_channel_state, then telegram_user_state. The fallback exists so the
 * cutover loses nobody's selection: production has a live 043 row today, and a user whose
 * state has not been migrated yet must keep landing in the same company.
 *
 * `source` is returned because a stale value has to be cleared in the table it actually came
 * from — clearing the wrong one leaves the bad value in place and re-reads it next time.
 */
async function readSavedWorkspace(supabase, userId, stateEnabled) {
  if (stateEnabled) {
    const { data, error } = await supabase.from('user_channel_state')
      .select('active_business_id').eq('user_id', userId).eq('channel', CHANNEL).limit(1);
    if (error) {
      console.warn('[workspace] user_channel_state read failed:', error.message);
      return { error: LOOKUP_FAILED() };
    }
    const savedId = data?.[0]?.active_business_id || null;
    if (savedId) return { savedId, source: 'channel' };
  }

  // 043 holds legacy state only. A negative id is email-origin and cannot have a row there —
  // its Telegram id was never a user id — so the query is skipped rather than run for nothing.
  if (userId > 0) {
    const { data, error } = await supabase.from('telegram_user_state')
      .select('active_business_id').eq('user_id', userId).limit(1);
    if (error) {
      console.warn('[workspace] telegram_user_state read failed:', error.message);
      return { error: LOOKUP_FAILED() };
    }
    const savedId = data?.[0]?.active_business_id || null;
    if (savedId) return { savedId, source: 'legacy' };
  }

  return { savedId: null, source: null };
}

// ── state: write ────────────────────────────────────────────────────────────

/**
 * Persist the active workspace.
 *
 * The mirror is the part worth explaining. With the state flag on, a POSITIVE (legacy) user's
 * selection is written to user_channel_state AND to telegram_user_state. That second write
 * costs one upsert and is what makes the flag reversible: without it, a user who selects a
 * workspace with the flag on and is then rolled back reads stale 043 state and silently posts
 * to the wrong company. Silent mis-filing is the failure mode this whole module exists to
 * avoid, so paying an upsert to prevent it is cheap.
 *
 * A NEGATIVE (email-origin) id never touches 043 — under any flag combination. 043 keys on
 * `user_id` with the meaning "this is also the Telegram id"; a negative row there would be a
 * value whose meaning contradicts every other row in the table.
 */
async function writeSavedWorkspace(supabase, userId, businessId, stateEnabled) {
  if (stateEnabled) {
    const { error } = await supabase.from('user_channel_state')
      .upsert({ user_id: userId, channel: CHANNEL, active_business_id: businessId },
        { onConflict: 'user_id,channel' });
    if (error) {
      console.warn('[workspace] user_channel_state write failed:', error.message);
      return { error: WRITE_FAILED() };
    }
    if (userId > 0) {
      const { error: mirrorErr } = await supabase.from('telegram_user_state')
        .upsert({ user_id: userId, active_business_id: businessId }, { onConflict: 'user_id' });
      if (mirrorErr) {
        // Reported rather than shrugged off: the selection IS saved, but the rollback path is
        // no longer safe, and that is precisely the thing nobody would notice until a rollback.
        console.warn('[workspace] 043 mirror write failed:', mirrorErr.message);
        return { error: WRITE_FAILED() };
      }
    }
    return { ok: true };
  }

  // State store off: legacy table only, and only for ids it can represent.
  if (userId > 0) {
    const { error } = await supabase.from('telegram_user_state')
      .upsert({ user_id: userId, active_business_id: businessId }, { onConflict: 'user_id' });
    if (error) {
      console.warn('[workspace] telegram_user_state write failed:', error.message);
      return { error: WRITE_FAILED() };
    }
    return { ok: true };
  }

  // Resolver on, state store off, negative id: there is nowhere to put this. The selection
  // simply does not persist and the next call re-resolves. Surfaced as `persisted:false` so a
  // caller never reports a save that did not happen.
  return { ok: true, persisted: false };
}

/**
 * Drop a saved selection that no longer validates, in the table it came from.
 *
 * Best-effort by design, and this is the one place where that is the right call: the value has
 * already been ignored for this response, and if the clear fails it will be ignored again next
 * time. Failing the whole request over it would turn a self-healing condition into an outage.
 * The failure is logged so it is visible if it ever stops being transient.
 */
async function clearSavedWorkspace(supabase, userId, source) {
  const table = source === 'channel' ? 'user_channel_state' : 'telegram_user_state';
  const q = supabase.from(table).update({ active_business_id: null }).eq('user_id', userId);
  const { error } = await (source === 'channel' ? q.eq('channel', CHANNEL) : q);
  if (error) console.warn(`[workspace] could not clear stale selection in ${table}:`, error.message);
}

// ── the resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the active workspace.
 *
 * @returns {{ok:false, httpStatus:number, code:string, safeMessage:string}}
 *        | {{ok:true, status:'none', userId:number}}
 *        | {{ok:true, status:'active'|'auto'|'choose', userId:number,
 *            business?:object, options:object[]}}
 *
 * `none` means "resolved successfully; this user is in no workspace". It is never returned
 * because something failed — that distinction is the whole point of the rewrite.
 */
async function resolveTelegramActiveWorkspace({ supabase, telegram_id, routeName = 'active-workspace' } = {}) {
  const stateEnabled = isWorkspaceStateEnabled();

  const actor = await resolveWorkspaceActor({ supabase, telegram_id, routeName });
  if (!actor.ok) return actor;
  const userId = actor.userId;

  const { rows, error: memErr } = await loadWorkspaces(supabase, userId);
  if (memErr) return memErr;
  if (!rows.length) return { ok: true, status: 'none', userId };

  const options = rows.map((m) => toOption(m, userId));

  const saved = await readSavedWorkspace(supabase, userId, stateEnabled);
  if (saved.error) return saved.error;

  // Validated against the list that was just loaded, so an archived, personal, deleted or
  // no-longer-a-member selection cannot survive as the active workspace.
  const savedValid = saved.savedId ? rows.find((m) => m.business_id === saved.savedId) : null;
  if (savedValid) {
    return { ok: true, status: 'active', userId, business: toOption(savedValid, userId), options };
  }
  if (saved.savedId) await clearSavedWorkspace(supabase, userId, saved.source);

  if (rows.length === 1) {
    // Best-effort persistence: with exactly one candidate the next call resolves identically,
    // so a failed write is self-correcting and must not turn a correct answer into a 503.
    const w = await writeSavedWorkspace(supabase, userId, rows[0].business_id, stateEnabled);
    if (w.error) console.warn('[workspace] auto-select was not persisted; it will re-resolve.');
    return { ok: true, status: 'auto', userId, business: toOption(rows[0], userId), options };
  }

  return { ok: true, status: 'choose', userId, options };
}

/**
 * Set the active workspace explicitly (the /company selector).
 *
 * Unlike auto-selection, a write failure here IS fatal to the request: the user asked for
 * something, and answering `{ok:true}` after failing to store it means they carry on believing
 * they switched company while their next message files somewhere else.
 */
async function setTelegramActiveWorkspace({ supabase, telegram_id, business_id, routeName = 'set-active-workspace' } = {}) {
  const stateEnabled = isWorkspaceStateEnabled();

  const actor = await resolveWorkspaceActor({ supabase, telegram_id, routeName });
  if (!actor.ok) return actor;
  const userId = actor.userId;

  const { rows, error: memErr } = await loadWorkspaces(supabase, userId);
  if (memErr) return memErr;

  // Membership is checked against the SAME filtered list the selector offers, so a workspace
  // that cannot be shown cannot be selected either — including by a client that kept an id
  // from before the workspace was archived.
  const chosen = rows.find((m) => m.business_id === business_id);
  if (!chosen) {
    const { data, error } = await supabase.from('business_members')
      .select('businesses(type, status)')
      .eq('user_id', userId).eq('business_id', business_id).eq('status', 'active').limit(1);
    if (error) return LOOKUP_FAILED();
    const biz = data?.[0]?.businesses;
    if (!biz) return fail(403, 'not_a_member', 'You are not a member of this workspace.');
    if (biz.type === 'personal') return fail(400, 'business_workspace_required', 'Choose a business workspace.');
    if (biz.status === 'archived') return fail(400, 'workspace_archived', 'That workspace has been archived.');
    return fail(403, 'not_a_member', 'You are not a member of this workspace.');
  }

  const w = await writeSavedWorkspace(supabase, userId, business_id, stateEnabled);
  if (w.error) return w.error;

  return {
    ok: true, userId, persisted: w.persisted !== false,
    business: {
      id: chosen.businesses.id, name: chosen.businesses.name,
      business_code: chosen.businesses.business_code || null, role: chosen.role,
    },
  };
}

module.exports = {
  CHANNEL,
  RESOLVER_FLAG,
  STATE_FLAG,
  isResolverEnabled,
  isWorkspaceStateEnabled,
  resolveTelegramActiveWorkspace,
  setTelegramActiveWorkspace,
};
