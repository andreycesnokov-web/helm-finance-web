// Telegram active-business routing — HTTP against the REAL Express runtime. LOCAL ONLY.
// Requires the server running with TELEGRAM_ACTIVE_BUSINESS_ENABLED=true + a bot secret
// (x-bot-secret = TELEGRAM_WEBHOOK_SECRET or BOT_TOKEN) + migration 043 applied locally +
// service-role Supabase for seeding/cleanup. Skips if the flag is off (endpoint 404).
//
//   BASE_URL=http://localhost:3001 BOT_SECRET=dummy-local SUPABASE_URL=... \
//   SUPABASE_SECRET_KEY=... node tests/integration/telegramActiveBusinessHttp.test.js
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL, SECRET = process.env.BOT_SECRET;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!BASE || !SECRET || !URL || !KEY) { console.log('SKIP — needs BASE_URL, BOT_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY (local only).'); process.exit(0); }
const supabase = createClient(URL, KEY);

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
async function api(method, path, { body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-bot-secret': SECRET }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}
const uuid = () => crypto.randomUUID();

(async () => {
  const U1 = 8800000001, U2 = 8800000002, OTHER = 8800000003;
  const A = uuid(), B = uuid(), C = uuid(), P = uuid();
  try {
    // Gate check.
    const probe = await api('GET', `/api/telegram/active-business?telegram_id=${U1}`);
    if (probe.status === 404) { console.log('SKIP — TELEGRAM_ACTIVE_BUSINESS_ENABLED is off.'); process.exit(0); }

    // Seed: U1 owns A (one business). U2 owns B + C (two) + a personal workspace P. OTHER owns C? no.
    await supabase.from('users').insert([{ id: U1 }, { id: U2 }, { id: OTHER }]);
    await supabase.from('businesses').insert([
      { id: A, owner_user_id: U1, name: 'A Co', type: 'business' },
      { id: B, owner_user_id: U2, name: 'B Co', type: 'business' },
      { id: C, owner_user_id: U2, name: 'C Co', type: 'business' },
      { id: P, owner_user_id: U2, name: 'Personal', type: 'personal' },
    ]);
    await supabase.from('business_members').insert([
      { business_id: A, user_id: U1, role: 'owner', status: 'active' },
      { business_id: B, user_id: U2, role: 'owner', status: 'active' },
      { business_id: C, user_id: U2, role: 'owner', status: 'active' },
      { business_id: P, user_id: U2, role: 'owner', status: 'active' },
    ]);

    // 1) one business → auto
    const r1 = await api('GET', `/api/telegram/active-business?telegram_id=${U1}`);
    ok('one business → auto', r1.status === 200 && r1.body?.status === 'auto' && r1.body?.business?.id === A);

    // 2) two businesses → choose (+options, both business-type, personal excluded)
    const r2 = await api('GET', `/api/telegram/active-business?telegram_id=${U2}`);
    const optIds = (r2.body?.options || []).map(o => o.id).sort();
    ok('two businesses → choose', r2.status === 200 && r2.body?.status === 'choose' && JSON.stringify(optIds) === JSON.stringify([B, C].sort()));

    // 3) personal workspace rejected on select
    const selP = await api('POST', '/api/telegram/active-business', { body: { telegram_id: U2, business_id: P } });
    ok('personal workspace → 400 business_workspace_required', selP.status === 400 && selP.body?.error === 'business_workspace_required');

    // 4) non-member cannot select
    const selX = await api('POST', '/api/telegram/active-business', { body: { telegram_id: OTHER, business_id: B } });
    ok('non-member → 403 not_a_member', selX.status === 403 && selX.body?.error === 'not_a_member');

    // 5) select B → persists → active
    const sel = await api('POST', '/api/telegram/active-business', { body: { telegram_id: U2, business_id: B } });
    ok('select B → ok', sel.status === 200 && sel.body?.ok === true && sel.body?.business?.id === B);
    const r3 = await api('GET', `/api/telegram/active-business?telegram_id=${U2}`);
    ok('selection persists → active = B', r3.status === 200 && r3.body?.status === 'active' && r3.body?.business?.id === B);

    // 6) revoke membership of the selected business → selection cleared → re-resolve to choose
    await supabase.from('business_members').update({ status: 'inactive' }).eq('business_id', B).eq('user_id', U2);
    const r4 = await api('GET', `/api/telegram/active-business?telegram_id=${U2}`);
    ok('revoked selection cleared → re-resolves', r4.status === 200 && r4.body?.status !== 'active' &&
      (r4.body?.status === 'auto' ? r4.body?.business?.id === C : (r4.body?.options || []).every(o => o.id !== B)));
    const { data: stRow } = await supabase.from('telegram_user_state').select('active_business_id').eq('user_id', U2);
    ok('stale active_business_id cleared in DB', !stRow?.[0]?.active_business_id || stRow[0].active_business_id !== B);
  } finally {
    try { await supabase.from('telegram_user_state').delete().in('user_id', [U1, U2, OTHER]); } catch { /* */ }
    try { await supabase.from('business_members').delete().in('business_id', [A, B, C, P]); } catch { /* */ }
    try { await supabase.from('businesses').delete().in('id', [A, B, C, P]); } catch { /* */ }
    try { await supabase.from('users').delete().in('id', [U1, U2, OTHER]); } catch { /* */ }
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
