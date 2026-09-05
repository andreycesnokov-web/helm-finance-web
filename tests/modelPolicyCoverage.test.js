// Which code is allowed to name a model, and which must ask the policy.
// Run: node tests/modelPolicyCoverage.test.js
//
// The Opus rule is easy to state and easy to lose. It was already lost once: the Document
// Center was moved to Opus while `recognizeReceipt` went on reading Telegram receipts with
// Sonnet 4.5 — the same act, through a different door, setting the amount of a real debt.
// Nothing failed, because nothing was checking.
//
// So this reads the source rather than the behaviour. Every provider call is found, its
// model expression extracted, and each one has to be either policy-governed or an
// explicitly listed auxiliary that does not read financial evidence. A new call site fails
// until someone writes down which of the two it is.
'use strict';

const fs = require('fs');
const path = require('path');
const modelPolicy = require('../server/lib/modelPolicy');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const ROOT = path.join(__dirname, '..', 'server');

/** Every .js file under server/, so a new one cannot hide. */
function serverFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) serverFiles(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const rel = (abs) => path.relative(path.join(__dirname, '..'), abs).split(path.sep).join('/');

/** Find every messages.create( call and the model expression it uses. */
function providerCalls() {
  const calls = [];
  for (const abs of serverFiles()) {
    const src = fs.readFileSync(abs, 'utf8');
    const re = /messages\.create\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + 1200);
      const model = window.match(/model:\s*([^,\n]+)/);
      const line = src.slice(0, m.index).split('\n').length;
      let expr = model ? model[1].trim() : null;
      // `model: MODEL` says nothing on its own. Follow a bare identifier to the
      // module-level const it names, so a reader that resolves through the policy is not
      // mistaken for one that hardcodes a name.
      if (expr && /^[A-Za-z_$][\w$]*$/.test(expr)) {
        const decl = src.match(new RegExp(`const\\s+${expr}\\s*=\\s*([^;\\n]+)`));
        if (decl) expr = decl[1].trim();
      }
      calls.push({
        file: rel(abs),
        line,
        model: expr,
        // A call that sends a document or an image is reading a document, whatever it is called.
        sendsMedia: /type:\s*'(document|image)'/.test(window),
      });
    }
  }
  return calls;
}

/* ── the readers that must obey the policy ─────────────────────────────────
   Named explicitly, because "it looks like a document reader" is not something a
   regex should be left to decide about accounting code. */
const FINANCIAL_DOCUMENT_READERS = [
  { file: 'server/lib/documentVisionV3.js', what: 'primary extraction from an uploaded document' },
  { file: 'server/lib/documentBundle.js', what: 'segmenting one file into several documents' },
  { file: 'server/lib/documentOcr.js', what: 'the legacy transcript reader — unreachable, still a reader' },
];

/* Call sites allowed to name a model directly, each with the reason it does not read
   financial evidence. This is a PIN: a new provider call anywhere under server/ fails the
   test until it is added here or routed through the policy. */
const ALLOWED_AUXILIARY = [
  { file: 'server/index.js', why: 'accountant Q&A over already-stored records — no document is read' },
  { file: 'server/index.js', why: 'categorising already-parsed bank statement rows — a suggestion, not extraction' },
  { file: 'server/index.js', why: '/api/parse — typed free text from the request body, not an uploaded document' },
  { file: 'server/index.js', why: 'CFO assistant conversation — no document is read' },
];

/** Models no financial-document reader may name, in any form. */
const PROHIBITED_IN_READERS = [
  'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5',
  'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101',
];

console.log('\nThe policy is the only place a reader names a model');

for (const reader of FINANCIAL_DOCUMENT_READERS) {
  t(`${reader.file} resolves its model through the policy`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', reader.file), 'utf8');
    assert_ok(/modelPolicy\.modelFor\(/.test(src),
      `${reader.file} (${reader.what}) must call modelPolicy.modelFor`);
  });

  t(`${reader.file} names no cheaper model anywhere`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', reader.file), 'utf8');
    for (const bad of PROHIBITED_IN_READERS) {
      // Comments are source too: a commented-out model is the next person's shortcut.
      assert_ok(!src.includes(bad), `${reader.file} contains "${bad}"`);
    }
  });
}

t('the Telegram receipt reader resolves through the policy too', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server/index.js'), 'utf8');
  const at = src.indexOf('async function recognizeReceipt');
  assert_ok(at > -1, 'recognizeReceipt not found');
  const body = src.slice(at, src.indexOf('\n}', at) + 2);
  assert_ok(/modelPolicy\.modelFor\('receipt_extraction'\)/.test(body),
    'recognizeReceipt must ask the policy for its model');
  for (const bad of PROHIBITED_IN_READERS) {
    assert_ok(!body.includes(bad), `recognizeReceipt contains "${bad}"`);
  }
  // It reads a receipt and the amount it returns sets a debt. It refuses a non-Opus answer.
  assert_ok(/modelPolicy\.isOpus\(resp\.model\)/.test(body),
    'recognizeReceipt must verify the model that actually answered');
});

t('every task that reads a financial document requires Opus', () => {
  for (const task of ['primary_extraction', 'bundle_segmentation', 'receipt_extraction']) {
    const m = modelPolicy.modelFor(task);
    assert_ok(modelPolicy.isOpus(m), `${task} resolved to ${m}`);
  }
  assert_ok(modelPolicy.OPUS_REQUIRED_TASKS.length >= 3,
    `expected at least 3 Opus-required tasks, found ${modelPolicy.OPUS_REQUIRED_TASKS.length}`);
});

console.log('\nNo provider call escapes review');

t('every call that sends a document or an image is policy-governed', () => {
  const offenders = providerCalls()
    .filter((c) => c.sendsMedia)
    .filter((c) => !/modelPolicy\.modelFor/.test(c.model || ''));
  assert_ok(offenders.length === 0,
    `media is sent to a model chosen outside the policy:\n      `
    + offenders.map((c) => `${c.file}:${c.line} model=${c.model}`).join('\n      '));
});

t('the set of hardcoded-model call sites is pinned', () => {
  // Not a style rule. A new provider call added without thought is exactly how the
  // Telegram receipt path stayed on Sonnet while everything else moved.
  const literals = providerCalls().filter((c) => c.model && !/modelPolicy\./.test(c.model));
  assert_ok(literals.length === ALLOWED_AUXILIARY.length,
    `expected ${ALLOWED_AUXILIARY.length} hardcoded-model call sites, found ${literals.length}:\n      `
    + literals.map((c) => `${c.file}:${c.line} model=${c.model}`).join('\n      ')
    + '\n      If this is a new call, route it through modelPolicy or add it to'
    + '\n      ALLOWED_AUXILIARY with the reason it reads no financial evidence.');
});

t('no auxiliary call site sends a document or an image', () => {
  // The line between "auxiliary" and "financial-document reader" is whether a document
  // travels. If one ever does from an auxiliary site, it stopped being auxiliary.
  const literals = providerCalls().filter((c) => c.model && !/modelPolicy\./.test(c.model));
  const withMedia = literals.filter((c) => c.sendsMedia);
  assert_ok(withMedia.length === 0,
    `an auxiliary call sends media:\n      ` + withMedia.map((c) => `${c.file}:${c.line}`).join('\n      '));
});

function assert_ok(cond, msg) { if (!cond) throw new Error(msg); }

console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
process.exitCode = fail === 0 ? 0 : 1;
