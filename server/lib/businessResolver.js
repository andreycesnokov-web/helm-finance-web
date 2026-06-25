// Active-business resolver — extracted so it can be unit-tested without booting the
// whole Express app. Pure: takes the supabase client + an ensureDefaultBusiness fn.
//
// Selection priority: x-business-id header → ?business_id → body.business_id → the
// user's default business. An EXPLICIT but inaccessible id is rejected with a 403
// (never a silent fallback to the default workspace — that leaked the default
// business's data into a freshly-selected one).
async function resolveActiveBusiness(supabase, ensureDefaultBusiness, req) {
  const userId = req.user.userId;
  const requested =
    req.headers['x-business-id'] ||
    req.query?.business_id ||
    req.body?.business_id ||
    null;

  if (requested) {
    const { data } = await supabase.from('business_members')
      .select('role, status, business_id, businesses(*)')
      .eq('user_id', userId).eq('business_id', requested).eq('status', 'active')
      .limit(1);
    if (data?.length) {
      const m = data[0];
      return { business: m.businesses, role: m.role, ownerUserId: m.businesses.owner_user_id };
    }
    const err = new Error('workspace_not_accessible'); err.status = 403; throw err;
  }

  const { business, membership } = await ensureDefaultBusiness(userId);
  return { business, role: membership.role, ownerUserId: business.owner_user_id };
}

module.exports = { resolveActiveBusiness };
