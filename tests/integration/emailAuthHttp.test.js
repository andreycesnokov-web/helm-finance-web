// Email identity (Phase 1) — HTTP flow against the REAL Express runtime. LOCAL ONLY.
// Requires the server running with EMAIL_AUTH_ENABLED=true and EMAIL_AUTH_DEV_RETURN_CODE=true
// (so the OTP is returned for the test) + service-role Supabase for cleanup.
// Skips cleanly if email auth is disabled (start returns 404).
//
//   BASE_URL=http://localhost:3001 SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
//   node tests/integration/emailAuthHttp.test.js
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL;
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!BASE || !URL || !KEY) { console.log('SKIP — needs BASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY (local only).'); process.exit(0); }
const supabase = createClient(URL, KEY);

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
async function api(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, body: json };
}

(async () => {
  const email = `iso.email.${Date.now()}@example.com`;
  let userId = null;
  try {
    // Gate check: if email auth is off, start returns 404 → SKIP the whole suite.
    const start = await api('POST', '/api/auth/email/start', { body: { email } });
    if (start.status === 404) { console.log('SKIP — EMAIL_AUTH_ENABLED is off on the server.'); process.exit(0); }

    ok('start returns ok + dev_code', start.status === 200 && start.body?.ok === true && /^\d{6}$/.test(start.body?.dev_code || ''));
    const code = start.body.dev_code;

    // wrong code rejected
    const bad = await api('POST', '/api/auth/email/verify', { body: { email, code: '000000' } });
    ok('wrong code → 401', bad.status === 401);

    // verify → JWT + NEGATIVE user id
    const verify = await api('POST', '/api/auth/email/verify', { body: { email, code } });
    userId = verify.body?.user?.id ?? null;
    ok('verify returns token + NEGATIVE user id', verify.status === 200 && !!verify.body?.token && Number(userId) < 0);
    const token = verify.body.token;

    // identity + profile shell created
    const { data: ident } = await supabase.from('user_email_identities').select('email').eq('user_id', userId);
    ok('user_email_identities row created (normalized email)', ident?.[0]?.email === email);
    const profileGet = await api('GET', '/api/me/profile', { token });
    ok('profile shell exists', profileGet.status === 200 && profileGet.body?.profile?.user_id === userId);

    // profile update
    const patch = await api('PATCH', '/api/me/profile', { token, body: { display_name: 'Iso Tester', timezone: 'Asia/Jakarta' } });
    ok('profile update persists', patch.status === 200 && patch.body?.profile?.display_name === 'Iso Tester');

    // reused (consumed) code is rejected
    const reuse = await api('POST', '/api/auth/email/verify', { body: { email, code } });
    ok('consumed code → 401 (single-use)', reuse.status === 401);

    // no businesses.type='personal' was created by signup
    const { count } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('owner_user_id', userId).eq('type', 'personal');
    ok('signup created NO personal workspace', (count || 0) === 0);
  } finally {
    try { await supabase.from('email_login_codes').delete().eq('email', email); } catch { /* */ }
    try { if (userId) await supabase.from('users').delete().eq('id', userId); } catch { /* */ } // cascades identity + profile
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
