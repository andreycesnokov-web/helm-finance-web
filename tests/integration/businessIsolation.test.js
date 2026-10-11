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

    // A is the marker business: it must already have (or be given) financial data.
    // Seeding is BEST-EFFORT — if the plan wallet/tx limit is hit, we rely on A's
    // existing data instead of failing (this is an isolation test, not a CRUD test).
    const w = await api('POST', '/api/wallets', { biz: A.id, body: { name: 'ISO-A-Wallet', currency: 'IDR' } });
    walletId = w.body?.wallet?.id || w.body?.id || null;
    if (w.status === 200 || w.status === 201) console.log('--  A) seeded a wallet in A');
    else console.log(`--  A) wallet seed skipped (status ${w.status}${w.body?.error ? ': ' + w.body.error : ''}) — using existing A data`);
    await api('POST', '/api/transactions/batch', { biz: A.id, body: {
      transactions: [{ type: 'income', amount: 12345, scope: 'business', description: 'ISO-A-TX' }] } });

    // Business Workspace must NOT create personal wallets while Personal Workspace is
    // gated (validated before insert, so it holds regardless of local wallet schema).
    const personalWallet = await api('POST', '/api/wallets', { biz: A.id, body: { name: 'ISO-personal', currency: 'IDR', scope: 'personal' } });
    ok('A) personal-scope wallet rejected (gated)',
      personalWallet.status === 400 && personalWallet.body?.error === 'personal_wallets_disabled');

    const aWallets = await api('GET', '/api/wallets', { biz: A.id });
    const aWalletCount = (aWallets.body?.wallets || []).length;
    ok('A) A has wallets (data present)', aWallets.status === 200 && aWalletCount > 0);

    const aTx = await api('GET', '/api/transactions?period=all', { biz: A.id });
    const aTxCount = Array.isArray(aTx.body) ? aTx.body.length : 0;
    ok('A) A has transactions (data present)', Array.isArray(aTx.body) && aTxCount > 0);

    // Create business B for the same user → becomes owner.
    const created = await api('POST', '/api/businesses', { body: { name: 'ISO-B ' + Date.now(), base_currency: 'IDR' } });
    bizB = created.body?.business?.id || null;
    ok('B) business B created, user is owner', created.status === 201 && !!bizB);

    // Debug endpoint must confirm the backend resolves B (not a fallback to default).
    const dbg = await api('GET', '/api/business/active', { biz: bizB });
    ok('B) /api/business/active resolves B (matched, not primary)',
      dbg.status === 200 && dbg.body?.resolved?.id === bizB && dbg.body?.matched === true && dbg.body?.is_primary_business === false);

    // ── The core isolation assertions: B is a fresh business → strictly EMPTY, and
    //    never shows A's data, even though A has wallets/transactions/etc.
    const bWallets = await api('GET', '/api/wallets', { biz: bizB });
    ok('B) B wallets empty (A had ' + aWalletCount + ')', bWallets.status === 200 && (bWallets.body?.wallets || []).length === 0);

    const bTx = await api('GET', '/api/transactions?period=all', { biz: bizB });
    ok('B) B transactions empty (A had ' + aTxCount + ')', Array.isArray(bTx.body) && bTx.body.length === 0);

    // Payables/Receivables (debts) isolation. Best-effort create in A; SKIP cleanly if
    // the debts endpoint isn't available (old local schema). Created records belong to
    // the active business (x-business-id) and must be invisible in B.
    const payA = await api('POST', '/api/debts', { biz: A.id, body: { type: 'payable', counterparty: 'ISO-PAY-CP', amount: 5000, scope: 'business', description: 'ISO-PAY' } });
    if (payA.status === 200 || payA.status === 201) {
      await api('POST', '/api/debts', { biz: A.id, body: { type: 'receivable', counterparty: 'ISO-RECV-CP', amount: 7000, scope: 'business', description: 'ISO-RECV' } });
      const aPay = await api('GET', '/api/debts?type=payable', { biz: A.id });
      ok('A) A shows its payable', Array.isArray(aPay.body) && aPay.body.some(d => d.description === 'ISO-PAY'));
      const aRecv = await api('GET', '/api/debts?type=receivable', { biz: A.id });
      ok('A) A shows its receivable', Array.isArray(aRecv.body) && aRecv.body.some(d => d.description === 'ISO-RECV'));
      const bPay = await api('GET', '/api/debts?type=payable', { biz: bizB });
      ok('B) B payables empty (A had a payable)', Array.isArray(bPay.body) && bPay.body.length === 0);
      const bRecv = await api('GET', '/api/debts?type=receivable', { biz: bizB });
      ok('B) B receivables empty (A had a receivable)', Array.isArray(bRecv.body) && bRecv.body.length === 0);
    } else {
      console.log(`--  debts (payable/receivable) isolation SKIPPED (POST /api/debts status ${payA.status}; align local schema)`);
    }

    const bPulse = await api('GET', '/api/pulse', { biz: bizB });
    const cash = bPulse.body?.total_balance ?? bPulse.body?.cash ?? bPulse.body?.summary?.total_balance ?? 0;
    ok('B) B pulse cash is zero', bPulse.status === 200 && Number(cash) === 0);

    // Switching back to A still returns A's data.
    const aAgain = await api('GET', '/api/wallets', { biz: A.id });
    ok('A) switching back to A returns A wallets', (aAgain.body?.wallets || []).length > 0);
    const aTxAgain = await api('GET', '/api/transactions?period=all', { biz: A.id });
    ok('A) switching back to A returns A transactions', Array.isArray(aTxAgain.body) && aTxAgain.body.length > 0);

    // Explicit invalid x-business-id → 403 (no silent fallback to default).
    const bogus = await api('GET', '/api/wallets', { biz: '00000000-0000-0000-0000-000000000000' });
    ok('SEC) invalid x-business-id → 403 workspace_not_accessible',
      bogus.status === 403 && bogus.body?.error === 'workspace_not_accessible');
  } finally {
    // Cleanup: remove the seeded debts + transaction + wallet and business B (+ membership).
    try { await supabase.from('debts').delete().in('description', ['ISO-PAY', 'ISO-RECV']); } catch { /* */ }
    try { await supabase.from('transactions').delete().eq('description', 'ISO-A-TX'); } catch { /* */ }
    try { if (walletId) await supabase.from('wallets').delete().eq('id', walletId); } catch { /* */ }
    try { if (bizB) { await supabase.from('business_members').delete().eq('business_id', bizB); await supabase.from('businesses').delete().eq('id', bizB); } } catch { /* */ }
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
