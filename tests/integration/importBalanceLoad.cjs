'use strict';
// SQL load, never HTTP/AI/Storage. Refuses external DBs and drops its synthetic DB.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { createIntegratedDatabase } = require('./_integratedSchemaDb');
const id = () => crypto.randomUUID();
const readLimit = p => { try { return fs.readFileSync(p,'utf8').trim(); } catch { return null; } };
const quantile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * p) - 1)] : null;
let db, setup, observer;
const results = [];
async function connect() {
  const c = new Client({ connectionString: db.connectionString }); await c.connect();
  await c.query("SET statement_timeout='15s'; SET lock_timeout='10s'"); return c;
}
async function company(scope='business') {
  const f = { biz: id(), wallet: id(), scope, statements: [], patchVersion: 0, expectedBalance: 9999 };
  await setup.query("INSERT INTO businesses(id,name,owner_user_id,type) VALUES($1,'Load synthetic',93001,$2)", [f.biz, scope]);
  await setup.query("INSERT INTO wallets(id,business_id,user_id,name,currency,scope,type) VALUES($1,$2,93001,'Load cash','IDR',$3,'bank')", [f.wallet, f.biz, scope]);
  await setup.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,93001,'income',10000,10000,'IDR',$2,$3,'2026-05-10')", [f.biz, f.wallet, scope]);
  f.patchId = (await setup.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,93001,'expense',1,1,'IDR',$2,$3,'2026-05-10') RETURNING id", [f.biz, f.wallet, scope])).rows[0].id;
  return f;
}
async function statement(f, count = 20) {
  const batch = id();
  await setup.query("INSERT INTO bank_import_batches(id,business_id,wallet_id,uploaded_by_user_id,currency,statement_start,statement_end,status,row_count) VALUES($1,$2,$3,93001,'IDR','2026-05-01','2026-05-31','review_required',$4)", [batch, f.biz, f.wallet, count]);
  const rows = Array.from({ length: count }, (_, i) => ({ id: id(), row_index: i, amount: 1 }));
  await setup.query(`INSERT INTO bank_import_rows(id,batch_id,business_id,row_index,tx_date,amount,direction,review_status,description)
    SELECT r.id,$1,$2,r.row_index,'2026-05-10',r.amount,'out','suggested','Load synthetic' FROM jsonb_to_recordset($3::jsonb) AS r(id uuid,row_index int,amount numeric)`, [batch, f.biz, JSON.stringify(rows)]);
  return { batch, plan: rows.map(r => ({ row_id: r.id, action: 'create', type: 'expense', scope: 'business', expected_amount: 1, expected_date: '2026-05-10', currency: 'IDR', amount_idr: 1, booked_rate: 1, rate_source: 'identity' })) };
}
const confirm = (c, f, s) => c.query("SELECT rpc_confirm_bank_import($1,$2,93001,93001,$3::jsonb,'review') r", [f.biz, s.batch, JSON.stringify(s.plan)]);
const income = (c, f) => c.query("INSERT INTO transactions(business_id,user_id,type,amount_original,amount_idr,currency_original,wallet_id,scope,transaction_date) VALUES($1,93001,'income',1,1,'IDR',$2,$3,'2026-05-10')", [f.biz, f.wallet, f.scope]);
function manual(c,f,type,amount){const row={type,amount_original:amount,amount_idr:amount,currency_original:'IDR',wallet_id:f.wallet,scope:'business',transaction_date:'2026-05-10'};return c.query('SELECT rpc_insert_business_transactions_once($1,93001,$2,$3::jsonb,$4::jsonb)',[f.biz,id(),JSON.stringify(row),JSON.stringify([row])]);}
async function round(concurrency, mode) {
  // Fresh database per trial. The previous XX000 run is invalid; its cause is
  // unproven. Do not infer an FSM/filesystem diagnosis from this methodology.
  await setup.end(); await observer.end(); await db.drop();
  db = await createIntegratedDatabase('cfo_load_trial'); setup = await connect(); observer = await connect();
  await setup.query('INSERT INTO users(id) VALUES(93001)');
  const iterations = mode === 'mixed' ? Math.max(6, Math.ceil(60 / concurrency)) : mode === 'long_import_A' ? 10 : Math.max(30, Math.ceil(120 / concurrency));
  const companies = [], clients = [];
  // One Personal workspace per owner is a real schema constraint. Model this
  // user's shared Personal wallet alongside independent Business workspaces.
  const personal = ['personal_parallel_business','long_import_A'].includes(mode) ? await company('personal') : null;
  for (let i = 0; i < concurrency; i++) {
    const f = await company();
    if (personal) f.personal = personal;
    if (mode === 'mixed') for (let j = 0; j < iterations; j++) f.statements.push(await statement(f));
    companies.push(f); clients.push(await connect());
  }
  let longClient, longPromise, longMs = null, longCompany;
  if (mode === 'long_import_A') {
    const a = await company(), s = await statement(a, 500); longClient = await connect();
    longCompany=a;
    // Deliberate 1ms per ledger row: controlled long-import contention, not a production duration forecast.
    await setup.query(`CREATE OR REPLACE FUNCTION test_slow_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.business_id='${a.biz}'::uuid THEN PERFORM pg_sleep(0.001); END IF; RETURN NULL; END $$`);
    await setup.query('CREATE TRIGGER test_slow_import AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION test_slow_import()');
    const start = performance.now(); longPromise = confirm(longClient, a, s).then(() => { longMs = performance.now() - start; });
    for (let i = 0; i < 1000; i++) {
      if ((await observer.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted) b", [longClient.processID])).rows[0].b) break;
      if (i === 999) throw Error('Long import did not acquire ledger gate');
      await new Promise(r => setTimeout(r, 2));
    }
  }
  const latencies = [], waits = [], errors = {}, error_examples = {},scopeLatencies={business:[],personal:[]},firstGateSamples=[]; let succeeded = 0, maxWaiters = 0, sampling = true;
  const sample = (async () => {
    while (sampling) {
      const n = Number((await observer.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n);
      maxWaiters = Math.max(maxWaiters, n); await new Promise(r => setTimeout(r, 10));
    }
  })();
  const start = performance.now();
  await Promise.all(clients.map(async (c, i) => {
    const f = mode === 'metadata_parallel_money' ? companies[Math.floor(i/2)*2] : companies[i];
    for (let j = 0; j < iterations; j++) {
      const target=(mode==='personal_parallel_business'&&j%2)||(mode==='long_import_A'&&(i+j)%2)?personal:f;
      const t = performance.now();
      try {
        await c.query('BEGIN'); const gate = performance.now();
        await c.query('SELECT fn_ledger_writer_lock()'); const gateMs=performance.now()-gate;waits.push(gateMs);
        if(j===0)firstGateSamples.push({worker:i,scope:target.scope,gate_roundtrip_ms:gateMs});
        if (mode === 'mixed') {
          await confirm(c, f, f.statements[j]);
          await manual(c,f,'expense',1);
          const patched = await c.query('SELECT rpc_patch_business_transaction($1,93001,$2,$3,$4::jsonb,false) r', [f.biz, f.patchId, f.patchVersion, JSON.stringify({ description: `load-${j}` })]);
          f.patchVersion = Number(patched.rows[0].r.balance_version);
        } else if (mode === 'metadata_parallel_money' && i%2===0) {
          await c.query('SELECT rpc_update_business_wallet($1,93001,$2,$3::jsonb)',[f.biz,f.wallet,JSON.stringify({color:`load-${j}`})]);
        } else if(target.scope==='personal')await income(c,target);else await manual(c,target,'income',1);
        await c.query('COMMIT'); succeeded++;
        if(mode==='mixed') f.expectedBalance-=21;
        else if(mode!=='metadata_parallel_money' || i%2!==0) {
          target.expectedBalance++;
        }
      } catch (e) { errors[e.code || e.message] = (errors[e.code || e.message] || 0) + 1; error_examples[e.code || 'unknown'] = e.message; await c.query('ROLLBACK'); }
      const elapsed=performance.now()-t;latencies.push(elapsed);scopeLatencies[target.scope].push(elapsed);
    }
  }));
  const elapsedMs = performance.now() - start;
  if (longPromise) { await longPromise; longCompany.expectedBalance-=500; }
  sampling = false; await sample;
  for (const c of clients) await c.end(); if (longClient) { await longClient.end(); await setup.query('DROP TRIGGER test_slow_import ON transactions'); }
  const finalBalances=[];
  for(const f of [...companies,...(personal?[personal]:[]),...(longCompany?[longCompany]:[])]) {
    const actual=Number((await setup.query('SELECT fn_wallet_ledger_balance($1) b',[f.wallet])).rows[0].b);
    finalBalances.push({business:f.biz,wallet:f.wallet,scope:f.scope,expected:f.expectedBalance,actual,ok:actual===f.expectedBalance});
  }
  const provenance=(await setup.query("SELECT count(*)::int n FROM transactions t JOIN bank_import_rows r ON r.id=t.bank_import_row_id WHERE t.business_id<>r.business_id")).rows[0].n;
  const r = { mode, concurrency, iterations, attempts: latencies.length, succeeded, throughput_ops_s: succeeded / (elapsedMs / 1000), elapsed_ms: elapsedMs,
    dataset:{initial_native_balance:9999,per_mixed_import_rows:20,long_import_rows:500,companies:companies.length,personal_companies:personal?1:0},
    raw_latency_ms:latencies,raw_gate_roundtrip_ms:waits,
    raw_scope_latency_ms:scopeLatencies,first_gate_samples:firstGateSamples,
    method:'Business manual uses reachable keyed RPC; Personal direct-table writer preserves its existing scope. Long A alternates target scopes; at N1 only Business is initially queued under the import. Not numerically comparable with the old raw-manual/B-only long trial.',
    correctness:{final_balances:finalBalances,cross_business_provenance:provenance,ok:finalBalances.every(x=>x.ok)&&provenance===0},
    latency_ms: { p50: quantile(latencies, .5), p95: quantile(latencies, .95), p99: quantile(latencies, .99), max: quantile(latencies, 1) },
    gate_roundtrip_ms: { p50: quantile(waits, .5), p95: quantile(waits, .95), p99: quantile(waits, .99), max: quantile(waits, 1) },
    max_observed_waiters: maxWaiters, timeout_count: (errors['55P03'] || 0) + (errors['57014'] || 0), deadlock_count: errors['40P01'] || 0, errors, error_examples, long_import_ms: longMs };
  results.push(r); console.log(JSON.stringify(r));
}
async function diagnostics() {
  const f = await company(), a = await connect(), b = await connect();
  try {
    await a.query('BEGIN'); await a.query('SELECT fn_ledger_writer_lock()');
    await b.query("SET lock_timeout='100ms'");
    const t = performance.now(); let timeout;
    try { await income(b, f); } catch (e) { timeout = e.code; }
    await a.query('ROLLBACK');
    results.push({ mode: 'controlled_timeout', timeout_code: timeout, elapsed_ms: performance.now() - t });
    await b.query("SET lock_timeout='6s'");
    // Known residual: callers can lock a wallet before joining the ledger protocol.
    await a.query('BEGIN'); await a.query('SELECT id FROM wallets WHERE id=$1 FOR UPDATE', [f.wallet]);
    const pendingB = income(b, f).then(() => ({ ok: true }), error => ({ code: error.code }));
    for (let i = 0; i < 500; i++) {
      if ((await observer.query('SELECT $1=ANY(pg_blocking_pids($2)) b', [a.processID, b.processID])).rows[0].b) break;
      if (i === 499) throw Error('No wallet-before-ledger barrier');
      await new Promise(r => setTimeout(r, 2));
    }
    const rA = await income(a, f).then(() => ({ ok: true }), error => ({ code: error.code }));
    await a.query('ROLLBACK'); const rB = await pendingB;
    results.push({ mode: 'residual_wallet_lock_inversion', results: [rA, rB], deadlock_count: [rA, rB].filter(r => r.code === '40P01').length });
  } finally { await a.query('ROLLBACK').catch(() => {}); await b.query('ROLLBACK').catch(() => {}); await a.end(); await b.end(); }
}
(async () => {
  db = await createIntegratedDatabase('cfo_load'); setup = await connect(); observer = await connect();
  try {
    await setup.query('INSERT INTO users(id) VALUES(93001)');
    const environment = { node: process.version, postgres: (await setup.query('SHOW server_version')).rows[0].server_version, cpu_model: os.cpus()[0].model, visible_cpus: os.cpus().length, cpu_cgroup: readLimit('/sys/fs/cgroup/cpu.max'), memory_cgroup: readLimit('/sys/fs/cgroup/memory.max'), total_memory_bytes: os.totalmem(), platform: os.platform(), arch: os.arch(), notes: 'SQL loopback; explicit gate measurement adds roundtrips; nearest-rank empirical quantiles; no warm production dataset, HTTP, FX, AI or Storage; controlled slow import.' };
    for (const mode of ['independent_writes', 'mixed', 'long_import_A','personal_parallel_business','metadata_parallel_money']) for (const n of [1, 5, 20, 50]) await round(n, mode);
    await diagnostics();
    const output = { environment, results };
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ environment, diagnostics: results.filter(r => r.mode.startsWith('controlled') || r.mode.startsWith('residual')) }));
  } finally { await setup.end(); await observer.end(); await db.drop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
