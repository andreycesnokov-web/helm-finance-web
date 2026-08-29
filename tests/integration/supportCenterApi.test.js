// Support Center ENDPOINTS over real HTTP (migration 053).
//
// The assertions that matter: the flag hides the feature before any DB access, internal
// notes never reach a user, a business cannot read another's threads, and support
// correspondence mutates no financial table.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const JWT_SECRET = 'test-jwt-secret';
const FLAG = 'SUPPORT_CENTER_ENABLED';

const BIZ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BIZ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER_A = 7001, MEMBER_A = 7002, OWNER_B = 7004, LONER = 7005;   // LONER has no business
const ADMIN = -1;

const dbState = { businesses: [], business_members: [], users: [], wallets: [],
                  support_conversations: [], support_messages: [], support_escalations: [],
                  support_events: [], transactions: [], debts: [], incoming_payments: [],
                  payment_provider_credentials: [], audit_events: [] };
const dbTouches = { tables: [] };

function seed() {
  dbState.businesses = [
    { id: BIZ_A, type: 'business', owner_user_id: OWNER_A, created_at: '2026-01-01', name: 'Alpha', business_code: 'HF-BIZ-A', status: 'active' },
    { id: BIZ_B, type: 'business', owner_user_id: OWNER_B, created_at: '2026-01-02', name: 'Beta', business_code: 'HF-BIZ-B', status: 'active' },
  ];
  dbState.business_members = [
    { id: 'm1', user_id: OWNER_A, business_id: BIZ_A, role: 'owner', status: 'active' },
    { id: 'm2', user_id: MEMBER_A, business_id: BIZ_A, role: 'employee', status: 'active' },
    { id: 'm4', user_id: OWNER_B, business_id: BIZ_B, role: 'owner', status: 'active' },
    { id: 'm5', user_id: ADMIN, business_id: BIZ_A, role: 'owner', status: 'active' },
  ];
  dbState.users = [OWNER_A, MEMBER_A, OWNER_B, LONER, ADMIN].map(id => ({ id }));
  for (const t of ['support_conversations', 'support_messages', 'support_escalations',
                   'support_events', 'transactions', 'debts', 'incoming_payments',
                   'payment_provider_credentials', 'audit_events', 'wallets']) dbState[t] = [];
  dbTouches.tables = [];
}

function fakeFrom(table) {
  dbTouches.tables.push(table);
  const st = { filters: [], ins: [], single: false, maybeSingle: false, op: 'select',
               values: null, wantBiz: false, limit: null, cols: null };
  const rows = () => (dbState[table] = dbState[table] || []);
  const match = (r) => st.filters.every(([c, v]) => String(r[c]) === String(v))
    && st.ins.every(({ c, v }) => v.map(String).includes(String(r[c])));
  const embed = (list) => list.map(r => (st.wantBiz && table === 'business_members'
    ? { ...r, businesses: dbState.businesses.find(b => b.id === r.business_id) || null } : r));
  const project = (list) => (!st.cols ? list
    : list.map(r => Object.fromEntries(st.cols.filter(c => c in r).map(c => [c, r[c]]))));
  const q = {
    select(cols) {
      if (typeof cols !== 'string' || cols === '*') return q;
      if (cols.includes('(')) { if (cols.includes('businesses(')) st.wantBiz = true; return q; }
      st.cols = cols.split(',').map(c => c.trim()).filter(Boolean);
      return q;
    },
    eq(c, v) { st.filters.push([c, v]); return q; },
    in(c, v) { st.ins.push({ c, v }); return q; },
    or() { return q; }, order() { return q; },
    limit(n) { st.limit = n; return q; },
    single() { st.single = true; return q; },
    maybeSingle() { st.maybeSingle = true; return q; },
    insert(v) { st.op = 'insert'; st.values = v; return q; },
    update(v) { st.op = 'update'; st.values = v; return q; },
    then(resolve, reject) {
      let out;
      if (st.op === 'insert') {
        const arr = (Array.isArray(st.values) ? st.values : [st.values]).map(r => ({
          id: r.id || crypto.randomUUID(), created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(), ...r }));
        for (const r of arr) {
          rows().push(r);
          // Model 053's AFTER INSERT triggers so route behaviour is tested against the
          // schema's real side effects, not an idealised version of them.
          if (table === 'support_conversations') {
            dbState.support_events.push({ id: crypto.randomUUID(), conversation_id: r.id,
              business_id: r.business_id ?? null, actor_user_id: r.created_by_user_id,
              event_type: 'conversation_created', created_at: new Date().toISOString() });
          }
          if (table === 'support_messages') {
            const c = dbState.support_conversations.find(x => x.id === r.conversation_id);
            if (c) c.last_message_at = r.created_at;
            dbState.support_events.push({ id: crypto.randomUUID(), conversation_id: r.conversation_id,
              business_id: r.business_id ?? null, actor_user_id: r.sender_user_id ?? null,
              event_type: 'message_created', created_at: new Date().toISOString() });
          }
        }
        const p = project(arr);
        out = { data: st.single ? p[0] : p, error: null };
      } else if (st.op === 'update') {
        const hits = rows().filter(match);
        for (const r of hits) Object.assign(r, st.values, { updated_at: new Date().toISOString() });
        const p = project(hits);
        out = { data: st.single ? (p[0] || null) : p, error: null };
      } else {
        let list = embed(rows().filter(match));
        if (st.limit) list = list.slice(0, st.limit);
        list = project(list);
        out = (st.single || st.maybeSingle) ? { data: list[0] || null, error: null } : { data: list, error: null };
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return q;
}
const supabase = { from: fakeFrom, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} };

let server = null, BASE = null, jwt = null;
before(async () => {
  seed();
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true,
    exports: { ...real, createClient: () => supabase } };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k', BOT_TOKEN: 'b',
    JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: 's', PORT: '0',
    [FLAG]: 'true', ADMIN_TELEGRAM_IDS: String(ADMIN),
  });
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise(r => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { if (server) server.close(); });
beforeEach(() => { seed(); process.env[FLAG] = 'true'; });

const tok = (u) => jwt.sign({ userId: u }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { token, business, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (business) headers['x-business-id'] = business;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const CONV = '/api/support/conversations';
const open = (body = {}, biz = BIZ_A, user = OWNER_A) =>
  api('POST', CONV, { token: tok(user), business: biz, body: { subject: 'Help', ...body } });
const convs = () => dbState.support_conversations;
const msgs = () => dbState.support_messages;

// ── Flag ─────────────────────────────────────────────────────────────────────────────────
test('flag OFF: every support route is 404 and NO table is touched', async () => {
  process.env[FLAG] = 'false';
  dbTouches.tables = [];
  assert.strictEqual((await api('GET', CONV, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await open()).status, 404);
  assert.strictEqual((await api('GET', `${CONV}/x`, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('GET', `${CONV}/x/messages`, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('POST', `${CONV}/x/messages`, { token: tok(OWNER_A), business: BIZ_A, body: { body: 'hi' } })).status, 404);
  assert.strictEqual((await api('POST', `${CONV}/x/escalate`, { token: tok(OWNER_A), business: BIZ_A, body: { reason: 'r' } })).status, 404);
  assert.strictEqual((await api('PATCH', `${CONV}/x/close`, { token: tok(OWNER_A), business: BIZ_A })).status, 404);
  assert.strictEqual((await api('GET', '/api/admin/support/conversations', { token: tok(ADMIN) })).status, 404);
  assert.deepStrictEqual(dbTouches.tables, [], `DB touched with the flag off: ${dbTouches.tables}`);
  assert.strictEqual(convs().length, 0);
});

// ── Create / read ────────────────────────────────────────────────────────────────────────
test('a user opens a conversation with a first message', async () => {
  const r = await open({ message: 'My invoice looks wrong', category: 'billing' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.conversation.status, 'open');
  assert.strictEqual(r.body.conversation.category, 'billing');
  assert.strictEqual(r.body.conversation.business_id, BIZ_A);
  assert.strictEqual(msgs().length, 1);
  assert.strictEqual(msgs()[0].sender_type, 'user');
  assert.strictEqual(msgs()[0].is_internal, false);
});

test('a user with NO business can still open a conversation', async () => {
  // The person stuck in onboarding is exactly who needs support.
  const r = await api('POST', CONV, { token: tok(LONER), body: { subject: 'Cannot create a business' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.conversation.business_id, null);
});

test('the creator sees their thread; the list is scoped', async () => {
  await open({ subject: 'A-thread' }, BIZ_A, OWNER_A);
  await open({ subject: 'B-thread' }, BIZ_B, OWNER_B);
  const a = await api('GET', CONV, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(a.body.conversations.length, 1);
  assert.strictEqual(a.body.conversations[0].subject, 'A-thread');
});

test('a colleague in the same business sees the workspace thread', async () => {
  await open({ subject: 'Shared' }, BIZ_A, OWNER_A);
  const r = await api('GET', CONV, { token: tok(MEMBER_A), business: BIZ_A });
  assert.strictEqual(r.body.conversations.length, 1);
});

// ── Cross-business isolation ─────────────────────────────────────────────────────────────
test('another business cannot read, reply to, escalate or close this thread', async () => {
  const id = (await open({ message: 'private' }, BIZ_A, OWNER_A)).body.conversation.id;
  const asB = { token: tok(OWNER_B), business: BIZ_B };
  assert.strictEqual((await api('GET', `${CONV}/${id}`, asB)).status, 404);
  assert.strictEqual((await api('GET', `${CONV}/${id}/messages`, asB)).status, 404);
  assert.strictEqual((await api('POST', `${CONV}/${id}/messages`, { ...asB, body: { body: 'intrusion' } })).status, 404);
  assert.strictEqual((await api('POST', `${CONV}/${id}/escalate`, { ...asB, body: { reason: 'x' } })).status, 404);
  assert.strictEqual((await api('PATCH', `${CONV}/${id}/close`, asB)).status, 404);
  assert.strictEqual(msgs().length, 1, 'another business appended to the thread');
});

test('an unrelated user with no business cannot see a business thread', async () => {
  const id = (await open({}, BIZ_A, OWNER_A)).body.conversation.id;
  assert.strictEqual((await api('GET', `${CONV}/${id}`, { token: tok(LONER) })).status, 404);
});

// ── Messages ─────────────────────────────────────────────────────────────────────────────
test('a user replies and reads the thread back', async () => {
  const id = (await open({ message: 'first' })).body.conversation.id;
  const r = await api('POST', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A, body: { body: 'second' } });
  assert.strictEqual(r.status, 201);
  const list = await api('GET', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A });
  assert.deepStrictEqual(list.body.messages.map(m => m.body), ['first', 'second']);
});

test('a blank or oversized message is refused', async () => {
  const id = (await open()).body.conversation.id;
  const send = (body) => api('POST', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A, body });
  assert.strictEqual((await send({ body: '   ' })).status, 400);
  assert.strictEqual((await send({})).status, 400);
  assert.strictEqual((await send({ body: 'x'.repeat(10001) })).status, 400);
});

// ── Internal notes are invisible to the user ─────────────────────────────────────────────
test('an internal note is HIDDEN from the user thread but visible to admin', async () => {
  const id = (await open({ message: 'customer question' })).body.conversation.id;
  const note = await api('POST', `/api/admin/support/conversations/${id}/internal-note`,
    { token: tok(ADMIN), body: { body: 'STAFF ONLY: check their plan' } });
  assert.strictEqual(note.status, 201);
  assert.strictEqual(note.body.message.is_internal, true);

  const userView = await api('GET', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(userView.body.messages.length, 1, 'the internal note leaked to the user');
  assert.ok(!JSON.stringify(userView.body).includes('STAFF ONLY'), 'internal text reached the user');

  const adminView = await api('GET', `/api/admin/support/conversations/${id}`, { token: tok(ADMIN) });
  assert.strictEqual(adminView.body.messages.length, 2);
  assert.ok(JSON.stringify(adminView.body).includes('STAFF ONLY'));
});

test('a user cannot smuggle is_internal into their own message', async () => {
  const id = (await open()).body.conversation.id;
  const r = await api('POST', `${CONV}/${id}/messages`,
    { token: tok(OWNER_A), business: BIZ_A, body: { body: 'hidden?', is_internal: true } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'internal_not_allowed');
});

// ── Escalation ───────────────────────────────────────────────────────────────────────────
test('escalating creates a row and marks the thread human_needed', async () => {
  const id = (await open({ message: 'help' })).body.conversation.id;
  const r = await api('POST', `${CONV}/${id}/escalate`,
    { token: tok(OWNER_A), business: BIZ_A, body: { reason: 'AI did not understand' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(dbState.support_escalations.length, 1);
  assert.strictEqual(dbState.support_escalations[0].status, 'open');
  assert.strictEqual(dbState.support_escalations[0].requested_by, 'user');
  assert.strictEqual(convs().find(c => c.id === id).status, 'human_needed');
});

test('an escalation without a reason is refused', async () => {
  const id = (await open()).body.conversation.id;
  const r = await api('POST', `${CONV}/${id}/escalate`, { token: tok(OWNER_A), business: BIZ_A, body: {} });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(dbState.support_escalations.length, 0);
});

// ── Close ────────────────────────────────────────────────────────────────────────────────
test('closing stamps closed_at, and a closed thread refuses new messages', async () => {
  const id = (await open()).body.conversation.id;
  const r = await api('PATCH', `${CONV}/${id}/close`, { token: tok(OWNER_A), business: BIZ_A });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.conversation.status, 'closed');
  assert.ok(r.body.conversation.closed_at);

  const reply = await api('POST', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A, body: { body: 'more' } });
  assert.strictEqual(reply.status, 409);
  assert.strictEqual((await api('PATCH', `${CONV}/${id}/close`, { token: tok(OWNER_A), business: BIZ_A })).status, 409);
});

// ── Validation of creation input ─────────────────────────────────────────────────────────
test('a user cannot self-assign urgent priority or a non-in_app channel', async () => {
  assert.strictEqual((await open({ priority: 'urgent' })).body.error, 'priority_not_settable');
  assert.strictEqual((await open({ channel: 'admin_created' })).body.error, 'invalid_channel');
  assert.strictEqual((await open({ category: 'nonsense' })).body.error, 'invalid_category');
  assert.strictEqual(convs().length, 0);
});

// ── Admin ────────────────────────────────────────────────────────────────────────────────
test('admin sees conversations across businesses, with names resolved', async () => {
  await open({ subject: 'A' }, BIZ_A, OWNER_A);
  await open({ subject: 'B' }, BIZ_B, OWNER_B);
  const r = await api('GET', '/api/admin/support/conversations', { token: tok(ADMIN) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.conversations.length, 2);
  assert.ok(r.body.conversations.some(c => c.business_name === 'Alpha'));
});

test('admin filters are validated, not silently ignored', async () => {
  const q = (s) => api('GET', `/api/admin/support/conversations?${s}`, { token: tok(ADMIN) });
  assert.strictEqual((await q('status=nonsense')).status, 400);
  assert.strictEqual((await q('priority=critical')).status, 400);
  assert.strictEqual((await q('category=random')).status, 400);
  assert.strictEqual((await q('status=open')).status, 200);
});

test('admin can assign and change status', async () => {
  const id = (await open()).body.conversation.id;
  const a = await api('PATCH', `/api/admin/support/conversations/${id}/assign`,
    { token: tok(ADMIN), body: { assigned_to_user_id: ADMIN } });
  assert.strictEqual(a.body.conversation.assigned_to_user_id, ADMIN);
  assert.strictEqual(a.body.conversation.status, 'assigned');

  const s = await api('PATCH', `/api/admin/support/conversations/${id}/status`,
    { token: tok(ADMIN), body: { status: 'waiting_user' } });
  assert.strictEqual(s.body.conversation.status, 'waiting_user');
});

test('admin closing writes closed_at, and reopening clears it', async () => {
  const id = (await open()).body.conversation.id;
  const st = (status) => api('PATCH', `/api/admin/support/conversations/${id}/status`, { token: tok(ADMIN), body: { status } });
  assert.ok((await st('closed')).body.conversation.closed_at);
  assert.strictEqual((await st('open')).body.conversation.closed_at, null);
});

test('a non-admin cannot reach any admin support route', async () => {
  const id = (await open()).body.conversation.id;
  for (const [m, p, b] of [['GET', '/api/admin/support/conversations', undefined],
                           ['GET', `/api/admin/support/conversations/${id}`, undefined],
                           ['PATCH', `/api/admin/support/conversations/${id}/assign`, { assigned_to_user_id: null }],
                           ['PATCH', `/api/admin/support/conversations/${id}/status`, { status: 'open' }],
                           ['POST', `/api/admin/support/conversations/${id}/internal-note`, { body: 'x' }]]) {
    const r = await api(m, p, { token: tok(OWNER_A), business: BIZ_A, body: b });
    assert.ok([401, 403].includes(r.status), `${m} ${p} gave ${r.status}`);
  }
});

// ── Financial safety ─────────────────────────────────────────────────────────────────────
test('THE core guarantee: support correspondence mutates no financial table', async () => {
  const id = (await open({ message: 'my payment is missing' })).body.conversation.id;
  await api('POST', `${CONV}/${id}/messages`, { token: tok(OWNER_A), business: BIZ_A, body: { body: 'still missing' } });
  await api('POST', `${CONV}/${id}/escalate`, { token: tok(OWNER_A), business: BIZ_A, body: { reason: 'urgent' } });
  await api('POST', `/api/admin/support/conversations/${id}/internal-note`, { token: tok(ADMIN), body: { body: 'note' } });
  await api('PATCH', `${CONV}/${id}/close`, { token: tok(OWNER_A), business: BIZ_A });

  for (const t of ['transactions', 'debts', 'incoming_payments', 'wallets', 'payment_provider_credentials']) {
    assert.strictEqual(dbState[t].length, 0, `support mutated ${t}`);
  }
});

test('the timeline records the thread lifecycle', async () => {
  const id = (await open({ message: 'hi' })).body.conversation.id;
  await api('POST', `${CONV}/${id}/escalate`, { token: tok(OWNER_A), business: BIZ_A, body: { reason: 'r' } });
  await api('PATCH', `${CONV}/${id}/close`, { token: tok(OWNER_A), business: BIZ_A });
  const types = dbState.support_events.filter(e => e.conversation_id === id).map(e => e.event_type);
  assert.ok(types.includes('conversation_created'));
  assert.ok(types.includes('message_created'));
  assert.ok(types.includes('escalation_requested'));
  assert.ok(types.includes('conversation_closed'));
});

test('opening a support thread NEVER provisions a business or starts a trial', async () => {
  // resolveActiveBusiness falls back to ensureDefaultBusiness, which for a legacy
  // positive-id user with no workspace CREATES a business with a 7-day trial. Contacting
  // support must never have that side effect, so support resolves its business context
  // read-only. LONER (7005) is a positive id with no membership - the exact trigger case.
  const before = dbState.businesses.length;
  const r = await api('POST', CONV, { token: tok(LONER), body: { subject: 'stuck' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.conversation.business_id, null);
  assert.strictEqual(dbState.businesses.length, before, 'a business was auto-created by support');
  assert.strictEqual(dbState.business_members.filter(m => m.user_id === LONER).length, 0);
});
