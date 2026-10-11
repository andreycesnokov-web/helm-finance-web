// Business targets and alerts (Design v2 P-01 + P-08). Pure validation and shaping.
// Run: node tests/businessTargets.test.js
const assert = require('node:assert');
const T = require('../server/lib/businessTargets');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); } };
console.log('\nBusiness targets');

t('only owner / ceo / admin / cfo may edit', () => {
  for (const r of ['owner', 'ceo', 'admin', 'cfo']) assert.ok(T.canEditTargets(r), r);
  for (const r of ['accountant', 'manager', 'employee', 'auditor', undefined, null, 'OWNER']) assert.ok(!T.canEditTargets(r), String(r));
});

t('runway target: integer 1..730, null/"" clears', () => {
  assert.deepStrictEqual(T.targetsPatchFromBody({ runway_target_days: 90 }).patch, { runway_target_days: 90 });
  assert.deepStrictEqual(T.targetsPatchFromBody({ runway_target_days: '45' }).patch, { runway_target_days: 45 });
  assert.deepStrictEqual(T.targetsPatchFromBody({ runway_target_days: null }).patch, { runway_target_days: null });
  assert.deepStrictEqual(T.targetsPatchFromBody({ runway_target_days: '' }).patch, { runway_target_days: null });
  for (const bad of [0, -1, 731, 12.5, 'abc', true, [], {}]) assert.strictEqual(T.targetsPatchFromBody({ runway_target_days: bad }).error, 'invalid_runway_target_days', JSON.stringify(bad));
});

t('minimum cash: non-negative decimal string, ≤ 2 decimals, kept exact', () => {
  assert.deepStrictEqual(T.targetsPatchFromBody({ min_cash_idr: '25000000.50' }).patch, { min_cash_idr: '25000000.50' });
  assert.deepStrictEqual(T.targetsPatchFromBody({ min_cash_idr: 1000000 }).patch, { min_cash_idr: '1000000' });
  assert.deepStrictEqual(T.targetsPatchFromBody({ min_cash_idr: null }).patch, { min_cash_idr: null });
  for (const bad of [true, {}, '-1', '1.234', '1e9', 'abc', '1,000', ' ', '9999999999999999999']) assert.strictEqual(T.targetsPatchFromBody({ min_cash_idr: bad }).error, 'invalid_min_cash_idr', bad);
});

t('weekly brief: once a week at a time; nothing more frequent is representable', () => {
  assert.deepStrictEqual(T.targetsPatchFromBody({ weekly_brief: { day: 1, hour: 8, minute: 0 } }).patch, { weekly_brief_cron: '0 8 * * 1' });
  assert.deepStrictEqual(T.targetsPatchFromBody({ weekly_brief: { day: 0, hour: 23 } }).patch, { weekly_brief_cron: '0 23 * * 0' });
  assert.deepStrictEqual(T.targetsPatchFromBody({ weekly_brief: null }).patch, { weekly_brief_cron: null });
  for (const bad of ['mon', 5, { day: true, hour: 8 }, { day: 7, hour: 8 }, { day: 1, hour: 24 }, { day: 1, hour: 8, minute: 60 }, { day: 'x', hour: 8 }, { day: 1.5, hour: 8 }])
    assert.strictEqual(T.targetsPatchFromBody({ weekly_brief: bad }).error, 'invalid_weekly_brief', JSON.stringify(bad));
  for (const bad of ['* * * * *', '0 8 * * *', '*/5 8 * * 1', '0 8 * * 1,3', '0 8 1 * 1'])
    assert.strictEqual(T.targetsPatchFromBody({ weekly_brief_cron: bad }).error, 'invalid_weekly_brief', bad);
  assert.deepStrictEqual(T.targetsPatchFromBody({ weekly_brief_cron: '30 7 * * 5' }).patch, { weekly_brief_cron: '30 7 * * 5' });
});

t('the JS pattern matches the SQL CHECK in migration 059', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'migrations', '059_business_targets_alerts.sql'), 'utf8');
  const m = /weekly_brief_cron ~ '([^']+)'/.exec(sql);
  assert.ok(m, 'CHECK found');
  assert.strictEqual(m[1].replace(/\\\\/g, '\\'), T.CRON_RE.source);
});

t('unknown keys are ignored; an empty body yields an empty patch', () => {
  assert.deepStrictEqual(T.targetsPatchFromBody({ name: 'x', business_id: 'other' }).patch, {});
  assert.deepStrictEqual(T.targetsPatchFromBody().patch, {});
});

t('public shape: nulls when unset or before the migration; brief decoded', () => {
  assert.deepStrictEqual(T.publicTargets(null), { runway_target_days: null, min_cash_idr: null, weekly_brief_cron: null, weekly_brief: null, default_runway_target_days: 60 });
  const p = T.publicTargets({ runway_target_days: 90, min_cash_idr: 25000000, weekly_brief_cron: '0 8 * * 1' });
  assert.deepStrictEqual([p.runway_target_days, p.min_cash_idr, p.weekly_brief], [90, '25000000', { day: 1, hour: 8, minute: 0 }]);
});

t('missing-column errors are recognised (Postgres and PostgREST forms)', () => {
  assert.ok(T.isMissingColumn({ code: '42703' }));
  assert.ok(T.isMissingColumn({ code: 'PGRST204' }));
  assert.ok(T.isMissingColumn({ message: "Could not find the 'runway_target_days' column of 'businesses' in the schema cache" }));
  assert.ok(!T.isMissingColumn({ message: 'permission denied' }));
  assert.ok(!T.isMissingColumn(null));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
