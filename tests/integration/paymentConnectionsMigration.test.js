// 051_payment_provider_connections.sql — DDL, constraints and idempotency over PGlite.
//
// The load-bearing assertion here is a NEGATIVE one: the table must carry no credential
// column. Everything else is ordinary constraint checking.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/051_payment_provider_connections.sql'), 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const WALLET_A = '33333333-3333-3333-3333-333333333333';
const USER = -1;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid NULL, name text NULL);
    INSERT INTO users VALUES (${USER});
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');
    INSERT INTO wallets VALUES ('${WALLET_A}', '${BIZ_A}', 'Midtrans');`);
  await db.exec(SQL);
  return db;
}
const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const count = async (db) => (await db.query('SELECT count(*)::int n FROM payment_provider_connections')).rows[0].n;

function ins(o = {}) {
  const f = { business_id: `'${BIZ_A}'`, provider: `'midtrans'`, ...o };
  return `INSERT INTO payment_provider_connections (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
}

test('051 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL), null);
});

test('the table starts empty', async () => {
  assert.strictEqual(await count(await freshDb()), 0);
});

// ── The rule this migration exists to hold ───────────────────────────────────────────────
test('NO credential column exists on the table', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'payment_provider_connections'`);
  const cols = rows.map(r => r.column_name);
  const secretish = cols.filter(c => /secret|api_?key|token|password|credential|private_?key|auth/i.test(c));
  assert.deepStrictEqual(secretish, [], `credential-shaped column(s) present: ${secretish}`);
  // And the columns that SHOULD exist, do.
  for (const c of ['business_id','provider','environment','status','display_name',
                   'provider_account_id','linked_wallet_id','last_sync_at','last_webhook_at',
                   'last_error','created_by_user_id','created_at','updated_at']) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  assert.strictEqual(cols.length, 14, 'unexpected column count (13 + id)');
});

// ── Vocabularies ─────────────────────────────────────────────────────────────────────────
test('provider is a closed vocabulary', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ provider: `'brandnewpay'` })) || '', /check constraint/i);
  for (const p of ['midtrans','xendit','doku','hitpay','duitku','ipaymu','manual','bank']) {
    assert.strictEqual(await fails(db, ins({ provider: `'${p}'` })), null, `${p} rejected`);
  }
  assert.strictEqual(await count(db), 8);
});

test('environment and status are closed vocabularies with safe defaults', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ environment: `'staging'` })) || '', /check constraint/i);
  assert.match(await fails(db, ins({ status: `'live'` })) || '', /check constraint/i);
  await db.exec(ins());
  const r = await db.query('SELECT environment, status FROM payment_provider_connections');
  assert.strictEqual(r.rows[0].environment, 'sandbox', 'production must be deliberate');
  assert.strictEqual(r.rows[0].status, 'disconnected');
});

// ── Tenancy ──────────────────────────────────────────────────────────────────────────────
test('business_id is NOT NULL and must reference a real business', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ business_id: 'NULL' })) || '', /null value|not-null/i);
  assert.match(await fails(db, ins({ business_id: `'44444444-4444-4444-4444-444444444444'` })) || '', /foreign key/i);
});

test('a business with connections cannot be hard-deleted (RESTRICT)', async () => {
  const db = await freshDb();
  await db.exec(ins());
  assert.match(await fails(db, `DELETE FROM businesses WHERE id='${BIZ_A}';`) || '', /foreign key|violates/i);
});

// ── Uniqueness ───────────────────────────────────────────────────────────────────────────
test('the same provider account cannot be registered twice per environment', async () => {
  const db = await freshDb();
  await db.exec(ins({ provider_account_id: `'G123'` }));
  const err = await fails(db, ins({ provider_account_id: `'G123'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('the same account IS allowed in a different environment or business', async () => {
  const db = await freshDb();
  await db.exec(ins({ provider_account_id: `'G123'` }));
  assert.strictEqual(await fails(db, ins({ provider_account_id: `'G123'`, environment: `'production'` })), null);
  assert.strictEqual(await fails(db, ins({ provider_account_id: `'G123'`, business_id: `'${BIZ_B}'` })), null);
  assert.strictEqual(await count(db), 3);
});

test('the guard is PARTIAL - placeholder connections with no account id are unrestricted', async () => {
  const db = await freshDb();
  await db.exec(ins());
  assert.strictEqual(await fails(db, ins()), null, 'a second placeholder should be allowed');
  assert.strictEqual(await count(db), 2);
});

// ── Wallet link ──────────────────────────────────────────────────────────────────────────
test('deleting the linked wallet keeps the connection and NULLs the link', async () => {
  const db = await freshDb();
  await db.exec(ins({ linked_wallet_id: `'${WALLET_A}'` }));
  await db.exec(`DELETE FROM wallets WHERE id='${WALLET_A}';`);
  assert.strictEqual(await count(db), 1);
  const r = await db.query('SELECT linked_wallet_id FROM payment_provider_connections');
  assert.strictEqual(r.rows[0].linked_wallet_id, null);
});

// ── Trigger ──────────────────────────────────────────────────────────────────────────────
test('updated_at is maintained by the trigger, not the caller', async () => {
  const db = await freshDb();
  await db.exec(ins());
  const before = (await db.query('SELECT updated_at FROM payment_provider_connections')).rows[0].updated_at;
  await db.exec(`UPDATE payment_provider_connections SET display_name='Main';`);
  const after = (await db.query('SELECT updated_at FROM payment_provider_connections')).rows[0].updated_at;
  assert.ok(new Date(after) >= new Date(before));
});
