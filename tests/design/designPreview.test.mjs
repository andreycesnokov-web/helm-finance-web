// What the design preview route is allowed to be.
//
// PR #80 changed shared visual components, and visual claims need pictures. The
// preview page exists to produce those pictures from the REAL components, which
// makes it a permanent risk: a page that renders product chrome with no auth is
// exactly the kind of thing that quietly becomes reachable in production, or
// quietly drifts into a hand-written mock that proves nothing.
//
// These are structural assertions. The rendered-DOM assertions — h1 counts,
// computed colour, overflow at 390px — live in renderedPreview.test.mjs, which
// drives a real browser. Where a fact can be checked in the DOM, it is checked
// there and not here.
//
// Run: node tests/design/designPreview.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Normalised to LF. Git checks these files out with CRLF on Windows, so a
// pattern anchored on a newline silently stops matching there — an assertion
// that fails on one machine and passes on CI, or worse passes everywhere while
// matching nothing at all.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** Source with comments stripped, so assertions about behaviour are not
 *  satisfied — or broken — by prose that merely describes it. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A stylesheet with its comments removed. Same reason as code() above: a
 *  comment recording what a migration DELETED names the deleted thing, and an
 *  assertion that the thing is gone would match the note saying so. */
const cssCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

const PREVIEW = 'client/src/pages/DesignPreview.jsx';
const src = code(PREVIEW);
const app = code('client/src/App.jsx');

console.log('\ndesign preview — gating');

t('the route is behind a build-time flag', () => {
  assert.match(src, /import\.meta\.env\.VITE_DESIGN_PREVIEW_ENABLED\s*===\s*'true'/,
    'preview must read VITE_DESIGN_PREVIEW_ENABLED');
});

t('a disabled flag renders the not-found branch before anything else', () => {
  // The guard must be the first statement of the component: a later return would
  // still mount the page's data and effects on the way to the 404.
  const body = src.slice(src.indexOf('export default function DesignPreview'));
  const firstReturn = body.slice(0, body.indexOf('\n\n'));
  assert.match(firstReturn, /if\s*\(\s*!PREVIEW_ON\s*\)\s*return\s*<NotFound/,
    'the flag check must be the component\'s first statement');
});

t('the flag is compile-time, so a production bundle drops the page entirely', () => {
  // Vite inlines import.meta.env.VITE_* at build time, which is what lets the
  // minifier delete the branch and Rollup drop the lazy chunk. Anything the
  // browser could decide at runtime would ship the page to every customer.
  const gate = src.match(/const PREVIEW_ON\s*=\s*([^\n]+)/);
  assert.ok(gate, 'PREVIEW_ON is not defined');
  assert.match(gate[1], /import\.meta\.env\.VITE_DESIGN_PREVIEW_ENABLED/,
    `the gate reads ${gate[1].trim()}, which is not a build-time constant`);
  assert.strictEqual((src.match(/PREVIEW_ON\s*=[^=]/g) || []).length, 1,
    'PREVIEW_ON is assigned more than once');
  // Query params choose which example to render; they never decide whether the
  // page exists. Storage and cookies have no business here at all.
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(src),
    'the preview must not read browser storage');
});

t('the route is registered exactly once', () => {
  const hits = app.match(/path="\/design-preview"/g) || [];
  assert.strictEqual(hits.length, 1, `expected 1 route registration, found ${hits.length}`);
});

console.log('\ndesign preview — it must render the real thing');

t('the shared components come from the shipped modules', () => {
  assert.match(src, /import\s*\{[^}]*PageHeader[^}]*\}\s*from\s*'\.\.\/shell\/ui'/,
    'PageHeader must be imported from shell/ui');
  assert.match(src, /import\s*\{[^}]*SummaryCard[^}]*\}\s*from\s*'\.\.\/shell\/ui'/,
    'SummaryCard must be imported from shell/ui');
  assert.match(src, /import\s*\{\s*ExecutiveHero\s*\}\s*from\s*'\.\/business\/PulseBlocks'/,
    'ExecutiveHero must be imported from the real Pulse module');
});

t('the preview defines no look-alike of a component it is meant to prove', () => {
  // A local re-implementation would make every screenshot a lie.
  for (const name of ['PageHeader', 'SummaryCard', 'ExecutiveHero', 'StatusBadge', 'Btn']) {
    const declared = new RegExp(`(function|const)\\s+${name}\\b`);
    assert.ok(!declared.test(src), `${name} must not be redefined inside the preview`);
  }
});

t('money is formatted by the production formatters', () => {
  // The preview must never format currency itself. Pulse's fixtures go through
  // formatAmount; the Wallets card goes through walletsSummary, which owns the
  // abbreviation AND the currency rule — so importing that is the stronger
  // guarantee, not a weaker one.
  const fromMoney = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/lib\/money'/.exec(src);
  assert.ok(fromMoney, 'the preview does not import from lib/money at all');
  const named = fromMoney[1].split(',').map((x) => x.trim());
  assert.ok(named.includes('formatAmount'), 'the preview must not hand-format currency');
  assert.match(src, /import\s*\{[^}]*walletsSummary[^}]*\}\s*from\s*'\.\/walletsSummary'/,
    'the preview must derive the Wallets card from the production summary');
  // No currency symbol typed straight into the preview's own markup.
  assert.ok(!/'Rp '|"Rp "|\$\{'\$'\}/.test(src.replace(/const idr =.*\n/, '')),
    'the preview writes a currency symbol by hand somewhere');
});

console.log('\ndesign preview — it must not reach anything real');

t('no network, no database, no auth', () => {
  for (const forbidden of ['fetch(', 'apiFetch', 'supabase', 'axios', 'XMLHttpRequest',
    'useAuth', 'localStorage', 'sessionStorage']) {
    assert.ok(!src.includes(forbidden), `preview must not reference ${forbidden}`);
  }
});

t('no effects and no state — it is a fixed render', () => {
  for (const hook of ['useEffect', 'useState', 'useQuery', 'useContext']) {
    assert.ok(!src.includes(hook), `preview must not use ${hook}`);
  }
});

t('every figure is synthetic', () => {
  // An NPWP is 15-16 digits, an Indonesian account number 10-16. Nothing of that
  // shape may appear, and the demo identifier must be visibly fake.
  const digits = src.match(/\d[\d.\-\s]{9,}\d/g) || [];
  for (const d of digits) {
    const bare = d.replace(/\D/g, '');
    assert.ok(bare.length < 10, `suspicious long identifier in fixtures: ${d.trim()}`);
  }
  // The workspace identifier is gone from the fixture entirely: the switcher renders
  // one when present, and a technical code is not something a business user needs
  // to read on every screen.
  assert.ok(!/business_code\s*:/.test(src),
    'the fixture still carries a business_code, which the switcher will render');
});

t('the page says what it is, in the page', () => {
  assert.match(src, /SYNTHETIC DATA/,
    'a screenshot of this page must be self-labelling once it leaves the repo');
});

console.log('\ndesign preview — the watermark is decoration');

t('the one decorative mark is inert to assistive technology', () => {
  // It lives in the page hero now, and it carries no information a caption does
  // not already carry.
  const ui = code('client/src/shell/ui.jsx');
  const imgs = ui.match(/<img[^>]*cfo-pagehead-mark[^>]*>/g) || [];
  assert.strictEqual(imgs.length, 1, `expected one page-hero mark, found ${imgs.length}`);
  assert.match(imgs[0], /aria-hidden="true"/, 'the page-hero mark is not aria-hidden');
  assert.match(imgs[0], /alt=""/, 'the page-hero mark has no empty alt');
});

t('the flagship watermark is opt-in, and off by default', () => {
  // The previous implementation defaulted the symbol ON for every SummaryCard, so
  // a page got branding by forgetting to opt out rather than by choosing to opt
  // in. The default must stay false: most summary cards are not flagships.
  const ui = code('client/src/shell/ui.jsx');
  const sig = (ui.match(/export const SummaryCard = \(\{([^}]*)\}/) || [])[1] || '';
  assert.ok(sig.includes('flagship'), 'SummaryCard has no flagship prop');
  assert.match(sig, /flagship\s*=\s*false/,
    `SummaryCard's flagship prop does not default to false: "${sig.trim()}"`);
  assert.match(ui, /\{flagship && <FlagshipMark \/>\}/,
    'SummaryCard renders the mark unconditionally rather than on the opt-in');
  // The prop names the card's role, not what it draws, so the treatment can change
  // without every call site having to be re-read.
  assert.ok(!/watermark|logo|symbol\s*=/.test(sig),
    `the prop is named for its presentation, not its meaning: "${sig.trim()}"`);
});

t('Pulse and the shared card draw the same mark from the same component', () => {
  const ui = code('client/src/shell/ui.jsx');
  // One component owns the mark, and it uses the canonical white symbol — the
  // navy symbol would be invisible on a navy card.
  const mark = (ui.match(/export const FlagshipMark = \(\) => \(([\s\S]*?)\)\n/) || [])[1] || '';
  assert.ok(mark, 'no FlagshipMark component in shell/ui.jsx');
  assert.match(ui, /FLAGSHIP_MARK = '\/brand\/symbol_white_transparent\.svg'/,
    'FlagshipMark does not use the canonical transparent white symbol');
  assert.match(mark, /alt=""/, 'the flagship mark has no empty alt');
  assert.match(mark, /aria-hidden="true"/, 'the flagship mark is not aria-hidden');

  // Pulse's total cash is hand-built rather than a SummaryCard, so the only way
  // the two navy heroes stay identical is by both importing this component and
  // wearing the shared class. They diverged once already: one drew the symbol,
  // the other drew a graph-paper grid.
  const pulse = code('client/src/pages/business/PulseBlocks.jsx');
  assert.match(pulse, /import \{[^}]*FlagshipMark[^}]*\} from '\.\.\/\.\.\/shell\/ui'/,
    'PulseBlocks does not import the shared FlagshipMark');
  assert.match(pulse, /className="pulse-cash cfo-flagship"/,
    'the Pulse cash card does not wear the shared .cfo-flagship class');
  assert.ok(!/symbol_\w+\.svg/.test(pulse),
    'PulseBlocks names a brand asset directly instead of using the shared component');
});

t('no page styles a watermark of its own', () => {
  // Size, opacity, crop, safe area and phone behaviour belong to .cfo-flagship in
  // the shell. A page that redeclares any of them is how the two navy heroes
  // drifted apart the first time.
  const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const shell = strip('client/src/shell/shell.css');
  assert.ok(/\.cfo-flagship-mark\s*\{/.test(shell),
    'the shared watermark rule has gone from shell.css');
  for (const f of ['client/src/pages/business/Pulse.css',
                   'client/src/pages/business/Onboarding.css',
                   'client/src/pages/DesignPreview.css']) {
    const css = strip(f);
    assert.ok(!/\.cfo-flagship-mark\s*\{/.test(css),
      `${f} restyles the shared watermark`);
    assert.ok(!/\.cfo-summary-sym\s*\{|\.pulse-cash-mark\s*\{/.test(css),
      `${f} still styles a page-specific financial-card watermark`);
  }
  // The obsolete per-page classes are gone from the markup too.
  for (const f of ['client/src/shell/ui.jsx', 'client/src/pages/business/PulseBlocks.jsx']) {
    assert.ok(!/cfo-summary-sym|pulse-cash-mark/.test(code(f)),
      `${f} still renders an obsolete watermark class`);
  }
});

/* -- the Wallets zero state -------------------------------------------------
   The page has three states a reader can be in, and only one of them invites a
   first wallet. "No wallets" and "we could not find out" look identical in a
   component that only tracks a list, and the page used to conflate them: a failed
   load left wallets as [] with loading false, so a user whose request had just
   errored was told they had no accounts and asked to create one. */

t('the zero state is gated on a RESOLVED, empty collection', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /const resolvedEmpty = !loading && !loadError && wallets\.length === 0/,
    'resolvedEmpty is not defined as "not loading, not failed, and empty"');
  assert.match(acc, /\{resolvedEmpty && legacySources\.length === 0 && \(\s*<WalletsEmptyState/,
    'the zero state is not gated on resolvedEmpty');
  // The old gate tested only loading + length, which is what let a failed load
  // render as an empty workspace.
  assert.ok(!/!loading && wallets\.length === 0 && legacySources\.length === 0/.test(acc),
    'the old loading-only gate is still in place');
});

t('a failed load gets the error treatment, never the zero state', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /setLoadError\(true\)/, 'a failed load does not record the failure');
  assert.match(acc, /setLoadError\(false\)/, 'a retry does not clear the previous failure');
  assert.match(acc, /\{loadError && \(\s*<ErrorState/, 'there is no error treatment rendered');
  assert.match(acc, /onRetry=\{load\}/, 'the error state offers no retry');
});

t('the summary card never states a balance it does not know', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  // Rendered once the collection resolves - including when it resolved to
  // nothing - but never while loading and never after a failure.
  assert.match(acc, /\{!loading && !loadError && \(\s*<SummaryCard/,
    'the summary card is not gated on a resolved, successful load');
  // What it then SAYS is decided in one place, for the page and the preview both.
  assert.match(acc, /const summary = walletsSummary\(\{ wallets: filteredWallets, t, scopeLabel \}\)/,
    'the card content is not derived from the shared summary');
  const ws = code('client/src/pages/walletsSummary.jsx');
  assert.match(ws, /if \(!wallets \|\| wallets\.length === 0\)[\s\S]{0,400}accounts\.noWalletsYet/,
    'an empty collection does not get the zero-state supporting line');
  assert.match(ws, /formatCurrency\(0, WORKSPACE_DEFAULT_CURRENCY\)/,
    'an empty collection does not show a zero in the workspace currency');
});

t('the zero state calls the page own add-wallet action', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /<WalletsEmptyState t=\{t\} onAddWallet=\{openAdd\} \/>/,
    'the zero state is not wired to openAdd');
  const ws = code('client/src/pages/WalletsEmptyState.jsx');
  // It is a button that calls a prop. A second wallet form in here would be a
  // second wallet-creation flow to keep in step with the first.
  assert.match(ws, /onClick=\{onAddWallet\}/, 'the CTA does not call the passed action');
  assert.ok(!/useState|apiFetch|showForm|<form/.test(ws),
    'the zero-state component carries wallet-creation state of its own');
});

t('both amount formatters come from the shared money module', () => {
  const ws = code('client/src/pages/walletsSummary.jsx');
  assert.match(ws, /import \{ formatCurrency, compactAmount \} from '\.\.\/lib\/money'/,
    'the summary does not import the shared formatters');
  assert.match(ws, /compactAmount\(g\.total, g\.currency\) \|\| exact/,
    'the headline is not the compact figure falling back to the exact one');
  assert.match(ws, /const exact = formatCurrency\(g\.total, g\.currency\)/,
    'the exact figure is not derived from the shared formatter');
  // One implementation: Pulse must not keep a private copy of the compaction.
  const pulse = code('client/src/pages/business/PulseBlocks.jsx');
  assert.match(pulse, /import \{ compactIdr \} from '\.\.\/\.\.\/lib\/money'/,
    'PulseBlocks does not use the shared compactIdr');
  assert.ok(!/function compactIdr/.test(pulse),
    'PulseBlocks still defines its own compactIdr');
});

/* -- currency safety -------------------------------------------------------
   The release blocker: the page added balances of unlike currencies and labelled
   the result IDR, so one dollar account turned $1 000 into Rp 1 000. */

t('the cross-currency sums are gone, not merely unused', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  for (const gone of ['const totalBalance', 'const businessBalance',
                      'const personalBalance', 'const filteredBalance']) {
    assert.ok(!acc.includes(gone), `${gone} still exists and sums across currencies`);
  }
  assert.ok(!/wallets\.reduce\(\(s, w\) => s \+ \(w\.balance/.test(acc),
    'Accounts still adds every wallet balance together');
});

t('a total may only ever cover one currency', () => {
  const money = code('client/src/lib/money.js');
  // Grouping refuses anything that is not a currency code rather than defaulting.
  assert.match(money, /unknown\.push\(w\); continue;/,
    'walletsByCurrency does not set aside rows without a currency');
  assert.match(money, /\/\^\[A-Z\]\{3\}\$\//,
    'walletsByCurrency accepts something other than a currency code');
  const ws = code('client/src/pages/walletsSummary.jsx');
  // No total may ever span groups, in either the shipped card or the concepts.
  assert.ok(!/groups\.reduce/.test(ws), 'the summary adds group totals together');
});

t('only currencies with a provable native balance are totalled', () => {
  // Accounts reads the BUSINESS endpoint, whose balance is a sum of amount_idr —
  // the IDR-reporting column. That is the wallet's native balance for an IDR
  // wallet and is not for any other, so a USD wallet must not be given a "$"
  // figure derived from it. Today IDR is the only provable currency.
  const contract = code('client/src/lib/walletBalanceContract.js');
  assert.match(contract, /export const PROVEN_NATIVE_CURRENCIES = \['IDR'\]/,
    'the set of currencies with provable native balances is not declared, or is not IDR-only');
  const ws = code('client/src/pages/walletsSummary.jsx');
  assert.match(ws, /const \{ proven, unproven, unknown \} = partitionWallets\(wallets\)/,
    'the card does not split wallets by whether their balance is provable');
  // Nothing but `proven` may reach a printed figure.
  assert.match(ws, /const g = proven\[0\]/, 'the headline is not taken from a proven currency');
  assert.ok(!/unproven\[0\]|unproven\.map\(\(g\) => formatCurrency/.test(ws),
    'an unproven currency is given a printed amount');
  // And when nothing is provable the card prints no number at all.
  assert.match(ws, /if \(proven\.length === 0\)[\s\S]{0,300}noProvenBalance/,
    'a workspace with no provable currency still prints a figure');
});

t('a wallet whose balance cannot be vouched for shows no amount', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /\{grp \? formatCurrency\(w\.balance \|\| 0, grp\.currency\) : '—'\}/,
    'a row prints an amount for a wallet whose unit is not provable');
  assert.match(acc, /accounts\.balanceUnavailable/,
    'a row does not say why the balance is missing');
});

t('the future multi-currency model is preview-only', () => {
  // walletsSummaryByCurrency renders the approved future model. It must not be
  // reachable from a production page until native balances exist — and better
  // than "no page calls it", it must not be in the production bundle at all.
  const prod = ['client/src/pages/Accounts.jsx', 'client/src/pages/business/index.jsx',
                'client/src/pages/personal/index.jsx', 'client/src/pages/PersonalDashboard.jsx',
                'client/src/pages/walletsSummary.jsx'];
  for (const f of prod) {
    assert.ok(!/walletsSummaryByCurrency/.test(code(f)),
      `${f} references the future multi-currency model before the backend supports it`);
  }
  // Only the gated preview imports it, so it can still be reviewed.
  assert.match(code('client/src/pages/DesignPreview.jsx'),
    /import \{ walletsSummaryByCurrency \} from '\.\/walletsSummaryConcepts'/,
    'the preview does not import the concepts module');
  // And it lives in a module nothing shipped imports.
  const importers = ['client/src/pages/Accounts.jsx', 'client/src/pages/walletsSummary.jsx',
                     'client/src/pages/WalletCurrencyField.jsx'];
  for (const f of importers) {
    assert.ok(!/walletsSummaryConcepts/.test(code(f)),
      `${f} imports the preview-only concepts module`);
  }
  // Its STYLES are preview-only too. shell.css is in every production bundle, so
  // a rule left there for an inactive feature ships for nothing — and dead rules
  // for an inactive feature are how one quietly becomes active.
  const shell = read('client/src/shell/shell.css');
  assert.ok(!/cur-aside|cfo-cur-list|cfo-cur-row/.test(shell),
    'shell.css still carries the future multi-currency styles');
  assert.match(read('client/src/pages/DesignPreview.css'), /\.dsp-cur-aside\{/,
    'the future model has no styles in the preview stylesheet');
});

t('only Alternative 2 survives as the approved future model', () => {
  const concepts = code('client/src/pages/walletsSummaryConcepts.jsx');
  // The rejected shape put every currency inside one navy section as peers, on a
  // `variant` switch. Both are gone: there is one approved model, not a menu.
  assert.ok(!/variant/.test(concepts), 'the concepts module still switches between shapes');
  assert.ok(!/grouped/.test(concepts), 'the rejected grouped alternative is still here');
  // What survives: base currency primary in the flagship, the rest returned
  // separately for the caller to render beside it, and no combined figure.
  assert.match(concepts, /const head = ordered\[0\]/, 'no primary/base currency branch');
  assert.match(concepts, /secondary: rest\.length \? rest : null/,
    'the other currencies are not returned separately');
  assert.ok(!/reduce/.test(concepts), 'the concepts module totals across currencies');
  // And the reasoning is written down where the next person will read it.
  const doc = read('client/src/pages/walletsSummaryConcepts.jsx');
  for (const claim of [/visually primary/, /separately/i, /no combined grand total/i,
                       /native-balance backend|derives native/i]) {
    assert.match(doc, claim, `the approved model's rationale does not state: ${claim}`);
  }
});

t('wallet currency is required, ISO-only and immutable once created', () => {
  const f = code('client/src/pages/WalletCurrencyField.jsx');
  // Chosen from a fixed list, never typed: no free-text input in this control.
  assert.ok(!/<input/.test(f), 'the currency control accepts typed input');
  assert.match(f, /currencies\.map/, 'the currency control is not driven by a fixed list');
  // Code AND readable name.
  assert.match(f, /CURRENCY_NAMES\[c\] \|\| c/, 'the readable currency name is not offered');
  assert.match(f, /aria-label=\{`\$\{c\} — \$\{CURRENCY_NAMES\[c\] \|\| c\}`\}/,
    'the control has no accessible name carrying code and currency name');
  // Unproven currencies visible but not selectable; an existing wallet locked.
  assert.match(f, /PROVEN_NATIVE_CURRENCIES\.includes\(c\) && !locked/,
    'the control lets an unproven or existing-wallet currency be chosen');
  assert.match(f, /disabled=\{!selectable\}/, 'unavailable currencies are not disabled');
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /locked=\{!!editWallet\}/,
    'editing a wallet does not lock its currency');
});

t('no currency symbol is hardcoded outside the money module', () => {
  for (const f of ['client/src/pages/Accounts.jsx', 'client/src/pages/walletsSummary.jsx']) {
    const src2 = code(f);
    assert.ok(!/'Rp '|"Rp "/.test(src2), `${f} writes "Rp" by hand`);
  }
  // The one place a currency is named without a wallet to read it from, and it is
  // only ever used for a zero.
  const ws = code('client/src/pages/walletsSummary.jsx');
  // Declaration, the empty-state zero, and the future model's base-currency
  // default. Nowhere else may name a currency without a wallet to read it from.
  // Declared once in the contract module; used in the summary only for the
  // empty-state zero and the future model's base default.
  const contract = code('client/src/lib/walletBalanceContract.js');
  assert.match(contract, /export const WORKSPACE_DEFAULT_CURRENCY = 'IDR'/,
    'the workspace default currency is not declared in the contract module');
  // Import, re-export, and the empty-state zero. Nothing else in the shipped
  // summary may name a currency without a wallet to read it from.
  const uses = (ws.match(/WORKSPACE_DEFAULT_CURRENCY/g) || []).length;
  assert.strictEqual(uses, 3, `WORKSPACE_DEFAULT_CURRENCY appears ${uses} times in the summary, expected 3`);
  assert.match(ws, /value: <span className="fin">\{formatCurrency\(0, WORKSPACE_DEFAULT_CURRENCY\)\}/,
    'the workspace default currency is used for something other than the empty-state zero');
});

t('a wallet row shows its own currency and its own share', () => {
  const acc = code('client/src/pages/Accounts.jsx');
  assert.match(acc, /formatCurrency\(w\.balance \|\| 0, grp\.currency\)/,
    'a wallet row does not render its balance in its own currency');
  assert.match(acc, /grp && grp\.total > 0/,
    'a wallet share is still measured against a mixed total');
  assert.match(acc, /accounts\.needsCurrency/,
    'a wallet with no currency is not flagged for review');
});

t('an abbreviated headline is marked as one so it cannot wrap', () => {
  const ui = code('client/src/shell/ui.jsx');
  assert.match(ui, /compact = false/, 'SummaryCard has no compact prop, or it defaults on');
  assert.match(ui, /cfo-summary-value\$\{compact \? ' is-compact' : ''\}/,
    'the compact prop does not reach the value element');
  const css = read('client/src/shell/shell.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(css, /\.cfo-summary-value\.is-compact\{[^}]*white-space:nowrap/,
    'an abbreviated headline is still allowed to wrap');
});

t('the rejected ambient background mark is nowhere in the product', () => {
  // Variant B put one oversized CFO AI symbol in the empty background under the
  // Wallets card. It was reviewed and rejected: no ambient background logo behind
  // wallet lists, tables, charts or financial data.
  for (const f of ['client/src/pages/DesignPreview.jsx', 'client/src/pages/DesignPreview.css',
                   'client/src/shell/shell.css', 'client/src/pages/Accounts.jsx',
                   'client/src/pages/WalletsEmptyState.jsx']) {
    const src = code(f);
    assert.ok(!/dsp-exp|bgmark|params\.get\('exp'\)/.test(src),
      `${f} still carries the rejected ambient-background experiment`);
  }
  const css = read('client/src/pages/DesignPreview.css');
  assert.ok(!/dsp-exp/.test(css), 'DesignPreview.css still styles the experiment');
  // And no page-level query parameter survives to switch it back on.
  assert.ok(!/exp=/.test(read('tests/design/captureScreenshots.mjs')),
    'the capture script still shoots the rejected variant');
});

t('the preview renders the real zero state, not a copy of it', () => {
  const dp = code('client/src/pages/DesignPreview.jsx');
  assert.match(dp, /import \{ WalletsEmptyState \} from '\.\/WalletsEmptyState'/,
    'the preview does not import the production zero state');
  // The copy comes out of the same translation file the page reads, so the two
  // cannot drift the way the hand-written concept did.
  assert.match(dp, /import en from '\.\.\/i18n\/en'/,
    'the preview does not read its copy from the translation layer');
  assert.ok(!/Your wallets will live here|Add your first wallet/.test(dp),
    'the preview has its own copy of the zero-state wording');
  // Both states come from one component taking a wallet collection, which is what
  // makes "populated" and "empty" the same branch the product takes.
  assert.match(dp, /const AccountsBody = \(\{ wallets = WALLETS_FIXTURE \}\)/,
    'the preview does not drive Wallets from a wallet collection');
  assert.match(dp, /shell=accounts-empty|'accounts-empty'/,
    'the preview has no empty-Wallets route');
});

t('the preview fixture cannot show a balance and an empty state at once', () => {
  const dp = code('client/src/pages/DesignPreview.jsx');
  // The rejected concept rendered the zero state underneath a card claiming four
  // wallets and Rp 152 450 000. Card and zero state now both follow the array.
  assert.match(dp, /const summary = walletsSummary\(\{/,
    'the card is not derived from the production summary');
  assert.match(dp, /\{wallets\.length === 0 && <WalletsEmptyState/,
    'the zero state is not gated on the collection being empty');
  assert.ok(!/idr\(152450000\)|meta="IDR · 4 wallets"/.test(dp),
    'the preview still hardcodes a populated total or wallet count');
  // And it can demonstrate every currency case, from the same component.
  for (const set of ['WALLETS_USD', 'WALLETS_MIXED', 'WALLETS_NEEDS_CURRENCY']) {
    assert.ok(dp.includes(set), `the preview cannot demonstrate ${set}`);
  }
});

/* -- Radar, migrated --------------------------------------------------------
   Radar was the last page outside the shared system: its own header, an inline
   linear-gradient hero with a graph-paper grid built from repeating-linear-
   gradient, and hf-card panels. PR #80 deferred it because migrating it is a
   rewrite, not a prop. These assert the rewrite landed and stayed inside the
   existing foundation rather than starting a second one. */

t('Radar uses the shared page hero and the shared flagship card', () => {
  const blocks = code('client/src/pages/RadarBlocks.jsx');
  assert.match(blocks, /from '\.\.\/shell\/ui'/, 'Radar does not import the shared components');
  assert.match(blocks, /<PageHeader/, 'Radar does not use the shared PageHeader');
  assert.match(blocks, /<SummaryCard\s+flagship/,
    'Radar headline is not the shared flagship SummaryCard');
  // Exactly one flagship on the page: the watermark is the brand moment, and two
  // of them in one content area is the rule PR #80 exists to enforce.
  assert.strictEqual((blocks.match(/flagship/g) || []).length, 1,
    'Radar renders more than one flagship card');
});

t('Radar no longer paints its own navy, gradient or graph paper', () => {
  for (const f of ['client/src/pages/Radar.jsx', 'client/src/pages/RadarBlocks.jsx']) {
    const src2 = code(f);
    assert.ok(!/linear-gradient|repeating-linear-gradient/.test(src2),
      `${f} still paints a gradient or a graph-paper grid`);
    assert.ok(!/hf-page-header|hf-card|hf-badge/.test(src2),
      `${f} still uses the legacy hf- surfaces`);
    assert.ok(!/#1e2d4a|#0F172A/i.test(src2), `${f} still hardcodes a navy`);
  }
  // And it did not start a private design system either: Radar.css may lay the
  // page out, but it must not declare tokens or restyle shared components.
  const css = read('client/src/pages/Radar.css');
  assert.ok(!/--(brand|surface|text|border|shadow|radius|success|warning|danger)-/.test(
    css.replace(/var\(--[a-z-]+\)/g, '')), 'Radar.css declares design tokens of its own');
  assert.ok(!/\.cfo-[a-z-]+\s*\{/.test(css), 'Radar.css restyles a shared component');
});

t('Radar keeps the brand asset, at the size an empty state uses', () => {
  const blocks = code('client/src/pages/RadarBlocks.jsx');
  // The one symbol on the page comes from the shipped /brand pipeline. Nothing
  // is drawn in CSS, and there is no page-sized background logo.
  assert.match(blocks, /RADAR_SYMBOL = '\/brand\/symbol_[a-z_]+\.svg'/,
    'Radar does not use an official brand asset');
  assert.ok(!/backgroundImage|background-image/.test(blocks),
    'Radar paints a background image — the rejected giant-logo pattern');
  // The flagship watermark comes from the shared card, never hand-placed.
  assert.ok(!/FlagshipMark/.test(blocks),
    'Radar hand-places the watermark instead of letting SummaryCard own it');
});

t('Radar keeps all three scenarios, and its arithmetic left the component', () => {
  const blocks = code('client/src/pages/RadarBlocks.jsx');
  for (const key of ['radar.bestCaseFull', 'radar.worstCaseFull', 'radar.projectedBalance30']) {
    assert.ok(blocks.includes(key), `Radar no longer shows ${key}`);
  }
  // The figures moved to a plain module so they can be pinned by a unit test —
  // see radarFigures.test.mjs. The component must not recompute them.
  const fig = code('client/src/lib/radarFigures.js');
  assert.match(fig, /proj30\s*=\s*balance \+ totalIn - totalOut - burnRate \* 30/,
    'the expected-case formula changed');
  assert.match(fig, /projBest\s*=\s*balance \+ totalIn - totalOut \* 0\.5/,
    'the best-case formula changed');
  assert.match(fig, /projWorst\s*=\s*balance - totalOut - burnRate \* 30/,
    'the worst-case formula changed');
  assert.ok(!/proj30\s*=|projBest\s*=|projWorst\s*=/.test(blocks),
    'RadarBlocks recomputes the forecast instead of taking it from radarFigures');
});

t('Radar changed no data source and no backend call', () => {
  const radar = code('client/src/pages/Radar.jsx');
  // One endpoint, unchanged, and no write of any kind from this page.
  const calls = radar.match(/apiFetch\([^)]*\)/g) || [];
  assert.strictEqual(calls.length, 1, `Radar makes ${calls.length} API calls, expected 1`);
  assert.match(calls[0], /'\/pulse\?scope=business'/, `Radar now calls ${calls[0]}`);
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(radar),
    'Radar performs a write — it is a read-only forecast');
});

/* -- AI CFO, migrated -------------------------------------------------------
   AI CFO was the last BUSINESS page outside the shared system, and the last
   consumer of .hf-dark-card — the #0F172A gradient with a graph-paper grid built
   from two repeating-linear-gradients. #0F172A is the legacy navy PR #80 traced
   to index.css re-declaring the token, so this page shipped the wrong navy on
   top of a second treatment of a surface SummaryCard already owns.

   Unlike Radar, this page computes no financial figure at all: the CFO Score,
   its five factors, the alert, the hiring verdict, the risks and the next
   actions are server output. So what these assert is that the migration was
   visual — that the page still shows every one of those, still calls the same
   two endpoints, and did not acquire arithmetic of its own on the way. */

t('AI CFO uses the shared page hero and the shared flagship card', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  assert.match(blocks, /from '\.\.\/shell\/ui'/, 'AI CFO does not import the shared components');
  assert.match(blocks, /<PageHeader/, 'AI CFO does not use the shared PageHeader');
  assert.match(blocks, /<SummaryCard\s+flagship/,
    'AI CFO headline is not the shared flagship SummaryCard');
  // Exactly one flagship on the page. Two brand moments in one content area is
  // the rule PR #80 exists to enforce.
  assert.strictEqual((blocks.match(/flagship/g) || []).length, 1,
    'AI CFO renders more than one flagship card');
  // The eyebrow, title and description the migration specified.
  assert.match(blocks, /eyebrow="Business Workspace"/, 'AI CFO lost its eyebrow');
  assert.match(blocks, /title=\{t\('aicfo\.title'\)\}/, 'AI CFO title is not the translated page title');
  assert.match(blocks, /description=\{t\('aicfo\.subtitle'\)\}/, 'AI CFO lost its description');
});

t('the old graph-paper hero is gone from the page AND from the stylesheet', () => {
  for (const f of ['client/src/pages/AICFO.jsx', 'client/src/pages/AICFOBlocks.jsx']) {
    const src2 = code(f);
    assert.ok(!/linear-gradient|repeating-linear-gradient/.test(src2),
      `${f} still paints a gradient or a graph-paper grid`);
    assert.ok(!/hf-dark-card|cfo-dark-card/.test(src2), `${f} still uses the dark hero card`);
    assert.ok(!/hf-page-header|hf-card|hf-kpi|hf-section-title|hf-badge/.test(src2),
      `${f} still uses the legacy hf- surfaces`);
    assert.ok(!/#0F172A|#1e293b|#1D4ED8|#2563EB|#F87171|#34D399|#FBBF24/i.test(src2),
      `${f} still hardcodes a colour instead of using a semantic token`);
  }
  // AI CFO was the LAST consumer, so the class itself is gone rather than left
  // in the stylesheet for the next page to find and use.
  // Comments stripped, for the same reason code() strips them from JS: the note
  // explaining what was deleted names the thing it deleted.
  const sys = cssCode('client/src/hf-system.css');
  assert.ok(!/\.(hf|cfo)-dark-card[\s,{]/.test(sys),
    '.hf-dark-card / .cfo-dark-card is still declared in hf-system.css');
  assert.ok(!/repeating-linear-gradient\s*\(/.test(sys),
    'hf-system.css still builds a graph-paper grid');
  // No page anywhere may reach for it again.
  for (const f of ['client/src/pages/AICFO.jsx', 'client/src/pages/AICFOBlocks.jsx',
    'client/src/pages/Radar.jsx', 'client/src/pages/RadarBlocks.jsx']) {
    assert.ok(!/dark-card/.test(code(f)), `${f} references the deleted dark card`);
  }
});

t('AI CFO did not start a design system of its own', () => {
  const css = cssCode('client/src/pages/AICFO.css');
  assert.ok(!/--(brand|surface|text|border|shadow|radius|success|warning|danger|info)-[a-z]*\s*:/.test(
    css.replace(/var\(--[a-z-]+\)/g, '')), 'AICFO.css declares design tokens of its own');
  assert.ok(!/^\.cfo-[a-z-]+\s*\{/m.test(css), 'AICFO.css restyles a shared component');
  // Semantic colour comes from the tokens, never from a literal. #fff is the one
  // exception: white on the navy avatar and the navy chat bubble is not a theme
  // decision, it is the only legible ink on that surface.
  assert.ok(!/#[0-9a-f]{3,8}/i.test(css.replace(/#fff\b/gi, '')),
    'AICFO.css hardcodes a colour instead of using a token');
});

t('AI CFO carries the official watermark, and only from the shared card', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  // The flagship watermark is SummaryCard's, never hand-placed and never restyled.
  assert.ok(!/FlagshipMark/.test(blocks),
    'AI CFO hand-places the watermark instead of letting SummaryCard own it');
  assert.ok(!/cfo-flagship-mark/.test(blocks), 'AI CFO restyles the shared watermark');
  // The empty state uses the shipped brand asset at the size an empty state uses
  // it — not a page-sized decorative logo.
  assert.match(blocks, /AICFO_SYMBOL = '\/brand\/symbol_[a-z_]+\.svg'/,
    'AI CFO does not use an official brand asset');
  assert.ok(!/backgroundImage|background-image/.test(blocks),
    'AI CFO paints a background image — the rejected giant-logo pattern');
  const css = read('client/src/pages/AICFO.css');
  assert.ok(!/background-image/.test(css), 'AICFO.css paints a background image');
});

t('every money figure names its currency; days and scores do not', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  // The currency comes from the workspace context through the shared helper,
  // never from a literal "Rp" — which is what would relabel dollars as rupiah.
  assert.match(blocks, /import \{ currencyPrefix \} from '\.\.\/lib\/money'/,
    'AI CFO does not use the shared currencyPrefix()');
  assert.ok(!/'Rp[ '"]/.test(blocks), 'AI CFO hardcodes a currency symbol');
  const fig2 = code('client/src/lib/aiCfoFigures.js');
  assert.match(fig2, /export const money = \(v, currency\) => currencyPrefix\(currency\) \+ fmt\(v\)/,
    'the money helper no longer pairs currencyPrefix with the page own fmt()');
  // The formatter itself is untouched: fmt/fmtFull, not money.js compactAmount,
  // which rounds half-up where fmt does not and would move a printed digit.
  // aiCfoValuePreservation.test.mjs renders both over one fixture and compares.
  assert.match(fig2, /import \{ fmt, fmtFull \} from '\.\/api\.js'/,
    'AI CFO changed its formatter');
  assert.ok(!/compactAmount|compactIdr/.test(fig2),
    'the figures module switched to a formatter that rounds differently');
  assert.ok(!/compactAmount|compactIdr/.test(blocks),
    'AI CFO switched to a formatter that rounds differently');
  // Runway is days and the score is a score. Neither takes a currency.
  assert.match(blocks, /\$\{runway\} \$\{t\('radar\.days'\)\}/,
    'the runway is no longer rendered as a plain number of days');
  assert.ok(!/money\([^)]*runway|currencyPrefix[^\n]*runway/.test(blocks),
    'the runway was given a currency prefix');
  assert.ok(!/money\([^)]*\bscore\b/.test(blocks), 'the CFO score was given a currency prefix');
});

t('no financial figure or threshold moved into the page', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  const page = code('client/src/pages/AICFO.jsx');
  // Every figure is server output. The page must not recompute a score, a
  // weight or a runway of its own.
  for (const src2 of [blocks, page]) {
    assert.ok(!/\*\s*0\.(25|20|15)|score\s*=\s*Math\.round/.test(src2),
      'the CFO Score weighting appeared in the frontend');
    assert.ok(!/burnRate\s*\*\s*30|balance\s*\/\s*burn/.test(src2),
      'the page started deriving runway or burn itself');
  }
  // The display thresholds live in a plain module so they can be pinned — see
  // aiCfoFigures.test.mjs — and the components must read them from there.
  const fig = code('client/src/lib/aiCfoFigures.js');
  assert.match(fig, /score >= 75/, 'the healthy score boundary changed');
  assert.match(fig, /score >= 50/, 'the attention score boundary changed');
  assert.match(fig, /days < 7/, 'the critical runway boundary changed');
  assert.match(fig, /days < 14/, 'the attention runway boundary changed');
  assert.match(fig,
    /Math\.max\(0, access\.limits\.max_ai_questions_per_month - \(access\?\.usage\?\.ai_questions_this_month \?\? 0\)\)/,
    'the AI question arithmetic changed');
  assert.ok(!/>= 75|>= 50|< 7\b|< 14\b/.test(blocks),
    'AICFOBlocks re-declares a threshold instead of taking it from aiCfoFigures');
});

t('AI CFO still shows every block the decision layer produces', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  for (const key of [
    'aicfo.cfoScore', 'aicfo.aiAlert', 'aicfo.hiringReadiness', 'aicfo.safeSalary',
    'aicfo.askCFO', 'aicfo.riskSummary', 'aicfo.nextBestActions', 'aicfo.askAICFO',
    'aicfo.receivables', 'aicfo.payables', 'aicfo.income', 'aicfo.expenses',
  ]) {
    assert.ok(blocks.includes(key), `AI CFO no longer shows ${key}`);
  }
  // All five factors, in the engine's own order.
  const fig = code('client/src/lib/aiCfoFigures.js');
  for (const f of ['cash_health', 'runway', 'payables', 'receivables', 'expense_control']) {
    assert.ok(fig.includes(f), `the ${f} factor was dropped`);
  }
  // Alert and hiring stay two independent cards, side by side and stacking.
  assert.match(blocks, /cfo-grid cfo-grid-2 aicfo-signals/,
    'the alert and hiring readiness are no longer two independent cards');
});

t('AI CFO changed no data source, no endpoint and no gate', () => {
  const page = code('client/src/pages/AICFO.jsx');
  const calls = page.match(/apiFetch\([^)]*\)/g) || [];
  assert.strictEqual(calls.length, 2, `AI CFO makes ${calls.length} API calls, expected 2`);
  assert.ok(calls.some((c) => /ai-cfo\/context/.test(c)), 'the context endpoint changed');
  assert.ok(calls.some((c) => /'\/ai-cfo\/ask'/.test(c)), 'the ask endpoint changed');
  // The ask is the page's only write, and it is the one it always made.
  const writes = page.match(/method:\s*'(POST|PUT|PATCH|DELETE)'/g) || [];
  assert.strictEqual(writes.length, 1, `AI CFO performs ${writes.length} writes, expected 1`);
  // Plan gating is untouched: same limit source, same blocking condition.
  assert.match(page, /e\.upgrade_required \|\| e\.message\?\.includes\('limit'\)/,
    'the question-limit gate condition changed');
  assert.match(page, /aiQuestionsLeft\(access\)/, 'the question allowance is no longer read from access');
  assert.ok(!/hasFeature|isOverLimit/.test(page),
    'AI CFO started gating on a feature flag it did not gate on before');
});

t('AI CFO never presents a verdict with nothing behind it', () => {
  const page = code('client/src/pages/AICFO.jsx');
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  // The engine scores an untouched workspace at 72. The page withholds the
  // verdict; the engine is not changed.
  assert.match(page, /hasNoFinancialData\(ctx\)/,
    'the page no longer checks whether there is anything to assess');
  // Wallets are deliberately not part of the test: every factor the engine
  // scores comes from transaction history, so wallets with nothing imported give
  // it no more to work with than an untouched workspace. See aiCfoFigures.js.
  const fig3 = code('client/src/lib/aiCfoFigures.js');
  const start = fig3.indexOf('export function hasNoFinancialData');
  assert.ok(start > -1, 'hasNoFinancialData is gone');
  const body = fig3.slice(start, fig3.indexOf('export default', start));
  assert.ok(!/wallets_count/.test(body),
    'hasNoFinancialData counts wallets, so a workspace with wallets and no transactions is still scored');
  assert.match(page, /<AICFOEmpty/, 'the no-data empty state was removed');
  assert.match(blocks, /<EmptyState/, 'the empty state is not the shared component');
  // And the empty branch must not also render the score.
  const emptyBranch = page.slice(page.indexOf('hasNoFinancialData(ctx)'));
  const branchEnd = emptyBranch.indexOf('  return (');
  assert.ok(!/AICFOScore|AICFOSignals|AICFOFigures/.test(emptyBranch.slice(0, branchEnd)),
    'the no-data branch still renders the score or the figures');
});

t('AI CFO has a real loading state and a real error state with a retry', () => {
  const page = code('client/src/pages/AICFO.jsx');
  assert.match(page, /<LoadingSkeleton/, 'the loading state is not the shared skeleton');
  assert.match(page, /<ErrorState[^>]*onRetry=\{loadCtx\}/,
    'a failed load has no retry — the page used to show a line of red text and no way out');
  // A refresh that fails must not blank the figures that are already on screen.
  assert.match(page, /ctxErr && !ctx/, 'an error replaces good data instead of sitting beside it');
  // And it must SAY they are stale. Printing the raw error and nothing else
  // leaves a stale page looking like a current one. The notice is a presentation
  // block, so the container renders it and AICFOBlocks defines it — which is
  // also what lets the preview photograph the state and renderedPreview measure
  // it (see "a failed refresh keeps the figures AND says they are the previous
  // ones" there).
  assert.match(page, /<AICFOStaleNotice[^>]*error=\{ctxErr\}/,
    'the container does not render the stale-data notice on a failed refresh');
  assert.match(page, /onRetry=\{loadCtx\}/, 'the stale-data notice offers no retry');
  const blocks2 = code('client/src/pages/AICFOBlocks.jsx');
  assert.match(blocks2, /export function AICFOStaleNotice/, 'the stale-data notice is missing');
  assert.match(blocks2, /aicfo\.refreshFailedStale/,
    'a failed refresh does not tell the reader the figures below are the previous ones');
  assert.match(blocks2, /className="aicfo-stale" role="alert"/,
    'the stale-data notice is not announced to assistive technology');
  // The figures must still be rendered beneath it — the notice sits BESIDE the
  // data, it does not replace it.
  const afterNotice = page.slice(page.indexOf('<AICFOStaleNotice'));
  assert.match(afterNotice, /<AICFOScore/, 'the stale branch stops rendering the score');
  assert.match(afterNotice, /<AICFOFigures/, 'the stale branch stops rendering the figures');
});

t('AI CFO navigates inside the business workspace', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  // The page is mounted at /business/ai-cfo inside BusinessShell, but every card
  // used to navigate to the bare legacy routes, throwing the user out of the
  // workspace they were standing in.
  for (const [key, route] of [
    ['receivables', '/business/receivables'], ['payables', '/business/payables'],
    ['radar', '/business/radar'], ['transactions', '/business/transactions'],
  ]) {
    assert.ok(blocks.includes(`${key}: '${route}'`), `${key} does not route to ${route}`);
  }
  // Exactly one bare route may remain, and it is not a destination at all:
  // the engine emits route:'/cfo' on a hiring action to mean "you are already on
  // that page", and the page filters it out rather than linking to itself.
  const legacy = [...new Set(blocks.match(/'\/(?!business\/)[a-z-]+'/g) || [])].sort();
  assert.deepStrictEqual(legacy, ["'/cfo'"],
    `AI CFO still leaves the workspace for ${legacy.join(', ')}`);
  assert.match(blocks, /a\.route !== '\/cfo'/, "the self-link guard on '/cfo' was dropped");
  // Add is the one that used to escape, and it was the empty state's only call
  // to action — a brand-new business's first click dropped it into the legacy
  // Layout, whose sidebar has no link back to /business/*.
  assert.ok(blocks.includes("add: '/business/add'"), 'the add destination left the workspace again');
  const app2 = code('client/src/App.jsx');
  assert.match(app2, /path="\/business\/add" element=\{<BusinessShell><Add \/><\/BusinessShell>\}/,
    '/business/add is not registered inside the business shell');
});

t('AI CFO uses the icon system rather than emoji', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  const page = code('client/src/pages/AICFO.jsx');
  // 16 emoji stood in for icons: severity dots, factor glyphs, action markers and
  // the assistant avatar. The shared set draws the same meanings at currentColor.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  for (const [f, src2] of [['AICFOBlocks.jsx', blocks], ['AICFO.jsx', page]]) {
    const hits = src2.split('\n').filter((l) => EMOJI.test(l));
    assert.strictEqual(hits.length, 0, `${f} still renders emoji: ${hits[0]}`);
  }
  assert.match(blocks, /Icon\.wallet|Icon\.pulse|Icon\.up|Icon\.down|Icon\.list/,
    'the factor rows do not use the shared icon set');
});

t('the AI question figure is labelled as an allowance, not a remaining count', () => {
  const blocks = code('client/src/pages/AICFOBlocks.jsx');
  // usage.ai_questions_this_month is hardcoded to 0 server-side, so the figure
  // never decrements. Calling it "remaining" claims a measurement that does not
  // exist anywhere in the product.
  assert.match(blocks, /t\('aicfo\.aiQuestionsPerMonth'\)/,
    'the AI question metric is not labelled as a monthly allowance');
  assert.ok(!/aicfo\.remaining/.test(blocks),
    'the page still calls the AI question figure a remaining count');
});

t('the preview renders the real AI CFO components against synthetic data', () => {
  // The same rule the rest of this file enforces: a screenshot must photograph
  // the product, not a drawing of it.
  assert.match(src, /from '\.\/AICFOBlocks'/, 'the preview does not import the real AI CFO blocks');
  assert.match(src, /<AICFOSummary/, 'the preview draws its own summary card');
  assert.match(src, /<AICFOScore/, 'the preview draws its own score block');
  // The empty-state decision is the production function, not a copy of the rule,
  // so the preview cannot show a state the page would never reach.
  assert.match(src, /hasNoFinancialData\(data\)/,
    'the preview decides the empty state with its own rule');
  assert.match(src, /aiQuestionsLeft\(access\)/, 'the preview computes the allowance itself');
  // Deterministic language: the engine strings pass through localizeInsight(),
  // which otherwise follows whatever language the developer has stored.
  assert.match(src, /lang="en"/, 'the preview does not pin the language, so shots are not deterministic');
  // Every fixture is invented, and none of them is a real business.
  assert.ok(!/Helm Care|PT Helm/i.test(src), 'the preview names a real business');
});

t('the page-hero mark sits inside the band rather than off its edge', () => {
  const css = read('client/src/shell/shell.css');
  const m = css.match(/\.cfo-pagehead-mark\s*\{([^}]*)\}/g) || [];
  const rule = m.find((r) => /position:absolute/.test(r));
  assert.ok(rule, '.cfo-pagehead-mark has no positioned rule');
  const right = ((rule.match(/right:\s*([^;]+)/) || [])[1] || '').trim();
  // A negative length (or a calc that negates one) hangs the mark off the band edge,
  // which is what made it read as an icon clipped by the layout.
  assert.ok(!/^-/.test(right) && !/\*\s*-1/.test(right),
    `the mark is offset ${right} — a negative inset clips it against the edge`);
});

console.log('\ndesign preview — the accessible action colour is actually used');

t('the primary button consumes the action token, not the raw brand accent', () => {
  // white on --brand-electric-blue (#3399FF) is 2.94:1 and fails AA. The token
  // layer defines --action-primary for exactly this reason; the button has to use it.
  const shell = read('client/src/shell/shell.css');
  const rule = shell.match(/\.cfo-btn-primary\s*\{([^}]*)\}/);
  assert.ok(rule, '.cfo-btn-primary not found');
  assert.match(rule[1], /background:\s*var\(--action-primary\)/,
    '.cfo-btn-primary must use var(--action-primary)');
  assert.ok(!/--brand-electric-blue/.test(rule[1]),
    '.cfo-btn-primary must not paint itself with the raw brand accent');
});

t('Settings is a footer utility, not a navigation item', () => {
  const shellSrc = code('client/src/shell/WorkspaceShell.jsx');
  assert.ok(!/key:\s*'settings'[^}]*icon:/.test(shellSrc),
    'Settings is still declared as a nav item with an icon');
  assert.match(shellSrc, /SETTINGS_DESTINATION/,
    'there is no declared settings destination');
  assert.match(shellSrc, /className="cfo-side-settings"/,
    'the sidebar footer utility is missing');
  // Team manages people; settings manages configuration. Both must exist.
  assert.match(shellSrc, /key: 'team'/, 'the Team nav item was removed');
});

t('the footer utility keeps the routes the nav items used', () => {
  const shellSrc = code('client/src/shell/WorkspaceShell.jsx');
  assert.match(shellSrc, /to: '\/business\/settings'/, 'business settings route lost');
  assert.match(shellSrc, /to: '\/personal\/settings'/, 'personal settings route lost');
});

t('page-header context badges do not share the mobile full-width action grid', () => {
  const ui = code('client/src/shell/ui.jsx');
  assert.match(ui, /className="cfo-pagehead-context"/,
    'context badges need their own box, or the mobile grid stretches them edge to edge');
  const right = ui.match(/cfo-pagehead-right[\s\S]*?<\/div>\s*\)\}/);
  assert.ok(right && !/\{context\}[\s\S]{0,40}className="cfo-pagehead-actions"/.test(ui),
    'context must not be rendered inside the actions box');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
