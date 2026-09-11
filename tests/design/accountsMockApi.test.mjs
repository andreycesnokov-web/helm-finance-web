// Accounts, driven for real against a mock API.
//
// A dependency array is not evidence. These scenarios are about ORDER and about
// what is on screen at a given instant — a response arriving from a company the
// user has already left, a list that must not carry over during a switch, a form
// whose typed values must survive a failed save. Each is reproduced by running
// the actual component and settling each request by hand.
//
// The harness (harness/accountsHarness.jsx) imports the production Accounts
// unmodified and is built into a throwaway directory; it never enters the app
// bundle. Only window.fetch is replaced.
//
// Run: node tests/design/accountsMockApi.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT = path.join(ROOT, 'client');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
if (!CHROME) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(1); }

/* ── build the harness into a temp dir ─────────────────────────────────────
   A separate Vite build with its own entry and its own outDir. The app's own
   build is untouched, and nothing here can be shipped. */
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-harness-'));
console.log('\nbuilding the Accounts harness (production component, mock fetch)');
const build = spawnSync(process.execPath, [
  path.join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
  '--config', path.join(ROOT, 'tests', 'design', 'harness', 'vite.harness.config.mjs'),
  '--outDir', OUT, '--emptyOutDir',
], { cwd: CLIENT, encoding: 'utf8' });
assert.strictEqual(build.status, 0,
  'harness build failed:\n' + (build.stderr || build.stdout || '').slice(-2500));

/* ── serve it ──────────────────────────────────────────────────────────────── */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.resolve(path.join(OUT, url));
  if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
  // No SPA fallback: this is a library build with no index.html, and a fallback
  // would answer 200 to a missing asset and hide a broken scenario page.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/html' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ── run one scripted scenario in the page and get its log back ────────────── */
const run = async (script, ms = 20000) => {
  const name = `__run-${Math.random().toString(36).slice(2)}.html`;
  fs.writeFileSync(path.join(OUT, name), `<!doctype html><meta charset="utf-8">
<body><div id="root"></div>
<!-- A CLASSIC script, deliberately first. Module scripts are deferred, so
     anything read at MODULE SCOPE by the bundle — i18n/index.js reads
     localStorage 'hf_lang' there, useAuth reads 'hf_token' — is read before a
     deferred inline script could set it. That is why the summary rendered in
     Russian while the scenario set the language. -->
<script>${PRELUDE}</script>
<script type="module" src="/harness.js"></script>
<script type="module">
  const out = [];
  const step = (label, data) => out.push({ label, data });
  window.__step = step;
  const emit = () => document.body.insertAdjacentHTML('beforeend',
    '<pre id="log">__LOG__' + btoa(unescape(encodeURIComponent(JSON.stringify(out)))) + '__END__</pre>');
  (async () => {
    try {
      // Wait for the harness module to attach its globals.
      for (let i = 0; i < 100 && !window.__boot; i++) await new Promise((r) => setTimeout(r, 20));
      ${script}
    } catch (e) { step('THREW', String(e && e.message || e)); }
    emit();
  })();
</script></body>`);
  try {
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--no-first-run', `--virtual-time-budget=${ms}`, '--dump-dom', `${origin}/${name}`]);
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      const kill = setTimeout(() => { child.kill(); reject(new Error('chrome timed out')); },
        process.env.NODE_TEST_CONTEXT ? 300000 : 90000);
      child.on('error', reject);
      child.on('close', () => { clearTimeout(kill); resolve({ stdout: out, stderr: err }); });
    });
    const m = stdout.match(/__LOG__([A-Za-z0-9+/=]+)__END__/);
    assert.ok(m, 'scenario produced no log. chrome stderr: ' + stderr.slice(-600));
    return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } finally { fs.unlinkSync(path.join(OUT, name)); }
};

/* ── fixtures ──────────────────────────────────────────────────────────────
   Two companies with obviously different wallets, so a row from the wrong one is
   unmistakable. Invented names, invented figures. */
const TOKEN = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Test' })).toString('base64') + '.y';
const WS = {
  personal: [],
  business: [
    { id: 'biz-A', name: 'Company A', type: 'business', role: 'owner', is_default: true },
    { id: 'biz-B', name: 'Company B', type: 'business', role: 'owner' },
  ],
};
const WALLETS_A = [
  { id: 'a1', name: 'A · BCA Operating', currency: 'IDR', type: 'bank', scope: 'business', balance: 94200000 },
  { id: 'a2', name: 'A · Cash box', currency: 'IDR', type: 'cash', scope: 'business', balance: 5800000 },
];
const WALLETS_B = [
  { id: 'b1', name: 'B · Mandiri Payroll', currency: 'IDR', type: 'bank', scope: 'business', balance: 12000000 },
];
const BASE_ROUTES = {
  'GET /api/pulse': { accounts: [] },
  'GET /api/pulse?scope=all': { accounts: [] },
  'GET /api/workspaces': WS,
  'GET /api/access/status': { business: { id: 'biz-A' }, membership: { role: 'owner' }, plan: {}, limits: {}, usage: {} },
  'GET /api/admin/status': { is_admin: false },
  'PATCH /api/workspace-preferences': { ok: true },
};
// Read at module scope by the bundle, so it must be in place before the module
// scripts run. getLang() otherwise defaults to 'ru' and the summary renders
// "1 кошелёк" — correct behaviour that an English assertion would fail on.
const PRELUDE = `
  localStorage.setItem('hf_lang', 'en');
  localStorage.setItem('hf_token', ${JSON.stringify(TOKEN)});
  localStorage.setItem('activeBusinessId', 'biz-A');
  localStorage.setItem('activeWorkspaceId', 'biz-A');
`;

// Routes are assigned AFTER the harness module, which initialises __routes itself.
const setup = (extra = {}) => `
  window.__routes = Object.assign(${JSON.stringify(BASE_ROUTES)}, ${JSON.stringify(extra)});
`;

/* ══ SCENARIO 1 — the out-of-order workspace switch ══════════════════════════
   A is slow. The user switches to B. B answers first, then A. A's late answer
   must not replace B's list, balances or total — and while B is loading, A's
   rows must not be sitting on screen under B's name. */
console.log('\nAccounts — switching company while a request is in flight');

const SW = await run(`
  ${setup()}
  // Hold every wallet request so the test decides the order.
  window.__hold = ['/api/wallets'];
  window.__routes['GET /api/wallets'] = (rec) =>
    ({ wallets: rec.businessId === 'biz-B' ? ${JSON.stringify(WALLETS_B)} : ${JSON.stringify(WALLETS_A)} });
  window.__boot();
  await window.__tick(400);
  step('A in flight', { view: window.__view(), held: window.__heldIds() });

  // The user switches to B while A is still outstanding.
  await window.__switchTo('biz-B');
  await window.__tick(250);
  step('switched, B in flight', { view: window.__view(), active: window.__activeId(), held: window.__heldIds() });

  // B answers FIRST.
  window.__settleAll('biz-B');
  await window.__tick(300);
  step('B settled', { view: window.__view() });

  // A's stale response arrives LAST.
  window.__settleAll('biz-A');
  await window.__tick(400);
  step('A settled late', { view: window.__view(), active: window.__activeId() });
`);

const stepOf = (log, label) => (log.find((s) => s.label === label) || {}).data;
for (const l of [SW]) {
  const threw = l.find((s) => s.label === 'THREW');
  if (threw) console.log('  !! scenario threw: ' + JSON.stringify(threw.data));
  if (!l.length) console.log('  !! scenario produced no steps at all');
}
if (process.env.DEBUG_HARNESS) console.log(JSON.stringify(SW, null, 1).slice(0, 3000));

t('company A\'s wallets load when A is active', () => {
  const held = stepOf(SW, 'A in flight').held;
  assert.ok(held.some((h) => h.businessId === 'biz-A'),
    `no wallet request for company A: ${JSON.stringify(held)}`);
});

t('switching to B issues a NEW request for B', () => {
  // The whole point of keying the fetch on the active workspace. Before the fix
  // this request was never made and A's list simply stayed on screen.
  const held = stepOf(SW, 'switched, B in flight').held;
  assert.ok(held.some((h) => h.businessId === 'biz-B'),
    `switching to B issued no wallet request: ${JSON.stringify(held)}`);
  assert.strictEqual(stepOf(SW, 'switched, B in flight').active, 'biz-B');
});

t('while B loads, company A\'s wallets are NOT on screen', () => {
  // The failure this prevents: A's rows and A's total sitting under B's name,
  // indistinguishable from B's own data.
  const v = stepOf(SW, 'switched, B in flight').view;
  assert.deepStrictEqual(v.names, [],
    `company A's wallets are still listed while B loads: ${v.names.join(', ')}`);
  assert.ok(v.loading, 'the page does not say it is loading during the switch');
});

t('B\'s response paints B', () => {
  const v = stepOf(SW, 'B settled').view;
  assert.deepStrictEqual(v.names, ['B · Mandiri Payroll'],
    `after B settled the list reads: ${v.names.join(', ')}`);
  assert.match(v.meta || '', /1 wallet/, `B's summary reads "${v.meta}"`);
});

t('A\'s LATE response does not replace B\'s list', () => {
  // The data-isolation case. A answered last; its rows must be discarded.
  const v = stepOf(SW, 'A settled late').view;
  assert.deepStrictEqual(v.names, ['B · Mandiri Payroll'],
    `company A's late response overwrote B's list: ${v.names.join(', ')}`);
  assert.ok(!v.names.some((n) => n.startsWith('A · ')),
    'a wallet from company A is on screen while company B is active');
});

t('A\'s LATE response does not replace B\'s balance or total', () => {
  const v = stepOf(SW, 'A settled late').view;
  assert.match(v.total || '', /Rp 12/, `the total reads "${v.total}" — that is company A's figure`);
  assert.match(v.meta || '', /1 wallet/, `the summary reads "${v.meta}"`);
  assert.strictEqual(v.rows[0].balance, 'Rp 12 000 000',
    `the row balance reads "${v.rows[0].balance}"`);
  assert.ok(!v.loading, 'the page is still showing a loading state after settling');
});

/* ══ SCENARIO 2 — B fails to load ═══════════════════════════════════════════ */
console.log('\nAccounts — company B fails to load');

const ERR = await run(`
  ${setup()}
  window.__hold = ['/api/wallets'];
  window.__routes['GET /api/wallets'] = () => ({ wallets: ${JSON.stringify(WALLETS_A)} });
  window.__boot();
  await window.__tick(400);
  window.__settleAll('biz-A');
  await window.__tick(300);
  step('A loaded', { view: window.__view() });

  await window.__switchTo('biz-B');
  await window.__tick(250);
  // The moment that matters: A's wallets ARE loaded and on screen, the user has
  // switched, and B has not answered yet.
  step('switched, A was on screen', { view: window.__view() });
  window.__settleAll('biz-B', { __status: 500, error: 'boom' });
  await window.__tick(400);
  step('B failed', { view: window.__view() });
`);

t('a loaded company A vanishes the instant the user switches away', () => {
  // The case scenario 1 cannot cover: there, A never settled, so there was
  // nothing on screen to carry over. Here A is fully loaded first.
  const before = stepOf(ERR, 'A loaded').view;
  assert.deepStrictEqual(before.names, ['A · BCA Operating', 'A · Cash box'],
    `company A did not load: ${before.names.join(', ')}`);
  const during = stepOf(ERR, 'switched, A was on screen').view;
  assert.deepStrictEqual(during.names, [],
    `company A's wallets are on screen under company B: ${during.names.join(', ')}`);
  assert.strictEqual(during.summaryShown, false,
    `company A's total is on screen under company B, reading "${during.total}"`);
  assert.ok(during.loading, 'the page does not say it is loading during the switch');
});

t('a failed load for B shows the error state', () => {
  const v = stepOf(ERR, 'B failed').view;
  assert.ok(v.errorState, 'a failed load does not show the shared error state');
});

t('a failed load for B does NOT fall back to company A\'s wallets', () => {
  // The worst version of this bug: B's request fails and the page keeps showing
  // A's money as though it were B's.
  const v = stepOf(ERR, 'B failed').view;
  assert.deepStrictEqual(v.names, [],
    `company A's wallets survived company B's failed load: ${v.names.join(', ')}`);
});

t('a failed load shows no balance at all, rather than a wrong one', () => {
  const v = stepOf(ERR, 'B failed').view;
  assert.strictEqual(v.summaryShown, false,
    `the total-balance card is on screen after a failed load, reading "${v.total}"`);
  assert.strictEqual(v.zeroState, false,
    'a failed load renders the zero state, which claims the company has no wallets');
});

/* ══ SCENARIO 3 — creating a wallet ═════════════════════════════════════════ */
console.log('\nAccounts — creating a wallet');

const ADD = await run(`
  ${setup()}
  window.__routes['GET /api/wallets'] = () => ({ wallets: window.__created ? ${JSON.stringify(WALLETS_A)}.concat([{ id: 'a3', name: 'A · New Wise USD', currency: 'IDR', type: 'bank', scope: 'business', balance: 0 }]) : ${JSON.stringify(WALLETS_A)} });
  window.__routes['POST /api/wallets'] = (rec) => { window.__created = true; return { id: 'a3' }; };
  window.__boot();
  await window.__tick(500);
  step('loaded', { view: window.__view(), calls: window.__calls.length });

  window.__openAdd();
  await window.__tick(120);
  step('form open', { view: window.__view() });

  window.__type('#acct-wallet-name', 'A · New Wise USD');
  window.__type('#acct-wallet-opening', '250000');
  await window.__tick(120);
  step('typed', { view: window.__view() });

  window.__save();
  await window.__tick(600);
  const post = window.__calls.filter((c) => c.key === 'POST /api/wallets');
  step('saved', { view: window.__view(), post, reloads: window.__calls.filter((c) => c.path.includes('/api/wallets') && c.method === 'GET').length });
`);

t('the add form opens with an empty name and a disabled save', () => {
  const v = stepOf(ADD, 'form open').view;
  assert.ok(v.formOpen, 'the add form did not open');
  assert.strictEqual(v.formName, '', `the form opened with name "${v.formName}"`);
  assert.strictEqual(v.saveDisabled, true, 'save is enabled with no name entered');
});

t('typing a name enables save', () => {
  const v = stepOf(ADD, 'typed').view;
  assert.strictEqual(v.formName, 'A · New Wise USD');
  assert.strictEqual(v.saveDisabled, false, 'save is still disabled after a name was entered');
});

t('saving POSTs once, with the values that were typed', () => {
  const post = stepOf(ADD, 'saved').post;
  assert.strictEqual(post.length, 1, `${post.length} POST requests were made, expected 1`);
  const body = post[0].body;
  assert.strictEqual(body.name, 'A · New Wise USD', `the payload name is "${body.name}"`);
  assert.strictEqual(body.opening_balance, 250000,
    `the payload opening_balance is ${JSON.stringify(body.opening_balance)}`);
  assert.strictEqual(body.currency, 'IDR', `the payload currency is "${body.currency}"`);
  // The business page must never create a personal-scoped wallet: the API would
  // accept it when PERSONAL_WORKSPACE_ENABLED is on.
  assert.strictEqual(body.scope, 'business', `the payload scope is "${body.scope}"`);
  // And it goes to the active company.
  assert.strictEqual(post[0].businessId, 'biz-A', `the POST carried business ${post[0].businessId}`);
});

t('a successful save closes the form and the new wallet appears', () => {
  const d = stepOf(ADD, 'saved');
  assert.strictEqual(d.view.formOpen, false, 'the form stayed open after a successful save');
  assert.ok(d.view.names.includes('A · New Wise USD'),
    `the new wallet is not in the list: ${d.view.names.join(', ')}`);
  assert.ok(d.reloads >= 2, `the list was not re-fetched after saving (${d.reloads} GETs)`);
});

/* ══ SCENARIO 4 — a save that fails keeps what was typed ════════════════════ */
console.log('\nAccounts — a failed save, and cancelling');

const FAILSAVE = await run(`
  ${setup()}
  window.__routes['GET /api/wallets'] = () => ({ wallets: ${JSON.stringify(WALLETS_A)} });
  window.__routes['POST /api/wallets'] = () => ({ __status: 400, error: 'wallet limit reached' });
  // handleSave reports failure through alert(); swallow it so the run continues.
  window.alert = (m) => { window.__alert = String(m); };
  window.__boot();
  await window.__tick(500);
  window.__openAdd();
  await window.__tick(120);
  window.__type('#acct-wallet-name', 'Half-typed wallet');
  window.__type('#acct-wallet-opening', '999');
  await window.__tick(120);
  window.__save();
  await window.__tick(500);
  step('save failed', { view: window.__view(), alert: window.__alert || null,
    posts: window.__calls.filter((c) => c.key === 'POST /api/wallets').length });
`);

t('a failed save keeps the form open with the values still in it', () => {
  const d = stepOf(FAILSAVE, 'save failed');
  assert.ok(d.view.formOpen, 'the form closed on a failed save, losing what was typed');
  assert.strictEqual(d.view.formName, 'Half-typed wallet',
    `the name field now reads "${d.view.formName}"`);
  assert.strictEqual(d.view.formOpening, '999',
    `the opening balance now reads "${d.view.formOpening}"`);
});

t('a failed save reports the reason and does not retry by itself', () => {
  const d = stepOf(FAILSAVE, 'save failed');
  assert.match(d.alert || '', /limit/i, `the failure was reported as "${d.alert}"`);
  assert.strictEqual(d.posts, 1, `${d.posts} POSTs were made for one save`);
});

t('a failed save does not add a wallet to the list', () => {
  const d = stepOf(FAILSAVE, 'save failed');
  assert.ok(!d.view.names.includes('Half-typed wallet'),
    'a wallet that failed to save appeared in the list anyway');
});

/* ══ SCENARIO 5 — cancel writes nothing ═════════════════════════════════════ */
const CANCEL = await run(`
  ${setup()}
  window.__routes['GET /api/wallets'] = () => ({ wallets: ${JSON.stringify(WALLETS_A)} });
  window.__boot();
  await window.__tick(500);
  window.__openAdd();
  await window.__tick(120);
  window.__type('#acct-wallet-name', 'Never saved');
  await window.__tick(100);
  window.__cancel();
  await window.__tick(300);
  step('cancelled', { view: window.__view(),
    writes: window.__calls.filter((c) => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.method) && c.path.includes('/api/wallets')).length,
    allWrites: window.__calls.filter((c) => ['POST', 'PUT', 'DELETE'].includes(c.method)).map((c) => c.key) });
`);

t('cancelling closes the form and writes nothing', () => {
  const d = stepOf(CANCEL, 'cancelled');
  assert.strictEqual(d.view.formOpen, false, 'cancel did not close the form');
  assert.strictEqual(d.writes, 0,
    `cancel issued ${d.writes} wallet write(s): ${d.allWrites.join(', ')}`);
  assert.ok(!d.view.names.includes('Never saved'), 'the cancelled wallet appeared in the list');
});

/* ══ SCENARIO 6 — editing an existing wallet ════════════════════════════════ */
console.log('\nAccounts — editing a wallet');

const EDIT = await run(`
  ${setup()}
  window.__routes['GET /api/wallets'] = () => ({ wallets: window.__renamed
    ? [{ ...${JSON.stringify(WALLETS_A[0])}, name: 'A · BCA Renamed' }, ${JSON.stringify(WALLETS_A[1])}]
    : ${JSON.stringify(WALLETS_A)} });
  window.__routes['PUT /api/wallets/a1'] = () => { window.__renamed = true; return { ok: true }; };
  window.__boot();
  await window.__tick(500);
  window.__openEdit(0);
  await window.__tick(150);
  step('edit open', { view: window.__view() });

  window.__type('#acct-wallet-name', 'A · BCA Renamed');
  await window.__tick(120);
  window.__save();
  await window.__tick(600);
  step('edited', { view: window.__view(),
    put: window.__calls.filter((c) => c.method === 'PUT'),
    posts: window.__calls.filter((c) => c.method === 'POST').length });
`);

t('editing opens the form pre-filled with the wallet', () => {
  const v = stepOf(EDIT, 'edit open').view;
  assert.ok(v.formOpen, 'the edit form did not open');
  assert.strictEqual(v.formName, 'A · BCA Operating',
    `the edit form opened with name "${v.formName}"`);
  // Opening balance is offered for NEW wallets only: editing never rewrites a
  // balance, which is what the audited adjust-balance flow is for.
  assert.strictEqual(v.formOpening, null,
    'the edit form offers an opening balance, which would rewrite a balance');
});

t('saving an edit PUTs to that wallet, and never POSTs a new one', () => {
  const d = stepOf(EDIT, 'edited');
  assert.strictEqual(d.put.length, 1, `${d.put.length} PUT requests, expected 1`);
  assert.strictEqual(d.put[0].path, '/api/wallets/a1',
    `the edit went to ${d.put[0].path}`);
  assert.strictEqual(d.put[0].body.name, 'A · BCA Renamed');
  assert.strictEqual(d.put[0].body.scope, 'business',
    `the edit payload scope is "${d.put[0].body.scope}"`);
  assert.strictEqual(d.posts, 0, 'editing a wallet also created a new one');
});

t('the edited name appears in the list', () => {
  const v = stepOf(EDIT, 'edited').view;
  assert.ok(v.names.includes('A · BCA Renamed'),
    `the list still reads: ${v.names.join(', ')}`);
  assert.strictEqual(v.formOpen, false, 'the form stayed open after a successful edit');
});

server.close();
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
