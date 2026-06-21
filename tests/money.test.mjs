// Frontend money utility tests (decimal-safe, no binary float).
// Run: node tests/money.test.mjs
import M from '../client/src/lib/money.js';
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { console.log('OK  ' + m); pass++; } else { console.log('XX  ' + m); fail++; } };
const eq = (m, a, b) => ok(`${m} -> ${a}`, a === b);

// required precision cases
eq('0.1 + 0.2 = 0.3 (float-safe)', M.add('0.1', '0.2'), '0.3');
eq('0.00000001 BTC round-trips', M.fromScaled(M.toScaled('0.00000001')), '0.00000001');
eq('0.123456789012345678 ETH (18dp) exact', M.fromScaled(M.toScaled('0.123456789012345678')), '0.123456789012345678');
eq('100000000000000000 IDR exact', M.fromScaled(M.toScaled('100000000000000000')), '100000000000000000');

// add/sub/cmp
eq('sub 10000 - 3000', M.sub('10000', '3000'), '7000');
eq('sum list', M.sum(['1.5', '2.25', '0.25']), '4');
ok('cmp', M.cmp('0.3', '0.30') === 0 && M.cmp('1', '2') === -1 && M.cmp('2', '1') === 1);

// asset-specific formatting + display precision
eq('IDR 0 decimals grouped', M.formatAmount('1500000', 'IDR'), '1 500 000');
eq('USD 2 decimals', M.formatAmount('1234.5', 'USD'), '1 234.50');
eq('USD rounds half-up', M.formatAmount('1.005', 'USD'), '1.01');
eq('BTC 8 decimals', M.formatAmount('0.00000001', 'BTC'), '0.00000001');
eq('USDT 2 decimals', M.formatAmount('100.1', 'USDT'), '100.10');
eq('formatMoney appends asset', M.formatMoney('100', 'USD'), '100.00 USD');
eq('negative formats', M.formatAmount('-2500.5', 'USD'), '-2 500.50');

// native totals stay per-asset (never collapse different assets)
const wallets = [
  { asset_code: 'IDR', amount_original: '1000000' },
  { asset_code: 'IDR', amount_original: '500000' },
  { asset_code: 'USD', amount_original: '100.50' },
  { asset_code: 'BTC', amount_original: '0.00000001' },
];
const nt = M.nativeTotalsByAsset(wallets);
ok('IDR native total', nt.IDR === '1500000');
ok('USD native total separate', nt.USD === '100.5');
ok('BTC native total separate', nt.BTC === '0.00000001');
ok('three distinct assets, not summed', Object.keys(nt).length === 3);

// reporting total (single reporting currency) may be summed
const txs = [{ amount_reporting: '163000000' }, { amount_reporting: '500000' }, { amount_idr: '1000' }];
eq('reporting total sums (with amount_idr fallback)', M.reportingTotal(txs), '163501000');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
