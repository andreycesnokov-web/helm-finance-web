// Phase 2 FEATURE FLAG — the DEFAULT (no env var set) must behave exactly like Phase 1.
//
// Codex required content extraction to stay dark until a disposable Supabase + browser smoke
// passes. This suite starts the real server WITHOUT DOCUMENT_CONTENT_CLASSIFICATION_ENABLED
// and proves nothing reads document content, while every Phase 1 behaviour is preserved.
//
//   Run: node --test tests/integration/documentContentFlag.test.js
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SECRET = 'doc-intake-e2e-secret';
const APP_PORT = 3895, DB_PORT = 3894;
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
          if (fn === 'rpc_document_archive') return json({ message: 'probe' }, 200);
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
        BOT_TOKEN: 'x:x', JWT_SECRET: SECRET, PORT: String(APP_PORT), NODE_ENV: 'production',
        DOCUMENTS_BUCKET: BUCKET,
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
const SK_TEXT = 'KEPUTUSAN MENTERI HUKUM REPUBLIK INDONESIA PENGESAHAN PENDIRIAN BADAN HUKUM PERSEROAN TERBATAS';

function makePdf(text) {
  const content = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`);
  const z = zlib.deflateSync(content);
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + z.length + ' /Filter /FlateDecode >>\nstream\n'),
    z, Buffer.from('\nendstream\nendobj\n%%EOF\n')]);
}

test.before(async () => { resetDb(); await startFakeBackend(); await startApp(); });
test.after(() => { try { appProc?.kill(); } catch {} try { dbServer?.close(); } catch {} });

// The app is started WITHOUT DOCUMENT_CONTENT_CLASSIFICATION_ENABLED — the production default.
test('default (no env var) leaves content classification OFF', async () => {
  const r = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.content_classification_enabled, false);
  assert.match(r.body.note, /file name and type only/i);
});

test('flag OFF: upload-complete does NOT read the document content', async () => {
  const r = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'scan.pdf', content: makePdf(SK_TEXT) });
  assert.strictEqual(r.status, 200, 'the upload still succeeds');
  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const doc = list.body.documents.find(d => d.id === r.body.document.id);
  // Phase 1 behaviour exactly: a generic file name stays unknown / needs review.
  assert.strictEqual(doc.intake.doc_type, 'unknown');
  assert.strictEqual(doc.intake.classification_status, 'needs_review');
  assert.strictEqual(doc.intake.extraction.text_available, false);
  assert.strictEqual(doc.intake.extraction.method, 'filename_only');
  const stored = db.financial_documents.find(d => d.id === r.body.document.id);
  assert.strictEqual(stored.extracted_json.ai_intake.content_classification_enabled, false);
  assert.strictEqual(stored.extracted_json.ai_intake.classifier_version, 1);
  assert.ok(!JSON.stringify(stored.extracted_json).includes('PERSEROAN TERBATAS'),
    'no document text is stored when the flag is off');
});

test('flag OFF: a file-name match still classifies exactly as Phase 1 did', async () => {
  const r = await uploadFile({ businessId: BIZ_A, userId: OWNER,
    file_name: 'NPWP_test_company.pdf', content: makePdf('unrelated text') });
  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const doc = list.body.documents.find(d => d.id === r.body.document.id);
  assert.strictEqual(doc.intake.doc_type, 'npwp');
  assert.strictEqual(doc.intake.confidence, 'high');
  assert.strictEqual(doc.intake.classification_status, 'auto_classified');
});

test('flag OFF: reclassify returns a safe disabled response and writes nothing', async () => {
  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const id = list.body.documents[0].id;
  const before = db.document_audit.length;
  const r = await call('POST', `/api/ai-accountant/documents/${id}/reclassify`,
    { userId: OWNER, businessId: BIZ_A });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.error, 'content_classification_disabled');
  assert.ok(!/relation|column|storage_path|ECONN/i.test(JSON.stringify(r.body)), 'no internals');
  assert.strictEqual(db.document_audit.length, before, 'nothing written');
});

test('flag OFF: reclassify still requires auth, and rejects personal workspaces', async () => {
  const anon = await call('POST', '/api/ai-accountant/documents/x/reclassify', {});
  assert.strictEqual(anon.status, 401);
  const personal = await call('POST', '/api/ai-accountant/documents/x/reclassify',
    { userId: OWNER, businessId: PERSONAL });
  assert.ok(personal.status >= 400 && personal.status < 500);
});

test('flag OFF: manual confirmation still works', async () => {
  const list = await call('GET', INTAKE, { userId: OWNER, businessId: BIZ_A });
  const id = list.body.documents[0].id;
  const r = await call('PATCH', `/api/ai-accountant/documents/${id}/classification`,
    { userId: OWNER, businessId: BIZ_A, body: { doc_type: 'nib' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.classification_status, 'manually_confirmed');
});
