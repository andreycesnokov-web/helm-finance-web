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

/**
 * Grants or updates an administrator role. Can only be invoked by an active super_admin.
 */
async function grantPlatformAdminRole(supabase, options) {
  const targetRole = options?.targetRole || options?.role;
  const targetEmail = options?.targetEmail || options?.email;
  const actorUserId = options?.actorUserId;
  const recordAudit = options?.recordAudit;

  if (targetRole !== 'super_admin' && targetRole !== 'platform_admin') {
    throw new Error('invalid_role');
  }

  const normalized = String(targetEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('invalid_email');
  }

  // Target email must exist and be verified
  const { data: idRows, error: idErr } = await supabase
    .from('user_email_identities')
    .select('user_id, email_verified_at')
    .eq('email', normalized)
    .limit(1);

  if (idErr) throw idErr;
  if (!idRows || idRows.length === 0) {
    throw new Error('user_not_found');
  }

  const target = idRows[0];
  if (!target.email_verified_at) {
    throw new Error('email_not_verified: user must have a verified email identity');
  }

  const targetUserId = Number(target.user_id);

  // Read existing row for audit before state
  const { data: existingRows } = await supabase
    .from('platform_admins')
    .select('*')
    .eq('user_id', targetUserId)
    .limit(1);

  const before = existingRows?.[0] || null;

  const nowISO = new Date().toISOString();
  const upsertData = {
    user_id: targetUserId,
    role: targetRole,
    is_active: true,
    created_by: actorUserId,
    updated_at: nowISO,
    revoked_at: null,
  };

  const { error: upsertErr } = await supabase
    .from('platform_admins')
    .upsert(upsertData, { onConflict: 'user_id' });

  if (upsertErr) throw upsertErr;

  clearAdminCache(targetUserId);

  const auditRow = {
    business_id: null,
    actor_user_id: actorUserId || null,
    actor_role: 'super_admin',
    channel: 'web',
    entity_type: 'platform_admin',
    entity_id: String(targetUserId),
    action: before ? 'role_updated' : 'role_granted',
    before_json: before,
    after_json: upsertData,
    request_id: options?.requestId || null,
  };

  if (typeof recordAudit === 'function') {
    await recordAudit(auditRow);
  } else {
    try {
      await supabase.from('audit_events').insert(auditRow);
    } catch { /* best effort */ }
  }

  return {
    userId: targetUserId,
    role: targetRole,
    email: normalized,
    isActive: true,
    is_active: true,
  };
}

/**
 * Revokes an administrator's access. Enforces that the last active super_admin cannot be revoked.
 */
async function revokePlatformAdminRole(supabase, options) {
  const uid = Number(options?.targetUserId ?? options?.adminId ?? options?.userId);
  if (!Number.isSafeInteger(uid)) throw new Error('invalid_user_id');
  const actorUserId = options?.actorUserId;
  const recordAudit = options?.recordAudit;

  const { data: targetRows, error: targetErr } = await supabase
    .from('platform_admins')
    .select('*')
    .eq('user_id', uid)
    .limit(1);

  if (targetErr) throw targetErr;
  const target = targetRows?.[0];
  if (!target || !target.is_active) {
    throw new Error('admin_not_found');
  }

  // Guard: if revoking a super_admin, verify at least one other active super_admin exists
  if (target.role === 'super_admin') {
    const { data: supers, error: sErr } = await supabase
      .from('platform_admins')
      .select('user_id')
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .neq('user_id', uid);

    if (sErr) throw sErr;
    if (!supers || supers.length === 0) {
      const err = new Error('Cannot revoke the last active super_admin');
      err.code = 'cannot_revoke_last_super_admin';
      throw err;
    }
  }

  const nowISO = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('platform_admins')
    .update({
      is_active: false,
      revoked_at: nowISO,
      updated_at: nowISO,
    })
    .eq('user_id', uid);

  if (updateErr) throw updateErr;

  clearAdminCache(uid);

  const auditRow = {
    business_id: null,
    actor_user_id: actorUserId || null,
    actor_role: 'super_admin',
    channel: 'web',
    entity_type: 'platform_admin',
    entity_id: String(uid),
    action: 'role_revoked',
    before_json: target,
    after_json: { ...target, is_active: false, revoked_at: nowISO },
    request_id: options?.requestId || null,
  };

  if (typeof recordAudit === 'function') {
    await recordAudit(auditRow);
  } else {
    try {
      await supabase.from('audit_events').insert(auditRow);
    } catch { /* best effort */ }
  }

  return { ok: true, userId: uid, is_active: false };
}

/**
 * Safe, idempotent bootstrap of the primary super_admin.
 * Fails closed if the email is not verified or if an active super_admin already exists for another user.
 */
async function bootstrapSuperAdmin(supabase, emailOrOptions, maybeOptions = {}) {
  const rawEmail = typeof emailOrOptions === 'string' ? emailOrOptions : emailOrOptions?.email;
  const recordAudit = typeof emailOrOptions === 'object' ? (emailOrOptions?.recordAudit || maybeOptions.recordAudit) : maybeOptions.recordAudit;

  const normalized = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('invalid_email');
  }

  const { data: idRows, error: idErr } = await supabase
    .from('user_email_identities')
    .select('user_id, email_verified_at')
    .eq('email', normalized)
    .limit(1);

  if (idErr) throw idErr;
  if (!idRows || idRows.length === 0) {
    throw new Error('email_identity_not_found');
  }

  const identity = idRows[0];
  if (!identity.email_verified_at) {
    throw new Error('email_not_verified');
  }

  const uid = Number(identity.user_id);

  // Use PostgreSQL stored procedure with pg_advisory_xact_lock for strict cross-process atomicity
  if (typeof supabase.rpc === 'function') {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('fn_bootstrap_platform_super_admin', {
      p_user_id: uid,
    });

    if (rpcErr) {
      if (rpcErr.message?.includes('super_admin_already_exists') || rpcErr.code === 'P0003') {
        const err = new Error('Active super_admin already exists');
        err.code = 'super_admin_already_exists';
        throw err;
      }
      if (rpcErr.message?.includes('email_not_verified') || rpcErr.code === 'P0002') {
        throw new Error('email_not_verified');
      }
      // If function is not defined (e.g. mock DB in unit tests without RPC), fall back below
      if (rpcErr.code !== 'PGRST202' && rpcErr.code !== '42883') {
        throw new Error(`Bootstrap failed: ${rpcErr.message}`);
      }
    } else if (rpcRes) {
      const auditRow = {
        business_id: null,
        actor_user_id: uid,
        actor_role: 'system_bootstrap',
        channel: 'cli',
        entity_type: 'platform_admin',
        entity_id: String(uid),
        action: 'role_bootstrap',
        after_json: rpcRes,
      };

      if (typeof recordAudit === 'function') {
        await recordAudit(auditRow);
      } else {
        try {
          await supabase.from('audit_events').insert(auditRow);
        } catch { /* best effort */ }
      }

      return {
        status: rpcRes.status,
        userId: uid,
        email: normalized,
        role: 'super_admin',
        is_active: true,
      };
    }
  }

  // Fallback (for unit tests / mock supabase implementations without rpc)
  const { data: activeSupers, error: asErr } = await supabase
    .from('platform_admins')
    .select('user_id, role, is_active')
    .eq('role', 'super_admin')
    .eq('is_active', true);

  if (asErr) throw asErr;

  if (activeSupers && activeSupers.length > 0) {
    const existing = activeSupers.find(s => Number(s.user_id) === uid);
    if (existing) {
      return { status: 'already_super_admin', userId: uid, email: normalized, role: 'super_admin', is_active: true };
    }
    // Another super_admin already exists!
    const err = new Error('Active super_admin already exists');
    err.code = 'super_admin_already_exists';
    err.existingCount = activeSupers.length;
    throw err;
  }

  const nowISO = new Date().toISOString();
  const upsertData = {
    user_id: uid,
    role: 'super_admin',
    is_active: true,
    created_by: uid,
    updated_at: nowISO,
    revoked_at: null,
  };

  const { error: insErr } = await supabase
    .from('platform_admins')
    .upsert(upsertData, { onConflict: 'user_id' });

  if (insErr) throw insErr;

  clearAdminCache(uid);

  const auditRow = {
    business_id: null,
    actor_user_id: uid,
    actor_role: 'system_bootstrap',
    channel: 'cli',
    entity_type: 'platform_admin',
    entity_id: String(uid),
    action: 'role_bootstrap',
    after_json: upsertData,
  };

  if (typeof recordAudit === 'function') {
    await recordAudit(auditRow);
  } else {
    try {
      await supabase.from('audit_events').insert(auditRow);
    } catch { /* best effort */ }
  }

  return { status: 'bootstrapped', userId: uid, email: normalized, role: 'super_admin', is_active: true };
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
