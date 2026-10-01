// Central notification permission policy.
//
// WHY THIS EXISTS
// ---------------
// Recipient selection used to live inside the send function: one hard-coded role list
// (`['owner','ceo','admin','cfo']`) applied to every kind of alert, financial or not. That meant
// the answer to "who may see this company's cash position?" was a literal in a send site, and
// adding a notification type meant copying it. This module is the single place that answers it.
//
// THE TWO GATES
// -------------
// Delivery requires BOTH:
//   1. policy — the user's role in this business permits this category, and
//   2. preference — the user has not switched this category off.
//
// They are not symmetric, and the asymmetry is the point:
//   * preference OFF suppresses a notification the policy would have allowed;
//   * preference ON grants NOTHING. It cannot widen the role gate, so a preference row for a
//     category a user may not receive is inert rather than dangerous.
//
// Everything here returns PLATFORM user ids. Turning those into Telegram chat ids is the job of
// telegramNotifications.js, which owns link revocation and the negative-id guard. Keeping the
// two apart is what stops "who is allowed" and "where do we send" from being decided together
// by whichever piece of code happens to have both facts.

const CATEGORIES = Object.freeze([
  'company_financial',
  'tax_compliance',
  'payables_receivables',
  'documents_review',
  'own_request_status',
  'team_approvals',
  'ai_cfo_summary',
  'system_identity',
]);

// MVP posture: financial visibility is the active OWNER only.
//
// A generic `admin` is deliberately NOT a financial recipient. Admin is an operational role that
// can be granted for scheduling or document handling; treating it as financial would mean every
// such grant silently widened who can see company cash. If an admin should receive these, make
// them an owner — that decision should be explicit and visible in the members list, not implied
// by a role name. `ceo` and `cfo` are excluded on the same reasoning for MVP.
const OWNER_ONLY = Object.freeze(['owner']);

// Company-admin grants (Company Admin Notification Grants, migration 046). An owner may hand
// specific financial categories to a CEO or CFO — and ONLY a CEO or CFO. Admin, manager and
// employee are not grantable in this phase: widening those would re-open the "an operational
// role silently sees company cash" hole the owner-only posture closed.
//
// A grant is not a role. It never bypasses role validation: eligibility is always the member's
// CURRENT active role AND an explicit grant, checked together. So a grant row for a manager, or
// a stale grant for someone who used to be CFO and is now a manager, is inert — the role no
// longer matches, and no amount of forged grant data changes that.
const GRANTABLE_ROLES = Object.freeze(['ceo', 'cfo']);

function isGrantableRole(role) { return GRANTABLE_ROLES.includes(role); }
// GRANTABLE_CATEGORIES and isGrantableCategory are defined just after CATEGORY_POLICY below,
// because they read from it.

/**
 * Does an explicit grant let this user receive this category?
 *
 * Default is FALSE — the exact opposite of preferences. A CEO/CFO receives a financial category
 * only when a row explicitly says so; absent map, absent user, absent category, or anything that
 * is not strictly `true` all mean "not granted". A half-written or truthy-but-not-true value must
 * never be read as a grant, because the failure mode here is disclosure.
 *
 * @param {object|null} grants  { [userId]: { [category]: boolean } }, already scoped to ONE
 *        business by the loader. Passing grants from another business would be a bug in the
 *        caller; the resolver additionally re-checks the member's business_id regardless.
 */
function grantEnabled(grants, userId, category) {
  if (!grants || typeof grants !== 'object') return false;
  const forUser = grants[userId] ?? grants[String(userId)];
  if (!forUser || typeof forUser !== 'object') return false;
  return forUser[category] === true;
}

// `scope` decides WHERE recipients come from, and the two are mutually exclusive:
//   'business' — derived from active membership of the business. The caller cannot name them.
//   'subject'  — supplied by the caller (the actor, the subject, the assignee). No role widening
//                is possible because no role lookup happens; the caller's list is the ceiling.
const CATEGORY_POLICY = Object.freeze({
  company_financial:    { scope: 'business', roles: OWNER_ONLY, financial: true },
  tax_compliance:       { scope: 'business', roles: OWNER_ONLY, financial: true },
  payables_receivables: { scope: 'business', roles: OWNER_ONLY, financial: true },
  documents_review:     { scope: 'business', roles: OWNER_ONLY, financial: true },
  team_approvals:       { scope: 'business', roles: OWNER_ONLY, financial: true },
  ai_cfo_summary:       { scope: 'business', roles: OWNER_ONLY, financial: true },
  own_request_status:   { scope: 'subject',  roles: null,       financial: false },
  system_identity:      { scope: 'subject',  roles: null,       financial: false },
});

// The categories an owner may grant — exactly the business-scoped (financial) ones. Subject
// categories are per-person by nature and have nothing to grant. Defined here (after
// CATEGORY_POLICY) because it reads from it.
const GRANTABLE_CATEGORIES = Object.freeze(
  CATEGORIES.filter((c) => CATEGORY_POLICY[c].scope === 'business'),
);

function isGrantableCategory(category) {
  return typeof category === 'string' && GRANTABLE_CATEGORIES.includes(category);
}

/**
 * Unknown categories send to NOBODY.
 *
 * A typo in a category name must not fall back to a permissive default. The failure mode of
 * "sends nothing" is a missing notification someone reports; the failure mode of "sends to a
 * default audience" is a disclosure nobody notices.
 */
function categoryPolicy(category) {
  if (typeof category !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(CATEGORY_POLICY, category)
    ? CATEGORY_POLICY[category]
    : null;
}

function isKnownCategory(category) {
  return categoryPolicy(category) !== null;
}

function normalizeUserId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value !== 0) return value;
  if (typeof value === 'string' && /^-?[1-9][0-9]{0,18}$/.test(value)) return Number(value);
  return null;
}

/**
 * Is this category switched on for this user?
 *
 * Default is ON. Users who have never opened notification settings keep receiving what their
 * role allows, which is today's behaviour — a default of OFF would silently mute everyone the
 * moment preferences shipped.
 *
 * @param {object|null} preferences  { [userId]: { [category]: boolean } }. Absent map, absent
 *        user, or absent category all mean "not configured" → ON. Only an explicit `false`
 *        suppresses, so a half-written row cannot mute a user by accident.
 */
function preferenceEnabled(preferences, userId, category) {
  if (!preferences || typeof preferences !== 'object') return true;
  const forUser = preferences[userId] ?? preferences[String(userId)];
  if (!forUser || typeof forUser !== 'object') return true;
  return forUser[category] !== false;
}

/**
 * Which categories may this role receive at all?
 *
 * Drives the settings UI: a category a role can never receive is shown disabled with a reason,
 * rather than offered as a toggle that silently does nothing.
 */
function categoriesForRole(role) {
  return CATEGORIES.filter((c) => {
    const p = CATEGORY_POLICY[c];
    if (p.scope === 'subject') return true;          // everyone gets their own request updates
    if (p.roles.includes(role)) return true;         // owner: baseline
    // CEO/CFO can receive a business category, but only once explicitly granted. The UI renders
    // these as toggles (off by default); every other role renders them disabled with a reason.
    return isGrantableRole(role) && p.scope === 'business';
  });
}

/** Why a category is unavailable, for the settings UI. */
function unavailableReason(category) {
  const p = categoryPolicy(category);
  if (!p) return 'unknown';
  if (p.scope === 'subject') return null;
  return 'owner_only';
}

/**
 * Resolve who may receive this notification.
 *
 * `businessId` is REQUIRED for business-scoped categories and is never inferred. `ownerUserId`
 * is diagnostic only — it does not select recipients and must not be used to find a business.
 *
 * @returns {Promise<{userIds:number[], dropped:{userId:(number|null),reason:string}[],
 *                    category:(string|null), scope:(string|null)}>}
 *
 * Never throws. Every path that cannot establish permission returns an EMPTY recipient list —
 * a lookup failure is not permission to fall back to a wider audience.
 */
async function resolveNotificationAudience({
  supabase,
  category,
  businessId = null,
  subjectUserIds = [],
  excludeUserIds = [],
  preferences = null,
  grants = null,
} = {}) {
  const dropped = [];
  const drop = (userId, reason) => {
    dropped.push({ userId: userId ?? null, reason });
    // Metadata only — an id and a reason. A log line about a suppressed notification must not
    // reproduce the content the suppression was protecting.
    console.warn(`[notify-policy] dropped user=${userId ?? 'null'} reason=${reason} category=${typeof category === 'string' ? category : 'invalid'}`);
  };

  const policy = categoryPolicy(category);
  if (!policy) {
    drop(null, 'unknown_category');
    return { userIds: [], dropped, category: null, scope: null };
  }

  const excluded = new Set(
    (Array.isArray(excludeUserIds) ? excludeUserIds : []).map(normalizeUserId).filter((x) => x !== null),
  );

  let candidates = [];

  if (policy.scope === 'subject') {
    // The caller names the audience. No role lookup happens, so this branch can only ever
    // narrow the caller's list — it cannot discover additional recipients.
    candidates = (Array.isArray(subjectUserIds) ? subjectUserIds : []);
  } else {
    // The business must be NAMED by the event. It used to be inferred from the notifying
    // user's first active membership (`.limit(1)`), which is wrong the moment anyone owns two
    // companies: a payable in company B would be announced to whoever happened to come first,
    // and that could be company A. Ordering was never specified, so the leak was not even
    // deterministic. There is no safe inference here — a user has many businesses and a
    // notification belongs to exactly one, so a missing id is a bug in the caller, not a gap
    // for this resolver to paper over.
    const bizId = typeof businessId === 'string' ? businessId.trim() : '';
    if (!bizId) {
      drop(null, 'missing_business_id');
      return { userIds: [], dropped, category, scope: policy.scope };
    }

    // Grants only ever ADD to the owner baseline, and only for grantable (business) categories.
    // When `grants` is null — the backend flag is off, or the load failed — nobody but the owner
    // is eligible, so behaviour is exactly what it was before grants existed. "Grant lookup
    // failed" resolves to owner-only, never to a wider set: a failure is not a grant.
    const grantsActive = grants && isGrantableCategory(category);
    const queryRoles = grantsActive ? [...policy.roles, ...GRANTABLE_ROLES] : policy.roles;

    let members;
    try {
      members = await supabase.from('business_members')
        .select('user_id, role, status, business_id')
        .eq('business_id', bizId)
        .eq('status', 'active')          // removed or inactive members receive nothing
        .in('role', queryRoles);
    } catch (e) {
      // Fail closed. "We could not read the members table" is not a reason to notify anyone.
      drop(null, 'membership_lookup_failed');
      return { userIds: [], dropped, category, scope: policy.scope };
    }
    if (members?.error) {
      drop(null, 'membership_lookup_failed');
      return { userIds: [], dropped, category, scope: policy.scope };
    }
    // Re-check business, role and status on the returned rows rather than trusting the query
    // shape. A filter that silently stops being applied is exactly the kind of change this
    // guards — and for business_id the cost of that change is a cross-tenant disclosure, so it
    // is verified on the way out as well as constrained on the way in.
    //
    // Eligibility per row: an owner is always in; a CEO/CFO is in only when grantsActive AND an
    // explicit grant names them for THIS category. The role is read from the live membership
    // row, so a forged or stale grant cannot promote anyone — the role check runs first and the
    // grant only qualifies a role that is already CEO/CFO right now.
    candidates = (members?.data || [])
      .filter((m) => {
        if (!m || String(m.business_id) !== String(bizId) || m.status !== 'active') return false;
        if (policy.roles.includes(m.role)) return true;                       // owner baseline
        if (grantsActive && isGrantableRole(m.role) && grantEnabled(grants, m.user_id, category)) return true;
        if (isGrantableRole(m.role)) drop(m.user_id, 'no_grant');             // eligible role, not granted
        return false;
      })
      .map((m) => m.user_id);
  }

  const userIds = [];
  const seen = new Set();
  for (const raw of candidates) {
    const userId = normalizeUserId(raw);
    if (userId === null) { drop(null, 'invalid_user_id'); continue; }
    if (seen.has(userId)) continue;                       // no duplicate recipients
    seen.add(userId);
    if (excluded.has(userId)) { drop(userId, 'excluded'); continue; }
    if (!preferenceEnabled(preferences, userId, category)) { drop(userId, 'preference_off'); continue; }
    userIds.push(userId);
  }

  return { userIds, dropped, category, scope: policy.scope };
}

module.exports = {
  CATEGORIES,
  CATEGORY_POLICY,
  GRANTABLE_ROLES,
  GRANTABLE_CATEGORIES,
  categoryPolicy,
  isKnownCategory,
  isGrantableRole,
  isGrantableCategory,
  preferenceEnabled,
  grantEnabled,
  categoriesForRole,
  unavailableReason,
  resolveNotificationAudience,
};
