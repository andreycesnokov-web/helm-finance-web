#!/usr/bin/env node
// Rebuilds install/001_reference_data.sql from the reference-data INSERTs of the legacy migrations.
// Only the top-level INSERT statements are taken, verbatim (their DDL is NOT replayed: it would overwrite newer
// function bodies). Every statement is guarded (ON CONFLICT / WHERE NOT EXISTS) so the seed is idempotent; the
// build refuses a statement without a guard. Usage: node scripts/install/build-reference-seed.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'install', '001_reference_data.sql');
const SOURCES = ['002_reference_foundation.sql', '005_saas_foundation.sql', '020_ai_accountant_foundation.sql',
  '054_onboarding_foundation.sql', '062_pnl_groups_industry_templates.sql'];

// Top-level statements; respects quotes, dollar quotes and comments.
export function statements(sql) {
  const out = []; let cur = '', i = 0, dollar = null;
  while (i < sql.length) {
    const rest = sql.slice(i), ch = sql[i];
    if (dollar) { if (rest.startsWith(dollar)) { cur += dollar; i += dollar.length; dollar = null; } else { cur += ch; i++; } continue; }
    if (rest.startsWith('--')) { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (rest.startsWith('/*')) { const e = sql.indexOf('*/', i); i = e < 0 ? sql.length : e + 2; continue; }
    const m = /^\$[A-Za-z0-9_]*\$/.exec(rest); if (m) { dollar = m[0]; cur += dollar; i += dollar.length; continue; }
    if (ch === "'") { let k = i + 1; while (k < sql.length) { if (sql[k] === "'" && sql[k + 1] === "'") k += 2; else if (sql[k] === "'") break; else k++; } cur += sql.slice(i, k + 1); i = k + 1; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// System rows of these tables have user_id NULL: their ON CONFLICT never fires (NULLs are distinct in unique indexes),
// so a re-run would duplicate them. Their statements run as one block, only while no system row exists yet.
const NULL_KEY_TABLES = ['business_directions', 'activity_types', 'cashflow_categories'];

export function build(root = ROOT) {
  const parts = [], grouped = new Map();
  for (const f of SOURCES) {
    const sql = fs.readFileSync(path.join(root, 'migrations', f), 'utf8').replace(/\r\n/g, '\n');
    for (const s of statements(sql).filter((x) => /^INSERT\s+INTO/i.test(x))) {
      if (!/ON\s+CONFLICT|WHERE\s+NOT\s+EXISTS/i.test(s)) throw new Error(`unguarded reference INSERT in ${f}: ${s.slice(0, 80)}`);
      const table = /^INSERT\s+INTO\s+(?:public\.)?"?([a-z_]+)"?/i.exec(s)[1];
      if (NULL_KEY_TABLES.includes(table)) {
        if (!grouped.has(table)) { grouped.set(table, []); parts.push({ table }); }
        grouped.get(table).push(`  -- from migrations/${f}\n  ${s.replace(/\n/g, '\n  ')};`);
      } else parts.push(`-- from migrations/${f}\n${s};`);
    }
  }
  for (let i = 0; i < parts.length; i++) if (typeof parts[i] === 'object') {
    const t = parts[i].table;
    parts[i] = `-- ${t}: system rows (user_id NULL) are seeded once\nDO $seed$ BEGIN\n IF NOT EXISTS (SELECT 1 FROM public.${t} WHERE user_id IS NULL) THEN\n${grouped.get(t).join('\n')}\n END IF;\nEND $seed$;`;
  }
  return `-- 001 — Reference data for a CLEAN installation (generated; do not edit by hand).
-- Rebuild: node scripts/install/build-reference-seed.mjs   ·   Check: --check
-- Source: the reference-data INSERTs of migrations ${SOURCES.join(', ')} (verbatim).
-- Contains system reference rows only: activity types, cashflow categories, business directions, legacy plan
-- limits, official tax sources and rules, onboarding flows/steps, industry P&L templates. No customer data.
-- Idempotent: every statement is guarded (ON CONFLICT / WHERE NOT EXISTS). Applied by scripts/install-v2.mjs.
BEGIN;
SET LOCAL search_path = public, extensions;
${parts.join('\n\n')}
COMMIT;
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur.replace(/\r\n/g, '\n') !== text) { console.error('install/001_reference_data.sql is out of date: rebuild it'); process.exit(1); }
    console.log('install/001_reference_data.sql is current'); process.exit(0);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${text.length} bytes, sha256 ${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}…)`);
}
