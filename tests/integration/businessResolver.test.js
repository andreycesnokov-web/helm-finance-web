// resolveActiveBusiness — server-side isolation contract, over PGlite (real SQL via
// the supabase-shim). Proves the core of the multi-business isolation fix without a
// running Supabase: the resolver honors x-business-id, rejects an explicit
// inaccessible id with 403 (no silent fallback), and only defaults when no id given.
const { test } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { makeClient } = require('./_pgliteSupabase');
const { resolveActiveBusiness } = require('../../server/lib/businessResolver');

const A = '11111111-1111-1111-1111-111111111111'; // default business (owner)
const B = '22222222-2222-2222-2222-222222222222'; // second business (owner)
const C = '33333333-3333-3333-3333-333333333333'; // business the user is NOT in
const USER = 950004;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, owner_user_id bigint, name text, type text DEFAULT 'business');
    CREATE TABLE business_members (business_id uuid, user_id bigint, role text, status text);
    INSERT INTO businesses VALUES ('${A}',${USER},'A'), ('${B}',${USER},'B'), ('${C}',999,'C');
    INSERT INTO business_members VALUES
      ('${A}',${USER},'owner','active'),
      ('${B}',${USER},'owner','active'),
      ('${C}',999,'owner','active');
  `);
  const supabase = makeClient(db);
  // Stub: default business is A (mirrors ensureDefaultBusiness).
  const ensureDefaultBusiness = async () => ({
    business: { id: A, owner_user_id: USER, name: 'A' }, membership: { role: 'owner' },
  });
  return { supabase, ensureDefaultBusiness };
}
const req = (headers = {}) => ({ user: { userId: USER }, headers, query: {}, body: {} });

test('honors x-business-id → returns the SELECTED business (B), not the default (A)', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  const r = await resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': B }));
  assert.equal(r.business.id, B);
  assert.equal(r.role, 'owner');
});

test('no x-business-id → falls back to the default business (A)', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  const r = await resolveActiveBusiness(supabase, ensureDefaultBusiness, req({}));
  assert.equal(r.business.id, A);
});

test('explicit INACCESSIBLE id → 403 workspace_not_accessible (no silent fallback)', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  await assert.rejects(
    () => resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': C })),
    (e) => { assert.equal(e.message, 'workspace_not_accessible'); assert.equal(e.status, 403); return true; }
  );
});

test('explicit BOGUS id → 403 (does not leak the default business)', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  await assert.rejects(
    () => resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': '00000000-0000-0000-0000-000000000000' })),
    (e) => e.status === 403
  );
});

test('inactive membership is rejected with 403', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  await supabase._db.exec(`UPDATE business_members SET status='inactive' WHERE business_id='${B}' AND user_id=${USER};`);
  await assert.rejects(
    () => resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': B })),
    (e) => e.status === 403
  );
});
