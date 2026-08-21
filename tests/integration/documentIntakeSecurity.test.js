// AI Accountant document intake — ENDPOINT security tests (P0).
//
// Business scoping alone is not enough: inside one company a restricted role (manager /
// employee) must not learn about documents it cannot access — not through the intake list,
// and not through the checklist either. These tests drive the REAL server against a
// scriptable fake PostgREST, so the actual role filtering runs.
//
// Also covers: cross-business documents, personal-workspace rejection, auth/role gates,
// truncation, and response sanitisation.
//
//   Run: node --test tests/integration/documentIntakeSecurity.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SECRET = 'doc-intake-secret';
const APP_PORT = 3889, DB_PORT = 3888;
const APP = `http://127.0.0.1:${APP_PORT}`;

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const PERSONAL = '33333333-3333-3333-3333-333333333333';

const OWNER = 501;      // owner → sees all documents
const MANAGER = 502;    // manager → restricted (own uploads / own debts only)

// Documents in business A: one uploaded by the manager, one by someone else.
const DOC_OWN = { id: 'doc-own', business_id: BIZ_A, file_id: 'file-own', document_type: 'other', created_by_user_id: MANAGER, extracted_json: null, archived_at: null, created_at: '2026-08-01T00:00:00Z', review_status: 'needs_review' };
const DOC_OTHER = { id: 'doc-other', business_id: BIZ_A, file_id: 'file-other', document_type: 'other', created_by_user_id: OWNER, extracted_json: null, archived_at: null, created_at: '2026-08-02T00:00:00Z', review_status: 'needs_review' };
const FILES = {
  'file-own': { id: 'file-own', business_id: BIZ_A, file_name: 'NPWP_manager_upload.pdf', mime_type: 'application/pdf', file_size: 10 },
  'file-other': { id: 'file-other', business_id: BIZ_A, file_name: 'SECRET_owner_akta.pdf', mime_type: 'application/pdf', file_size: 20 },
};

let mode = 'ok';
let patched = [];
let dbServer, appProc;

const tokenFor = (userId) => jwt.sign({ userId, firstName: 'U' }, SECRET);

function startFakeDb() {
  return new Promise((resolve) => {
    dbServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const url = req.url || '';
        const table = (url.split('?')[0] || '').replace('/rest/v1/', '');
        const single = (req.headers.accept || '').includes('vnd.pgrst.object');
        const json = (o, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' });
          res.end(JSON.stringify(o));
        };
        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Range': '0-0/0' }); return res.end(); }

        // Which business is being queried? The app always filters by business_id.
        const forBiz = (id) => url.includes(id);

        if (table === 'businesses') {
          const b = forBiz(PERSONAL)
            ? { id: PERSONAL, name: 'Personal', type: 'personal', status: 'active', owner_user_id: OWNER }
            : forBiz(BIZ_B)
              ? { id: BIZ_B, name: 'Business B', type: 'business', status: 'active', owner_user_id: OWNER }
              : { id: BIZ_A, name: 'Business A', type: 'business', status: 'active', owner_user_id: OWNER };
          return json(single ? b : [b]);
        }
        if (table === 'business_members') {
          // Both users are members of A and B; roles differ.
          const uid = /user_id=eq\.(-?\d+)/.exec(url)?.[1];
          const role = String(uid) === String(MANAGER) ? 'manager' : 'owner';
          const bizId = forBiz(BIZ_B) ? BIZ_B : forBiz(PERSONAL) ? PERSONAL : BIZ_A;
          return json([{ id: 'm1', business_id: bizId, user_id: Number(uid), role, status: 'active',
            businesses: { id: bizId, name: 'B', type: bizId === PERSONAL ? 'personal' : 'business', status: 'active' } }]);
        }
        if (table === 'tax_profiles') return json([{ business_id: BIZ_A, country: 'Indonesia', legal_entity_type: 'PT PMA' }]);
        if (table === 'financial_documents') {
          if (req.method === 'PATCH') { patched.push(url); return json(single ? DOC_OWN : [DOC_OWN]); }
          if (forBiz(BIZ_B)) return json([]);                 // business B has none visible from A
          if (mode === 'truncated') {
            // 501 rows => the app's cap+1 probe sees truncation.
            return json(Array.from({ length: 501 }, (_, i) => ({ ...DOC_OTHER, id: `bulk-${i}`, file_id: null })));
          }
          return json([DOC_OWN, DOC_OTHER]);
        }
        if (table === 'document_files') {
          const ids = Object.keys(FILES).filter(id => url.includes(id));
          return json(ids.map(id => FILES[id]));
        }
        if (table === 'debts') return json([]);               // manager owns no debts
        if (table === 'document_links') return json([]);
        if (table === 'business_addons') return json([{ business_id: BIZ_A, addon: 'ai_accountant', status: 'active' }]);
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
        TELEGRAM_WEBHOOK_SECRET: 'test-bot-secret', JWT_SECRET: SECRET, PORT: String(APP_PORT), NODE_ENV: 'production',
        DOCUMENTS_BUCKET: 'financial-documents',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    appProc.on('error', reject);
    const t0 = Date.now();
    (async function wait() {
      while (Date.now() - t0 < 30000) {
        try { const r = await fetch(`${APP}/api/health`); if (r.ok) return resolve(); } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
      reject(new Error('app did not start'));
    })();
  });
}

const call = async (method, url, { userId, businessId, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers.Authorization = `Bearer ${tokenFor(userId)}`;
  if (businessId) headers['x-business-id'] = businessId;
  const res = await fetch(APP + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
};

const INTAKE = '/api/ai-accountant/document-intake';
const REQUIRED = '/api/ai-accountant/required-documents';
const NO_INTERNALS = /relation|column|schema|42P01|ECONN|fetch failed|TypeError|storage_path/i;

test.before(async () => { await startFakeDb(); await startApp(); });
test.after(() => { try { appProc?.kill(); } catch {} try { dbServer?.close(); } catch {} });
test.beforeEach(() => { mode = 'ok'; patched = []; });

// ── auth gates ──────────────────────────────────────────────────────────────
test('all intake endpoints reject unauthenticated callers', async () => {
  for (const [m, u] of [['GET', INTAKE], ['GET', REQUIRED], ['POST', '/api/ai-accountant/documents/classify'],
                        ['PATCH', '/api/ai-accountant/documents/doc-own/classification']]) {
    // GET/HEAD may not carry a body (fetch throws), so only send one where it is valid.
    const r = await call(m, u, m === 'GET' ? {} : { body: {} });
    assert.strictEqual(r.status, 401, `${m} ${u}`);
  }
});

// ── P0: role-level document visibility ──────────────────────────────────────
test('owner (view-all role) sees every document in the business', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const names = r.body.documents.map(d => d.file_name);
  assert.ok(names.includes('NPWP_manager_upload.pdf'));
  assert.ok(names.includes('SECRET_owner_akta.pdf'), 'a view-all role should see all documents');
});

test('manager (restricted role) does NOT see another user\'s document metadata', async () => {
  const r = await call('GET', INTAKE, { userId: MANAGER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const raw = JSON.stringify(r.body);
  assert.ok(!/SECRET_owner_akta\.pdf/.test(raw), 'restricted role must not receive the file name');
  assert.ok(!/doc-other/.test(raw), 'restricted role must not receive the document id');
  const names = r.body.documents.map(d => d.file_name);
  assert.deepStrictEqual(names, ['NPWP_manager_upload.pdf'], 'only their own upload');
});

test('checklist does not leak restricted documents either', async () => {
  const owner = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const manager = await call('GET', REQUIRED, { userId: MANAGER, businessId: BIZ_A });
  assert.strictEqual(manager.status, 200);
  const mgrRaw = JSON.stringify(manager.body);
  assert.ok(!/SECRET_owner_akta\.pdf/.test(mgrRaw), 'checklist must not expose a restricted file name');
  assert.ok(!/doc-other/.test(mgrRaw), 'checklist must not expose a restricted document id');
  // The owner CAN see it, proving the difference is the role filter and not an empty fixture.
  assert.ok(/SECRET_owner_akta\.pdf/.test(JSON.stringify(owner.body)));
});

// ── cross-business / personal workspace ─────────────────────────────────────
test('documents from another business never appear', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_B });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.documents.length, 0, 'business B has no documents of its own');
  assert.ok(!/NPWP_manager_upload|SECRET_owner_akta/.test(JSON.stringify(r.body)));
});

test('a document from another business cannot be patched', async () => {
  const r = await call('PATCH', '/api/ai-accountant/documents/doc-own/classification',
    { userId: OWNER, businessId: BIZ_B, body: { doc_type: 'npwp' } });
  assert.strictEqual(r.status, 404, 'cross-business document must be not_found');
  assert.strictEqual(r.body.error, 'document_not_found');
  assert.strictEqual(patched.length, 0, 'no update may be attempted');
});

test('personal workspace is rejected by every intake endpoint', async () => {
  for (const [m, u, b] of [['GET', INTAKE, null], ['GET', REQUIRED, null],
                           ['PATCH', '/api/ai-accountant/documents/doc-own/classification', { doc_type: 'npwp' }]]) {
    const r = await call(m, u, { userId: OWNER, businessId: PERSONAL, body: b });
    assert.ok(r.status >= 400, `${m} ${u} must not serve a personal workspace (got ${r.status})`);
    assert.ok(!/NPWP_manager_upload|SECRET_owner_akta/.test(JSON.stringify(r.body || {})));
  }
});

// ── validation + sanitisation ───────────────────────────────────────────────
test('invalid doc_type is rejected before any write', async () => {
  const r = await call('PATCH', '/api/ai-accountant/documents/doc-own/classification',
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'totally_made_up' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'invalid_doc_type');
  assert.strictEqual(patched.length, 0);
});

test('responses carry no raw DB internals or storage paths', async () => {
  for (const u of [INTAKE, REQUIRED]) {
    const r = await call('GET', u, { userId: OWNER, businessId: BIZ_A });
    assert.ok(!NO_INTERNALS.test(JSON.stringify(r.body)), `${u} leaked internals`);
  }
});

test('intake list never returns the raw database row', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  for (const d of r.body.documents) {
    assert.strictEqual(d.raw, undefined, 'raw row must be stripped');
    assert.strictEqual(d.business_id, undefined);
  }
});

// ── truncation ──────────────────────────────────────────────────────────────
test('truncated document set is flagged and blocks confident "missing"', async () => {
  mode = 'truncated';
  const intake = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(intake.body.truncated, true);
  assert.ok(intake.body.warnings.some(w => /most recent documents/i.test(w)));

  const req = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(req.body.truncated, true);
  const npwp = req.body.items.find(i => i.type === 'npwp');
  assert.strictEqual(npwp.status, 'needs_review', 'a partial set must not report a confident "missing"');
  assert.ok(req.body.warnings.some(w => /outside this set/i.test(w)));
});

// ── classify preview writes nothing ─────────────────────────────────────────
test('classify preview is stateless and requires auth + upload role', async () => {
  const r = await call('POST', '/api/ai-accountant/documents/classify',
    { userId: OWNER, businessId: BIZ_A, body: { files: [{ file_name: 'NPWP.pdf', mime_type: 'application/pdf' }] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.results[0].doc_type, 'npwp');
  assert.strictEqual(patched.length, 0, 'preview must not write');
});

// ── frontend stale-response guard (extracted helper, unit-tested) ────────────
// Prevents the isolation bug where Business A's slow response lands after the user has
// switched to Business B and paints A's documents under B's name.
test('request guard: a superseded generation is stale and must be ignored', async () => {
  const { createRequestGuard } = await import('../../client/src/lib/requestGuard.js');
  const g = createRequestGuard();

  const first = g.start();                 // workspace A load
  assert.strictEqual(first.isStale(), false);

  const second = g.start();                // user switches to workspace B
  assert.strictEqual(first.isStale(), true, "A's response must be discarded");
  assert.strictEqual(second.isStale(), false, "B's response must be applied");
});

test('request guard: aborts the previous request when a new one starts', async () => {
  const { createRequestGuard } = await import('../../client/src/lib/requestGuard.js');
  const g = createRequestGuard();
  const first = g.start();
  assert.ok(first.signal, 'a signal is provided for fetch');
  assert.strictEqual(first.signal.aborted, false);
  g.start();
  assert.strictEqual(first.signal.aborted, true, 'the in-flight request is aborted on switch');
});

test('request guard: abort() invalidates everything in flight', async () => {
  const { createRequestGuard } = await import('../../client/src/lib/requestGuard.js');
  const g = createRequestGuard();
  const req = g.start();
  g.abort();                               // e.g. workspace switch / unmount
  assert.strictEqual(req.isStale(), true);
  assert.strictEqual(req.signal.aborted, true);
});

test('request guard: out-of-order completion cannot overwrite newer data', async () => {
  const { createRequestGuard } = await import('../../client/src/lib/requestGuard.js');
  const g = createRequestGuard();
  let rendered = null;
  const apply = (req, value) => { if (!req.isStale()) rendered = value };

  const a = g.start();                     // workspace A
  const b = g.start();                     // workspace B
  apply(b, 'B documents');                 // B resolves first
  apply(a, 'A documents');                 // A resolves LATE
  assert.strictEqual(rendered, 'B documents', 'the late response from A must not win');
});
