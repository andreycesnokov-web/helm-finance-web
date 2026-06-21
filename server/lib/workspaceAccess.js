// Workspace access resolvers. Separates PERSONAL workspace ownership from BUSINESS
// membership so a role in a connected business can never grant personal access, and
// a personal workspace can never silently replace the default business workspace.
//
// Pure-ish: every function takes the service-role `supabase` client explicitly.
// No arbitrary `.limit(1)` membership picks for financial reads.

// All active memberships for a user, with the joined business row.
async function listAccessibleWorkspaces(supabase, userId) {
  const { data, error } = await supabase.from('business_members')
    .select('role, status, business_id, businesses(*)')
    .eq('user_id', userId).eq('status', 'active');
  if (error) throw error;
  return (data || []).filter(m => m.businesses);
}

// Resolve ANY workspace (personal or business) the caller is an active member of.
// Returns { workspace, role } or null. Membership is required — never trust an id.
async function resolveActiveWorkspace(supabase, userId, workspaceId) {
  if (!workspaceId) return null;
  const { data } = await supabase.from('business_members')
    .select('role, status, businesses(*)')
    .eq('user_id', userId).eq('business_id', workspaceId).eq('status', 'active').limit(1);
  if (!data?.length || !data[0].businesses) return null;
  return { workspace: data[0].businesses, role: data[0].role };
}

// Resolve a PERSONAL workspace the caller OWNS. Financial reads on a personal
// workspace require owner identity — a connected business role gives no access.
// Throws { status, message } so the route can map it to an HTTP error.
async function resolvePersonalWorkspaceOwner(supabase, userId, workspaceId) {
  if (!workspaceId) throw { status: 400, message: 'workspace id required' };
  const { data: ws } = await supabase.from('businesses').select('*').eq('id', workspaceId).limit(1);
  const workspace = ws?.[0];
  if (!workspace) throw { status: 404, message: 'workspace not found' };
  if (workspace.type !== 'personal') throw { status: 400, message: 'not a personal workspace' };
  // ownership AND an active owner membership (defense in depth)
  if (String(workspace.owner_user_id) !== String(userId)) throw { status: 403, message: 'not your personal workspace' };
  const { data: m } = await supabase.from('business_members')
    .select('role').eq('user_id', userId).eq('business_id', workspaceId).eq('status', 'active').limit(1);
  if (!m?.length) throw { status: 403, message: 'not your personal workspace' };
  return workspace;
}

// Is the caller an active member of this BUSINESS workspace (for business-side reads)?
async function isBusinessMember(supabase, userId, businessId) {
  const { data } = await supabase.from('business_members')
    .select('role').eq('user_id', userId).eq('business_id', businessId).eq('status', 'active').limit(1);
  return data?.length ? data[0].role : null;
}

module.exports = { listAccessibleWorkspaces, resolveActiveWorkspace, resolvePersonalWorkspaceOwner, isBusinessMember };
