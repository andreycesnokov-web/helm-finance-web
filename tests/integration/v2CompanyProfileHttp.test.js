// Actual Express/auth/resolver/GET/PUT/PATCH against a local synthetic PostgREST.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const SECRET = 'synthetic-v2-profile-only';
const businesses = {
  [A]: { id: A, type: 'business', name: 'Company A', country: 'Indonesia', base_currency: 'IDR', owner_user_id: 501, created_at: '2026-01-01', internal_secret: 'never-return' },
  [B]: { id: B, type: 'business', name: 'Company B', country: 'Indonesia', base_currency: 'IDR', owner_user_id: 501, created_at: '2026-02-01' },
};
let profiles, writes, failRead, db, app, base;
function send(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
test.before(async () => {
  db = http.createServer((req, res) => {
    let raw = ''; req.on('data', (s) => raw += s); req.on('end', () => {
      const url = new URL(req.url, 'http://synthetic'); const table = url.pathname.split('/').at(-1);
      const id = (url.searchParams.get('business_id') || url.searchParams.get('id') || `eq.${A}`).replace('eq.', '');
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      const selected = url.searchParams.get('select') || '*';
      if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Range': '0-0/0' }); return res.end(); }
      if (table === 'business_members') {
        const uid = Number((url.searchParams.get('user_id') || 'eq.501').replace('eq.', ''));
        if (uid === 503 && id === B) return send(res, []);
        const ids = url.searchParams.has('business_id') ? [id] : [A, B];
        return send(res, ids.map((bid) => ({ id: `${uid}-${bid}`, business_id: bid, user_id: uid, role: uid === 502 ? 'auditor' : 'owner', status: 'active', businesses: businesses[bid] })));
      }
      if (table === 'tax_profiles') {
        if (req.method === 'GET') {
          if (selected.split(',').includes('employee_count') && selected !== '*') return send(res, { code: 'PGRST204', message: "Could not find the 'employee_count' column of 'tax_profiles' in the schema cache" }, 400);
          if (failRead && selected === '*') return send(res, { message: 'synthetic read unavailable' }, 500);
          const row = profiles[id]; return send(res, single ? row || {} : row ? [row] : []);
        }
        const body = JSON.parse(raw); writes.push({ table, body });
        profiles[body.business_id] = { ...(profiles[body.business_id] || {}), id: `profile-${body.business_id}`, ...body };
        return send(res, single ? profiles[body.business_id] : [profiles[body.business_id]]);
      }
      if (table === 'businesses') {
        if (req.method === 'PATCH') {
          const body = JSON.parse(raw);
          if ('timezone' in body) return send(res, { message: "Could not find the 'timezone' column of 'businesses' in the schema cache" }, 400);
          writes.push({ table, id, body }); Object.assign(businesses[id], body);
        }
        return send(res, single ? businesses[id] : [businesses[id]]);
      }
      return send(res, single ? {} : []);
    });
  });
  await new Promise((r) => db.listen(0, '127.0.0.1', r));
  // Reserve a local port before starting the real app (no production connection).
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port; await new Promise((r) => reserve.close(r)); base = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, [path.resolve(__dirname, '../../server/index.js')], { env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, NODE_ENV: 'test', PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${db.address().port}`, SUPABASE_SECRET_KEY: 'synthetic', BOT_TOKEN: 'synthetic', TELEGRAM_WEBHOOK_SECRET: 'synthetic', JWT_SECRET: SECRET }, stdio: ['ignore','pipe','pipe'] });
  let startup='';const capture=chunk=>{startup=(startup+String(chunk)).slice(-8000)};
  app.stdout.on('data',capture);app.stderr.on('data',capture);app.on('error',capture);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`isolated HTTP app did not start (exit=${app.exitCode}): ${startup}`);
});
test.beforeEach(() => {
  profiles = { [A]: { id: 'profile-A', business_id: A, country: 'Indonesia', jurisdiction: 'ID', npwp: '000111', accounting_method: 'unchanged', primary_kbli: '00111' }, [B]: { id: 'profile-B', business_id: B, country: 'Indonesia', jurisdiction: 'ID', npwp: '000222' } };
  writes = []; failRead = false;
});
test.after(async () => { app?.kill(); await new Promise((r) => db.close(r)); });
async function call(method, endpoint, id = A, body, user = 501) {
  const res = await fetch(`${base}/api${endpoint}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ userId: user }, SECRET)}`, 'Content-Type': 'application/json', 'x-business-id': id }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
test('GET accurately reports partial schema beyond primary_kbli/field_verification', async () => {
  const r = await call('GET', '/accountant/profile'); assert.equal(r.status, 200);
  assert.equal(r.data.extended_fields, false); assert.deepEqual(r.data.unsupported_fields, ['employee_count']);
  assert.ok(r.data.supported_extended_fields.includes('field_verification'));
});
test('legacy PUT without reviewed version/key is refused with no direct table fallback', async () => {
  const r = await call('PUT', '/accountant/profile', A, { npwp: '000999', jurisdiction: 'ID', primary_kbli: '00001', employee_count: '2' });
  assert.equal(r.status, 400);
  assert.equal(profiles[B].npwp, '000222'); assert.equal(profiles[A].accounting_method, 'unchanged');
  const read = await call('GET', '/accountant/profile'); assert.equal(read.data.profile.npwp, '000111'); assert.equal(read.data.profile.primary_kbli, '00111');
  assert.equal(writes.length,0);
});
test('unavailable atomic RPC never creates an absent profile via a direct write', async () => {
  delete profiles[A]; const r = await call('PUT', '/accountant/profile', A, { jurisdiction: 'ID', country: 'Indonesia',expected_version:'0',request_key:A });
  assert.equal(r.status, 503); assert.equal(r.data.outcome,'unknown'); assert.equal(profiles[A],undefined);assert.equal(profiles[B].npwp, '000222');assert.equal(writes.length,0);
});
test('profile read failure remains visible and a malformed legacy save cannot mutate', async () => {
  failRead = true; assert.equal((await call('GET', '/accountant/profile')).status, 500);
  assert.equal((await call('PUT', '/accountant/profile', A, { npwp: 'bad' })).status, 400); assert.equal(writes.length, 0);
});
test('auditor is read-only; inaccessible explicit company cannot fall back to A', async () => {
  assert.equal((await call('GET', '/accountant/profile', A, null, 502)).data.can_edit, false);
  assert.equal((await call('PUT', '/accountant/profile', A, { npwp: 'bad' }, 502)).status, 403);
  assert.equal((await call('PUT', '/accountant/profile', B, { npwp: 'bad' }, 503)).status, 403);
  assert.equal(writes.length, 0);
});
test('CompanyTab GET is scoped/whitelisted; PATCH reports unsupported field and keeps B isolated', async () => {
  const read = await call('GET', '/business/current'); assert.equal(read.data.business.name, 'Company A'); assert.ok(!JSON.stringify(read.data).includes('internal_secret'));
  const r = await call('PATCH', '/business/current', A, { name: 'Renamed A', timezone: 'UTC' });
  assert.equal(r.status, 200); assert.deepEqual(r.data.unsupported_fields, ['timezone']); assert.equal(r.data.business.name, 'Renamed A'); assert.equal(businesses[B].name, 'Company B');
  assert.equal((await call('PATCH', '/business/current', A, { name: 'Forbidden' }, 502)).status, 403);
});
