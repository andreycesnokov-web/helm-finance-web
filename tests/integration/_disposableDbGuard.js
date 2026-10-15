'use strict';
// Fail-closed guard for tests that write to PostgreSQL.
//
// A loopback host is NOT enough: on the staging VPS (or through an SSH tunnel) the shared staging
// database is also 127.0.0.1, and that is how hundreds of test companies ended up in it. So the
// guard checks WHICH cluster it reached (pg_control_system().system_identifier) and refuses the
// known shared clusters, refuses the Supabase application database "postgres" for tests that write
// into the database they are given, and refuses non-loopback hosts. Any doubt -- including not
// being allowed to read the identifier -- is a refusal, never a skip.
//
// Extra shared clusters can be listed in CFO_SHARED_PG_SYSTEM_IDS (comma-separated identifiers).

const KNOWN_SHARED_CLUSTERS = Object.freeze({
  '7695399891598073890': 'the shared Kamatera staging cluster (cfo-os-staging-20261011)',
  '7642734024280108049': 'the production Supabase database',
});
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// On Supabase stacks the application data lives in "postgres"; a test that writes into the
// database it is handed must be given a throwaway one (CI uses "testdb").
const APPLICATION_DATABASES = new Set(['postgres']);

class UnsafeTestDatabase extends Error {
  constructor(reason) {
    super(`Refusing to run against this PostgreSQL: ${reason}. Tests that write data need a disposable local database.`);
    this.name = 'UnsafeTestDatabase';
  }
}

function sharedClusters(env = process.env) {
  const extra = String(env.CFO_SHARED_PG_SYSTEM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return { ...KNOWN_SHARED_CLUSTERS, ...Object.fromEntries(extra.map(id => [id, 'a cluster listed in CFO_SHARED_PG_SYSTEM_IDS'])) };
}

// Before connecting. adminOnly: the URL is only used to CREATE a fresh database (the test then
// writes into that one), so naming the "postgres" maintenance database is fine.
function assertDisposableUrl(connectionString, { adminOnly = false } = {}) {
  let url;
  try { url = new URL(connectionString); } catch { throw new UnsafeTestDatabase('the connection string is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new UnsafeTestDatabase(`protocol ${url.protocol} is not PostgreSQL`);
  if (!LOOPBACK.has(url.hostname)) throw new UnsafeTestDatabase(`host ${url.hostname} is not loopback`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';
  if (!adminOnly && APPLICATION_DATABASES.has(database)) {
    throw new UnsafeTestDatabase(`database "${database}" is where a Supabase stack keeps application data`);
  }
  return { host: url.hostname, database };
}

// After connecting: which cluster is this?
async function assertDisposableDatabase(client, { env = process.env } = {}) {
  let row;
  try {
    ({ rows: [row] } = await client.query('SELECT system_identifier::text AS id, current_database() AS database FROM pg_control_system()'));
  } catch (e) {
    throw new UnsafeTestDatabase(`could not read the cluster identity (${e.message})`);
  }
  if (!row || !row.id) throw new UnsafeTestDatabase('the cluster identity is empty');
  const shared = sharedClusters(env)[row.id];
  if (shared) throw new UnsafeTestDatabase(`connected to ${shared} (system_identifier ${row.id})`);
  return row;
}

module.exports = { assertDisposableUrl, assertDisposableDatabase, UnsafeTestDatabase, KNOWN_SHARED_CLUSTERS };
