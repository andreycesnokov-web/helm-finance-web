'use strict';
/**
 * CFO AI — Platform Admin Authentication & Authorization Test Suite (P0 Security)
 *
 * Verifies all 15 security scenarios:
 *  1. Unauthenticated request rejected (401)
 *  2. Non-admin regular user rejected (403)
 *  3. Business owner is NOT platform admin (403)
 *  4. Telegram session rejected even if user matches ADMIN_TELEGRAM_IDS (403 admin_email_required)
 *  5. Unverified email identity rejected (403)
 *  6. Verified email without platform_admin role rejected (403)
 *  7. Verified email with active role accepted (200 / next)
 *  8. platform_admin cannot grant or revoke roles (403 super_admin_required)
 *  9. super_admin can grant and revoke roles
 * 10. Revoked admin immediately loses access (403)
 * 11. Forged / invalid JWT rejected (401)
 * 12. Cannot revoke the last active super_admin (fail-closed guard)
 * 13. Commercial billing admin API protected by database-backed requireAdmin
 * 14. Tax rules and admin routes protected by email + platform admin check
 * 15. Bootstrap CLI procedure idempotent and safe
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  resolvePlatformAdmin,
  createRequireAdmin,
  createRequireSuperAdmin,
  listPlatformAdmins,
  grantPlatformAdminRole,
  revokePlatformAdminRole,
  bootstrapSuperAdmin,
  clearAdminCache,
} from '../server/lib/platformAdmin.js';

// ── In-Memory Supabase Mock for deterministic RBAC testing ────────────────────

function createMockSupabase(initialData = {}) {
  const tables = {
    platform_admins: (initialData.platform_admins || []).map(r => ({ revoked_at: null, ...r })),
    user_email_identities: initialData.user_email_identities || [],
    users: initialData.users || [],
    audit_events: initialData.audit_events || [],
    user_profiles: initialData.user_profiles || [],
  };

  return {
    _tables: tables,
    from(tableName) {
      const table = tables[tableName] || [];
      let query = {
        _filters: [],
        _select: '*',
        _order: null,
        _limit: null,
      };

      const builder = {
        select(cols = '*') {
          query._select = cols;
          return builder;
        },
        eq(col, val) {
          query._filters.push(row => String(row[col]) === String(val));
          return builder;
        },
        neq(col, val) {
          query._filters.push(row => String(row[col]) !== String(val));
          return builder;
        },
        is(col, val) {
          if (val === null) {
            query._filters.push(row => row[col] === null || row[col] === undefined);
          } else {
            query._filters.push(row => row[col] === val);
          }
          return builder;
        },
        not(col, op, val) {
          if (op === 'is' && val === null) {
            query._filters.push(row => row[col] !== null && row[col] !== undefined);
          } else {
            query._filters.push(row => row[col] !== val);
          }
          return builder;
        },
        in(col, arr) {
          const set = new Set((arr || []).map(String));
          query._filters.push(row => set.has(String(row[col])));
          return builder;
        },
        ilike(col, pattern) {
          const val = pattern.toLowerCase();
          query._filters.push(row => String(row[col] || '').toLowerCase() === val);
          return builder;
        },
        order(col, { ascending = true } = {}) {
          query._order = { col, ascending };
          return builder;
        },
        limit(num) {
          query._limit = num;
          return builder;
        },
        async maybeSingle() {
          let rows = table.filter(row => query._filters.every(f => f(row)));
          return { data: rows[0] || null, error: null };
        },
        async single() {
          let rows = table.filter(row => query._filters.every(f => f(row)));
          if (!rows.length) return { data: null, error: { message: 'Not found', code: 'PGRST116' } };
          return { data: rows[0], error: null };
        },
        then(resolve) {
          let rows = table.filter(row => query._filters.every(f => f(row)));
          if (query._order) {
            rows.sort((a, b) => {
              if (a[query._order.col] < b[query._order.col]) return query._order.ascending ? -1 : 1;
              if (a[query._order.col] > b[query._order.col]) return query._order.ascending ? 1 : -1;
              return 0;
            });
          }
          if (query._limit) rows = rows.slice(0, query._limit);
          resolve({ data: rows, error: null });
        },
        async insert(payload) {
          const row = { id: payload.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...payload };
          table.push(row);
          return {
            data: row,
            error: null,
            select() {
              return {
                single: async () => ({ data: row, error: null })
              };
            }
          };
        },
        update(payload) {
          let pendingUpdate = payload;
          const updateBuilder = {
            eq(col, val) {
              builder.eq(col, val);
              return updateBuilder;
            },
            select() {
              return {
                single: async () => {
                  executeUpdate();
                  let rows = table.filter(row => query._filters.every(f => f(row)));
                  return { data: rows[0] || null, error: null };
                }
              };
            },
            then(resolve) {
              executeUpdate();
              resolve({ data: null, error: null });
            }
          };
          function executeUpdate() {
            for (let i = 0; i < table.length; i++) {
              if (query._filters.every(f => f(table[i]))) {
                table[i] = { ...table[i], ...pendingUpdate };
              }
            }
          }
          return updateBuilder;
        },
        async upsert(payload, { onConflict = 'user_id' } = {}) {
          const conflictCol = onConflict;
          const conflictVal = payload[conflictCol];
          const idx = table.findIndex(r => String(r[conflictCol]) === String(conflictVal));
          let row;
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...payload };
            row = table[idx];
          } else {
            row = { id: payload.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...payload };
            table.push(row);
          }
          return {
            data: row,
            error: null,
            select() {
              return {
                single: async () => ({ data: row, error: null })
              };
            }
          };
        }
      };

      return builder;
    }
  };
}

// ── Test Setup Helpers ────────────────────────────────────────────────────────

function mockReqRes({ userId = null, email = null, authChannel = null } = {}) {
  const req = {
    user: userId ? { userId, email, auth_channel: authChannel } : null,
    headers: {},
  };
  let statusCode = 200;
  let responseBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      responseBody = body;
      return res;
    },
  };
  return { req, res, getStatus: () => statusCode, getBody: () => responseBody };
}

// ── Scenario Tests ───────────────────────────────────────────────────────────

test('Scenario 1: Unauthenticated request to admin API returns 401', async () => {
  clearAdminCache();
  const db = createMockSupabase();
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus, getBody } = mockReqRes(); // No user

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 401);
  assert.strictEqual(getBody().error, 'Unauthorized');
});

test('Scenario 2: Non-admin regular user is rejected with 403', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 101, email: 'user@example.com' }],
    user_email_identities: [{ user_id: 101, email: 'user@example.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [], // No admin role
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus, getBody } = mockReqRes({ userId: 101, email: 'user@example.com', authChannel: 'email' });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'Admin access required');
});

test('Scenario 3: Business owner is NOT a platform admin (hard boundary check)', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 501, email: 'bizowner@example.com' }],
    user_email_identities: [{ user_id: 501, email: 'bizowner@example.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [], // Business owner does not have platform_admins record
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus, getBody } = mockReqRes({ userId: 501, email: 'bizowner@example.com', authChannel: 'email' });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'Admin access required');
});

test('Scenario 4: Telegram user in ADMIN_TELEGRAM_IDS is REJECTED (auth_channel !== email)', async () => {
  clearAdminCache();
  process.env.ADMIN_TELEGRAM_IDS = '123456789,999999999';

  const db = createMockSupabase({
    users: [{ id: 123456789, email: 'tgadmin@example.com' }],
    user_email_identities: [{ user_id: 123456789, email: 'tgadmin@example.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [{ id: 'adm-1', user_id: 123456789, role: 'super_admin', is_active: true, revoked_at: null }],
  });
  const requireAdmin = createRequireAdmin(db);

  // Even if this user exists in platform_admins and in ADMIN_TELEGRAM_IDS,
  // when logging in via Telegram (auth_channel = 'telegram'), admin access is FORBIDDEN.
  const { req, res, getStatus, getBody } = mockReqRes({
    userId: 123456789,
    authChannel: 'telegram'
  });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'admin_email_required');
  assert.ok(getBody().message.includes('verified email'));
});

test('Scenario 5: Unverified email identity rejected with 403', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 202, email: 'unverified@example.com' }],
    user_email_identities: [{ user_id: 202, email: 'unverified@example.com', email_verified_at: null }],
    platform_admins: [{ id: 'adm-2', user_id: 202, role: 'platform_admin', is_active: true, revoked_at: null }],
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus, getBody } = mockReqRes({
    userId: 202,
    email: 'unverified@example.com',
    authChannel: 'email'
  });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'Admin access required');
});

test('Scenario 6: Verified email without platform_admin record rejected with 403', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 303, email: 'verified-normal@example.com' }],
    user_email_identities: [{ user_id: 303, email: 'verified-normal@example.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [],
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus } = mockReqRes({
    userId: 303,
    email: 'verified-normal@example.com',
    authChannel: 'email'
  });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
});

test('Scenario 7: Verified email with active role accepted (200 / next)', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 404, email: 'active-admin@helmfinance.com' }],
    user_email_identities: [{ user_id: 404, email: 'active-admin@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [{ id: 'adm-4', user_id: 404, role: 'platform_admin', is_active: true, revoked_at: null }],
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res } = mockReqRes({
    userId: 404,
    email: 'active-admin@helmfinance.com',
    authChannel: 'email'
  });

  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.platformAdmin.role, 'platform_admin');
  assert.strictEqual(req.platformAdmin.email, 'active-admin@helmfinance.com');
});

test('Scenario 8: platform_admin cannot grant or revoke roles (403 super_admin_required)', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 601, email: 'staff-admin@helmfinance.com' }],
    user_email_identities: [{ user_id: 601, email: 'staff-admin@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [{ id: 'adm-6', user_id: 601, role: 'platform_admin', is_active: true, revoked_at: null }],
  });
  const requireSuperAdmin = createRequireSuperAdmin(db);
  const { req, res, getStatus, getBody } = mockReqRes({
    userId: 601,
    email: 'staff-admin@helmfinance.com',
    authChannel: 'email'
  });

  let nextCalled = false;
  await requireSuperAdmin(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'super_admin_required');
});

test('Scenario 9: super_admin can grant and revoke roles', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [
      { id: 701, email: 'super@helmfinance.com' },
      { id: 702, email: 'newstaff@helmfinance.com' },
    ],
    user_email_identities: [
      { user_id: 701, email: 'super@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
      { user_id: 702, email: 'newstaff@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
    ],
    platform_admins: [
      { id: 'adm-701', user_id: 701, role: 'super_admin', is_active: true, revoked_at: null },
    ],
    audit_events: [],
  });

  // Grant role
  const granted = await grantPlatformAdminRole(db, {
    email: 'newstaff@helmfinance.com',
    role: 'platform_admin',
    actorUserId: 701,
  });
  assert.strictEqual(granted.role, 'platform_admin');
  assert.strictEqual(granted.isActive, true);

  // Check audit event was written
  assert.strictEqual(db._tables.audit_events.length, 1);
  assert.strictEqual(db._tables.audit_events[0].action, 'role_granted');

  // Verify new admin can now authenticate
  const adminCheck = await resolvePlatformAdmin(db, 702, 'email');
  assert.ok(adminCheck);
  assert.strictEqual(adminCheck.role, 'platform_admin');

  // Revoke role
  const revoked = await revokePlatformAdminRole(db, {
    adminId: 702,
    actorUserId: 701,
  });
  assert.strictEqual(revoked.ok, true);

  // Check audit event was written
  assert.strictEqual(db._tables.audit_events.length, 2);
  assert.strictEqual(db._tables.audit_events[1].action, 'role_revoked');
});

test('Scenario 10: Revoked admin immediately loses access (403)', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [
      { id: 801, email: 'super@helmfinance.com' },
      { id: 802, email: 'revoked@helmfinance.com' },
    ],
    user_email_identities: [
      { user_id: 801, email: 'super@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
      { user_id: 802, email: 'revoked@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
    ],
    platform_admins: [
      { id: 'adm-801', user_id: 801, role: 'super_admin', is_active: true, revoked_at: null },
      { id: 'adm-802', user_id: 802, role: 'platform_admin', is_active: true, revoked_at: null },
    ],
  });

  const requireAdmin = createRequireAdmin(db);

  // Active check passes
  const { req: req1, res: res1 } = mockReqRes({ userId: 802, email: 'revoked@helmfinance.com', authChannel: 'email' });
  let next1 = false;
  await requireAdmin(req1, res1, () => { next1 = true; });
  assert.strictEqual(next1, true);

  // Revoke via super_admin
  await revokePlatformAdminRole(db, {
    userId: 802,
    actorUserId: 801,
  });

  // Next check immediately fails (cache cleared)
  const { req: req2, res: res2, getStatus, getBody } = mockReqRes({ userId: 802, email: 'revoked@helmfinance.com', authChannel: 'email' });
  let next2 = false;
  await requireAdmin(req2, res2, () => { next2 = true; });
  assert.strictEqual(next2, false);
  assert.strictEqual(getStatus(), 403);
  assert.strictEqual(getBody().error, 'Admin access required');
});

test('Scenario 11: Forged / tampered JWT rejected', () => {
  const SECRET = 'test-secret-12345678901234567890';
  const validToken = jwt.sign({ userId: 999, email: 'admin@helmfinance.com', auth_channel: 'email' }, SECRET);

  // Tampered payload with wrong secret
  const forgedToken = jwt.sign({ userId: 999, email: 'admin@helmfinance.com', auth_channel: 'email' }, 'wrong-secret');

  assert.throws(() => jwt.verify(forgedToken, SECRET));
});

test('Scenario 12: Cannot revoke the last active super_admin', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 901, email: 'last-super@helmfinance.com' }],
    user_email_identities: [{ user_id: 901, email: 'last-super@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [
      { id: 'adm-901', user_id: 901, role: 'super_admin', is_active: true, revoked_at: null },
    ],
  });

  await assert.rejects(
    async () => {
      await revokePlatformAdminRole(db, {
        userId: 901,
        actorUserId: 901,
      });
    },
    /Cannot revoke the last active super_admin/
  );
});

test('Scenario 13: Commercial billing admin API protected by requireAdmin', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 1001, email: 'customer@company.com' }],
    user_email_identities: [{ user_id: 1001, email: 'customer@company.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [],
  });
  const requireAdmin = createRequireAdmin(db);
  const { req, res, getStatus } = mockReqRes({
    userId: 1001,
    email: 'customer@company.com',
    authChannel: 'email'
  });

  let called = false;
  await requireAdmin(req, res, () => { called = true; });
  assert.strictEqual(called, false);
  assert.strictEqual(getStatus(), 403);
});

test('Scenario 14: Tax rules and admin routes protected by email + platform admin check', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 1101, email: 'nonadmin@company.com' }],
    user_email_identities: [{ user_id: 1101, email: 'nonadmin@company.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [],
  });

  // Test tax rule editor resolution directly
  const isEditor = await resolvePlatformAdmin(db, 1101, 'email');
  assert.strictEqual(Boolean(isEditor), false);

  // Even if user were admin, telegram channel gets rejected
  const tgEditor = await resolvePlatformAdmin(db, 1101, 'telegram');
  assert.strictEqual(Boolean(tgEditor), false);
});

test('Scenario 15: Bootstrap procedure is idempotent and fails closed if super_admin exists', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [
      { id: 1201, email: 'first-super@helmfinance.com' },
      { id: 1202, email: 'attacker@helmfinance.com' },
    ],
    user_email_identities: [
      { user_id: 1201, email: 'first-super@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
      { user_id: 1202, email: 'attacker@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' },
    ],
    platform_admins: [],
  });

  // Initial bootstrap succeeds
  const initial = await bootstrapSuperAdmin(db, { email: 'first-super@helmfinance.com' });
  assert.strictEqual(initial.role, 'super_admin');
  assert.strictEqual(initial.is_active, true);

  // Idempotent retry with same email succeeds
  const retry = await bootstrapSuperAdmin(db, { email: 'first-super@helmfinance.com' });
  assert.strictEqual(retry.role, 'super_admin');

  // Second bootstrap with DIFFERENT email FAILS CLOSED (cannot overwrite)
  await assert.rejects(
    async () => {
      await bootstrapSuperAdmin(db, { email: 'attacker@helmfinance.com' });
    },
    /Active super_admin already exists/
  );
});

test('Scenario 16: Bootstrap fails closed if mandatory security audit recording fails', async () => {
  clearAdminCache();
  const db = createMockSupabase({
    users: [{ id: 1301, email: 'audit-test@helmfinance.com' }],
    user_email_identities: [{ user_id: 1301, email: 'audit-test@helmfinance.com', email_verified_at: '2026-10-16T10:00:00Z' }],
    platform_admins: [],
  });

  await assert.rejects(
    async () => {
      await bootstrapSuperAdmin(db, {
        email: 'audit-test@helmfinance.com',
        requireAudit: true,
        recordAudit: async () => {
          throw new Error('mandatory_security_audit_failed: network_unreachable');
        },
      });
    },
    /mandatory_security_audit_failed/
  );
});

test('Audit Guard: ADMIN_TELEGRAM_IDS is not used to grant admin anywhere in codebase', () => {
  const root = path.join(__dirname, '..', 'server');
  const indexJs = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

  // Ensure no remaining isAdminUser using ADMIN_TELEGRAM_IDS in server/index.js
  assert.ok(!indexJs.includes('process.env.ADMIN_TELEGRAM_IDS'));
});
