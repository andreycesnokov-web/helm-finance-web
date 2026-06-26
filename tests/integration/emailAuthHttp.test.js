// Email identity (Phase 1) — HTTP flow against the REAL Express runtime. LOCAL ONLY.
// Magic-link FIRST + 6-digit code fallback. Requires the server running with
// EMAIL_AUTH_ENABLED=true and EMAIL_AUTH_DEV_RETURN_CODE=true (so the link + code are
// returned) + service-role Supabase for cleanup. Skips if email auth is disabled.
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
    // Gate check.
    const start = await api('POST', '/api/auth/email/start', { body: { email } });
    if (start.status === 404) { console.log('SKIP — EMAIL_AUTH_ENABLED is off on the server.'); process.exit(0); }

    ok('start returns ok + magic_link + dev_code', start.status === 200 && start.body?.ok === true
      && /\/login\/email\/callback\?token=[a-f0-9]{64}/.test(start.body?.magic_link || '')
      && /^\d{6}$/.test(start.body?.dev_code || ''));
    const token = (start.body.magic_link.split('token=')[1] || '');
    const code = start.body.dev_code;

    // wrong token + wrong code rejected and create NO user (validate-first).
    const badTok = await api('POST', '/api/auth/email/verify', { body: { token: 'f'.repeat(64) } });
    ok('wrong magic token → 401', badTok.status === 401);
    const badCode = await api('POST', '/api/auth/email/verify', { body: { email, code: '000000' } });
    ok('wrong code → 401', badCode.status === 401);
    const { data: noIdent } = await supabase.from('user_email_identities').select('user_id').eq('email', email);
    ok('wrong token/code create NO user', (noIdent || []).length === 0);

    // MAGIC LINK verify → JWT + NEGATIVE id + identity created.
    const magic = await api('POST', '/api/auth/email/verify', { body: { token } });
    userId = magic.body?.user?.id ?? null;
    ok('magic-link verify → token + NEGATIVE user id', magic.status === 200 && !!magic.body?.token && Number(userId) < 0);
    const jwt = magic.body.token;
    const { data: ident } = await supabase.from('user_email_identities').select('email').eq('user_id', userId);
    ok('identity row created (normalized email)', ident?.[0]?.email === email);

    // used magic token cannot be reused.
    const reuse = await api('POST', '/api/auth/email/verify', { body: { token } });
    ok('used magic token → 401 (single-use)', reuse.status === 401);

    // CODE FALLBACK still works (same start issued an unconsumed code record) → same user.
    const byCode = await api('POST', '/api/auth/email/verify', { body: { email, code } });
    ok('6-digit code fallback → token (same user)', byCode.status === 200 && Number(byCode.body?.user?.id) === Number(userId));
    const reuseCode = await api('POST', '/api/auth/email/verify', { body: { email, code } });
    ok('used code → 401 (single-use)', reuseCode.status === 401);

    // Personal Account shell + profile update.
    const profileGet = await api('GET', '/api/me/profile', { token: jwt });
    ok('profile shell exists', profileGet.status === 200 && profileGet.body?.profile?.user_id === userId);
    const patch = await api('PATCH', '/api/me/profile', { token: jwt, body: { display_name: 'Iso Tester' } });
    ok('profile update persists', patch.status === 200 && patch.body?.profile?.display_name === 'Iso Tester');

    // no personal workspace created.
    const { count } = await supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('owner_user_id', userId).eq('type', 'personal');
    ok('signup created NO personal workspace', (count || 0) === 0);
  } finally {
    try { await supabase.from('email_login_codes').delete().eq('email', email); } catch { /* */ }
    try { if (userId) await supabase.from('users').delete().eq('id', userId); } catch { /* */ } // cascades identity + profile
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
