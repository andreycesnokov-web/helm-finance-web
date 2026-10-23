'use strict';
// Tests that write to PostgreSQL refuse shared clusters (staging, production) instead of skipping.
const test = require('node:test');
const assert = require('node:assert');
const G = require('./integration/_disposableDbGuard');

const clientFor = (id, database = 'testdb') => ({ query: async () => ({ rows: [{ id, database }] }) });
const STAGING = '7695399891598073890';
const PRODUCTION = '7642734024280108049';

test('refuses the shared staging and the production cluster by identity, even on 127.0.0.1', async () => {
  await assert.rejects(G.assertDisposableDatabase(clientFor(STAGING)), (e) => e instanceof G.UnsafeTestDatabase && /staging/.test(e.message));
  await assert.rejects(G.assertDisposableDatabase(clientFor(PRODUCTION)), (e) => e instanceof G.UnsafeTestDatabase && /production/.test(e.message));
});

test('refuses when the cluster identity cannot be read or is empty (fail closed)', async () => {
  const denied = { query: async () => { throw new Error('permission denied for function pg_control_system'); } };
  await assert.rejects(G.assertDisposableDatabase(denied), G.UnsafeTestDatabase);
  await assert.rejects(G.assertDisposableDatabase({ query: async () => ({ rows: [] }) }), G.UnsafeTestDatabase);
});

test('extra shared clusters can be declared with CFO_SHARED_PG_SYSTEM_IDS', async () => {
  const env = { CFO_SHARED_PG_SYSTEM_IDS: ' 111 , 222 ' };
  await assert.rejects(G.assertDisposableDatabase(clientFor('222'), { env }), G.UnsafeTestDatabase);
  assert.deepStrictEqual(await G.assertDisposableDatabase(clientFor('333'), { env }), { id: '333', database: 'testdb' });
});

test('a throwaway local cluster passes', async () => {
  assert.strictEqual((await G.assertDisposableDatabase(clientFor('7000000000000000001'))).id, '7000000000000000001');
});

test('URL: only loopback PostgreSQL; never the Supabase application database for direct writers', () => {
  const bad = [
    'postgresql://u:p@db.example.supabase.co:5432/postgres',
    'postgresql://u:p@114.29.239.192:5432/testdb',
    'postgresql://u:p@localhost:5432/postgres',
    'postgresql://u:p@127.0.0.1:54422/',
    'mysql://u:p@localhost/testdb',
    'not a url',
  ];
  for (const url of bad) assert.throws(() => G.assertDisposableUrl(url), G.UnsafeTestDatabase, url);
  assert.deepStrictEqual(G.assertDisposableUrl('postgresql://u:p@localhost:5432/testdb'), { host: 'localhost', database: 'testdb' });
  assert.deepStrictEqual(G.assertDisposableUrl('postgres://u:p@[::1]:5432/ci_db'), { host: '[::1]', database: 'ci_db' });
});

test('URL: a create-a-fresh-database helper may name the maintenance database, still loopback only', () => {
  assert.deepStrictEqual(G.assertDisposableUrl('postgresql://u:p@127.0.0.1:54422/postgres', { adminOnly: true }), { host: '127.0.0.1', database: 'postgres' });
  assert.throws(() => G.assertDisposableUrl('postgresql://u:p@10.0.0.5:5432/postgres', { adminOnly: true }), G.UnsafeTestDatabase);
});

test('every integration test that writes into its DATABASE_URL database calls the guard', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, 'integration');
  const writers = ['postgresBankImportBatchDocumentLinking.test.js', 'postgresIndependentConnections.test.js',
    'postgresBankImportBatchHttpApi.test.js', 'postgresBankReconciliationFlow.test.js', '_prodSchemaDb.js'];
  // A test may guard directly, or get its database only from the shared helper that guards before
  // CREATE DATABASE (_prodSchemaDb.createProdSchemaDatabase, reached via _d4Harness.createD4Database).
  const viaHelper = (s) => /\bcreateD4Database\(|\bcreateProdSchemaDatabase\(/.test(s) && !/new (?:pg\.)?Client\(\s*\{\s*connectionString:\s*process\.env\.DATABASE_URL/.test(s);
  for (const f of writers) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    if (viaHelper(s)) continue;
    assert.match(s, /assertDisposableUrl\(/, f);
    assert.match(s, /assertDisposableDatabase\(/, f);
  }
  const helper = fs.readFileSync(path.join(dir, '_prodSchemaDb.js'), 'utf8');
  assert.ok(helper.indexOf('assertDisposableDatabase(') > 0 && helper.indexOf('assertDisposableDatabase(') < helper.indexOf('CREATE DATABASE'), 'helper guards before CREATE DATABASE');
  assert.match(fs.readFileSync(path.join(dir, '_d4Harness.js'), 'utf8'), /return createProdSchemaDatabase\(/);
});
