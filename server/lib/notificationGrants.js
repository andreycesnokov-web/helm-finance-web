// Loader for company-admin notification grants (migration 046).
//
// This is the ONE place that touches business_member_notification_grants at send time. It sits
// between the policy resolver (which decides eligibility given a grant map) and the database
// (which stores the grants), so the resolver stays pure and testable and the flag/IO concerns
// live here.
//
// FLAG AND FAIL-CLOSED POSTURE
// ----------------------------
// COMPANY_NOTIFICATION_GRANTS_ENABLED gates the whole feature. With it OFF this module never
// queries the table and returns null, which the resolver reads as "owner-only" — i.e. exactly
// the behaviour that shipped before grants existed. With it ON, a query error also returns null:
// a grant we cannot read is not a grant, so a lookup failure narrows to owner rather than
// widening to a guessed CEO/CFO. There is no path here that turns a failure into a recipient.

const GRANTS_FLAG = 'COMPANY_NOTIFICATION_GRANTS_ENABLED';

/** Read per call, exact string 'true'. Matches the other runtime flags in this codebase. */
function isGrantsEnabled() {
  return process.env[GRANTS_FLAG] === 'true';
}

/**
 * Load the enabled grants for one business, as the resolver's grant map.
 *
 * @returns {Promise<object|null>}  { [userId]: { [category]: true } } for the ENABLED grants of
 *          this business, or null when the flag is off or the lookup fails. Only enabled rows are
 *          included and only `true` is ever stored, so the resolver's strict `=== true` check can
 *          never be tricked by a disabled row that happens to be present.
 *
 * Business scope is enforced here (WHERE business_id = …) AND again in the resolver (it re-checks
 * every member's business_id). A grant row for another business cannot reach a recipient even if
 * this query were somehow wrong.
 */
async function loadBusinessGrants({ supabase, businessId } = {}) {
  if (!isGrantsEnabled()) return null;                       // flag off: table is never queried
  const bizId = typeof businessId === 'string' ? businessId.trim() : '';
  if (!bizId) return null;

  let res;
  try {
    res = await supabase.from('business_member_notification_grants')
      .select('user_id, category, enabled, business_id')
      .eq('business_id', bizId)
      .eq('enabled', true);
  } catch (e) {
    // Fail closed to owner-only. A grant we could not read is not a grant.
    console.warn(`[notify-grants] load failed for business=${bizId}: ${e && e.message}`);
    return null;
  }
  if (res?.error) {
    console.warn(`[notify-grants] load error for business=${bizId}: ${res.error.message}`);
    return null;
  }

  const map = {};
  for (const row of res?.data || []) {
    // Belt and braces: honour the same predicates the query used, so a row that slipped through
    // a wrong filter cannot enable anyone.
    if (!row || row.enabled !== true) continue;
    if (String(row.business_id) !== String(bizId)) continue;
    const uid = row.user_id;
    if (uid === null || uid === undefined) continue;
    (map[uid] || (map[uid] = {}))[row.category] = true;
  }
  return map;
}

module.exports = { GRANTS_FLAG, isGrantsEnabled, loadBusinessGrants };
