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
import { compactIdr, formatAmount } from '../../client/src/lib/money.js';

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

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nALL PASS — ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
