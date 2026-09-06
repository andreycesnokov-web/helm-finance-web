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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Source with comments stripped, so assertions about behaviour are not
 *  satisfied — or broken — by prose that merely describes it. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

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
  assert.match(ws, /import \{ formatCurrency, compactAmount, walletsByCurrency \} from '\.\.\/lib\/money'/,
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
  assert.match(ws, /if \(groups\.length === 1\)/, 'no single-currency branch');
  // More than one currency must not produce a combined figure anywhere.
  assert.ok(!/groups\.reduce/.test(ws), 'the summary adds group totals together');
  assert.match(ws, /accounts\.totalByCurrency/,
    'a multi-currency card does not say it is broken down by currency');
});

t('no currency symbol is hardcoded outside the money module', () => {
  for (const f of ['client/src/pages/Accounts.jsx', 'client/src/pages/walletsSummary.jsx']) {
    const src2 = code(f);
    assert.ok(!/'Rp '|"Rp "/.test(src2), `${f} writes "Rp" by hand`);
  }
  // The one place a currency is named without a wallet to read it from, and it is
  // only ever used for a zero.
  const ws = code('client/src/pages/walletsSummary.jsx');
  assert.match(ws, /export const WORKSPACE_DEFAULT_CURRENCY = 'IDR'/,
    'the workspace default currency is not declared in one named place');
  const uses = (ws.match(/WORKSPACE_DEFAULT_CURRENCY/g) || []).length;
  assert.strictEqual(uses, 2, `WORKSPACE_DEFAULT_CURRENCY is used ${uses - 1} times, not once`);
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

t('Radar is deferred, not half-migrated', () => {
  // Radar's hero is an inline-styled gradient card with a graph-paper grid, on the
  // legacy hf- classes rather than the shared design system. Giving it the
  // flagship mark means migrating the page, which is a redesign this PR is not.
  // The guard is that it stays untouched: no half-applied watermark, and no
  // shared class on a card that does not have the shared structure.
  const radar = code('client/src/pages/Radar.jsx');
  assert.ok(!/cfo-flagship|FlagshipMark/.test(radar),
    'Radar has been given the flagship watermark without being migrated to the shared card');
  assert.ok(!/SummaryCard|PageHeader/.test(radar),
    'Radar now imports the shared components — that is the migration, and it belongs to its own PR');
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
