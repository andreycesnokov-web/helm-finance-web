'use strict';
// OCR-OFF: with DOCUMENT_OCR_VISION_ENABLED not 'true', no document content reaches a paid model.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const identify = require('../server/lib/documentIdentify');
const profile = require('../server/lib/profileFromDocuments');

const fakeClient = () => { const c = { calls: 0, messages: { create: async () => { c.calls++; return { content: [{ text: '{}' }] }; } } }; return c; };
const withEnv = async (env, fn) => {
  const keep = { V: process.env.DOCUMENT_OCR_VISION_ENABLED, K: process.env.ANTHROPIC_API_KEY };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { await fn(); } finally {
    if (keep.V === undefined) delete process.env.DOCUMENT_OCR_VISION_ENABLED; else process.env.DOCUMENT_OCR_VISION_ENABLED = keep.V;
    if (keep.K === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = keep.K;
  }
};

for (const flag of [undefined, 'false', 'TRUE', '1']) {
  test(`document identify and profile reading make no paid call when the flag is ${flag}`, async () => {
    await withEnv({ DOCUMENT_OCR_VISION_ENABLED: flag, ANTHROPIC_API_KEY: 'sk-test-not-real' }, async () => {
      const c = fakeClient();
      const a = await identify.explainDocument({ client: c, text: 'Invoice INV-1 total Rp 1.000.000', verdict: {}, types: [] });
      const b = await profile.readDocument({ client: c, text: 'NPWP 01.234.567.8-012.000', docType: 'npwp' });
      assert.strictEqual(c.calls, 0);
      assert.deepStrictEqual([a.ok, a.reason, b.ok, b.reason], [false, 'paid_document_ai_disabled', false, 'paid_document_ai_disabled']);
    });
  });
}

test('with the flag on the existing model path is used (one call each)', async () => {
  await withEnv({ DOCUMENT_OCR_VISION_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test-not-real' }, async () => {
    const c = fakeClient();
    await identify.explainDocument({ client: c, text: 'Invoice INV-1', verdict: {}, types: [] });
    await profile.readDocument({ client: c, text: 'NPWP 01.234.567.8-012.000', docType: 'npwp' });
    assert.strictEqual(c.calls, 2);
  });
});

test('receipt recognition and the statement-reading fallback check the switch before calling the model', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(src.indexOf('async function recognizeReceipt(file) {'), src.indexOf('async function recognizeReceipt(file) {') + 2500);
  assert.ok(fn.indexOf('docProviderPolicy.paidDocumentAIEnabled()') > 0 && fn.indexOf('docProviderPolicy.paidDocumentAIEnabled()') < fn.indexOf('messages.create'));
  const route = src.slice(src.indexOf("app.post('/api/bank-import/read'"), src.indexOf("app.post('/api/bank-import/read'") + 5000);
  assert.ok(route.indexOf('docProviderPolicy.paidDocumentAIEnabled()') > 0 && route.indexOf('docProviderPolicy.paidDocumentAIEnabled()') < route.indexOf('messages.create'));
  assert.match(src, /const docProviderPolicy = require\('\.\/lib\/documentProviderPolicy'\);/);
});

test('every remaining paid model call in server code is either guarded or not document content', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  // Text-only assistants (AI CFO, accountant questions, statement row categorisation, text parse) send no file bytes.
  const allowed = ["app.post('/api/accountant/ask'", 'async function aiSuggestRows', "app.post('/api/parse'", "app.post('/api/ai-cfo/ask'",
    'async function recognizeReceipt', "app.post('/api/bank-import/read'"];
  let at = 0, n = 0;
  while ((at = src.indexOf('anthropic.messages.create(', at + 1)) > 0) {
    n++;
    const head = src.slice(0, at);
    const owner = Math.max(...allowed.map((a) => head.lastIndexOf(a)));
    const nextRoute = head.lastIndexOf('\napp.');
    const nextFn = head.lastIndexOf('\nasync function ');
    assert.ok(owner >= Math.max(nextRoute, nextFn) - 1, `unreviewed paid call at offset ${at}`);
  }
  assert.strictEqual(n, 6, 'a new paid model call needs a review here');
});
