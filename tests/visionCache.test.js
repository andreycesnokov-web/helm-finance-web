// Never pay twice for the same reading.
// Run: node tests/visionCache.test.js
const assert = require('node:assert');
const C = require('../server/lib/visionCache');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const CFG = { model: 'claude-sonnet-4-5', promptVersion: 'fin-doc-id-v3.1',
  schemaVersion: 'financial_document_extraction_v3' };
const A = Buffer.from('%PDF document A');
const B = Buffer.from('%PDF document B');

(async () => {
  console.log('\nIdentity of a reading');
  await t('the same bytes and configuration give the same fingerprint', () => {
    assert.strictEqual(C.fingerprintOf(A, CFG), C.fingerprintOf(A, CFG));
  });

  await t('different bytes give a different fingerprint', () => {
    assert.notStrictEqual(C.fingerprintOf(A, CFG), C.fingerprintOf(B, CFG));
  });

  await t('changing the model, prompt or schema invalidates the reading', () => {
    const base = C.fingerprintOf(A, CFG);
    assert.notStrictEqual(base, C.fingerprintOf(A, { ...CFG, model: 'other-model' }));
    assert.notStrictEqual(base, C.fingerprintOf(A, { ...CFG, promptVersion: 'v9' }));
    assert.notStrictEqual(base, C.fingerprintOf(A, { ...CFG, schemaVersion: 'v4' }));
  });

  await t('a field boundary stops one input imitating another', () => {
    // "a" + " model" must not collide with "a model" + ""
    assert.notStrictEqual(
      C.fingerprintOf(Buffer.from('a'), { model: 'm', promptVersion: 'p', schemaVersion: 's' }),
      C.fingerprintOf(Buffer.from('a m'), { model: '', promptVersion: 'p', schemaVersion: 's' }));
  });

  console.log('\n4. an unchanged document is not read again');
  await t('4. a stored record with the same fingerprint is fresh', () => {
    const fp = C.fingerprintOf(A, CFG);
    assert.strictEqual(C.isFresh({ fingerprint: fp }, fp), true);
  });

  await t('a stored record from another configuration is NOT fresh', () => {
    const fp = C.fingerprintOf(A, CFG);
    const old = C.fingerprintOf(A, { ...CFG, promptVersion: 'v3.0' });
    assert.strictEqual(C.isFresh({ fingerprint: old }, fp), false, 'a new prompt must re-read');
  });

  await t('a record with no fingerprint is never fresh', () => {
    assert.strictEqual(C.isFresh({}, C.fingerprintOf(A, CFG)), false);
    assert.strictEqual(C.isFresh(null, C.fingerprintOf(A, CFG)), false);
    assert.strictEqual(C.isFresh({ fingerprint: 'x' }, null), false);
  });

  console.log('\n5. concurrent requests share one call');
  await t('5. ten simultaneous callers produce ONE provider call', async () => {
    let calls = 0;
    const work = async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return calls; };
    const fp = C.fingerprintOf(A, CFG);
    const results = await Promise.all(Array.from({ length: 10 }, () => C.singleFlight(fp, work)));
    assert.strictEqual(calls, 1, `the provider was called ${calls} times`);
    assert.deepStrictEqual(new Set(results), new Set([1]), 'every caller got the same answer');
  });

  await t('different documents are not collapsed into one call', async () => {
    let calls = 0;
    const work = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); };
    await Promise.all([
      C.singleFlight(C.fingerprintOf(A, CFG), work),
      C.singleFlight(C.fingerprintOf(B, CFG), work),
    ]);
    assert.strictEqual(calls, 2, 'two documents are two readings');
  });

  await t('the flight is released so a later call still runs', async () => {
    let calls = 0;
    const work = async () => { calls++; };
    const fp = C.fingerprintOf(A, CFG);
    await C.singleFlight(fp, work);
    await C.singleFlight(fp, work);
    assert.strictEqual(calls, 2, 'sequential calls are not cached by single-flight');
    assert.strictEqual(C.inFlightCount(), 0, 'nothing is left in flight');
  });

  await t('a failure is released too, and does not poison later calls', async () => {
    const fp = C.fingerprintOf(B, CFG);
    await assert.rejects(() => C.singleFlight(fp, async () => { throw new Error('provider down'); }));
    assert.strictEqual(C.inFlightCount(), 0);
    const ok = await C.singleFlight(fp, async () => 'recovered');
    assert.strictEqual(ok, 'recovered');
  });

  await t('every concurrent caller sees the same failure', async () => {
    const fp = C.fingerprintOf(A, CFG);
    let calls = 0;
    const boom = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); throw new Error('down'); };
    const rs = await Promise.allSettled([C.singleFlight(fp, boom), C.singleFlight(fp, boom)]);
    assert.strictEqual(calls, 1, 'one attempt, not two');
    assert.ok(rs.every((r) => r.status === 'rejected'));
  });

  console.log(`\n${fail === 0 ? `ALL PASS — ${pass} passed, 0 failed` : `${pass} passed, ${fail} FAILED`}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
