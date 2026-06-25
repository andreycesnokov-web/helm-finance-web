// Active-business resolver — extracted so it can be unit-tested without booting the
// whole Express app. Pure: takes the supabase client + an ensureDefaultBusiness fn.
//
// Selection priority: x-business-id header → ?business_id → body.business_id → the
// user's default business. An EXPLICIT but inaccessible id is rejected with a 403
// (never a silent fallback to the default workspace — that leaked the default
// business's data into a freshly-selected one). Personal workspaces are rejected on
// business routes.
//
// Returns { business, role, ownerUserId, isPrimaryBusiness }. `isPrimaryBusiness`
// marks the user's EARLIEST-created business workspace — the only one that may
// include legacy `business_id IS NULL` rows (migration 017 backfilled those into the
// default business). Every additional business is scoped strictly by business_id so a
// newly-created business starts genuinely empty.

function forbidden(message) { const e = new Error(message); e.status = 403; return e; }

// The user's primary business = earliest-created active-membership business of
// type 'business' (deterministic; never a personal workspace).
async function getPrimaryBusinessId(supabase, userId) {
  const { data } = await supabase.from('business_members')
    .select('business_id, businesses(created_at, type)')
    .eq('user_id', userId).eq('status', 'active');
  const owned = (data || [])
    .filter(m => m.businesses && m.businesses.type !== 'personal')
    .sort((a, b) => new Date(a.businesses.created_at || 0) - new Date(b.businesses.created_at || 0));
  return owned.length ? owned[0].business_id : null;
}

async function resolveActiveBusiness(supabase, ensureDefaultBusiness, req) {
  const userId = req.user.userId;
  const requested =
    req.headers['x-business-id'] ||
    req.query?.business_id ||
    req.body?.business_id ||
    null;

  let resolved;
  if (requested) {
    const { data } = await supabase.from('business_members')
      .select('role, status, business_id, businesses(*)')
      .eq('user_id', userId).eq('business_id', requested).eq('status', 'active')
      .limit(1);
    if (!data?.length) throw forbidden('workspace_not_accessible');
    const m = data[0];
    if (m.businesses?.type === 'personal') throw forbidden('business_workspace_required');
    resolved = { business: m.businesses, role: m.role, ownerUserId: m.businesses.owner_user_id };
  } else {
    const { business, membership } = await ensureDefaultBusiness(userId);
    resolved = { business, role: membership.role, ownerUserId: business.owner_user_id };
  }

  const primaryId = await getPrimaryBusinessId(supabase, userId);
  resolved.isPrimaryBusiness = !!primaryId && primaryId === resolved.business.id;
  return resolved;
}

module.exports = { resolveActiveBusiness, getPrimaryBusinessId };
