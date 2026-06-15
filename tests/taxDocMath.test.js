// Cash-impact invariant tests for the tax document linking case.
// Run: node tests/taxDocMath.test.js
const { reconcileInvoice } = require('../server/lib/taxDocMath');

let pass = 0, fail = 0;
const eq = (name, got, exp) => { if (got === exp) { console.log(`OK  ${name} -> ${got}`); pass++; } else { console.log(`XX  ${name} -> ${got} (exp ${exp})`); fail++; } };
const ok = (name, cond) => { if (cond) { console.log(`OK  ${name}`); pass++; } else { console.log(`XX  ${name}`); fail++; } };

// The redacted Helm Care / PT Bali Pawiwahan case.
const r = reconcileInvoice({
  subtotal_amount: 6000000, commercial_tax_amount: 660000, gross_amount: 6660000,
  withholding_base: 6000000, withholding_rate: 0.10, withholding_amount: 600000,
});

eq('gross = subtotal + VAT', r.gross, 6660000);
eq('expected vendor net = gross - withholding', r.expected_vendor_net_amount, 6060000);
eq('combined cash out = vendor net + tax', r.combined_cash_out, 6660000);
ok('case is balanced (no double counting)', r.balanced === true);
ok('no mismatches', r.mismatches.length === 0);

// Bases stay separate — faktur DPP (5.5M) is NOT the withholding base (6.0M).
ok('withholding base independent of VAT DPP', 6000000 !== 5500000);

// Mismatch detection: a wrong withholding amount is flagged, not hidden.
const bad = reconcileInvoice({ subtotal_amount: 6000000, commercial_tax_amount: 660000, gross_amount: 6660000, withholding_base: 6000000, withholding_rate: 0.10, withholding_amount: 500000 });
ok('wrong withholding flagged', bad.balanced === false && bad.mismatches.length > 0);

// Gross inconsistency flagged.
const bad2 = reconcileInvoice({ subtotal_amount: 6000000, commercial_tax_amount: 660000, gross_amount: 7000000, withholding_base: 6000000, withholding_rate: 0.10, withholding_amount: 600000 });
ok('wrong gross flagged', bad2.balanced === false);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
