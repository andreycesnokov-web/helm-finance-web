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
const env = { ...process.env, BALANCE_PG_URL: url, HF_REQUIRE_FULL_CHECKS: '1', HF_EMBEDDED_SQL: '0' };
const jobs = [
  ['integrated-sql', ['--test', 'tests/integration/postgresImportBalanceIntegration.test.js']],
  ['integrated-http', ['--test', 'tests/integration/postgresImportBalanceHttp.test.js']],
  ['balance-original', ['--test', 'tests/integration/postgresBusinessBalance.test.js']],
  ['import-original', ['--test', '--test-concurrency=1', 'tests/integration/postgresBankImportAtomicConfirm.test.js', 'tests/integration/postgresBankImportConfirmHttp.test.js']],
  ['restrict-original', ['--test', 'tests/integration/postgresUserDeleteRestrict.test.js']],
  ['writer-contracts', ['--test', 'tests/integration/financialWriterContracts.test.js']],
  ['writer-races', ['--test', 'tests/integration/postgresFinancialWriterRaces.test.js']],
  ['client-outcome', ['--test', 'tests/financialApiOutcome.test.mjs']],
  ['v2', ['--test','--test-concurrency=1','tests/integration/v2BankImportScope.test.js','tests/integration/v2CompanyScope.test.js','tests/v2BusinessRequest.test.mjs','tests/integration/v2CompanyProfileHttp.test.js','tests/profileColumns.test.js','tests/design/v2Nav.test.mjs','tests/statementInsights.test.mjs','tests/statementParsers.test.js']],
  // The existing businessIsolation assertions execute in writer-contracts on the
  // disposable full schema. Its standalone env-dependent script used to skip.
  ['financial', ['--test', '--test-concurrency=1', ...['businessResolver', 'debtPatchNullText', 'debtPaymentCurrencyGuard', 'debtPaymentIdempotency', 'debtPaymentReliability', 'personalAccount', 'walletTransfersTask30'].map(n => `tests/integration/${n}.test.js`), 'tests/transactionClass.test.js']],
  ['load', ['tests/integration/importBalanceLoad.cjs', path.join(out, 'load-results.json')]],
];
const summary = [];
(async()=>{
const {Client}=require('pg');
const probe=new Client({connectionString:url,connectionTimeoutMillis:4000});
try { await probe.connect(); await probe.query('SELECT 1'); }
catch(e) {
  fs.writeFileSync(path.join(out,'environment-blocker.json'),JSON.stringify({status:'blocked',code:e.code||null,message:e.message,executed_jobs:0,node:process.version},null,2)+'\n');
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(jobs.map(([name])=>({name,status:'not_run_environment_blocked',pass:null,fail:null,skip:null})),null,2)+'\n');
  process.exitCode=1; return;
} finally { await probe.end().catch(()=>{}); }
for (const [name, args] of jobs) {
  const loadPath = path.join(out, 'load-results.json');
  if (name === 'load' && fs.existsSync(loadPath)) fs.unlinkSync(loadPath);
  const actualArgs=args.includes('--test')?[args[0],'--test-reporter=tap',...args.slice(1)]:args;
  const r = spawnSync(process.execPath, actualArgs, { cwd: root, env, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(path.join(out, `${name}.log`), log);
  const complete = name === 'load' ? fs.existsSync(loadPath) : /# tests \d+/.test(log) && /# skipped 0/.test(log) && /# cancelled 0/.test(log) && !/\[SKIP\]|\bSKIP(?:PED)?\s*[—-]|isolation SKIPPED/i.test(log);
  let loadHealthy = null;
  if (name === 'load' && complete) {
    const trials = JSON.parse(fs.readFileSync(loadPath, 'utf8')).results.filter(x => x.concurrency);
    loadHealthy = trials.length === 20 && trials.every(x => x.attempts === x.succeeded && Object.keys(x.errors).length === 0 && x.correctness?.ok === true);
  }
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(k=>[k,log.match(new RegExp('# '+k+' (\\d+)'))?.[1]||null]));
  const item = { name, command:[process.execPath,...actualArgs], exitCode: r.status, complete, counts, loadHealthy, error: r.error?.message || null };
  summary.push(item); console.log(item);
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
// An unavailable DB or hidden skip is never release-green.
process.exitCode = summary.some(r => r.exitCode !== 0 || !r.complete || r.loadHealthy === false) ? 1 : 0;
})().catch(e=>{console.error(e);process.exitCode=1});
