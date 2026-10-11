// 057_mcp_oauth.sql — DDL validity, constraint behaviour and idempotency over PGlite.
// Role GRANT/REVOKE is role-guarded (no-op in PGlite), as with 042/045.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '../../migrations/057_mcp_oauth.sql'), 'utf8');
const USER = -1;
const OTHER = -3;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id BIGINT PRIMARY KEY); INSERT INTO users VALUES (${USER}), (${OTHER});`);
  await db.exec(SQL);
  await db.exec(`INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
                 VALUES ('c1', 'Claude', ARRAY['https://claude.ai/api/mcp/auth_callback']);`);
  return db;
}
const fails = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const count = async (db, sql) => Number((await db.query(sql)).rows[0].n);

test('057 applies cleanly and is idempotent', async () => {
  const db = await freshDb();
  assert.strictEqual(await fails(db, SQL), null);
  for (const t of ['mcp_oauth_clients', 'mcp_oauth_requests', 'mcp_oauth_codes', 'mcp_oauth_tokens']) {
    assert.strictEqual(await count(db, `SELECT count(*)::int n FROM information_schema.tables WHERE table_name='${t}'`), 1, t);
  }
});

test('no column can hold a client secret or a plaintext code/token', async () => {
  const db = await freshDb();
  const cols = (await db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name LIKE 'mcp_oauth_%'`)).rows.map((r) => `${r.table_name}.${r.column_name}`);
  assert.ok(!cols.some((c) => /secret/.test(c)), cols.join(','));
  assert.ok(cols.includes('mcp_oauth_codes.code_hash') && !cols.includes('mcp_oauth_codes.code'));
  assert.ok(cols.includes('mcp_oauth_tokens.token_hash') && !cols.includes('mcp_oauth_tokens.token'));
});

test('constraints: redirect list non-empty, token kind and decision closed sets', async () => {
  const db = await freshDb();
  assert.ok(await fails(db, `INSERT INTO mcp_oauth_clients (client_id, redirect_uris) VALUES ('c2', ARRAY[]::text[]);`));
  assert.ok(await fails(db, `INSERT INTO mcp_oauth_tokens (token_hash, kind, grant_id, client_id, user_id, expires_at)
    VALUES ('h', 'id_token', gen_random_uuid(), 'c1', ${USER}, now());`));
  assert.ok(await fails(db, `INSERT INTO mcp_oauth_requests (id, client_id, redirect_uri, code_challenge, expires_at, decision)
    VALUES ('r', 'c1', 'https://claude.ai/x', 'ch', now(), 'maybe');`));
  assert.ok(await fails(db, `INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
    VALUES ('k', 'c1', 999, 'https://claude.ai/x', 'ch', now());`), 'a code for a non-existent user was accepted');
});

test('deleting a CFO user deletes their codes and tokens; deleting a client deletes its grants', async () => {
  const db = await freshDb();
  await db.exec(`
    INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
      VALUES ('k1', 'c1', ${USER}, 'https://claude.ai/x', 'ch', now() + interval '5 min'),
             ('k2', 'c1', ${OTHER}, 'https://claude.ai/x', 'ch', now() + interval '5 min');
    INSERT INTO mcp_oauth_tokens (token_hash, kind, grant_id, client_id, user_id, expires_at)
      VALUES ('t1', 'access', gen_random_uuid(), 'c1', ${USER}, now() + interval '1 hour'),
             ('t2', 'access', gen_random_uuid(), 'c1', ${OTHER}, now() + interval '1 hour');`);
  await db.exec(`DELETE FROM users WHERE id = ${USER};`);
  assert.strictEqual(await count(db, `SELECT count(*)::int n FROM mcp_oauth_codes WHERE user_id=${USER}`), 0);
  assert.strictEqual(await count(db, `SELECT count(*)::int n FROM mcp_oauth_tokens WHERE user_id=${USER}`), 0);
  assert.strictEqual(await count(db, `SELECT count(*)::int n FROM mcp_oauth_tokens WHERE user_id=${OTHER}`), 1, 'another user lost tokens');
  await db.exec(`DELETE FROM mcp_oauth_clients WHERE client_id='c1';`);
  assert.strictEqual(await count(db, `SELECT count(*)::int n FROM mcp_oauth_tokens`), 0);
});

test('a decided-by user that is deleted leaves the request but clears the actor', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO mcp_oauth_requests (id, client_id, redirect_uri, code_challenge, expires_at, decided_at, decision, decided_by_user_id)
    VALUES ('r1', 'c1', 'https://claude.ai/x', 'ch', now(), now(), 'approved', ${OTHER});`);
  await db.exec(`DELETE FROM users WHERE id = ${OTHER};`);
  const row = (await db.query(`SELECT decided_by_user_id FROM mcp_oauth_requests WHERE id='r1'`)).rows[0];
  assert.strictEqual(row.decided_by_user_id, null);
});

test('the conditional "use once" update consumes a code exactly once', async () => {
  const db = await freshDb();
  await db.exec(`INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
    VALUES ('k1', 'c1', ${USER}, 'https://claude.ai/x', 'ch', now() + interval '5 min');`);
  const consume = `UPDATE mcp_oauth_codes SET used_at = now()
    WHERE code_hash='k1' AND used_at IS NULL AND expires_at > now() RETURNING code_hash`;
  assert.strictEqual((await db.query(consume)).rows.length, 1);
  assert.strictEqual((await db.query(consume)).rows.length, 0);
});
