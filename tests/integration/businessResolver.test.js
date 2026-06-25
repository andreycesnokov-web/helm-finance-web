// resolveActiveBusiness — server-side isolation contract, over PGlite (real SQL via
// the supabase-shim). Proves the core of the multi-business isolation fix without a
// running Supabase: honors x-business-id, rejects an explicit inaccessible id with
// 403 (no silent fallback), rejects personal workspaces, defaults deterministically,
// and flags only the EARLIEST-created business as primary (legacy-row absorber).
const { test } = require('node:test');
const assert = require('node:assert');
const { PGlite } = require('@electric-sql/pglite');
const { makeClient } = require('./_pgliteSupabase');
const { resolveActiveBusiness, getPrimaryBusinessId } = require('../../server/lib/businessResolver');

const A = '11111111-1111-1111-1111-111111111111'; // primary (earliest-created)
const B = '22222222-2222-2222-2222-222222222222'; // second business
const C = '33333333-3333-3333-3333-333333333333'; // business the user is NOT in
const P = '44444444-4444-4444-4444-444444444444'; // personal workspace
const USER = 950004;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE businesses (id uuid PRIMARY KEY, owner_user_id bigint, name text, type text DEFAULT 'business', created_at timestamptz);
    CREATE TABLE business_members (business_id uuid, user_id bigint, role text, status text);
    INSERT INTO businesses VALUES
      ('${A}',${USER},'A','business','2024-01-01'),
      ('${B}',${USER},'B','business','2024-06-01'),
      ('${C}',999,'C','business','2024-01-01'),
      ('${P}',${USER},'Personal','personal','2024-01-01');
    INSERT INTO business_members VALUES
      ('${A}',${USER},'owner','active'),
      ('${B}',${USER},'owner','active'),
      ('${C}',999,'owner','active'),
      ('${P}',${USER},'owner','active');
  `);
  const supabase = makeClient(db);
  const ensureDefaultBusiness = async () => ({
    business: { id: A, owner_user_id: USER, name: 'A', type: 'business', created_at: '2024-01-01' },
    membership: { role: 'owner' },
  });
  return { db, supabase, ensureDefaultBusiness };
}
const req = (headers = {}) => ({ user: { userId: USER }, headers, query: {}, body: {} });

test('honors x-business-id → returns the SELECTED business (B), not the default (A)', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  const r = await resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': B }));
  assert.equal(r.business.id, B);
  assert.equal(r.role, 'owner');
});

test('B (non-primary) is NOT primary → scoped strictly; A IS primary', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  const rB = await resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': B }));
  assert.equal(rB.isPrimaryBusiness, false);
  const rA = await resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': A }));
  assert.equal(rA.isPrimaryBusiness, true);
});

test('primary = EARLIEST-created business (deterministic)', async () => {
  const { supabase } = await setup();
  assert.equal(await getPrimaryBusinessId(supabase, USER), A);
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

test('personal workspace on a business route → 403 business_workspace_required', async () => {
  const { supabase, ensureDefaultBusiness } = await setup();
  await assert.rejects(
    () => resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': P })),
    (e) => { assert.equal(e.message, 'business_workspace_required'); assert.equal(e.status, 403); return true; }
  );
});

test('inactive membership is rejected with 403', async () => {
  const { db, supabase, ensureDefaultBusiness } = await setup();
  await db.exec(`UPDATE business_members SET status='inactive' WHERE business_id='${B}' AND user_id=${USER};`);
  await assert.rejects(
    () => resolveActiveBusiness(supabase, ensureDefaultBusiness, req({ 'x-business-id': B })),
    (e) => e.status === 403
  );
});
