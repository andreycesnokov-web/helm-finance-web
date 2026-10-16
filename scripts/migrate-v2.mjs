#!/usr/bin/env node
// CFO AI V2.0 — guarded migration runner (Platform/admin operations). Replaces hand-run `psql -f` chains.
//
//   node scripts/migrate-v2.mjs --plan                  status of every manifest entry, changes nothing (default)
//   node scripts/migrate-v2.mjs --apply                 apply PENDING entries in order, stop at the first error
//   node scripts/migrate-v2.mjs --check                 postflight invariants only
//   node scripts/migrate-v2.mjs --apply --adopt=<file>  record an entry as applied without running it (explicit)
//
// Safety rules (V2_CROSS_REVIEW R-01/R-02):
// - State is decided per entry from the ledger (public.cfo_migration_ledger, file + sha256) and, when the ledger
//   has no row, from SEVERAL independent probes of the real schema (objects + definitions). All probes true →
//   APPLIED (recorded as 'adopted'); none → PENDING; mixed → UNKNOWN, which stops the run unless --adopt names it.
// - An entry is never applied twice: re-running already applied files silently downgraded money-moving RPCs.
// - Each file runs in its own transaction (the files carry BEGIN/COMMIT); the first error stops everything
//   (ON_ERROR_STOP equivalent). Nothing after a failed or UNKNOWN entry runs.
// - Postflight checks the financial invariants by definition (idempotency enforcement, writer gates) and the
//   platform admin / billing invariants. A failed postflight means: do not open traffic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fn = (name) => `EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='${name}')`;
const table = (name) => `to_regclass('public.${name}') IS NOT NULL`;
const column = (t, c) => `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}')`;
const trigger = (name) => `EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname='${name}')`;
const index = (name) => `to_regclass('public.${name}') IS NOT NULL`;
const constraint = (name) => `EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='${name}')`;
const defHas = (name, text) => `EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='${name}' AND pg_get_functiondef(oid) LIKE '%${text}%')`;
const fkRestrict = (t) => `EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
  WHERE c.conrelid='public.${t}'::regclass AND c.contype='f' AND a.attname='user_id' AND c.confdeltype='r')`;
// Evaluated lazily: the version table may not exist yet (a plain subquery would fail at parse time).
const billingVersion = (v) => `CASE WHEN to_regclass('public.billing_schema_versions') IS NULL THEN false
  ELSE query_to_xml('SELECT 1 FROM public.billing_schema_versions WHERE version=''${v}''', false, false, '')::text LIKE '%<row>%' END`;

// Order = dependency order. Probes must ALL be true for "applied" and ALL false for "pending".
export const MANIFEST = [
  { file: 'migrations/069_bank_import_atomic_confirm.sql', probes: [fn('rpc_confirm_bank_import')] },
  { file: 'migrations/070_atomic_business_balance.sql', probes: [column('transactions', 'balance_version'), fn('fn_business_balance_guard'), fn('fn_ledger_writer_lock')] },
  { file: 'migrations/071_financial_records_restrict_user_delete.sql', probes: [fkRestrict('transactions'), fkRestrict('debts')] },
  { file: 'migrations/20261010143341_import_balance_compat.sql', probes: [fn('fn_import_provenance_guard'), trigger('bank_import_provenance_guard'), index('transactions_bank_import_row_unique')] },
  { file: 'migrations/20261011001823_financial_writer_protocol.sql', probes: [table('financial_write_requests'), trigger('financial_writer_gate'), defHas('rpc_record_debt_payment_guarded', 'idempotency_key_required')] },
  { file: 'migrations/20261011222631_intercompany_balances_security_invoker.sql',
    probes: [`EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.intercompany_balances') AND 'security_invoker=true'=ANY(coalesce(reloptions,'{}')))`] },
  { file: 'migrations/20261012032717_durable_financial_recovery.sql', probes: [fn('rpc_execute_wallet_transfer_recovery'), constraint('debt_payment_idempotency_actor_key_unique'), index('financial_write_requests_recovery_recent')] },
  { file: 'migrations/20261012110000_durable_company_creation.sql', probes: [table('business_creation_requests'), fn('rpc_create_business_once')] },
  { file: 'migrations/20261012123000_atomic_team_membership.sql', probes: [fn('cfo_team_role_rank'), fn('rpc_accept_business_invite')] },
  { file: 'migrations/20261013001000_atomic_business_profile.sql', probes: [fn('cfo_profile_missing'), fn('cfo_profile_same')] },
  { file: 'migrations/20261013031755_historical_bank_import_review_receipts.sql', probes: [table('bank_import_confirm_requests'), fn('rpc_read_bank_import_confirm')] },
  { file: 'migrations/20261013062733_private_import_receipt_immutability.sql', probes: [fn('cfo_import_receipt_immutable'), trigger('bank_import_confirm_requests_immutable')] },
  { file: 'migrations/20261013114500_atomic_bill_creation.sql', probes: [table('bill_creation_requests'), fn('rpc_create_business_bill'), column('debts', 'bill_version')] },
  { file: 'migrations/20261014040810_operation_document_control.sql', probes: [fn('fn_operation_documents_version'), fn('rpc_operation_documents_snapshot')] },
  { file: 'migrations/20261016090000_dated_opening_anchor.sql', probes: [fn('cfo_business_tz'), fn('rpc_reanchor_wallet_opening'), defHas('cfo_import_review_state', 'reanchor')] },
  { file: 'migrations/072_platform_admins.sql', probes: [table('platform_admins'), `to_regprocedure('public.fn_bootstrap_platform_super_admin(bigint)') IS NOT NULL`] },
  { file: 'migrations/073_platform_admins_security.sql', probes: [fn('rpc_platform_admin_grant'), defHas('fn_platform_admins_guard', 'cfo_platform_admins_last_super')] },
  { file: 'supabase/migrations/20261015033808_cfo_commercial_trial.sql', probes: [billingVersion('20261015033808'), table('billing_accounts')] },
  { file: 'supabase/migrations/20261017090000_billing_management_center.sql', probes: [billingVersion('20261017090000'), table('billing_overrides')] },
  { file: 'supabase/migrations/20261017120000_billing_enforcement.sql', probes: [billingVersion('20261017120000'), fn('billing_usage')] },
];

// Invariants that must hold after the run (by definition, not by table presence).
export const POSTFLIGHT = [
  ['debt payments require a stable idempotency key', defHas('rpc_record_debt_payment_guarded', 'idempotency_key_required')],
  ['wallet transfers require a stable transfer id', defHas('rpc_execute_wallet_transfer_guarded', 'idempotency_key_required')],
  ['ledger writer gate on transactions', trigger('ledger_writer_gate')],
  ['financial writer gate on wallets', trigger('financial_writer_gate')],
  ['import provenance guard', trigger('bank_import_provenance_guard')],
  ['D4 review state is the re-anchor version', defHas('cfo_import_review_state', 'reanchor')],
  ['platform admin guard serializes and returns OLD on delete', `(${defHas('fn_platform_admins_guard', 'cfo_platform_admins_last_super')} AND ${defHas('fn_platform_admins_guard', 'RETURN OLD')})`],
  ['exactly one bootstrap function, not SECURITY DEFINER', `(SELECT count(*)=1 AND bool_and(NOT prosecdef) FROM pg_proc WHERE proname='fn_bootstrap_platform_super_admin')`],
  ['no orphaned platform admin rows', `NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=pa.user_id))`],
  ['admin and notification-grant functions not executable by anon/authenticated',
    `NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated']) r(role) WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('fn_bootstrap_platform_super_admin','rpc_platform_admin_grant','rpc_platform_admin_revoke','apply_notification_grants')
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.role) AND has_function_privilege(r.role, p.oid, 'EXECUTE'))`],
  ['billing schema versions complete', `(SELECT count(*)=3 FROM public.billing_schema_versions WHERE version IN ('20261015033808','20261017090000','20261017120000'))`],
];

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

export async function migrate({ connectionString, mode = 'plan', adopt = [], root = ROOT, log = console.log } = {}) {
  const c = new pg.Client({ connectionString });
  await c.connect();
  const report = { mode, entries: [], applied: [], adopted: [], stoppedAt: null, postflight: [] };
  try {
    await c.query("SET search_path = \"$user\", public");   // the default Supabase path (unqualified names in 20261015033808)
    if (mode !== 'plan' && mode !== 'check') {
      await c.query(`CREATE TABLE IF NOT EXISTS public.cfo_migration_ledger (file text PRIMARY KEY, sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(), mode text NOT NULL CHECK (mode IN ('applied','adopted')))`);
      await c.query('ALTER TABLE public.cfo_migration_ledger ENABLE ROW LEVEL SECURITY');
      await c.query('REVOKE ALL ON public.cfo_migration_ledger FROM PUBLIC');
    }
    const ledger = new Map();
    if ((await c.query("SELECT to_regclass('public.cfo_migration_ledger') r")).rows[0].r)
      for (const r of (await c.query('SELECT file, sha256 FROM public.cfo_migration_ledger')).rows) ledger.set(r.file, r.sha256);
    if (mode !== 'check') for (const entry of MANIFEST) {
      const text = fs.readFileSync(path.join(root, entry.file), 'utf8'), sum = sha(text);
      let state;
      if (ledger.has(entry.file)) state = ledger.get(entry.file) === sum ? 'APPLIED' : 'CHANGED';
      else {
        const results = [];
        for (const p of entry.probes) results.push((await c.query(`SELECT (${p}) AS ok`)).rows[0].ok === true);
        state = results.every(Boolean) ? 'APPLIED_UNRECORDED' : results.some(Boolean) ? 'UNKNOWN' : 'PENDING';
      }
      if (state === 'UNKNOWN' && adopt.includes(entry.file)) state = 'ADOPT';
      report.entries.push({ file: entry.file, state });
      log(`${state.padEnd(18)} ${entry.file}`);
      if (mode === 'plan') continue;
      if (state === 'CHANGED' || state === 'UNKNOWN') { report.stoppedAt = { file: entry.file, reason: state }; break; }
      if (state === 'APPLIED_UNRECORDED' || state === 'ADOPT') {
        await c.query('INSERT INTO public.cfo_migration_ledger(file, sha256, mode) VALUES($1,$2,$3)', [entry.file, sum, 'adopted']);
        report.adopted.push(entry.file); continue;
      }
      if (state === 'PENDING') {
        try { await c.query(text); }
        catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          report.stoppedAt = { file: entry.file, reason: 'ERROR', message: e.message };
          log(`STOPPED at ${entry.file}: ${e.message}`);
          break;
        }
        await c.query('INSERT INTO public.cfo_migration_ledger(file, sha256, mode) VALUES($1,$2,$3)', [entry.file, sum, 'applied']);
        report.applied.push(entry.file);
      }
    }
    if (mode !== 'plan' && !report.stoppedAt) {
      for (const [name, probe] of POSTFLIGHT) {
        let ok = false; try { ok = (await c.query(`SELECT (${probe}) AS ok`)).rows[0].ok === true } catch { ok = false }
        report.postflight.push({ name, ok }); log(`${ok ? 'OK  ' : 'FAIL'} postflight: ${name}`);
      }
    }
  } finally { await c.end(); }
  report.ok = !report.stoppedAt && (mode === 'plan' || report.postflight.every((x) => x.ok));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'plan';
  const adopt = args.filter((a) => a.startsWith('--adopt=')).map((a) => a.slice(8));
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
  migrate({ connectionString: process.env.DATABASE_URL, mode, adopt })
    .then((r) => { if (r.stoppedAt) console.error(`\nSTOPPED: ${r.stoppedAt.file} (${r.stoppedAt.reason}). Nothing after it ran.`);
      if (!r.ok) console.error('\nNOT OK — do not open traffic.'); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error('runner failed:', e.message); process.exit(1); });
}
