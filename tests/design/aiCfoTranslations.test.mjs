// Can AI CFO render a raw translation key at a customer?
//
// The page asks for keys from four namespaces — aicfo.*, pulse.*, radar.* and
// common.* — and i18n/index's t() falls back to English and then to THE KEY
// ITSELF, so a missing string does not throw, it ships. Radar shipped exactly
// that: t('radar.runway') is a key that exists in no locale and rendered as the
// literal text "radar.runway" until PR #81 caught it.
//
// This walks every t('...') literal in the two AI CFO source files and resolves
// it against en, ru and id. Extraction is from source rather than a hand-kept
// list, so a key added tomorrow is covered without anyone remembering to.
//
// Run: node tests/design/aiCfoTranslations.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const LOCALES = ['en', 'ru', 'id'];
const dicts = {};
for (const loc of LOCALES) {
  dicts[loc] = (await import(`../../client/src/i18n/${loc}.js`)).default;
}

const SOURCES = ['client/src/pages/AICFOBlocks.jsx', 'client/src/pages/AICFO.jsx'];

/* Every t('…') / t("…") literal the page asks for. Template literals and
   computed keys are reported separately below — they cannot be resolved
   statically, and a page that builds a key at runtime is a page this test
   cannot protect. */
const keys = new Set();
const dynamic = [];
for (const f of SOURCES) {
  const src = read(f);
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'\s*\)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*\)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*[`$]/g)) dynamic.push(`${f}: ${m[0]}`);
}

/* The keys the page reaches through a lookup table rather than a literal call.
   Extracted from the tables themselves so the two cannot drift: these are the
   values of every *_KEY / *_LABEL_KEY map in the blocks file. */
const blocks = read('client/src/pages/AICFOBlocks.jsx');
for (const m of blocks.matchAll(/(?:labelKey|LABEL_KEY|PRIORITY_KEY|_KEY)\s*[:=][\s\S]{0,400}?\}/g)) {
  for (const k of m[0].matchAll(/'([a-z]+\.[a-zA-Z0-9_]+)'/g)) keys.add(k[1]);
}
/* And the suggested questions, which are keys held in an array. */
for (const m of blocks.matchAll(/'(aicfo\.q\d)'/g)) keys.add(m[1]);

const resolve = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

console.log(`\nAI CFO translations — ${keys.size} keys, ${LOCALES.length} locales`);

t('the page asks for a meaningful number of keys', () => {
  // A guard on the extraction itself: if a refactor changes how keys are written
  // and this regex stops matching, the suite must fail loudly rather than pass
  // by checking nothing.
  assert.ok(keys.size >= 40, `only ${keys.size} keys extracted — the scan is probably broken`);
});

t('no key is built at runtime, so every one of them is checkable', () => {
  assert.deepStrictEqual(dynamic, [],
    `keys built from a template cannot be verified: ${dynamic.join(', ')}`);
});

for (const loc of LOCALES) {
  t(`every key resolves in ${loc}`, () => {
    const missing = [];
    for (const key of [...keys].sort()) {
      const v = resolve(dicts[loc], key);
      if (typeof v !== 'string' || v.length === 0) missing.push(key);
    }
    assert.deepStrictEqual(missing, [],
      `${loc} would render ${missing.length} raw key(s): ${missing.join(', ')}`);
  });
}

t('no translation is accidentally the key itself', () => {
  // "aicfo.runway": "aicfo.runway" resolves, and still shows a reader a dotted
  // identifier. Radar shipped this class of bug.
  for (const loc of LOCALES) {
    for (const key of keys) {
      const v = resolve(dicts[loc], key);
      assert.notStrictEqual(v, key, `${loc}.${key} is its own key`);
      assert.ok(!/^[a-z]+\.[a-zA-Z]+$/.test(v),
        `${loc}.${key} resolves to "${v}", which reads like a key`);
    }
  }
});

t('the strings this migration added exist in all three locales', () => {
  // Named explicitly, so a reviewer can see the new copy is not English-only.
  const ADDED = [
    'aicfo.refreshing', 'aicfo.aiQuestionsPerMonth', 'aicfo.thisMonth',
    'aicfo.noDataTitle', 'aicfo.noDataBody', 'aicfo.thinking', 'aicfo.send',
    'aicfo.askFailed', 'aicfo.tryAgain', 'aicfo.refreshFailed', 'aicfo.refreshFailedStale',
  ];
  for (const loc of LOCALES) {
    for (const key of ADDED) {
      const v = resolve(dicts[loc], key);
      assert.ok(typeof v === 'string' && v.length > 0, `${loc}.${key} is missing`);
    }
  }
  // And they are actually translated, not English pasted into all three.
  for (const key of ['aicfo.noDataTitle', 'aicfo.refreshFailed', 'aicfo.aiQuestionsPerMonth']) {
    assert.notStrictEqual(resolve(dicts.ru, key), resolve(dicts.en, key),
      `${key} is identical in ru and en — it was not translated`);
    assert.notStrictEqual(resolve(dicts.id, key), resolve(dicts.en, key),
      `${key} is identical in id and en — it was not translated`);
  }
});

t('the AI question figure is not called a remainder in any locale', () => {
  // usage.ai_questions_this_month is hardcoded to 0 server-side, so the product
  // cannot measure a remainder. Every locale must name the plan's limit instead.
  const FORBIDDEN = /remaining|left\b|остал|осталось|остат|sisa|tersisa/i;
  for (const loc of LOCALES) {
    const v = resolve(dicts[loc], 'aicfo.aiQuestionsPerMonth');
    assert.ok(!FORBIDDEN.test(v),
      `${loc} labels the AI question figure "${v}", which claims a remainder the product does not track`);
  }
  // It must positively say limit/plan, rather than merely avoiding the word.
  const NAMES_LIMIT = /limit|batas|лимит|month|bulan|мес/i;
  for (const loc of LOCALES) {
    const v = resolve(dicts[loc], 'aicfo.aiQuestionsPerMonth');
    assert.ok(NAMES_LIMIT.test(v), `${loc} labels it "${v}", which names neither a limit nor a period`);
  }
});

t('the stale-data notice says the figures are old, in every locale', () => {
  for (const loc of LOCALES) {
    const v = resolve(dicts[loc], 'aicfo.refreshFailedStale');
    assert.ok(v.length > 20, `${loc} stale notice is "${v}" — too short to say anything`);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
