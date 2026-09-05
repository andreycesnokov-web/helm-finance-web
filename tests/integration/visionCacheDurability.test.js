// Does the cache survive a restart, and does it stay inside one business?
//
// The unit matrix proves the fingerprint FUNCTION behaves. It cannot prove durability,
// because durability is a property of where the answer is written, not of the comparison.
// So this drives the real server over HTTP, counts actual provider calls, and — for the
// case that matters most — starts a SECOND Node process against the same persisted row.
//
// Where the cache lives:
//   financial_documents.extracted_json.ai_intake_v3            (JSONB, on the document row)
//   financial_documents.extracted_json.ai_intake_v3.fingerprint
// There is no cache table. Durability is therefore Postgres durability, and scoping is
// the document row's own business_id. `singleFlight` is in-process and deduplicates
// concurrent work; it is not, and does not pretend to be, the cache.
//
// Run: node tests/integration/visionCacheDurability.test.js
const path = require('path');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { spawnSync } = require('child_process');
const mem = require('./_memorySupabase');

const ROOT = path.join(__dirname, '..', '..');
const CHILD = process.argv[2] === '--child';
const HANDOFF = process.argv[3] || path.join(os.tmpdir(), 'v3-cache-handoff.json');

Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:0/fake', SUPABASE_SECRET_KEY: 'fake', BOT_TOKEN: 'fake',
  JWT_SECRET: 'cache-durability-secret', TELEGRAM_WEBHOOK_SECRET: 'fake',
  PORT: CHILD ? '5623' : '5622', NODE_ENV: 'test',
  DOCUMENT_OCR_VISION_ENABLED: 'true',
});

const PDF_A = Buffer.from('%PDF-1.4\n% scanned invoice, business A\n%%EOF\n', 'latin1');
const PDF_B = Buffer.from('%PDF-1.4\n% a different document entirely\n%%EOF\n', 'latin1');

const FILES = {
  'a/one.pdf': PDF_A,
  'a/two.pdf': PDF_B,
  // Byte-for-byte identical to business A's file, uploaded by a different business.
  'b/one.pdf': PDF_A,
};

/* ── the provider, counted ─────────────────────────────────────────────────── */
let PROVIDER_CALLS = 0;
let MODE = 'ok';

const EXTRACTION = () => ({
  schema_version: 'financial_document_extraction_v3',
  document_type: { value: 'invoice', confidence: 0.97, evidence: [{ page: 1, printed_text: 'INVOICE' }] },
  document_number: { value: 'CACHE-1', confidence: 0.95, evidence: [] },
  language: ['id'],
  parties: [
    { party_id: 'party_1', role: 'supplier', legal_name: { value: 'PT Vendor Sentosa', confidence: 0.95, evidence: [{ page: 1, printed_text: 'PT Vendor Sentosa', section: 'issuer_header' }] }, npwp: { value: null, normalized_value: null, confidence: 0.5, evidence: [] }, address: { value: null, confidence: 0.5, evidence: [] }, bank_accounts: [] },
    { party_id: 'party_2', role: 'buyer', legal_name: { value: 'Helm Care Indonesia', confidence: 0.95, evidence: [{ page: 1, printed_text: 'Helm Care Indonesia', section: 'buyer_header' }] }, npwp: { value: null, normalized_value: null, confidence: 0.5, evidence: [] }, address: { value: null, confidence: 0.5, evidence: [] }, bank_accounts: [] },
  ],
  current_business_party_id: 'party_2',
  counterparty_candidate_party_id: 'party_1',
  relationship_confidence: 0.96,
  dates: {
    document_date: { value: '2026-08-04', printed_text: '04-08-2026', confidence: 0.9, evidence: [] },
    due_date: { value: null, printed_text: null, confidence: 0.5, evidence: [] },
    payment_date: { value: null, printed_text: null, confidence: 0.5, evidence: [] },
  },
  amounts: { currency: 'IDR', total: { value: 1000000, calculated: false, confidence: 0.95, evidence: [] } },
  warnings: [], pages_analyzed: [1], page_count: 1, analysis_complete: true,
});

const origLoad = Module._load;
Module._load = function (request) {
  if (request === '@anthropic-ai/sdk') {
    return class FakeAnthropic {
      constructor() {
        this.messages = { create: async () => {
          PROVIDER_CALLS += 1;
          if (MODE === 'throw') { const e = new Error('overloaded'); e.status = 529; throw e; }
          await new Promise((r) => setTimeout(r, 15));
          return {
            content: [{ type: 'tool_use', name: 'record_financial_document', input: EXTRACTION() }],
            model: 'claude-opus-5',
            usage: { input_tokens: 4000, output_tokens: 900 },
          };
        } };
      }
    };
  }
  if (request === '@supabase/supabase-js') {
    const client = mem.createClient();
    client.storage = { from: () => ({
      download: async (p) => (FILES[p]
        ? { data: { arrayBuffer: async () => FILES[p] }, error: null }
        : { data: null, error: { message: 'not found' } }),
      createSignedUploadUrl: async () => ({ data: null, error: null }),
    }) };
    return { ...mem, createClient: () => client };
  }
  return origLoad.apply(this, arguments);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const USER = 950202;
const USER_B = 950303;

/* In the child, the document rows come from the handoff file — the state a restart would
   have found in the database, nothing more. */
const seeded = CHILD ? JSON.parse(fs.readFileSync(HANDOFF, 'utf8')) : null;

mem.__seed('businesses', [
  { id: A, name: 'Helm Care Indonesia', type: 'company', owner_user_id: USER, created_at: '2026-01-01' },
  { id: B, name: 'Другая компания', type: 'company', owner_user_id: USER_B, created_at: '2026-01-02' },
]);
mem.__seed('business_members', [
  { id: 1, user_id: USER, business_id: A, role: 'owner', status: 'active' },
  { id: 2, user_id: USER_B, business_id: B, role: 'owner', status: 'active' },
]);
mem.__seed('business_addons', [
  { id: 'ad-a', business_id: A, addon: 'ai_accountant', status: 'active' },
  { id: 'ad-b', business_id: B, addon: 'ai_accountant', status: 'active' },
]);
mem.__seed('document_files', [
  { id: 'f-one', business_id: A, storage_path: 'a/one.pdf', file_name: 'one.pdf', mime_type: 'application/pdf' },
  { id: 'f-two', business_id: A, storage_path: 'a/two.pdf', file_name: 'two.pdf', mime_type: 'application/pdf' },
  { id: 'f-conc', business_id: A, storage_path: 'a/one.pdf', file_name: 'conc.pdf', mime_type: 'application/pdf' },
  { id: 'f-fail', business_id: A, storage_path: 'a/one.pdf', file_name: 'fail.pdf', mime_type: 'application/pdf' },
  { id: 'f-b-one', business_id: B, storage_path: 'b/one.pdf', file_name: 'one.pdf', mime_type: 'application/pdf' },
]);
mem.__seed('financial_documents', seeded || [
  { id: 'd-one', business_id: A, file_id: 'f-one', document_type: 'other', currency: 'IDR' },
  { id: 'd-two', business_id: A, file_id: 'f-two', document_type: 'other', currency: 'IDR' },
  { id: 'd-conc', business_id: A, file_id: 'f-conc', document_type: 'other', currency: 'IDR' },
  { id: 'd-fail', business_id: A, file_id: 'f-fail', document_type: 'other', currency: 'IDR' },
  { id: 'd-b-one', business_id: B, file_id: 'f-b-one', document_type: 'other', currency: 'IDR' },
]);
mem.__seed('counterparties', []);
mem.__seed('tax_rules', []);

require(path.join(ROOT, 'server', 'index.js'));

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const tok = (u) => jwt.sign({ userId: u }, process.env.JWT_SECRET);
async function intake(docId, { user = USER, biz = A } = {}) {
  const res = await fetch(`${BASE}/documents/${docId}/intake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok(user)}`, 'x-business-id': biz },
  });
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}
const docRow = (id) => (mem.__db.financial_documents || []).find((d) => d.id === id);
const fingerprintOf = (id) => docRow(id)?.extracted_json?.ai_intake_v3?.fingerprint || null;

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

/** Count provider calls across one action. */
async function calls(fn) {
  const before = PROVIDER_CALLS;
  const out = await fn();
  return { delta: PROVIDER_CALLS - before, out };
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));   // let the server bind

  if (CHILD) {
    /* ── scenario 3, second half ─────────────────────────────────────────────
       A brand-new process. Nothing is in memory: no singleFlight map, no module
       state, no warm anything. The only thing carried over is the document row. */
    console.log('\n[child process] scenario 3 — new process, same persisted record');
    await t('3. a fresh process serves the stored reading and calls nobody', async () => {
      assert.ok(fingerprintOf('d-one'), 'the handoff row must already carry a fingerprint');
      const { delta, out } = await calls(() => intake('d-one'));
      assert.strictEqual(out.status, 200, JSON.stringify(out.body));
      assert.strictEqual(delta, 0, `a restarted process paid again (${delta} provider call(s))`);
      assert.strictEqual(out.body.stored, false, 'an unchanged summary must not rewrite the row');
    });
    console.log(`\n${fail === 0 ? `CHILD OK — ${pass} passed` : `CHILD FAILED — ${fail}`}`);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log('\nCache durability, over HTTP, counting real provider calls');

  await t('1. same process, same document, run twice — one call', async () => {
    const first = await calls(() => intake('d-one'));
    assert.strictEqual(first.out.status, 200, JSON.stringify(first.out.body));
    assert.strictEqual(first.delta, 1, 'the first read must call the provider');
    assert.ok(fingerprintOf('d-one'), 'the fingerprint must be persisted on the row');

    const second = await calls(() => intake('d-one'));
    assert.strictEqual(second.delta, 0, `the repeat paid again (${second.delta})`);

    // The cached path rebuilds ai_intake_v2 from the stored v3 FIELDS rather than from the
    // full v3 extraction, so the first cached run can differ from the fresh one by a
    // presentation detail and rewrite the row once. It must then settle: a third run may
    // not keep churning the row or the audit trail.
    const third = await calls(() => intake('d-one'));
    assert.strictEqual(third.delta, 0, 'a third run paid too');
    assert.strictEqual(third.out.body.stored, false,
      `the summary never settles — still rewriting on run 3 (run 2 stored=${second.out.body.stored})`);
  });

  await t('2. same process, concurrent requests — one call', async () => {
    const before = PROVIDER_CALLS;
    const results = await Promise.all([intake('d-conc'), intake('d-conc'), intake('d-conc')]);
    const delta = PROVIDER_CALLS - before;
    for (const r of results) assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(delta, 1, `three simultaneous requests cost ${delta} calls`);
  });

  await t('4. different bytes — a miss, and a second document is read', async () => {
    const { delta } = await calls(() => intake('d-two'));
    assert.strictEqual(delta, 1, 'a different document must be read, not served from another');
    assert.notStrictEqual(fingerprintOf('d-two'), fingerprintOf('d-one'),
      'two different documents must not share a fingerprint');
  });

  for (const [n, field, mutate] of [
    [5, 'model', (fp) => `${fp.slice(0, 30)}zz`],
    [6, 'prompt version', (fp) => `${fp.slice(0, 30)}yy`],
    [7, 'schema version', (fp) => `${fp.slice(0, 30)}xx`],
  ]) {
    await t(`${n}. a changed ${field} — a miss, and the document is read again`, async () => {
      // The fingerprint mixes bytes + model + prompt + schema, so changing any of the
      // three is indistinguishable from changing the stored fingerprint: the identity no
      // longer matches and the answer is bought again. Simulated by moving the stored
      // one, which is exactly what a version bump does to it.
      const row = docRow('d-one');
      row.extracted_json.ai_intake_v3.fingerprint = mutate(fingerprintOf('d-one'));
      const { delta } = await calls(() => intake('d-one'));
      assert.strictEqual(delta, 1, `a changed ${field} was served from cache`);
    });
  }

  await t('8. a failed reading is retried, not served back as the answer', async () => {
    MODE = 'throw';
    const failed = await calls(() => intake('d-fail'));
    assert.strictEqual(failed.delta, 1, 'the failing attempt must reach the provider');
    const stored = docRow('d-fail')?.extracted_json?.ai_intake_v3;
    assert.ok(stored, 'the failure must be recorded');
    assert.strictEqual(stored.analyzed, false, 'a failure must not be stored as a reading');

    MODE = 'ok';
    const retried = await calls(() => intake('d-fail'));
    assert.strictEqual(retried.delta, 1, 'the retry must actually call again, not return the failure');
    assert.strictEqual(docRow('d-fail').extracted_json.ai_intake_v3.analyzed, true,
      'the retry must replace the failure with a reading');
  });

  await t('9. identical bytes in another business are read separately', async () => {
    // b/one.pdf is byte-for-byte a/one.pdf. The fingerprints therefore MATCH — and that
    // must not matter, because a stored reading is read off the asking business's own
    // document row. If it ever did matter, one business would see another's extraction.
    const { delta, out } = await calls(() => intake('d-b-one', { user: USER_B, biz: B }));
    assert.strictEqual(out.status, 200, JSON.stringify(out.body));
    assert.strictEqual(delta, 1, "business B was served business A's reading");
    assert.strictEqual(fingerprintOf('d-b-one'), fingerprintOf('d-one'),
      'identical bytes SHOULD fingerprint identically — scoping is the row, not the hash');
  });

  await t("a business cannot reach another business's document at all", async () => {
    const r = await intake('d-one', { user: USER_B, biz: B });
    assert.strictEqual(r.status, 404, `expected 404, got ${r.status}`);
  });

  /* ── hand the persisted state to a genuinely new process ──────────────────── */
  await t('3. (setup) the stored reading is handed to a new process', async () => {
    // Restore d-one to a real, current reading first — the version-bump cases above left
    // its fingerprint mutated.
    await intake('d-one');
    assert.ok(fingerprintOf('d-one'), 'd-one must carry a fingerprint before the handoff');
    fs.writeFileSync(HANDOFF, JSON.stringify(mem.__db.financial_documents));

    const r = spawnSync(process.execPath, [__filename, '--child', HANDOFF], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.stderr) process.stderr.write(r.stderr);
    assert.strictEqual(r.status, 0, 'the child process failed — see its output above');
  });

  try { fs.unlinkSync(HANDOFF); } catch { /* already gone */ }

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exit(fail === 0 ? 0 : 1);
})();
