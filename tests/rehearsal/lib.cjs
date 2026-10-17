'use strict';
// Shared helpers for the clean-install rehearsal scripts: API calls, real registration through the test inbox,
// sign-in with email + password (no minted JWTs), a result collector, and a DB client for verification only.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { Client } = require('pg');
const S = require('./env.cjs').secrets();
const API = 'http://127.0.0.1:55460/api', MAIL = 'http://127.0.0.1:55441/api/v1';
let ipSeq = 0;
const freshIp = () => `10.88.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250 + 1}`;
async function call(method, path, { body, token, biz, headers = {}, raw = false } = {}) {
  const h = { 'x-forwarded-for': freshIp(), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(biz ? { 'x-business-id': biz } : {}), ...headers };
  let payload;
  if (body instanceof FormData) payload = body; else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + path, { method, headers: h, body: payload });
  if (raw) return r;
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, body: data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mails(to) { const r = await fetch(`${MAIL}/search?query=${encodeURIComponent('to:' + to)}`).then((x) => x.json()); return r.messages || []; }
async function nextMail(to, before) {
  for (let i = 0; i < 60; i++) { const m = (await mails(to)).filter((x) => !before.includes(x.ID)); if (m.length) return fetch(`${MAIL}/message/${m[0].ID}`).then((x) => x.json()); await sleep(250); }
  throw Error('no email for ' + to);
}
const linkOf = (msg) => { const m = /http:\/\/127\.0\.0\.1:55450\/auth\/v1\/verify\?[^\s"'<>)\]]+/.exec(msg.Text || ''); if (!m) throw Error('no link'); return m[0]; };
const frag = (loc) => Object.fromEntries(new URLSearchParams((loc.split('#')[1]) || ''));
// Real registration: API register → confirmation email → open link → discard link session → sign in.
async function signUp(email, password) {
  const before = (await mails(email)).map((x) => x.ID);
  const r = await call('POST', '/auth/password/register', { body: { email, password } }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const loc = (await fetch(linkOf(await nextMail(email, before)), { redirect: 'manual' })).headers.get('location') || '';
  const f = frag(loc); assert.ok(f.access_token, 'confirmation failed: ' + loc.slice(0, 100));
  await call('POST', '/auth/password/confirmed', { body: { access_token: f.access_token } });
  return signIn(email, password);
}
async function signIn(email, password) {
  const r = await call('POST', '/auth/password/login', { body: { email, password } }); assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, email };
}
// Sign in an account that may already exist (re-runs), otherwise register it through the inbox.
async function ensureUser(email, password) {
  const r = await call('POST', '/auth/password/login', { body: { email, password } });
  if (r.status === 200) return { token: r.body.token, id: r.body.user.id, email };
  return signUp(email, password);
}
function collector(file) {
  const results = [];
  const check = async (name, fn) => { try { const v = await fn(); results.push({ name, ok: true, ...(v && typeof v === 'object' ? { evidence: v } : {}) }); console.log('PASS', name) } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL', name, '-', e.message.slice(0, 400)) } };
  const save = (extra = {}) => { fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...extra, results }, null, 2)); console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`); return results.every((r) => r.ok); };
  return { check, save, results };
}
async function db() { const c = new Client({ connectionString: `postgresql://postgres:${S.db_password}@127.0.0.1:55440/postgres` }); await c.connect(); return c; }
const key = () => crypto.randomUUID();
const state = (patch) => { const f = require('./env.cjs').HOME + '/state.json'; const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; if (patch) { Object.assign(s, patch); fs.writeFileSync(f, JSON.stringify(s, null, 2)); } return s; };
module.exports = { assert, call, sleep, mails, nextMail, linkOf, frag, signUp, signIn, ensureUser, collector, db, key, state, S };
