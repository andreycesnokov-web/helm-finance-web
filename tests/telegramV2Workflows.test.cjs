'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createTelegramPaidGate } = require('../server/lib/telegramPaidGate');

// Helper to construct a self-contained Express test server replicating the Telegram routes
function createTestTelegramServer({
  users = [],
  businesses = [],
  businessMembers = [],
  debts = [],
  userLinks = [],
  botSecret = 'test-bot-secret',
  getBusinessAccess,
}) {
  const app = express();
  app.use(express.json());

  // In-memory Supabase mock
  const supabase = {
    from(table) {
      return {
        select(cols) {
          return {
            eq(f1, v1) {
              const chain = {
                eq(f2, v2) {
                  return {
                    limit() {
                      const rows = (table === 'business_members' ? businessMembers : []).filter(
                        r => r[f1] === v1 && r[f2] === v2
                      );
                      return Promise.resolve({ data: rows, error: null });
                    },
                    single() {
                      const row = (table === 'business_members' ? businessMembers : []).find(
                        r => r[f1] === v1 && r[f2] === v2
                      );
                      return Promise.resolve({ data: row || null, error: row ? null : { message: 'not found' } });
                    },
                  };
                },
                order() {
                  return {
                    limit(n) {
                      const list = (table === 'businesses' ? businesses : []).filter(r => r[f1] === v1);
                      return Promise.resolve({ data: list.slice(0, n), error: null });
                    },
                  };
                },
                limit(n) {
                  let list = [];
                  if (table === 'users') list = users.filter(r => r[f1] === v1);
                  else if (table === 'businesses') list = businesses.filter(r => r[f1] === v1);
                  else if (table === 'business_members') list = businessMembers.filter(r => r[f1] === v1);
                  else if (table === 'debts') list = debts.filter(r => r[f1] === v1);
                  return Promise.resolve({ data: list.slice(0, n), error: null });
                },
                single() {
                  let row = null;
                  if (table === 'debts') row = debts.find(r => r[f1] === v1);
                  else if (table === 'businesses') row = businesses.find(r => r[f1] === v1);
                  return Promise.resolve({ data: row || null, error: row ? null : { message: 'not found' } });
                },
              };
              return chain;
            },
          };
        },
        insert(data) {
          return {
            select() {
              return {
                single() {
                  const item = Array.isArray(data) ? { ...data[0], id: debts.length + 1 } : { ...data, id: debts.length + 1 };
                  if (table === 'debts') debts.push(item);
                  return Promise.resolve({ data: item, error: null });
                },
              };
            },
          };
        },
        update(updates) {
          return {
            eq(field, val) {
              return {
                select() {
                  return {
                    single() {
                      let found = null;
                      if (table === 'debts') {
                        const idx = debts.findIndex(d => d[field] === val);
                        if (idx >= 0) {
                          debts[idx] = { ...debts[idx], ...updates };
                          found = debts[idx];
                        }
                      }
                      return Promise.resolve({ data: found, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const gate = createTelegramPaidGate({
    supabase,
    getBusinessAccess,
    computeBusinessAccess: () => ({ effective_plan: 'founder' }),
    isTelegramPaidGateEnabled: () => true,
    isCommercialBillingEnabled: () => true,
  });

  const requireBotSecret = (req) => req.headers['x-bot-secret'] === botSecret;

  // resolveBotApprover logic matching server/index.js
  async function resolveBotApprover(telegram_id, debtId) {
    const debt = debts.find(d => String(d.id) === String(debtId));
    if (!debt) return { error: 'not_found' };

    const businessId = debt.business_id;
    if (!businessId) return { error: 'forbidden' };

    // Find linked user
    const link = userLinks.find(l => String(l.telegram_id) === String(telegram_id));
    const userId = link ? link.user_id : Number(telegram_id);

    const mem = businessMembers.find(
      m => String(m.user_id) === String(userId) && m.business_id === businessId && m.status === 'active'
    );
    if (!mem) return { error: 'forbidden' };

    const commercialDenial = await gate(businessId, userId);
    if (commercialDenial) return { gateError: true, gate: commercialDenial, error: commercialDenial.error };

    return { debt, userId, role: mem.role };
  }

  // POST /api/debts/from-telegram
  app.post('/api/debts/from-telegram', async (req, res) => {
    if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });

    const { telegram_id, type, amount, currency = 'IDR', business_id, counterparty } = req.body;
    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
    if (!type || !['receivable', 'payable'].includes(type)) return res.status(400).json({ error: 'type must be receivable or payable' });
    if (!amount) return res.status(400).json({ error: 'amount required' });

    const link = userLinks.find(l => String(l.telegram_id) === String(telegram_id));
    const userId = link ? link.user_id : Number(telegram_id);
    const user = users.find(u => String(u.id) === String(userId));
    if (!user) {
      return res.status(403).json({ error: 'not_linked', message: 'Your Telegram is not linked to CFO AI.' });
    }

    let memberRole = null;
    let targetBusinessId = null;

    if (business_id) {
      const mem = businessMembers.find(
        m => String(m.user_id) === String(user.id) && m.business_id === business_id && m.status === 'active'
      );
      if (!mem) return res.status(403).json({ error: 'not_member', message: 'You are not a member of this business.' });
      memberRole = mem.role;
      targetBusinessId = mem.business_id;
    } else {
      const mems = businessMembers.filter(m => String(m.user_id) === String(user.id) && m.status === 'active');
      if (mems.length > 1) return res.status(409).json({ error: 'multiple_businesses' });
      if (mems.length === 1) {
        memberRole = mems[0].role;
        targetBusinessId = mems[0].business_id;
      }
    }

    if (!memberRole) {
      return res.status(403).json({ error: 'not_member', message: 'You are not a member of any business in CFO AI.' });
    }

    // Paid Gate check
    const gateDenial = await gate(targetBusinessId, user.id);
    if (gateDenial) return res.status(402).json(gateDenial);

    // Currency gate
    if (currency !== 'IDR') {
      return res.status(422).json({ error: 'currency_not_supported', message: 'Telegram entry is currently supported only for IDR.' });
    }

    const isPrivileged = ['owner', 'ceo', 'admin', 'cfo'].includes(memberRole);
    const newDebt = {
      id: debts.length + 1,
      business_id: targetBusinessId,
      user_id: user.id,
      type,
      counterparty: counterparty || 'Reimbursement',
      amount: Number(amount),
      currency,
      approval_status: isPrivileged ? 'approved' : 'pending_approval',
      status: 'open',
      source_channel: 'telegram',
    };
    debts.push(newDebt);
    res.json({ ok: true, debt: newDebt });
  });

  // POST /api/telegram/debts/:id/approve
  app.post('/api/telegram/debts/:id/approve', async (req, res) => {
    if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
    const { telegram_id } = req.body || {};
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found', message: 'Request not found.' });
    if (r.gateError) return res.status(402).json(r.gate);
    if (r.error) return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this request.' });

    const { debt, userId, role } = r;
    if (!['owner', 'ceo', 'admin', 'cfo'].includes(role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot approve requests.' });
    }
    if (debt.user_id === userId && !['owner', 'ceo'].includes(role)) {
      return res.status(403).json({ error: 'forbidden', message: 'You cannot approve your own submission.' });
    }

    if (debt.approval_status === 'rejected') {
      return res.status(409).json({ error: 'already_rejected', message: 'This request was already rejected.' });
    }

    debt.approval_status = 'approved';
    res.json({ ok: true, state: 'approved', debt });
  });

  // POST /api/telegram/debts/:id/reject
  app.post('/api/telegram/debts/:id/reject', async (req, res) => {
    if (!requireBotSecret(req)) return res.status(401).json({ error: 'Invalid bot credentials' });
    const { telegram_id } = req.body || {};
    const r = await resolveBotApprover(telegram_id, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found', message: 'Request not found.' });
    if (r.gateError) return res.status(402).json(r.gate);
    if (r.error) return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this request.' });

    const { debt, userId, role } = r;
    if (!['owner', 'ceo', 'admin', 'cfo'].includes(role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Your role cannot reject requests.' });
    }
    if (debt.user_id === userId && !['owner', 'ceo'].includes(role)) {
      return res.status(403).json({ error: 'forbidden', message: 'You cannot act on your own submission.' });
    }
    if (debt.approval_status === 'approved') {
      return res.status(409).json({ error: 'already_approved', message: 'This request was already approved.' });
    }

    debt.approval_status = 'rejected';
    res.json({ ok: true, state: 'rejected', debt });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const close = () => new Promise(res => server.close(res));
      resolve({ baseUrl, close, debts });
    });
  });
}

test('Active Pro trial: linked employee submits text expense and admin approves via Telegram', async () => {
  const BIZ_ID = 'biz-active-pro';
  const OWNER_ID = 1001;
  const EMPL_ID = 1002;
  const TG_EMPL = '90002';
  const TG_OWNER = '90001';

  const { baseUrl, close, debts } = await createTestTelegramServer({
    users: [{ id: OWNER_ID }, { id: EMPL_ID }],
    businesses: [{ id: BIZ_ID, name: 'Helm Indonesia', billing_policy: 'commercial_v2', owner_user_id: OWNER_ID }],
    businessMembers: [
      { business_id: BIZ_ID, user_id: OWNER_ID, role: 'owner', status: 'active' },
      { business_id: BIZ_ID, user_id: EMPL_ID, role: 'employee', status: 'active' },
    ],
    userLinks: [
      { telegram_id: TG_OWNER, user_id: OWNER_ID },
      { telegram_id: TG_EMPL, user_id: EMPL_ID },
    ],
    getBusinessAccess: async (actorId, bizId) => ({
      business: { id: BIZ_ID },
      access: { policy: 'commercial_v2', effective_plan: 'pro', restricted: false, trial_status_effective: 'active' },
    }),
  });

  try {
    // 1. Employee creates a text expense
    const res1 = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({
        telegram_id: TG_EMPL,
        type: 'payable',
        amount: 150000,
        currency: 'IDR',
        counterparty: 'Fuel Shell',
      }),
    });
    const body1 = await res1.json();

    assert.equal(res1.status, 200);
    assert.equal(body1.ok, true);
    assert.equal(body1.debt.amount, 150000);
    assert.equal(body1.debt.approval_status, 'pending_approval');
    assert.equal(debts.length, 1);

    // 2. Owner approves the expense via Telegram
    const res2 = await fetch(`${baseUrl}/api/telegram/debts/${debts[0].id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_OWNER }),
    });
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.equal(body2.ok, true);
    assert.equal(body2.state, 'approved');
    assert.equal(debts[0].approval_status, 'approved');
  } finally {
    await close();
  }
});

test('Expired trial: expense creation and debt approval are refused with 402 telegram_paid_plan_required', async () => {
  const BIZ_ID = 'biz-expired-trial';
  const OWNER_ID = 2001;
  const TG_OWNER = '90003';

  const { baseUrl, close } = await createTestTelegramServer({
    users: [{ id: OWNER_ID }],
    businesses: [{ id: BIZ_ID, name: 'Expired Co', billing_policy: 'commercial_v2', owner_user_id: OWNER_ID }],
    businessMembers: [{ business_id: BIZ_ID, user_id: OWNER_ID, role: 'owner', status: 'active' }],
    userLinks: [{ telegram_id: TG_OWNER, user_id: OWNER_ID }],
    debts: [{ id: 10, business_id: BIZ_ID, user_id: OWNER_ID, amount: 200000, approval_status: 'pending_approval' }],
    getBusinessAccess: async () => ({
      business: { id: BIZ_ID },
      access: { policy: 'commercial_v2', effective_plan: 'free', restricted: true, trial_status_effective: 'expired' },
    }),
  });

  try {
    // Attempt to create expense
    const res1 = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_OWNER, type: 'payable', amount: 50000, currency: 'IDR' }),
    });
    const body1 = await res1.json();

    assert.equal(res1.status, 402);
    assert.equal(body1.error, 'telegram_paid_plan_required');
    assert.ok(body1.message.includes('paid add-on'));

    // Attempt to approve existing debt
    const res2 = await fetch(`${baseUrl}/api/telegram/debts/10/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_OWNER }),
    });
    const body2 = await res2.json();

    assert.equal(res2.status, 402);
    assert.equal(body2.error, 'telegram_paid_plan_required');
  } finally {
    await close();
  }
});

test('Unauthorized user: unlinked Telegram account is rejected with 403 not_linked', async () => {
  const { baseUrl, close } = await createTestTelegramServer({
    users: [],
    businesses: [{ id: 'biz-1' }],
    businessMembers: [],
    userLinks: [],
    getBusinessAccess: async () => null,
  });

  try {
    const res = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: '999999', type: 'payable', amount: 50000, currency: 'IDR' }),
    });
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.error, 'not_linked');
  } finally {
    await close();
  }
});

test('Wrong-company access: user cannot create debts or approve across company boundaries', async () => {
  const BIZ_A = 'biz-alpha';
  const BIZ_B = 'biz-beta';
  const USER_A = 3001;
  const TG_A = '90004';
  const USER_B = 3002;
  const TG_B = '90005';

  const { baseUrl, close } = await createTestTelegramServer({
    users: [{ id: USER_A }, { id: USER_B }],
    businesses: [
      { id: BIZ_A, name: 'Alpha Co', billing_policy: 'commercial_v2', owner_user_id: USER_A },
      { id: BIZ_B, name: 'Beta Co', billing_policy: 'commercial_v2', owner_user_id: USER_B },
    ],
    businessMembers: [
      { business_id: BIZ_A, user_id: USER_A, role: 'owner', status: 'active' },
      { business_id: BIZ_B, user_id: USER_B, role: 'owner', status: 'active' },
    ],
    userLinks: [
      { telegram_id: TG_A, user_id: USER_A },
      { telegram_id: TG_B, user_id: USER_B },
    ],
    debts: [
      { id: 99, business_id: BIZ_B, user_id: USER_B, amount: 1000000, approval_status: 'pending_approval' },
    ],
    getBusinessAccess: async (actorId, bizId) => ({
      business: { id: bizId },
      access: { policy: 'commercial_v2', effective_plan: 'pro', restricted: false, trial_status_effective: 'active' },
    }),
  });

  try {
    // 1. User A attempts to submit an expense directly to Company B
    const res1 = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_A, type: 'payable', amount: 100000, currency: 'IDR', business_id: BIZ_B }),
    });
    const body1 = await res1.json();

    assert.equal(res1.status, 403);
    assert.equal(body1.error, 'not_member');

    // 2. User A attempts to approve Company B's debt
    const res2 = await fetch(`${baseUrl}/api/telegram/debts/99/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_A }),
    });
    const body2 = await res2.json();

    assert.equal(res2.status, 403);
    assert.equal(body2.error, 'forbidden');
  } finally {
    await close();
  }
});

test('Bot credentials: missing or invalid x-bot-secret returns 401', async () => {
  const { baseUrl, close } = await createTestTelegramServer({ getBusinessAccess: async () => null });

  try {
    const res = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'invalid-secret' },
      body: JSON.stringify({ telegram_id: '123' }),
    });
    const body = await res.json();

    assert.equal(res.status, 401);
    assert.equal(body.error, 'Invalid bot credentials');
  } finally {
    await close();
  }
});

test('Rejection workflow and duplicate action protection in Telegram', async () => {
  const BIZ_ID = 'biz-rejection-test';
  const OWNER_ID = 4001;
  const EMPL_ID = 4002;
  const TG_EMPL = '90010';
  const TG_OWNER = '90011';

  const { baseUrl, close, debts } = await createTestTelegramServer({
    users: [{ id: OWNER_ID }, { id: EMPL_ID }],
    businesses: [{ id: BIZ_ID, name: 'Rejection Co', billing_policy: 'commercial_v2', owner_user_id: OWNER_ID }],
    businessMembers: [
      { business_id: BIZ_ID, user_id: OWNER_ID, role: 'owner', status: 'active' },
      { business_id: BIZ_ID, user_id: EMPL_ID, role: 'employee', status: 'active' },
    ],
    userLinks: [
      { telegram_id: TG_OWNER, user_id: OWNER_ID },
      { telegram_id: TG_EMPL, user_id: EMPL_ID },
    ],
    getBusinessAccess: async () => ({
      business: { id: BIZ_ID },
      access: { policy: 'commercial_v2', effective_plan: 'pro', restricted: false, trial_status_effective: 'active' },
    }),
  });

  try {
    // 1. Employee submits expense
    const res1 = await fetch(`${baseUrl}/api/debts/from-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_EMPL, type: 'payable', amount: 75000, currency: 'IDR', counterparty: 'Taxi' }),
    });
    assert.equal(res1.status, 200);
    assert.equal(debts[0].approval_status, 'pending_approval');

    // 2. Owner rejects expense
    const res2 = await fetch(`${baseUrl}/api/telegram/debts/${debts[0].id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_OWNER, reason: 'Out of policy' }),
    });
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.state, 'rejected');
    assert.equal(debts[0].approval_status, 'rejected');

    // 3. Rejecting again or approving a rejected expense cannot flip state
    const res3 = await fetch(`${baseUrl}/api/telegram/debts/${debts[0].id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
      body: JSON.stringify({ telegram_id: TG_OWNER }),
    });
    assert.equal(res3.status, 409);
    const body3 = await res3.json();
    assert.equal(body3.error, 'already_rejected');
    assert.equal(debts[0].approval_status, 'rejected');
  } finally {
    await close();
  }
});
