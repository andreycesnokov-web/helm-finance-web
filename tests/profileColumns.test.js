const test = require('node:test');
const assert = require('node:assert/strict');
const { profileColumns } = require('../server/lib/profileColumns');
function client(missing = [], failure = null) {
  const calls = [];
  return { calls, from(table) { assert.equal(table, 'tax_profiles'); return { select(columns) {
    calls.push(columns); return { limit(n) {
      assert.equal(n, 0);
      const field = columns.split(',').find((c) => missing.includes(c));
      return Promise.resolve({ error: failure || (field ? { message: `Could not find the '${field}' column of 'tax_profiles' in the schema cache`, code: 'PGRST204' } : null) });
    } };
  } }; } };
}
test('two present columns do not imply the rest; precise support on a partial empty schema', async () => {
  const db = client(['employee_count']);
  assert.deepEqual(await profileColumns(db, ['primary_kbli', 'field_verification', 'employee_count']), { supported: ['primary_kbli', 'field_verification'], unsupported: ['employee_count'] });
  assert.equal(db.calls.length, 2);
});
test('all supported fields are probed, success cached without reading rows', async () => {
  const db = client(); const fields = ['kpp', 'nib_issue_date', 'bpjs_registered'];
  assert.deepEqual((await profileColumns(db, fields)).supported, fields);
  await profileColumns(db, fields); assert.equal(db.calls.length, 1);
});
test('old schema reports every missing field; network failure cannot fake an old schema', async () => {
  const fields = ['primary_kbli', 'field_verification'];
  assert.deepEqual((await profileColumns(client(fields), fields)).unsupported, fields);
  const db = client([], { message: 'network unavailable' });
  await assert.rejects(profileColumns(db, fields), /network unavailable/);
  await assert.rejects(profileColumns(db, fields), /network unavailable/);
  assert.equal(db.calls.length, 2, 'failed capability reads are not cached');
});
