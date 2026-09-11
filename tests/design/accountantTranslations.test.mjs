// AI Accountant — every string the page shows exists in all three languages.
//
// The module shipped with its entire vocabulary hardcoded in English: five tab
// labels, two obligation states, every card title, every caveat. This suite is
// what stops that returning one string at a time — it reads the keys the page
// actually asks for and checks each against en, ru and id, rather than trusting
// that a block was added to all three files.
//
// It also guards the two things the translations must never say, in any
// language: that a complete profile means no tax risk, and that missing data
// means nothing is owed.
//
// Run: node tests/design/accountantTranslations.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../../client/src/i18n/en.js';
import ru from '../../client/src/i18n/ru.js';
import id from '../../client/src/i18n/id.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const LOCALES = [['en', en], ['ru', ru], ['id', id]];
const SOURCES = [
  'client/src/pages/business/AccountantBlocks.jsx',
  'client/src/pages/business/AccountantPremium.jsx',
];

/** Every accountantHub key the page asks for, however it asks. */
const usedKeys = () => {
  const used = new Set();
  for (const f of SOURCES) {
    const src = read(f);
    // t('accountantHub.x') — the ordinary call
    for (const m of src.matchAll(/t\(\s*'(accountantHub\.[A-Za-z0-9_]+)'/g)) used.add(m[1]);
    // A key passed as data and resolved later: labelKey on a chip, or the two
    // arms of plural(). A scan that only sees literal t() calls misses these,
    // and a missing one shows the reader a raw key.
    for (const m of src.matchAll(/'(accountantHub\.[A-Za-z0-9_]+)'/g)) used.add(m[1]);
  }
  return [...used];
};

const look = (dict, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

const KEYS = usedKeys();

console.log('\ncoverage');
t('the page asks for a substantial vocabulary, not a handful of strings', () => {
  assert.ok(KEYS.length > 100, `only ${KEYS.length} keys — is the page still hardcoded?`);
});

for (const [name, dict] of LOCALES) {
  t(`${name}: every key the page asks for resolves`, () => {
    const missing = KEYS.filter((k) => !look(dict, k));
    assert.deepStrictEqual(missing, [], `${name} is missing: ${missing.join(', ')}`);
  });
  t(`${name}: no value is left as the key, or empty`, () => {
    const bad = KEYS.filter((k) => {
      const v = look(dict, k);
      return typeof v !== 'string' || !v.trim() || v === k;
    });
    assert.deepStrictEqual(bad, [], `${name}: ${bad.join(', ')}`);
  });
}

t('the three locales declare exactly the same keys', () => {
  const keys = (d) => Object.keys(d.accountantHub).sort();
  assert.deepStrictEqual(keys(ru), keys(en), 'ru differs from en');
  assert.deepStrictEqual(keys(id), keys(en), 'id differs from en');
});

t('nothing in the block is left untranslated from English', () => {
  // A copied-through English string is the usual way a locale silently rots.
  // Proper nouns and statutory codes are the legitimate exceptions.
  const ALLOWED = new Set([
    'taxSplit', 'tabAudit', 'legendPpn', 'draftBaseCurrency', 'legendWithholding',
    'legendService', 'legendCit', 'withholdingTitle', 'eyebrow',
  ]);
  for (const [name, dict] of [['ru', ru], ['id', id]]) {
    const copied = Object.keys(en.accountantHub).filter((k) =>
      !ALLOWED.has(k) && dict.accountantHub[k] === en.accountantHub[k]);
    assert.deepStrictEqual(copied, [], `${name} still shows English for: ${copied.join(', ')}`);
  }
});

console.log('\nplaceholders survive translation');
t('every {placeholder} in en appears in ru and id too', () => {
  // A translator dropping {n} produces a sentence that silently omits its number.
  for (const k of Object.keys(en.accountantHub)) {
    const want = [...String(en.accountantHub[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    if (!want.length) continue;
    for (const [name, dict] of [['ru', ru], ['id', id]]) {
      const got = [...String(dict.accountantHub[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepStrictEqual(got, want, `${name}.${k}: placeholders ${got} vs ${want}`);
    }
  }
});
t('no placeholder is left unfilled by the page', () => {
  // Every key the page renders must either have its braces substituted or carry
  // none at all. Three substitutions are in use: fill(), a direct .replace(),
  // and plural(), which takes its two arms as arguments and replaces inside.
  const src = SOURCES.map(read).join('\n');
  const pluralArms = new Set(
    [...src.matchAll(/plural\([^)]*?'(accountantHub\.[A-Za-z0-9_]+)',\s*'(accountantHub\.[A-Za-z0-9_]+)'/g)]
      .flatMap((m) => [m[1], m[2]]));
  for (const k of KEYS) {
    const v = look(en, k);
    if (typeof v !== 'string' || !/\{\w+\}/.test(v)) continue;
    if (pluralArms.has(k)) continue;
    const short = k.split('.')[1];
    const substituted =
      new RegExp(`fill\\(t\\('accountantHub\\.${short}'\\)`).test(src)
      || new RegExp(`t\\('accountantHub\\.${short}'\\)[\\s\\S]{0,40}?\\.replace\\(`).test(src);
    assert.ok(substituted, `${k} carries a placeholder the page never substitutes`);
  }
});
console.log('\nwhat no language may say');
t('no locale turns a complete profile into a compliance verdict', () => {
  for (const [name, dict] of LOCALES) {
    const caveat = dict.accountantHub.completenessCaveat;
    assert.ok(caveat && caveat.length > 30, `${name}: the caveat is missing or trivial`);
  }
});
t('no locale turns missing data into "nothing is owed"', () => {
  for (const [name, dict] of LOCALES) {
    const hint = dict.accountantHub.stateInsufficientHint;
    assert.ok(hint && hint.length > 30, `${name}: no hint under insufficient data`);
    // The state label and its hint must be different strings: a label that is
    // its own explanation explains nothing.
    assert.notStrictEqual(hint, dict.accountantHub.stateInsufficient, name);
  }
});
t('every locale keeps "the engine calculates, it never estimates"', () => {
  for (const [name, dict] of LOCALES) {
    assert.ok((dict.accountantHub.obligationsNote || '').length > 30, `${name}: obligationsNote`);
    assert.ok((dict.accountantHub.draftAiEmphasis || '').length > 10, `${name}: draftAiEmphasis`);
  }
});
t('every locale labels the preview as a preview', () => {
  for (const [name, dict] of LOCALES) {
    assert.ok((dict.accountantHub.previewBadge || '').length > 8, `${name}: previewBadge`);
    assert.ok((dict.accountantHub.engineTitle || '').length > 15, `${name}: engineTitle`);
    assert.ok((dict.accountantHub.draftStatus || '').length > 15, `${name}: draftStatus`);
  }
});

console.log('\nthe page holds no English of its own');
t('no user-facing English literal survives in the components', () => {
  // Strings that reach a reader come from t(). What is left in the source is
  // markup, class names, statutory codes and date-format locales.
  const ALLOWED = /^(?:[\s\d.,:;·—–\-/()]*|IDR|PPN|CIT|Mon|Tue|Wed|Thu|Fri|Sat|Sun|en-GB|en-US|UU No\. 36 \/ 2008|PP No\. 94 \/ 2010|Income tax law|Implementation reg\.)$/;
  const offenders = [];
  for (const f of SOURCES) {
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // JSX text nodes. Two traps: the '>' must close a tag, so it may not be
    // preceded by '=' or every arrow function's body reads as page copy; and
    // \s* spans newlines, so the line after a self-closing tag was being read
    // as that tag's text. Horizontal whitespace only — a text node is one line.
    for (const m of src.matchAll(/[^=]>[^\S\n]*([A-Za-z][^<>{}\n]{3,})[^\S\n]*</g)) {
      const txt = m[1].trim();
      if (!ALLOWED.test(txt)) offenders.push(`${path.basename(f)}: ${txt}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `untranslated text:\n${offenders.join('\n')}`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
