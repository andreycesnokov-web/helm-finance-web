#!/usr/bin/env node
// CFO AI V2 — CLEAN installation of an EMPTY Supabase project (Business + Platform/admin schema, no customer data).
//
//   node scripts/install-v2.mjs --plan            state of the target, changes nothing (default)
//   node scripts/install-v2.mjs --install         empty → baseline 000 + reference data 001 + V2 chain + bucket + checks;
//                                                 on an already installed database: verifies and re-runs idempotently
//   node scripts/install-v2.mjs --verify-empty    pre-launch gate: fails when any customer or test data exists
//   options: --skip-storage (no Storage API, e.g. CI)  ·  env: DATABASE_URL (postgres role), SUPABASE_URL,
//            SUPABASE_SECRET_KEY (bucket), DOCUMENTS_BUCKET (default financial-documents)
//
// Fail-closed: a database that has tables but was not installed by this script is refused (existing databases use
// scripts/migrate-v2.mjs). A changed baseline/seed file after installation stops the run. The baseline and the seed
// are recorded in public.cfo_migration_ledger next to the V2 chain. Never copies data from another database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, sha } from './migrate-v2.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'install/000_baseline_public_schema.sql';
export const SEED = 'install/001_reference_data.sql';
export const SEED_TABLES = ['business_directions', 'activity_types', 'cashflow_categories', 'plan_limits', 'official_sources', 'tax_rules',
  'onboarding_flows', 'onboarding_steps', 'industry_templates'];
// Tables that must be empty on a fresh installation (customer, identity, admin, billing-state and audit data).
export const CUSTOMER_TABLES = ['users', 'user_email_identities', 'user_profiles', 'auth_user_links', 'auth_app_sessions', 'email_login_codes',
  'platform_admins', 'businesses', 'business_members', 'business_invites', 'wallets', 'transactions', 'debts', 'debt_payment_idempotency',
  'financial_write_requests', 'bank_import_batches', 'bank_import_rows', 'financial_documents', 'document_files', 'document_audit',
  'billing_accounts', 'billing_commands', 'billing_events', 'billing_grants', 'billing_overrides', 'billing_quota_reservations',
  'billing_service_periods', 'audit_events', 'access_audit'];
const TEST_MARK = "(test|demo|example|rehearsal|sample|fixture|invalid|localhost)";

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS public.cfo_migration_ledger (file text PRIMARY KEY, sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), mode text NOT NULL CHECK (mode IN ('applied','adopted')));
  ALTER TABLE public.cfo_migration_ledger ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cfo_migration_ledger FROM PUBLIC;`;

async function inspect(c) {
  const tables = Number((await c.query("SELECT count(*) n FROM pg_tables WHERE schemaname='public'")).rows[0].n);
  const hasLedger = !!(await c.query("SELECT to_regclass('public.cfo_migration_ledger') r")).rows[0].r;
  const ledger = new Map(hasLedger ? (await c.query('SELECT file, sha256 FROM public.cfo_migration_ledger')).rows.map((r) => [r.file, r.sha256]) : []);
  const state = tables === 0 ? 'EMPTY' : ledger.has(BASELINE) ? 'INSTALLED' : 'FOREIGN';
  return { tables, ledger, state };
}

async function seedCounts(c) {
  const out = {};
  for (const t of SEED_TABLES) out[t] = Number((await c.query(`SELECT count(*) n FROM public.${t}`)).rows[0].n);
  return out;
}

// Customer / test data detector. Returns a list of findings (empty = clean).
export async function dataFindings(c, { bucket } = {}) {
  const findings = [];
  for (const t of CUSTOMER_TABLES) {
    if (!(await c.query('SELECT to_regclass($1) r', ['public.' + t])).rows[0].r) continue;
    const n = Number((await c.query(`SELECT count(*) n FROM public.${t}`)).rows[0].n);
    if (n) findings.push(`${t}: ${n} row(s)`);
  }
  if ((await c.query("SELECT to_regclass('auth.users') r")).rows[0].r) {
    const n = Number((await c.query('SELECT count(*) n FROM auth.users')).rows[0].n); if (n) findings.push(`auth.users: ${n} row(s)`);
  }
  if ((await c.query("SELECT to_regclass('storage.objects') r")).rows[0].r) {
    const n = Number((await c.query('SELECT count(*) n FROM storage.objects')).rows[0].n); if (n) findings.push(`storage.objects: ${n} row(s)`);
    const bs = (await c.query('SELECT id, public FROM storage.buckets')).rows;
    for (const b of bs) if (b.public) findings.push(`storage bucket ${b.id} is PUBLIC`);
    if (bucket && !bs.some((b) => b.id === bucket)) findings.push(`storage bucket ${bucket} missing`);
  }
  if ((await c.query("SELECT to_regclass('public.plan_versions') r")).rows[0].r) {
    const fx = Number((await c.query("SELECT count(*) n FROM public.plan_versions WHERE approval_status='staging_fixture' OR fixture_label IS NOT NULL")).rows[0].n);
    if (fx) findings.push(`plan_versions: ${fx} staging fixture version(s)`);
    const tv = Number((await c.query(`SELECT count(*) n FROM public.plan_versions WHERE terms_version ~* '${TEST_MARK}'`)).rows[0].n);
    if (tv) findings.push(`plan_versions: ${tv} version(s) with test terms_version`);
  }
  return findings;
}

async function ensureBucket({ url, key, bucket }) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const got = await sb.storage.getBucket(bucket);
  if (got.data) {
    if (got.data.public !== false) throw new Error(`bucket ${bucket} exists and is PUBLIC — refusing (make it private first)`);
    return 'exists (private)';
  }
  const made = await sb.storage.createBucket(bucket, { public: false });
  if (made.error) throw new Error('bucket create failed: ' + made.error.message);
  const check = await sb.storage.getBucket(bucket);
  if (!check.data || check.data.public !== false) throw new Error('bucket not private after create');
  return 'created (private)';
}

export async function install({ connectionString, mode = 'plan', skipStorage = false, storage = {}, root = ROOT, log = console.log } = {}) {
  const report = { mode, ok: false, steps: [] };
  const step = (name, detail) => { report.steps.push({ name, ...detail }); log(`${detail.ok === false ? 'FAIL' : 'OK  '} ${name}${detail.note ? ' — ' + detail.note : ''}`); };
  const files = { [BASELINE]: fs.readFileSync(path.join(root, BASELINE), 'utf8'), [SEED]: fs.readFileSync(path.join(root, SEED), 'utf8') };
  const c = new pg.Client({ connectionString }); await c.connect();
  try {
    const st = await inspect(c); report.state = st.state;
    step('target state', { ok: st.state !== 'FOREIGN', note: `${st.state} (${st.tables} public tables)` });
    if (st.state === 'FOREIGN') { report.reason = 'not an empty database and not installed by install-v2: use scripts/migrate-v2.mjs'; return report; }
    for (const f of [BASELINE, SEED]) if (st.ledger.has(f) && st.ledger.get(f) !== sha(files[f])) {
      step(`${f} unchanged since installation`, { ok: false, note: 'CHANGED' }); report.reason = `${f} changed after installation`; return report;
    }
    if (mode === 'verify-empty') {
      const bucket = skipStorage ? null : (storage.bucket || 'financial-documents');
      const found = await dataFindings(c, { bucket });
      step('no customer or test data', { ok: found.length === 0, note: found.length ? found.join('; ') : 'clean' });
      report.findings = found; report.ok = found.length === 0; return report;
    }
    if (mode === 'plan') { report.ok = true; return report; }

    // 1. Baseline (only on an empty database), recorded in the same transaction.
    if (st.state === 'EMPTY') {
      const t0 = Date.now();
      await c.query('BEGIN');
      try {
        await c.query(files[BASELINE]);
        await c.query('SET search_path = "$user", public');
        await c.query(LEDGER_DDL);
        await c.query('INSERT INTO public.cfo_migration_ledger(file, sha256, mode) VALUES($1,$2,$3)', [BASELINE, sha(files[BASELINE]), 'applied']);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      step('baseline 000 applied', { note: `${(await inspect(c)).tables} tables, ${Date.now() - t0} ms` });
    } else step('baseline 000', { note: 'already installed, unchanged' });

    // 2. Reference data (idempotent; a re-run must add nothing).
    const before = await seedCounts(c);
    await c.query(files[SEED]);
    const after = await seedCounts(c);
    const added = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - before[k]]));
    const total = Object.values(added).reduce((a, b) => a + b, 0);
    await c.query(LEDGER_DDL);
    await c.query('INSERT INTO public.cfo_migration_ledger(file, sha256, mode) VALUES($1,$2,$3) ON CONFLICT (file) DO NOTHING', [SEED, sha(files[SEED]), 'applied']);
    if (st.ledger.has(SEED) && total !== 0) { step('reference data 001 re-run adds nothing', { ok: false, note: JSON.stringify(added) }); report.reason = 'seed not idempotent'; return report; }
    step(st.state === 'EMPTY' ? 'reference data 001 applied' : 'reference data 001 re-run (idempotent)', { note: st.state === 'EMPTY' ? `${total} rows` : '0 rows added', rows: after });
  } finally { await c.end(); }

  // 3. V2 chain + postflight (the guarded runner; idempotent).
  const m = await migrate({ connectionString, mode: 'apply', root, log: () => {} });
  step('V2 migration chain', { ok: !m.stoppedAt, note: m.stoppedAt ? `stopped at ${m.stoppedAt.file} (${m.stoppedAt.reason})` : `${m.applied.length} applied, ${m.entries.length - m.applied.length} already applied` });
  if (m.stoppedAt) { report.reason = 'migration stopped'; return report; }
  const failed = m.postflight.filter((p) => !p.ok);
  step('postflight invariants', { ok: failed.length === 0, note: `${m.postflight.length - failed.length}/${m.postflight.length}` + (failed.length ? ' failed: ' + failed.map((p) => p.name).join('; ') : '') });
  if (failed.length) { report.reason = 'postflight failed'; return report; }

  // 4. Private document bucket (Storage API; the app never creates it).
  const bucket = storage.bucket || process.env.DOCUMENTS_BUCKET || 'financial-documents';
  if (skipStorage) step('document bucket', { note: 'skipped (--skip-storage)' });
  else {
    const url = storage.url || process.env.SUPABASE_URL, key = storage.key || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) { step('document bucket', { ok: false, note: 'SUPABASE_URL and SUPABASE_SECRET_KEY are required (or --skip-storage)' }); report.reason = 'storage config missing'; return report; }
    step(`document bucket ${bucket}`, { note: await ensureBucket({ url, key, bucket }) });
  }

  // 5. Fresh installation must carry no customer or test data.
  if (report.state === 'EMPTY') {
    const c2 = new pg.Client({ connectionString }); await c2.connect();
    try {
      const found = await dataFindings(c2, { bucket: skipStorage ? null : bucket });
      step('no customer or test data', { ok: found.length === 0, note: found.length ? found.join('; ') : 'clean' });
      if (found.length) { report.reason = 'data present after install'; return report; }
    } finally { await c2.end(); }
  }
  report.ok = true;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const mode = args.includes('--install') ? 'install' : args.includes('--verify-empty') ? 'verify-empty' : 'plan';
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
  install({ connectionString: process.env.DATABASE_URL, mode, skipStorage: args.includes('--skip-storage') })
    .then((r) => { if (!r.ok) console.error(`\nNOT OK — ${r.reason || 'see above'}. Do not open sign-up.`); else console.log(`\n${mode.toUpperCase()} OK (${r.state})`); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error('installer failed:', e.message); process.exit(1); });
}
