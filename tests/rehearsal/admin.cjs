'use strict';
// Phase D — Platform Super Admin bootstrap (CLI only) and Platform Admin boundaries, on the clean install.
const { execFileSync } = require('child_process');
const { assert, call, ensureUser, collector, db, state, S } = require('./lib.cjs');
const { check, save } = collector(require('./env.cjs').HOME + '/admin.json');
const { ROOT } = require('./env.cjs');
const ST0 = state(), PW = { admin: ST0.admin_password || 'Root-Admin-Pass-' + require('crypto').randomBytes(4).toString('hex'), staff: ST0.staff_password || 'Staff-Ops-Pass-' + require('crypto').randomBytes(4).toString('hex') };
const bootstrap = (email) => {
  try {
    const out = execFileSync('node', ['scripts/bootstrapPlatformAdmin.mjs', '--email=' + email], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:55450', SUPABASE_SECRET_KEY: S.service_key, DOTENV_CONFIG_PATH: 'nonexistent.env' } });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};
const ADMIN_READS = ['/admin/dashboard', '/admin/businesses', '/admin/users', '/admin/administrators', '/admin/administrators/audit', '/admin/access-audit',
  '/admin/billing/overview', '/admin/billing/catalog', '/admin/billing/companies', '/admin/billing/audit', '/admin/billing/settings', '/admin/tax-rules'];
(async () => {
  const c = await db();
  const st = state();
  state({ admin_password: PW.admin, staff_password: PW.staff });
  const fresh = Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n) === 0;
  const admin = await ensureUser('admin.root@rehearsal.test', PW.admin);
  const staff = await ensureUser('staff.ops@rehearsal.test', PW.staff);
  const alphaPw = st.alpha_password || 'Alpha-Owner-Pass-' + require('crypto').randomBytes(4).toString('hex'); state({ alpha_password: alphaPw });
  const customer = await ensureUser('owner.alpha@rehearsal.test', alphaPw);
  state({ admin_password: PW.admin, staff_password: PW.staff, admin_id: admin.id, staff_id: staff.id });

  await check('clean install starts with no administrator and no hardcoded one; no HTTP bootstrap route', async () => {
    if (!fresh) throw Error('not a fresh install (re-run): run on an empty database');
    for (const p of ['/admin/bootstrap', '/admin/administrators/bootstrap', '/platform-admin/bootstrap']) assert.ok([401, 403, 404, 409].includes((await call('POST', p, { token: admin.token, body: {} })).status), p);
    const st = await call('GET', '/admin/status', { token: admin.token }); assert.equal(st.body.is_admin, false);
    assert.equal((await call('GET', '/admin/dashboard', { token: admin.token })).status, 403);
    const src = require('fs').readFileSync(ROOT + '/server/index.js', 'utf8');
    assert.ok(!/ADMIN_(PASSWORD|EMAIL)\s*=\s*['"]/.test(src), 'hardcoded admin credential');
  });
  await check('bootstrap refuses an email with no verified app identity', async () => {
    const r = bootstrap('nobody.admin@rehearsal.test'); assert.ok(!/SUCCESS/.test(r.out), r.out);
    assert.equal(Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n), 0);
  });
  await check('CLI bootstrap makes the verified email/password account the first super_admin, audited in the same transaction', async () => {
    const r = bootstrap('admin.root@rehearsal.test'); assert.match(r.out, /SUCCESS/, r.out);
    const rows = (await c.query('SELECT user_id, role, is_active FROM platform_admins')).rows;
    assert.deepEqual(rows.map((x) => [Number(x.user_id), x.role, x.is_active]), [[admin.id, 'super_admin', true]]);
    const audit = (await c.query("SELECT action FROM audit_events WHERE entity_type ILIKE '%admin%' AND entity_id::text = $1", [String(admin.id)])).rows.map((x) => x.action);
    assert.ok(audit.length >= 1, 'no audit row'); return { audit };
  });
  await check('bootstrap is one-time: a second person is refused, a repeat for the same person changes nothing', async () => {
    const other = bootstrap('owner.alpha@rehearsal.test'); assert.ok(!/SUCCESS/.test(other.out), other.out);
    const again = bootstrap('admin.root@rehearsal.test'); assert.match(again.out, /SUCCESS \(Idempotent\)/, again.out);
    assert.equal(Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n), 1);
  });
  await check('admin signs in with email + password and reaches every Platform Admin read surface', async () => {
    const st = await call('GET', '/admin/status', { token: admin.token }); assert.equal(st.body.is_admin, true); assert.equal(st.body.role, 'super_admin');
    const out = {};
    for (const p of ADMIN_READS) { const r = await call('GET', p, { token: admin.token }); out[p] = r.status; assert.equal(r.status, 200, p + ' ' + JSON.stringify(r.body).slice(0, 160)); }
    return out;
  });
  await check('an ordinary customer is refused on every Platform Admin route (403), reads and writes', async () => {
    for (const p of ADMIN_READS) assert.equal((await call('GET', p, { token: customer.token })).status, 403, p);
    for (const [m, p] of [['POST', '/admin/administrators'], ['POST', '/admin/billing/catalog/starter'], ['POST', '/admin/users/1/link-email'], ['PATCH', '/admin/businesses/00000000-0000-4000-8000-000000000000/access']])
      assert.equal((await call(m, p, { token: customer.token, body: { email: 'x@y.z', role: 'super_admin' } })).status, 403, m + ' ' + p);
    assert.equal(Number((await c.query('SELECT count(*) n FROM platform_admins')).rows[0].n), 1);
  });
  let staffAdminId;
  await check('role management: super_admin grants platform_admin (audited); a platform_admin cannot grant', async () => {
    const g = await call('POST', '/admin/administrators', { token: admin.token, body: { email: 'staff.ops@rehearsal.test', role: 'platform_admin' } });
    assert.ok(g.status === 200 || g.status === 201, JSON.stringify(g.body)); staffAdminId = g.body.administrator?.id ?? g.body.administrator?.user_id ?? staff.id;
    assert.equal((await call('GET', '/admin/dashboard', { token: staff.token })).status, 200);
    const esc = await call('POST', '/admin/administrators', { token: staff.token, body: { email: 'owner.alpha@rehearsal.test', role: 'super_admin' } });
    assert.equal(esc.status, 403, 'platform_admin escalated: ' + JSON.stringify(esc.body));
    const audit = await call('GET', '/admin/administrators/audit', { token: admin.token }); assert.equal(audit.status, 200);
    return { audit_entries: JSON.stringify(audit.body).match(/"action"/g)?.length || 0 };
  });
  await check('revocation takes effect immediately and is audited; the last super_admin cannot remove itself', async () => {
    const r = await call('POST', `/admin/administrators/${staffAdminId}/revoke`, { token: admin.token, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call('GET', '/admin/dashboard', { token: staff.token })).status, 403);
    const self = await call('POST', `/admin/administrators/${admin.id}/revoke`, { token: admin.token, body: {} });
    assert.ok(self.status >= 400, 'last super_admin removed: ' + self.status);
    assert.equal((await call('GET', '/admin/status', { token: admin.token })).body.is_admin, true);
  });
  await check('platform admin rights give no company membership', async () => {
    assert.equal(Number((await c.query('SELECT count(*) n FROM business_members WHERE user_id=$1', [admin.id])).rows[0].n), 0);
    const ws = await call('GET', '/workspaces', { token: admin.token }); assert.equal((ws.body.business || []).length, 0);
  });
  await c.end();
  process.exit(save() ? 0 : 1);
})().catch((e) => { console.error('ADMIN CRASHED', e); process.exit(1); });
