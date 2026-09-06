// The money hierarchy the Wallets and Pulse headline cards share.
//
// Both cards show an ABBREVIATED figure as the headline and the EXACT figure
// underneath. That only works if the abbreviation is honest: it sits directly
// above the full number, so a reader can see the two disagree. It did — the card
// read "Rp 152.4M" over "Rp 152 450 000", because (152.45).toFixed(1) is "152.4"
// in binary floating point. These assertions pin the rounding, the units, the
// sign and the zero case so that cannot come back.
//
// Pure functions, no browser, no build. Run: node tests/design/walletsAmounts.test.mjs
import assert from 'node:assert';
import { compactIdr, compactAmount, formatAmount, formatCurrency,
         currencyPrefix, walletsByCurrency } from '../../client/src/lib/money.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  XX  ${name}\n      ${e.message}`); }
};

// The exact-amount helper both pages build their supporting line from.
const idr = (v) => 'Rp ' + formatAmount(String(v ?? 0), 'IDR');

console.log('\nwallets — the compact/exact amount pair');

t('the headline abbreviates and rounds half-up, like formatAmount does', () => {
  assert.strictEqual(compactIdr(152450000), 'Rp 152.5M',
    'the .45 case is exactly the one binary floating point gets wrong');
  assert.strictEqual(compactIdr(122850000), 'Rp 122.9M');
  assert.strictEqual(compactIdr(1234567), 'Rp 1.2M');
  assert.strictEqual(compactIdr(1000000), 'Rp 1.0M');
});

t('the abbreviation never contradicts the exact figure beneath it', () => {
  // Whatever the headline says, rounding the exact figure to one decimal of the
  // same unit has to produce the same string. This is the property the .45 bug
  // broke, and it is the reason the pair is safe to show together.
  for (const v of [1000000, 1234567, 152450000, 122850000, 999999999,
                   1500000000, 87654321, 2500000000000]) {
    const head = compactIdr(v);
    assert.ok(head, `${v} produced no headline`);
    const unit = { M: 1e6, B: 1e9, T: 1e12 }[head.slice(-1)];
    const shown = Number(head.replace('Rp ', '').slice(0, -1));
    // Within half a tenth of the unit — i.e. the headline is a correct rounding.
    assert.ok(Math.abs(shown * unit - v) <= unit / 20 + 1e-6,
      `${head} is not a correct rounding of ${v}`);
  }
});

t('zero is "Rp 0", never "Rp 0.0M"', () => {
  assert.strictEqual(compactIdr(0), null, 'zero must fall through to the exact formatter');
  assert.strictEqual(idr(0), 'Rp 0');
  // Anything under a million stays exact rather than becoming a rounded fraction.
  assert.strictEqual(compactIdr(999999), null);
  assert.strictEqual(compactIdr(0.4), null);
  assert.strictEqual(idr(850000), 'Rp 850 000');
});

t('a negative balance keeps its sign in both figures', () => {
  assert.strictEqual(compactIdr(-152450000), 'Rp -152.5M');
  assert.strictEqual(compactIdr(-1500000000), 'Rp -1.5B');
  assert.ok(idr(-152450000).startsWith('Rp -'), `exact negative reads ${idr(-152450000)}`);
});

t('rounding never tips a figure into a broken unit', () => {
  // 999 999 999 rounds to 1000.0 of a million, which must promote to 1.0B rather
  // than render "Rp 1000.0M".
  assert.strictEqual(compactIdr(999999999), 'Rp 1.0B');
  assert.strictEqual(compactIdr(999999999999), 'Rp 1.0T');
});

t('units step at a billion and a trillion', () => {
  assert.strictEqual(compactIdr(999000000), 'Rp 999.0M');
  assert.strictEqual(compactIdr(1500000000), 'Rp 1.5B');
  assert.strictEqual(compactIdr(2500000000000), 'Rp 2.5T');
});

t('a bad value is declined rather than guessed at', () => {
  assert.strictEqual(compactIdr(NaN), null);
  assert.strictEqual(compactIdr(Infinity), null);
  assert.strictEqual(compactIdr(undefined), null);
  assert.strictEqual(compactIdr(null), null);
});

console.log('\nwallets — the count in the supporting line');

// The page builds this from the translation layer; the grammar rule is what
// matters, and "1 wallets" is the classic way it goes wrong.
import enDict from '../../client/src/i18n/en.js';
const countLabel = (n) => (n === 1
  ? enDict.accounts.walletsCountOne
  : enDict.accounts.walletsCountMany.replace('{n}', n));

t('one wallet is singular, everything else is plural', () => {
  assert.strictEqual(countLabel(1), '1 wallet');
  assert.strictEqual(countLabel(2), '2 wallets');
  assert.strictEqual(countLabel(4), '4 wallets');
  assert.strictEqual(countLabel(0), '0 wallets');
  assert.strictEqual(countLabel(21), '21 wallets');
});

t('the zero-state supporting line does not count wallets at all', () => {
  // An empty workspace says "No wallets added yet" rather than "0 wallets" —
  // a count of zero invites the reader to wonder where they went.
  assert.strictEqual(enDict.accounts.noWalletsYet, 'No wallets added yet');
});

t('the approved zero-state copy is what ships', () => {
  assert.strictEqual(enDict.accounts.noWallets, 'Your wallets will live here');
  assert.strictEqual(enDict.accounts.noWalletsSub,
    'Add a bank account, cash balance or payment wallet to start tracking balances '
    + 'across every currency in one place.');
  assert.strictEqual(enDict.accounts.addFirstWallet, 'Add your first wallet');
});

console.log('\ncurrency safety — a total may only ever cover one currency');

/* The release blocker: Accounts added every wallet's balance together and labelled
   the result IDR, so a single dollar account turned $1 000 into Rp 1 000 inside
   the headline. There is no exchange rate anywhere in this product that could
   value one currency in another, so the fix is not conversion — it is refusing to
   add unlike things. */

const w = (currency, balance, id) => ({ id: id || currency + balance, currency, balance });

t('IDR and USD balances are never added together', () => {
  const { groups } = walletsByCurrency([w('IDR', 152450000), w('USD', 1000), w('IDR', 50000)]);
  assert.strictEqual(groups.length, 2, 'two currencies did not produce two groups');
  const idrG = groups.find((g) => g.currency === 'IDR');
  const usdG = groups.find((g) => g.currency === 'USD');
  assert.strictEqual(idrG.total, 152500000);
  assert.strictEqual(usdG.total, 1000);
  // The thing that must never exist: one number covering both.
  assert.ok(!groups.some((g) => g.total === 152451000),
    'a combined cross-currency total was produced');
});

t('a currency total includes only the wallets of that currency', () => {
  const { groups } = walletsByCurrency([
    w('IDR', 100, 'a'), w('USD', 7, 'b'), w('IDR', 200, 'c'), w('EUR', 3, 'd')]);
  const idrG = groups.find((g) => g.currency === 'IDR');
  assert.deepStrictEqual(idrG.wallets.map((x) => x.id), ['a', 'c']);
  assert.strictEqual(idrG.total, 300);
  // And the count shown beside a total is the count of THOSE wallets.
  assert.strictEqual(countLabel(idrG.wallets.length), '2 wallets');
  assert.strictEqual(countLabel(groups.find((g) => g.currency === 'USD').wallets.length), '1 wallet');
});

t('a single-currency workspace still gets one plain total', () => {
  const { groups, unknown } = walletsByCurrency([
    w('IDR', 94200000), w('IDR', 38500000), w('IDR', 12750000), w('IDR', 7000000)]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(unknown.length, 0);
  assert.strictEqual(groups[0].total, 152450000);
  assert.strictEqual(compactAmount(groups[0].total, groups[0].currency), 'Rp 152.5M');
  assert.strictEqual(formatCurrency(groups[0].total, groups[0].currency), 'Rp 152 450 000');
});

t('a missing or malformed currency is set aside, never guessed', () => {
  const { groups, unknown } = walletsByCurrency([
    w('IDR', 100), w(null, 500), w('', 600), w('rupiah', 700), w(undefined, 800), w(12, 900)]);
  assert.strictEqual(groups.length, 1, 'something without a currency code was grouped anyway');
  assert.strictEqual(groups[0].total, 100, 'an unknown-currency balance leaked into a total');
  assert.strictEqual(unknown.length, 5, `${unknown.length} rows set aside, expected 5`);
  // Specifically: it must not fall back to the workspace default.
  assert.ok(!groups.some((g) => g.wallets.some((x) => !x.currency)),
    'a wallet with no currency was folded into a currency group');
});

t('currency case and padding do not create phantom currencies', () => {
  const { groups } = walletsByCurrency([w('idr', 1), w(' IDR ', 2), w('Idr', 3)]);
  assert.strictEqual(groups.length, 1, 'the same currency was split across groups');
  assert.strictEqual(groups[0].currency, 'IDR');
  assert.strictEqual(groups[0].total, 6);
});

t('each currency is written in its own notation, never another one', () => {
  assert.strictEqual(formatCurrency(1250000, 'USD'), '$1 250 000.00');
  assert.strictEqual(compactAmount(1250000, 'USD'), '$1.3M');
  assert.strictEqual(formatCurrency(152450000, 'IDR'), 'Rp 152 450 000');
  // The specific bug this guards: Rp in front of dollars.
  assert.ok(!formatCurrency(1000, 'USD').includes('Rp'), 'USD was written with Rp');
  assert.ok(!compactAmount(5000000, 'USD').includes('Rp'), 'USD was abbreviated with Rp');
  assert.ok(!formatCurrency(1000, 'IDR').includes('$'), 'IDR was written with a dollar sign');
  // A currency the product has not been taught is written as its code, not
  // borrowed from another currency's symbol.
  assert.strictEqual(formatCurrency(1200, 'CHF'), 'CHF 1 200.00');
});

t('zero and negatives are correct in every currency', () => {
  assert.strictEqual(formatCurrency(0, 'IDR'), 'Rp 0');
  assert.strictEqual(formatCurrency(0, 'USD'), '$0.00');   // USD keeps its 2 decimals
  assert.strictEqual(compactAmount(0, 'USD'), null, 'zero must not abbreviate');
  assert.strictEqual(compactAmount(-152450000, 'IDR'), 'Rp -152.5M');
  assert.strictEqual(compactAmount(-1250000, 'USD'), '$-1.3M');
  assert.ok(formatCurrency(-5000, 'IDR').includes('-'), 'a negative exact amount lost its sign');
  const { groups } = walletsByCurrency([w('IDR', -100), w('IDR', 40)]);
  assert.strictEqual(groups[0].total, -60, 'negative balances do not net correctly');
});

t('the abbreviated and exact figures describe the same amount, per currency', () => {
  for (const [cur, v] of [['IDR', 152450000], ['USD', 1250000], ['IDR', -9800000],
                          ['EUR', 3400000], ['USD', 999999999]]) {
    const head = compactAmount(v, cur);
    if (!head) continue;
    const unit = { M: 1e6, B: 1e9, T: 1e12 }[head.slice(-1)];
    const shown = Number(head.replace(currencyPrefix(cur), '').slice(0, -1));
    assert.ok(Math.abs(Math.abs(shown) * unit - Math.abs(v)) <= unit / 20 + 1e-6,
      `${head} is not a correct rounding of ${v} ${cur}`);
    assert.ok(head.startsWith(currencyPrefix(cur)),
      `${head} is not written in ${cur}`);
  }
});

t('the groups are ordered largest first, so the card has a reading order', () => {
  const { groups } = walletsByCurrency([w('USD', 5), w('IDR', 900), w('EUR', 100)]);
  assert.deepStrictEqual(groups.map((g) => g.currency), ['IDR', 'EUR', 'USD']);
});

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
