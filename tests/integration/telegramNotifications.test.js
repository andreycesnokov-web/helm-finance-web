// PR2.6 — who receives an outbound Telegram message, and at which chat id.
//
// THE PROPERTY THIS FILE EXISTS FOR
// ---------------------------------
// No negative number may ever appear as a Telegram chat_id. Not with a flag on, not with a
// flag off, not on a resolver error, not as a fallback. Telegram reads a negative chat id as a
// GROUP, so the failure being prevented is not "the message is not delivered" — it is "a
// business's amounts, counterparties and approval buttons are delivered to an unrelated chat",
// behind a 200 response that looks like success.
//
// Two comments in server/index.js used to state the assumption behind that bug outright:
// "users.id IS the Telegram chat id". True while every account came from Telegram; migration
// 042 gave email-origin accounts negative ids and made it false.
//
// Every outbound fetch is captured, and the strongest assertion here is not per-scenario — it
// is the sweep at the end of this file, which replays every combination and asserts that no
// captured chat_id was ever negative or malformed.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const N = require('../../server/lib/telegramNotifications');

const NOTIFY_FLAG = 'TELEGRAM_NOTIFY_REVERSE_RESOLVER_ENABLED';
const SECRET = 'test-bot-secret';
const JWT_SECRET = 'test-jwt-secret';
const TG_USER = 1057134807;      // positive: legacy Telegram-origin
const TG_OTHER = 777000111;      // another legacy user
const EMAIL_USER = -42;          // negative: email-origin (042)
const EMAIL_USER2 = -43;
const EXTERNAL = '555000222';    // the Telegram account linked to EMAIL_USER
const BIZ = '11111111-1111-1111-1111-111111111111';

// ── fake Supabase ───────────────────────────────────────────────────────────
const scenario = { rows: {}, failTables: new Set() };
function reset() {
  scenario.rows = {
    business_members: [],
    users: [{ id: TG_USER, first_name: 'Leg', username: 'leg', language: 'en' }],
    user_channel_links: [],
    businesses: [{ id: BIZ, owner_user_id: TG_USER, name: 'Acme', type: 'business', status: 'active' }],
    debts: [],
    compliance_events: [],
  };
  scenario.failTables = new Set();
  sends.length = 0;
}
const link = (userId, externalId, revokedAt = null) =>
  ({ channel: 'telegram', external_user_id: String(externalId), user_id: userId, revoked_at: revokedAt });
// The membership row as the business resolver reads it: it selects businesses(*) as an
// embedded object, so a row without it resolves to a 500 rather than a workspace.
const bizRow = (owner) => ({ id: BIZ, owner_user_id: owner, name: 'Acme', type: 'business', status: 'active' });
// `owner` is explicit because the admin fan-out starts from businesses.owner_user_id: a test
// that means "this workspace is owned by an unreachable user" must not silently inherit a
// reachable one.
const member = (userId, role = 'admin', owner = TG_USER) =>
  ({ user_id: userId, business_id: BIZ, role, status: 'active',
     telegram_connected_at: '2026-01-01T00:00:00Z', businesses: bizRow(owner) });

function match(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'in') return val.map(String).includes(String(v));
    return true;
  });
}
function fakeFrom(table) {
  const filters = [];
  let limit = null, op = 'select';
  const q = {
    select() { return q; },
    eq(c, v) { filters.push(['eq', c, v]); return q; },
    in(c, v) { filters.push(['in', c, v]); return q; },
    is() { return q; }, neq() { return q; }, not() { return q; }, or() { return q; }, order() { return q; },
    limit(n) { limit = n; return q; },
    single() { q._single = true; return q; },
    maybeSingle() { q._single = true; return q; },
    insert(v) { op = 'insert'; q._values = v; return q; },
    update(v) { op = 'update'; q._values = v; return q; },
    upsert(v) { op = 'upsert'; q._values = v; return q; },
    then(resolve, reject) {
      let out;
      if (scenario.failTables.has(table)) {
        out = { data: null, error: { message: `simulated ${table} failure` } };
      } else if (op !== 'select') {
        // Return the row as PostgREST would for .update(...).select().single(), merged with
        // the values written. Without this the creator-notification tests would pass by
        // silently skipping the notification instead of by exercising it.
        const hit = (scenario.rows[table] || []).find((r) => match(r, filters));
        out = { data: q._single ? { ...(hit || {}), ...(q._values || {}) } : [], error: null };
      } else {
        let rows = (scenario.rows[table] || []).filter((r) => match(r, filters));
        if (limit) rows = rows.slice(0, limit);
        out = q._single ? { data: rows[0] || null, error: null } : { data: rows, error: null };
      }
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return q;
}
const supabase = { from: fakeFrom, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) }, auth: {} };

// ── captured Telegram traffic ───────────────────────────────────────────────
// Every sendMessage the server attempts, so a test can ask "what actually went on the wire"
// rather than "what did the function return".
const sends = [];
const realFetch = globalThis.fetch;
function installFetchTrap() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      let body = null;
      try { body = JSON.parse(init?.body || '{}'); } catch { /* ignore */ }
      sends.push({ url: u, body });
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
    }
    return realFetch(url, init);
  };
}

// ── flags ───────────────────────────────────────────────────────────────────
const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
async function withNotify(value, fn) {
  const prev = process.env[NOTIFY_FLAG];
  set(NOTIFY_FLAG, value);
  try { return await fn(); } finally { set(NOTIFY_FLAG, prev); }
}
const OFF = (fn) => withNotify(undefined, fn);
const ON = (fn) => withNotify('true', fn);

const resolveMany = (userIds, opts = {}) =>
  N.resolveTelegramNotificationRecipients({ supabase, userIds, reason: 'test', ...opts });

// ── the real server ─────────────────────────────────────────────────────────
let server = null, BASE = null, jwt = null;

before(async () => {
  const supaPath = require.resolve('@supabase/supabase-js');
  const real = require('@supabase/supabase-js');
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true, exports: { ...real, createClient: () => supabase },
  };
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'k',
    BOT_TOKEN: 'test-bot-token', JWT_SECRET, TELEGRAM_WEBHOOK_SECRET: SECRET, PORT: '0',
  });
  delete process.env[NOTIFY_FLAG];
  delete process.env.TELEGRAM_CHANNEL_IDENTITY_RESOLVER_ENABLED;
  delete process.env.TELEGRAM_ACTIVE_WORKSPACE_STATE_ENABLED;

  installFetchTrap();
  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patched(...a) { server = this; return realListen.apply(this, a); };
  try { require('../../server/index.js'); } finally { http.Server.prototype.listen = realListen; }
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jwt = require('jsonwebtoken');
});
after(() => { globalThis.fetch = realFetch; if (server) server.close(); });

const tok = (userId) => jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
async function api(method, path, { body, token, biz, secret } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (biz) headers['x-business-id'] = biz;
  if (secret) headers['x-bot-secret'] = secret;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}
const chatIdsSent = () => sends.map((s) => s.body?.chat_id);

// ════════════════════════════════════════════════════════════════════════════
// THE GUARD — unconditional, outside every flag
// ════════════════════════════════════════════════════════════════════════════

test('isSendableChatId refuses everything that is not a positive Telegram id', () => {
  for (const ok of [TG_USER, String(TG_USER), '555000222', 1]) {
    assert.strictEqual(N.isSendableChatId(ok), true, `rejected a valid id: ${ok}`);
  }
  for (const bad of [-42, '-42', 0, '0', '', ' ', null, undefined, NaN, 1.5, '007', 'abc',
                     '12a', [], {}, ['555000222'], true, '  555000222  ']) {
    assert.strictEqual(N.isSendableChatId(bad), false, `accepted an invalid id: ${JSON.stringify(bad)}`);
  }
});

test('the notify flag defaults OFF and accepts only the exact string "true"', async () => {
  await OFF(() => assert.strictEqual(N.isNotifyResolverEnabled(), false));
  for (const v of ['1', 'yes', 'TRUE', 'on', '', 'false']) {
    await withNotify(v, () => assert.strictEqual(N.isNotifyResolverEnabled(), false, `accepted ${JSON.stringify(v)}`));
  }
  await ON(() => assert.strictEqual(N.isNotifyResolverEnabled(), true));
});

// ════════════════════════════════════════════════════════════════════════════
// RECIPIENT RESOLUTION
// ════════════════════════════════════════════════════════════════════════════

test('OFF: a positive user keeps its legacy chat id', async () => {
  reset();
  await OFF(async () => {
    const r = await resolveMany([TG_USER]);
    assert.deepStrictEqual(r.chatIds, [String(TG_USER)]);
    assert.strictEqual(r.recipients[0].via, 'legacy');
    assert.deepStrictEqual(r.dropped, []);
  });
});

test('OFF: a negative user is DROPPED — this is the unconditional guard', async () => {
  // With the flag off no link table is consulted, so there is no way for a negative id to
  // become a chat id. The old code sent it anyway.
  reset();
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];   // even with a link on file
  await OFF(async () => {
    const r = await resolveMany([EMAIL_USER]);
    assert.deepStrictEqual(r.chatIds, [], 'a negative id produced a chat id');
    assert.strictEqual(r.dropped[0].reason, 'negative_user_id_unresolvable');
    assert.ok(!r.chatIds.includes(String(EMAIL_USER)));
  });
});

test('ON: a linked negative user resolves to its external id', async () => {
  reset();
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];
  await ON(async () => {
    const r = await resolveMany([EMAIL_USER]);
    assert.deepStrictEqual(r.chatIds, [EXTERNAL]);
    assert.strictEqual(r.recipients[0].via, 'link');
    assert.strictEqual(r.recipients[0].userId, EMAIL_USER);
  });
});

test('ON: a revoked link receives nothing — and never falls back', async () => {
  // A withdrawn link is a decision. Falling back to a legacy id would quietly undo it.
  reset();
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL, '2026-01-01T00:00:00Z')];
  await ON(async () => {
    const r = await resolveMany([EMAIL_USER]);
    assert.deepStrictEqual(r.chatIds, []);
    assert.strictEqual(r.dropped[0].reason, 'link_revoked');
  });
});

test('ON: an unlinked negative user receives nothing', async () => {
  reset();
  await ON(async () => {
    const r = await resolveMany([EMAIL_USER]);
    assert.deepStrictEqual(r.chatIds, []);
    assert.strictEqual(r.dropped[0].reason, 'not_linked');
  });
});

test('ON: a resolver error DROPS the recipient — no raw fallback', async () => {
  // The single most important error case. "We could not look it up" is not permission to guess
  // a chat id, and the id we would guess is exactly the dangerous one.
  reset();
  scenario.failTables.add('user_channel_links');
  await ON(async () => {
    for (const uid of [EMAIL_USER, TG_USER]) {
      const r = await resolveMany([uid]);
      assert.deepStrictEqual(r.chatIds, [], `a lookup failure still produced a chat id for ${uid}`);
      assert.strictEqual(r.dropped[0].reason, 'identity_lookup_failed');
    }
  });
});

test('ON: a positive legacy user still resolves, preserving today behaviour', async () => {
  reset();
  await ON(async () => {
    const r = await resolveMany([TG_USER]);
    assert.deepStrictEqual(r.chatIds, [String(TG_USER)]);
    assert.strictEqual(r.recipients[0].via, 'legacy');
  });
});

test('ON: allowLegacy:false restricts delivery to explicit links only', async () => {
  reset();
  await ON(async () => {
    const r = await resolveMany([TG_USER], { allowLegacy: false });
    assert.deepStrictEqual(r.chatIds, []);
    assert.strictEqual(r.dropped[0].reason, 'legacy_not_allowed');
  });
});

test('de-dupe happens AFTER resolution, on the external id', async () => {
  // The migration-window collision: legacy user 1057134807, and an email-origin user linked to
  // that same Telegram account. De-duping on user ids would message that person twice.
  reset();
  scenario.rows.user_channel_links = [link(EMAIL_USER, TG_USER)];
  await ON(async () => {
    const r = await resolveMany([TG_USER, EMAIL_USER]);
    assert.deepStrictEqual(r.chatIds, [String(TG_USER)], 'the same Telegram account was messaged twice');
    assert.strictEqual(r.recipients.length, 1);
  });
});

test('duplicate and malformed input ids are handled without producing sends', async () => {
  reset();
  await OFF(async () => {
    const r = await resolveMany([TG_USER, TG_USER, null, undefined, 0, 'abc', {}, NaN]);
    assert.deepStrictEqual(r.chatIds, [String(TG_USER)]);
    assert.ok(r.dropped.every((d) => d.reason === 'invalid_user_id'));
  });
});

test('a mixed audience delivers to exactly the reachable members', async () => {
  reset();
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL), link(EMAIL_USER2, '999000333', '2026-01-01T00:00:00Z')];
  await ON(async () => {
    const r = await resolveMany([TG_USER, EMAIL_USER, EMAIL_USER2, TG_OTHER]);
    assert.deepStrictEqual(r.chatIds.sort(), [String(TG_OTHER), String(TG_USER), EXTERNAL].sort());
    assert.deepStrictEqual(r.dropped.map((d) => d.reason), ['link_revoked']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEND SITE 1 — notifyBusinessAdminsViaTelegram, over real HTTP
// ════════════════════════════════════════════════════════════════════════════

const remind = (userId) => api('POST', '/api/accountant/calendar/remind',
  { token: tok(userId), biz: BIZ, body: {} });

test('admins: a negative member without a link is not notified', async () => {
  reset();
  scenario.rows.business_members = [member(TG_USER, 'owner'), member(EMAIL_USER, 'admin')];
  scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
  await OFF(async () => {
    const r = await remind(TG_USER);
    assert.strictEqual(r.status, 200);
    assert.ok(!chatIdsSent().includes(EMAIL_USER), 'a negative id was sent to Telegram');
    assert.ok(!chatIdsSent().includes(String(EMAIL_USER)));
    assert.ok(chatIdsSent().includes(String(TG_USER)), 'the legacy admin should still be reached');
  });
});

test('admins: a linked negative member IS notified, via the external id', async () => {
  reset();
  scenario.rows.business_members = [member(TG_USER, 'owner'), member(EMAIL_USER, 'admin')];
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];
  scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
  await ON(async () => {
    await remind(TG_USER);
    assert.ok(chatIdsSent().includes(EXTERNAL), 'the linked member was not reached at their external id');
  });
});

test('admins: a resolver DB error drops the member without a raw fallback', async () => {
  reset();
  scenario.rows.business_members = [member(TG_USER, 'owner'), member(EMAIL_USER, 'admin')];
  scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
  await ON(async () => {
    scenario.failTables.add('user_channel_links');
    const r = await remind(TG_USER);
    assert.strictEqual(r.status, 200, 'a notification failure must not fail the route');
    assert.deepStrictEqual(chatIdsSent(), [], 'a lookup failure still produced a send');
  });
});

test('admins: no financial payload is built for an unreachable recipient', async () => {
  // Not merely "not delivered" — nothing addressed to them exists at all.
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner', EMAIL_USER)];
  scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
  await ON(async () => {
    const r = await remind(EMAIL_USER);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.sent, 0, 'reported a send that did not happen');
    assert.deepStrictEqual(sends, [], 'a payload was constructed for an unreachable recipient');
  });
});

test('admins: with zero reachable recipients the route still succeeds', async () => {
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner', EMAIL_USER)];
  scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
  await ON(async () => {
    const r = await remind(EMAIL_USER);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SEND SITE 3 — the CEO test notification, where delivery IS the operation
// ════════════════════════════════════════════════════════════════════════════

const ceoTest = (userId) => api('POST', '/api/team/onboarding/test-ceo-notification',
  { token: tok(userId), biz: BIZ, body: {} });

test('ceo-test: a positive legacy user still works', async () => {
  reset();
  scenario.rows.business_members = [member(TG_USER, 'owner')];
  await OFF(async () => {
    const r = await ceoTest(TG_USER);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.deepStrictEqual(chatIdsSent(), [String(TG_USER)]);
  });
});

test('ceo-test: a linked negative user is reached at the external id', async () => {
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner')];
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];
  await ON(async () => {
    const r = await ceoTest(EMAIL_USER);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(chatIdsSent(), [EXTERNAL]);
  });
});

test('ceo-test: an unresolved negative user gets 400 telegram_not_linked, never ok:true', async () => {
  // The whole purpose of this button is to prove the channel works. Answering ok:true after
  // sending nowhere is the same class of lie as PR3's persisted:false.
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner')];
  await ON(async () => {
    const r = await ceoTest(EMAIL_USER);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'telegram_not_linked');
    assert.notStrictEqual(r.body.ok, true);
    assert.deepStrictEqual(sends, [], 'nothing should have been sent');
  });
});

test('ceo-test: a resolver error is 503, not 400 and not ok:true', async () => {
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner')];
  scenario.failTables.add('user_channel_links');
  await ON(async () => {
    const r = await ceoTest(EMAIL_USER);
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error, 'temporary_notification_lookup_failed');
  });
});

test('ceo-test: telegram_connected_at alone no longer proves reachability', async () => {
  // The column says onboarding ticked a box. It is still checked (its semantics are untouched),
  // but the resolver is now the authority on whether a message can actually arrive.
  reset();
  scenario.rows.business_members = [member(EMAIL_USER, 'owner')];   // connected_at IS set
  await ON(async () => {
    const r = await ceoTest(EMAIL_USER);
    assert.strictEqual(r.status, 400, 'a ticked checkbox was accepted as a Telegram identity');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE SWEEP — the assertion that would have caught the original bug
// ════════════════════════════════════════════════════════════════════════════

test('across EVERY combination, no negative or malformed chat_id ever goes on the wire', async () => {
  const audiences = [
    [TG_USER], [EMAIL_USER], [TG_USER, EMAIL_USER], [EMAIL_USER, EMAIL_USER2],
    [TG_USER, TG_OTHER, EMAIL_USER, EMAIL_USER2],
  ];
  const linkSets = [
    [],
    [link(EMAIL_USER, EXTERNAL)],
    [link(EMAIL_USER, EXTERNAL, '2026-01-01T00:00:00Z')],
    [link(EMAIL_USER, TG_USER)],
  ];
  let totalSends = 0, combos = 0;
  for (const flag of [undefined, 'true']) {
    for (const audience of audiences) {
      for (const links of linkSets) {
        for (const failing of [false, true]) {
          reset();
          scenario.rows.business_members = audience.map((u, i) => member(u, i === 0 ? 'owner' : 'admin', audience[0]));
          scenario.rows.user_channel_links = links;
          scenario.rows.compliance_events = [{ title: 'PPN', due_date: new Date().toISOString().slice(0, 10), business_id: BIZ }];
          if (failing) scenario.failTables.add('user_channel_links');
          await withNotify(flag, async () => { await remind(audience[0]); });
          combos++;
          totalSends += sends.length;
          for (const id of chatIdsSent()) {
            assert.ok(N.isSendableChatId(id),
              `an unsendable chat_id reached the wire: ${JSON.stringify(id)} `
              + `(flag=${flag} audience=${JSON.stringify(audience)} links=${links.length} failing=${failing})`);
            assert.ok(!String(id).startsWith('-'), `a negative chat_id reached the wire: ${id}`);
          }
        }
      }
    }
  }
  // Proof the sweep was not vacuous. Every assertion above is of the form "nothing bad went
  // out", which is trivially satisfied by a harness that sends nothing — and that is precisely
  // the state this file was in while the routes were erroring. If these counts ever collapse,
  // the sweep is asserting about an empty set and must be treated as failing, not passing.
  assert.ok(combos >= 60, `the sweep covered only ${combos} combinations`);
  assert.ok(totalSends >= 20, `the sweep observed only ${totalSends} sends — it proved nothing`);
});

// ════════════════════════════════════════════════════════════════════════════
// SEND SITE 2 — the creator notification
//
// Mutation testing found this site completely uncovered: three separate mutations survived
// (raw created_by_user_id as a chat id, unvalidated created_by_telegram_id, and the reverted
// self-suppression comparison), because no test exercised the path at all.
//
// It is reached through the bot approval routes, which is also how it is reached in production.
// ════════════════════════════════════════════════════════════════════════════

const DEBT_ID = 4242;
const debtRow = (over = {}) => ({
  id: DEBT_ID, business_id: BIZ, user_id: TG_USER, created_by_user_id: EMAIL_USER,
  created_by_telegram_id: null, approval_status: 'pending_approval', status: 'unpaid',
  type: 'payable', counterparty: 'Acme Supplies', amount: 1000, original_amount: 1000,
  currency: 'IDR', raw_input_text: 'pay acme 1000', ...over,
});

// The approver is a legacy owner; the CREATOR is the interesting party in every case below.
function seedApproval(over = {}) {
  reset();
  scenario.rows.debts = [debtRow(over)];
  scenario.rows.business_members = [member(TG_USER, 'owner', TG_USER)];
  scenario.rows.users.push({ id: EMAIL_USER, first_name: 'Emi', username: 'emi', language: 'en' });
}
const approve = () => api('POST', `/api/telegram/debts/${DEBT_ID}/approve`, {
  body: { telegram_id: TG_USER }, secret: SECRET,
});

test('creator: a negative creator with no link is NOT sent their own user id', async () => {
  // The mutation that survived: chatId = creatorUserId. -42 would go on the wire as a chat id.
  seedApproval();
  await ON(async () => {
    await approve();
    assert.ok(!chatIdsSent().includes(EMAIL_USER), 'a negative creator id reached the wire');
    assert.ok(!chatIdsSent().includes(String(EMAIL_USER)));
    assert.deepStrictEqual(sends, [], 'an unreachable creator was messaged anyway');
  });
});

test('creator: a linked negative creator is reached at the external id', async () => {
  seedApproval();
  scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];
  await ON(async () => {
    await approve();
    assert.deepStrictEqual(chatIdsSent(), [EXTERNAL]);
  });
});

test('creator: a valid created_by_telegram_id is preferred over resolution', async () => {
  // This column holds the EXTERNAL account, which is the answer we would resolve to anyway —
  // so using it directly saves a lookup. It is still validated first.
  seedApproval({ created_by_telegram_id: 888000444 });
  await ON(async () => {
    await approve();
    assert.deepStrictEqual(chatIdsSent(), ['888000444']);
  });
});

test('creator: an INVALID created_by_telegram_id is not trusted', async () => {
  // The mutation that survived: `if (debt.created_by_telegram_id)`. A negative or malformed
  // value in that column is truthy, and went straight to the Telegram API.
  for (const bad of [-100200300, '-5', 0, 'abc']) {
    seedApproval({ created_by_telegram_id: bad });
    scenario.rows.user_channel_links = [link(EMAIL_USER, EXTERNAL)];
    await ON(async () => {
      await approve();
      assert.ok(!chatIdsSent().includes(bad) && !chatIdsSent().includes(String(bad)),
        `an invalid created_by_telegram_id was used as a chat id: ${bad}`);
      assert.deepStrictEqual(chatIdsSent(), [EXTERNAL], 'it should fall back to resolution');
    });
  }
});

test('creator: self-suppression compares PLATFORM ids, not a chat id to a user id', async () => {
  // The approver approves their own submission. Comparing a chat id with a platform user id —
  // as the old code did — makes those differ for a linked user, so they would be notified
  // about their own action.
  seedApproval({ created_by_user_id: TG_USER });
  scenario.rows.user_channel_links = [link(TG_USER, EXTERNAL)];
  await ON(async () => {
    await approve();
    assert.deepStrictEqual(sends, [], 'the actor was notified about their own action');
  });
});

test('creator: a different creator IS notified when the actor is someone else', async () => {
  // The other half of the suppression check — it must not silence everyone.
  seedApproval({ created_by_user_id: TG_OTHER });
  await ON(async () => {
    await approve();
    assert.deepStrictEqual(chatIdsSent(), [String(TG_OTHER)]);
  });
});

test('creator: OFF, a legacy creator still receives the notification', async () => {
  seedApproval({ created_by_user_id: TG_OTHER });
  await OFF(async () => {
    await approve();
    assert.deepStrictEqual(chatIdsSent(), [String(TG_OTHER)]);
  });
});

test('creator: a resolver error drops the notification but the approval still succeeds', async () => {
  // The financial action must not fail because a message could not be addressed.
  seedApproval();
  scenario.failTables.add('user_channel_links');
  await ON(async () => {
    const r = await approve();
    assert.notStrictEqual(r.status, 500, 'a notification failure broke the approval');
    assert.deepStrictEqual(sends, [], 'a lookup failure still produced a send');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS
// ════════════════════════════════════════════════════════════════════════════

const fs = require('node:fs');
const path = require('node:path');
const SRC = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
const CODE = () => SRC('server/index.js').split(String.fromCharCode(10))
  .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/(^|[^:])\/\/.*$/, '$1')));

test('the defence-in-depth guards are present (source pin, not coverage)', () => {
  // Honest labelling: these three checks are unreachable while resolution works correctly, so
  // mutation testing cannot kill them behaviourally and neither can any test. They exist for
  // the send site that gets added later without reading this file. Pinning them keeps them
  // from being "cleaned up" as dead code by someone who is technically right and practically
  // wrong — the cost of the check is nothing, the cost of its absence is disclosure.
  const server = SRC('server/index.js');
  const lib = SRC('server/lib/telegramNotifications.js');

  // 1. every id this module hands out is re-checked before it leaves
  assert.match(lib, /if \(!isSendableChatId\(id\)\) \{ drop\(userId, 'unsendable_chat_id'\); return; \}/,
    'the accept() guard is gone');

  // 2. the single-chat helper refuses an unsendable id even if a caller bypasses resolution
  assert.match(server, /if \(!isSendableChatId\(chatId\)\) \{[\s\S]{0,200}?refused: 'unsendable_chat_id'/,
    'the sendTelegramDM guard is gone');

  // 3. the fan-out re-checks at the wire
  assert.match(server, /if \(!isSendableChatId\(chatId\)\) continue;/,
    'the fan-out send-time guard is gone');

  // 4. a resolver that somehow throws must not become a raw-id fallback
  assert.match(lib, /catch \(e\) \{[\s\S]{0,300}?drop\(userId, 'resolver_exception'\);/,
    'the resolver-exception path no longer fails closed');
  assert.ok(!/accept\(userId, userId, 'legacy'\)[\s\S]{0,80}?resolver_exception/.test(lib));
});

test('no chat_id is ever assigned a raw platform user id', () => {
  const lines = CODE();
  for (const l of lines) {
    if (!l.includes('chat_id')) continue;
    assert.ok(!/chat_id:\s*(userId|user_id|req\.user\.userId|ownerUserId|m\.user_id)\b/.test(l),
      `a platform user id is used as a chat id: ${l.trim()}`);
  }
  // and the resolved forms are the only ones present
  const assigns = lines.filter((l) => /chat_id:/.test(l)).map((l) => l.trim());
  assert.ok(assigns.length > 0, 'the send sites disappeared');
  for (const a of assigns) {
    assert.match(a, /chat_id:\s*(chatId|rec\.chatId)\b/, `unrecognised chat_id source: ${a}`);
  }
});

test('the admin fan-out no longer derives chat ids from business_members.user_id', () => {
  const code = CODE().join(String.fromCharCode(10));
  assert.ok(!/const chatIds = \[\.\.\.new Set\(adminUserIds\)\]/.test(code),
    'chat ids are being taken straight from membership rows again');
  assert.match(code, /resolveTelegramNotificationRecipients\(\{/,
    'the admin fan-out must resolve its recipients');
});

test('no comment claims users.id is the Telegram chat id', () => {
  const src = SRC('server/index.js');
  assert.ok(!/users\.id IS the [Tt]elegram (chat )?id/.test(src),
    'the assumption that caused this bug is still documented as fact');
});

test('the reverse resolver is used only through the notification helper', () => {
  const server = SRC('server/index.js');
  assert.ok(!/resolveTelegramExternalId|resolveChannelExternalId/.test(server),
    'server/index.js must reach the reverse resolver through lib/telegramNotifications.js');
  assert.match(SRC('server/lib/telegramNotifications.js'), /resolveTelegramExternalId/);
});

test('PR2.6 adds no migration and touches no link or token table', () => {
  const lib = SRC('server/lib/telegramNotifications.js');
  assert.ok(!/insert|update|upsert|delete/.test(lib.replace(/^.*\/\/.*$/gm, '')),
    'recipient resolution must be read-only');
  assert.ok(!/channel_link_tokens/.test(lib), 'token creation is PR4');
});

test('the non-IDR block and identity wiring are untouched by PR2.6', () => {
  const server = SRC('server/index.js');
  assert.strictEqual((server.match(/isSupportedTelegramCurrency\(/g) || []).length, 2);
  assert.match(server, /resolveTelegramActorForRoute/);
  assert.match(server, /resolveTelegramActiveWorkspace/);
});
