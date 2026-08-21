// 045_channel_identity_foundation.sql — DDL validity, constraint BEHAVIOUR and idempotency
// over PGlite. No Supabase. Role GRANT/REVOKE is role-guarded (no-op in PGlite); full grant
// fidelity is verified on local Supabase, as with 043.
//
// PR1 is schema only: these tables are created empty and nothing reads them yet. The point of
// these tests is that the CONSTRAINTS behave, not merely that the SQL parses — a partial
// unique index that permits two active links would be invisible to a text grep and fatal in
// PR4.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIG = path.join(__dirname, '../../migrations/045_channel_identity_foundation.sql');
const SQL = fs.readFileSync(MIG, 'utf8');

const BIZ_A = '11111111-1111-1111-1111-111111111111';
const BIZ_B = '22222222-2222-2222-2222-222222222222';
const TG_USER = 8800001;      // positive id: Telegram-origin (legacy conflation)
const EMAIL_USER = -42;       // negative id: email-origin (app_user_id_seq, migration 042)

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');
    INSERT INTO users VALUES (${TG_USER}), (${EMAIL_USER}), (7700002);
    INSERT INTO businesses VALUES ('${BIZ_A}','business'), ('${BIZ_B}','business');`);
  await db.exec(SQL);
  return db;
}

const fails = async (db, sql) => {
  try { await db.exec(sql); return null; }
  catch (e) { return e.message; }
};

// ── applies, and applies twice ──────────────────────────────────────────────
test('045 applies cleanly and is IDEMPOTENT', async () => {
  const db = await freshDb();
  await db.exec(SQL);   // second run must be a no-op
  for (const t of ['user_channel_links', 'channel_link_tokens', 'user_channel_state']) {
    const r = await db.query(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`);
    assert.equal(r.rows[0].ok, true, `${t} missing`);
  }
});

test('the migration is numbered 045 and nothing else claims that number', async () => {
  const files = fs.readdirSync(path.join(__dirname, '../../migrations'))
    .filter((f) => /^045[_-]/.test(f));
  assert.deepStrictEqual(files, ['045_channel_identity_foundation.sql']);
});

// ── column types ────────────────────────────────────────────────────────────
async function colType(db, table, column) {
  const r = await db.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column]);
  return r.rows[0]?.data_type ?? null;
}

test('active_business_id is UUID — the audit correction', async () => {
  // The original plan said BIGINT. businesses.id is UUID, so BIGINT would fail at apply time.
  const db = await freshDb();
  assert.strictEqual(await colType(db, 'user_channel_state', 'active_business_id'), 'uuid');
});

test('no BIGINT column anywhere references businesses', async () => {
  const db = await freshDb();
  const r = await db.query(`
    SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema='public'
       AND c.table_name IN ('user_channel_links','channel_link_tokens','user_channel_state')
       AND c.column_name LIKE '%business%'`);
  for (const row of r.rows)
    assert.strictEqual(row.data_type, 'uuid',
      `${row.table_name}.${row.column_name} is ${row.data_type}, expected uuid`);
});

test('user_id columns are bigint, matching users.id', async () => {
  const db = await freshDb();
  assert.strictEqual(await colType(db, 'user_channel_links', 'user_id'), 'bigint');
  assert.strictEqual(await colType(db, 'channel_link_tokens', 'user_id'), 'bigint');
  assert.strictEqual(await colType(db, 'user_channel_state', 'user_id'), 'bigint');
  assert.strictEqual(await colType(db, 'user_channel_links', 'revoked_by_user_id'), 'bigint');
});

test('external_user_id is TEXT by design, for non-numeric future channels', async () => {
  const db = await freshDb();
  assert.strictEqual(await colType(db, 'user_channel_links', 'external_user_id'), 'text');
});

test('channel_metadata is jsonb and defaults to an empty object, never NULL', async () => {
  const db = await freshDb();
  assert.strictEqual(await colType(db, 'user_channel_links', 'channel_metadata'), 'jsonb');
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','111',${TG_USER});`);
  const r = await db.query(`SELECT channel_metadata FROM user_channel_links WHERE external_user_id='111'`);
  assert.deepStrictEqual(r.rows[0].channel_metadata, {});
});

// ── what must NOT exist ─────────────────────────────────────────────────────
async function columns(db, table) {
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [table]);
  return r.rows.map((x) => x.column_name);
}

test('links and tokens carry NO business_id — membership is not identity', async () => {
  const db = await freshDb();
  for (const t of ['user_channel_links', 'channel_link_tokens']) {
    const cols = await columns(db, t);
    assert.ok(!cols.some((c) => c.includes('business')),
      `${t} has a business column: ${cols.filter((c) => c.includes('business'))}`);
  }
});

test('user_channel_links carries NO role — a link grants no permission', async () => {
  const db = await freshDb();
  const cols = await columns(db, 'user_channel_links');
  assert.ok(!cols.includes('role'), 'role must live in business_members only');
  assert.ok(!cols.some((c) => /permission|scope|grant/.test(c)), cols.join(','));
});

test('channel_link_tokens stores only a hash — no raw token column', async () => {
  const db = await freshDb();
  const cols = await columns(db, 'channel_link_tokens');
  assert.ok(cols.includes('token_hash'), 'token_hash missing');
  for (const forbidden of ['token', 'raw_token', 'token_plain', 'secret'])
    assert.ok(!cols.includes(forbidden), `${forbidden} must not be stored`);
});

// ── CHECK constraints ───────────────────────────────────────────────────────
test('channel is restricted to telegram — a future channel needs a deliberate migration', async () => {
  const db = await freshDb();
  const err = await fails(db, `INSERT INTO user_channel_links (channel, external_user_id, user_id)
                               VALUES ('whatsapp','62811',${TG_USER});`);
  assert.match(err || '', /check constraint/i, 'whatsapp should be rejected');
});

test('intended_channel is restricted to telegram', async () => {
  const db = await freshDb();
  const err = await fails(db, `INSERT INTO channel_link_tokens (token_hash, user_id, intended_channel, expires_at)
                               VALUES ('h1',${TG_USER},'whatsapp', now() + interval '15 min');`);
  assert.match(err || '', /check constraint/i);
});

test('user_channel_state.channel is restricted to telegram', async () => {
  const db = await freshDb();
  const err = await fails(db, `INSERT INTO user_channel_state (user_id, channel) VALUES (${TG_USER},'sms');`);
  assert.match(err || '', /check constraint/i);
});

// ── the uniqueness that actually matters ────────────────────────────────────
test('two ACTIVE links for the same external account are rejected', async () => {
  // A Telegram account cannot be two different people at once.
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','555',${TG_USER});`);
  const err = await fails(db, `INSERT INTO user_channel_links (channel, external_user_id, user_id)
                               VALUES ('telegram','555',${EMAIL_USER});`);
  assert.match(err || '', /duplicate key|unique/i, 'a second active link must be rejected');
});

test('two ACTIVE links for the same user on one channel are rejected', async () => {
  // Needed for the reverse lookup (user_id → external id) to be unambiguous.
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','555',${TG_USER});`);
  const err = await fails(db, `INSERT INTO user_channel_links (channel, external_user_id, user_id)
                               VALUES ('telegram','666',${TG_USER});`);
  assert.match(err || '', /duplicate key|unique/i);
});

test('revoke-then-relink is allowed, and history is preserved', async () => {
  // The reason for a surrogate PK: a natural key on (channel, external_user_id) would make
  // this ordinary lifecycle impossible.
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','555',${TG_USER});`);
  await db.exec(`UPDATE user_channel_links SET revoked_at = now(), revoked_by_user_id = ${TG_USER}
                  WHERE external_user_id='555';`);
  // Same account, now linked to a DIFFERENT user — the realistic case after an unlink.
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','555',${EMAIL_USER});`);
  const r = await db.query(`SELECT count(*)::int AS total,
                                   count(*) FILTER (WHERE revoked_at IS NULL)::int AS active
                              FROM user_channel_links WHERE external_user_id='555'`);
  assert.strictEqual(r.rows[0].total, 2, 'the revoked row must survive as audit history');
  assert.strictEqual(r.rows[0].active, 1, 'exactly one link may be active');
});

test('a revoked link does not block the same USER re-linking either', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','555',${TG_USER});`);
  await db.exec(`UPDATE user_channel_links SET revoked_at = now() WHERE external_user_id='555';`);
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','777',${TG_USER});`);
  const r = await db.query(`SELECT count(*)::int AS n FROM user_channel_links
                             WHERE user_id=${TG_USER} AND revoked_at IS NULL`);
  assert.strictEqual(r.rows[0].n, 1);
});

test('an email-origin (negative id) user can hold a link — the whole point of PR1', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id)
                 VALUES ('telegram','1057134807',${EMAIL_USER});`);
  const r = await db.query(`SELECT user_id FROM user_channel_links WHERE external_user_id='1057134807'`);
  assert.strictEqual(Number(r.rows[0].user_id), EMAIL_USER);
});

// ── referential behaviour ───────────────────────────────────────────────────
test('deleting a user cascades their links, tokens and state', async () => {
  const db = await freshDb();
  await db.exec(`
    INSERT INTO user_channel_links (channel, external_user_id, user_id) VALUES ('telegram','555',7700002);
    INSERT INTO channel_link_tokens (token_hash, user_id, intended_channel, expires_at)
      VALUES ('h2',7700002,'telegram', now() + interval '15 min');
    INSERT INTO user_channel_state (user_id, channel, active_business_id) VALUES (7700002,'telegram','${BIZ_A}');
    DELETE FROM users WHERE id=7700002;`);
  for (const [t, where] of [['user_channel_links', 'user_id=7700002'],
                            ['channel_link_tokens', 'user_id=7700002'],
                            ['user_channel_state', 'user_id=7700002']]) {
    const r = await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${where}`);
    assert.strictEqual(r.rows[0].n, 0, `${t} did not cascade`);
  }
});

test('deleting a business clears the selection but keeps the channel row', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_state (user_id, channel, active_business_id)
                 VALUES (${TG_USER},'telegram','${BIZ_A}');`);
  await db.exec(`DELETE FROM businesses WHERE id='${BIZ_A}';`);
  const r = await db.query(`SELECT active_business_id FROM user_channel_state
                             WHERE user_id=${TG_USER} AND channel='telegram'`);
  assert.strictEqual(r.rows.length, 1, 'the row must survive so the channel context is kept');
  assert.strictEqual(r.rows[0].active_business_id, null, 'the stale selection must clear');
});

test('revoked_by_user_id nulls out rather than deleting the audit row', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_links (channel, external_user_id, user_id, revoked_at, revoked_by_user_id)
                 VALUES ('telegram','555',${TG_USER}, now(), 7700002);`);
  await db.exec(`DELETE FROM users WHERE id=7700002;`);
  const r = await db.query(`SELECT revoked_by_user_id FROM user_channel_links WHERE external_user_id='555'`);
  assert.strictEqual(r.rows.length, 1, 'the audit row must survive');
  assert.strictEqual(r.rows[0].revoked_by_user_id, null);
});

test('one state row per user PER CHANNEL', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_state (user_id, channel, active_business_id)
                 VALUES (${TG_USER},'telegram','${BIZ_A}');`);
  const err = await fails(db, `INSERT INTO user_channel_state (user_id, channel, active_business_id)
                               VALUES (${TG_USER},'telegram','${BIZ_B}');`);
  assert.match(err || '', /duplicate key|unique/i);
});

test('updated_at trigger bumps on UPDATE', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO user_channel_state (user_id, channel) VALUES (${TG_USER},'telegram');`);
  const q = `SELECT updated_at FROM user_channel_state WHERE user_id=${TG_USER}`;
  const t1 = (await db.query(q)).rows[0].updated_at;
  await db.exec(`UPDATE user_channel_state SET active_business_id='${BIZ_A}' WHERE user_id=${TG_USER};`);
  const t2 = (await db.query(q)).rows[0].updated_at;
  assert.ok(new Date(t2) >= new Date(t1));
});

// ── PR1 is additive and inert ───────────────────────────────────────────────
test('the migration ALTERs and DROPs nothing that already exists', async () => {
  const body = SQL.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bALTER\s+TABLE\b/i.test(body), 'PR1 must not ALTER an existing table');
  // The only DROP permitted is the idempotent trigger guard on the table 045 itself creates.
  const drops = body.match(/\bDROP\s+\w+/gi) || [];
  assert.deepStrictEqual(drops.map((d) => d.toUpperCase().replace(/\s+/g, ' ')), ['DROP TRIGGER']);
  assert.ok(!/\bTRUNCATE\b/i.test(body));
});

test('no backfill: the migration writes no rows into any table', async () => {
  // GRANT/REVOKE statements legitimately contain the words INSERT, UPDATE and DELETE as
  // privilege names, so they must be removed before looking for actual DML.
  const body = SQL
    .replace(/^\s*--.*$/gm, '')
    .replace(/\b(GRANT|REVOKE)\b[\s\S]*?;/gi, '');
  // Match DML SHAPES, not bare keywords: `BEFORE UPDATE ON <table>` is a trigger definition,
  // not a write. `UPDATE <table> SET` is unambiguously a write.
  const DML = [
    ['INSERT', /\bINSERT\s+INTO\s+\w/i],
    ['UPDATE', /\bUPDATE\s+[\w."]+\s+SET\b/i],
    ['DELETE', /\bDELETE\s+FROM\s+\w/i],
  ];
  for (const [name, re] of DML)
    assert.ok(!re.test(body), `PR1 must not perform ${name} — no backfill`);
});

test('the tables are created EMPTY — nothing is seeded', async () => {
  const db = await freshDb();
  for (const t of ['user_channel_links', 'channel_link_tokens', 'user_channel_state']) {
    const r = await db.query(`SELECT count(*)::int AS n FROM ${t}`);
    assert.strictEqual(r.rows[0].n, 0, `${t} was seeded`);
  }
});

test('043 telegram_user_state is untouched by this migration', async () => {
  // It is live in production and PR3 supersedes it. PR1 must not reference it at all.
  assert.ok(!/telegram_user_state/.test(SQL.replace(/^\s*--.*$/gm, '')),
    '045 must not touch the live 043 table');
});

test('no production route file changed for PR1', async () => {
  // Schema only: the resolver is PR2, the connect flow is PR4.
  const server = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  for (const t of ['user_channel_links', 'channel_link_tokens', 'user_channel_state'])
    assert.ok(!server.includes(t), `server/index.js already references ${t} — PR1 is schema only`);
});

// ── access control ──────────────────────────────────────────────────────────
test('the migration revokes PUBLIC and grants only service_role (DDL text)', async () => {
  for (const t of ['user_channel_links', 'channel_link_tokens', 'user_channel_state']) {
    assert.ok(new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM PUBLIC`).test(SQL), `${t} not revoked from PUBLIC`);
    assert.ok(new RegExp(`GRANT[^;]*ON TABLE public\\.${t}\\s+TO service_role`).test(SQL), `${t} not granted to service_role`);
    for (const role of ['anon', 'authenticated'])
      assert.ok(new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM ${role}`).test(SQL), `${t} not revoked from ${role}`);
  }
  assert.ok(/REVOKE ALL ON SEQUENCE public\.user_channel_links_id_seq FROM PUBLIC/.test(SQL));
  assert.ok(/GRANT USAGE, SELECT ON SEQUENCE public\.user_channel_links_id_seq TO service_role/.test(SQL));
});

// ── grant fidelity, with the Supabase roles actually present ────────────────
//
// PGlite is real Postgres, so the three Supabase roles can be created before applying the
// migration — its role-guarded DO block then really executes, and the EFFECTIVE privilege
// can be asserted with has_table_privilege(). That is stronger than reading the DDL: it
// accounts for privileges inherited from PUBLIC, which is exactly the mistake a text
// assertion cannot catch.
//
// The remaining Supabase-specific gap is default privileges and RLS posture configured
// outside this migration; those still warrant a check on a real Supabase instance.
const TABLES = ['user_channel_links', 'channel_link_tokens', 'user_channel_state'];
const WRITE = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

async function dbWithRoles() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE users (id BIGINT PRIMARY KEY);
    CREATE TABLE businesses (id uuid PRIMARY KEY, type text DEFAULT 'business');`);
  await db.exec(SQL);
  return db;
}

const tablePriv = async (db, role, table, priv) =>
  (await db.query(`SELECT has_table_privilege($1,$2,$3) AS ok`, [role, `public.${table}`, priv])).rows[0].ok;

test('GRANTS: anon has NO privilege on any channel identity table', async () => {
  const db = await dbWithRoles();
  for (const t of TABLES)
    for (const p of WRITE)
      assert.strictEqual(await tablePriv(db, 'anon', t, p), false, `anon can ${p} ${t}`);
});

test('GRANTS: authenticated has NO privilege either', async () => {
  // A browser session must not be able to enumerate which app users own which Telegram
  // accounts, so the logged-in role gets nothing directly.
  const db = await dbWithRoles();
  for (const t of TABLES)
    for (const p of WRITE)
      assert.strictEqual(await tablePriv(db, 'authenticated', t, p), false, `authenticated can ${p} ${t}`);
});

test('GRANTS: PUBLIC holds no privilege, so nothing is inherited', async () => {
  const db = await dbWithRoles();
  for (const t of TABLES)
    for (const p of WRITE)
      assert.strictEqual(await tablePriv(db, 'public', t, p), false, `PUBLIC can ${p} ${t}`);
});

test('GRANTS: service_role has full CRUD on all three tables', async () => {
  const db = await dbWithRoles();
  for (const t of TABLES)
    for (const p of WRITE)
      assert.strictEqual(await tablePriv(db, 'service_role', t, p), true, `service_role cannot ${p} ${t}`);
});

test('GRANTS: the BIGSERIAL sequence is not usable by client roles', async () => {
  // A sequence created by BIGSERIAL is separately privileged; missing this would let a
  // client role burn ids even with no table access.
  const db = await dbWithRoles();
  const seqPriv = async (role, priv) =>
    (await db.query(`SELECT has_sequence_privilege($1,'public.user_channel_links_id_seq',$2) AS ok`,
      [role, priv])).rows[0].ok;
  for (const role of ['anon', 'authenticated', 'public'])
    for (const p of ['USAGE', 'SELECT', 'UPDATE'])
      assert.strictEqual(await seqPriv(role, p), false, `${role} has ${p} on the sequence`);
  for (const p of ['USAGE', 'SELECT'])
    assert.strictEqual(await seqPriv('service_role', p), true, `service_role lacks ${p} on the sequence`);
});

test('GRANTS: role_table_grants lists no client-role rows at all', async () => {
  const db = await dbWithRoles();
  const r = await db.query(`
    SELECT grantee, table_name, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema='public'
       AND table_name = ANY($1)
       AND grantee IN ('anon','authenticated','PUBLIC')
     ORDER BY table_name, grantee`, [TABLES]);
  assert.deepStrictEqual(r.rows, [], `unexpected client-role grants: ${JSON.stringify(r.rows)}`);
});

test('GRANTS: applying the migration twice does not widen privileges', async () => {
  // Idempotency must hold for access control too, not just DDL.
  const db = await dbWithRoles();
  await db.exec(SQL);
  for (const t of TABLES)
    for (const role of ['anon', 'authenticated', 'public'])
      assert.strictEqual(await tablePriv(db, role, t, 'SELECT'), false, `${role} gained SELECT on ${t}`);
});
