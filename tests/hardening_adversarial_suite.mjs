import pg from 'pg';
import jwt from 'jsonwebtoken';
import http from 'http';
import express from 'express';
import {
  resolvePlatformAdmin,
  createRequireAdmin,
  createRequireSuperAdmin,
  listPlatformAdmins,
  grantPlatformAdminRole,
  revokePlatformAdminRole,
  bootstrapSuperAdmin,
} from '../server/lib/platformAdmin.js';

const { Client } = pg;
const PG_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/cfo_hardening_test';
const JWT_SECRET = 'audit-secret-key-123456789012345678901234567890';

// Adapter to wrap real pg Client for Supabase from() queries
function createPgSupabase(pgClient) {
  return {
    async rpc(fn, args) {
      if (fn === 'fn_bootstrap_platform_super_admin') {
        try {
          const res = await pgClient.query('SELECT public.fn_bootstrap_platform_super_admin($1) AS res', [args.p_user_id]);
          return { data: res.rows[0].res, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      }
      throw new Error(`Unsupported rpc ${fn}`);
    },
    from(tableName) {
      let selectCols = '*';
      let whereClauses = [];
      let whereValues = [];
      let limitNum = null;

      const builder = {
        select(cols = '*') {
          selectCols = cols;
          return builder;
        },
        eq(col, val) {
          whereValues.push(val);
          whereClauses.push(`"${col}" = $${whereValues.length}`);
          return builder;
        },
        neq(col, val) {
          whereValues.push(val);
          whereClauses.push(`"${col}" <> $${whereValues.length}`);
          return builder;
        },
        is(col, val) {
          if (val === null) {
            whereClauses.push(`"${col}" IS NULL`);
          } else {
            whereValues.push(val);
            whereClauses.push(`"${col}" IS NOT DISTINCT FROM $${whereValues.length}`);
          }
          return builder;
        },
        not(col, op, val) {
          if (op === 'is' && val === null) {
            whereClauses.push(`"${col}" IS NOT NULL`);
          } else {
            whereValues.push(val);
            whereClauses.push(`NOT ("${col}" ${op} $${whereValues.length})`);
          }
          return builder;
        },
        limit(num) {
          limitNum = num;
          return builder;
        },
        async then(resolve) {
          const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
          const lim = limitNum !== null ? `LIMIT ${limitNum}` : '';
          const sql = `SELECT ${selectCols} FROM public."${tableName}" ${where} ${lim}`;
          try {
            const res = await pgClient.query(sql, whereValues);
            resolve({ data: res.rows, error: null });
          } catch (e) {
            resolve({ data: null, error: e });
          }
        },
        async upsert(payload, { onConflict = 'user_id' } = {}) {
          const keys = Object.keys(payload);
          const cols = keys.map(k => `"${k}"`).join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const values = Object.values(payload);
          const updates = keys
            .filter(k => k !== onConflict)
            .map(k => `"${k}" = EXCLUDED."${k}"`)
            .join(', ');
          const sql = `
            INSERT INTO public."${tableName}" (${cols})
            VALUES (${placeholders})
            ON CONFLICT ("${onConflict}") DO UPDATE SET ${updates}
            RETURNING *
          `;
          try {
            const res = await pgClient.query(sql, values);
            return {
              data: res.rows[0],
              error: null,
              select() {
                return {
                  single: async () => ({ data: res.rows[0], error: null })
                };
              }
            };
          } catch (e) {
            return { data: null, error: e };
          }
        },
        update(payload) {
          const updateBuilder = {
            eq(col, val) {
              builder.eq(col, val);
              return updateBuilder;
            },
            async then(resolve) {
              const keys = Object.keys(payload);
              const setValues = keys.map(k => payload[k]);
              const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
              const offset = keys.length;
              const where = whereClauses.length
                ? `WHERE ${whereClauses.map(c => c.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`)).join(' AND ')}`
                : '';
              const allValues = [...setValues, ...whereValues];
              const sql = `UPDATE public."${tableName}" SET ${setClauses} ${where} RETURNING *`;
              try {
                const res = await pgClient.query(sql, allValues);
                resolve({ data: res.rows, error: null });
              } catch (e) {
                resolve({ data: null, error: e });
              }
            }
          };
          return updateBuilder;
        }
      };
      return builder;
    }
  };
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('   CFO AI — P1 ADVERSARIAL SECURITY & REGRESSION AUDIT SUITE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const mainPg = new Client({ connectionString: PG_URL });
  await mainPg.connect();
  console.log('Connected to target DB: cfo_hardening_test\n');

  let passCount = 0;
  let failCount = 0;
  function report(name, ok, detail = '') {
    if (ok) {
      console.log(`  [PASS] ${name}${detail ? ` (${detail})` : ''}`);
      passCount++;
    } else {
      console.error(`  [FAIL] ${name} ${detail}`);
      failCount++;
    }
  }

  // Baseline seeding
  await mainPg.query('TRUNCATE TABLE public.platform_admins');
  await mainPg.query('DELETE FROM public.user_email_identities WHERE user_id IN (-101, -102, -103, -104)');
  await mainPg.query('DELETE FROM public.users WHERE id IN (-101, -102, -103, -104)');

  await mainPg.query(`
    INSERT INTO public.users (id, first_name) VALUES
      (-101, 'Owner Verified'),
      (-102, 'Staff Candidate'),
      (-103, 'Unverified User'),
      (-104, 'Attacker User');

    INSERT INTO public.user_email_identities (user_id, email, email_verified_at) VALUES
      (-101, 'owner@helmfinance.com', now()),
      (-102, 'staff@helmfinance.com', now()),
      (-103, 'unverified@helmfinance.com', NULL),
      (-104, 'attacker@helmfinance.com', now());
  `);

  console.log('--- 1. CONCURRENT BOOTSTRAP: 25 REPETITIONS ON INDEPENDENT CONNECTIONS ---');
  let raceWinsUser1 = 0;
  let raceWinsUser2 = 0;
  let raceCleanSerialization = true;

  for (let round = 1; round <= 25; round++) {
    // Clean table before each race
    await mainPg.query('TRUNCATE TABLE public.platform_admins');

    // Create 2 independent PG connections representing 2 distinct Node.js server processes
    const client1 = new Client({ connectionString: PG_URL });
    const client2 = new Client({ connectionString: PG_URL });
    await client1.connect();
    await client2.connect();

    const sub1 = createPgSupabase(client1);
    const sub2 = createPgSupabase(client2);

    // Fire simultaneous bootstrap requests for 2 different verified users
    const [p1, p2] = await Promise.allSettled([
      bootstrapSuperAdmin(sub1, 'owner@helmfinance.com'),
      bootstrapSuperAdmin(sub2, 'staff@helmfinance.com'),
    ]);

    await client1.end();
    await client2.end();

    const countRes = await mainPg.query(
      "SELECT count(*) as count, max(user_id) as winner_id FROM public.platform_admins WHERE role = 'super_admin' AND is_active = true"
    );
    const activeCount = Number(countRes.rows[0].count);
    const winnerId = Number(countRes.rows[0].winner_id);

    const p1Fulfilled = p1.status === 'fulfilled';
    const p2Fulfilled = p2.status === 'fulfilled';

    // Must be exactly one winner and one rejection
    const exactlyOneWinner = activeCount === 1 && ((p1Fulfilled && !p2Fulfilled) || (!p1Fulfilled && p2Fulfilled));
    if (!exactlyOneWinner) {
      raceCleanSerialization = false;
      console.error(`  Round ${round} FAILED: activeCount=${activeCount}, p1=${p1.status}, p2=${p2.status}`);
      break;
    }

    if (winnerId === -101) raceWinsUser1++;
    if (winnerId === -102) raceWinsUser2++;
  }

  report(
    '1.1 25 concurrent bootstrap races on independent connections',
    raceCleanSerialization,
    `25/25 serialized cleanly. Exactly 1 super_admin per race. Wins: user_101=${raceWinsUser1}, user_102=${raceWinsUser2}`
  );

  console.log('\n--- 2. CONCURRENT BOOTSTRAP: SAME EMAIL IDEMPOTENCY ---');
  {
    await mainPg.query('TRUNCATE TABLE public.platform_admins');
    const c1 = new Client({ connectionString: PG_URL });
    const c2 = new Client({ connectionString: PG_URL });
    await c1.connect();
    await c2.connect();
    const s1 = createPgSupabase(c1);
    const s2 = createPgSupabase(c2);

    const [r1, r2] = await Promise.allSettled([
      bootstrapSuperAdmin(s1, 'owner@helmfinance.com'),
      bootstrapSuperAdmin(s2, 'owner@helmfinance.com'),
    ]);

    await c1.end();
    await c2.end();

    const countRes = await mainPg.query("SELECT count(*) as count FROM public.platform_admins WHERE role = 'super_admin' AND is_active = true");
    const sameEmailOk = r1.status === 'fulfilled' && r2.status === 'fulfilled' && Number(countRes.rows[0].count) === 1;
    report('2.1 Concurrent bootstrap with same email returns idempotent success without duplicates', sameEmailOk);
  }

  console.log('\n--- 3. BOOTSTRAP GUARDS: UNVERIFIED EMAIL & POST-BOOTSTRAP TAKEOVER ---');
  {
    // Bootstrap unverified email must be rejected
    const sub = createPgSupabase(mainPg);
    let unverifiedBlocked = false;
    try {
      await bootstrapSuperAdmin(sub, 'unverified@helmfinance.com');
    } catch (e) {
      unverifiedBlocked = e.message.includes('email_not_verified') || e.code === 'email_not_verified';
    }
    report('3.1 Bootstrap with unverified email identity is rejected', unverifiedBlocked);

    // Bootstrap of another email after super_admin exists must be rejected
    let takeoverBlocked = false;
    try {
      await bootstrapSuperAdmin(sub, 'attacker@helmfinance.com');
    } catch (e) {
      takeoverBlocked = e.message.includes('already exists') || e.code === 'super_admin_already_exists';
    }
    report('3.2 Subsequent bootstrap of different email rejected (takeover prevented)', takeoverBlocked);
  }

  console.log('\n--- 4. MULTI-PROCESS & REAL-TIME CACHE ELIMINATION (SEC-P1-01) ---');
  {
    // Ensure -101 is super_admin and -102 is platform_admin
    await mainPg.query('TRUNCATE TABLE public.platform_admins');
    await mainPg.query(`
      INSERT INTO public.platform_admins (user_id, role, is_active, created_by)
      VALUES (-101, 'super_admin', true, -101), (-102, 'platform_admin', true, -101);
    `);

    // Process 1: Server instance handling incoming HTTP traffic
    const proc1Db = createPgSupabase(mainPg);

    // Step 4.1: Process 1 resolves -102 -> success
    const check1 = await resolvePlatformAdmin(proc1Db, -102, 'email');
    report('4.1 Process 1 resolves active admin', check1?.role === 'platform_admin');

    // Step 4.2: Independent Process 2 revokes role via direct PostgreSQL UPDATE (or separate cluster node)
    const proc2Client = new Client({ connectionString: PG_URL });
    await proc2Client.connect();
    await proc2Client.query("UPDATE public.platform_admins SET is_active = false, revoked_at = now() WHERE user_id = -102");
    await proc2Client.end();

    // Step 4.3: Process 1 immediately makes NEXT administrative check (without clearing any local cache)
    const check2 = await resolvePlatformAdmin(proc1Db, -102, 'email');
    report('4.2 Process 1 immediately rejects revoked admin on NEXT query (0ms delay, no stale cache)', check2 === null);

    // Step 4.4: Re-activate -102 directly in DB
    const proc3Client = new Client({ connectionString: PG_URL });
    await proc3Client.connect();
    await proc3Client.query("UPDATE public.platform_admins SET is_active = true, revoked_at = NULL WHERE user_id = -102");
    await proc3Client.end();

    const check3 = await resolvePlatformAdmin(proc1Db, -102, 'email');
    report('4.3 Process 1 immediately grants access upon re-activation (real-time consistency)', check3?.role === 'platform_admin');
  }

  console.log('\n--- 5. POSTGRESQL OUTAGE / DISCONNECT (FAIL-CLOSED) ---');
  {
    // Simulate DB connection drop / outage / network timeout
    const outageSub = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      limit() {
                        return Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432 - Connection terminated unexpectedly'));
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    };

    const outageResult = await resolvePlatformAdmin(outageSub, -101, 'email');
    report('5.1 DB outage / connection failure fails closed (returns null, no bypass)', outageResult === null);
  }

  console.log('\n--- 6. HTTP MIDDLEWARE INTEGRATION & CHANNEL SECURITY ---');
  {
    const app = express();
    app.use(express.json());

    const sub = createPgSupabase(mainPg);
    const requireAdmin = createRequireAdmin(sub);
    const requireSuperAdmin = createRequireSuperAdmin(sub);

    function testAuth(req, res, next) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
      try {
        const token = authHeader.replace('Bearer ', '');
        req.user = jwt.verify(token, JWT_SECRET);
        next();
      } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
      }
    }

    app.get('/test/admin', testAuth, requireAdmin, (req, res) => res.json({ ok: true, admin: req.platformAdmin.role }));
    app.get('/test/super', testAuth, requireSuperAdmin, (req, res) => res.json({ ok: true, admin: req.platformAdmin.role }));
    app.get('/api/admin/status', testAuth, async (req, res) => {
      const admin = await resolvePlatformAdmin(sub, req.user?.userId, req.user?.auth_channel);
      res.json({
        is_admin: Boolean(admin),
        role: admin ? admin.role : null,
        auth_channel: req.user?.auth_channel || 'telegram',
      });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    async function req(path, token) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${baseUrl}${path}`, { headers });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // Restore -101 as super_admin, -102 as platform_admin
    await mainPg.query('TRUNCATE TABLE public.platform_admins');
    await mainPg.query(`
      INSERT INTO public.platform_admins (user_id, role, is_active, created_by)
      VALUES (-101, 'super_admin', true, -101), (-102, 'platform_admin', true, -101);
    `);

    // 6.1 Telegram JWT -> 403 admin_email_required
    const tgToken = jwt.sign({ userId: -101, auth_channel: 'telegram' }, JWT_SECRET);
    const rTg = await req('/test/admin', tgToken);
    report('6.1 Telegram JWT rejected with 403 admin_email_required', rTg.status === 403 && rTg.data.error === 'admin_email_required');

    // 6.2 Old JWT without auth_channel -> 403 admin_email_required
    const legacyToken = jwt.sign({ userId: -101 }, JWT_SECRET);
    const rLegacy = await req('/test/admin', legacyToken);
    report('6.2 Old JWT without auth_channel rejected with 403 admin_email_required', rLegacy.status === 403 && rLegacy.data.error === 'admin_email_required');

    // 6.3 Regular business owner -> 403 Admin access required
    const bizToken = jwt.sign({ userId: 55555, email: 'bizowner@example.com', auth_channel: 'email' }, JWT_SECRET);
    const rBiz = await req('/test/admin', bizToken);
    report('6.3 Regular Business Owner rejected with 403 Admin access required', rBiz.status === 403 && rBiz.data.error === 'Admin access required');

    // 6.4 /api/admin/status live reflection of status
    const staffToken = jwt.sign({ userId: -102, email: 'staff@helmfinance.com', auth_channel: 'email' }, JWT_SECRET);
    const rStatusActive = await req('/api/admin/status', staffToken);
    report('6.4 /api/admin/status returns is_admin: true for active platform_admin', rStatusActive.data.is_admin === true && rStatusActive.data.role === 'platform_admin');

    // Deactivate -102 directly in DB
    await mainPg.query("UPDATE public.platform_admins SET is_active = false, revoked_at = now() WHERE user_id = -102");
    // Next request to /api/admin/status immediately returns is_admin: false
    const rStatusRevoked = await req('/api/admin/status', staffToken);
    report('6.5 /api/admin/status immediately returns is_admin: false on revoked admin (zero cache delay)', rStatusRevoked.data.is_admin === false && rStatusRevoked.data.role === null);

    server.close();
  }

  console.log('\n--- 7. DATABASE TRIGGER: DELETE/DEMOTE LAST SUPER_ADMIN GUARD ---');
  {
    // Re-seed: only -101 as super_admin
    await mainPg.query('TRUNCATE TABLE public.platform_admins');
    await mainPg.query(`
      INSERT INTO public.platform_admins (user_id, role, is_active, created_by)
      VALUES (-101, 'super_admin', true, -101);
    `);

    // 7.1 Direct SQL DELETE
    let deleteBlocked = false;
    try {
      await mainPg.query('DELETE FROM public.platform_admins WHERE user_id = -101');
    } catch (e) {
      deleteBlocked = e.message.includes('cannot_revoke_last_super_admin');
    }
    report('7.1 Deletion of last super_admin blocked by PostgreSQL trigger', deleteBlocked);

    // 7.2 Direct SQL UPDATE is_active = false
    let deactivateBlocked = false;
    try {
      await mainPg.query('UPDATE public.platform_admins SET is_active = false WHERE user_id = -101');
    } catch (e) {
      deactivateBlocked = e.message.includes('cannot_revoke_last_super_admin');
    }
    report('7.2 Deactivation of last super_admin blocked by PostgreSQL trigger', deactivateBlocked);

    // 7.3 Direct SQL demote to platform_admin
    let demoteBlocked = false;
    try {
      await mainPg.query("UPDATE public.platform_admins SET role = 'platform_admin' WHERE user_id = -101");
    } catch (e) {
      demoteBlocked = e.message.includes('cannot_revoke_last_super_admin');
    }
    report('7.3 Demotion of last super_admin blocked by PostgreSQL trigger', demoteBlocked);
  }

  await mainPg.end();

  console.log(`\n═══════════════════════════════════════════════════════════════════════`);
  console.log(`   AUDIT FINISHED: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`═══════════════════════════════════════════════════════════════════════\n`);

  if (failCount > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
