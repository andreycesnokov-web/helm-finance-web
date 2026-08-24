// Notification permission policy — the "who may receive this" gate.
//
// The policy resolver returns PLATFORM USER IDS. Turning those into Telegram chat ids is a
// separate concern (telegramNotifications.js), so the two gates are tested separately here and
// composed in the end-to-end section: policy decides WHO, channel resolution decides WHETHER
// THEY ARE REACHABLE. A test that only exercised one would miss the case where an allowed user
// has a revoked link — which is the whole point of keeping them apart.

const { test } = require('node:test');
const assert = require('node:assert');

const P = require('../../server/lib/notificationPolicy');
const N = require('../../server/lib/telegramNotifications');

const NOTIFY_FLAG = 'TELEGRAM_NOTIFY_REVERSE_RESOLVER_ENABLED';
const BIZ = '11111111-1111-1111-1111-111111111111';
const OWNER = -1;                // email-origin owner (042 negative id)
const LEGACY_TG = 1057134807;    // the legacy Telegram-origin user
const ADMIN = -2;
const MANAGER = -3;
const EMPLOYEE = -4;
const EXTERNAL = '555000222';

// ── fake Supabase ───────────────────────────────────────────────────────────
const scenario = { rows: {}, failTables: new Set() };
function reset() {
  scenario.rows = { business_members: [], user_channel_links: [], users: [] };
  scenario.failTables = new Set();
}
const member = (userId, role, status = 'active') =>
  ({ user_id: userId, business_id: BIZ, role, status });
const link = (userId, externalId, revokedAt = null) =>
  ({ channel: 'telegram', external_user_id: String(externalId), user_id: userId, revoked_at: revokedAt });

function match(row, filters) {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'in') return val.map(String).includes(String(v));
    if (op === 'is') return val === null ? (v === null || v === undefined) : String(v) === String(val);
    return true;
  });
}
function fakeFrom(table) {
  const filters = [];
  let limit = null;
  const q = {
    select() { return q; },
    eq(c, v) { filters.push(['eq', c, v]); return q; },
    in(c, v) { filters.push(['in', c, v]); return q; },
    is(c, v) { filters.push(['is', c, v]); return q; },
    neq() { return q; }, not() { return q; }, or() { return q; }, order() { return q; },
    limit(n) { limit = n; return q; },
    single() { q._single = true; return q; },
    maybeSingle() { q._single = true; return q; },
    then(resolve, reject) {
      let out;
      if (scenario.failTables.has(table)) {
        out = { data: null, error: { message: `simulated ${table} failure` } };
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
const supabase = { from: fakeFrom };

const audience = (opts) => P.resolveNotificationAudience({ supabase, businessId: BIZ, ...opts });
const prefs = (userId, category, on) => ({ [userId]: { [category]: on } });

// ─────────────────────────────────────────────────────────────────────────────
// Role gate
// ─────────────────────────────────────────────────────────────────────────────

test('an active owner receives company_financial when the preference is on', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  const r = await audience({ category: 'company_financial', preferences: prefs(OWNER, 'company_financial', true) });
  assert.deepStrictEqual(r.userIds, [OWNER]);
});

test('an owner with no preferences configured still receives — default is ON', async () => {
  // Shipping preferences must not mute everyone who has never opened the settings screen.
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  for (const p of [null, undefined, {}, { [OWNER]: {} }, { [OWNER]: { other_category: false } }]) {
    const r = await audience({ category: 'company_financial', preferences: p });
    assert.deepStrictEqual(r.userIds, [OWNER], `preferences ${JSON.stringify(p)} muted an owner`);
  }
});

test('an owner does NOT receive company_financial when the preference is off', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  const r = await audience({ category: 'company_financial', preferences: prefs(OWNER, 'company_financial', false) });
  assert.deepStrictEqual(r.userIds, []);
  assert.ok(r.dropped.some((d) => d.reason === 'preference_off'));
});

test('preference off is per category, not global', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  const p = prefs(OWNER, 'company_financial', false);
  assert.deepStrictEqual((await audience({ category: 'company_financial', preferences: p })).userIds, []);
  assert.deepStrictEqual((await audience({ category: 'tax_compliance', preferences: p })).userIds, [OWNER]);
});

for (const [role, userId] of [['admin', ADMIN], ['manager', MANAGER], ['employee', EMPLOYEE],
                              ['ceo', -5], ['cfo', -6], ['accountant', -7], ['auditor', -8]]) {
  test(`a ${role} cannot receive company_financial even with the preference ON`, async () => {
    // Preference ON must grant nothing. This is the asymmetry the whole design rests on: a
    // preference row is permission to be BOTHERED, never permission to SEE.
    reset();
    scenario.rows.business_members = [member(userId, role)];
    const r = await audience({ category: 'company_financial', preferences: prefs(userId, 'company_financial', true) });
    assert.deepStrictEqual(r.userIds, [], `${role} received a financial notification`);
  });
}

test('an admin who is ALSO an owner receives — via the owner row, not the admin one', async () => {
  reset();
  scenario.rows.business_members = [member(ADMIN, 'admin'), member(ADMIN, 'owner')];
  const r = await audience({ category: 'company_financial' });
  assert.deepStrictEqual(r.userIds, [ADMIN]);
});

test('every financial category is owner-only', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner'), member(ADMIN, 'admin'), member(MANAGER, 'manager')];
  for (const c of P.CATEGORIES) {
    if (P.CATEGORY_POLICY[c].scope !== 'business') continue;
    const r = await audience({ category: c });
    assert.deepStrictEqual(r.userIds, [OWNER], `${c} reached someone other than the owner`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Membership status
// ─────────────────────────────────────────────────────────────────────────────

test('a removed owner receives nothing', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner', 'removed')];
  assert.deepStrictEqual((await audience({ category: 'company_financial' })).userIds, []);
});

test('an inactive owner receives nothing', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner', 'inactive')];
  assert.deepStrictEqual((await audience({ category: 'company_financial' })).userIds, []);
});

test('the legacy Telegram user receives no financial alert once their membership is gone', async () => {
  // The point of the ownership move: 1057134807 keeps existing for history, and stops being a
  // recipient. Nothing about the legacy id is special-cased — the role gate simply no longer
  // matches, which is why this stays true for any category and any future notification type.
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner'), member(LEGACY_TG, 'owner', 'removed')];
  const r = await audience({ category: 'company_financial' });
  assert.deepStrictEqual(r.userIds, [OWNER]);
  assert.ok(!r.userIds.includes(LEGACY_TG), 'the legacy Telegram user was included');
});

// ─────────────────────────────────────────────────────────────────────────────
// Subject-scoped categories
// ─────────────────────────────────────────────────────────────────────────────

test('own_request_status goes only to the subject the caller names', async () => {
  reset();
  // Membership rows exist and must be ignored entirely: a subject-scoped category performs no
  // role lookup, so the caller's list is a ceiling rather than a seed.
  scenario.rows.business_members = [member(OWNER, 'owner'), member(ADMIN, 'admin')];
  const r = await audience({ category: 'own_request_status', subjectUserIds: [MANAGER] });
  assert.deepStrictEqual(r.userIds, [MANAGER]);
});

test('own_request_status with no subject reaches nobody', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  assert.deepStrictEqual((await audience({ category: 'own_request_status', subjectUserIds: [] })).userIds, []);
});

test('an excluded actor is not notified about their own action', async () => {
  reset();
  const r = await audience({ category: 'own_request_status', subjectUserIds: [MANAGER, OWNER], excludeUserIds: [MANAGER] });
  assert.deepStrictEqual(r.userIds, [OWNER]);
});

test('a subject-scoped category still honours preferences', async () => {
  reset();
  const r = await audience({ category: 'own_request_status', subjectUserIds: [MANAGER],
                             preferences: prefs(MANAGER, 'own_request_status', false) });
  assert.deepStrictEqual(r.userIds, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown categories, duplicates, failures
// ─────────────────────────────────────────────────────────────────────────────

test('an unknown category sends to nobody', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  for (const c of ['', null, undefined, 'financial', 'company_financials', 'COMPANY_FINANCIAL',
                   'constructor', '__proto__', 'toString', 0, {}, []]) {
    const r = await audience({ category: c, subjectUserIds: [OWNER] });
    assert.deepStrictEqual(r.userIds, [], `category ${JSON.stringify(c)} reached someone`);
    assert.ok(r.dropped.some((d) => d.reason === 'unknown_category'));
  }
});

test('inherited Object properties are not categories', () => {
  // hasOwnProperty, not `in` — otherwise 'toString' would resolve to a function and be treated
  // as a policy object.
  for (const c of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    assert.strictEqual(P.categoryPolicy(c), null, `${c} resolved to a policy`);
    assert.strictEqual(P.isKnownCategory(c), false);
  }
});

test('duplicate membership rows produce one recipient', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner'), member(OWNER, 'owner'), member(OWNER, 'owner')];
  assert.deepStrictEqual((await audience({ category: 'company_financial' })).userIds, [OWNER]);
});

test('duplicate subject ids produce one recipient', async () => {
  reset();
  const r = await audience({ category: 'own_request_status', subjectUserIds: [MANAGER, MANAGER, String(MANAGER)] });
  assert.deepStrictEqual(r.userIds, [MANAGER]);
});

test('a membership lookup failure reaches nobody', async () => {
  // Fail closed: "we could not read the members table" is not permission to notify a wider set.
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  scenario.failTables.add('business_members');
  const r = await audience({ category: 'company_financial' });
  assert.deepStrictEqual(r.userIds, []);
  assert.ok(r.dropped.some((d) => d.reason === 'membership_lookup_failed'));
});

test('malformed user ids are dropped, not coerced', async () => {
  reset();
  scenario.rows.business_members = [
    { user_id: null, business_id: BIZ, role: 'owner', status: 'active' },
    { user_id: 'abc', business_id: BIZ, role: 'owner', status: 'active' },
    { user_id: 0, business_id: BIZ, role: 'owner', status: 'active' },
    member(OWNER, 'owner'),
  ];
  assert.deepStrictEqual((await audience({ category: 'company_financial' })).userIds, [OWNER]);
});

test('the membership query itself filters by status and role', async () => {
  // Both layers are pinned separately: this one asserts the QUERY narrows, the next asserts the
  // returned rows are re-checked. Dropping either alone leaves behaviour identical — which is
  // exactly why neither is covered by the other's test, and why a mutation that removed the
  // query filter survived until this existed. Fetching every member and filtering in memory is
  // also a least-privilege regression, not just a redundant one.
  const seen = [];
  const recording = { from: () => {
    const f = [];
    const q = {
      select: () => q,
      eq: (c, v) => { f.push([c, v]); return q; },
      in: (c, v) => { f.push([c, v]); return q; },
      limit: () => q,
      then: (res) => { seen.push(f); return Promise.resolve({ data: [], error: null }).then(res); },
    };
    return q;
  } };
  await P.resolveNotificationAudience({ supabase: recording, category: 'company_financial', businessId: BIZ });
  assert.strictEqual(seen.length, 1, 'expected exactly one membership query');
  const filters = Object.fromEntries(seen[0]);
  assert.strictEqual(filters.business_id, BIZ, 'the query is not scoped to the business');
  assert.strictEqual(filters.status, 'active', 'the query does not filter to active members');
  assert.deepStrictEqual(filters.role, ['owner'], 'the query does not filter by role');
});

test('rows are re-checked, so a filter that stops being applied is caught', async () => {
  // The fake honours .eq()/.in(); this asserts the defence-in-depth filter in the resolver by
  // handing back a row the query should never have returned.
  reset();
  scenario.rows.business_members = [member(ADMIN, 'admin'), member(OWNER, 'owner', 'removed')];
  const r = await P.resolveNotificationAudience({
    supabase: { from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({
        data: [member(ADMIN, 'admin'), member(OWNER, 'owner', 'removed')], error: null }) }) }) }),
    }) },
    category: 'company_financial', businessId: BIZ,
  });
  assert.deepStrictEqual(r.userIds, [], 'an unfiltered row was accepted verbatim');
});

// ─────────────────────────────────────────────────────────────────────────────
// Both gates composed: allowed, but reachable?
// ─────────────────────────────────────────────────────────────────────────────

async function deliverable(userIds) {
  const prev = process.env[NOTIFY_FLAG];
  process.env[NOTIFY_FLAG] = 'true';           // consult the link table
  try {
    return await N.resolveTelegramNotificationRecipients({ supabase, userIds, reason: 'test' });
  } finally {
    if (prev === undefined) delete process.env[NOTIFY_FLAG]; else process.env[NOTIFY_FLAG] = prev;
  }
}

test('an allowed owner with a REVOKED link receives nothing', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  scenario.rows.user_channel_links = [link(OWNER, EXTERNAL, '2026-01-01T00:00:00Z')];
  const a = await audience({ category: 'company_financial' });
  assert.deepStrictEqual(a.userIds, [OWNER], 'policy should still allow them');
  const d = await deliverable(a.userIds);
  assert.deepStrictEqual(d.chatIds, [], 'a revoked link was delivered to');
  assert.ok(d.dropped.some((x) => x.reason === 'link_revoked'));
});

test('an allowed owner who is UNLINKED is skipped', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  scenario.rows.user_channel_links = [];
  const a = await audience({ category: 'company_financial' });
  assert.deepStrictEqual(a.userIds, [OWNER]);
  const d = await deliverable(a.userIds);
  assert.deepStrictEqual(d.chatIds, [], 'an unlinked user produced a chat id');
  assert.ok(d.dropped.some((x) => x.reason === 'not_linked'));
});

test('an allowed, linked owner is reachable — and never at a negative chat id', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner')];
  scenario.rows.user_channel_links = [link(OWNER, EXTERNAL)];
  const a = await audience({ category: 'company_financial' });
  const d = await deliverable(a.userIds);
  assert.deepStrictEqual(d.chatIds, [EXTERNAL]);
  for (const id of d.chatIds) assert.ok(!String(id).startsWith('-'), 'a negative chat id was produced');
});

test('two platform users sharing one Telegram account are messaged once', async () => {
  reset();
  scenario.rows.business_members = [member(OWNER, 'owner'), member(ADMIN, 'owner')];
  scenario.rows.user_channel_links = [link(OWNER, EXTERNAL), link(ADMIN, EXTERNAL)];
  const a = await audience({ category: 'company_financial' });
  assert.strictEqual(a.userIds.length, 2, 'both users should be allowed');
  const d = await deliverable(a.userIds);
  assert.deepStrictEqual(d.chatIds, [EXTERNAL], 'the same person was messaged twice');
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings-UI helpers, and the send path
// ─────────────────────────────────────────────────────────────────────────────

test('categoriesForRole exposes exactly what a role may receive', () => {
  const ownerCats = P.categoriesForRole('owner');
  for (const c of P.CATEGORIES) assert.ok(ownerCats.includes(c), `owner is missing ${c}`);

  for (const role of ['admin', 'manager', 'employee', 'accountant']) {
    const cats = P.categoriesForRole(role);
    assert.deepStrictEqual(cats.sort(), ['own_request_status', 'system_identity'].sort(),
      `${role} was offered more than their own updates`);
  }
});

test('an unavailable category carries a reason the UI can explain', () => {
  assert.strictEqual(P.unavailableReason('company_financial'), 'owner_only');
  assert.strictEqual(P.unavailableReason('own_request_status'), null);
  assert.strictEqual(P.unavailableReason('nonsense'), 'unknown');
});

test('the send path takes recipients only from the policy resolver', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const SRC = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8').split('\r\n').join('\n');
  const a = SRC.indexOf('async function notifyBusinessAdminsViaTelegram');
  const b = SRC.indexOf('\nasync function', a + 10);
  assert.ok(a > -1 && b > a, 'the send function moved');
  const fn = SRC.slice(a, b);

  assert.match(fn, /resolveNotificationAudience\(/, 'the send path does not consult the policy resolver');
  assert.match(fn, /userIds: audience\.userIds/, 'the transport sends to something other than the policy audience');
  // The inline role list that used to decide the audience here.
  for (const literal of ["'ceo'", "'admin'", "'cfo'", "'owner'"]) {
    assert.ok(!fn.includes(literal), `a role literal (${literal}) is still deciding recipients in the transport`);
  }
  assert.ok(!fn.includes("from('business_members')"),
    'the transport queries membership directly instead of asking the policy resolver');
});

test('every send site names a category', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const SRC = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8').split('\r\n').join('\n');
  const calls = [...SRC.matchAll(/notifyBusinessAdminsViaTelegram\(/g)]
    .map((m) => SRC.slice(m.index, m.index + 900))
    .filter((c) => !c.startsWith('notifyBusinessAdminsViaTelegram()'));   // the doc comment
  // The declaration itself plus five call sites.
  assert.ok(calls.length >= 6, `expected at least 6 references, found ${calls.length}`);
  for (const call of calls) {
    if (call.startsWith('notifyBusinessAdminsViaTelegram(ownerUserId, text, buttons')) continue;  // declaration
    assert.match(call, /category: '[a-z_]+'/, `a send site names no category:\n${call.slice(0, 160)}`);
  }
});

test('no send site interpolates a platform user id into the message body', () => {
  // Internal ids are routing data. A negative id in particular is an implementation detail of
  // the email-identity migration and means nothing to a person reading a chat message.
  const fs = require('node:fs');
  const path = require('node:path');
  const SRC = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8').split('\r\n').join('\n');
  for (const m of SRC.matchAll(/notifyBusinessAdminsViaTelegram\(([^;]{0,900})/g)) {
    const call = m[1];
    for (const leak of ['${ownerId}', '${ownerUserId}', '${m.ownerId}', '${userId}',
                        '${user.id}', '${actorUserId}', '${req.user.userId}']) {
      assert.ok(!call.includes(leak), `a send site puts ${leak} in the message body`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Two mutations survive here, and both are EQUIVALENT — the mutated code produces identical
// output — so no test is added for them. Recorded because "surviving mutant" and "gap in
// coverage" are not the same thing, and the difference is the interesting part:
//
//   1. Adding a `preference === true → include` bypass inside the recipient loop changes
//      nothing, because the loop only ever iterates over candidates the ROLE gate already
//      admitted. Preferences are evaluated strictly after permission, so they are structurally
//      incapable of widening the audience. That is the design holding, not a test missing.
//
//   2. Removing the early return when the policy returns nobody changes nothing, because an
//      empty user list produces an empty chat-id list one gate later and the transport returns
//      before sending. Two independent gates, either sufficient.
//
// Both are worth keeping as code: the first documents intent at the point of use, the second
// avoids a pointless round trip. Neither can be pinned by a behavioural test, and writing one
// that asserts their mere presence in the source would be testing the spelling, not the property.
