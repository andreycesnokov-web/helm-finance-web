// Popup-safe document opening.
//
// `const url = await getSignedUrl(); window.open(url)` is blocked by Safari and some mobile
// Chrome configurations: by the time window.open runs it is no longer attached to the click,
// so the tab never appears and the user is told nothing. The tab must therefore be claimed
// SYNCHRONOUSLY inside the handler and navigated afterwards — and every failure path has to
// surface something the user can act on.
//
//   Run: node --test tests/integration/openDocument.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const MOD = pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'openDocument.js')).href;
let O;
test.before(async () => { O = await import(MOD); });

// A window handle good enough to observe what the opener does to it.
function fakeWindow() {
  const w = {
    closed: false,
    opener: { app: 'still attached' },
    written: '',
    navigatedTo: null,
    document: {
      write(html) { w.written += html; },
      close() { w.docClosed = true; },
    },
    location: { replace(u) { w.navigatedTo = u; } },
    close() { w.closed = true; },
  };
  return w;
}

// A URL fetch we can resolve on demand, to observe ORDER.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const SIGNED = 'https://storage.example/object/sign/bucket/biz/doc.pdf?token=abc';

// ── the ordering guarantee ──────────────────────────────────────────────────
test('the tab is opened BEFORE the signed URL is awaited', async () => {
  const win = fakeWindow();
  const d = deferred();
  let openedAt = null, order = [];
  const openWindow = () => { order.push('open'); openedAt = true; return win; };

  const p = O.openDocumentSafely({ openWindow, fetchUrl: () => { order.push('fetch'); return d.promise; } });
  // Synchronously after the call, the window must already exist — this is the whole point.
  assert.strictEqual(openedAt, true, 'window.open must run inside the gesture, not after the await');
  assert.deepStrictEqual(order, ['open', 'fetch']);

  d.resolve(SIGNED);
  const r = await p;
  assert.strictEqual(r.status, 'opened');
  assert.strictEqual(win.navigatedTo, SIGNED, 'the placeholder is navigated to the document');
});

test('the placeholder shows "Opening document…" while the URL is fetched', async () => {
  const win = fakeWindow();
  const d = deferred();
  const p = O.openDocumentSafely({ openWindow: () => win, fetchUrl: () => d.promise });
  assert.match(win.written, /Opening document/i, 'the blank tab must explain itself');
  d.resolve(SIGNED);
  await p;
});

// ── security ────────────────────────────────────────────────────────────────
test('the opened tab loses its handle on this window', async () => {
  const win = fakeWindow();
  const r = await O.openDocumentSafely({ openWindow: () => win, fetchUrl: async () => SIGNED });
  assert.strictEqual(win.opener, null, 'opener must be severed before navigating');
  assert.strictEqual(r.status, 'opened');
});

test('a window that refuses opener/document access is still navigated', async () => {
  // Some environments throw on either; neither is fatal.
  const win = fakeWindow();
  Object.defineProperty(win, 'opener', { set() { throw new Error('denied'); }, get() { return null; } });
  win.document.write = () => { throw new Error('denied'); };
  const r = await O.openDocumentSafely({ openWindow: () => win, fetchUrl: async () => SIGNED });
  assert.strictEqual(r.status, 'opened');
  assert.strictEqual(win.navigatedTo, SIGNED);
});

// ── blocked popup ───────────────────────────────────────────────────────────
test('a blocked popup returns the URL for an inline fallback, never a silent no-op', async () => {
  const r = await O.openDocumentSafely({ openWindow: () => null, fetchUrl: async () => SIGNED });
  assert.strictEqual(r.status, 'blocked');
  assert.strictEqual(r.url, SIGNED, 'the caller needs the URL to render a real link');
});

test('window.open throwing is treated as blocked, not as a crash', async () => {
  const r = await O.openDocumentSafely({
    openWindow: () => { throw new Error('blocked by policy'); },
    fetchUrl: async () => SIGNED,
  });
  assert.strictEqual(r.status, 'blocked');
  assert.strictEqual(r.url, SIGNED);
});

test('a tab closed by the user before the URL arrives falls back inline', async () => {
  const win = fakeWindow();
  const d = deferred();
  const p = O.openDocumentSafely({ openWindow: () => win, fetchUrl: () => d.promise });
  win.closed = true;                     // the user closed the placeholder
  d.resolve(SIGNED);
  const r = await p;
  assert.strictEqual(r.status, 'blocked');
  assert.strictEqual(r.url, SIGNED);
});

// ── failed request ──────────────────────────────────────────────────────────
test('a failed signed-URL request reports an error and does not leave a blank tab', async () => {
  const win = fakeWindow();
  const r = await O.openDocumentSafely({
    openWindow: () => win,
    fetchUrl: async () => { throw new Error('storage_unavailable'); },
  });
  assert.strictEqual(r.status, 'error');
  assert.ok(r.error instanceof Error);
  assert.match(win.written, /Could not open/i, 'the tab explains the failure');
  assert.strictEqual(win.navigatedTo, null);
});

test('when the failed tab cannot be written to, it is closed instead of left blank', async () => {
  const win = fakeWindow();
  let writes = 0;
  win.document.write = () => { writes += 1; if (writes > 1) throw new Error('denied'); };
  const r = await O.openDocumentSafely({
    openWindow: () => win,
    fetchUrl: async () => { throw new Error('nope'); },
  });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(win.closed, true, 'no hanging blank tab');
});

test('an empty URL is treated as a failure, not opened', async () => {
  const win = fakeWindow();
  const r = await O.openDocumentSafely({ openWindow: () => win, fetchUrl: async () => '' });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(win.navigatedTo, null);
});

test('a blocked popup with a failed request reports the error, not a fallback', async () => {
  const r = await O.openDocumentSafely({
    openWindow: () => null,
    fetchUrl: async () => { throw new Error('boom'); },
  });
  assert.strictEqual(r.status, 'error', 'there is no URL to offer, so do not pretend there is');
});

// ── the page wires it correctly ─────────────────────────────────────────────
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src',
  'pages', 'business', 'Accountant.jsx'), 'utf8');
const MODAL = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src',
  'components', 'ArchiveDocumentModal.jsx'), 'utf8');

test('the intake row uses the popup-safe opener, not a bare awaited window.open', () => {
  assert.match(PAGE, /openDocumentSafely\(/);
  assert.ok(!/await getSignedUrl[\s\S]{0,120}window\.open/.test(PAGE),
    'the blocked pattern (await, then open) must be gone');
});

test('the row renders the blocked-popup fallback and the error inline', () => {
  assert.match(PAGE, /POPUP_BLOCKED_MESSAGE/);
  assert.match(PAGE, /openFallback\[d\.id\]/, 'a per-row fallback link');
  assert.match(PAGE, /Open document|Download document/);
  assert.match(PAGE, /openError\[d\.id\]/, 'a per-row error message');
  assert.match(PAGE, /rel="noopener noreferrer"/, 'the fallback link stays noopener');
});

test('the storage path still never reaches the page', () => {
  assert.ok(!/storage_path/.test(PAGE));
});

test('the archive modal no longer mentions deletion from the Document Center', () => {
  assert.ok(!/unless it is deleted/i.test(MODAL), 'that deletion is not offered anywhere');
  assert.ok(!/hard.?delete/i.test(MODAL));
  assert.match(MODAL, /kept for audit and history in the Document Center/i);
});

test('a 403 from archive is shown as a permission message, not a raw error', () => {
  assert.match(PAGE, /You do not have permission to archive this document\./);
});
