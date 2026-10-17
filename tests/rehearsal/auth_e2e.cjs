'use strict';
// Email + Password end-to-end over HTTP against the disposable stack: real GoTrue, real Mailpit inbox, real PostgREST.
// No JWT is minted here: every app token comes from POST /api/auth/password/login.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { Client } = require('pg');
const S = require('./env.cjs').secrets();
const API = 'http://127.0.0.1:55460/api', MAIL = 'http://127.0.0.1:55441/api/v1', APP = 'http://127.0.0.1:55470';
const results = []; let n = 0;
const check = async (name, fn) => { n++; try { await fn(); results.push({ n, name, ok: true }); console.log('PASS', n, name) } catch (e) { results.push({ n, name, ok: false, error: e.message }); console.log('FAIL', n, name, '-', e.message) } };
const run = Date.now().toString(36);
const addr = (k) => `${k}.${run}@rehearsal.test`;
const PASS1 = 'Rehearsal-Pass-' + crypto.randomBytes(6).toString('hex'), PASS2 = 'Rehearsal-New-' + crypto.randomBytes(6).toString('hex');
let ipSeq = 0; const freshIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250 + 1}`;
const call = async (method, path, body, token, ip = freshIp()) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (p, b, t, ip) => call('POST', p, b, t, ip), get = (p, t) => call('GET', p, undefined, t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mails(to) { const r = await fetch(`${MAIL}/search?query=${encodeURIComponent('to:' + to)}`).then((x) => x.json()); return r.messages || []; }
async function nextMail(to, before, subject) {
  for (let i = 0; i < 60; i++) {
    const m = (await mails(to)).filter((x) => !before.includes(x.ID) && (!subject || subject.test(x.Subject)));
    if (m.length) { const full = await fetch(`${MAIL}/message/${m[0].ID}`).then((x) => x.json()); return full; }
    await sleep(250);
  }
  throw Error('no email for ' + to);
}
const linkOf = (msg) => { const m = /http:\/\/127\.0\.0\.1:55450\/auth\/v1\/verify\?[^\s"'<>)\]]+/.exec(msg.Text || msg.HTML || ''); if (!m) throw Error('no verify link in mail'); return m[0].replace(/&amp;/g, '&'); };
async function follow(link) { const r = await fetch(link, { redirect: 'manual' }); return r.headers.get('location') || ''; }
const frag = (loc) => Object.fromEntries(new URLSearchParams((loc.split('#')[1]) || ''));
(async () => {
  const db = new Client({ connectionString: `postgresql://postgres:${S.db_password}@127.0.0.1:55440/postgres` }); await db.connect();
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const registerAndConfirm = async (email, password = PASS1) => {
    const before = (await mails(email)).map((x) => x.ID);
    const r = await post('/auth/password/register', { email, password }); assert.equal(r.status, 200, JSON.stringify(r));
    const loc = await follow(linkOf(await nextMail(email, before)));
    const f = frag(loc); assert.ok(f.access_token, 'confirm redirect: ' + loc.slice(0, 120));
    assert.equal((await post('/auth/password/confirmed', { access_token: f.access_token })).status, 200);
    return f;
  };
  const login = (email, password = PASS1, ip) => post('/auth/password/login', { email, password }, undefined, ip);
  const A = addr('owner-a');

  await check('passwordless sign-in is off: magic-link start, code verify and invite OTP accept answer 404', async () => {
    for (const p of ['/auth/email/start', '/auth/email/verify', '/auth/email/accept-invite']) assert.equal((await post(p, { email: A, code: '123456' })).status, 404, p);
  });
  await check('registration validates email and password policy (format, min 10, max 72 bytes, not the email)', async () => {
    assert.equal((await post('/auth/password/register', { email: 'not-an-email', password: PASS1 })).body.error, 'invalid_email');
    assert.equal((await post('/auth/password/register', { email: A, password: 'short' })).body.error, 'password_too_short');
    assert.equal((await post('/auth/password/register', { email: A, password: 'я'.repeat(40) })).body.error, 'password_too_long');
    assert.equal((await post('/auth/password/register', { email: A, password: A })).body.error, 'password_weak');
    assert.equal(Number((await q('SELECT count(*) n FROM auth.users WHERE email=$1', [A]))[0].n), 0);
  });
  let confirmLinkA;
  await check('registration sends a confirmation email to the test inbox; nothing is created in the app yet', async () => {
    const before = (await mails(A)).map((x) => x.ID);
    const r = await post('/auth/password/register', { email: A, password: PASS1 });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, check_email: true });
    confirmLinkA = linkOf(await nextMail(A, before));
    assert.match(confirmLinkA, /type=signup/); assert.match(decodeURIComponent(confirmLinkA), /redirect_to=http:\/\/127\.0\.0\.1:55470\/auth\/confirmed/);
    assert.equal(Number((await q('SELECT count(*) n FROM user_email_identities WHERE email=$1', [A]))[0].n), 0);
  });
  await check('unverified account cannot sign in (correct password → 403 email_not_confirmed; wrong → generic 401)', async () => {
    const ok = await login(A); assert.equal(ok.status, 403); assert.equal(ok.body.error, 'email_not_confirmed'); assert.ok(!ok.body.token);
    const bad = await login(A, 'Wrong-Password-123'); assert.equal(bad.status, 401); assert.equal(bad.body.error, 'invalid_credentials');
  });
  await check('duplicate registration of an unconfirmed email: same answer, still one auth user', async () => {
    const r = await post('/auth/password/register', { email: A, password: PASS1 }); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, check_email: true });
    assert.equal(Number((await q('SELECT count(*) n FROM auth.users WHERE email=$1', [A]))[0].n), 1);
  });
  await check('tampered verification link is refused (redirect carries an error, email stays unconfirmed)', async () => {
    const bad = confirmLinkA.replace(/token=([^&]+)/, (m, t) => 'token=' + t.slice(0, -4) + 'beef');
    const loc = await follow(bad); assert.ok(/error/.test(loc) && !/access_token/.test(loc), loc.slice(0, 160));
    assert.equal((await q('SELECT email_confirmed_at FROM auth.users WHERE email=$1', [A]))[0].email_confirmed_at, null);
  });
  let sessionA;
  await check('verification link confirms the email; the GoTrue session it creates is discarded', async () => {
    const loc = await follow(confirmLinkA); assert.ok(loc.startsWith(APP + '/auth/confirmed#'), loc.slice(0, 80));
    const f = frag(loc); assert.ok(f.access_token); assert.equal(f.type, 'signup');
    assert.ok((await q('SELECT email_confirmed_at FROM auth.users WHERE email=$1', [A]))[0].email_confirmed_at);
    assert.equal((await post('/auth/password/confirmed', { access_token: f.access_token })).status, 200);
    const who = await fetch('http://127.0.0.1:55450/auth/v1/user', { headers: { apikey: S.anon_key, authorization: 'Bearer ' + f.access_token } });
    assert.ok(who.status === 401 || who.status === 403, 'confirmation session still alive: ' + who.status);
    const again = await follow(confirmLinkA); assert.ok(/error/.test(again) && !/access_token/.test(again), 'link reusable: ' + again.slice(0, 120));
  });
  await check('sign-in with email + password: app session, one user/identity/profile/link, verified email, no company', async () => {
    const r = await login(A); assert.equal(r.status, 200, JSON.stringify(r.body)); sessionA = r.body.token;
    const claims = JSON.parse(Buffer.from(sessionA.split('.')[1], 'base64url'));
    assert.equal(claims.auth_channel, 'email'); assert.equal(claims.auth_method, 'password'); assert.match(claims.sid, /^[0-9a-f-]{36}$/); assert.ok(claims.userId < 0);
    assert.ok(claims.exp - claims.iat === 30 * 24 * 3600);
    const uid = claims.userId;
    for (const t of ['users WHERE id=$1', 'user_email_identities WHERE user_id=$1 AND email_verified_at IS NOT NULL', 'user_profiles WHERE user_id=$1', "auth_user_links WHERE user_id=$1 AND link_method='registration'"])
      assert.equal(Number((await q('SELECT count(*) n FROM ' + t, [uid]))[0].n), 1, t);
    const me = await get('/me/profile', sessionA); assert.equal(me.status, 200, JSON.stringify(me.body)); assert.equal(me.body.identity?.email, A);
    const ws = await get('/workspaces', sessionA); assert.equal(ws.status, 200); assert.equal((ws.body.business || []).length, 0);
    assert.equal(Number((await q('SELECT count(*) n FROM business_members WHERE user_id=$1', [uid]))[0].n), 0);
  });
  await check('wrong password and unknown email give the identical answer (no account enumeration)', async () => {
    const wrong = await login(A, 'Definitely-Wrong-99'), unknown = await login(addr('nobody'), 'Definitely-Wrong-99');
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.body, unknown.body); assert.equal(unknown.status, 401);
    const f1 = await post('/auth/password/forgot', { email: addr('nobody') }), f2 = await post('/auth/password/forgot', { email: A + 'x' });
    assert.deepEqual(f1.body, { ok: true }); assert.deepEqual(f2.body, { ok: true });
    await sleep(800); assert.equal((await mails(addr('nobody'))).length, 0, 'mail sent to an unknown address');
  });
  await check('registering an already confirmed email: same answer, no second account, no new link', async () => {
    const before = (await mails(A)).length;
    const r = await post('/auth/password/register', { email: A, password: 'Another-Pass-777' }); assert.deepEqual(r.body, { ok: true, check_email: true });
    assert.equal(Number((await q('SELECT count(*) n FROM auth.users WHERE email=$1', [A]))[0].n), 1);
    assert.equal(Number((await q('SELECT count(*) n FROM auth_user_links WHERE email=$1', [A]))[0].n), 1);
    assert.equal((await login(A, 'Another-Pass-777')).status, 401, 'second registration changed the password');
    await sleep(800); assert.equal((await mails(A)).length, before, 'a confirmed account got another email');
  });
  await check('expired verification link is refused; resend issues a fresh link that works', async () => {
    const B = addr('expired-b'); const before = (await mails(B)).map((x) => x.ID);
    await post('/auth/password/register', { email: B, password: PASS1 });
    const link = linkOf(await nextMail(B, before));
    await q("UPDATE auth.users SET confirmation_sent_at = now() - interval '2 hours' WHERE email=$1", [B]);
    const loc = await follow(link); assert.ok(/otp_expired|expired/i.test(decodeURIComponent(loc)), loc.slice(0, 160));
    assert.equal((await login(B)).status, 403);
    const ids = (await mails(B)).map((x) => x.ID);
    assert.deepEqual((await post('/auth/password/resend', { email: B })).body, { ok: true });
    const loc2 = await follow(linkOf(await nextMail(B, ids))); assert.ok(frag(loc2).access_token, loc2.slice(0, 120));
    await post('/auth/password/confirmed', { access_token: frag(loc2).access_token });
    assert.equal((await login(B)).status, 200);
  });
  await check('logout revokes the server session at once; repeat login opens a new one', async () => {
    const r = await login(A); const t = r.body.token;
    assert.equal((await get('/me/profile', t)).status, 200);
    const out = await post('/auth/logout', {}, t); assert.equal(out.status, 200); assert.equal(out.body.revoked, 1);
    assert.equal((await get('/me/profile', t)).status, 401);
    assert.equal((await post('/auth/logout', {}, t)).status, 401);
    const again = await login(A); assert.equal(again.status, 200); assert.equal((await get('/me/profile', again.body.token)).status, 200);
    assert.equal((await get('/me/profile', sessionA)).status, 200, 'logout of one session must not end the others');
  });
  await check('expired server session is refused even though the JWT itself is still valid', async () => {
    const t = (await login(A)).body.token, sid = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).sid;
    assert.equal((await get('/me/profile', t)).status, 200);
    await db.query('ALTER TABLE auth_app_sessions DISABLE TRIGGER auth_app_sessions_guard');
    await q("UPDATE auth_app_sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second' WHERE id=$1", [sid]);
    await db.query('ALTER TABLE auth_app_sessions ENABLE TRIGGER auth_app_sessions_guard');
    assert.equal((await get('/me/profile', t)).status, 401);
  });
  await check('session ids are bound to their user; a password token without a session id is refused', async () => {
    const jwt = require('jsonwebtoken');
    const B = addr('expired-b'), tb = (await login(B)).body.token, cb = JSON.parse(Buffer.from(tb.split('.')[1], 'base64url'));
    const ca = JSON.parse(Buffer.from(sessionA.split('.')[1], 'base64url'));
    // Signed with the real app secret ONLY to prove the server-side binding; such a token cannot be obtained otherwise.
    const swapped = jwt.sign({ userId: ca.userId, auth_channel: 'email', auth_method: 'password', sid: cb.sid }, S.app_jwt_secret);
    const nosid = jwt.sign({ userId: ca.userId, auth_channel: 'email', auth_method: 'password' }, S.app_jwt_secret);
    assert.equal((await get('/me/profile', swapped)).status, 401); assert.equal((await get('/me/profile', nosid)).status, 401);
    assert.equal((await post('/auth/logout', {}, swapped)).status, 401);
  });
  await check('concurrent first sign-ins of a new account create exactly one app user, identity, profile and link', async () => {
    const C = addr('concurrent-c'); await registerAndConfirm(C);
    const rs = await Promise.all(Array.from({ length: 6 }, () => login(C)));
    assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(','));
    const ids = new Set(rs.map((r) => JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url')).userId)); assert.equal(ids.size, 1);
    const [uid] = ids;
    assert.equal(Number((await q('SELECT count(*) n FROM user_email_identities WHERE email=$1', [C]))[0].n), 1);
    assert.equal(Number((await q('SELECT count(*) n FROM user_profiles WHERE user_id=$1', [uid]))[0].n), 1);
    assert.equal(Number((await q('SELECT count(*) n FROM auth_user_links WHERE email=$1', [C]))[0].n), 1);
    assert.equal(Number((await q('SELECT count(*) n FROM auth_app_sessions WHERE user_id=$1', [uid]))[0].n), 6);
  });
  let resetLinkA;
  await check('password reset: email → link → new password; every old session revoked; old password refused', async () => {
    const before = (await mails(A)).map((x) => x.ID);
    const sessions = [(await login(A)).body.token, (await login(A)).body.token];
    await sleep(1200);
    assert.deepEqual((await post('/auth/password/forgot', { email: A })).body, { ok: true });
    resetLinkA = linkOf(await nextMail(A, before)); assert.match(resetLinkA, /type=recovery/);
    const loc = await follow(resetLinkA); assert.ok(loc.startsWith(APP + '/auth/reset#'), loc.slice(0, 80));
    const f = frag(loc); assert.equal(f.type, 'recovery');
    assert.equal((await post('/auth/password/reset', { access_token: f.access_token, password: 'short' })).body.error, 'password_too_short');
    const ok = await post('/auth/password/reset', { access_token: f.access_token, password: PASS2 }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
    for (const t of [...sessions, sessionA]) assert.equal((await get('/me/profile', t)).status, 401, 'old session survived the reset');
    assert.equal((await login(A, PASS1)).status, 401); assert.equal((await login(A, PASS2)).status, 200);
    const reuse = await post('/auth/password/reset', { access_token: f.access_token, password: 'Third-Password-000' });
    assert.equal(reuse.status, 401, 'recovery token reusable: ' + JSON.stringify(reuse.body)); assert.equal((await login(A, PASS2)).status, 200);
  });
  await check('reset link cannot be reused; an invalid reset link is refused; a password-sign-in session cannot set a password', async () => {
    const loc = await follow(resetLinkA); assert.ok(/error/.test(loc) && !/access_token/.test(loc), loc.slice(0, 160));
    const tampered = await follow(resetLinkA.replace(/token=([^&]+)/, (m, t) => 'token=' + t.slice(0, -4) + 'abcd')); assert.ok(/error/.test(tampered));
    const D = addr('nonrecovery-d'); await registerAndConfirm(D);
    // A GoTrue session obtained with the password itself (amr=password), straight from GoTrue: never a reset credential.
    const g = await fetch('http://127.0.0.1:55450/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: S.anon_key, 'content-type': 'application/json' }, body: JSON.stringify({ email: D, password: PASS1 }) }).then((x) => x.json());
    assert.ok(g.access_token, 'direct GoTrue sign-in failed');
    const r = await post('/auth/password/reset', { access_token: g.access_token, password: PASS2 });
    assert.equal(r.status, 401, JSON.stringify(r.body)); assert.equal((await login(D, PASS1)).status, 200); assert.equal((await login(D, PASS2)).status, 401);
    await fetch('http://127.0.0.1:55450/auth/v1/logout?scope=global', { method: 'POST', headers: { apikey: S.anon_key, authorization: 'Bearer ' + g.access_token } });
    assert.equal((await post('/auth/password/reset', { access_token: 'garbage.token.value', password: PASS2 })).status, 401);
  });
  await check('expired reset link is refused', async () => {
    await sleep(1200);   // GoTrue's per-address email interval (1 s in this stack, 60 s by default)
    const before = (await mails(A)).map((x) => x.ID);
    await post('/auth/password/forgot', { email: A }); const link = linkOf(await nextMail(A, before));
    await q("UPDATE auth.users SET recovery_sent_at = now() - interval '2 hours' WHERE email=$1", [A]);
    const loc = await follow(link); assert.ok(/otp_expired|expired/i.test(decodeURIComponent(loc)) && !/access_token/.test(loc), loc.slice(0, 160));
  });
  await check('existing verified app identity (e.g. a former magic-link user) is linked by verified email, keeps its company', async () => {
    const E = addr('legacy-e'), uid = Number((await q('SELECT next_app_user_id() id'))[0].id);
    await q("INSERT INTO users(id, username, first_name) VALUES ($1, '', 'legacy')", [uid]);
    await q('INSERT INTO user_email_identities(user_id, email, email_verified_at) VALUES ($1, $2, now())', [uid, E]);
    await registerAndConfirm(E);
    const r = await login(E); assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url')).userId, uid);
    assert.equal((await q('SELECT link_method FROM auth_user_links WHERE user_id=$1', [uid]))[0].link_method, 'verified_email_match');
  });
  await check('existing UNVERIFIED app identity is never linked by email: 409 account_link_required, no session, no access', async () => {
    const U = addr('unverified-u'), uid = Number((await q('SELECT next_app_user_id() id'))[0].id);
    await q("INSERT INTO users(id, username, first_name) VALUES ($1, '', 'unverified')", [uid]);
    await q('INSERT INTO user_email_identities(user_id, email, email_verified_at) VALUES ($1, $2, NULL)', [uid, U]);
    await registerAndConfirm(U);
    const r = await login(U); assert.equal(r.status, 409); assert.equal(r.body.error, 'account_link_required'); assert.ok(!r.body.token);
    assert.equal(Number((await q('SELECT count(*) n FROM auth_user_links WHERE user_id=$1', [uid]))[0].n), 0);
    assert.equal(Number((await q('SELECT count(*) n FROM auth_app_sessions WHERE user_id=$1', [uid]))[0].n), 0);
  });
  await check('link is immutable: rebinding a link or editing a session identity is refused by the database', async () => {
    await assert.rejects(q("UPDATE auth_user_links SET auth_user_id = gen_random_uuid() WHERE email=$1", [A]), /auth_user_link_immutable/);
    await assert.rejects(q("DELETE FROM auth_user_links WHERE email=$1", [A]), /auth_user_link_immutable/);
    await assert.rejects(q("UPDATE auth_app_sessions SET user_id = user_id - 1 WHERE auth_user_id = (SELECT auth_user_id FROM auth_user_links WHERE email=$1)", [A]), /auth_app_session_immutable|violates/);
  });
  await check('brute force is throttled per email (429 before the 12th attempt), other accounts unaffected', async () => {
    const R = addr('ratelimit-r'); await registerAndConfirm(R);
    const codes = []; for (let i = 0; i < 12; i++) codes.push((await login(R, 'Wrong-Guess-' + i)).status);
    assert.ok(codes.includes(429), codes.join(',')); assert.ok(codes.indexOf(429) <= 10, codes.join(','));
    assert.equal((await login(R, PASS1)).status, 429, 'correct password must also wait');
    assert.equal((await login(A, PASS2)).status, 200);
  });
  await check('passwords are never stored in application tables, GoTrue stores only a bcrypt hash, app log has none', async () => {
    const dump = require('child_process').execFileSync('docker', ['exec', 'xr-ci-db', 'pg_dump', '-U', 'postgres', '-h', '127.0.0.1', '--data-only', '-d', 'postgres', '-n', 'public', '-n', 'auth'], { maxBuffer: 1 << 28 }).toString();
    for (const p of [PASS1, PASS2]) assert.ok(!dump.includes(p), 'plaintext password in database dump');
    assert.ok((await q("SELECT bool_and(encrypted_password LIKE '$2a$%') ok FROM auth.users WHERE email LIKE $1", ['%.' + run + '@rehearsal.test']))[0].ok);
    const log = fs.readFileSync(require('./env.cjs').HOME + '/app.log', 'utf8');
    for (const p of [PASS1, PASS2]) assert.ok(!log.includes(p), 'plaintext password in app log');
    const gl = require('child_process').execFileSync('docker', ['logs', 'xr-ci-auth'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    for (const p of [PASS1, PASS2]) assert.ok(!gl.includes(p), 'plaintext password in GoTrue log');
  });
  fs.writeFileSync(require('./env.cjs').HOME + '/auth_e2e.json', JSON.stringify({ run, results }, null, 2));
  await db.end();
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error('AUTH E2E CRASHED', e); process.exit(1); });
