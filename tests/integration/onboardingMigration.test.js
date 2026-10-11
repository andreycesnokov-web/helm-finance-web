// 054_onboarding_foundation.sql — DDL, constraints, indexes, triggers and SEED CONTENT.
//
// The seed assertions matter as much as the DDL: a tour that silently loses a product area
// teaches users a product that no longer matches what they see.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/054_onboarding_foundation.sql'), 'utf8');
const BIZ = '11111111-1111-1111-1111-111111111111';
const USER = -1;
const TABLES = ['onboarding_flows', 'onboarding_steps', 'onboarding_progress',
                'onboarding_step_progress', 'onboarding_events', 'onboarding_context_snapshots'];

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (${USER});
    INSERT INTO businesses VALUES ('${BIZ}','business');`);
  await db.exec(SQL);
  return db;
}
const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const rows = async (db, sql) => (await db.query(sql)).rows;
const one = async (db, sql) => (await rows(db, sql))[0];

test('054 applies cleanly and is IDEMPOTENT (seeds are not duplicated)', async () => {
  const db = await freshDb();
  const before = (await one(db, 'SELECT count(*)::int n FROM onboarding_steps')).n;
  assert.strictEqual(await fails(db, SQL), null);
  const after = (await one(db, 'SELECT count(*)::int n FROM onboarding_steps')).n;
  assert.strictEqual(after, before, 're-applying duplicated seed steps');
});

test('all six tables exist', async () => {
  const db = await freshDb();
  for (const t of TABLES) {
    assert.ok((await one(db, `SELECT to_regclass('public.${t}') AS t`)).t, `${t} missing`);
  }
});

test('the progress tables start EMPTY - seeds are content, not user state', async () => {
  const db = await freshDb();
  for (const t of ['onboarding_progress', 'onboarding_step_progress', 'onboarding_events',
                   'onboarding_context_snapshots']) {
    assert.strictEqual((await one(db, `SELECT count(*)::int n FROM ${t}`)).n, 0, `${t} not empty`);
  }
});

// ── Seeded flows ─────────────────────────────────────────────────────────────────────────
test('the three flows are seeded with the right modes', async () => {
  const db = await freshDb();
  const f = await rows(db, 'SELECT flow_key, mode, is_active FROM onboarding_flows ORDER BY flow_key');
  assert.deepStrictEqual(f.map(x => x.flow_key),
    ['ai_accountant_company_setup', 'full_business_tour', 'quick_business_setup']);
  const byKey = Object.fromEntries(f.map(x => [x.flow_key, x]));
  assert.strictEqual(byKey.quick_business_setup.mode, 'quick_setup');
  assert.strictEqual(byKey.full_business_tour.mode, 'full_tour');
  assert.strictEqual(byKey.ai_accountant_company_setup.mode, 'feature_tour');
  assert.ok(f.every(x => x.is_active));
});

test('quick_business_setup includes the REQUIRED AI Accountant company setup step', async () => {
  const db = await freshDb();
  const s = await rows(db, `SELECT step_key, required, action_type, product_area, page_path
    FROM onboarding_steps s JOIN onboarding_flows f ON f.id = s.flow_id
    WHERE f.flow_key = 'quick_business_setup' ORDER BY s.sort_order`);
  assert.strictEqual(s.length, 7);
  const ai = s.find(x => x.step_key === 'ai_accountant_company_setup');
  assert.ok(ai, 'the AI Accountant step is missing from quick setup');
  assert.strictEqual(ai.required, true);
  assert.strictEqual(ai.action_type, 'complete_tax_profile');
  assert.strictEqual(ai.product_area, 'ai_accountant');
  // The other required steps of a usable workspace.
  assert.deepStrictEqual(s.filter(x => x.required).map(x => x.step_key).sort(),
    ['ai_accountant_company_setup', 'complete_company_profile', 'create_or_confirm_workspace']);
});

test('full_business_tour covers EVERY listed product area', async () => {
  const db = await freshDb();
  const areas = (await rows(db, `SELECT DISTINCT s.product_area FROM onboarding_steps s
    JOIN onboarding_flows f ON f.id = s.flow_id WHERE f.flow_key='full_business_tour'`))
    .map(r => r.product_area);
  for (const a of ['pulse', 'radar', 'ai_cfo', 'ai_accountant', 'transactions', 'accounts',
                   'invoices', 'receivables', 'payables', 'funding', 'bank_import',
                   'incoming_payments', 'payment_connections', 'intercompany', 'payroll',
                   'approvals', 'team', 'documents', 'settings', 'support']) {
    assert.ok(areas.includes(a), `the full tour does not cover ${a}`);
  }
  assert.strictEqual(areas.length, 20);
});

test('every full-tour step has a page path, a description and a distinct sort order', async () => {
  const db = await freshDb();
  const s = await rows(db, `SELECT s.step_key, s.page_path, s.description, s.sort_order FROM onboarding_steps s
    JOIN onboarding_flows f ON f.id = s.flow_id WHERE f.flow_key='full_business_tour' ORDER BY s.sort_order`);
  assert.strictEqual(s.length, 20);
  for (const x of s) {
    assert.ok(x.page_path && x.page_path.startsWith('/'), `${x.step_key} has no usable page_path`);
    assert.ok(x.description && x.description.length > 20, `${x.step_key} has no real description`);
  }
  assert.strictEqual(new Set(s.map(x => x.sort_order)).size, 20, 'duplicate sort orders');
});

test('ai_accountant_company_setup covers company, tax and profile steps', async () => {
  const db = await freshDb();
  const keys = (await rows(db, `SELECT step_key FROM onboarding_steps s
    JOIN onboarding_flows f ON f.id = s.flow_id WHERE f.flow_key='ai_accountant_company_setup'
    ORDER BY s.sort_order`)).map(r => r.step_key);
  for (const k of ['understand_ai_accountant', 'choose_company_type', 'add_npwp', 'add_nib',
                   'add_pkp_status', 'add_kbli', 'confirm_tax_scheme',
                   'add_employees_payroll_context', 'upload_company_documents',
                   'upload_first_invoice_or_receipt', 'review_ai_extraction',
                   'check_accounting_readiness', 'prepare_for_accountant_review']) {
    assert.ok(keys.includes(k), `missing step ${k}`);
  }
  assert.strictEqual(keys.length, 13);
});

test('sensitive setup steps carry accountant-review guidance metadata', async () => {
  const db = await freshDb();
  const s = await rows(db, `SELECT st.step_key, st.metadata FROM onboarding_steps st
    JOIN onboarding_flows f ON f.id = st.flow_id WHERE f.flow_key='ai_accountant_company_setup'`);
  const byKey = Object.fromEntries(s.map(x => [x.step_key, x.metadata]));
  // PKP status and the tax scheme are the two a user should not guess at alone.
  assert.strictEqual(byKey.add_pkp_status.accountant_review_recommended, true);
  assert.strictEqual(byKey.confirm_tax_scheme.accountant_review_recommended, true);
  assert.strictEqual(byKey.review_ai_extraction.human_review_required, true);
});

// ── Localization ─────────────────────────────────────────────────────────────────────────
test('flows carry ru and id translations alongside the English fallback', async () => {
  const db = await freshDb();
  const f = await rows(db, 'SELECT flow_key, title, title_i18n FROM onboarding_flows');
  for (const x of f) {
    assert.ok(x.title, `${x.flow_key} has no English title`);
    assert.ok(x.title_i18n.ru, `${x.flow_key} has no ru title`);
    assert.ok(x.title_i18n.id, `${x.flow_key} has no id title`);
  }
});

test('i18n columns default to an empty object, never null', async () => {
  const db = await freshDb();
  const n = (await one(db, `SELECT count(*)::int n FROM onboarding_steps
    WHERE title_i18n IS NULL OR description_i18n IS NULL OR instructions_i18n IS NULL`)).n;
  assert.strictEqual(n, 0);
});

// ── Constraints ──────────────────────────────────────────────────────────────────────────
test('enum-style columns are closed vocabularies', async () => {
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  assert.match(await fails(db, `INSERT INTO onboarding_flows (flow_key,title,mode) VALUES ('x','X','wizard');`) || '', /check constraint/i);
  assert.match(await fails(db, `INSERT INTO onboarding_flows (flow_key,title,mode,audience) VALUES ('y','Y','quick_setup','robots');`) || '', /check constraint/i);
  assert.match(await fails(db, `INSERT INTO onboarding_steps (flow_id,step_key,title,action_type) VALUES ('${fid}','k','T','teleport');`) || '', /check constraint/i);
  assert.match(await fails(db, `INSERT INTO onboarding_steps (flow_id,step_key,title,product_area) VALUES ('${fid}','k2','T','marketing');`) || '', /check constraint/i);
});

test('flow_key is unique and (flow_id, step_key) is unique', async () => {
  const db = await freshDb();
  assert.match(await fails(db, `INSERT INTO onboarding_flows (flow_key,title,mode) VALUES ('quick_business_setup','dup','quick_setup');`) || '', /duplicate key|unique/i);
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  assert.match(await fails(db, `INSERT INTO onboarding_steps (flow_id,step_key,title) VALUES ('${fid}','add_first_wallet','dup');`) || '', /duplicate key|unique/i);
});

test('progress_percent is bounded to 0..100', async () => {
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  const ins = (pct) => `INSERT INTO onboarding_progress (user_id,flow_id,progress_percent) VALUES (${USER},'${fid}',${pct});`;
  assert.match(await fails(db, ins(101)) || '', /check constraint/i);
  assert.match(await fails(db, ins(-1)) || '', /check constraint/i);
  assert.strictEqual(await fails(db, ins(42.5)), null);
});

// ── The null-business uniqueness problem ─────────────────────────────────────────────────
test('one progress row per flow for a user with NO business', async () => {
  // A plain UNIQUE would allow unlimited rows here, because Postgres treats NULLs as distinct.
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  const ins = `INSERT INTO onboarding_progress (user_id,flow_id) VALUES (${USER},'${fid}');`;
  await db.exec(ins);
  assert.match(await fails(db, ins) || '', /duplicate key|unique/i);
  assert.strictEqual((await one(db, 'SELECT count(*)::int n FROM onboarding_progress')).n, 1);
});

test('one progress row per (user, business, flow), and the two scopes are independent', async () => {
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  const scoped = `INSERT INTO onboarding_progress (user_id,business_id,flow_id) VALUES (${USER},'${BIZ}','${fid}');`;
  await db.exec(scoped);
  assert.match(await fails(db, scoped) || '', /duplicate key|unique/i);
  // The no-business scope is separate and still allowed.
  assert.strictEqual(await fails(db, `INSERT INTO onboarding_progress (user_id,flow_id) VALUES (${USER},'${fid}');`), null);
  assert.strictEqual((await one(db, 'SELECT count(*)::int n FROM onboarding_progress')).n, 2);
});

test('one step-progress row per (progress, step)', async () => {
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  const pid = (await one(db, `INSERT INTO onboarding_progress (user_id,flow_id) VALUES (${USER},'${fid}') RETURNING id`)).id;
  const sid = (await one(db, `SELECT id FROM onboarding_steps WHERE flow_id='${fid}' LIMIT 1`)).id;
  const ins = `INSERT INTO onboarding_step_progress (progress_id,step_id) VALUES ('${pid}','${sid}');`;
  await db.exec(ins);
  assert.match(await fails(db, ins) || '', /duplicate key|unique/i);
});

// ── Indexes and triggers ─────────────────────────────────────────────────────────────────
test('the documented indexes exist', async () => {
  const db = await freshDb();
  const idx = (await rows(db, `SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename LIKE 'onboarding%'`)).map(r => r.indexname);
  for (const n of ['onboarding_flows_active_idx', 'onboarding_steps_flow_idx',
                   'onboarding_progress_scoped_uidx', 'onboarding_progress_nobiz_uidx',
                   'onboarding_step_progress_progress_idx', 'onboarding_events_user_idx']) {
    assert.ok(idx.includes(n), `missing index ${n}`);
  }
});

test('updated_at triggers fire on all four mutable tables', async () => {
  const db = await freshDb();
  const t = (await rows(db, `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map(r => r.tgname);
  for (const n of ['trg_onboarding_flows_updated_at', 'trg_onboarding_steps_updated_at',
                   'trg_onboarding_progress_updated_at', 'trg_onboarding_step_progress_updated_at']) {
    assert.ok(t.includes(n), `missing trigger ${n}`);
  }
  const fid = (await one(db, `SELECT id, updated_at FROM onboarding_flows LIMIT 1`));
  await db.exec(`UPDATE onboarding_flows SET sort_order = sort_order + 1 WHERE id='${fid.id}';`);
  const after = (await one(db, `SELECT updated_at FROM onboarding_flows WHERE id='${fid.id}'`)).updated_at;
  assert.ok(new Date(after) >= new Date(fid.updated_at));
});

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────
test('deleting a flow removes its steps and progress', async () => {
  const db = await freshDb();
  const fid = (await one(db, `SELECT id FROM onboarding_flows WHERE flow_key='quick_business_setup'`)).id;
  await db.exec(`INSERT INTO onboarding_progress (user_id,flow_id) VALUES (${USER},'${fid}');`);
  await db.exec(`DELETE FROM onboarding_flows WHERE id='${fid}';`);
  assert.strictEqual((await one(db, `SELECT count(*)::int n FROM onboarding_steps WHERE flow_id='${fid}'`)).n, 0);
  assert.strictEqual((await one(db, 'SELECT count(*)::int n FROM onboarding_progress')).n, 0);
});
