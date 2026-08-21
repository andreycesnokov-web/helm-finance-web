// AI Accountant document intake — DISPOSABLE-BUSINESS END-TO-END SMOKE.
//
// This drives the REAL server binary through the REAL upload path
//   upload-init → signed-URL PUT to storage → upload-complete → intake list →
//   classify → manual correction (PATCH) → checklist
// against a stateful fake PostgREST + fake Supabase Storage, using a DISPOSABLE
// test business. Nothing here touches production data.
//
// Scope note: this proves the wiring, ordering and state transitions of the whole
// flow. It does NOT prove real Supabase Storage behaviour (signed-URL semantics,
// bucket policy) — that still needs an owner-run smoke on a deployed environment.
//
//   Run: node --test tests/integration/documentIntakeE2E.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SECRET = 'doc-intake-e2e-secret';
const APP_PORT = 3897, DB_PORT = 3896;
const APP = `http://127.0.0.1:${APP_PORT}`;
const BUCKET = 'financial-documents';

// Disposable workspaces — no real business ids anywhere in this file.
const BIZ_A = 'aaaaaaaa-0000-4000-8000-000000000001';   // "DISPOSABLE TEST CO A"
const BIZ_B = 'bbbbbbbb-0000-4000-8000-000000000002';   // "DISPOSABLE TEST CO B"
const PERSONAL = 'cccccccc-0000-4000-8000-000000000003';

const OWNER = 901;      // owner of both disposable businesses
const MANAGER = 902;    // restricted role in business A

const tokenFor = (userId) => jwt.sign({ userId, firstName: 'T' }, SECRET);

// ── mutable fake database ───────────────────────────────────────────────────
let db, storage, dbServer, appProc;

function resetDb() {
  db = {
    financial_documents: [],
    document_files: [],
    audit_events: [],
    document_audit: [],
    document_links: [],
    debts: [],
    tax_profiles: [{ business_id: BIZ_A, country: 'Indonesia', legal_entity_type: 'PT PMA' },
                   { business_id: BIZ_B, country: 'Singapore', legal_entity_type: 'Pte Ltd' }],
  };
  storage = new Map();   // storage_path -> Buffer
}

const BUSINESSES = {
  [BIZ_A]: { id: BIZ_A, name: 'DISPOSABLE TEST CO A', type: 'business', status: 'active', owner_user_id: OWNER },
  [BIZ_B]: { id: BIZ_B, name: 'DISPOSABLE TEST CO B', type: 'business', status: 'active', owner_user_id: OWNER },
  [PERSONAL]: { id: PERSONAL, name: 'Disposable Personal', type: 'personal', status: 'active', owner_user_id: OWNER },
};

// Minimal PostgREST filter support: eq / is / in, plus limit.
function applyFilters(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const val = rest.join('.');
    out = out.filter(r => {
      const v = r[key];
      if (op === 'eq') return String(v) === val;
      if (op === 'is') return val === 'null' ? (v == null) : true;
      if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(v));
      if (op === 'like') return new RegExp('^' + val.replace(/%/g, '.*') + '$').test(String(v));
      return true;
    });
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function startFakeBackend() {
  return new Promise((resolve) => {
    dbServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const [pathname, qs] = (req.url || '').split('?');
        const params = new URLSearchParams(qs || '');
        const single = (req.headers.accept || '').includes('vnd.pgrst.object');
        const json = (o, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' });
          res.end(JSON.stringify(o));
        };
        const body = (() => { try { return JSON.parse(buf.toString() || 'null'); } catch { return null; } })();

        // ── fake Supabase Storage ──────────────────────────────────────────
        if (pathname.startsWith('/storage/v1/')) {
          if (pathname === `/storage/v1/bucket/${BUCKET}`)
            return json({ name: BUCKET, id: BUCKET, public: false });
          const signPrefix = `/storage/v1/object/upload/sign/${BUCKET}/`;
          if (pathname.startsWith(signPrefix)) {
            const p = decodeURIComponent(pathname.slice(signPrefix.length));
            if (req.method === 'POST')   // issue signed upload URL
              return json({ url: `/object/upload/sign/${BUCKET}/${p}?token=disposable-token` });
            if (req.method === 'PUT') { storage.set(p, buf); return json({ Key: `${BUCKET}/${p}` }); }
          }
          // createSignedUrl (view/download) — distinct from the upload sign endpoint above.
          const readSignPrefix = `/storage/v1/object/sign/${BUCKET}/`;
          if (pathname.startsWith(readSignPrefix) && req.method === 'POST') {
            const p = decodeURIComponent(pathname.slice(readSignPrefix.length));
            if (!storage.has(p)) return json({ error: 'not_found' }, 404);
            return json({ signedURL: `/object/sign/${BUCKET}/${p}?token=read-token` });
          }
          const objPrefix = `/storage/v1/object/`;
          if (pathname.startsWith(objPrefix)) {
            let p = decodeURIComponent(pathname.slice(objPrefix.length));
            p = p.replace(/^(authenticated|public)\//, '').replace(new RegExp(`^${BUCKET}/`), '');
            if (req.method === 'GET') {
              if (!storage.has(p)) { res.writeHead(404); return res.end('{"error":"not_found"}'); }
              res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
              return res.end(storage.get(p));
            }
            if (req.method === 'DELETE') { storage.delete(p); return json([]); }
          }
          return json({}, 200);
        }

        // ── fake PostgREST ─────────────────────────────────────────────────
        const table = pathname.replace('/rest/v1/', '');

        if (table.startsWith('rpc/')) {
          const fn = table.slice(4);
          if (fn === 'rpc_document_archive') {
            const doc = db.financial_documents.find(d => d.id === body?.p_document_id
              && d.business_id === body?.p_business_id);
            if (!doc) return json({ message: 'probe' }, 200);   // the storage-health probe
            doc.archived_at = new Date().toISOString();
            db.document_audit.push({ id: crypto.randomUUID(), document_id: doc.id, action: 'archived' });
            return json({ id: doc.id, archived_at: doc.archived_at });
          }
          if (fn === 'rpc_document_finalize_upload') {
            db.document_files.push({ ...body.p_file, created_at: new Date().toISOString() });
            const doc = { ...body.p_doc, file_id: body.p_file.id, created_by_user_id: body.p_actor,
              archived_at: null, review_status: 'needs_review', created_at: new Date().toISOString() };
            db.financial_documents.push(doc);
            db.document_audit.push({ id: crypto.randomUUID(), document_id: doc.id, action: 'uploaded' });
            return json(doc);
          }
          if (fn === 'rpc_document_update_metadata') {
            const doc = db.financial_documents.find(d => d.id === body.p_document_id && d.business_id === body.p_business_id);
            if (!doc) return json({ message: 'not found' }, 400);
            Object.assign(doc, body.p_patch);
            db.document_audit.push({ id: crypto.randomUUID(), document_id: doc.id, action: 'metadata_updated' });
            return json(doc);
          }
          return json(null);
        }

        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Range': '0-0/0' }); return res.end(); }

        if (table === 'businesses') {
          const id = Object.keys(BUSINESSES).find(b => (qs || '').includes(b)) || BIZ_A;
          const b = BUSINESSES[id];
          return json(single ? b : [b]);
        }
        if (table === 'business_members') {
          const uid = /user_id=eq\.(-?\d+)/.exec(qs || '')?.[1];
          const bizId = Object.keys(BUSINESSES).find(b => (qs || '').includes(b)) || BIZ_A;
          const role = String(uid) === String(MANAGER) ? 'manager' : 'owner';
          return json([{ id: `m-${uid}`, business_id: bizId, user_id: Number(uid), role, status: 'active',
            businesses: BUSINESSES[bizId] }]);
        }
        if (table === 'business_addons')
          return json([{ business_id: BIZ_A, addon: 'ai_accountant', status: 'active' }]);

        if (db[table]) {
          if (req.method === 'POST') {
            const rows = Array.isArray(body) ? body : [body];
            db[table].push(...rows);
            return json(single ? rows[0] : rows, 201);
          }
          const rows = applyFilters(db[table], params);
          return json(single ? (rows[0] || {}) : rows);
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
        TELEGRAM_WEBHOOK_SECRET: 'test-bot-secret', JWT_SECRET: SECRET, PORT: String(APP_PORT), NODE_ENV: 'production',
        DOCUMENTS_BUCKET: BUCKET,
        // This suite exercises Phase 2, so it turns the default-OFF flag ON explicitly.
        DOCUMENT_CONTENT_CLASSIFICATION_ENABLED: 'true',
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

// The real client upload path: init → PUT the bytes to the signed URL → complete.
async function uploadFile({ businessId, userId, file_name, content }) {
  const bytes = Buffer.from(content);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const init = await call('POST', '/api/documents/upload-init', {
    userId, businessId,
    body: { file_name, mime_type: 'application/pdf', file_size: bytes.length, document_type: 'other', sha256 },
  });
  if (init.status !== 200) return { step: 'init', ...init };
  const put = await fetch(init.body.upload_url, { method: 'PUT', body: bytes });
  const complete = await call('POST', '/api/documents/upload-complete', {
    userId, businessId,
    body: { document_id: init.body.document_id, storage_path: init.body.storage_path,
      file_name, mime_type: 'application/pdf', file_size: bytes.length, document_type: 'other', sha256 },
  });
  return { step: 'complete', init: init.body, putStatus: put.status, ...complete };
}

const INTAKE = '/api/ai-accountant/document-intake';
const REQUIRED = '/api/ai-accountant/required-documents';

test.before(async () => { resetDb(); await startFakeBackend(); await startApp(); });
test.after(() => { try { appProc?.kill(); } catch {} try { dbServer?.close(); } catch {} });

// ══ A. Upload flow ══════════════════════════════════════════════════════════
let npwpDocId = null, unknownDocId = null;

test('A1. NPWP-like file uploads through init → storage PUT → complete', async () => {
  const r = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'NPWP_test_company.pdf', content: 'disposable npwp bytes' });
  assert.strictEqual(r.putStatus, 200, 'signed-URL PUT should succeed');
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.document?.id);
  npwpDocId = r.body.document.id;
  // The bytes really landed in storage under the business-scoped path.
  assert.ok(r.init.storage_path.includes(BIZ_A), 'storage path must be business-scoped');
  assert.ok(storage.has(r.init.storage_path), 'bytes must be stored');
  // The atomic finalize RPC recorded file + document + an audit row.
  assert.strictEqual(db.document_files.length, 1);
  assert.ok(db.document_audit.some(a => a.action === 'uploaded'));
});

test('A2. unknown file uploads through the same path', async () => {
  const r = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'scan_random_001.pdf', content: 'disposable unknown bytes' });
  assert.strictEqual(r.putStatus, 200);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  unknownDocId = r.body.document.id;
  assert.strictEqual(db.financial_documents.length, 2);
});

test('A3. intake exposes no hard-delete affordance', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.ok(!/hard_delete|"delete"|permanently/i.test(s), 'no delete affordance in the intake payload');
  // A DELETE on the classification route is not a route at all.
  const del = await call('DELETE', `/api/ai-accountant/documents/${npwpDocId}/classification`, { userId: OWNER, businessId: BIZ_A });
  assert.ok(del.status === 404 || del.status === 405, `got ${del.status}`);
});

// ══ B. Classification ═══════════════════════════════════════════════════════
test('B1. NPWP-like file is auto-classified high confidence; unknown goes to needs_review', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const npwp = r.body.documents.find(d => d.id === npwpDocId).intake;
  const unknown = r.body.documents.find(d => d.id === unknownDocId).intake;
  assert.strictEqual(npwp.doc_type, 'npwp');
  assert.strictEqual(npwp.confidence, 'high');
  assert.strictEqual(npwp.classification_status, 'auto_classified');
  assert.ok(unknown.doc_type == null || unknown.doc_type === 'unknown', `got ${unknown.doc_type}`);
  assert.strictEqual(unknown.classification_status, 'needs_review');
  assert.ok(npwp.label && npwp.area, 'label + area shown to the user');
});

test('B2. no official/legal certainty is claimed anywhere in the payloads', async () => {
  const a = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const b = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const s = JSON.stringify(a.body) + JSON.stringify(b.body);
  assert.ok(!/legally valid|is certified|we guarantee|fully compliant/i.test(s));
  assert.match(s, /does not verify that a document is officially valid/i);
  assert.match(JSON.stringify(b.body), /preliminary/i);
  assert.ok(b.body.disclaimer, 'checklist carries a disclaimer');
});

// ══ C. Manual correction ════════════════════════════════════════════════════
test('C1. manual correction of the unknown file persists and refreshes the intake view', async () => {
  const r = await call('PATCH', `/api/ai-accountant/documents/${unknownDocId}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'nib' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.classification_status, 'manually_confirmed');

  const stored = db.financial_documents.find(d => d.id === unknownDocId);
  assert.strictEqual(stored.extracted_json.ai_intake.doc_type, 'nib');
  assert.strictEqual(stored.extracted_json.ai_intake.classification_status, 'manually_confirmed');
  // document_type stays on a CHECK-valid legacy value — no migration needed.
  assert.ok(['other', 'bank_document', 'filing_confirmation', 'tax_billing', 'payment_proof',
    'vendor_invoice', 'customer_invoice', 'tax_invoice', 'bukti_potong'].includes(stored.document_type));
  assert.ok(db.document_audit.some(a => a.action === 'metadata_updated'), 'correction is audited');

  const after = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const doc = after.body.documents.find(d => d.id === unknownDocId).intake;
  assert.strictEqual(doc.doc_type, 'nib');
  assert.strictEqual(doc.classification_status, 'manually_confirmed');
});

// ══ D. Checklist ════════════════════════════════════════════════════════════
test('D1. Indonesia profile requires NPWP + NIB and reflects the confirmed document', async () => {
  const r = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const items = r.body.items;
  const npwp = items.find(i => i.type === 'npwp');
  const nib = items.find(i => i.type === 'nib');
  assert.strictEqual(npwp.requirement, 'required');
  assert.strictEqual(nib.requirement, 'required');
  assert.strictEqual(nib.status, 'uploaded', 'the manually confirmed NIB satisfies the requirement');
  assert.strictEqual(r.body.jurisdiction, 'id');
});

test('D2. a low/unknown document does not satisfy a requirement until confirmed', async () => {
  // Upload a weakly-matching akta file; it must NOT flip the requirement to satisfied.
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'company deed scan.pdf', content: 'weak akta bytes' });
  assert.strictEqual(up.status, 200);
  const r = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const akta = r.body.items.find(i => i.type === 'akta');
  assert.notStrictEqual(akta.status, 'uploaded', 'an unconfirmed weak match must not satisfy the requirement');
});

test('D3. a non-Indonesia profile does not overclaim Indonesian requirements', async () => {
  const r = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_B });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.jurisdiction, 'other');
  for (const t of ['npwp', 'nib']) {
    const item = r.body.items.find(i => i.type === t);
    assert.strictEqual(item.requirement, 'not_required', `${t} must not be required outside Indonesia`);
    assert.match(item.reason, /Indonesia/);
  }
});

// ══ E. Workspace isolation ══════════════════════════════════════════════════
test('E1. business A documents never appear under business B', async () => {
  const b = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_B });
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.body.documents.length, 0, 'B is empty');
  const s = JSON.stringify(b.body);
  assert.ok(!s.includes('NPWP_test_company.pdf') && !s.includes('scan_random_001.pdf'));
  assert.ok(!s.includes(npwpDocId) && !s.includes(unknownDocId));
});

test('E2. switching back to A reloads the full state', async () => {
  const a = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(a.body.documents.length, 3);
  assert.ok(a.body.documents.some(d => d.file_name === 'NPWP_test_company.pdf'));
});

test('E3. a cross-business document id is not found, and nothing is written', async () => {
  const before = db.document_audit.length;
  const r = await call('PATCH', `/api/ai-accountant/documents/${npwpDocId}/classification`,
    { userId: OWNER, businessId: BIZ_B, body: { doc_type: 'npwp' } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(db.document_audit.length, before, 'no write on a cross-business attempt');
});

// ══ F. Role visibility ══════════════════════════════════════════════════════
test('F1. a restricted role does not see another user\'s document metadata', async () => {
  const owner = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const manager = await call('GET', INTAKE, { userId: MANAGER, businessId: BIZ_A });
  assert.strictEqual(manager.status, 200);
  // Everything was uploaded by OWNER, so the manager must see none of it.
  assert.ok(owner.body.documents.length > 0);
  assert.strictEqual(manager.body.documents.length, 0);
  const s = JSON.stringify(manager.body);
  for (const leak of ['NPWP_test_company.pdf', 'scan_random_001.pdf', npwpDocId, unknownDocId])
    assert.ok(!s.includes(leak), `manager payload leaked ${leak}`);
});

test('F2. the checklist does not leak restricted documents to a restricted role', async () => {
  const r = await call('GET', REQUIRED, { userId: MANAGER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes('NPWP_test_company.pdf') && !s.includes(npwpDocId));
  const nib = r.body.items.find(i => i.type === 'nib');
  assert.notStrictEqual(nib.status, 'uploaded', 'a document the manager cannot see must not count as satisfied');
});

// ══ Personal workspace ══════════════════════════════════════════════════════
test('G1. the personal workspace is rejected on every intake endpoint', async () => {
  for (const [m, u, body] of [['GET', INTAKE, undefined], ['GET', REQUIRED, undefined],
    ['POST', '/api/ai-accountant/documents/classify', { files: [{ file_name: 'x.pdf' }] }],
    ['PATCH', `/api/ai-accountant/documents/${npwpDocId}/classification`, { doc_type: 'npwp' }]]) {
    const r = await call(m, u, { userId: OWNER, businessId: PERSONAL, body });
    assert.ok(r.status >= 400 && r.status < 500, `${m} ${u} → ${r.status}`);
    assert.ok(!JSON.stringify(r.body).includes('NPWP_test_company.pdf'));
  }
});

// ══ H. Phase 2 — content-based classification (end to end) ══════════════════
// A real (minimal) PDF carrying embedded text, uploaded under a GENERIC file name.
function makePdf(text) {
  const content = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`);
  const z = zlib.deflateSync(content);
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`),
    z, Buffer.from('\nendstream\nendobj\n%%EOF\n')]);
}
const SECRET_PHRASE = 'RAHASIA-INTERNAL-XYZ-9988';
const SK_TEXT = 'KEPUTUSAN MENTERI HUKUM REPUBLIK INDONESIA PENGESAHAN PENDIRIAN BADAN HUKUM ' + SECRET_PHRASE;
let contentDocId = null;

test('H1. a generically named PDF is classified from its CONTENT during upload', async () => {
  const r = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'scan.pdf', content: makePdf(SK_TEXT) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  contentDocId = r.body.document.id;

  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const doc = list.body.documents.find(d => d.id === contentDocId);
  assert.strictEqual(doc.intake.doc_type, 'sk_kemenkumham', 'content, not the file name');
  assert.strictEqual(doc.intake.confidence, 'high');
  assert.strictEqual(doc.intake.classification_status, 'auto_classified');
  assert.strictEqual(doc.intake.extraction.text_available, true);
  assert.strictEqual(doc.intake.extraction.method, 'pdf_text');
  assert.match(doc.intake.explanation, /KEPUTUSAN MENTERI HUKUM/);
});

test('H2. the API never returns the document text or a stored sample', async () => {
  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const s = JSON.stringify(list.body);
  assert.ok(!s.includes(SECRET_PHRASE), 'document text must not leave the server');
  assert.ok(!s.includes('text_sample_safe'), 'the stored sample must not be returned');
  // The marker labels themselves are fine — they are our vocabulary, not the document.
  const doc = list.body.documents.find(d => d.id === contentDocId);
  assert.ok(doc.intake.signals.strong_matches.length > 0);
});

test('H3. a content classification satisfies the right checklist item only', async () => {
  const r = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const sk = r.body.items.find(i => i.type === 'sk_kemenkumham');
  assert.strictEqual(sk.status, 'uploaded', 'the SK content match satisfies the SK item');
  // Nothing was uploaded for PKP, and the SK document must not satisfy it.
  assert.notStrictEqual(r.body.items.find(i => i.type === 'pkp_certificate').status, 'uploaded');
});

test('H4. reclassify re-reads an existing document, business-scoped', async () => {
  const r = await call('POST', `/api/ai-accountant/documents/${contentDocId}/reclassify`,
    { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.doc_type, 'sk_kemenkumham');
  assert.strictEqual(r.body.confidence, 'high');
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes(SECRET_PHRASE) && !s.includes('text_sample_safe'));
  assert.ok(!/storage_path|relation|column/i.test(s));
});

test('H5. reclassify is rejected across businesses, for personal, and unauthenticated', async () => {
  const before = db.document_audit.length;
  const cross = await call('POST', `/api/ai-accountant/documents/${contentDocId}/reclassify`,
    { userId: OWNER, businessId: BIZ_B });
  assert.strictEqual(cross.status, 404);
  const personal = await call('POST', `/api/ai-accountant/documents/${contentDocId}/reclassify`,
    { userId: OWNER, businessId: PERSONAL });
  assert.ok(personal.status >= 400 && personal.status < 500, `personal → ${personal.status}`);
  const anon = await call('POST', `/api/ai-accountant/documents/${contentDocId}/reclassify`, {});
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(db.document_audit.length, before, 'no writes from rejected attempts');
});

test('H6. reclassify refuses to overwrite a manually confirmed type', async () => {
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER, file_name: 'manual.pdf', content: makePdf(SK_TEXT + ' UNIQUE-FOR-DEDUP-H6') });
  await call('PATCH', `/api/ai-accountant/documents/${up.body.document.id}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'contract' } });
  const r = await call('POST', `/api/ai-accountant/documents/${up.body.document.id}/reclassify`,
    { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'manually_confirmed');
  const stored = db.financial_documents.find(d => d.id === up.body.document.id);
  assert.strictEqual(stored.extracted_json.ai_intake.doc_type, 'contract', 'the manual choice stands');
});

test('H7. a restricted role still sees none of the content-classified documents', async () => {
  const manager = await call('GET', INTAKE, { userId: MANAGER, businessId: BIZ_A });
  assert.strictEqual(manager.status, 200);
  assert.strictEqual(manager.body.documents.length, 0);
  assert.ok(!JSON.stringify(manager.body).includes(contentDocId));
});

test('H8. the generic /api/documents endpoints do not leak extraction internals', async () => {
  const list = await call('GET', '/api/documents', { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(list.status, 200, JSON.stringify(list.body));
  const s = JSON.stringify(list.body);
  assert.ok(!s.includes(SECRET_PHRASE), 'document text must not appear in /api/documents');
  assert.ok(!s.includes('text_sample_safe'));
  assert.ok(!s.includes('storage_path'), 'storage paths are internal');
  // extracted_json is whitelisted, not passed through wholesale.
  const doc = list.body.documents.find(d => d.id === contentDocId);
  assert.ok(doc, 'the document is listed');
  if (doc.extracted_json) {
    assert.deepStrictEqual(Object.keys(doc.extracted_json).sort(), ['ai_intake', 'notes']);
    assert.ok(!('classified_at' in (doc.extracted_json.ai_intake || {})), 'internals stay private');
    assert.ok(!('extraction_ms' in (doc.extracted_json.ai_intake || {})));
  }

  const detail = await call('GET', `/api/documents/${contentDocId}`, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(detail.status, 200);
  const d = JSON.stringify(detail.body);
  assert.ok(!d.includes(SECRET_PHRASE) && !d.includes('text_sample_safe') && !d.includes('storage_path'));
});

// ══ I. Document file metadata is an explicit whitelist ══════════════════════
// The fake PostgREST ignores `select=`, so it hands back FULL rows — which means these
// assertions prove the serialiser strips the fields, not the query.
const FORBIDDEN_FILE_FIELDS = ['storage_path', 'sha256_hash', 'sha256', 'checksum', 'hash',
  'business_id', 'created_by_user_id', 'uploaded_by', 'user_id', 'owner_user_id', 'bucket'];
const ALLOWED_FILE_FIELDS = ['file_name', 'mime_type', 'file_size', 'created_at', 'upload_channel'];

const assertNoFileSecrets = (payload, where) => {
  const s = JSON.stringify(payload);
  for (const f of ['storage_path', 'sha256_hash', 'checksum', 'bucket'])
    assert.ok(!s.includes(f), `${where} leaked field name ${f}`);
  // The real values, not just the key names.
  for (const f of db.document_files) {
    assert.ok(!s.includes(f.storage_path), `${where} leaked a storage path`);
    assert.ok(!s.includes(f.sha256_hash), `${where} leaked a SHA-256 fingerprint`);
  }
};

test('I1. /api/documents list returns ONLY whitelisted file fields', async () => {
  const r = await call('GET', '/api/documents', { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.documents.length > 0);
  for (const d of r.body.documents) {
    if (!d.file) continue;
    for (const k of Object.keys(d.file))
      assert.ok(ALLOWED_FILE_FIELDS.includes(k), `unexpected file field "${k}" in the list`);
    for (const k of FORBIDDEN_FILE_FIELDS)
      assert.ok(!(k in d.file), `file.${k} must not be returned`);
  }
  assertNoFileSecrets(r.body, '/api/documents');
});

test('I2. /api/documents/:id detail returns ONLY whitelisted file fields', async () => {
  const list = await call('GET', '/api/documents', { userId: OWNER, businessId: BIZ_A });
  const id = list.body.documents[0].id;
  const r = await call('GET', `/api/documents/${id}`, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.file, 'the file object is still returned');
  for (const k of Object.keys(r.body.file))
    assert.ok(ALLOWED_FILE_FIELDS.includes(k), `unexpected file field "${k}" in the detail`);
  for (const k of FORBIDDEN_FILE_FIELDS) assert.ok(!(k in r.body.file));
  assertNoFileSecrets(r.body, '/api/documents/:id');
});

test('I3. the whitelist survives a widened DB row (future columns stay private)', async () => {
  // Simulate a migration adding a column: the serialiser must not pass it through.
  db.document_files.forEach(f => { f.virus_scan_token = 'INTERNAL-SCAN-TOKEN-XYZ'; });
  try {
    const list = await call('GET', '/api/documents', { userId: OWNER, businessId: BIZ_A });
    const detail = await call('GET', `/api/documents/${list.body.documents[0].id}`, { userId: OWNER, businessId: BIZ_A });
    for (const payload of [list.body, detail.body])
      assert.ok(!JSON.stringify(payload).includes('INTERNAL-SCAN-TOKEN-XYZ'),
        'an unknown future column must not be returned by default');
  } finally {
    db.document_files.forEach(f => { delete f.virus_scan_token; });
  }
});

test('I4. upload-complete and metadata update leak no file internals', async () => {
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'whitelist-check.pdf', content: 'whitelist check bytes' });
  assert.strictEqual(up.status, 200);
  assertNoFileSecrets(up.body, 'upload-complete');

  const patch = await call('PATCH', `/api/documents/${up.body.document.id}`,
    { userId: OWNER, businessId: BIZ_A, body: { document_number: 'REF-1' } });
  if (patch.status === 200) assertNoFileSecrets(patch.body, 'document metadata update');

  const re = await call('POST', `/api/ai-accountant/documents/${up.body.document.id}/reclassify`,
    { userId: OWNER, businessId: BIZ_A });
  assertNoFileSecrets(re.body, 'reclassify');
});

test('I5. the frontend still gets what it renders', async () => {
  const r = await call('GET', '/api/documents', { userId: OWNER, businessId: BIZ_A });
  const withFile = r.body.documents.find(d => d.file);
  assert.ok(withFile.file.file_name, 'file name is required by the documents table');
  assert.ok(withFile.file.mime_type);
  assert.ok(typeof withFile.file.file_size === 'number');
  // The intake list keeps its own safe projection.
  const intake = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const doc = intake.body.documents[0];
  assert.ok(doc.file_name && doc.mime_type);
  assertNoFileSecrets(intake.body, 'intake list');
});

// ══ J. Preview + archive from the intake list ═══════════════════════════════
// The user is asked to confirm a type for a row called `6.PDF`; they must be able to open the
// file, and to remove a wrong upload. Archive is SOFT — the row keeps its file and audit trail.
let archiveDocId = null;

test('J1. a signed URL can be issued for an intake document, without leaking the path', async () => {
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: '6.PDF', content: 'preview me' });
  assert.strictEqual(up.status, 200);
  archiveDocId = up.body.document.id;

  const r = await call('POST', `/api/documents/${archiveDocId}/signed-url`,
    { userId: OWNER, businessId: BIZ_A, body: { mode: 'view' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.url, 'a URL is returned');
  const stored = db.document_files.find(f => f.file_name === '6.PDF');
  // NOTE: a signed URL necessarily contains the object path — that IS the grant. What must not
  // appear is the checksum, and the path must never appear in LIST payloads (see J9).
  assert.ok(r.body.url.includes('token='), 'the URL must be token-scoped, not a bare path');
  assert.ok(!JSON.stringify(r.body).includes(stored.sha256_hash), 'the checksum must not leak');
  assert.ok(typeof r.body.expires_in === 'number', 'the grant must be short-lived');
});

test('J2. the signed URL requires auth and the right workspace', async () => {
  const anon = await call('POST', `/api/documents/${archiveDocId}/signed-url`, { body: { mode: 'view' } });
  assert.strictEqual(anon.status, 401);
  const crossBiz = await call('POST', `/api/documents/${archiveDocId}/signed-url`,
    { userId: OWNER, businessId: BIZ_B, body: { mode: 'view' } });
  assert.strictEqual(crossBiz.status, 404, 'business B must not reach a business A document');
  const personal = await call('POST', `/api/documents/${archiveDocId}/signed-url`,
    { userId: OWNER, businessId: PERSONAL, body: { mode: 'view' } });
  assert.ok(personal.status >= 400 && personal.status < 500);
});

test('J3. archive removes the document from the active intake list', async () => {
  const before = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.ok(before.body.documents.some(d => d.id === archiveDocId), 'present before archiving');

  const r = await call('POST', `/api/documents/${archiveDocId}/archive`, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(db.financial_documents.find(d => d.id === archiveDocId).archived_at, 'archived_at is set');

  const after = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.ok(!after.body.documents.some(d => d.id === archiveDocId), 'gone from the intake list');
  assert.ok(!JSON.stringify(after.body).includes('6.PDF'));
});

test('J4. archive is SOFT — the file and its audit trail survive', async () => {
  const doc = db.financial_documents.find(d => d.id === archiveDocId);
  assert.ok(doc, 'the document row still exists');
  const file = db.document_files.find(f => f.id === doc.file_id);
  assert.ok(file, 'the file row still exists');
  assert.ok(storage.has(file.storage_path), 'the stored bytes are NOT deleted');
  assert.ok(db.document_audit.some(a => a.document_id === archiveDocId && a.action === 'archived'));
});

test('J5. an archived document no longer satisfies the checklist', async () => {
  // Upload an NPWP, confirm it (checklist satisfied), then archive it.
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'NPWP_archive_case.pdf', content: 'npwp bytes for archive case' });
  const id = up.body.document.id;
  await call('PATCH', `/api/ai-accountant/documents/${id}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'npwp' } });

  const satisfied = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(satisfied.body.items.find(i => i.type === 'npwp').status, 'uploaded');

  assert.ok(satisfied.body.items.find(i => i.type === 'npwp').documents.some(d => d.id === id),
    'this document is one of the NPWP matches');

  const arch = await call('POST', `/api/documents/${id}/archive`, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(arch.status, 200);

  const after = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const npwp = after.body.items.find(i => i.type === 'npwp');
  assert.ok(!npwp.documents.some(d => d.id === id), 'the archived document stops counting');
  assert.ok(!JSON.stringify(after.body).includes('NPWP_archive_case.pdf'));

  // Earlier tests left another NPWP in this workspace. Archive every remaining match to prove
  // the item's STATUS flips back once nothing satisfies it.
  for (const m of npwp.documents)
    assert.strictEqual((await call('POST', `/api/documents/${m.id}/archive`,
      { userId: OWNER, businessId: BIZ_A })).status, 200);
  const empty = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const npwpNow = empty.body.items.find(i => i.type === 'npwp');
  assert.notStrictEqual(npwpNow.status, 'uploaded', 'with every match archived the item is unsatisfied');
  assert.ok(['missing', 'needs_review'].includes(npwpNow.status), `got ${npwpNow.status}`);
});

test('J6. archive requires auth, the right workspace and a manage role', async () => {
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'guarded.pdf', content: 'guarded bytes' });
  const id = up.body.document.id;

  const anon = await call('POST', `/api/documents/${id}/archive`, {});
  assert.strictEqual(anon.status, 401);

  const before = db.document_audit.length;
  const crossBiz = await call('POST', `/api/documents/${id}/archive`, { userId: OWNER, businessId: BIZ_B });
  assert.strictEqual(crossBiz.status, 404, 'business A document cannot be archived from business B');
  assert.strictEqual(db.document_audit.length, before, 'nothing written on a cross-business attempt');
  assert.ok(!db.financial_documents.find(d => d.id === id).archived_at, 'still not archived');

  const personal = await call('POST', `/api/documents/${id}/archive`, { userId: OWNER, businessId: PERSONAL });
  assert.ok(personal.status >= 400 && personal.status < 500, 'personal workspace rejected');
});

test('J7. confirming an archived document is impossible', async () => {
  const r = await call('PATCH', `/api/ai-accountant/documents/${archiveDocId}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'npwp' } });
  assert.strictEqual(r.status, 404, 'an archived document is not found for classification');
});

test('J8. a manually confirmed type can be changed by confirming a different one', async () => {
  const up = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'retype.pdf', content: 'retype bytes' });
  const id = up.body.document.id;
  const first = await call('PATCH', `/api/ai-accountant/documents/${id}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'akta' } });
  assert.strictEqual(first.status, 200);
  const second = await call('PATCH', `/api/ai-accountant/documents/${id}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'nib' } });
  assert.strictEqual(second.status, 200, 'a wrong confirmation must be correctable');
  assert.strictEqual(second.body.doc_type, 'nib');
  const stored = db.financial_documents.find(d => d.id === id);
  assert.strictEqual(stored.extracted_json.ai_intake.doc_type, 'nib', 'only ONE type is stored');

  // …and the same file cannot satisfy two checklist items at once.
  const cl = await call('GET', REQUIRED, { userId: OWNER, businessId: BIZ_A });
  const matched = cl.body.items.filter(i => (i.documents || []).some(d => d.id === id));
  assert.strictEqual(matched.length, 1, 'one file satisfies at most one checklist item');
  assert.strictEqual(matched[0].type, 'nib');
});

test('J9. the intake list carries the metadata the row renders', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const d = r.body.documents[0];
  for (const k of ['id', 'file_name', 'mime_type', 'file_size', 'uploaded_at', 'intake'])
    assert.ok(k in d, `the row needs ${k}`);
  assert.ok(!JSON.stringify(r.body).includes('storage_path'));
  assert.ok(!JSON.stringify(r.body).includes('sha256'));
});
