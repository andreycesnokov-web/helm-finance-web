// PKP status: one canonical meaning across two UI vocabularies.
//
// The legacy Tax Profile page stored `pkp` for a registered company; backend rules only
// recognised `pkp_registered`. A registered company that used the legacy page therefore got
// its PKP certificate marked OPTIONAL instead of required, and profileCompleteness() demanded
// `vat_status` from every profile — including Non-PKP ones, where it does not apply — so the
// completeness percentage and the verify gate stayed stuck.
//
// No migration: stored values are normalised on READ, never rewritten.
//
//   Run: node --test tests/integration/pkpStatus.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pkp = require('../../server/lib/pkpStatus');
const di = require('../../server/lib/documentIntake');

const CLIENT_MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'accountantReadiness.js')).href;
let client;
test.before(async () => { client = await import(CLIENT_MOD); });

// ── normalisation ───────────────────────────────────────────────────────────
test('normalizePkpStatus maps every known registered spelling', () => {
  for (const v of ['pkp_registered', 'pkp', 'PKP', ' Pkp ', 'registered', 'is_pkp', 'yes', 'true'])
    assert.strictEqual(pkp.normalizePkpStatus(v), 'pkp_registered', JSON.stringify(v));
});

test('normalizePkpStatus maps every known not-registered spelling', () => {
  for (const v of ['non_pkp', 'non-pkp', 'NON_PKP', 'nonpkp', 'not_pkp', 'not_registered', 'no', 'false'])
    assert.strictEqual(pkp.normalizePkpStatus(v), 'non_pkp', JSON.stringify(v));
});

test('unset, unknown and unrecognised values are "unknown", never "non_pkp"', () => {
  for (const v of ['unknown', '', '   ', null, undefined, 'maybe', 'tbd', 0, {}])
    assert.strictEqual(pkp.normalizePkpStatus(v), 'unknown', JSON.stringify(v));
});

test('the client mirror agrees with the server on every value', () => {
  for (const v of ['pkp_registered', 'pkp', 'registered', 'non_pkp', 'non-pkp', 'not_registered',
                   'unknown', '', null, undefined, 'maybe'])
    assert.strictEqual(client.normalizePkpStatus(v), pkp.normalizePkpStatus(v),
      `client and server disagree on ${JSON.stringify(v)}`);
});

test('the legacy value displays as the canonical registered option', () => {
  assert.strictEqual(client.pkpSelectValue('pkp'), 'pkp_registered');
  assert.strictEqual(client.pkpSelectValue('pkp_registered'), 'pkp_registered');
  assert.strictEqual(client.pkpSelectValue('non_pkp'), 'non_pkp');
  assert.strictEqual(client.pkpSelectValue(''), '', 'unset stays the empty option');
  assert.strictEqual(client.pkpSelectValue('weird'), '');
});

// ── required documents ──────────────────────────────────────────────────────
const pkpRow = (pkp_status) =>
  di.requirementsFor({ country: 'Indonesia', legal_entity_type: 'PT PMA', pkp_status })
    .find(i => i.type === 'pkp_certificate');

test('a legacy "pkp" profile requires the PKP certificate, exactly like "pkp_registered"', () => {
  const legacy = pkpRow('pkp');
  const canonical = pkpRow('pkp_registered');
  assert.strictEqual(legacy.requirement, 'required', 'the legacy value must not downgrade to optional');
  assert.deepStrictEqual(legacy, canonical, 'both spellings must produce an identical row');
});

test('Non-PKP still not_required; unknown/unset still optional', () => {
  assert.strictEqual(pkpRow('non_pkp').requirement, 'not_required');
  for (const v of ['unknown', '', undefined, null, 'maybe'])
    assert.strictEqual(pkpRow(v).requirement, 'optional', `pkp_status=${v}`);
});

test('the legacy value survives into the rendered checklist', () => {
  const cl = di.buildChecklist({ country: 'Indonesia', legal_entity_type: 'PT PMA', pkp_status: 'pkp' }, []);
  const row = cl.items.find(i => i.type === 'pkp_certificate');
  assert.strictEqual(row.requirement, 'required');
  assert.strictEqual(row.status, 'missing', 'required and absent ⇒ missing');
});

// ── profile completeness ────────────────────────────────────────────────────
const REQUIRED = ['country', 'jurisdiction', 'legal_entity_type', 'tax_regime',
  'financial_year_start', 'financial_year_end', 'vat_status'];
const full = (over = {}) => ({
  country: 'Indonesia', jurisdiction: 'ID', legal_entity_type: 'PT PMA', tax_regime: 'standard',
  financial_year_start: '01-01', financial_year_end: '31-12', vat_status: 'pkp', ...over,
});

test('applicableProfileFields drops PKP-only fields for a Non-PKP company only', () => {
  assert.ok(!pkp.applicableProfileFields(REQUIRED, 'non_pkp').includes('vat_status'));
  for (const v of ['pkp_registered', 'pkp', 'unknown', '', undefined])
    assert.ok(pkp.applicableProfileFields(REQUIRED, v).includes('vat_status'), `pkp_status=${v}`);
});

test('Non-PKP: a profile missing only vat_status is complete', () => {
  const p = full({ pkp_status: 'non_pkp', vat_status: null });
  const c = pkp.applicableProfileFields(REQUIRED, p.pkp_status);
  const missing = c.filter(f => !p[f]);
  assert.deepStrictEqual(missing, [], 'vat_status must not be demanded');
  assert.strictEqual(Math.round((c.length - missing.length) / c.length * 100), 100);
});

test('Non-PKP: an unrelated missing field still makes the profile incomplete', () => {
  const p = full({ pkp_status: 'non_pkp', vat_status: null, tax_regime: null });
  const c = pkp.applicableProfileFields(REQUIRED, p.pkp_status);
  const missing = c.filter(f => !p[f]);
  assert.deepStrictEqual(missing, ['tax_regime']);
  assert.ok(Math.round((c.length - missing.length) / c.length * 100) < 100);
});

test('PKP registered and legacy "pkp": a missing vat_status still blocks completeness', () => {
  for (const pkp_status of ['pkp_registered', 'pkp']) {
    const p = full({ pkp_status, vat_status: null });
    const c = pkp.applicableProfileFields(REQUIRED, p.pkp_status);
    assert.deepStrictEqual(c.filter(f => !p[f]), ['vat_status'], `pkp_status=${pkp_status}`);
  }
});

test('unknown/unset PKP is NOT treated as Non-PKP for completeness', () => {
  for (const pkp_status of ['unknown', '', undefined, 'maybe']) {
    const p = full({ pkp_status, vat_status: null });
    const c = pkp.applicableProfileFields(REQUIRED, p.pkp_status);
    assert.deepStrictEqual(c.filter(f => !p[f]), ['vat_status'], `pkp_status=${pkp_status}`);
  }
});

test('pkp_effective_date is never demanded from a Non-PKP company', () => {
  const withDate = [...REQUIRED, 'pkp_effective_date'];
  assert.ok(!pkp.applicableProfileFields(withDate, 'non_pkp').includes('pkp_effective_date'));
  assert.ok(pkp.applicableProfileFields(withDate, 'pkp').includes('pkp_effective_date'));
});

// ── the two layers agree ────────────────────────────────────────────────────
test('server completeness and the client filter suppress the same fields', () => {
  const form = { pkp_status: 'non_pkp' };
  const serverKept = pkp.applicableProfileFields(REQUIRED, form.pkp_status);
  const clientKept = client.applicableMissingFields(form, REQUIRED);
  assert.deepStrictEqual(clientKept, serverKept,
    'the frontend filter and the backend requirement list must drop the same fields');
});

test('a legacy "pkp" profile is treated as registered by BOTH layers', () => {
  assert.strictEqual(client.pkpStatusOf({ pkp_status: 'pkp' }), 'pkp_registered');
  assert.strictEqual(pkp.normalizePkpStatus('pkp'), 'pkp_registered');
  // …so the client never suppresses vat_status for it.
  assert.deepStrictEqual(client.applicableMissingFields({ pkp_status: 'pkp' }, ['vat_status']), ['vat_status']);
});

// ── source guards: the wiring itself ────────────────────────────────────────
const fs = require('node:fs');
const SERVER = path.join(__dirname, '..', '..', 'server', 'index.js');
const TAX_PROFILE = path.join(__dirname, '..', '..', 'client', 'src', 'pages', 'TaxProfile.jsx');

test('profileCompleteness derives its field list from applicableProfileFields', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const fn = src.slice(src.indexOf('function profileCompleteness'),
    src.indexOf('\n}', src.indexOf('function profileCompleteness')));
  assert.match(fn, /applicableProfileFields\(/, 'completeness must be PKP-aware');
  assert.ok(!/REQUIRED_PROFILE_FIELDS\.filter/.test(fn),
    'the raw required-field list must not be filtered directly');
  assert.match(src, /require\('\.\/lib\/pkpStatus'\)/, 'the helper must be imported');
});

test('the legacy Tax Profile saves the canonical value, not "pkp"', () => {
  const src = fs.readFileSync(TAX_PROFILE, 'utf8');
  const line = src.split('\n').find(l => l.includes('pkp_status: ['));
  assert.ok(line, 'the pkp_status option list must exist');
  assert.match(line, /'pkp_registered'/, 'new saves must write the canonical value');
  assert.ok(!/'pkp'\s*,/.test(line), `the legacy value must not be offered for new saves: ${line.trim()}`);
  // …and a stored legacy value must still render as an option.
  assert.match(src, /pkpSelectValue\(/, 'a stored legacy value must be normalised for display');
});

test('documentIntake normalises rather than string-comparing pkp_status', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'lib', 'documentIntake.js'), 'utf8');
  assert.match(src, /normalizePkpStatus\(p\.pkp_status\)/);
  assert.ok(!/pkp_status\s*\|\|\s*''\)\.toLowerCase\(\)/.test(src),
    'raw lowercasing would miss the legacy spelling');
});
