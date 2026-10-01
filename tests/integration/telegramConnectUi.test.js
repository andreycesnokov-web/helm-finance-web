// PR4b2 — the Telegram connect card.
//
// WHAT CAN AND CANNOT BE TESTED HERE
// ----------------------------------
// This client has NO test framework: no vitest, no jest, no testing-library, no jsdom, and no
// test script in client/package.json. A React component therefore cannot be rendered in a test
// without first adding a whole test stack, which a UI PR is the wrong place to do.
//
// So the logic that can actually be got wrong — error mapping, deep-link validation, state
// derivation, expiry — was kept out of the component in client/src/lib/telegramConnect.js and is
// exercised here for real, by the runner this repo already uses. The component itself is covered
// by source guards: what it calls, what it never calls, and what it never stores.
//
// That boundary is real and is stated in the report: these tests do not prove the card renders.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const LF = (s) => s.split('\r\n').join('\n');
const SETTINGS = LF(fs.readFileSync(path.join(ROOT, 'client/src/pages/Settings.jsx'), 'utf8'));
const LIB_SRC = LF(fs.readFileSync(path.join(ROOT, 'client/src/lib/telegramConnect.js'), 'utf8'));

// The Telegram card, bounded. An earlier revision sliced from the first marker to the END of
// the file, which swept in the rest of Settings — localStorage for the notifications toggle,
// business ids elsewhere — and attributed all of it to this card. A window has to have both ends.
function region(from, to) {
  const a = SETTINGS.indexOf(from);
  const b = SETTINGS.indexOf(to, a + 1);
  assert.ok(a > -1, `region start not found: ${from}`);
  assert.ok(b > a, `region end not found: ${to}`);
  return SETTINGS.slice(a, b);
}
// The handlers, and the card's markup — the two places the Telegram feature actually lives.
const TG_HANDLERS = () => region('const tgState =', 'const loadRefData');
const TG_CARD = () => region('{/* ── PR4b2', "{t('settings.telegramBot')}");
const TG = () => TG_HANDLERS() + '\n' + TG_CARD();

// The module is ESM; the repo's runner is CJS. Rather than add a build step, the exports are
// evaluated directly — this is the shipped source, not a copy of it.
function loadModule() {
  const body = LIB_SRC.replace(/^export /gm, '');
  const names = [...LIB_SRC.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${names.join(', ')} };`)();
}
const M = loadModule();

const LANGS = ['en', 'ru', 'id'];
const i18n = Object.fromEntries(LANGS.map((l) => {
  const src = LF(fs.readFileSync(path.join(ROOT, `client/src/i18n/${l}.js`), 'utf8'));
  return [l, src];
}));

// ════════════════════════════════════════════════════════════════════════════
// STATE DERIVATION
// ════════════════════════════════════════════════════════════════════════════

test('the card state follows the backend status, and revoked is not "never connected"', () => {
  // A user who deliberately disconnected should not be told they were never connected.
  assert.strictEqual(M.connectionState(null), 'loading');
  assert.strictEqual(M.connectionState({ status: 'connected' }), 'connected');
  assert.strictEqual(M.connectionState({ status: 'revoked' }), 'revoked');
  assert.strictEqual(M.connectionState({ status: 'not_connected' }), 'not_connected');
  assert.strictEqual(M.connectionState({ status: 'something_new' }), 'error');
  assert.strictEqual(M.connectionState({}), 'error');
});

// ════════════════════════════════════════════════════════════════════════════
// DEEP LINK SAFETY
// ════════════════════════════════════════════════════════════════════════════

const good = `https://t.me/CFOAIFinance_Bot?start=link_${'a'.repeat(43)}`;

test('a well-formed backend deep link is accepted', () => {
  assert.strictEqual(M.isSafeDeepLink(good), true);
  assert.strictEqual(good.split('start=')[1].length, 48, 'payload must stay inside Telegram 64');
});

test('a malformed or hostile deep link is refused', () => {
  const bad = [
    null, undefined, 42, '',
    `http://t.me/CFOAIFinance_Bot?start=link_${'a'.repeat(43)}`,          // not https
    `https://evil.example/CFOAIFinance_Bot?start=link_${'a'.repeat(43)}`, // wrong host
    `https://t.me/CFOAIFinance_Bot?start=link_${'a'.repeat(64)}`,         // old hex length
    `https://t.me/CFOAIFinance_Bot?start=link_${'a'.repeat(42)}`,         // too short
    `https://t.me/CFOAIFinance_Bot?start=${'a'.repeat(43)}`,              // missing prefix
    `javascript:alert(1)//t.me/x?start=link_${'a'.repeat(43)}`,
    `https://t.me/CFOAIFinance_Bot?start=link_${'a'.repeat(43)}&x=1`,     // trailing junk
  ];
  for (const u of bad) {
    assert.strictEqual(M.isSafeDeepLink(u), false, `accepted: ${String(u).slice(0, 45)}…`);
  }
});

test('the fallback bot is the canonical one — never the old bot, never a placeholder', () => {
  assert.strictEqual(M.DEFAULT_BOT_USERNAME, 'CFOAIFinance_Bot');
  assert.ok(!LIB_SRC.includes('HCfinance'), 'the retired bot name is back');
  assert.ok(!LIB_SRC.includes('YourBot'), 'a placeholder bot name is present');
});

// ════════════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ════════════════════════════════════════════════════════════════════════════

test('each backend error code maps to its own message', () => {
  const cases = [
    [{ status: 409, message: 'already_linked' }, 'telegram.errAlreadyLinked'],
    [{ status: 409, message: 'user_already_linked' }, 'telegram.errAlreadyLinked'],
    [{ status: 409, message: 'external_already_linked' }, 'telegram.errExternalLinked'],
    [{ status: 404, message: 'not_linked' }, 'telegram.errNotLinked'],
    [{ status: 503, message: 'bot_not_configured' }, 'telegram.errBotNotConfigured'],
    [{ status: 429, message: 'rate_limited' }, 'telegram.errRateLimited'],
    [{ status: 503, message: 'temporary_link_failure' }, 'telegram.errTemporary'],
  ];
  for (const [err, key] of cases) {
    assert.strictEqual(M.errorKey(err).key, key, `wrong key for ${err.message}`);
  }
});

test('the two "already linked" conflicts stay distinguishable', () => {
  // One means "your account has a different Telegram"; the other means "that Telegram belongs to
  // someone else". They send the user to different places.
  assert.notStrictEqual(
    M.errorKey({ status: 409, message: 'user_already_linked' }).key,
    M.errorKey({ status: 409, message: 'external_already_linked' }).key);
});

test('401 is flagged as an expired session, not shown as a Telegram problem', () => {
  const r = M.errorKey({ status: 401, message: 'No token' });
  assert.strictEqual(r.authExpired, true);
  assert.strictEqual(r.key, 'telegram.errAuth');
});

test('an unknown code or a network failure degrades to temporary, never to a claim', () => {
  // Anything that mapped an unrecognised failure onto "already linked elsewhere" would be
  // asserting something about the user's account that we do not know.
  for (const err of [
    { status: 500, message: 'boom' },
    { status: 0, message: '' },
    new Error('Failed to fetch'),
    {}, null, undefined,
  ]) {
    const r = M.errorKey(err);
    assert.strictEqual(r.key, 'telegram.errTemporary', `unexpected key for ${JSON.stringify(err)}`);
    assert.strictEqual(r.authExpired, false);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EXPIRY
// ════════════════════════════════════════════════════════════════════════════

test('expiry drives the "get a new link" state', () => {
  const now = Date.parse('2026-08-23T12:00:00Z');
  const at = (min) => new Date(now + min * 60000).toISOString();
  assert.strictEqual(M.isExpired(at(5), now), false);
  assert.strictEqual(M.isExpired(at(-1), now), true);
  assert.strictEqual(M.isExpired(at(0), now), true);
  assert.strictEqual(M.isExpired(null, now), false, 'no link yet is not an expired link');
  assert.strictEqual(M.minutesUntil(at(15), now), 15);
  assert.strictEqual(M.minutesUntil(at(0.5), now), 1, 'never round down to a misleading 0');
  assert.strictEqual(M.minutesUntil(at(-5), now), 0);
  assert.strictEqual(M.minutesUntil('not a date', now), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// THE COMPONENT — source guards
// ════════════════════════════════════════════════════════════════════════════

test('no token is minted on render — only when the user asks', () => {
  // Opening Settings must not burn a single-use credential.
  assert.match(SETTINGS, /const loadTelegram = \(\) => \{/);
  const loader = SETTINGS.slice(SETTINGS.indexOf('const loadTelegram = () => {'),
                                SETTINGS.indexOf('const generateTelegramLink'));
  assert.ok(!loader.includes('link-token'), 'the status loader mints a token');

  // The mint call appears exactly once, inside the explicit user action.
  assert.strictEqual(SETTINGS.split("'/account/integrations/telegram/link-token'").length - 1, 1);
  const gen = SETTINGS.slice(SETTINGS.indexOf('const generateTelegramLink'),
                             SETTINGS.indexOf('const unlinkTelegram'));
  assert.match(gen, /link-token/, 'the connect action does not mint');
  assert.match(SETTINGS, /onClick=\{generateTelegramLink\}/, 'nothing triggers the mint');
});

test('the token is never persisted outside component state', () => {
  // A single-use, short-lived credential must not outlive the page.
  const tg = TG();
  // The deep link is the token in URL form, so the sinks are checked against both. Anything
  // that persists or replays it outlives the single use the token is supposed to have.
  for (const store of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB',
                       'history.pushState', 'history.replaceState']) {
    assert.ok(!tg.includes(store), `the Telegram card writes to ${store}`);
  }
  assert.match(SETTINGS, /const \[tgLink, setTgLink\] = useState\(null\)/,
    'the link is no longer held in component state');
});

test('the raw token is never rendered or logged', () => {
  const tg = TG();
  // Only the whole deep link is ever surfaced — for opening and copying — never the bare token.
  assert.ok(!/\btgLink\.token\b/.test(SETTINGS), 'the bare token is referenced in the UI');
  assert.ok(!/r\.token/.test(SETTINGS), 'the raw token is read out of the mint response');
  for (const m of tg.matchAll(/console\.\w+\(([^;]*)\)/g)) {
    assert.ok(!/token|tgLink|deep_?link|link_/i.test(m[1]),
      `a log line can emit the link: ${m[0]}`);
  }
});

test('the deep link is validated before it is put in front of the user', () => {
  assert.match(SETTINGS, /if \(!isSafeDeepLink\(r\.deep_link\)\)/,
    'the backend link is rendered without validation');
});

test('unlink is confirmed, and clears any outstanding link', () => {
  assert.match(SETTINGS, /setShowTgUnlink\(true\)/, 'unlink has no confirmation step');
  const unlink = SETTINGS.slice(SETTINGS.indexOf('const unlinkTelegram'),
                                SETTINGS.indexOf('const loadRefData'));
  assert.match(unlink, /'\/account\/integrations\/telegram\/unlink'/);
  assert.match(unlink, /setTgLink\(null\)/, 'a stale link survives the unlink');
  assert.match(unlink, /loadTelegram\(\)/, 'status is not refreshed after unlinking');
});

test('the requests carry no business, role or workspace', () => {
  // A link is identity only; access stays in business_members.
  const tg = TG();
  for (const forbidden of ['business_id', 'workspace_id', 'role:', 'active_business_id']) {
    assert.ok(!tg.includes(forbidden), `the Telegram card sends ${forbidden}`);
  }
});

test('no internal user id is rendered — only the masked value from the backend', () => {
  const tg = TG();
  assert.match(tg, /tgStatus\?\.external_user_id_masked/, 'the masked id is not shown');
  assert.ok(!/tgStatus\?\.user_id|tgStatus\.user_id/.test(tg), 'an internal user id is rendered');
  assert.ok(!/external_user_id[^_]/.test(tg.replace(/external_user_id_masked/g, '')),
    'an unmasked external id is referenced');
});

test('the card offers a refresh rather than polling the backend', () => {
  assert.match(SETTINGS, /onClick=\{loadTelegram\}/, 'there is no manual refresh');
  const tg = TG();
  assert.ok(!/setInterval|setTimeout\([^)]*loadTelegram/.test(tg),
    'the card polls the backend — refresh is user-driven by design');
});

test('the retired bot name and the placeholder are absent from the client', () => {
  const dir = path.join(ROOT, 'client/src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(dir).filter((f) => /\.(js|jsx)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!src.includes('HCfinance'), `${path.relative(ROOT, f)} still names the retired bot`);
    assert.ok(!src.includes("'YourBot'"), `${path.relative(ROOT, f)} still has the YourBot placeholder`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// COPY
// ════════════════════════════════════════════════════════════════════════════

test('every Telegram string exists in all three languages', () => {
  const keys = [...SETTINGS.matchAll(/t\('settings\.(tg[A-Za-z]+|telegramConnect)'\)/g)]
    .map((m) => m[1]);
  assert.ok(keys.length >= 12, `only ${keys.length} Telegram strings referenced`);
  for (const key of [...new Set(keys)]) {
    for (const lang of LANGS) {
      assert.ok(new RegExp(`^ {4}${key}:`, 'm').test(i18n[lang]),
        `${key} is missing from ${lang}.js`);
    }
  }
});

test('every error key the mapper can produce has copy in all three languages', () => {
  const keys = [...LIB_SRC.matchAll(/'telegram\.(err[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `only ${keys.length} error keys found`);
  for (const key of [...new Set(keys)]) {
    for (const lang of LANGS) {
      assert.ok(new RegExp(`^ {4}${key}:`, 'm').test(i18n[lang]),
        `${key} is missing from ${lang}.js`);
    }
  }
});

test('the unlink confirmation says what is NOT deleted', () => {
  // The moment a user is deciding whether to disconnect is exactly when "your data is safe"
  // has to be on screen.
  for (const lang of LANGS) {
    const m = new RegExp('^ {4}tgUnlinkBody: (.*)$', 'm').exec(i18n[lang]);
    assert.ok(m, `${lang}: tgUnlinkBody missing`);
    assert.ok(m[1].length > 60, `${lang}: the unlink explanation is too thin`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker 1 — a failed status lookup must fail CLOSED.
//
// The bug this pins: 'error' fell through to the final else, which renders "Not connected" AND
// the Connect button. That turns "we could not reach the server" into a claim about the user's
// account, and offers an action premised on that claim.
// ─────────────────────────────────────────────────────────────────────────────

// The error branch, bounded: from its own arm of the ternary to the start of the next arm.
function errorBranch() {
  const src = TG_CARD();
  const a = src.indexOf(") : tgState === 'error' ? (");
  assert.ok(a > -1, 'there is no dedicated error branch');
  const b = src.indexOf('\n        ) : (', a + 1);
  assert.ok(b > a, 'the error branch does not end at the next arm');
  return src.slice(a, b);
}

test('a status failure renders the unavailable state, not "not connected"', () => {
  const branch = errorBranch();
  assert.match(branch, /tgStatusUnavailable/, 'the error state does not say status is unavailable');
  assert.ok(!branch.includes('tgStatusNotConnected'),
    'the error state claims the account is not connected');
  assert.ok(!branch.includes('tgStatusConnected'),
    'the error state claims the account is connected');
});

test('the error state offers Retry and nothing else', () => {
  const branch = errorBranch();
  assert.match(branch, /tgRetry/, 'no retry is offered');
  assert.match(branch, /onClick=\{loadTelegram\}/, 'retry does not re-run the status lookup');
  // The two actions that presume a known state must not be reachable from an unknown one.
  assert.ok(!branch.includes('generateTelegramLink'), 'Connect is reachable from the error state');
  assert.ok(!branch.includes('setShowTgUnlink'), 'Disconnect is reachable from the error state');
  assert.ok(!branch.includes('tgConnect'), 'the Connect label is rendered in the error state');
  assert.ok(!branch.includes('tgUnlink'), 'the Disconnect label is rendered in the error state');
});

test('error is a distinct arm, ordered before the unlinked fallback', () => {
  const src = TG_CARD();
  // If the error arm came after the fallback it would be unreachable — the fallback is a bare
  // else and would swallow it.
  assert.ok(src.indexOf(") : tgState === 'error' ? (") < src.indexOf('tgStatusNotConnected'),
    'the error arm is ordered after the fallback that would swallow it');
});

test('no action is offered while the status is still loading', () => {
  const src = TG_CARD();
  const a = src.indexOf("{tgState === 'loading' ? (");
  const b = src.indexOf(") : tgState === 'error' ? (", a + 1);
  assert.ok(a > -1 && b > a, 'the loading arm is missing');
  const loading = src.slice(a, b);
  for (const action of ['generateTelegramLink', 'setShowTgUnlink', 'tgConnect', 'tgUnlink']) {
    assert.ok(!loading.includes(action), `${action} is reachable while status is still loading`);
  }
});

test('every state the resolver can produce has an arm that handles it', () => {
  // connectionState is total: anything unrecognised becomes 'error'. Paired with the branch
  // above, that means an unknown backend status can never render a linked/unlinked action.
  for (const s of [undefined, null, {}, { status: 'weird' }, { status: '' }]) {
    const state = M.connectionState(s);
    assert.ok(['loading', 'error'].includes(state),
      `status ${JSON.stringify(s)} derived ${state}, which renders actions`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker 2 — the dark gate.
// ─────────────────────────────────────────────────────────────────────────────

test('the linking UI is behind a build-time flag that defaults OFF', () => {
  assert.match(SETTINGS,
    /const TELEGRAM_LINKING_UI = import\.meta\.env\.VITE_TELEGRAM_LINKING_UI_ENABLED === 'true'/,
    'the gate constant is missing or not an exact-string comparison');
  // An exact === 'true' means every other value — unset, '1', 'TRUE', 'yes' — is OFF. These are
  // the shapes that would quietly default it ON.
  const gate = region('const TELEGRAM_LINKING_UI', 'const LANGUAGES');
  for (const loose of ["!== 'false'", '|| true', '?? true', 'Boolean(', '!!import.meta']) {
    assert.ok(!gate.includes(loose), `the gate can default ON via ${loose}`);
  }
});

test('with the flag off the card, its modal and its status call are all absent', () => {
  // Not merely hidden: each of these is a build-time-foldable condition, so the bundler drops
  // the markup, the handlers and their API paths. Verified against a real OFF build in the report.
  assert.match(SETTINGS, /\{TELEGRAM_LINKING_UI && \(<>/, 'the card is not gated');
  assert.match(SETTINGS, /\{TELEGRAM_LINKING_UI && showTgUnlink && \(/, 'the unlink modal is not gated');
  assert.match(SETTINGS, /if \(TELEGRAM_LINKING_UI\) loadTelegram\(\)/,
    'the status request still fires on mount when the flag is off');
  // The derivation too — one ungated call here would keep the whole lib module in the bundle.
  assert.match(SETTINGS, /const tgState = TELEGRAM_LINKING_UI \? connectionState\(tgStatus\) : 'off'/,
    'the state derivation is not gated, so the module cannot be tree-shaken');
});

test('the pre-existing Telegram Bot section stays outside the gate', () => {
  // The gate is for the NEW linking card. The old bot link must keep rendering regardless.
  const close = SETTINGS.indexOf('</>)}');
  assert.ok(close > -1, 'the gated region is never closed');
  assert.ok(SETTINGS.indexOf("{t('settings.telegramBot')}") > close,
    'the existing Telegram Bot section was swept inside the dark gate');
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker 3 — "Copied" must mean copied.
// ─────────────────────────────────────────────────────────────────────────────

test('copied is only claimed after the clipboard write resolves', () => {
  const src = TG_CARD();
  const a = src.indexOf('navigator.clipboard');
  assert.ok(a > -1, 'the copy button no longer uses the clipboard');
  const handler = src.slice(a - 200, src.indexOf('tgCopyLink', a));
  assert.match(handler, /await navigator\.clipboard\.writeText/, 'the write is not awaited');
  assert.ok(handler.indexOf('await navigator.clipboard.writeText') < handler.indexOf('setTgCopied(true)'),
    'success is claimed before the write resolves');
  // Scoped to the catch clause itself. Asserting errCopyFailed against the whole handler passed
  // on the presence-check line above, so an emptied catch went unnoticed — found by mutation.
  const catchClause = handler.slice(handler.indexOf('catch')).split('\n')[0];
  assert.ok(catchClause.startsWith('catch'), 'a rejected write is not handled at all');
  assert.match(catchClause, /errCopyFailed/, 'a rejected write is swallowed with no message');
  assert.match(catchClause, /setTgCopied\(false\)/, 'a failed copy is still shown as copied');
  // Absent clipboard API: optional chaining alone would await undefined and resolve, so the
  // presence check has to come first.
  assert.match(handler, /if \(!navigator\.clipboard\?\.writeText\)/,
    'a missing clipboard API would still report success');
});

// ─────────────────────────────────────────────────────────────────────────────
// i18n parity, as a test rather than a one-off script.
// ─────────────────────────────────────────────────────────────────────────────

test('every key the card renders exists in all three languages', () => {
  const used = new Set();
  for (const m of LIB_SRC.matchAll(/'telegram\.([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of SETTINGS.matchAll(/'telegram\.([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  const card = TG_CARD() + TG_HANDLERS();
  for (const m of card.matchAll(/t\('settings\.([A-Za-z0-9_]+)'\)/g)) used.add(m[1]);
  assert.ok(used.size >= 26, `only ${used.size} keys found — the scan is not reaching the card`);

  for (const lang of LANGS) {
    const src = LF(fs.readFileSync(path.join(ROOT, `client/src/i18n/${lang}.js`), 'utf8'));
    const start = src.indexOf('\n  settings: {');
    assert.ok(start > -1, `${lang}: no settings block`);
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = src.slice(start, end);
    const have = new Set([...body.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));
    const missing = [...used].filter((k) => !have.has(k));
    assert.deepStrictEqual(missing, [], `${lang} is missing: ${missing.join(', ')}`);
  }
});
