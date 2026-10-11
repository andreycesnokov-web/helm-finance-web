// 052_payment_provider_credentials.sql — DDL, constraints and the guard trigger, over PGlite.
//
// The load-bearing assertions are NEGATIVE: no column can hold a plaintext secret, and no
// credential can be filed against a connection belonging to another business.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../migrations/', f), 'utf8');
const SQL_051 = read('051_payment_provider_connections.sql');
const SQL_052 = read('052_payment_provider_credentials.sql');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const CONN_A = '33333333-3333-3333-3333-333333333333';   // sandbox / xendit / BIZ_A
const CONN_B = '44444444-4444-4444-4444-444444444444';   // sandbox / xendit / BIZ_B
const USER = -1;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    CREATE TABLE wallets (id uuid PRIMARY KEY, business_id uuid NULL, name text NULL);
    INSERT INTO users VALUES (${USER});
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');`);
  await db.exec(SQL_051);
  await db.exec(SQL_052);
  await db.exec(`
    INSERT INTO payment_provider_connections (id, business_id, provider, environment)
    VALUES ('${CONN_A}', '${BIZ_A}', 'xendit', 'sandbox'),
           ('${CONN_B}', '${BIZ_B}', 'xendit', 'sandbox');`);
  return db;
}
const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const count = async (db) => (await db.query('SELECT count(*)::int n FROM payment_provider_credentials')).rows[0].n;

function ins(o = {}) {
  const f = {
    connection_id: `'${CONN_A}'`, business_id: `'${BIZ_A}'`, provider: `'xendit'`,
    environment: `'sandbox'`, credential_type: `'server_key'`,
    encrypted_value: `'Y2lwaGVy'`, encryption_iv: `'aXY='`, encryption_tag: `'dGFn'`,
    value_fingerprint: `'abc123'`, ...o,
  };
  return `INSERT INTO payment_provider_credentials (${Object.keys(f).join(', ')}) VALUES (${Object.values(f).join(', ')});`;
}

test('052 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL_052), null);
});

test('the table starts empty', async () => {
  assert.strictEqual(await count(await freshDb()), 0);
});

// ── The rule this migration exists to hold ───────────────────────────────────────────────
test('NO plaintext secret column exists', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'payment_provider_credentials'`);
  const cols = rows.map(r => r.column_name);
  const forbidden = cols.filter(c =>
    ['api_key','secret','secret_key','token','credentials','value','plaintext','password','private_key'].includes(c));
  assert.deepStrictEqual(forbidden, [], `plaintext column(s) present: ${forbidden}`);

  // The only value-bearing columns are the authenticated-encryption triple.
  for (const c of ['encrypted_value','encryption_iv','encryption_tag']) {
    assert.ok(cols.includes(c), `missing ${c}`);
  }
  assert.strictEqual(cols.length, 17);
});

test('all three ciphertext columns are NOT NULL - GCM is useless missing any of them', async () => {
  const db = await freshDb();
  for (const c of ['encrypted_value', 'encryption_iv', 'encryption_tag', 'value_fingerprint']) {
    assert.match(await fails(db, ins({ [c]: 'NULL' })) || '', /null value|not-null/i, `${c} allowed NULL`);
  }
  // ...and none may be empty string.
  for (const c of ['encrypted_value', 'encryption_iv', 'encryption_tag', 'value_fingerprint']) {
    assert.match(await fails(db, ins({ [c]: `''` })) || '', /check constraint/i, `${c} allowed empty`);
  }
});

// ── Cross-business guard ─────────────────────────────────────────────────────────────────
test('a credential whose business disagrees with its connection is REFUSED by the DB', async () => {
  const db = await freshDb();
  const err = await fails(db, ins({ business_id: `'${BIZ_B}'` }));
  assert.match(err || '', /must match its connection/i);
  assert.strictEqual(await count(db), 0);
});

test('a credential filed against ANOTHER business connection is refused', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ connection_id: `'${CONN_B}'` })) || '', /must match its connection/i);
});

test('provider and environment must agree with the connection', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ provider: `'midtrans'` })) || '', /provider must match/i);
  assert.match(await fails(db, ins({ environment: `'production'` })) || '', /environment must match/i);
});

test('the guard fires on UPDATE too, not only INSERT', async () => {
  const db = await freshDb();
  await db.exec(ins());
  assert.match(await fails(db, `UPDATE payment_provider_credentials SET business_id='${BIZ_B}';`) || '',
    /must match its connection/i);
});

// ── One active credential per type ───────────────────────────────────────────────────────
test('only ONE active credential per (connection, type)', async () => {
  const db = await freshDb();
  await db.exec(ins());
  const err = await fails(db, ins({ value_fingerprint: `'def456'` }));
  assert.match(err || '', /duplicate key|unique/i);
  assert.strictEqual(await count(db), 1);
});

test('revoked predecessors may accumulate as history', async () => {
  const db = await freshDb();
  await db.exec(ins());
  await db.exec(`UPDATE payment_provider_credentials SET status='revoked', revoked_at=now(), revoked_by_user_id=${USER};`);
  assert.strictEqual(await fails(db, ins({ value_fingerprint: `'def456'` })), null, 'rotation blocked');
  await db.exec(`UPDATE payment_provider_credentials SET status='revoked', revoked_at=now(), revoked_by_user_id=${USER} WHERE status='active';`);
  assert.strictEqual(await fails(db, ins({ value_fingerprint: `'ghi789'` })), null);
  assert.strictEqual(await count(db), 3, 'history should be retained, not overwritten');
});

test('a different credential type may be active at the same time', async () => {
  const db = await freshDb();
  await db.exec(ins({ credential_type: `'server_key'` }));
  assert.strictEqual(await fails(db, ins({ credential_type: `'client_key'` })), null);
  assert.strictEqual(await count(db), 2);
});

// ── Vocabularies and stamps ──────────────────────────────────────────────────────────────
test('credential_type and status are closed vocabularies', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ credential_type: `'root_password'` })) || '', /check constraint/i);
  assert.match(await fails(db, ins({ status: `'expired'` })) || '', /check constraint/i);
});

test('a revocation stamp is all-or-nothing, and an active credential carries none', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ status: `'revoked'` })) || '', /revocation_stamp/i);
  assert.match(await fails(db, ins({ revoked_at: 'now()' })) || '', /revocation_stamp/i);
  assert.strictEqual(await fails(db, ins({ status: `'revoked'`, revoked_at: 'now()', revoked_by_user_id: `${USER}` })), null);
});

test('value_last4 can never hold more than 4 characters', async () => {
  const db = await freshDb();
  assert.match(await fails(db, ins({ value_last4: `'toolong'` })) || '', /check constraint/i);
  assert.strictEqual(await fails(db, ins({ value_last4: `'mnop'` })), null);
});

// ── Disposal ─────────────────────────────────────────────────────────────────────────────
test('deleting the connection disposes of its ciphertext (CASCADE)', async () => {
  const db = await freshDb();
  await db.exec(ins());
  await db.exec(`DELETE FROM payment_provider_connections WHERE id='${CONN_A}';`);
  assert.strictEqual(await count(db), 0);
});
