// emailSender — Resend payload shape + safety. Pure (injected fetch/log). No network.
const { test } = require('node:test');
const assert = require('node:assert');
const { sendMagicLinkEmail, magicLinkHtml, magicLinkText } = require('../../server/lib/emailSender');

const URL = 'https://app.example.com/login/email/callback?token=deadbeef';
const base = { provider: 'resend', apiKey: 'testkey123', from: 'CFO AI <login@auth.example.com>', toEmail: 'u@x.com', magicLinkUrl: URL };
const noopLog = { warn() {}, log() {} };

test('resend: correct endpoint, auth header, and payload shape', async () => {
  let captured = null;
  const fetchImpl = async (u, opts) => { captured = { u, opts }; return { ok: true, status: 200 }; };
  const r = await sendMagicLinkEmail({ ...base, fetchImpl, log: noopLog });
  assert.equal(r.ok, true);
  assert.equal(captured.u, 'https://api.resend.com/emails');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer testkey123');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.from, base.from);
  assert.equal(body.to, 'u@x.com');
  assert.equal(body.subject, 'Sign in to CFO AI');
  assert.ok(body.html.includes(URL) && body.html.toLowerCase().includes('sign in'));
  assert.ok(body.text.includes(URL));
  assert.ok(/expires/i.test(body.html) && /expires/i.test(body.text)); // expiry mentioned
});

test('API key never appears in the return value', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const r = await sendMagicLinkEmail({ ...base, fetchImpl, log: noopLog });
  assert.ok(!JSON.stringify(r).includes('testkey123'));
});

test('provider not resend → skipped (no send)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true }; };
  const r = await sendMagicLinkEmail({ ...base, provider: '', fetchImpl, log: noopLog });
  assert.deepEqual(r, { ok: false, skipped: 'no_provider' });
  assert.equal(called, false);
});

test('missing api key / from → not_configured (no send)', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true }; };
  const r1 = await sendMagicLinkEmail({ ...base, apiKey: '', fetchImpl, log: noopLog });
  const r2 = await sendMagicLinkEmail({ ...base, from: '', fetchImpl, log: noopLog });
  assert.equal(r1.skipped, 'not_configured');
  assert.equal(r2.skipped, 'not_configured');
  assert.equal(called, false);
});

test('non-2xx response → { ok:false, status }', async () => {
  const fetchImpl = async () => ({ ok: false, status: 422 });
  const r = await sendMagicLinkEmail({ ...base, fetchImpl, log: noopLog });
  assert.deepEqual(r, { ok: false, status: 422 });
});

test('fetch throws → { ok:false, error:send_error } (non-fatal)', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const r = await sendMagicLinkEmail({ ...base, fetchImpl, log: noopLog });
  assert.deepEqual(r, { ok: false, error: 'send_error' });
});

test('email content has no financial data words', async () => {
  const html = magicLinkHtml(URL), text = magicLinkText(URL);
  assert.ok(!/wallet|transaction|balance|invoice|payable|receivable/i.test(html));
  assert.ok(!/wallet|transaction|balance|invoice|payable|receivable/i.test(text));
});
