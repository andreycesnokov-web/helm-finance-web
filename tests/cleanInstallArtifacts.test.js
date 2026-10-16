'use strict';
// Clean-install artifacts stay consistent: the baseline body IS the production schema snapshot used by the tests,
// the reference seed is current with the legacy migrations, and neither carries customer data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const lf = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('install/000 body equals the production schema snapshot (no drift between install and tests)', () => {
  const base = lf('install/000_baseline_public_schema.sql'), marker = '-- BASELINE-BODY-BELOW\n';
  assert.ok(base.includes(marker), 'baseline marker');
  assert.strictEqual(base.slice(base.indexOf(marker) + marker.length), lf('tests/fixtures/schema/prod_public_schema_2026-10-08.sql'));
});

test('install/000 is structure only: no rows, owners or privileges', () => {
  const base = lf('install/000_baseline_public_schema.sql');
  assert.ok(!/^(INSERT INTO|COPY )/m.test(base), 'top-level data statement in baseline (function bodies are indented)');
  assert.ok(!/OWNER TO|^GRANT |^REVOKE /m.test(base), 'owner or privilege statement in baseline');
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(base), 'email address in baseline');
});

test('install/001 reference seed is current with the legacy migrations and fully guarded', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/install/build-reference-seed.mjs'), '--check'], { stdio: 'pipe' });
  const seed = lf('install/001_reference_data.sql');
  for (const t of ['business_directions', 'activity_types', 'cashflow_categories']) assert.match(seed, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM public\\.${t} WHERE user_id IS NULL\\)`));
  for (const t of ['users', 'businesses', 'wallets', 'transactions', 'user_email_identities', 'platform_admins']) assert.ok(!new RegExp(`INSERT INTO (public\\.)?${t}\\b`).test(seed), 'customer table in seed: ' + t);
});
