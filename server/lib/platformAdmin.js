'use strict';

/**
 * Platform Admin Authorization Core
 * 
 * Implements server-side database-backed RBAC for CFO AI Platform Administration.
 * Platform admins must:
 * 1. Authenticate via email (JWT must have auth_channel === 'email').
 * 2. Have a verified email in user_email_identities (email_verified_at IS NOT NULL).
 * 3. Have an active record in platform_admins with is_active = true and revoked_at IS NULL.
 * 
 * Telegram IDs, ADMIN_TELEGRAM_IDS, and user-supplied role claims are NEVER trusted.
 */

// Backward-compatibility: maintain exported adminCache and clearAdminCache as no-ops
const adminCache = new Map();

function clearAdminCache(userId) {
  if (userId !== undefined && userId !== null) {
    adminCache.delete(Number(userId));
  } else {
    adminCache.clear();
  }
}

/**
 * Resolves the platform admin record for a user.
 * Returns null if the user is not an active platform admin or not email-authenticated.
 * 
 * Strict Hardening (SEC-P1-01):
 * - NO in-memory caching of positive or negative authorizations.
 * - Always queries PostgreSQL directly on EVERY administrative request.
 * - Fails closed (returns null) on DB disconnect, outage, timeout, or query errors.
 */
async function resolvePlatformAdmin(supabase, userId, authChannel) {
  const uid = Number(userId);
  if (!Number.isSafeInteger(uid) || uid === 0) return null;

  // Strict rule: Telegram or non-email sessions NEVER receive platform admin privileges
  if (authChannel !== 'email') return null;

  try {
    // 1. Check platform_admins table for an active role directly in PostgreSQL
    const { data: adminRows, error: adminErr } = await supabase
      .from('platform_admins')
      .select('user_id, role, is_active, created_at, created_by, updated_at, revoked_at')
      .eq('user_id', uid)
      .eq('is_active', true)
      .is('revoked_at', null)
      .limit(1);

    if (adminErr || !adminRows || adminRows.length === 0) {
      return null;
    }

    const admin = adminRows[0];
    if (admin.role !== 'super_admin' && admin.role !== 'platform_admin') {
      return null;
    }

    // 2. Check that the user has a verified email identity directly in PostgreSQL
    const { data: emailRows, error: emailErr } = await supabase
      .from('user_email_identities')
      .select('email, email_verified_at')
      .eq('user_id', uid)
      .not('email_verified_at', 'is', null)
      .limit(1);

    if (emailErr || !emailRows || emailRows.length === 0) {
      // Role exists in DB, but email is not verified -> reject
      return null;
    }

    return {
      userId: uid,
      role: admin.role,
      email: emailRows[0].email,
      emailVerifiedAt: emailRows[0].email_verified_at,
      createdAt: admin.created_at,
      createdBy: admin.created_by,
    };
  } catch {
    // Fail-closed on database outage / error
    return null;
  }
}

/**
 * Middleware: Requires active Platform Admin (super_admin or platform_admin) with email session.
 */
function createRequireAdmin(supabase) {
  return async function requireAdmin(req, res, next) {
    if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.auth_channel !== 'email') {
      return res.status(403).json({
        error: 'admin_email_required',
        message: 'Platform administration requires sign-in via verified email OTP / magic-link.',
      });
    }

    const admin = await resolvePlatformAdmin(supabase, req.user.userId, req.user.auth_channel);
    if (!admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.platformAdmin = admin;
    next();
  };
}

/**
 * Middleware: Requires active Super Admin with email session.
 */
function createRequireSuperAdmin(supabase) {
  return async function requireSuperAdmin(req, res, next) {
    if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.auth_channel !== 'email') {
      return res.status(403).json({
        error: 'admin_email_required',
        message: 'Platform administration requires sign-in via verified email OTP / magic-link.',
      });
    }

    const admin = await resolvePlatformAdmin(supabase, req.user.userId, req.user.auth_channel);
    if (!admin || admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'super_admin_required', message: 'Super-admin access required' });
    }

    req.platformAdmin = admin;
    next();
  };
}

/**
 * Lists all administrators (active and revoked) with their verified emails.
 */
async function listPlatformAdmins(supabase) {
  const { data: rows, error } = await supabase
    .from('platform_admins')
    .select('user_id, role, is_active, created_at, created_by, updated_at, revoked_at')
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const userIds = rows.map(r => r.user_id);
  const creatorIds = rows.map(r => r.created_by).filter(Boolean);
  const allIds = [...new Set([...userIds, ...creatorIds])];

  const [identities, profiles] = await Promise.all([
    supabase.from('user_email_identities').select('user_id, email, email_verified_at').in('user_id', allIds),
    supabase.from('user_profiles').select('user_id, display_name').in('user_id', allIds),
  ]);

  const emailMap = new Map((identities.data || []).map(i => [Number(i.user_id), i.email]));
  const profMap = new Map((profiles.data || []).map(p => [Number(p.user_id), p.display_name]));

  return rows.map(r => ({
    userId: Number(r.user_id),
    role: r.role,
    isActive: Boolean(r.is_active),
    email: emailMap.get(Number(r.user_id)) || null,
    displayName: profMap.get(Number(r.user_id)) || null,
    createdAt: r.created_at,
    createdBy: r.created_by ? Number(r.created_by) : null,
    creatorEmail: r.created_by ? (emailMap.get(Number(r.created_by)) || null) : null,
    updatedAt: r.updated_at,
    revokedAt: r.revoked_at,
  }));
}

// Maps a PostgreSQL / PostgREST error from the admin RPCs to a stable code. Anything unknown fails closed.
const RPC_CODES = ['super_admin_required', 'cannot_revoke_last_super_admin', 'platform_admin_change_requires_read_committed',
  'admin_not_found', 'user_not_found', 'email_not_verified', 'invalid_role', 'invalid_email', 'super_admin_already_exists'];
function rpcFailure(rpcErr, fallbackCode) {
  const text = String(rpcErr?.message || '');
  const code = RPC_CODES.find((c) => text.includes(c)) || fallbackCode;
  const err = new Error(code === fallbackCode ? `${fallbackCode}: ${text || rpcErr?.code || 'unknown error'}` : code);
  err.code = code;
  return err;
}
function requireRpc(supabase, name) {
  if (typeof supabase?.rpc !== 'function') {
    const err = new Error(`admin_atomic_rpc_required: ${name} is mandatory (no non-atomic fallback exists)`);
    err.code = 'admin_atomic_rpc_required';
    throw err;
  }
}

/**
 * Grants or updates an administrator role (073: rpc_platform_admin_grant).
 * Role change and audit row are written in ONE PostgreSQL transaction; the acting super_admin is re-checked in SQL.
 */
async function grantPlatformAdminRole(supabase, options) {
  const targetRole = options?.targetRole || options?.role;
  const targetEmail = String(options?.targetEmail || options?.email || '').trim().toLowerCase();
  const actorUserId = Number(options?.actorUserId);
  if (targetRole !== 'super_admin' && targetRole !== 'platform_admin') throw Object.assign(new Error('invalid_role'), { code: 'invalid_role' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) throw Object.assign(new Error('invalid_email'), { code: 'invalid_email' });
  if (!Number.isSafeInteger(actorUserId)) throw Object.assign(new Error('super_admin_required'), { code: 'super_admin_required' });
  requireRpc(supabase, 'rpc_platform_admin_grant');
  const { data, error } = await supabase.rpc('rpc_platform_admin_grant', {
    p_actor: actorUserId, p_email: targetEmail, p_role: targetRole, p_request_id: options?.requestId || null,
  });
  if (error) throw rpcFailure(error, 'admin_grant_failed');
  if (!data || data.user_id == null) throw Object.assign(new Error('admin_grant_unconfirmed'), { code: 'admin_grant_unconfirmed' });
  clearAdminCache(data.user_id);
  return { userId: Number(data.user_id), role: data.role, email: targetEmail, isActive: true, is_active: true };
}

/**
 * Revokes an administrator (073: rpc_platform_admin_revoke). The guard trigger keeps at least one active
 * super_admin even under concurrent revocations; the audit row is written in the same transaction.
 */
async function revokePlatformAdminRole(supabase, options) {
  const uid = Number(options?.targetUserId ?? options?.adminId ?? options?.userId);
  const actorUserId = Number(options?.actorUserId);
  if (!Number.isSafeInteger(uid)) throw Object.assign(new Error('invalid_user_id'), { code: 'invalid_user_id' });
  if (!Number.isSafeInteger(actorUserId)) throw Object.assign(new Error('super_admin_required'), { code: 'super_admin_required' });
  requireRpc(supabase, 'rpc_platform_admin_revoke');
  const { data, error } = await supabase.rpc('rpc_platform_admin_revoke', {
    p_actor: actorUserId, p_target: uid, p_request_id: options?.requestId || null,
  });
  if (error) throw rpcFailure(error, 'admin_revoke_failed');
  if (!data || data.ok !== true) throw Object.assign(new Error('admin_revoke_unconfirmed'), { code: 'admin_revoke_unconfirmed' });
  clearAdminCache(uid);
  return { ok: true, userId: uid, is_active: false };
}

/**
 * Bootstrap of the first super_admin (CLI only). fn_bootstrap_platform_super_admin (073) serializes callers,
 * verifies the email, refuses when another active super_admin exists and writes the audit row in the same
 * transaction. There is no JavaScript fallback: without the RPC, bootstrap fails closed.
 */
async function bootstrapSuperAdmin(supabase, emailOrOptions) {
  const rawEmail = typeof emailOrOptions === 'string' ? emailOrOptions : emailOrOptions?.email;
  const normalized = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('invalid_email');
  requireRpc(supabase, 'fn_bootstrap_platform_super_admin');
  const { data: idRows, error: idErr } = await supabase
    .from('user_email_identities').select('user_id, email_verified_at').eq('email', normalized).limit(1);
  if (idErr) throw idErr;
  if (!idRows || idRows.length === 0) throw new Error('email_identity_not_found');
  if (!idRows[0].email_verified_at) throw new Error('email_not_verified');
  const uid = Number(idRows[0].user_id);
  const { data, error } = await supabase.rpc('fn_bootstrap_platform_super_admin', { p_user_id: uid });
  if (error) {
    const err = rpcFailure(error, 'bootstrap_rpc_failed');
    if (err.code === 'super_admin_already_exists') err.message = 'Active super_admin already exists';
    throw err;
  }
  if (!data || !['bootstrapped', 'already_super_admin'].includes(data.status)) {
    throw Object.assign(new Error('bootstrap_unconfirmed'), { code: 'bootstrap_unconfirmed' });
  }
  clearAdminCache(uid);
  return { status: data.status, userId: uid, email: normalized, role: 'super_admin', is_active: true };
}

module.exports = {
  adminCache,
  clearAdminCache,
  resolvePlatformAdmin,
  createRequireAdmin,
  createRequireSuperAdmin,
  listPlatformAdmins,
  grantPlatformAdminRole,
  revokePlatformAdminRole,
  bootstrapSuperAdmin,
};
