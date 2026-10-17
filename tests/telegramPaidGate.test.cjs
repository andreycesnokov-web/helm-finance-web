'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramPaidGate } = require('../server/lib/telegramPaidGate');

// Helper to create mock Supabase client
function createMockSupabase(businessRow) {
  return {
    from(table) {
      assert.equal(table, 'businesses');
      return {
        select() {
          return {
            eq(field, val) {
              assert.equal(field, 'id');
              return {
                limit() {
                  return Promise.resolve({
                    data: businessRow && businessRow.id === val ? [businessRow] : [],
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

test('commercial V2 with active Pro trial passes telegram paid gate', async () => {
  const business = {
    id: 'biz-v2-pro',
    name: 'PT Pro Trial',
    billing_policy: 'commercial_v2',
    owner_user_id: 101,
  };

  const getBusinessAccess = async (actorId, bizId) => {
    assert.equal(bizId, business.id);
    return {
      business,
      access: {
        policy: 'commercial_v2',
        effective_plan: 'pro',
        restricted: false,
        trial_status_effective: 'active',
        daysLeft: 7,
      },
    };
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess,
    computeBusinessAccess: () => assert.fail('should not call legacy computeBusinessAccess for commercial_v2'),
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate(business.id, 101);
  assert.equal(res, null, 'Active Pro trial must be allowed');
});

test('commercial V2 with expired trial returns 402 telegram_paid_plan_required', async () => {
  const business = {
    id: 'biz-v2-expired',
    name: 'PT Expired',
    billing_policy: 'commercial_v2',
    owner_user_id: 102,
  };

  const getBusinessAccess = async (actorId, bizId) => {
    assert.equal(bizId, business.id);
    return {
      business,
      access: {
        policy: 'commercial_v2',
        effective_plan: 'free',
        restricted: true,
        trial_status_effective: 'expired',
        daysLeft: 0,
      },
    };
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess,
    computeBusinessAccess: () => assert.fail('should not call legacy resolver'),
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate(business.id, 102);
  assert.notEqual(res, null);
  assert.equal(res.error, 'telegram_paid_plan_required');
  assert.ok(res.message.includes('paid add-on'));
  assert.equal(res.upgrade_url, 'https://app.cfo-ai.site/business/settings');
});

test('commercial V2 with active paid subscription passes telegram paid gate', async () => {
  const business = {
    id: 'biz-v2-paid',
    name: 'PT Paid Subscription',
    billing_policy: 'commercial_v2',
    owner_user_id: 103,
  };

  const getBusinessAccess = async () => ({
    business,
    access: {
      policy: 'commercial_v2',
      effective_plan: 'control',
      restricted: false,
      subscription_active: true,
      subscription_status: 'active',
    },
  });

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess,
    computeBusinessAccess: () => assert.fail('legacy resolver should not be called'),
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate(business.id, 103);
  assert.equal(res, null, 'Active commercial subscription must be allowed');
});

test('commercial V2 with active admin override grant passes telegram paid gate', async () => {
  const business = {
    id: 'biz-v2-grant',
    name: 'PT Admin Grant',
    billing_policy: 'commercial_v2',
    owner_user_id: 104,
  };

  const getBusinessAccess = async () => ({
    business,
    access: {
      policy: 'commercial_v2',
      effective_plan: 'pro',
      restricted: false,
      effective_access_source: 'admin_override',
      override_active: true,
    },
  });

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess,
    computeBusinessAccess: () => assert.fail('legacy resolver should not be called'),
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate(business.id, 104);
  assert.equal(res, null, 'Active admin grant must be allowed');
});

test('commercial V2 falls back to owner_user_id if actor has no access row', async () => {
  const business = {
    id: 'biz-v2-fallback',
    name: 'PT Fallback',
    billing_policy: 'commercial_v2',
    owner_user_id: 100,
  };

  let calledWith = [];
  const getBusinessAccess = async (actorId) => {
    calledWith.push(actorId);
    if (actorId === 999) return null; // non-owner actor lookup failed
    if (actorId === 100) {
      return {
        business,
        access: {
          policy: 'commercial_v2',
          effective_plan: 'pro',
          restricted: false,
          trial_status_effective: 'active',
        },
      };
    }
    return null;
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess,
    computeBusinessAccess: () => {},
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate(business.id, 999);
  assert.equal(res, null, 'Should fallback to owner and allow');
  assert.deepEqual(calledWith, [999, 100]);
});

test('legacy company with paid gate OFF is allowed regardless of plan', async () => {
  const business = {
    id: 'biz-legacy-free',
    name: 'Legacy Free',
    billing_policy: 'legacy',
    plan: 'free',
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess: () => assert.fail('should not call commercial getBusinessAccess'),
    computeBusinessAccess: () => ({ effective_plan: 'free' }),
    isTelegramPaidGateEnabled: () => false,
    isCommercialBillingEnabled: () => false,
  });

  const res = await gate(business.id);
  assert.equal(res, null, 'Gate OFF must allow legacy companies');
});

test('legacy company on free plan with paid gate ON is refused', async () => {
  const business = {
    id: 'biz-legacy-free-gated',
    name: 'Legacy Free Gated',
    billing_policy: 'legacy',
    plan: 'free',
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess: () => assert.fail('should not call commercial getBusinessAccess'),
    computeBusinessAccess: () => ({ effective_plan: 'free' }),
    isTelegramPaidGateEnabled: () => true,
    isCommercialBillingEnabled: () => false,
  });

  const res = await gate(business.id);
  assert.notEqual(res, null);
  assert.equal(res.error, 'telegram_paid_plan_required');
});

test('legacy company on paid/founder plan with paid gate ON is allowed', async () => {
  const business = {
    id: 'biz-legacy-founder',
    name: 'Legacy Founder',
    billing_policy: 'legacy',
    plan: 'founder',
  };

  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(business),
    getBusinessAccess: () => assert.fail('should not call commercial getBusinessAccess'),
    computeBusinessAccess: () => ({ effective_plan: 'founder' }),
    isTelegramPaidGateEnabled: () => true,
    isCommercialBillingEnabled: () => false,
  });

  const res = await gate(business.id);
  assert.equal(res, null, 'Legacy founder plan must pass paid gate');
});

test('non-existent business returns null to let route return 404', async () => {
  const gate = createTelegramPaidGate({
    supabase: createMockSupabase(null),
    getBusinessAccess: () => assert.fail('should not call getBusinessAccess'),
    computeBusinessAccess: () => assert.fail('should not call computeBusinessAccess'),
    isTelegramPaidGateEnabled: () => true,
    isCommercialBillingEnabled: () => true,
  });

  const res = await gate('missing-id');
  assert.equal(res, null);
});
