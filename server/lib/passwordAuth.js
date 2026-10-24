'use strict';
// Email + Password sign-in through Supabase Auth (GoTrue). Migration 074. Gated by PASSWORD_AUTH_ENABLED (404 when off).
//
// Supabase Auth owns the credential: password hashing, the confirmation email, the reset email, its own rate limits.
// The backend never stores or logs a password; it forwards it to GoTrue once and drops it.
// The application identity and session stay the existing ones: after GoTrue accepts the password for a CONFIRMED
// email, rpc_auth_password_session links the auth user id to the app user (immutable) and opens a server-side
// session in one transaction; the app JWT is the usual { userId, firstName, auth_channel:'email' } plus
// auth_method:'password' and sid (checked on every request by sessionUser.js, so logout/reset revoke it).
// GoTrue's own session is discarded immediately: the browser never holds a Supabase session.
//
// Routes (public unless noted):
//   POST /api/auth/password/register  { email, password }   → { ok, check_email }   (same answer for existing accounts)
//   POST /api/auth/password/resend    { email }             → { ok }                 (confirmation email again)
//   POST /api/auth/password/login     { email, password }   → { token, user }
//   POST /api/auth/password/forgot    { email }             → { ok }                 (reset email; same answer for unknown)
//   POST /api/auth/password/reset     { access_token, password } → { ok }           (token from the reset link)
//   POST /api/auth/password/confirmed { access_token }      → { ok }                 (drops the session the confirm link made)
//   POST /api/auth/logout             (signed in)           → { ok, revoked }
const jwt = require('jsonwebtoken');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TTL_S = 30 * 24 * 3600; // the app JWT lifetime every channel already uses
const LIMITS = {
  register: [5, 3600e3, 20], resend: [5, 3600e3, 20], forgot: [5, 3600e3, 20],
  login: [10, 900e3, 60], reset: [10, 3600e3, 30], confirmed: [30, 3600e3, 60],
};

function passwordProblem(password, email) {
  if (typeof password !== 'string') return 'password_required';
  if (password.length < 10) return 'password_too_short';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'password_too_long';  // bcrypt reads 72 bytes only
  if (password.trim().toLowerCase() === String(email || '').toLowerCase()) return 'password_weak';
  return null;
}

// Payload of a GoTrue access token, only to read amr after GoTrue itself has accepted the token.
function tokenClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

function createGoTrue({ url, apiKey, fetchImpl = fetch }) {
  const base = String(url || '').replace(/\/$/, '') + '/auth/v1';
  return async function call(path, { method = 'POST', body, token, query, clientIp } = {}) {
    const q = query ? '?' + new URLSearchParams(query).toString() : '';
    const headers = { apikey: apiKey, 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    // Supabase Auth rate-limits per IP; every call comes from this server. With forwarding enabled (secret API key
    // + project setting / GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED), Auth limits the end user's IP instead.
    if (clientIp) headers['sb-forwarded-for'] = clientIp;
    const r = await fetchImpl(base + path + q, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    const code = data?.error_code || data?.code || data?.error || null;
    return { ok: r.ok, status: r.status, data, code: typeof code === 'string' ? code : null };
  };
}

function install(app, { auth, supabase, enabled, gotrueUrl, apiKey, jwtSecret, appBaseUrl, rateLimited, log = console, ttlSeconds = DEFAULT_TTL_S, fetchImpl, forwardClientIp = false }) {
  if (!enabled) return { enabled: false };
  if (!gotrueUrl || !apiKey || !jwtSecret || !appBaseUrl) throw new Error('password_auth_misconfigured: SUPABASE_URL, SUPABASE_SECRET_KEY, JWT_SECRET and APP_BASE_URL are required');
  const gotrue0 = createGoTrue({ url: gotrueUrl, apiKey, fetchImpl });
  // Same calls, with the trusted client IP forwarded when enabled (AUTH_FORWARD_CLIENT_IP=true).
  const gotrue = (path, opts = {}) => gotrue0(path, { ...opts, clientIp: forwardClientIp ? opts.clientIp : undefined });
  const redirect = (path) => appBaseUrl.replace(/\/$/, '') + path;
  const email = (v) => String(v || '').trim().toLowerCase();
  // The right-most X-Forwarded-For entry is the one the platform proxy appended; earlier entries are client-supplied.
  const ip = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket?.remoteAddress || 'ip';
  const limited = (kind, req, em) => {
    const [perEmail, windowMs, perIp] = LIMITS[kind];
    return (em && rateLimited(`pw-${kind}:${em}`, perEmail, windowMs)) || rateLimited(`pw-${kind}-ip:${ip(req)}`, perIp, windowMs);
  };
  // Sign-in: every attempt counts per IP, but only FAILED attempts count per account (a person signing in from
  // several devices is not throttled; a password guesser is, whatever IPs it rotates through).
  const failures = new Map();
  const [maxFailures, failureWindowMs] = LIMITS.login;
  const lockedOut = (em) => { const f = failures.get(em); return !!f && Date.now() < f.reset && f.n >= maxFailures; };
  const failed = (em) => {
    const now = Date.now(), f = failures.get(em);
    if (!f || now >= f.reset) { if (failures.size > 10000) failures.clear(); failures.set(em, { n: 1, reset: now + failureWindowMs }); } else f.n += 1;
  };
  const unavailable = (res) => res.status(503).json({ error: 'auth_temporarily_unavailable', message: 'Sign-in is temporarily unavailable. Please try again in a few minutes.' });
  const noStore = (res) => res.set({ 'Cache-Control': 'private, no-store' });
  // Drop a GoTrue session we do not use. Failure only leaves a session nobody holds; never fatal.
  const discard = (token, scope = 'local') => gotrue('/logout', { token, query: { scope } }).catch(() => null);

  app.post('/api/auth/password/register', async (req, res) => {
    noStore(res);
    try {
      const em = email(req.body?.email);
      if (!EMAIL_RE.test(em)) return res.status(400).json({ error: 'invalid_email' });
      const problem = passwordProblem(req.body?.password, em);
      if (problem) return res.status(400).json({ error: problem });
      if (limited('register', req, em)) return res.status(429).json({ error: 'rate_limited' });
      const r = await gotrue('/signup', { body: { email: em, password: req.body.password }, query: { redirect_to: redirect('/auth/confirmed') }, clientIp: ip(req) });
      if (r.code === 'weak_password') return res.status(400).json({ error: 'password_weak' });
      // An existing account gets the same answer (GoTrue returns an obfuscated user and sends nothing new), and so
      // does a repeat inside GoTrue's per-address email interval: the first email is on its way.
      if (r.ok || ['user_already_exists', 'email_exists', 'over_email_send_rate_limit'].includes(r.code)) return res.json({ ok: true, check_email: true });
      if (r.status === 429 || r.code === 'over_request_rate_limit') return res.status(429).json({ error: 'rate_limited' });
      if (r.code === 'email_address_invalid' || r.code === 'validation_failed') return res.status(400).json({ error: 'invalid_email' });
      log.error(`[password-auth] signup failed: ${r.status} ${r.code || ''}`);
      return unavailable(res);
    } catch (e) { log.error(`[password-auth] signup error: ${e.message}`); return unavailable(res); }
  });

  for (const [route, kind, path, extra] of [['/api/auth/password/resend', 'resend', '/resend', { type: 'signup' }], ['/api/auth/password/forgot', 'forgot', '/recover', null]]) {
    app.post(route, async (req, res) => {
      noStore(res);
      try {
        const em = email(req.body?.email);
        if (!EMAIL_RE.test(em)) return res.status(400).json({ error: 'invalid_email' });
        if (limited(kind, req, em)) return res.status(429).json({ error: 'rate_limited' });
        const target = kind === 'forgot' ? '/auth/reset' : '/auth/confirmed';
        const r = await gotrue(path, { body: { email: em, ...(extra || {}) }, query: { redirect_to: redirect(target) }, clientIp: ip(req) });
        if (r.code !== 'over_email_send_rate_limit' && (r.status === 429 || /rate_limit/.test(r.code || ''))) return res.status(429).json({ error: 'rate_limited' });
        // A 5xx here comes after Auth looked the address up (e.g. it could not SEND the email, which only happens
        // for a real account), so a different answer would reveal which addresses exist. Same answer; the
        // operator sees the failure in the log. Auth unreachable (no answer at all) stays 503 for every address.
        if (!r.ok && r.status >= 500) log.error(`[password-auth] ${kind} failed: ${r.status} ${r.code || ''}`);
        return res.json({ ok: true });   // unknown, confirmed or unconfirmed: the same answer
      } catch (e) { log.error(`[password-auth] ${kind} error: ${e.message}`); return unavailable(res); }
    });
  }

  app.post('/api/auth/password/login', async (req, res) => {
    noStore(res);
    try {
      const em = email(req.body?.email);
      if (!EMAIL_RE.test(em) || typeof req.body?.password !== 'string' || !req.body.password) return res.status(400).json({ error: 'invalid_input' });
      if (lockedOut(em) || limited('login', req)) return res.status(429).json({ error: 'rate_limited' });
      const r = await gotrue('/token', { body: { email: em, password: req.body.password }, query: { grant_type: 'password' }, clientIp: ip(req) });
      if (!r.ok) {
        if (r.code === 'email_not_confirmed') return res.status(403).json({ error: 'email_not_confirmed' });
        if (r.status === 429 || /rate_limit/.test(r.code || '')) return res.status(429).json({ error: 'rate_limited' });
        if (r.status >= 400 && r.status < 500) { failed(em); return res.status(401).json({ error: 'invalid_credentials' }); }  // unknown email == wrong password
        log.error(`[password-auth] token failed: ${r.status} ${r.code || ''}`);
        return unavailable(res);
      }
      const authUser = r.data?.user, accessToken = r.data?.access_token;
      discard(accessToken);
      if (!authUser?.id || !authUser.email_confirmed_at) return res.status(403).json({ error: 'email_not_confirmed' });
      const { data, error } = await supabase.rpc('rpc_auth_password_session', {
        p_auth_user_id: authUser.id, p_email: authUser.email, p_email_confirmed_at: authUser.email_confirmed_at, p_ttl_seconds: ttlSeconds,
      });
      if (error) {
        const msg = error.message || '';
        if (/auth_link_unverified_identity|auth_link_conflict/.test(msg)) {
          log.warn(`[password-auth] link refused (${msg.match(/auth_link_[a-z_]+/)[0]}) for auth user ${authUser.id}`);
          return res.status(409).json({ error: 'account_link_required', message: 'This email belongs to an existing account that cannot be linked automatically. Contact support.' });
        }
        log.error(`[password-auth] session rpc failed: ${error.code || ''} ${msg.slice(0, 120)}`);
        return unavailable(res);
      }
      if (!data?.user_id || !data.session_id) return unavailable(res);
      const firstName = data.display_name || em.split('@')[0];
      const token = jwt.sign({ userId: data.user_id, firstName, auth_channel: 'email', auth_method: 'password', sid: data.session_id },
        jwtSecret, { expiresIn: ttlSeconds });
      return res.json({ token, user: { id: data.user_id, display_name: firstName }, expires_at: data.expires_at });
    } catch (e) { log.error(`[password-auth] login error: ${e.message}`); return unavailable(res); }
  });

  app.post('/api/auth/password/reset', async (req, res) => {
    noStore(res);
    try {
      const token = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
      if (!token || limited('reset', req)) return res.status(token ? 429 : 400).json({ error: token ? 'rate_limited' : 'invalid_or_expired_link' });
      const problem = passwordProblem(req.body?.password, '');
      if (problem) return res.status(400).json({ error: problem });
      const who = await gotrue('/user', { method: 'GET', token });
      // Only a fresh session created by an emailed link (GoTrue v2.195 marks reset-link sessions amr=otp) may set a
      // password without the old one; a session from a password sign-in never can.
      const claims = tokenClaims(token), amr = Array.isArray(claims.amr) ? claims.amr : [];
      const viaEmailLink = amr.some((a) => ['otp', 'recovery'].includes(a?.method)) && !amr.some((a) => a?.method === 'password');
      const fresh = Number(claims.iat) > Date.now() / 1000 - 3600;
      if (!who.ok || !who.data?.id || !viaEmailLink || !fresh) return res.status(401).json({ error: 'invalid_or_expired_link' });
      const upd = await gotrue('/user', { method: 'PUT', token, body: { password: req.body.password } });
      if (!upd.ok) {
        if (upd.code === 'same_password') return res.status(400).json({ error: 'same_password' });
        if (upd.code === 'weak_password') return res.status(400).json({ error: 'password_weak' });
        if (upd.status === 401 || upd.status === 403) return res.status(401).json({ error: 'invalid_or_expired_link' });
        log.error(`[password-auth] password update failed: ${upd.status} ${upd.code || ''}`);
        return unavailable(res);
      }
      // Policy: a reset signs the account out everywhere (app sessions and every GoTrue session, the link's included).
      const { error } = await supabase.rpc('rpc_auth_revoke_all_sessions', { p_auth_user_id: who.data.id, p_reason: 'password_reset' });
      if (error) log.error(`[password-auth] session revocation after reset failed: ${error.message}`);
      await discard(token, 'global');
      return res.json({ ok: true, sessions_revoked: !error });
    } catch (e) { log.error(`[password-auth] reset error: ${e.message}`); return unavailable(res); }
  });

  app.post('/api/auth/password/confirmed', async (req, res) => {
    noStore(res);
    const token = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
    if (token && !limited('confirmed', req)) await discard(token, 'global');
    return res.json({ ok: true });   // the confirmation itself already happened at GoTrue
  });

  app.post('/api/auth/logout', auth, async (req, res) => {
    noStore(res);
    const sid = req.user?.sid;
    if (!sid) return res.json({ ok: true, revoked: 0 });   // channels without a server session end on the client
    const { data, error } = await supabase.rpc('rpc_auth_end_session', { p_user_id: req.user.userId, p_session_id: sid });
    if (error) return res.status(503).json({ error: 'logout_unconfirmed' });
    return res.json({ ok: true, revoked: Number(data?.revoked || 0) });
  });

  return { enabled: true };
}

module.exports = { install, passwordProblem, createGoTrue, tokenClaims };
