// Does the server actually start?
//
// Four integration files boot server/index.js as a child process and wait for
// /api/health. They spawn it with stdio 'ignore', so when the child dies the only thing
// anyone sees is "app did not start" — repeated once per test, with no reason attached.
// That is exactly what happened the first time those tests ran in CI.
//
// This does the same boot with the same minimal environment and keeps the output, so a
// failure to start is reported as a failure to start, with the error that caused it.
//
//   node scripts/boot-smoke.js
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.BOOT_SMOKE_PORT || '3971';
const ROOT = path.join(__dirname, '..');
const DEADLINE_MS = 45000;

// The minimum the server demands, matching what the integration tests pass it. Nothing
// here is a real credential; the server only checks that the variables are present.
const env = {
  ...process.env,
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SECRET_KEY: 'boot-smoke',
  BOT_TOKEN: 'boot:smoke',
  TELEGRAM_WEBHOOK_SECRET: 'boot-smoke',
  JWT_SECRET: 'boot-smoke',
  PORT,
  NODE_ENV: 'production',
};

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env,
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

let exited = null;
child.on('exit', (code, signal) => { exited = { code, signal }; });
child.on('error', (e) => { out += `\nspawn error: ${e.message}`; exited = { code: -1, signal: null }; });

const done = (ok, msg) => {
  try { child.kill(); } catch { /* already gone */ }
  console.log(ok ? `boot-smoke: ${msg}` : `boot-smoke: FAILED — ${msg}`);
  if (!ok) {
    console.log('---- server output ----');
    console.log(out.trim() || '(the process produced no output at all)');
    console.log('-----------------------');
  }
  process.exit(ok ? 0 : 1);
};

(async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < DEADLINE_MS) {
    if (exited) {
      return done(false, `the server exited before becoming ready `
        + `(code ${exited.code}${exited.signal ? `, signal ${exited.signal}` : ''})`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return done(true, `ready on port ${PORT} in ${Date.now() - t0}ms`);
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return done(false, `it never answered /api/health within ${DEADLINE_MS}ms`);
})();
