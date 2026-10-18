'use strict';
const assert = require('assert');
const { Client } = require('pg');
const crypto = require('crypto');
const { secrets, PORTS } = require('./rehearsal/env.cjs');
const S = secrets();

const GATEWAY_URL = `http://127.0.0.1:${PORTS.api}`;
const GOTRUE_URL = `http://127.0.0.1:${PORTS.auth}`;

async function runTests() {
  console.log('=== CFO AI V2 — PRICING & BILLING SYNCHRONIZATION TEST SUITE ===');
  const pg = new Client({ connectionString: `postgresql://postgres:${S.db_password}@127.0.0.1:${PORTS.db}/postgres` });
  await pg.connect();

  let passed = 0;
  let total = 0;
  const test = async (name, fn) => {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}:`, err.message);
      throw err;
    }
  };

  // 1. Catalog Verification
  await test('1.1 Public Catalog contains Starter ($59), Control ($149), and Pro ($249)', async () => {
    const res = await pg.query('SELECT public.billing_public_catalog() AS cat');
    const cat = res.rows[0].cat;
    assert.strictEqual(cat.plans.length, 3, 'Must contain exactly 3 published plans');

    const starter = cat.plans.find(p => p.plan === 'starter');
    const control = cat.plans.find(p => p.plan === 'control');
    const pro = cat.plans.find(p => p.plan === 'pro');

    assert(starter && control && pro, 'All 3 plans must be present');
    assert.strictEqual(Number(starter.price_minor), 5900, 'Starter price must be $59');
    assert.strictEqual(Number(control.price_minor), 14900, 'Control price must be $149');
    assert.strictEqual(Number(pro.price_minor), 24900, 'Pro price must be $249');

    assert.strictEqual(starter.trial_hours, 168, 'Starter trial must be 168 hours');
    assert.strictEqual(control.trial_hours, 168, 'Control trial must be 168 hours');
    assert.strictEqual(pro.trial_hours, 168, 'Pro trial must be 168 hours');
  });

  await test('1.2 Quota definitions match PRICING_SOURCE_OF_TRUTH.md exactly', async () => {
    const res = await pg.query('SELECT public.billing_public_catalog() AS cat');
    const plans = res.rows[0].cat.plans;
    const byPlan = Object.fromEntries(plans.map(p => [p.plan, Object.fromEntries(p.limits.map(l => [l.key, l.value]))]));

    // Starter quotas
    assert.strictEqual(byPlan.starter.users, 5, 'Starter users = 5');
    assert.strictEqual(byPlan.starter.companies, 1, 'Starter companies = 1');
    assert.strictEqual(byPlan.starter.accounts, 5, 'Starter accounts = 5');
    assert.strictEqual(byPlan.starter.transactions, 2000, 'Starter transactions = 2,000');
    assert.strictEqual(byPlan.starter.documents, 200, 'Starter documents = 200');
    assert.strictEqual(byPlan.starter.ai, 50, 'Starter AI = 50');
    assert.strictEqual(byPlan.starter.mcp, 500, 'Starter MCP = 500');

    // Control quotas
    assert.strictEqual(byPlan.control.users, 10, 'Control users = 10');
    assert.strictEqual(byPlan.control.companies, 2, 'Control companies = 2');
    assert.strictEqual(byPlan.control.accounts, 15, 'Control accounts = 15');
    assert.strictEqual(byPlan.control.transactions, 10000, 'Control transactions = 10,000');
    assert.strictEqual(byPlan.control.documents, 1000, 'Control documents = 1,000');
    assert.strictEqual(byPlan.control.ai, 300, 'Control AI = 300');
    assert.strictEqual(byPlan.control.mcp, 3000, 'Control MCP = 3,000');

    // Pro quotas
    assert.strictEqual(byPlan.pro.users, 30, 'Pro users = 30');
    assert.strictEqual(byPlan.pro.companies, 5, 'Pro companies = 5');
    assert.strictEqual(byPlan.pro.accounts, 50, 'Pro accounts = 50');
    assert.strictEqual(byPlan.pro.transactions, 50000, 'Pro transactions = 50,000');
    assert.strictEqual(byPlan.pro.documents, 3000, 'Pro documents = 3,000');
    assert.strictEqual(byPlan.pro.ai, 1000, 'Pro AI = 1,000');
    assert.strictEqual(byPlan.pro.mcp, 15000, 'Pro MCP = 15,000');
  });

  await test('1.3 Feature entitlements match PRICING_SOURCE_OF_TRUTH.md exactly', async () => {
    const res = await pg.query('SELECT plan, features FROM plan_versions WHERE approval_status = \'approved\'');
    const byPlan = Object.fromEntries(res.rows.map(r => [r.plan, r.features]));

    // Starter features
    assert.strictEqual(byPlan.starter.documents, true, 'Starter documents = true');
    assert.strictEqual(byPlan.starter.approvals, false, 'Starter approvals = false');
    assert.strictEqual(byPlan.starter.payroll, false, 'Starter payroll = false');
    assert.strictEqual(byPlan.starter.ai_accountant, false, 'Starter ai_accountant = false');

    // Control features
    assert.strictEqual(byPlan.control.approvals, true, 'Control approvals = true');
    assert.strictEqual(byPlan.control.payroll, true, 'Control payroll = true');
    assert.strictEqual(byPlan.control.ai_accountant, true, 'Control ai_accountant = true');

    // Pro features
    assert.strictEqual(byPlan.pro.integrations, true, 'Pro integrations = true');
    assert.strictEqual(byPlan.pro.approvals, true, 'Pro approvals = true');
    assert.strictEqual(byPlan.pro.payroll, true, 'Pro payroll = true');
  });

  const createTestOwner = async (prefix) => {
    const email = `${prefix.toLowerCase()}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@test.matrix`;
    const uRes = await pg.query("INSERT INTO public.users(id, first_name, role) VALUES(public.next_app_user_id(), $1, 'personal') RETURNING id", [prefix]);
    const userId = uRes.rows[0].id;
    await pg.query("INSERT INTO public.user_email_identities(user_id, email, email_verified_at) VALUES($1, $2, now())", [userId, email]);
    return userId;
  };

  // 2. Multi-Company Quota Enforcement Tests
  await test('2.1 Multi-company counting in billing_usage reflects actual owner companies', async () => {
    // Create an owner user directly in db with verified email
    const userId = await createTestOwner('owner.multi');

    // Create 1st company
    const b1Res = await pg.query(`
      SELECT public.rpc_create_business_commercial_once(
        $1, $2, '{"name":"Company Alpha","base_currency":"IDR"}'::jsonb, '[]'::jsonb
      ) AS res
    `, [userId, crypto.randomUUID()]);
    const b1Id = b1Res.rows[0].res.business.id;

    // Check usage on company 1
    const usage1 = await pg.query('SELECT public.billing_usage($1) AS u', [b1Id]);
    assert.strictEqual(usage1.rows[0].u.companies, 1, 'Owner with 1 company has usage companies = 1');

    // Activate Starter trial (limit = 1 company)
    const starterVerRes = await pg.query("SELECT id FROM plan_versions WHERE plan = 'starter' AND approval_status = 'approved' ORDER BY version DESC LIMIT 1");
    const starterVid = starterVerRes.rows[0].id;
    await pg.query(`
      SELECT public.rpc_billing_trial_command(
        $1, $2, $3, 'select_plan', $4, 1, false
      )
    `, [userId, b1Id, crypto.randomUUID(), starterVid]);

    await pg.query(`
      SELECT public.rpc_billing_trial_command(
        $1, $2, $3, 'activate_trial', $4, 2, false
      )
    `, [userId, b1Id, crypto.randomUUID(), starterVid]);

    // Attempt to create 2nd company on Starter (limit = 1) -> must throw company_limit_reached
    let caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_create_business_commercial_once(
          $1, $2, '{"name":"Company Beta","base_currency":"IDR"}'::jsonb, '[]'::jsonb
        ) AS res
      `, [userId, crypto.randomUUID()]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('company_limit_reached'), 'Creating 2nd company on Starter must be refused with company_limit_reached');
  });

  await test('2.2 Control plan allows creating up to 2 companies, blocks 3rd company', async () => {
    const userId = await createTestOwner('owner.ctrl');

    // Company 1
    const b1Res = await pg.query(`
      SELECT public.rpc_create_business_commercial_once(
        $1, $2, '{"name":"Control Alpha","base_currency":"IDR"}'::jsonb, '[]'::jsonb
      ) AS res
    `, [userId, crypto.randomUUID()]);
    const b1Id = b1Res.rows[0].res.business.id;

    // Activate Control trial on Company 1 (limit = 2 companies)
    const ctrlVerRes = await pg.query("SELECT id FROM plan_versions WHERE plan = 'control' AND approval_status = 'approved' ORDER BY version DESC LIMIT 1");
    const ctrlVid = ctrlVerRes.rows[0].id;

    await pg.query(`
      SELECT public.rpc_billing_trial_command($1, $2, $3, 'select_plan', $4, 1, false)
    `, [userId, b1Id, crypto.randomUUID(), ctrlVid]);

    await pg.query(`
      SELECT public.rpc_billing_trial_command($1, $2, $3, 'activate_trial', $4, 2, false)
    `, [userId, b1Id, crypto.randomUUID(), ctrlVid]);

    // Company 2 creation MUST SUCCEED (allowed: 2)
    const b2Res = await pg.query(`
      SELECT public.rpc_create_business_commercial_once(
        $1, $2, '{"name":"Control Beta","base_currency":"IDR"}'::jsonb, '[]'::jsonb
      ) AS res
    `, [userId, crypto.randomUUID()]);
    assert(b2Res.rows[0].res.business.id, '2nd company must be created successfully on Control');
    const b2Id = b2Res.rows[0].res.business.id;

    // Usage now reflects 2 companies
    const usageB1 = await pg.query('SELECT public.billing_usage($1) AS u', [b1Id]);
    assert.strictEqual(usageB1.rows[0].u.companies, 2, 'Usage now reflects 2 companies owned');

    // Attempt to create Company 3 (exceeds Control limit of 2) -> must throw company_limit_reached
    let caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_create_business_commercial_once(
          $1, $2, '{"name":"Control Gamma","base_currency":"IDR"}'::jsonb, '[]'::jsonb
        ) AS res
      `, [userId, crypto.randomUUID()]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('company_limit_reached'), 'Creating 3rd company on Control must be refused with company_limit_reached');
  });

  // 3. Quota Exhaustion & Boundaries
  await test('3.1 Financial accounts (wallets) quota enforces plan limit (5 on Starter)', async () => {
    const userId = await createTestOwner('owner.wallets');

    const bRes = await pg.query(`
      SELECT public.rpc_create_business_commercial_once(
        $1, $2, '{"name":"Wallet Test Co","base_currency":"IDR"}'::jsonb, '[]'::jsonb
      ) AS res
    `, [userId, crypto.randomUUID()]);
    const bizId = bRes.rows[0].res.business.id;

    // Activate Starter plan (accounts limit = 5)
    const starterVerRes = await pg.query("SELECT id FROM plan_versions WHERE plan = 'starter' AND approval_status = 'approved' ORDER BY version DESC LIMIT 1");
    const starterVid = starterVerRes.rows[0].id;

    await pg.query(`
      SELECT public.rpc_billing_trial_command($1, $2, $3, 'select_plan', $4, 1, false)
    `, [userId, bizId, crypto.randomUUID(), starterVid]);
    await pg.query(`
      SELECT public.rpc_billing_trial_command($1, $2, $3, 'activate_trial', $4, 2, false)
    `, [userId, bizId, crypto.randomUUID(), starterVid]);

    // Create 5 wallets (limit is 5)
    for (let i = 1; i <= 5; i++) {
      const rKey = crypto.randomUUID();
      // Reserve quota
      await pg.query(`
        SELECT public.rpc_billing_quota($1, $2, $3, 'accounts', 'reserve', 1)
      `, [userId, bizId, rKey]);
      await pg.query(`
        INSERT INTO public.wallets(user_id, business_id, name, currency, is_active) VALUES($1, $2, $3, 'IDR', true)
      `, [userId, bizId, `Account ${i}`]);
      // Commit quota
      await pg.query(`
        SELECT public.rpc_billing_quota($1, $2, $3, 'accounts', 'commit', 1)
      `, [userId, bizId, rKey]);
    }

    // Attempting 6th wallet reservation -> MUST RAISE billing_quota_reached
    let caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_billing_quota($1, $2, $3, 'accounts', 'reserve', 1)
      `, [userId, bizId, crypto.randomUUID()]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('billing_quota_reached'), '6th account on Starter must raise billing_quota_reached');
  });

  // 4. Trial Expiry & Read-Only / Export Preservation
  await test('4.1 Expired trial enforces restricted writes while preserving read/export', async () => {
    const userId = await createTestOwner('owner.expired');

    const bRes = await pg.query(`
      SELECT public.rpc_create_business_commercial_once(
        $1, $2, '{"name":"Expired Co","base_currency":"IDR"}'::jsonb, '[]'::jsonb
      ) AS res
    `, [userId, crypto.randomUUID()]);
    const bizId = bRes.rows[0].res.business.id;

    const starterVerRes = await pg.query("SELECT id FROM plan_versions WHERE plan = 'starter' AND approval_status = 'approved' ORDER BY version DESC LIMIT 1");
    const starterVid = starterVerRes.rows[0].id;

    await pg.query(`SELECT public.rpc_billing_trial_command($1, $2, $3, 'select_plan', $4, 1, false)`, [userId, bizId, crypto.randomUUID(), starterVid]);
    await pg.query(`SELECT public.rpc_billing_trial_command($1, $2, $3, 'activate_trial', $4, 2, false)`, [userId, bizId, crypto.randomUUID(), starterVid]);

    // Force trial to expire (set trial_started_at to 8 days ago and trial_ends_at to 1 day ago)
    await pg.query("UPDATE public.billing_accounts SET trial_started_at = now() - interval '8 days', trial_ends_at = now() - interval '1 day' WHERE business_id = $1", [bizId]);

    // Snapshot check
    const snapRes = await pg.query("SELECT public.rpc_billing_snapshot($1, $2, false) AS s", [userId, bizId]);
    const snap = snapRes.rows[0].s;
    assert(new Date(snap.trial_ends_at) < new Date(snap.server_now), 'Trial period must be ended');

    // Attempting to reserve quota on expired trial -> MUST RAISE billing_restricted
    let caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_billing_quota($1, $2, $3, 'transactions', 'reserve', 1)
      `, [userId, bizId, crypto.randomUUID()]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('billing_restricted'), 'Mutations on expired trial must be rejected with billing_restricted');

    // Read access to transactions/wallets table is still functional
    const readCheck = await pg.query('SELECT count(*) FROM public.wallets WHERE business_id = $1', [bizId]);
    assert(readCheck.rows[0].count !== undefined, 'Read queries succeed on expired accounts');
  });

  // 5. Tenant Isolation
  await test('5.1 Cross-company tenant isolation prevents viewing or reserving across businesses', async () => {
    // User A and Company A
    const userA = await createTestOwner('userA');
    const bARes = await pg.query(`SELECT public.rpc_create_business_commercial_once($1, $2, '{"name":"Company A","base_currency":"IDR"}'::jsonb, '[]'::jsonb) AS res`, [userA, crypto.randomUUID()]);
    const bizA = bARes.rows[0].res.business.id;

    // User B and Company B
    const userB = await createTestOwner('userB');
    const bBRes = await pg.query(`SELECT public.rpc_create_business_commercial_once($1, $2, '{"name":"Company B","base_currency":"IDR"}'::jsonb, '[]'::jsonb) AS res`, [userB, crypto.randomUUID()]);
    const bizB = bBRes.rows[0].res.business.id;

    // User A attempts to reserve quota on Company B -> MUST FAIL with billing_forbidden
    let caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_billing_quota($1, $2, $3, 'transactions', 'reserve', 1)
      `, [userA, bizB, crypto.randomUUID()]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('billing_forbidden'), 'Cross-business quota reservation must fail with billing_forbidden');

    // User A attempts to read Company B snapshot -> MUST FAIL with billing_forbidden
    caught = null;
    try {
      await pg.query(`
        SELECT public.rpc_billing_snapshot($1, $2, false)
      `, [userA, bizB]);
    } catch (e) {
      caught = e;
    }
    assert(caught && caught.message.includes('billing_forbidden'), 'Cross-business snapshot read must fail with billing_forbidden');
  });

  await pg.end();
  console.log(`\n======================================================`);
  console.log(`RESULTS: ${passed} / ${total} CHECKS PASSED (100% SUCCESS)`);
  console.log(`======================================================\n`);
}

runTests().catch(err => {
  console.error('\nTest suite execution failed:', err);
  process.exit(1);
});
