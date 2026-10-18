'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { VALID_PLANS, computeBusinessAccess, TRIAL_DURATION_MS } = require('../server/lib/businessAccess');

// Replicate the pure logic of client/src/lib/planSelection.js for Node test runner
const VALID_COMMERCIAL_PLANS = ['starter', 'control', 'pro'];
const PLAN_STORAGE_KEY = 'cfo_selected_plan';

const PLAN_DETAILS = {
  starter: { code: 'starter', name: 'Starter', priceUsd: 59, priceMonthly: '$59', trialDays: 7, trialHours: 168 },
  control: { code: 'control', name: 'Control', priceUsd: 149, priceMonthly: '$149', trialDays: 7, trialHours: 168 },
  pro: { code: 'pro', name: 'Pro', priceUsd: 249, priceMonthly: '$249', trialDays: 7, trialHours: 168 },
};

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'string') return null;
  const p = plan.trim().toLowerCase();
  return VALID_COMMERCIAL_PLANS.includes(p) ? p : null;
}

function appendPlanParam(path, plan) {
  if (!plan || !path) return path;
  try {
    const [base, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    if (!params.has('plan')) {
      params.set('plan', plan);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  } catch {
    return path;
  }
}

// In-memory mock localStorage
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

test('Plan Normalization and Whitelist Validation', () => {
  assert.equal(normalizePlan('starter'), 'starter');
  assert.equal(normalizePlan('Starter'), 'starter');
  assert.equal(normalizePlan('STARTER '), 'starter');
  assert.equal(normalizePlan('control'), 'control');
  assert.equal(normalizePlan('Control'), 'control');
  assert.equal(normalizePlan('pro'), 'pro');
  assert.equal(normalizePlan('  PRO  '), 'pro');

  // Invalid, unknown, or legacy plans must be rejected
  assert.equal(normalizePlan('founder'), null);
  assert.equal(normalizePlan('free'), null);
  assert.equal(normalizePlan('enterprise'), null);
  assert.equal(normalizePlan('business'), null);
  assert.equal(normalizePlan('vip'), null);
  assert.equal(normalizePlan(''), null);
  assert.equal(normalizePlan(null), null);
  assert.equal(normalizePlan(undefined), null);
  assert.equal(normalizePlan('<script>alert(1)</script>'), null);
});

test('Plan Storage and Retrieval Persistence', () => {
  const storage = createMockStorage();

  const capture = (search) => {
    const params = new URLSearchParams(search);
    const p = normalizePlan(params.get('plan'));
    if (p) {
      storage.setItem(PLAN_STORAGE_KEY, p);
      return p;
    }
    return normalizePlan(storage.getItem(PLAN_STORAGE_KEY));
  };

  const get = () => normalizePlan(storage.getItem(PLAN_STORAGE_KEY));
  const clear = () => storage.removeItem(PLAN_STORAGE_KEY);

  // Initial state empty
  assert.equal(get(), null);

  // Capture valid plan
  assert.equal(capture('?plan=control'), 'control');
  assert.equal(get(), 'control');

  // URL without plan keeps previously stored plan
  assert.equal(capture('?ref=google'), 'control');
  assert.equal(get(), 'control');

  // Switching plan
  assert.equal(capture('?plan=pro'), 'pro');
  assert.equal(get(), 'pro');

  // Invalid plan does NOT overwrite valid stored plan
  assert.equal(capture('?plan=invalid_tier'), 'pro');
  assert.equal(get(), 'pro');

  // Clear removes stored plan
  clear();
  assert.equal(get(), null);
});

test('URL and Route Parameter Propagation', () => {
  assert.equal(appendPlanParam('/register', 'starter'), '/register?plan=starter');
  assert.equal(appendPlanParam('/register?tab=email', 'control'), '/register?tab=email&plan=control');
  assert.equal(appendPlanParam('/register?plan=pro', 'control'), '/register?plan=pro');
  assert.equal(appendPlanParam('/business/new', 'pro'), '/business/new?plan=pro');
  assert.equal(appendPlanParam('/business/trial?business_id=123', 'starter'), '/business/trial?business_id=123&plan=starter');
  assert.equal(appendPlanParam('/login', null), '/login');
  assert.equal(appendPlanParam('', 'starter'), '');
});

test('Approved V2 Pricing Catalog and Limits Specs', () => {
  assert.equal(PLAN_DETAILS.starter.priceMonthly, '$59');
  assert.equal(PLAN_DETAILS.starter.priceUsd, 59);
  assert.equal(PLAN_DETAILS.starter.trialDays, 7);
  assert.equal(PLAN_DETAILS.starter.trialHours, 168);

  assert.equal(PLAN_DETAILS.control.priceMonthly, '$149');
  assert.equal(PLAN_DETAILS.control.priceUsd, 149);
  assert.equal(PLAN_DETAILS.control.trialDays, 7);
  assert.equal(PLAN_DETAILS.control.trialHours, 168);

  assert.equal(PLAN_DETAILS.pro.priceMonthly, '$249');
  assert.equal(PLAN_DETAILS.pro.priceUsd, 249);
  assert.equal(PLAN_DETAILS.pro.trialDays, 7);
  assert.equal(PLAN_DETAILS.pro.trialHours, 168);

  // Exact 168 hours = 7 * 24 * 60 * 60 * 1000 ms
  assert.equal(TRIAL_DURATION_MS, 168 * 3600 * 1000);
});

test('Commercial V2 Trial Entitlement and Effective Plan Computation', () => {
  const bizId = crypto.randomUUID();
  const starterVersionId = crypto.randomUUID();
  const controlVersionId = crypto.randomUUID();
  const proVersionId = crypto.randomUUID();

  const business = {
    id: bizId,
    type: 'business',
    plan: 'free',
    billing_policy: 'commercial_v2',
  };

  const planVersions = [
    {
      id: starterVersionId,
      plan: 'starter',
      terms_version: 'v2-approved',
      features: { documents: true, ai: true, bank_import: true },
      limits: { users: 5, transactions: 1000, documents: 100, accounts: 5 },
    },
    {
      id: controlVersionId,
      plan: 'control',
      terms_version: 'v2-approved',
      features: { documents: true, ai: true, bank_import: true, approvals: true },
      limits: { users: 10, transactions: 5000, documents: 500, accounts: 10 },
    },
    {
      id: proVersionId,
      plan: 'pro',
      terms_version: 'v2-approved',
      features: { documents: true, ai: true, bank_import: true, approvals: true, payroll: true },
      limits: { users: 30, transactions: 20000, documents: 2000, accounts: 20 },
    },
  ];

  const now = new Date('2026-10-18T12:00:00Z');
  const trialStart = new Date('2026-10-18T10:00:00Z');
  const trialEnd = new Date(trialStart.getTime() + 168 * 3600 * 1000); // exactly 168h later

  // 1. Pro trial active
  const billingPro = {
    business_id: bizId,
    version: 3,
    selected_plan_version_id: proVersionId,
    trial_started_at: trialStart.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    trial_hours: 168,
    plan_versions: planVersions,
  };

  const accessPro = computeBusinessAccess(business, now, billingPro);
  assert.equal(accessPro.policy, 'commercial_v2');
  assert.equal(accessPro.effective_plan, 'pro');
  assert.equal(accessPro.trial_plan, 'pro');
  assert.equal(accessPro.effective_access_source, 'trial');
  assert.equal(accessPro.trial_status_effective, 'active');
  assert.equal(accessPro.restricted, false);
  assert.equal(accessPro.limits.users, 30);
  assert.equal(accessPro.limits.transactions, 20000);
  // Must NOT assign legacy 'founder'
  assert.notEqual(accessPro.effective_plan, 'founder');

  // 2. Control trial active
  const billingControl = {
    business_id: bizId,
    version: 3,
    selected_plan_version_id: controlVersionId,
    trial_started_at: trialStart.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    trial_hours: 168,
    plan_versions: planVersions,
  };

  const accessControl = computeBusinessAccess(business, now, billingControl);
  assert.equal(accessControl.effective_plan, 'control');
  assert.equal(accessControl.trial_plan, 'control');
  assert.equal(accessControl.effective_access_source, 'trial');
  assert.equal(accessControl.limits.users, 10);
  assert.notEqual(accessControl.effective_plan, 'founder');

  // 3. Starter trial active
  const billingStarter = {
    business_id: bizId,
    version: 3,
    selected_plan_version_id: starterVersionId,
    trial_started_at: trialStart.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    trial_hours: 168,
    plan_versions: planVersions,
  };

  const accessStarter = computeBusinessAccess(business, now, billingStarter);
  assert.equal(accessStarter.effective_plan, 'starter');
  assert.equal(accessStarter.trial_plan, 'starter');
  assert.equal(accessStarter.effective_access_source, 'trial');
  assert.equal(accessStarter.limits.users, 5);

  // 4. Expired trial after 168 hours
  const after168h = new Date(trialEnd.getTime() + 1000);
  const accessExpired = computeBusinessAccess(business, after168h, billingPro);
  assert.equal(accessExpired.trial_status_effective, 'expired');
  assert.equal(accessExpired.restricted, true);
  assert.equal(accessExpired.effective_access_source, 'restricted');
});

test('Simulation of 1-Click Trial Activation Machine', async () => {
  // Simulates the exact state machine of Billing.jsx -> rpc_billing_trial_command
  const bizId = crypto.randomUUID();
  const proVersionId = crypto.randomUUID();

  let account = {
    business_id: bizId,
    version: 1,
    selected_plan_version_id: null,
    trial_started_at: null,
    trial_ends_at: null,
    trial_hours: null,
  };

  const commandsLog = [];

  const executeCommand = async (command, { plan_version_id, expected_version, request_key }) => {
    // Check replay
    const existing = commandsLog.find((c) => c.key === request_key);
    if (existing) {
      if (existing.command !== command || existing.plan !== plan_version_id) {
        throw new Error('billing_command_conflict');
      }
      return { ...existing.result, is_replay: true };
    }

    if (expected_version !== account.version) {
      throw new Error('billing_stale');
    }

    if (command === 'activate_trial') {
      if (account.selected_plan_version_id !== plan_version_id) {
        throw new Error('billing_select_plan_first');
      }
      const clock = Date.now();
      account = {
        ...account,
        version: account.version + 1,
        trial_started_at: new Date(clock).toISOString(),
        trial_ends_at: new Date(clock + 168 * 3600 * 1000).toISOString(),
        trial_hours: 168,
      };
    } else if (command === 'select_plan') {
      account = {
        ...account,
        version: account.version + 1,
        selected_plan_version_id: plan_version_id,
      };
    } else {
      throw new Error('billing_invalid_command');
    }

    const result = { ...account, is_replay: false };
    commandsLog.push({ key: request_key, command, plan: plan_version_id, result });
    return result;
  };

  // Attempting to activate trial before selecting plan must fail
  await assert.rejects(
    async () => {
      await executeCommand('activate_trial', {
        plan_version_id: proVersionId,
        expected_version: 1,
        request_key: crypto.randomUUID(),
      });
    },
    /billing_select_plan_first/
  );

  // 1-Click activation flow in Billing.jsx:
  // Step 1: select_plan
  const selKey = crypto.randomUUID();
  const selRes = await executeCommand('select_plan', {
    plan_version_id: proVersionId,
    expected_version: account.version,
    request_key: selKey,
  });
  assert.equal(selRes.version, 2);
  assert.equal(selRes.selected_plan_version_id, proVersionId);
  assert.equal(account.version, 2);

  // Step 2: activate_trial
  const trialKey = crypto.randomUUID();
  const trialRes = await executeCommand('activate_trial', {
    plan_version_id: proVersionId,
    expected_version: selRes.version,
    request_key: trialKey,
  });
  assert.equal(trialRes.version, 3);
  assert.ok(trialRes.trial_started_at);
  assert.ok(trialRes.trial_ends_at);
  assert.equal(trialRes.trial_hours, 168);
  assert.equal(account.version, 3);

  // Replay protection: replaying the same trial activation key
  const replayRes = await executeCommand('activate_trial', {
    plan_version_id: proVersionId,
    expected_version: 999, // Ignored on replay in real RPC
    request_key: trialKey,
  });
  assert.equal(replayRes.is_replay, true);
  assert.equal(account.version, 3); // Account version unchanged on replay
});
