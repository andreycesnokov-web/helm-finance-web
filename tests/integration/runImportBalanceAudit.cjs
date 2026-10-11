'use strict';
// Run only against a disposable loopback PostgreSQL admin instance.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw Error('DATABASE_URL must name a disposable local PostgreSQL admin instance');
}
const out = path.resolve(process.argv[2] || path.join(root, 'audit-results'));
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env, BALANCE_PG_URL: url };
const jobs = [
  ['integrated-sql', ['--test', 'tests/integration/postgresImportBalanceIntegration.test.js']],
  ['integrated-http', ['--test', 'tests/integration/postgresImportBalanceHttp.test.js']],
  ['balance-original', ['--test', 'tests/integration/postgresBusinessBalance.test.js']],
  ['import-original', ['--test', '--test-concurrency=1', 'tests/integration/postgresBankImportAtomicConfirm.test.js', 'tests/integration/postgresBankImportConfirmHttp.test.js']],
  ['restrict-original', ['--test', 'tests/integration/postgresUserDeleteRestrict.test.js']],
  ['financial', ['--test', '--test-concurrency=1', ...['businessIsolation', 'businessResolver', 'debtPatchNullText', 'debtPaymentCurrencyGuard', 'debtPaymentIdempotency', 'debtPaymentReliability', 'personalAccount', 'walletTransfersTask30'].map(n => `tests/integration/${n}.test.js`), 'tests/transactionClass.test.js']],
  ['load', ['tests/integration/importBalanceLoad.cjs', path.join(out, 'load-results.json')]],
];
const summary = [];
for (const [name, args] of jobs) {
  const loadPath = path.join(out, 'load-results.json');
  if (name === 'load' && fs.existsSync(loadPath)) fs.unlinkSync(loadPath);
  const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(path.join(out, `${name}.log`), log);
  const complete = name === 'load' ? fs.existsSync(loadPath) : /# tests \d+/.test(log) && /# skipped 0/.test(log) && /# cancelled 0/.test(log);
  let loadHealthy = null;
  if (name === 'load' && complete) {
    const trials = JSON.parse(fs.readFileSync(loadPath, 'utf8')).results.filter(x => x.concurrency);
    loadHealthy = trials.length === 12 && trials.every(x => x.attempts === x.succeeded && Object.keys(x.errors).length === 0);
  }
  const item = { name, exitCode: r.status, complete, loadHealthy, error: r.error?.message || null };
  summary.push(item); console.log(item);
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
// The known currency suite remains red. Never treat expected failure as release-green.
process.exitCode = summary.some(r => r.exitCode !== 0 || !r.complete || r.loadHealthy === false) ? 1 : 0;
