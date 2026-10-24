'use strict';
// The real V2 sign-in screen, as the release build serves it. Default AUTH_UI=password: Email + Password
// (client VITE_PASSWORD_AUTH_ENABLED=true, server PASSWORD_AUTH_ENABLED=true). AUTH_UI=link keeps the
// passwordless link screen for builds that still use it.
// Password setup is test data, like a person who registered and confirmed their email: the synthetic user's
// confirmed Supabase Auth account gets a fresh random password through the Auth admin API of the ISOLATED
// stack (PLATFORM_URL + SUPABASE_SERVICE_KEY). The password lives in memory only, never in evidence or logs.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const MODE = process.env.AUTH_UI || 'password';

async function ensurePassword(email) {
  const base = String(process.env.PLATFORM_URL || '').replace(/\/$/, '') + '/auth/v1/admin/users';
  const key = process.env.SUPABASE_SERVICE_KEY;
  assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):/.test(base), 'password setup only on the isolated local stack');
  assert.ok(key, 'SUPABASE_SERVICE_KEY required for test password setup');
  const h = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const password = 'Rc-' + crypto.randomBytes(12).toString('base64url');
  let found = null;
  for (let pageNo = 1; pageNo <= 20 && !found; pageNo++) {
    const r = await fetch(`${base}?page=${pageNo}&per_page=200`, { headers: h });
    assert.equal(r.status, 200, 'auth admin list ' + r.status);
    const users = (await r.json()).users || [];
    found = users.find((u) => String(u.email).toLowerCase() === email.toLowerCase()) || null;
    if (users.length < 200) break;
  }
  const r = found
    ? await fetch(`${base}/${found.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ password, email_confirm: true }) })
    : await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.ok(r.ok, 'auth admin write ' + r.status);
  return password;
}

async function signIn(page, origin, person) {
  if (MODE === 'link') {
    await page.goto(origin + '/login/email', { waitUntil: 'networkidle' });
    await page.locator('input[type=email]').fill(person.email);
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/email/start') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Get a sign-in link', exact: true }).click()]);
    assert.ok((await response.json()).magic_link, 'Synthetic login link missing');
    await page.getByRole('link', { name: 'open the sign-in link', exact: true }).click();
  } else {
    const password = await ensurePassword(person.email);
    await page.goto(origin + '/login', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('input[type=password]').count(), 1, 'the served build must show the password screen');
    await page.locator('input[type=email]').fill(person.email);
    await page.locator('input[type=password]').fill(password);
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/password/login') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
    assert.equal(response.status(), 200, 'password sign-in ' + response.status());
  }
  await page.waitForFunction(() => !!localStorage.getItem('hf_token'));
  await page.waitForURL('**/account');
}

module.exports = { signIn, ensurePassword, MODE };
