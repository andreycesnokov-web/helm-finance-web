// Regression tests for the Admin Cleanup & Reset Console safety rules.
//
// These cover the failure modes Codex flagged, so they can never silently come back:
//   * a DB error must NEVER read as "0" / "no email" / "no memberships";
//   * anything unknown or truncated forces safe_to_archive_or_reset = false;
//   * archive/restore guards (reason, confirm, exact name, admin-only);
//   * audit failure ⇒ rollback, and the response must say TRUTHFULLY whether the
//     rollback actually succeeded;
//   * no raw DB/schema/network internals ever reach the client;
//   * debt rows are reported as debts, never as "invoices".
//
// Runs the REAL server/index.js as a child process against a scriptable fake PostgREST,
// so no Supabase/Docker is needed and production is never touched.
//   Run: node --test tests/integration/adminCleanup.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SECRET = 'cleanup-test-secret';
const BIZ_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = 777;
const APP_PORT = 3899, DB_PORT = 3898;
const APP = `http://127.0.0.1:${APP_PORT}`;

const adminJwt = jwt.sign({ userId: ADMIN_ID, firstName: 'Admin' }, SECRET);
const userJwt = jwt.sign({ userId: 5, firstName: 'User' }, SECRET);

let mode = 'ok';          // scenario switch, set per test
let patchCount = 0;       // used to fail only the ROLLBACK patch
let dbServer, appProc;

const BUSINESS = { id: BIZ_ID, name: 'Test Co', type: 'business', status: 'active', owner_user_id: 5 };

function startFakeDb() {
  return new Promise((resolve) => {
    dbServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const table = (req.url.split('?')[0] || '').replace('/rest/v1/', '');
        const single = (req.headers.accept || '').includes('vnd.pgrst.object');
        const json = (obj, code = 200, extra = {}) => {
          res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Range': '0-0/1', ...extra });
          res.end(JSON.stringify(obj));
        };
        const dbError = (msg) => json({ message: msg, code: '42P01', details: null, hint: null }, 500);

        // ---- count queries (HEAD) ----
        if (req.method === 'HEAD') {
          if (mode === 'user_counts_error' || mode === 'biz_counts_error') {
            res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end();
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-0/3' });
          return res.end();
        }

        // ---- audit writes ----
        if (table === 'audit_events' && req.method === 'POST') {
          // Every audit_fail* scenario starts by failing the audit write, which is what
          // triggers the rollback path we then script below.
          if (mode.startsWith('audit_fail')) return dbError('audit table unavailable');
          return json([]);
        }

        // ---- business status updates (archive / rollback) ----
        if (table === 'businesses' && req.method === 'PATCH') {
          patchCount++;
          const isRollback = patchCount >= 2;   // 1st patch = the archive itself
          if (isRollback) {
            // Fail ONLY the rollback so we can test the uncertain-state paths.
            if (mode === 'audit_fail_rollback_fail') return dbError('update failed');
            // No error, but ZERO rows affected — .single() surfaces this as an error.
            if (mode === 'audit_fail_rollback_norow') return json(single ? null : [], 406);
            // No error and a row, but the status was NOT restored.
            if (mode === 'audit_fail_rollback_wrongstatus') {
              const stuck = { ...BUSINESS, status: 'archived' };
              return json(single ? stuck : [stuck]);
            }
          }
          return json(single ? BUSINESS : [BUSINESS]);
        }

        // ---- reads ----
        if (table === 'businesses') {
          // Unreadable body ⇒ supabase-js surfaces an error instead of a row.
          if (mode === 'biz_preflight_unreadable') {
            res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{not-json');
          }
          if (mode === 'ownership_truncated') {
            // OWN_CAP is 200 — return exactly the cap so the list counts as truncated.
            return json(Array.from({ length: 200 }, (_, i) => ({
              id: `${i}`.padStart(8, '0') + '-1111-1111-1111-111111111111',
              name: `WS ${i}`, type: 'business', status: 'active',
            })));
          }
          return json(single ? BUSINESS : [BUSINESS]);
        }
        if (table === 'users') return json(single ? { id: 5, first_name: 'Test', username: 't' } : [{ id: 5, first_name: 'Test', username: 't' }]);
        if (table === 'user_email_identities') {
          if (mode === 'user_identity_error') return dbError('relation "user_email_identities" does not exist');
          return json([{ email: 'someone@example.com', email_verified_at: '2026-01-01' }]);
        }
        if (table === 'business_members') {
          if (mode === 'user_identity_error') return dbError('relation "business_members" does not exist');
          return json([]);
        }
        if (table === 'user_profiles') return json([{ display_name: 'Test', avatar_url: null }]);
        if (table === 'debts') {
          if (mode === 'biz_counts_error') return dbError('relation "debts" does not exist');
          return json([{ type: 'payable' }, { type: 'receivable' }]);
        }
        return json(single ? {} : []);
      });
    }).listen(DB_PORT, resolve);
  });
}

function startApp() {
  return new Promise((resolve, reject) => {
    appProc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${DB_PORT}`, SUPABASE_SECRET_KEY: 'x',
        BOT_TOKEN: 'x:x',
        // PR0.5: required at boot — the server refuses to start without it.
        TELEGRAM_WEBHOOK_SECRET: 'test-bot-secret', JWT_SECRET: SECRET, ADMIN_TELEGRAM_IDS: String(ADMIN_ID),
        EMAIL_AUTH_ENABLED: 'true', PORT: String(APP_PORT), NODE_ENV: 'production',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    appProc.on('error', reject);
    const t0 = Date.now();
    (async function wait() {
      while (Date.now() - t0 < 30000) {
        try { const r = await fetch(`${APP}/api/health`); if (r.ok) return resolve(); } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 200));
      }
      reject(new Error('app did not start'));
    })();
  });
}

const call = async (method, url, { token, body } = {}) => {
  const res = await fetch(APP + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
};
const userPreflight = (token = adminJwt) => call('GET', '/api/admin/users/5/cleanup-preflight', { token });
const bizPreflight = () => call('GET', `/api/admin/businesses/${BIZ_ID}/cleanup-preflight`, { token: adminJwt });
const archive = (body) => call('POST', `/api/admin/businesses/${BIZ_ID}/archive`, { token: adminJwt, body });
const VALID_ARCHIVE = { reason: 'duplicate test workspace', confirm: true, confirm_name: 'Test Co' };
// Anything that is not raw DB/schema/network detail.
const NO_INTERNALS = /relation|column|schema|42P01|ECONN|fetch failed|TypeError|does not exist/i;

test.before(async () => { await startFakeDb(); await startApp(); });
test.after(() => { try { appProc?.kill(); } catch {} try { dbServer?.close(); } catch {} });
test.beforeEach(() => { mode = 'ok'; patchCount = 0; });

// ── access control ──────────────────────────────────────────────────────────
test('user cleanup preflight: unauth 401, non-admin 403, bad id 400, admin 200', async () => {
  assert.strictEqual((await call('GET', '/api/admin/users/5/cleanup-preflight')).status, 401);
  assert.strictEqual((await userPreflight(userJwt)).status, 403);
  assert.strictEqual((await call('GET', '/api/admin/users/abc/cleanup-preflight', { token: adminJwt })).status, 400);
  assert.strictEqual((await userPreflight()).status, 200);
});

// ── user preflight fails closed ─────────────────────────────────────────────
test('user preflight: count query error ⇒ null metric + warning + NOT safe', async () => {
  mode = 'user_counts_error';
  const { status, body } = await userPreflight();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.data_counts.transactions_count, null, 'errored count must be null, not 0');
  assert.strictEqual(body.safe_to_archive_or_reset, false, 'unknown counts must never read as safe');
  assert.ok(body.warnings.length > 0, 'a warning must explain the missing metric');
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body.warnings)), 'warnings must not leak DB internals');
});

test('user preflight: identity/membership query error ⇒ unknown identity + NOT safe', async () => {
  mode = 'user_identity_error';
  const { body } = await userPreflight();
  assert.strictEqual(body.user.has_email_identity, null, 'failed email lookup must not read as "no email"');
  assert.strictEqual(body.user.identity_type, 'unknown');
  assert.strictEqual(body.identity_complete, false);
  assert.strictEqual(body.ownership.memberships_count, null, 'failed membership lookup must not read as 0');
  assert.strictEqual(body.safe_to_archive_or_reset, false);
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body.warnings)));
});

test('user preflight: ownership truncation at cap ⇒ NOT safe and counts nulled', async () => {
  mode = 'ownership_truncated';
  const { body } = await userPreflight();
  assert.strictEqual(body.ownership_truncated, true);
  assert.strictEqual(body.ownership.owned_workspaces_count, null, 'truncated list must not report an exact count');
  assert.strictEqual(body.safe_to_archive_or_reset, false, 'truncation must force unsafe');
  assert.ok(body.warnings.some(w => /truncat/i.test(w)));
});

test('user preflight: capability flags stay disabled and email is masked', async () => {
  const { body } = await userPreflight();
  assert.strictEqual(body.reset_enabled, false);
  assert.strictEqual(body.hard_delete_enabled, false);
  assert.strictEqual(body.user_suspend_enabled, false);
  assert.ok(!/someone@example\.com/.test(JSON.stringify(body)), 'raw email must never be returned');
  assert.match(body.user.email_masked, /\*+@example\.com$/);
});

// ── business preflight fails closed ─────────────────────────────────────────
test('business preflight: query errors ⇒ null counts, incomplete, is_empty null', async () => {
  mode = 'biz_counts_error';
  const { status, body } = await bizPreflight();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.counts.transactions, null, 'errored count must be null, not 0');
  assert.strictEqual(body.counts.debts_count, null);
  assert.strictEqual(body.preflight_complete, false, 'incomplete preflight must be flagged');
  assert.strictEqual(body.is_empty, null, 'unknown data must never read as "empty"');
  assert.strictEqual(body.recommendation, 'blocked_incomplete_preflight');
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body.warnings)), 'warnings must not leak DB internals');
});

test('business preflight: debts are reported as debts, never as invoices', async () => {
  const { body } = await bizPreflight();
  assert.strictEqual(body.counts.debts_count, 2, 'debt rows are counted as debts');
  assert.strictEqual(body.counts.invoices, null, 'there is no invoices table — must not proxy debts');
  assert.ok(body.warnings.some(w => /invoices/i.test(w)));
});

test('business preflight: an unreadable workspace row never leaks DB internals', async () => {
  // The workspace row cannot be read at all. Whatever the handler decides to answer
  // (safe 4xx or the sanitized 5xx code), it must never echo raw DB/schema/network detail.
  mode = 'biz_preflight_unreadable';
  const { status, body } = await bizPreflight();
  assert.ok(status >= 400, 'an unreadable workspace must not return success');
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body)), 'no raw DB internals in the response');
  if (status === 500) assert.strictEqual(body.error, 'business_cleanup_preflight_unavailable');
});

// ── archive / restore guards ────────────────────────────────────────────────
test('archive guards: reason, confirm, exact name, admin-only', async () => {
  assert.strictEqual((await archive({ confirm: true, confirm_name: 'Test Co' })).body.error, 'reason_required');
  assert.strictEqual((await archive({ ...VALID_ARCHIVE, reason: 'x' })).body.error, 'reason_required');
  assert.strictEqual((await archive({ ...VALID_ARCHIVE, confirm: undefined })).body.error, 'confirmation_required');
  assert.strictEqual((await archive({ ...VALID_ARCHIVE, confirm_name: 'Wrong' })).body.error, 'name_mismatch');
  const nonAdmin = await call('POST', `/api/admin/businesses/${BIZ_ID}/archive`, { token: userJwt, body: VALID_ARCHIVE });
  assert.strictEqual(nonAdmin.status, 403);
});

test('restore requires a reason', async () => {
  const r = await call('POST', `/api/admin/businesses/${BIZ_ID}/unarchive`, { token: adminJwt, body: {} });
  assert.strictEqual(r.body.error, 'reason_required');
});

test('archive succeeds when the audit write succeeds', async () => {
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'archived');
  assert.strictEqual(patchCount, 1, 'exactly one status change, no rollback');
});

// ── audit failure must be reported truthfully ───────────────────────────────
test('audit fails + rollback succeeds ⇒ says rolled back', async () => {
  mode = 'audit_fail';
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'audit_failed_rolled_back');
  assert.strictEqual(patchCount, 2, 'archive PATCH + rollback PATCH');
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body)));
});

test('audit fails + rollback fails ⇒ says uncertain, never claims rollback', async () => {
  mode = 'audit_fail_rollback_fail';
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'audit_failed_rollback_failed');
  assert.strictEqual(body.state, 'uncertain');
  assert.match(body.message, /Manual review required/i);
  assert.ok(!/rolled back\.?$/i.test(body.message), 'must not claim a successful rollback');
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body)));
});

// A rollback update can return "no error" yet change nothing. Success must be CONFIRMED by
// a returned row whose status equals the expected previous status — never assumed.
test('audit fails + rollback affects NO rows ⇒ uncertain, not "rolled back"', async () => {
  mode = 'audit_fail_rollback_norow';
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'audit_failed_rollback_failed', 'zero affected rows must not count as a rollback');
  assert.strictEqual(body.state, 'uncertain');
  assert.match(body.message, /could not be confirmed/i);
  assert.ok(!NO_INTERNALS.test(JSON.stringify(body)));
});

test('audit fails + rollback returns row with WRONG status ⇒ uncertain', async () => {
  mode = 'audit_fail_rollback_wrongstatus';
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'audit_failed_rollback_failed', 'an unrestored status must not count as a rollback');
  assert.strictEqual(body.state, 'uncertain');
  assert.ok(!/No change was kept/i.test(body.message), 'must not claim no change was kept');
});

test('audit fails + rollback CONFIRMED restored ⇒ may report rolled back', async () => {
  mode = 'audit_fail';   // rollback returns the row with status restored to 'active'
  const { status, body } = await archive(VALID_ARCHIVE);
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'audit_failed_rolled_back');
  assert.match(body.message, /No change was kept/i);
});

// ── frontend gating logic (plain module, unit-tested directly) ───────────────
test('frontend gate: archive is offered ONLY for preflight_complete === true', async () => {
  const { preflightState, isPreflightComplete } = await import('../../client/src/lib/preflight.js');
  const full = { business: {}, counts: {} };
  // Explicitly complete → the only case that may enable archive.
  assert.strictEqual(preflightState({ ...full, preflight_complete: true }), 'ok');
  assert.strictEqual(isPreflightComplete({ ...full, preflight_complete: true }), true);
  // Everything else must fail closed.
  for (const v of [false, undefined, null, 'true', 1, 0]) {
    assert.strictEqual(preflightState({ ...full, preflight_complete: v }), 'incomplete',
      `preflight_complete=${JSON.stringify(v)} must be treated as incomplete`);
    assert.strictEqual(isPreflightComplete({ ...full, preflight_complete: v }), false);
  }
  // Missing field entirely (e.g. older backend) ⇒ incomplete, never ok.
  assert.strictEqual(preflightState(full), 'incomplete');
  // Malformed / absent payloads ⇒ error.
  for (const bad of [null, undefined, {}, { business: {} }, { counts: {} }]) {
    assert.strictEqual(preflightState(bad), 'error');
  }
});

test('frontend: tri-state identity — null renders as unknown, not "not linked"', async () => {
  const { triState } = await import('../../client/src/lib/preflight.js');
  assert.strictEqual(triState(true), 'linked');
  assert.strictEqual(triState(false), 'not linked');
  assert.strictEqual(triState(null), 'n/a');
  assert.strictEqual(triState(undefined), 'n/a');
});
