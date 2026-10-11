// Unit tests for onboarding locale resolution and progress arithmetic (pure, no I/O).
// Run: node --test tests/onboarding.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const O = require('../server/lib/onboarding');

// ── Locale resolution ────────────────────────────────────────────────────────────────────
test('supported locales resolve to themselves', () => {
  for (const l of ['en', 'id', 'ru']) assert.strictEqual(O.resolveLocale(l), l);
});

test('region tags and casing are normalised', () => {
  assert.strictEqual(O.resolveLocale('ru-RU'), 'ru');
  assert.strictEqual(O.resolveLocale('id_ID'), 'id');
  assert.strictEqual(O.resolveLocale('EN'), 'en');
  assert.strictEqual(O.resolveLocale('  Ru  '), 'ru');
});

test('an unsupported or malformed locale falls back to English, never throws', () => {
  // A bad ?locale= must degrade to readable content, not to an error page.
  for (const bad of ['fr', 'zh-Hans', '', '   ', null, undefined, 42, {}, []]) {
    assert.strictEqual(O.resolveLocale(bad), 'en');
  }
});

// ── Text picking ─────────────────────────────────────────────────────────────────────────
test('the requested locale wins when present', () => {
  assert.strictEqual(O.pick({ ru: 'Привет', id: 'Halo' }, 'Hello', 'ru'), 'Привет');
  assert.strictEqual(O.pick({ ru: 'Привет', id: 'Halo' }, 'Hello', 'id'), 'Halo');
});

test('a missing locale falls back to the English column', () => {
  assert.strictEqual(O.pick({ ru: 'Привет' }, 'Hello', 'id'), 'Hello');
  assert.strictEqual(O.pick({}, 'Hello', 'ru'), 'Hello');
  assert.strictEqual(O.pick(null, 'Hello', 'ru'), 'Hello');
});

test('an en key inside the map is preferred over the plain column', () => {
  assert.strictEqual(O.pick({ en: 'Newer English' }, 'Older English', 'fr'), 'Newer English');
});

test('blank translations do not win - they fall through', () => {
  // An empty string in the map would otherwise render as a blank step title.
  assert.strictEqual(O.pick({ ru: '   ' }, 'Hello', 'ru'), 'Hello');
  assert.strictEqual(O.pick({ ru: '' }, 'Hello', 'ru'), 'Hello');
});

test('a malformed i18n value is ignored rather than rendered', () => {
  assert.strictEqual(O.pick({ ru: 42 }, 'Hello', 'ru'), 'Hello');
  assert.strictEqual(O.pick(['not', 'a', 'map'], 'Hello', 'ru'), 'Hello');
});

test('with no translation and no fallback text the result is null, not undefined', () => {
  assert.strictEqual(O.pick({}, null, 'ru'), null);
});

// ── DTOs ─────────────────────────────────────────────────────────────────────────────────
const flow = { id: 'f1', flow_key: 'quick', title: 'Quick setup', description: 'Fast',
               title_i18n: { ru: 'Быстро' }, description_i18n: {}, mode: 'quick_setup',
               audience: 'business_owner', is_active: true, sort_order: 10, metadata: {} };

test('a user-facing flow carries resolved text and NO raw i18n maps', () => {
  const d = O.toFlowDto(flow, 'ru');
  assert.strictEqual(d.title, 'Быстро');
  assert.strictEqual(d.description, 'Fast');      // untranslated -> English
  assert.strictEqual(d.locale, 'ru');
  assert.ok(!('title_i18n' in d), 'raw i18n leaked to a user route');
  assert.ok(!('description_i18n' in d));
});

test('admin may ask for the raw i18n maps', () => {
  const d = O.toFlowDto(flow, 'ru', { includeRaw: true });
  assert.deepStrictEqual(d.title_i18n, { ru: 'Быстро' });
});

test('step instructions have no English column, so an untranslated step has none', () => {
  const step = { id: 's1', step_key: 'x', title: 'T', description: 'D',
                 title_i18n: {}, description_i18n: {}, instructions_i18n: {},
                 action_type: 'read', product_area: 'general', required: false, skippable: true };
  assert.strictEqual(O.toStepDto(step, 'en').instructions, null);
  const withInstr = { ...step, instructions_i18n: { en: 'Do this', ru: 'Сделайте это' } };
  assert.strictEqual(O.toStepDto(withInstr, 'ru').instructions, 'Сделайте это');
  assert.strictEqual(O.toStepDto(withInstr, 'id').instructions, 'Do this');
});

// ── Progress arithmetic ──────────────────────────────────────────────────────────────────
const steps = [
  { id: 'a', required: true, sort_order: 10 },
  { id: 'b', required: false, sort_order: 20 },
  { id: 'c', required: false, sort_order: 30 },
  { id: 'd', required: false, sort_order: 40 },
];
const sp = (m) => Object.entries(m).map(([step_id, status]) => ({ step_id, status }));

test('an untouched flow is 0% and not complete', () => {
  const r = O.computeProgress(steps, []);
  assert.strictEqual(r.progress_percent, 0);
  assert.strictEqual(r.completed, false);
});

test('a SKIPPED step counts as resolved', () => {
  // Otherwise a flow with one optional step could never reach 100%.
  const r = O.computeProgress(steps, sp({ a: 'completed', b: 'skipped' }));
  assert.strictEqual(r.progress_percent, 50);
  assert.strictEqual(r.resolved, 2);
});

test('a merely VIEWED step is not resolved', () => {
  assert.strictEqual(O.computeProgress(steps, sp({ a: 'viewed', b: 'viewed' })).progress_percent, 0);
});

test('a flow completes only when required steps are DONE and nothing is outstanding', () => {
  // All four resolved, but the required one was skipped rather than completed.
  const skippedRequired = O.computeProgress(steps, sp({ a: 'skipped', b: 'skipped', c: 'skipped', d: 'skipped' }));
  assert.strictEqual(skippedRequired.progress_percent, 100);
  assert.strictEqual(skippedRequired.completed, false, 'a skipped REQUIRED step completed the flow');

  const proper = O.computeProgress(steps, sp({ a: 'completed', b: 'skipped', c: 'completed', d: 'skipped' }));
  assert.strictEqual(proper.completed, true);
});

test('percent is rounded to 2dp without float drift', () => {
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(O.computeProgress(three, sp({ a: 'completed' })).progress_percent, 33.33);
  assert.strictEqual(O.computeProgress(three, sp({ a: 'completed', b: 'completed' })).progress_percent, 66.67);
});

test('a flow with no steps is 0% and never claims completion', () => {
  const r = O.computeProgress([], []);
  assert.strictEqual(r.progress_percent, 0);
  assert.strictEqual(r.completed, false);
});

// ── Next step ────────────────────────────────────────────────────────────────────────────
test('the next step is the first unresolved one, in sort order', () => {
  assert.strictEqual(O.nextStepId(steps, []), 'a');
  assert.strictEqual(O.nextStepId(steps, sp({ a: 'completed' })), 'b');
  assert.strictEqual(O.nextStepId(steps, sp({ a: 'completed', b: 'skipped' })), 'c');
  assert.strictEqual(O.nextStepId(steps, sp({ a: 'viewed' })), 'a', 'viewed is not resolved');
});

test('a fully resolved flow has no next step', () => {
  assert.strictEqual(O.nextStepId(steps, sp({ a: 'completed', b: 'completed', c: 'skipped', d: 'skipped' })), null);
});

test('sort order is honoured even when the input is unordered', () => {
  const shuffled = [...steps].reverse();
  assert.strictEqual(O.nextStepId(shuffled, []), 'a');
});

// ── Transitions ──────────────────────────────────────────────────────────────────────────
test('viewing never undoes a completed or skipped step', () => {
  assert.strictEqual(O.canTransitionStep('completed', 'viewed'), false);
  assert.strictEqual(O.canTransitionStep('skipped', 'viewed'), false);
  assert.strictEqual(O.canTransitionStep('not_started', 'viewed'), true);
  assert.strictEqual(O.canTransitionStep('viewed', 'viewed'), true);
});

test('a user may change their mind between completed and skipped', () => {
  assert.strictEqual(O.canTransitionStep('skipped', 'completed'), true);
  assert.strictEqual(O.canTransitionStep('completed', 'skipped'), true);
});

test('an unknown target status is refused', () => {
  assert.strictEqual(O.canTransitionStep('not_started', 'finished'), false);
});
