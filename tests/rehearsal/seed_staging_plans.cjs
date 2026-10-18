'use strict';
const { Client } = require('pg');
const { secrets, PORTS } = require('./env.cjs');
const S = secrets();

(async () => {
  const c = new Client({ connectionString: `postgresql://postgres:${S.db_password}@127.0.0.1:${PORTS.db}/postgres` });
  await c.connect();

  const APPROVED = {
    starter: { users: 5, transactions: 1000, documents: 100, ai: 50 },
    control: { users: 10, transactions: 5000, documents: 500, ai: 300 },
    pro: { users: 30, transactions: 20000, documents: 2000, ai: 1000 }
  };
  const LIMITS = {
    starter: { ...APPROVED.starter, companies: 1, imports: 10, bank_rows: 1000, accounts: 5, storage_mb: 2048, integrations: 0, mcp: 0, ai_accountant: 0, ai_extraction: 100 },
    control: { ...APPROVED.control, companies: 2, imports: 50, bank_rows: 5000, accounts: 15, storage_mb: 10240, integrations: 1, mcp: 1000, ai_accountant: 100, ai_extraction: 500 },
    pro: { ...APPROVED.pro, companies: 5, imports: 200, bank_rows: 20000, accounts: 50, storage_mb: 51200, integrations: 5, mcp: 10000, ai_accountant: 500, ai_extraction: 2000 }
  };
  const FEATURES = {
    starter: { documents: true, ai: false, import: true, payroll: false, team: false, approvals: false, export: true, integrations: false, cfo_ai: false, ai_accountant: false, api: false },
    control: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: false, cfo_ai: true, ai_accountant: false, api: false },
    pro: { documents: true, ai: true, import: true, payroll: true, team: true, approvals: true, export: true, integrations: true, cfo_ai: true, ai_accountant: true, api: true }
  };

  for (const plan of ['starter', 'control', 'pro']) {
    const vRes = await c.query('SELECT current_version_id FROM plan_limits WHERE plan = $1', [plan]);
    const vid = vRes.rows[0].current_version_id;
    await c.query(
      "UPDATE plan_versions SET approval_status = 'approved', features = $1, limits = $2, effective_at = now() - interval '1 minute', terms_version = $3 WHERE id = $4",
      [JSON.stringify(FEATURES[plan]), JSON.stringify(LIMITS[plan]), 'staging-2026-10-18', vid]
    );
    await c.query('UPDATE plan_limits SET commercial_available = true WHERE plan = $1', [plan]);
    console.log('Approved and enabled:', plan, vid);
  }

  const check = await c.query("SELECT plan, version, price_minor, approval_status, limits, features FROM plan_versions WHERE approval_status = 'approved'");
  console.log('Approved count:', check.rows.length);
  for (const r of check.rows) {
    console.log(`Plan: ${r.plan}, Price: $${Number(r.price_minor)/100}, Status: ${r.approval_status}, Limits: ${JSON.stringify(r.limits)}`);
  }

  await c.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
