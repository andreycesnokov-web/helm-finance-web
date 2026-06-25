// Business isolation regression — drives the REAL Express runtime over HTTP.
// Proves a freshly-created/selected business starts empty and never shows another
// business's wallets/transactions/debts, and that an explicit invalid x-business-id
// is rejected (403) instead of silently falling back to the default workspace.
//
// SAFE: local only. Skips unless BASE_URL + JWT_SECRET (+ service-role Supabase for
// cleanup) are provided. ISO_TEST_USER must be an existing local user id.
//
//   BASE_URL=http://localhost:3001 JWT_SECRET=... SUPABASE_URL=... \
//   SUPABASE_SECRET_KEY=... ISO_TEST_USER=950004 \
//   node tests/integration/businessIsolation.test.js
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
  let bizB = null, walletId = null;
  try {
    // Resolve the user's default business A (bootstraps on first call).
    const ws = await api('GET', '/api/workspaces');
    const A = (ws.body?.business || [])[0];
    ok('A) default business A resolved', !!A?.id);

    // Seed A with a wallet (isolation marker).
    const w = await api('POST', '/api/wallets', { biz: A.id, body: { name: 'ISO-A-Wallet', currency: 'IDR' } });
    walletId = w.body?.wallet?.id || w.body?.id || null;
    ok('A) wallet created in A (201/200)', w.status === 200 || w.status === 201);

    const aWallets = await api('GET', '/api/wallets', { biz: A.id });
    ok('A) A shows its wallet', (aWallets.body?.wallets || []).some(x => x.name === 'ISO-A-Wallet'));

    // Create business B for the same user → becomes owner.
    const created = await api('POST', '/api/businesses', { body: { name: 'ISO-B ' + Date.now(), base_currency: 'IDR' } });
    bizB = created.body?.business?.id || null;
    ok('B) business B created, user is owner', created.status === 201 && !!bizB);

    // B must start EMPTY and never show A's data.
    const bWallets = await api('GET', '/api/wallets', { biz: bizB });
    ok('B) B wallets empty', bWallets.status === 200 && (bWallets.body?.wallets || []).length === 0);

    const bDebts = await api('GET', '/api/debts', { biz: bizB });
    ok('B) B debts empty', bDebts.status === 200 && ((bDebts.body?.debts || bDebts.body || []).length === 0));

    const bPulse = await api('GET', '/api/pulse', { biz: bizB });
    const cash = bPulse.body?.total_balance ?? bPulse.body?.cash ?? bPulse.body?.summary?.total_balance ?? 0;
    ok('B) B pulse cash is zero', bPulse.status === 200 && Number(cash) === 0);

    // Switching back to A still returns A's data.
    const aAgain = await api('GET', '/api/wallets', { biz: A.id });
    ok('A) switching back to A returns A wallet', (aAgain.body?.wallets || []).some(x => x.name === 'ISO-A-Wallet'));

    // Explicit invalid x-business-id → 403 (no silent fallback to default).
    const bogus = await api('GET', '/api/wallets', { biz: '00000000-0000-0000-0000-000000000000' });
    ok('SEC) invalid x-business-id → 403 workspace_not_accessible',
      bogus.status === 403 && bogus.body?.error === 'workspace_not_accessible');
  } finally {
    // Cleanup: remove the seeded wallet and business B (+ its membership).
    try { if (walletId) await supabase.from('wallets').delete().eq('id', walletId); } catch { /* */ }
    try { if (bizB) { await supabase.from('business_members').delete().eq('business_id', bizB); await supabase.from('businesses').delete().eq('id', bizB); } } catch { /* */ }
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
