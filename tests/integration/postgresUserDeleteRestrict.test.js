// Migration 070 on the REAL production schema: deleting a user can no longer delete company or
// financial records; personal identity data still goes with the person; the app's own delete paths
// (empty business delete, business financial reset) keep working.
// Run: DATABASE_URL=postgresql://postgres:…@localhost:5432/testdb node --test tests/integration/postgresUserDeleteRestrict.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createProdSchemaDatabase } = require('./_prodSchemaDb');

const RESTRICTED = [
  ['transactions', 'user_id'], ['debts', 'user_id'], ['payroll_employees', 'user_id'], ['payroll_payments', 'user_id'],
  ['payroll_payment_items', 'user_id'], ['businesses', 'owner_user_id'], ['reminders', 'user_id'], ['accounts', 'user_id'], ['categories', 'user_id'],
];

let db, c;
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const n = async (sql, p) => Number((await c.query(sql, p)).rows[0].n);
let nextUser = 9100;

async function company(owner) {
  const biz = crypto.randomUUID();
  await c.query(`INSERT INTO public.businesses (id, name, owner_user_id, type) VALUES ($1, 'Restrict Co', $2, 'business')`, [biz, owner]);
  await c.query(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [biz, owner]);
  return biz;
}
async function user() { const id = nextUser++; await c.query('INSERT INTO public.users (id) VALUES ($1)', [id]); return id; }

// One row of each restricted table, owned by `uid` (in company `biz`, owned by `owner`).
async function seedRow(tbl, uid, biz, owner = uid) {
  switch (tbl) {
    case 'transactions': return c.query(`INSERT INTO public.transactions (business_id, user_id, type, amount_original, currency_original) VALUES ($1, $2, 'expense', 1000, 'IDR')`, [biz, uid]);
    case 'debts': return c.query(`INSERT INTO public.debts (business_id, user_id, type, counterparty, amount) VALUES ($1, $2, 'payable', 'Vendor', 1000)`, [biz, uid]);
    case 'payroll_employees': return c.query(`INSERT INTO public.payroll_employees (business_id, user_id, name) VALUES ($1, $2, 'Employee')`, [biz, uid]);
    case 'payroll_payments': return c.query(`INSERT INTO public.payroll_payments (business_id, user_id, employee_name, amount) VALUES ($1, $2, 'Employee', 1000)`, [biz, uid]);
    case 'payroll_payment_items': {
      // the parent payment belongs to the company owner, so only the item references `uid`
      const pp = (await c.query(`INSERT INTO public.payroll_payments (business_id, user_id, employee_name, amount) VALUES ($1, $2, 'E', 1) RETURNING id`, [biz, owner])).rows[0].id;
      return c.query(`INSERT INTO public.payroll_payment_items (business_id, user_id, payroll_payment_id, item_type, label, amount, direction) VALUES ($1, $2, $3, 'bonus', 'Bonus', 1, 'addition')`, [biz, uid, pp]);
    }
    case 'businesses': return company(uid);
    case 'reminders': return c.query(`INSERT INTO public.reminders (business_id, user_id, title) VALUES ($1, $2, 'Pay tax')`, [biz, uid]);
    case 'accounts': return c.query(`INSERT INTO public.accounts (user_id, name) VALUES ($1, 'Old account')`, [uid]);
    case 'categories': return c.query(`INSERT INTO public.categories (user_id, name, type) VALUES ($1, 'Old category', 'expense')`, [uid]);
    default: throw new Error(tbl);
  }
}

describe('Migration 070: user deletion cannot remove company or financial records', () => {
  let skipped = false;
  before(async () => {
    db = await createProdSchemaDatabase('hf_restrict', ['069_bank_import_atomic_confirm.sql', '070_financial_records_restrict_user_delete.sql']);
    if (!db) { skipped = true; return; }
    c = new Client({ connectionString: db.connectionString });
    await c.connect();
  });
  after(async () => { try { await c?.end(); } catch { /* */ } if (db) await db.drop(); });

  it('the catalog: exactly the nine company-data FKs are RESTRICT, identity FKs still CASCADE', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const rows = (await c.query(`SELECT conrelid::regclass::text AS tbl, confdeltype::text AS d,
      (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey)) AS col
      FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.users'::regclass`)).rows;
    const restrict = rows.filter(r => r.d === 'r').map(r => `${r.tbl}.${r.col}`).sort();
    assert.deepStrictEqual(restrict, RESTRICTED.map(([tbl, col]) => `${tbl}.${col}`).sort());
    const cascade = rows.filter(r => r.d === 'c').map(r => r.tbl).sort();
    assert.deepStrictEqual(cascade, ['business_member_notification_grants', 'business_members', 'channel_link_tokens', 'mcp_oauth_codes',
      'mcp_oauth_tokens', 'onboarding_context_snapshots', 'onboarding_progress', 'telegram_user_state', 'user_channel_links',
      'user_channel_state', 'user_email_identities', 'user_profiles']);
  });

  for (const [tbl] of RESTRICTED) {
    it(`a user who still owns a ${tbl} row cannot be deleted, and nothing is removed`, async (t) => {
      if (skipped) return t.skip('PostgreSQL unavailable');
      const owner = await user();
      const biz = await company(owner);
      const holder = await user();
      await seedRow(tbl, holder, biz, owner);
      const before = await n(`SELECT count(*) AS n FROM public.${tbl}`);
      const r = await settle(c.query('DELETE FROM public.users WHERE id = $1', [holder]));
      assert.ok(r.error, 'delete must fail');
      assert.strictEqual(r.error.code, '23503');
      assert.match(r.error.message, new RegExp(`violates foreign key constraint "${tbl}_\\w+_fkey"`));
      assert.strictEqual(await n(`SELECT count(*) AS n FROM public.${tbl}`), before);
      assert.strictEqual(await n('SELECT count(*) AS n FROM public.users WHERE id = $1', [holder]), 1);
    });
  }

  it('the 2026-08-27 case: deleting the person behind a live company keeps the company and its ledger', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const owner = await user();
    const biz = await company(owner);
    const legacy = await user();                    // the old identity the rows were recorded under
    for (const tbl of ['transactions', 'debts', 'payroll_employees']) await seedRow(tbl, legacy, biz);
    const r = await settle(c.query('DELETE FROM public.users WHERE id = $1', [legacy]));
    assert.strictEqual(r.error?.code, '23503');
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [biz]), 1);
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.debts WHERE business_id = $1', [biz]), 1);
    // The documented way: hand the records to the current owner first, then delete the person.
    for (const tbl of ['transactions', 'debts', 'payroll_employees']) await c.query(`UPDATE public.${tbl} SET user_id = $1 WHERE user_id = $2`, [owner, legacy]);
    await c.query('DELETE FROM public.users WHERE id = $1', [legacy]);
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [biz]), 1);
  });

  it('a user without company data is still deleted together with personal identity data', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const owner = await user();
    const biz = await company(owner);
    const member = await user();
    await c.query(`INSERT INTO public.business_members (business_id, user_id, role, status) VALUES ($1, $2, 'accountant', 'active')`, [biz, member]);
    await c.query(`INSERT INTO public.user_profiles (user_id) VALUES ($1)`, [member]);
    await c.query(`INSERT INTO public.user_email_identities (user_id, email) VALUES ($1, $2)`, [member, `m${member}@example.test`]);
    await c.query(`INSERT INTO public.user_channel_links (user_id, channel, external_user_id) VALUES ($1, 'telegram', $2)`, [member, String(member)]);
    await c.query('DELETE FROM public.users WHERE id = $1', [member]);
    for (const tbl of ['business_members', 'user_profiles', 'user_email_identities', 'user_channel_links']) {
      assert.strictEqual(await n(`SELECT count(*) AS n FROM public.${tbl} WHERE user_id = $1`, [member]), 0, tbl);
    }
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.businesses WHERE id = $1', [biz]), 1);
  });

  it('app paths still work: empty business delete cascades memberships; business financial reset deletes by business', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const owner = await user();
    const empty = await company(owner);
    await c.query('DELETE FROM public.businesses WHERE id = $1', [empty]);   // what DELETE /api/businesses/:id does
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.business_members WHERE business_id = $1', [empty]), 0);

    const biz = await company(owner);
    await seedRow('transactions', owner, biz);
    await seedRow('debts', owner, biz);
    const reset = await settle(c.query('SELECT public.rpc_reset_business_financial($1::uuid, $2::bigint) AS r', [biz, owner]));
    assert.ok(!reset.error, reset.error?.message);
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.transactions WHERE business_id = $1', [biz]), 0);
    assert.strictEqual(await n('SELECT count(*) AS n FROM public.debts WHERE business_id = $1', [biz]), 0);
  });

  it('is idempotent: applying it again changes nothing', async (t) => {
    if (skipped) return t.skip('PostgreSQL unavailable');
    const sig = async () => (await c.query(`SELECT string_agg(conname || confdeltype::text, ',' ORDER BY conname) AS s FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.users'::regclass`)).rows[0].s;
    const before = await sig();
    await c.query(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '070_financial_records_restrict_user_delete.sql'), 'utf8'));
    assert.strictEqual(await sig(), before);
  });
});
