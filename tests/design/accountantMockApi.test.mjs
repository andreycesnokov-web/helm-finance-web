// The AI Accountant chat, driven for real against a mock API.
//
// These scenarios are about ORDER and about WHOSE company a message belongs to.
// A dependency array cannot answer either: the questions are whether an answer
// that arrives after a company switch lands in the new company's thread, whether
// the thread survives the switch at all, and whether the user ever leaves the
// accounting page to get an answer. Each is reproduced by running the real
// component and settling each request by hand.
//
// The harness (harness/accountantHarness.jsx) imports the production
// BusinessAccountantHub unmodified and is built into a throwaway directory; it
// never enters the app bundle. Only window.fetch is replaced. No provider is
// called, no money is spent, and every figure below is invented.
//
// Run: node tests/design/accountantMockApi.test.mjs
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

/* ── build ─────────────────────────────────────────────────────────────── */
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'acctant-harness-'));
console.log('\nbuilding the AI Accountant harness (production component, mock fetch)');
const build = spawnSync(process.execPath, [
  path.join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
  '--config', path.join(ROOT, 'tests', 'design', 'harness', 'vite.harness.config.mjs'),
  '--outDir', OUT, '--emptyOutDir',
], {
  cwd: CLIENT,
  encoding: 'utf8',
  env: {
    ...process.env,
    HARNESS_ENTRY: 'accountantHarness.jsx',
    // Production has this on, so the harness must too — otherwise the hub
    // renders the legacy profile page and there is no chat to test.
    VITE_AI_ACCOUNTANT_PREMIUM: 'true',
  },
});
assert.strictEqual(build.status, 0,
  'harness build failed:\n' + (build.stderr || build.stdout || '').slice(-2500));

/* ── serve ─────────────────────────────────────────────────────────────── */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.resolve(path.join(OUT, url));
  if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/html' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

/* ── fixtures ──────────────────────────────────────────────────────────── */
const TOKEN = 'x.' + Buffer.from(JSON.stringify({ userId: 1, firstName: 'Test' })).toString('base64') + '.y';
const WS = {
  personal: [],
  business: [
    { id: 'biz-A', name: 'Alpha Trading', type: 'company', role: 'owner' },
    { id: 'biz-B', name: 'Beta Services', type: 'company', role: 'owner' },
  ],
};

// A classic script, deliberately before the deferred module: i18n reads
// localStorage at MODULE scope, so a deferred inline script would run too late
// and the page would render in Russian while the scenario asserts English.
const PRELUDE = `
  localStorage.setItem('hf_lang', 'en');
  localStorage.setItem('hf_token', ${JSON.stringify(TOKEN)});
  localStorage.setItem('activeBusinessId', 'biz-A');
  localStorage.setItem('activeWorkspaceId', 'biz-A');
`;

// The page's own five reads. Only /accountant/ask matters here; the rest exist
// so the page mounts in its normal state rather than an error one.
const BASE_ROUTES = `
  window.__routes['GET /api/workspaces'] = ${JSON.stringify(WS)};
  window.__routes['GET /api/accountant/applicability'] = { applicable_rules: [], missing_profile_fields: [] };
  window.__routes['GET /api/accountant/profile'] = { profile: { jurisdiction: 'ID' } };
  window.__routes['GET /api/pulse'] = { recentTxs: [], receivables: 0, payables: 0 };
  window.__routes['GET /api/accountant/obligations'] = { period: '2026-08', obligations: [], reserve: { amount: 0, lines: [] } };
  window.__routes['GET /api/ai-accountant/required-documents'] = { documents: [] };
  window.__routes['GET /api/audit/events'] = { events: [], total: 0 };
`;

/** An answer payload shaped the way the server returns one. */
const answer = (o = {}) => ({
  answer: 'Your ledger shows two transactions this period.',
  statement_types: ['company_facts'],
  grounded_sources: [],
  sources_for_review: [],
  rejected_source_ids: [],
  missing: [],
  next_step: null,
  data_gaps: [],
  injection_detected: false,
  unfounded_legal_claim: false,
  grounded_rules_available: false,
  disclaimer: 'Advisory only.',
  business_id: 'biz-A',
  provider_error: false,
  usage: { used: null, limit: null, remaining: null, period: '2026-09-01', enforced: false },
  ...o,
});

/* ── run one scripted scenario ─────────────────────────────────────────── */
const run = async (script, ms = 20000) => {
  const name = `__run-${Math.random().toString(36).slice(2)}.html`;
  fs.writeFileSync(path.join(OUT, name), `<!doctype html><meta charset="utf-8">
<body><div id="root"></div>
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
      for (let i = 0; i < 100 && !window.__boot; i++) await new Promise((r) => setTimeout(r, 20));
      ${BASE_ROUTES}
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

const get = (log, label) => (log.find((e) => e.label === label) || {}).data;

/* ══ 1. the answer arrives, and the user never left the page ═════════════ */
console.log('\nthe question is answered where it was asked');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] = ${JSON.stringify(answer({
      missing: ['A payroll run for August'],
      next_step: 'Record August payroll so PPH 21/26 can be computed',
    }))};
    window.__boot(); await window.__tick(400);
    window.__step('before', window.__chat());
    window.__ask('What do our accounts show this month?');
    await window.__tick(500);
    window.__step('after', window.__chat());
    window.__step('asks', window.__asks().map(a => ({ biz: a.businessId, q: a.body.question })));
  `);
  const before = get(log, 'before'), after = get(log, 'after');

  t('the chat is on the AI Accountant page', () => {
    assert.strictEqual(before.present, true, 'no Ask panel rendered');
    assert.strictEqual(before.onAccountantPage, true);
    assert.strictEqual(before.pageTitle, 'Tax & Compliance Workbench');
  });

  t('the AI CFO hand-off is gone', () => {
    assert.strictEqual(before.askCfoButtons, 0, 'an "Ask AI CFO" button is still on the page');
  });

  t('the starting questions are offered', () => {
    assert.strictEqual(before.suggestions.length, 4);
    assert.ok(before.suggestions.some((s) => /calculate our company/i.test(s)), before.suggestions.join(' | '));
    assert.ok(before.suggestions.some((s) => /not calculated yet/i.test(s)));
    assert.ok(before.suggestions.some((s) => /documents/i.test(s)));
    assert.ok(before.suggestions.some((s) => /director paid personally/i.test(s)));
  });

  t('the question and its answer both appear, in order', () => {
    assert.deepStrictEqual(after.userMessages, ['What do our accounts show this month?']);
    assert.strictEqual(after.answers.length, 1);
    assert.match(after.answers[0], /two transactions/);
  });

  t('the user is still on the accounting page afterwards', () => {
    assert.strictEqual(after.onAccountantPage, true);
    assert.strictEqual(after.pageTitle, 'Tax & Compliance Workbench');
  });

  t('the request carried the selected company', () => {
    const asks = get(log, 'asks');
    assert.strictEqual(asks.length, 1);
    assert.strictEqual(asks[0].biz, 'biz-A');
  });

  t('what is missing and the next step are shown as their own things', () => {
    const a = after.messages.find((m) => m.role === 'assistant');
    assert.deepStrictEqual(a.missing, ['A payroll run for August']);
    assert.match(a.nextStep, /Record August payroll/);
  });
}

/* ══ 2. the two source lists stay two lists ══════════════════════════════ */
console.log('\nsources: verified basis vs documents to check');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] = ${JSON.stringify(answer({
      answer: 'No verified rule is loaded. Here is the document to check.',
      statement_types: ['general_accounting'],
      sources_for_review: [{
        tier: 'for_review', source_id: 'DJP_PPH23_002', title: 'DJP guidance on PPh 23',
        authority: 'DJP', document_number: 'PMK-141', url: 'https://pajak.go.id/x',
        trust_level: 'official_guidance', status: 'collected', verification: 'search-listed',
        caveat: 'Listed by a search of an official domain. The page has NOT been read.',
      }],
      grounded_rules_available: false,
    }))};
    window.__boot(); await window.__tick(400);
    window.__ask('What withholding applies to a service supplier invoice?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
  `);
  const chat = get(log, 'chat');
  const a = chat.messages.find((m) => m.role === 'assistant');

  t('a collected document appears only under "Sources to check"', () => {
    assert.deepStrictEqual(a.grounded, []);
    assert.deepStrictEqual(a.forReview, ['DJP guidance on PPh 23']);
  });

  t('that list carries its warning on screen', () => {
    assert.strictEqual(a.hasReviewWarning, true,
      'a collected source was listed with no warning that it is unverified');
  });

  t('the answer says no verified rule is loaded', () => {
    assert.strictEqual(a.noGrounded, true);
  });
}

console.log('\na verified rule is presented differently');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] = ${JSON.stringify(answer({
      answer: 'PPN is filed monthly under the activated rule.',
      statement_types: ['legal_requirement'],
      grounded_sources: [{
        tier: 'grounded', rule_code: 'ID_PPN_MONTHLY', rule_version: 2,
        title: 'PPN monthly filing', obligation_type: 'vat', effective_from: '2025-01-01',
        source_title: 'DJP PPN page', authority: 'DJP', url: 'https://pajak.go.id/ppn',
        source_verified_at: '2026-01-01T00:00:00Z',
      }],
      grounded_rules_available: true,
    }))};
    window.__boot(); await window.__tick(400);
    window.__ask('How often must we file PPN?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
  `);
  const a = get(log, 'chat').messages.find((m) => m.role === 'assistant');

  t('a grounded rule appears under the verified basis, not the review list', () => {
    assert.deepStrictEqual(a.grounded, ['PPN monthly filing']);
    assert.deepStrictEqual(a.forReview, []);
  });
  t('the "no verified rule" notice is absent when one exists', () => {
    assert.strictEqual(a.noGrounded, false);
  });
  t('the answer is labelled as a legal requirement', () => {
    assert.ok(a.kinds.some((k) => /Legal requirement/i.test(k)), a.kinds.join(', '));
  });
}

/* ══ 3. switching company ════════════════════════════════════════════════ */
console.log('\nswitching company');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] = (rec) =>
      ({ ...${JSON.stringify(answer())}, answer: 'Answer for ' + rec.businessId, business_id: rec.businessId });
    window.__boot(); await window.__tick(400);
    window.__ask('What is our cash position?');
    await window.__tick(400);
    window.__step('inA', window.__chat());
    window.__switchTo('biz-B');
    await window.__tick(500);
    window.__step('inB', window.__chat());
    window.__step('active', window.__activeId());
  `);
  const inA = get(log, 'inA'), inB = get(log, 'inB');

  t('the thread has a question and an answer under company A', () => {
    assert.strictEqual(inA.userMessages.length, 1);
    assert.match(inA.answers[0], /biz-A/);
  });

  t('switching company CLEARS the thread', () => {
    assert.strictEqual(get(log, 'active'), 'biz-B');
    assert.deepStrictEqual(inB.userMessages, [], 'company A\'s question survived the switch');
    assert.deepStrictEqual(inB.answers, [], 'company A\'s answer survived the switch');
  });

  t('the empty state and the starting questions come back', () => {
    assert.strictEqual(inB.suggestions.length, 4);
    assert.strictEqual(inB.inputValue, '');
  });
}

/* ══ 4. the late answer — the reason this suite exists ═══════════════════ */
console.log('\na late answer from the company the user has left');
{
  const log = await run(`
    window.__hold = ['/accountant/ask'];
    window.__routes['POST /api/accountant/ask'] = (rec) =>
      ({ ...${JSON.stringify(answer())}, answer: 'SECRET ANSWER FOR ' + rec.businessId, business_id: rec.businessId });
    window.__boot(); await window.__tick(400);

    // Ask under A. The request is held, so it is still in flight.
    window.__ask('What are our payables?');
    await window.__tick(200);
    window.__step('asked', { held: window.__heldIds(), chat: window.__chat() });

    // Leave for B while A's answer is still outstanding.
    window.__switchTo('biz-B');
    await window.__tick(300);
    window.__step('switched', window.__chat());

    // NOW let A's answer come back. It belongs to a thread that no longer exists.
    window.__settleAll('biz-A');
    await window.__tick(500);
    window.__step('afterLate', window.__chat());

    // B still works.
    window.__hold = [];
    window.__ask('What are our receivables?');
    await window.__tick(500);
    window.__step('bWorks', window.__chat());
  `);
  const asked = get(log, 'asked'), switched = get(log, 'switched');
  const afterLate = get(log, 'afterLate'), bWorks = get(log, 'bWorks');

  t('the question was in flight when the company changed', () => {
    assert.strictEqual(asked.held.length, 1);
    assert.strictEqual(asked.held[0].businessId, 'biz-A');
    assert.strictEqual(asked.chat.pending, true);
  });

  t('the switch cleared the thread and the pending state', () => {
    assert.deepStrictEqual(switched.userMessages, []);
    assert.strictEqual(switched.pending, false, 'a spinner from the old company survived');
  });

  t('A\'s late answer NEVER appears in B\'s thread', () => {
    assert.deepStrictEqual(afterLate.answers, [],
      `a late answer landed in the wrong company: ${JSON.stringify(afterLate.answers)}`);
    assert.ok(!JSON.stringify(afterLate).includes('SECRET ANSWER FOR biz-A'),
      'company A\'s answer text is on screen under company B');
  });

  t('B\'s own question still works afterwards', () => {
    assert.deepStrictEqual(bWorks.userMessages, ['What are our receivables?']);
    assert.strictEqual(bWorks.answers.length, 1);
    assert.match(bWorks.answers[0], /biz-B/);
  });
}

/* ══ 5. an answer whose business_id disagrees is dropped ═════════════════ */
console.log('\nthe server\'s own company echo is checked too');
{
  const log = await run(`
    // The server answers, but says the answer is for a different company. The
    // client must not render it even though its own request looked fine.
    window.__routes['POST /api/accountant/ask'] =
      { ...${JSON.stringify(answer())}, answer: 'WRONG COMPANY ANSWER', business_id: 'biz-B' };
    window.__boot(); await window.__tick(400);
    window.__ask('What is our cash position?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
  `);
  const chat = get(log, 'chat');
  t('an answer stamped with another company is discarded', () => {
    assert.deepStrictEqual(chat.answers, [],
      'an answer whose business_id did not match the active company was rendered');
  });
}

/* ══ 6. errors, retry and the limit ══════════════════════════════════════ */
console.log('\nprovider failure and retry');
{
  const log = await run(`
    let calls = 0;
    window.__routes['POST /api/accountant/ask'] = () => {
      calls++;
      return calls === 1
        ? { __status: 500, error: 'Provider unavailable', code: 'assistant_failed' }
        : { ...${JSON.stringify(answer())}, answer: 'Recovered answer.' };
    };
    window.__boot(); await window.__tick(400);
    window.__ask('What are our payables?');
    await window.__tick(500);
    window.__step('failed', window.__chat());
    window.__retry();
    await window.__tick(600);
    window.__step('retried', window.__chat());
    window.__step('askCount', window.__asks().length);
  `);
  const failed = get(log, 'failed'), retried = get(log, 'retried');

  t('a provider failure is shown, with a retry', () => {
    assert.ok(failed.error, 'no error message rendered');
    assert.strictEqual(failed.hasRetry, true);
    assert.strictEqual(failed.pending, false);
  });
  t('the question stays in the thread so the failure is legible', () => {
    assert.deepStrictEqual(failed.userMessages, ['What are our payables?']);
  });
  t('retry re-sends the same question and succeeds', () => {
    assert.strictEqual(get(log, 'askCount'), 2);
    assert.strictEqual(retried.answers.length, 1);
    assert.match(retried.answers[0], /Recovered answer/);
    assert.ok(!retried.error, 'the error survived a successful retry');
  });
}

console.log('\naccess denied');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] =
      { __status: 403, error: 'Your role cannot use the AI Accountant', code: 'forbidden_role' };
    window.__boot(); await window.__tick(400);
    window.__ask('What is our cash position?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
  `);
  const chat = get(log, 'chat');
  t('a refused role is reported as such, not as a crash', () => {
    assert.ok(chat.error, 'no message shown for a refused role');
    assert.match(chat.error, /role/i);
    assert.deepStrictEqual(chat.answers, []);
  });
}

console.log('\nthe monthly limit');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] =
      { __status: 429, error: 'Monthly AI question limit reached for this plan', code: 'ai_limit_reached',
        usage: { used: 20, limit: 20, remaining: 0, period: '2026-09-01' } };
    window.__boot(); await window.__tick(400);
    window.__ask('What is our cash position?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
    window.__step('typedAfter', window.__type('another question'));
  `);
  const chat = get(log, 'chat');
  t('the limit is explained, and asking again is blocked', () => {
    assert.ok(chat.limit, 'no limit notice rendered');
    assert.match(chat.limit, /limit/i);
    assert.strictEqual(chat.sendDisabled, true, 'the send button stayed enabled past the limit');
  });
  t('a limit is not shown as an error', () => {
    assert.ok(!chat.error, 'the limit was rendered through the error path');
  });
}

/* ══ 7. an injected instruction is surfaced ══════════════════════════════ */
console.log('\na hostile instruction inside a source');
{
  const log = await run(`
    window.__routes['POST /api/accountant/ask'] = ${JSON.stringify(answer({
      answer: 'One reference document contains text addressed to me. I did not act on it.',
      injection_detected: true,
      sources_for_review: [{
        tier: 'for_review', source_id: 'EVIL_001', title: 'Guidance page',
        authority: 'DJP', document_number: null, url: 'https://evil.test/x',
        trust_level: 'faq', status: 'collected', verification: 'search-listed', caveat: 'unverified',
      }],
    }))};
    window.__boot(); await window.__tick(400);
    window.__ask('What are the PPN rules for our invoices?');
    await window.__tick(500);
    window.__step('chat', window.__chat());
  `);
  const a = get(log, 'chat').messages.find((m) => m.role === 'assistant');
  t('the reader is told a document tried to give an instruction', () => {
    assert.strictEqual(a.injection, true, 'the injection notice was not rendered');
  });
}

/* ── done ──────────────────────────────────────────────────────────────── */
server.close();
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
