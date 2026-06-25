// Delete-business safety — drives the REAL Express runtime over HTTP.
// Covers: owner deletes an EMPTY extra business; non-owner forbidden; last business
// forbidden; personal workspace forbidden; non-empty business blocked.
//
// SAFE: local only. Skips unless BASE_URL + JWT_SECRET (+ service-role Supabase) and
// ISO_TEST_USER are provided. Self-cleaning.
//
//   BASE_URL=http://localhost:3001 JWT_SECRET=... SUPABASE_URL=... \
//   SUPABASE_SECRET_KEY=... ISO_TEST_USER=950004 \
//   node tests/integration/deleteBusiness.test.js
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL, SECRET = process.env.JWT_SECRET;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const USER = Number(process.env.ISO_TEST_USER || 0);
const OTHER = Number(process.env.ISO_TEST_USER2 || 0); // optional non-owner user
if (!BASE || !SECRET || !URL || !KEY || !USER) {
  console.log('SKIP — needs BASE_URL, JWT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY, ISO_TEST_USER (local only).');
  process.exit(0);
}
const supabase = createClient(URL, KEY);
const tok = (u) => jwt.sign({ userId: u }, SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
async function api(method, path, { user = USER, biz, body } = {}) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + tok(user) };
  if (biz) headers['x-business-id'] = biz;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}

(async () => {
  let bizB = null, walletId = null, personalId = null;
  try {
    // Create an EMPTY extra business B (owner = USER).
    const created = await api('POST', '/api/businesses', { body: { name: 'DEL-B ' + Date.now() } });
    bizB = created.body?.business?.id || null;
    ok('setup) extra business B created', created.status === 201 && !!bizB);

    // 1) Wrong confirmation → 400.
    const noConfirm = await api('DELETE', `/api/businesses/${bizB}`, { body: { confirm: 'nope' } });
    ok('1) wrong confirmation → 400 confirm_required', noConfirm.status === 400 && noConfirm.body?.error === 'confirm_required');

    // 2) Non-owner (if provided) → 403 forbidden.
    if (OTHER) {
      const byOther = await api('DELETE', `/api/businesses/${bizB}`, { user: OTHER, body: { confirm: 'DELETE BUSINESS' } });
      ok('2) non-member/non-owner → 403', byOther.status === 403);
    } else { console.log('--  2) skipped (set ISO_TEST_USER2 for non-owner case)'); }

    // 3) Personal workspace → 403 business_workspace_required.
    const { data: pw } = await supabase.from('businesses')
      .select('id').eq('owner_user_id', USER).eq('type', 'personal').limit(1);
    personalId = pw?.[0]?.id || null;
    if (personalId) {
      const delPersonal = await api('DELETE', `/api/businesses/${personalId}`, { body: { confirm: 'DELETE BUSINESS' } });
      ok('3) personal workspace → 403 business_workspace_required',
        delPersonal.status === 403 && delPersonal.body?.error === 'business_workspace_required');
    } else { console.log('--  3) skipped (no personal workspace for user)'); }

    // 4) Non-empty business is blocked: seed a wallet in B, attempt delete → 409.
    const w = await api('POST', '/api/wallets', { biz: bizB, body: { name: 'DEL-B-Wallet', currency: 'IDR' } });
    walletId = w.body?.wallet?.id || w.body?.id || null;
    const delNonEmpty = await api('DELETE', `/api/businesses/${bizB}`, { body: { confirm: 'DELETE BUSINESS' } });
    ok('4) non-empty business → 409 business_not_empty',
      delNonEmpty.status === 409 && delNonEmpty.body?.error === 'business_not_empty');

    // remove the wallet so B is empty again
    if (walletId) { try { await supabase.from('wallets').delete().eq('id', walletId); walletId = null; } catch { /* */ } }

    // 5) Owner deletes the now-empty extra business → ok, returns next business.
    const delOk = await api('DELETE', `/api/businesses/${bizB}`, { body: { confirm: 'DELETE BUSINESS' } });
    ok('5) owner deletes empty extra business → ok', delOk.status === 200 && delOk.body?.ok === true && !!delOk.body?.next_business_id);
    if (delOk.body?.ok) bizB = null; // already gone

    // 6) Last business cannot be deleted: resolve the user's remaining single business.
    const ws = await api('GET', '/api/workspaces');
    const remaining = (ws.body?.business || []);
    if (remaining.length === 1) {
      const delLast = await api('DELETE', `/api/businesses/${remaining[0].id}`, { body: { confirm: 'DELETE BUSINESS' } });
      ok('6) last business → 409 last_business', delLast.status === 409 && delLast.body?.error === 'last_business');
    } else { console.log(`--  6) skipped (user has ${remaining.length} businesses, not exactly 1)`); }
  } finally {
    try { if (walletId) await supabase.from('wallets').delete().eq('id', walletId); } catch { /* */ }
    try { if (bizB) { await supabase.from('business_members').delete().eq('business_id', bizB); await supabase.from('businesses').delete().eq('id', bizB); } } catch { /* */ }
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
