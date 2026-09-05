// When is a stored reading still the answer, and when must we pay again?
// Run: node tests/visionCacheMatrix.test.js
//
// The cache decides whether real money is spent, so "probably fresh" is not good enough
// in either direction. A wrong hit serves a stale reading of a financial document; a
// wrong miss quietly doubles the bill. Each row below is one way that decision can be
// asked, written out so the whole matrix is visible rather than implied.
const assert = require('node:assert');
const C = require('../server/lib/visionCache');
const modelPolicy = require('../server/lib/modelPolicy');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const BYTES = Buffer.from('%PDF-1.4 the same invoice, byte for byte');
const OTHER = Buffer.from('%PDF-1.4 a different invoice entirely');
const CFG = {
  model: modelPolicy.PRIMARY_EXTRACTION_MODEL,
  promptVersion: 'fin-doc-id-v3.2',
  schemaVersion: 'financial_document_extraction_v3',
};

/** A stored v3 record, as buildV3Summary writes it. */
const stored = (fingerprint, over = {}) => ({ fingerprint, analyzed: true, ...over });

(async () => {
  const fp = C.fingerprintOf(BYTES, CFG);
  console.log('\nCache durability matrix');

  await t('1. same bytes, same configuration — HIT, and nothing is bought', () => {
    assert.strictEqual(C.isFresh(stored(fp), C.fingerprintOf(BYTES, CFG)), true);
  });

  await t('2. a different model — MISS. A reading is the answer OF a model', () => {
    const other = C.fingerprintOf(BYTES, { ...CFG, model: 'claude-opus-4-5-20251101' });
    assert.notStrictEqual(other, fp);
    assert.strictEqual(C.isFresh(stored(fp), other), false);
  });

  await t('3. a changed prompt — MISS. Different instructions, different reading', () => {
    const other = C.fingerprintOf(BYTES, { ...CFG, promptVersion: 'fin-doc-id-v3.3' });
    assert.strictEqual(C.isFresh(stored(fp), other), false);
  });

  await t('4. a changed schema — MISS. Different fields asked for', () => {
    const other = C.fingerprintOf(BYTES, { ...CFG, schemaVersion: 'financial_document_extraction_v4' });
    assert.strictEqual(C.isFresh(stored(fp), other), false);
  });

  await t('5. different bytes — MISS, even for the same document number', () => {
    assert.strictEqual(C.isFresh(stored(fp), C.fingerprintOf(OTHER, CFG)), false);
  });

  await t('6. a recorded FAILURE is never a hit, or retry could never call again', () => {
    const failed = { fingerprint: fp, analyzed: false, failure: { reason: 'vision_timeout', retryable: true } };
    assert.strictEqual(C.isFresh(failed, fp), false);
    // and the successful reading of those same bytes still is
    assert.strictEqual(C.isFresh(stored(fp), fp), true);
  });

  await t('7. two concurrent requests for one identity — ONE provider call', async () => {
    let calls = 0;
    const work = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 'read'; };
    const results = await Promise.all(Array.from({ length: 8 }, () => C.singleFlight(fp, work)));
    assert.strictEqual(calls, 1, `paid ${calls} times for one document`);
    assert.deepStrictEqual(new Set(results), new Set(['read']));
    assert.strictEqual(C.inFlightCount(), 0, 'the flight must be released');
  });

  await t('8. a restart loses the in-flight map but NOT the stored answer', () => {
    // singleFlight is in-process; the fingerprint lives on the document row. So a deploy
    // costs nothing: the next read of the same document still hits.
    delete require.cache[require.resolve('../server/lib/visionCache')];
    const fresh = require('../server/lib/visionCache');
    assert.strictEqual(fresh.inFlightCount(), 0, 'a new process starts with no flights');
    assert.strictEqual(fresh.fingerprintOf(BYTES, CFG), fp, 'the fingerprint must survive a restart');
    assert.strictEqual(fresh.isFresh(stored(fp), fp), true);
  });

  await t('9. the cache holds no documents of its own — scope comes from the row', () => {
    // Two businesses uploading identical bytes produce the same fingerprint, which is
    // fine ONLY because a stored reading is read off that business's own document row.
    // If this module ever grew a global store keyed by fingerprint, one business would
    // serve another's reading. It has no store, and this asserts that it stays that way.
    const exported = Object.keys(C).sort();
    assert.deepStrictEqual(exported, ['fingerprintOf', 'inFlightCount', 'isFresh', 'singleFlight'],
      `visionCache exports changed: ${exported.join(', ')}`);
    for (const [name, v] of Object.entries(C)) {
      assert.strictEqual(typeof v, 'function', `${name} must be a function, not a store`);
    }
  });

  await t('a fingerprint is short, stable and safe to log', () => {
    assert.match(fp, /^[0-9a-f]{32}$/);
    assert.strictEqual(fp, C.fingerprintOf(BYTES, CFG), 'the same input must give the same answer');
    assert.ok(!fp.includes(BYTES.toString('latin1').slice(0, 8)), 'it must not carry document bytes');
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
