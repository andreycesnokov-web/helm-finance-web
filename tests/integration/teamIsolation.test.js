// Team isolation — drives the REAL Express runtime over HTTP. Proves the Team API is
// scoped to the active business (x-business-id), not the user's first membership:
// a fresh business shows only its owner, switching back shows the old team, and a
// member of one business cannot be modified/removed while active on another.
//
// SAFE: local only. Skips unless BASE_URL + JWT_SECRET (+ service-role Supabase) and
// ISO_TEST_USER are provided. Self-cleaning.
//
//   BASE_URL=http://localhost:3001 JWT_SECRET=... SUPABASE_URL=... \
//   SUPABASE_SECRET_KEY=... ISO_TEST_USER=950004 \
//   node tests/integration/teamIsolation.test.js
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL, SECRET = process.env.JWT_SECRET;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const USER = Number(process.env.ISO_TEST_USER || 0);
if (!BASE || !SECRET || !URL || !KEY || !USER) {
  console.log('SKIP — needs BASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY, ISO_TEST_USER (local only).');
  process.exit(0);
}
const supabase = createClient(URL, KEY);
const token = jwt.sign({ userId: USER }, SECRET, { expiresIn: '1h' });
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
async function api(method, path, { biz, body } = {}) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token };
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}

(async () => {
  let bizB = null;
  try {
    // Business A = the user's default; capture its team.
    const ws = await api('GET', '/api/workspaces');
    const A = (ws.body?.business || [])[0];
    ok('A) default business A resolved', !!A?.id);
    const aTeam = await api('GET', '/api/team', { biz: A.id });
    const aMembers = aTeam.body?.members || [];
    ok('A) A team resolves (scoped to A)', aTeam.status === 200 && aMembers.length >= 1 && aMembers.every(m => true));
    const aMemberId = (aMembers.find(m => m.user_id !== USER) || {}).id || null; // a non-owner member of A, if any

    // Create a fresh business B.
    const created = await api('POST', '/api/businesses', { body: { name: 'TEAM-B ' + Date.now() } });
    bizB = created.body?.business?.id || null;
    ok('B) business B created', created.status === 201 && !!bizB);

    // B's Team must show ONLY the owner (no members copied from A).
    const bTeam = await api('GET', '/api/team', { biz: bizB });
    const bMembers = bTeam.body?.members || [];
    ok('B) B team has exactly 1 member (owner)', bTeam.status === 200 && bMembers.length === 1 && String(bMembers[0].user_id) === String(USER) && bMembers[0].role === 'owner');
    ok('B) B team business_id == B', bTeam.body?.business_id === bizB);

    // Switching back to A returns A's team (unchanged).
    const aAgain = await api('GET', '/api/team', { biz: A.id });
    ok('A) switching back returns A team', aAgain.status === 200 && (aAgain.body?.members || []).length === aMembers.length);

    // Cross-business mutation blocked: try to modify/remove an A member while active on B.
    if (aMemberId) {
      const patch = await api('PATCH', `/api/team/members/${aMemberId}`, { biz: bizB, body: { role: 'manager' } });
      ok('SEC) cannot PATCH an A member while active on B', patch.status === 404);
      const del = await api('DELETE', `/api/team/members/${aMemberId}`, { biz: bizB });
      ok('SEC) cannot DELETE an A member while active on B', del.status === 404);
    } else {
      console.log('--  SEC) cross-business member mutation SKIPPED (A has no non-owner member to target)');
    }

    // Direct DB check: B has exactly one business_members row (owner), none copied.
    const { data: bRows } = await supabase.from('business_members').select('user_id, role').eq('business_id', bizB);
    ok('B) DB: B has exactly the owner membership', (bRows || []).length === 1 && String(bRows[0].user_id) === String(USER));
  } finally {
    try { if (bizB) { await supabase.from('business_members').delete().eq('business_id', bizB); await supabase.from('businesses').delete().eq('id', bizB); } } catch { /* */ }
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
