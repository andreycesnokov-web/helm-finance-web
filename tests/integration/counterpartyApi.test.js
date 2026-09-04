// Counterparty API V1 — scoping, duplicate protection, and the isolation fix.
// Boots the REAL server/index.js over the in-memory supabase shim.
//
// Run: node tests/integration/counterpartyApi.test.js
const path = require('path');
const Module = require('module');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'cp-api-test-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: '5609', NODE_ENV: 'test',
});
const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@supabase/supabase-js') return mem;
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '44444444-4444-4444-4444-444444444444';
// OWNER belongs to BOTH A and B — this is what makes the old user_id scoping wrong.
const OWNER = 940101;

mem.__seed('businesses', [
  { id: A, name: 'Helm Care Indonesia', type: 'company', owner_user_id: OWNER, created_at: '2026-01-01' },
  { id: B, name: 'Helm Care Pay', type: 'company', owner_user_id: OWNER, created_at: '2026-01-02' },
  { id: P, name: 'Personal', type: 'personal', owner_user_id: OWNER, created_at: '2026-01-03' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: OWNER, business_id: A, role: 'owner', status: 'active' },
  { id: 2, user_id: OWNER, business_id: B, role: 'owner', status: 'active' },
  { id: 3, user_id: OWNER, business_id: P, role: 'owner', status: 'active' },
]);
mem.__seed('counterparties', [
  { id: 'cp-a1', user_id: OWNER, business_id: A, name: 'PT Circleka Indonesia Utama',
    type: 'vendor', npwp: '0020797445007000', status: 'active', is_active: true,
    aliases: ['Circle K'] },
  { id: 'cp-a2', user_id: OWNER, business_id: A, name: 'PT Archived Co',
    status: 'archived', is_active: false },
  // Belongs to business B. The old PATCH scoped by user_id, so it was reachable
  // from business A by the same owner. It must not be.
  { id: 'cp-b1', user_id: OWNER, business_id: B, name: 'PT Pay Side Vendor',
    type: 'vendor', status: 'active', is_active: true },
]);
mem.__seed('counterparty_bank_accounts', [
  { id: 'ba-1', business_id: A, counterparty_id: 'cp-a1', bank_name: 'BCA',
    account_number: '075-3020192', account_name: 'CIRCLEKA INDONESIA UTAMA', is_primary: true },
]);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function call(method, p, { user = OWNER, biz, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = `Bearer ${tok(user)}`;
  if (biz) headers['x-business-id'] = biz;
  // GET/HEAD may not carry a body — the helper is shared across both shapes.
  const sendBody = body && !['GET', 'HEAD'].includes(method);
  const res = await fetch(BASE + p, { method, headers, body: sendBody ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}
const cps = () => mem.__db.counterparties || [];

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

(async () => {
  await new Promise((r) => setTimeout(r, 700));

  console.log('\nDirectory');
  await t('lists this business only, archived hidden by default', async () => {
    const r = await call('GET', '/counterparties', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    const names = r.body.counterparties.map((c) => c.name);
    assert.ok(names.includes('PT Circleka Indonesia Utama'));
    assert.ok(!names.includes('PT Archived Co'), 'archived must be hidden');
    assert.ok(!names.includes('PT Pay Side Vendor'), 'business B must not appear');
  });

  await t('16. archived is returned only when explicitly requested', async () => {
    const r = await call('GET', '/counterparties?include_archived=true', { biz: A });
    assert.ok(r.body.counterparties.some((c) => c.name === 'PT Archived Co'));
  });

  await t('the legacy { counterparties: [...] } shape is preserved', async () => {
    const r = await call('GET', '/counterparties', { biz: A });
    assert.ok(Array.isArray(r.body.counterparties));
    assert.ok('name' in r.body.counterparties[0], 'existing callers read .name');
  });

  await t('bank accounts come back with the record', async () => {
    const r = await call('GET', '/counterparties/cp-a1', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.counterparty.bank_accounts.length, 1);
    assert.strictEqual(r.body.counterparty.bank_accounts[0].account_number, '075-3020192');
    assert.strictEqual(r.body.counterparty.npwp, '0020797445007000');
  });

  console.log('\nCreate + duplicate protection');
  await t('9. a create sharing an NPWP is refused with 409 and the candidate', async () => {
    const before = cps().length;
    const r = await call('POST', '/counterparties', { biz: A, body: {
      legal_name: 'PT Circleka Ind. Utama', npwp: '00.207.974.4-500.7000', role: 'vendor' } });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'possible_duplicate_counterparty');
    assert.strictEqual(r.body.matched_counterparty_id, 'cp-a1');
    assert.strictEqual(cps().length, before, 'nothing may be created');
  });

  await t('a create sharing a bank account is refused', async () => {
    const before = cps().length;
    const r = await call('POST', '/counterparties', { biz: A, body: {
      legal_name: 'Some Other Name', role: 'vendor',
      bank_accounts: [{ account_number: '0753020192', bank_name: 'BCA' }] } });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    assert.strictEqual(cps().length, before);
  });

  await t('10. create_new_anyway is the explicit override', async () => {
    const before = cps().length;
    const r = await call('POST', '/counterparties', { biz: A, body: {
      legal_name: 'PT Circleka Ind. Utama', npwp: '00.207.974.4-500.7000',
      role: 'vendor', create_new_anyway: true } });
    assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    assert.strictEqual(cps().length, before + 1);
    const audit = (mem.__db.audit_events || []).find((a) => a.action === 'counterparty_created_duplicate_override');
    assert.ok(audit, 'the override must be audited');
  });

  await t('20. a genuinely new counterparty is created with aliases and a bank account', async () => {
    const r = await call('POST', '/counterparties', { biz: A, body: {
      legal_name: 'PT Brand New Supplier', role: 'vendor', npwp: '55.555.555.5-555.555',
      pkp_status: 'pkp', aliases: ['Brand New'],
      bank_accounts: [{ bank_name: 'Mandiri', account_number: '123-4567890', is_primary: true }] } });
    assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
    const c = r.body.counterparty;
    assert.strictEqual(c.role, 'vendor');
    assert.strictEqual(c.pkp_status, 'pkp');
    assert.deepStrictEqual(c.aliases, ['Brand New']);
    assert.strictEqual(c.bank_accounts.length, 1);
    assert.strictEqual(c.status, 'active');
  });

  await t('an invalid role is rejected', async () => {
    const r = await call('POST', '/counterparties', { biz: A, body: { legal_name: 'X', role: 'wizard' } });
    assert.strictEqual(r.status, 400, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'invalid_role');
  });

  await t('17. vendor, customer and both are accepted roles', async () => {
    for (const role of ['customer', 'both']) {
      const r = await call('POST', '/counterparties', { biz: A, body: { legal_name: `PT Role ${role}`, role } });
      assert.strictEqual(r.status, 200, `${role}: status ${r.status}`);
      assert.strictEqual(r.body.counterparty.role, role);
    }
  });

  console.log('\nIsolation fix (the pre-existing PATCH bug)');
  await t('4/14. PATCH can no longer reach another business, even for the same owner', async () => {
    // OWNER owns both A and B. Under the old `.eq('user_id', userId)` scoping this
    // succeeded. It must now 404.
    const r = await call('PATCH', '/counterparties/cp-b1', { biz: A, body: { notes: 'edited from A' } });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
    assert.strictEqual(r.body.error, 'counterparty_not_found_in_this_business');
    const row = cps().find((c) => c.id === 'cp-b1');
    assert.strictEqual(row.notes, undefined, 'business B row must be untouched');
  });

  await t('PATCH works normally inside the active business', async () => {
    const r = await call('PATCH', '/counterparties/cp-a1', { biz: A, body: {
      notes: 'preferred vendor', pkp_status: 'pkp', default_category: 'Location rent' } });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.counterparty.notes, 'preferred vendor');
    assert.strictEqual(r.body.counterparty.default_category, 'Location rent');
  });

  await t('18. a client-supplied business_id cannot redirect a write', async () => {
    const r = await call('PATCH', '/counterparties/cp-a1', { biz: A, body: {
      notes: 'scope test', business_id: B } });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    const row = cps().find((c) => c.id === 'cp-a1');
    assert.strictEqual(row.business_id, A, 'business_id must not move');
  });

  await t('13. GET :id from the wrong business is 404', async () => {
    const r = await call('GET', '/counterparties/cp-b1', { biz: A });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
  });

  console.log('\nArchive');
  await t('archive is a soft flag, and unarchive restores', async () => {
    const r = await call('POST', '/counterparties/cp-a1/archive', { biz: A });
    assert.strictEqual(r.status, 200, `status ${r.status}`);
    assert.strictEqual(r.body.counterparty.status, 'archived');
    assert.ok(cps().find((c) => c.id === 'cp-a1'), 'the row must still exist');
    const back = await call('POST', '/counterparties/cp-a1/archive', { biz: A, body: { unarchive: true } });
    assert.strictEqual(back.body.counterparty.status, 'active');
  });

  await t('archiving another business\'s counterparty is refused', async () => {
    const r = await call('POST', '/counterparties/cp-b1/archive', { biz: A });
    assert.strictEqual(r.status, 404, `status ${r.status}`);
  });

  console.log('\nWorkspace guards');
  await t('15. a personal workspace is refused everywhere', async () => {
    for (const [m, p] of [['GET', '/counterparties'], ['POST', '/counterparties'],
      ['GET', '/counterparties/cp-a1'], ['PATCH', '/counterparties/cp-a1'],
      ['POST', '/counterparties/cp-a1/archive']]) {
      const r = await call(m, p, { biz: P, body: { legal_name: 'X' } });
      assert.strictEqual(r.status, 403, `${m} ${p}: status ${r.status}`);
      assert.strictEqual(r.body.error, 'business_workspace_required');
    }
  });

  await t('unauthenticated is refused', async () => {
    const r = await call('GET', '/counterparties', { user: null });
    assert.strictEqual(r.status, 401, `status ${r.status}`);
  });

  await t('nothing leaked into business B throughout', async () => {
    const bRows = cps().filter((c) => c.business_id === B);
    assert.strictEqual(bRows.length, 1, 'B must still have exactly its seeded row');
    assert.strictEqual(bRows[0].id, 'cp-b1');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
  for (const h of process._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
})();
